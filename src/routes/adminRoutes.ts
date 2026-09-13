import { Router, type Request, type Response } from 'express';
import { db, messaging } from '../firebase';

const router = Router();

// Endpoint for the dashboard to get all registered devices
router.get('/devices', async (req: Request, res: Response): Promise<void> => {
  try {
    const snapshot = await db.collection('devices').get();
    const devices: any[] = [];
    
    snapshot.forEach((doc) => {
      devices.push({
        id: doc.id,
        ...doc.data()
      });
    });

    res.status(200).json({ devices });
  } catch (error) {
    console.error('Error fetching devices:', error);
    res.status(500).json({ error: 'Failed to fetch devices' });
  }
});

// Endpoint for the dashboard to trigger a location fetch for a specific device
router.post('/ping/:deviceId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { deviceId } = req.params;
    
    const doc = await db.collection('devices').doc(deviceId).get();
    if (!doc.exists) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    const deviceData = doc.data();
    const fcmToken = deviceData?.fcmToken;

    if (!fcmToken) {
      res.status(400).json({ error: 'Device has no FCM token' });
      return;
    }

    // Send a silent high-priority data message to the device
    const message = {
      data: {
        command: 'FETCH_LOCATION',
        timestamp: new Date().toISOString()
      },
      android: {
        priority: 'high' as const,
      },
      token: fcmToken
    };

    const response = await messaging.send(message);
    
    res.status(200).json({ message: 'Ping sent successfully', messageId: response });
  } catch (error) {
    console.error('Error sending ping:', error);
    res.status(500).json({ error: 'Failed to ping device' });
  }
});

export default router;

