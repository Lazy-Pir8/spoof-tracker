import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
  Switch
} from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import * as Device from 'expo-device';
import * as Battery from 'expo-battery';
import * as Network from 'expo-network';
import axios from 'axios';

// -------------------------------------------------------------
// DEFAULT SERVER URL CONFIGURATION
// If you put your permanent URL here (e.g. from Render.com or
// Ngrok static domain), the user NEVER has to type anything!
// -------------------------------------------------------------
const DEFAULT_SERVER_URL = ''; // e.g. 'https://spoof-tracker.onrender.com'

const BACKGROUND_NOTIFICATION_TASK = 'BACKGROUND-NOTIFICATION-TASK';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Configure Axios to bypass localtunnel reminder header automatically
axios.defaults.headers.common['Bypass-Tunnel-Reminder'] = 'true';

// Helper to gather device hardware and battery telemetry
async function collectTelemetry() {
  let battery = null;
  try {
    const level = await Battery.getBatteryLevelAsync();
    const state = await Battery.getBatteryStateAsync();
    battery = {
      level: Math.round(level * 100) + '%',
      isCharging:
        state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL,
      stateText:
        state === Battery.BatteryState.CHARGING
          ? 'Charging'
          : state === Battery.BatteryState.FULL
          ? 'Full'
          : state === Battery.BatteryState.UNPLUGGED
          ? 'Unplugged'
          : 'Unknown'
    };
  } catch (e) {
    console.log('Battery error:', e);
  }

  let network = null;
  try {
    const netState = await Network.getNetworkStateAsync();
    network = {
      type: netState.networkType, // WIFI, CELLULAR, etc.
      isConnected: netState.isConnected,
      isInternetReachable: netState.isInternetReachable
    };
  } catch (e) {
    console.log('Network error:', e);
  }

  return {
    battery,
    network,
    deviceInfo: {
      brand: Device.brand || 'Unknown',
      manufacturer: Device.manufacturer || 'Unknown',
      modelName: Device.modelName || Device.deviceName || 'Android Device',
      modelId: Device.modelId || null,
      osName: Device.osName || 'Android',
      osVersion: Device.osVersion || 'Unknown',
      platformApiLevel: Device.platformApiLevel || null,
      deviceType:
        Device.deviceType === 1 ? 'PHONE' : Device.deviceType === 2 ? 'TABLET' : 'OTHER',
      totalMemory: Device.totalMemory
        ? (Device.totalMemory / (1024 * 1024 * 1024)).toFixed(1) + ' GB'
        : null
    }
  };
}

// Helper to obtain best location + reverse geocoding address
async function obtainBestLocationAndDetails() {
  let coords = null;
  try {
    const current = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('GPS timeout')), 7000))
    ]);
    if (current && current.coords) coords = current.coords;
  } catch (err) {
    console.log('High accuracy timeout, falling back:', err);
  }

  if (!coords) {
    const lastKnown = await Location.getLastKnownPositionAsync({});
    if (lastKnown && lastKnown.coords) {
      coords = lastKnown.coords;
    } else {
      const fallback = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced
      });
      coords = fallback.coords;
    }
  }

  // Reverse geocode to real street name and city
  let address = null;
  try {
    const [geo] = await Location.reverseGeocodeAsync({
      latitude: coords.latitude,
      longitude: coords.longitude
    });
    if (geo) {
      const parts = [
        geo.streetNumber ? `${geo.streetNumber} ${geo.street}` : geo.street,
        geo.district,
        geo.city || geo.subregion,
        geo.region,
        geo.postalCode,
        geo.country
      ].filter(Boolean);

      address = {
        formatted: parts.join(', '),
        street: geo.street || null,
        city: geo.city || geo.subregion || null,
        region: geo.region || null,
        postalCode: geo.postalCode || null,
        country: geo.country || null,
        name: geo.name || null
      };
    }
  } catch (e) {
    console.log('Reverse geocoding error:', e);
  }

  const locationDetails = {
    accuracy: coords.accuracy ? `±${Math.round(coords.accuracy)} m` : null,
    altitude: coords.altitude ? `${Math.round(coords.altitude)} m` : null,
    altitudeAccuracy: coords.altitudeAccuracy ? `±${Math.round(coords.altitudeAccuracy)} m` : null,
    heading: coords.heading != null && coords.heading >= 0 ? `${Math.round(coords.heading)}°` : null,
    speed:
      coords.speed != null && coords.speed > 0
        ? `${(coords.speed * 3.6).toFixed(1)} km/h`
        : 'Stationary',
    address
  };

  return { coords, locationDetails };
}

// Global reference for background task
let activeServerUrl = DEFAULT_SERVER_URL;

// Background Task definition
TaskManager.defineTask(BACKGROUND_NOTIFICATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error('Background task error:', error);
    return;
  }

  const payloadData =
    data?.notification?.request?.content?.data ||
    data?.notification?.data ||
    data?.data ||
    data;

  if (payloadData && payloadData.command === 'FETCH_LOCATION') {
    try {
      console.log('Background Ping received!');
      const tokenData = await Notifications.getDevicePushTokenAsync();
      const fcmToken = tokenData.data;

      const { coords, locationDetails } = await obtainBestLocationAndDetails();
      const telemetry = await collectTelemetry();

      const targetUrl = activeServerUrl || DEFAULT_SERVER_URL;

      if (targetUrl) {
        await axios.post(`${targetUrl.replace(/\/+$/, '')}/api/device/location`, {
          fcmToken,
          latitude: coords.latitude,
          longitude: coords.longitude,
          locationDetails,
          telemetry
        });
        console.log('Background location & telemetry dispatched!');
      }
    } catch (e) {
      console.error('Failed background location fetch:', e);
    }
  }
});

Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK).catch(err => {
  console.log('Background task registration info:', err?.message);
});

export default function App() {
  const [deviceId, setDeviceId] = useState('');
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [status, setStatus] = useState('Idle');
  const [showConfig, setShowConfig] = useState(!DEFAULT_SERVER_URL);
  const [logs, setLogs] = useState([]);
  const serverUrlRef = useRef(serverUrl);

  const addLog = (msg) => {
    setLogs((prev) => [new Date().toLocaleTimeString() + ': ' + msg, ...prev.slice(0, 10)]);
  };

  useEffect(() => {
    const id = 'android-' + Math.random().toString(36).substr(2, 9);
    setDeviceId(id);
    addLog(`Device ID: ${id}`);

    const subscription = Notifications.addNotificationReceivedListener(async (notification) => {
      const data = notification.request?.content?.data;
      if (data && data.command === 'FETCH_LOCATION') {
        addLog('Received location ping from server!');
        fetchAndSendLocation(id, serverUrlRef.current);
      }
    });

    return () => subscription.remove();
  }, []);

  const handleUrlChange = (text) => {
    setServerUrl(text);
    serverUrlRef.current = text;
    activeServerUrl = text;
  };

  const enableTracking = async () => {
    const cleanUrl = serverUrl.trim().replace(/\/+$/, '');
    if (!cleanUrl) {
      Alert.alert(
        'Server URL Required',
        'Please enter your server URL below, or set a permanent default URL in the app.'
      );
      setShowConfig(true);
      return;
    }

    setStatus('Configuring tracking...');
    addLog('Requesting permissions...');

    try {
      // 1. Notification Permissions
      const notifStatus = await Notifications.requestPermissionsAsync();
      if (!notifStatus.granted) {
        setStatus('Notification permission denied');
        Alert.alert('Permission Denied', 'Please grant notification permission so the server can reach this phone.');
        return;
      }
      addLog('Notifications granted.');

      // 2. Foreground Location
      const fgLocation = await Location.requestForegroundPermissionsAsync();
      if (!fgLocation.granted) {
        setStatus('Location permission denied');
        Alert.alert('Permission Denied', 'Location permission is required.');
        return;
      }
      addLog('Foreground location granted.');

      // 3. Background Location (Safe attempt)
      try {
        const bgLocation = await Location.requestBackgroundPermissionsAsync();
        if (bgLocation.granted) {
          addLog('Background location granted.');
        } else {
          addLog('Background location: prompt completed.');
        }
      } catch (bgErr) {
        console.log('Background permission request info:', bgErr?.message);
      }

      setStatus('Getting push token...');
      addLog('Fetching FCM push token...');
      const tokenData = await Notifications.getDevicePushTokenAsync();
      const fcmToken = tokenData.data;
      addLog('FCM token acquired.');

      setStatus('Registering device...');
      addLog(`Registering with server...`);

      const telemetry = await collectTelemetry();

      const res = await axios.post(`${cleanUrl}/api/device/register`, {
        deviceId,
        fcmToken,
        deviceName: Device.modelName || Device.deviceName || 'Android Device',
        deviceInfo: telemetry.deviceInfo
      });

      if (res.status === 200 || res.status === 201) {
        setStatus('✅ Tracking Active');
        addLog('Successfully registered with server!');
        Alert.alert('Connected!', 'Device is active and ready to report location upon ping.');
      } else {
        throw new Error(`Server returned status ${res.status}`);
      }
    } catch (error) {
      console.error('Setup error:', error);
      setStatus('Error: ' + error.message);
      addLog('Error: ' + error.message);

      if (error.response) {
        Alert.alert('Server Error', `Status ${error.response.status}: ${JSON.stringify(error.response.data)}`);
      } else if (error.request) {
        Alert.alert(
          'Connection Failed',
          `Could not reach "${cleanUrl}".\n\nPlease verify:\n1. Server is running\n2. Tunnel is active\n3. URL includes https://`
        );
      } else {
        Alert.alert('Setup Error', error.message);
      }
    }
  };

  const fetchAndSendLocation = async (currentDeviceId, targetUrl) => {
    const cleanUrl = (targetUrl || serverUrl).trim().replace(/\/+$/, '');
    try {
      addLog('Acquiring GPS coordinates & address...');
      const { coords, locationDetails } = await obtainBestLocationAndDetails();
      const telemetry = await collectTelemetry();

      addLog(`GPS: ${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`);
      if (locationDetails.address?.city) {
        addLog(`City: ${locationDetails.address.city}`);
      }

      await axios.post(`${cleanUrl}/api/device/location`, {
        deviceId: currentDeviceId,
        latitude: coords.latitude,
        longitude: coords.longitude,
        locationDetails,
        telemetry
      });

      addLog('Location & telemetry sent to server!');
    } catch (error) {
      console.error('Failed to send location:', error);
      addLog('Send error: ' + error.message);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>📡 Spoof Tracker</Text>

      {/* Main Status Display */}
      <View style={styles.statusBox}>
        <Text style={styles.statusText}>{status}</Text>
        <Text style={styles.deviceIdText}>Device ID: {deviceId}</Text>
        <Text style={styles.deviceModelText}>
          {Device.brand ? `${Device.brand} ${Device.modelName}` : 'Android Device'}
        </Text>
      </View>

      {/* Action Buttons */}
      <TouchableOpacity style={styles.primaryButton} onPress={enableTracking}>
        <Text style={styles.buttonText}>Enable Tracking</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={() => fetchAndSendLocation(deviceId, serverUrl)}
      >
        <Text style={styles.secondaryButtonText}>📍 Test Send Location</Text>
      </TouchableOpacity>

      {/* Server URL Settings */}
      <TouchableOpacity
        style={styles.toggleConfigButton}
        onPress={() => setShowConfig(!showConfig)}
      >
        <Text style={styles.toggleConfigText}>
          {showConfig ? '▼ Hide Server Settings' : '▶ Server URL Settings'}
        </Text>
      </TouchableOpacity>

      {showConfig && (
        <View style={styles.card}>
          <Text style={styles.label}>Server Public URL:</Text>
          <TextInput
            style={styles.input}
            value={serverUrl}
            onChangeText={handleUrlChange}
            placeholder="https://..."
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.hint}>
            If you deploy the server or use a static domain, this can be permanently baked in.
          </Text>
        </View>
      )}

      {/* Real-time Activity Log */}
      <View style={styles.logsBox}>
        <Text style={styles.logsTitle}>Live Activity Log:</Text>
        {logs.map((log, index) => (
          <Text key={index} style={styles.logText}>
            {log}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#0f172a',
    padding: 24,
    paddingTop: 55,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#f8fafc',
    textAlign: 'center',
    marginBottom: 18,
  },
  statusBox: {
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 18,
    marginBottom: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  statusText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#38bdf8',
    marginBottom: 4,
  },
  deviceIdText: {
    fontSize: 13,
    color: '#94a3b8',
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  deviceModelText: {
    fontSize: 12,
    color: '#64748b',
  },
  primaryButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: '#334155',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 14,
  },
  secondaryButtonText: {
    color: '#cbd5e1',
    fontSize: 14,
    fontWeight: '600',
  },
  toggleConfigButton: {
    paddingVertical: 8,
    alignItems: 'center',
    marginBottom: 10,
  },
  toggleConfigText: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#94a3b8',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    color: '#f8fafc',
    padding: 10,
    fontSize: 14,
  },
  hint: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 6,
  },
  logsBox: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 14,
    minHeight: 120,
    borderWidth: 1,
    borderColor: '#334155',
  },
  logsTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94a3b8',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  logText: {
    fontSize: 11,
    color: '#64748b',
    fontFamily: 'monospace',
    marginVertical: 2,
  },
});
