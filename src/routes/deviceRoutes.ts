import { Router, type Request, type Response } from 'express';
import { db } from '../firebase';

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
    let { deviceId, fcmToken, latitude, longitude, locationDetails, telemetry } = req.body;

    if ((!deviceId && !fcmToken) || latitude === undefined || longitude === undefined) {
      res.status(400).json({ error: 'deviceId (or fcmToken), latitude, and longitude are required' });
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

    await db.collection('devices').doc(deviceId).set({
      location: {
        latitude,
        longitude,
        ...(locationDetails || {})
      },
      telemetry: telemetry || {},
      ipAddress,
      lastUpdated: new Date().toISOString()
    }, { merge: true });

    res.status(200).json({ message: 'Location updated successfully' });
  } catch (error) {
    console.error('Error updating location:', error);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

export default router;

