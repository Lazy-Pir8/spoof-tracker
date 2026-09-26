import { Router, type Request, type Response } from 'express';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { db, messaging } from '../firebase.js';

const router = Router();

// Helper to batch-delete all documents in a subcollection
async function deleteSubcollection(
  collectionRef: FirebaseFirestore.CollectionReference,
  batchSize = 100
): Promise<void> {
  let snapshot = await collectionRef.limit(batchSize).get();
  while (!snapshot.empty) {
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    snapshot = await collectionRef.limit(batchSize).get();
  }
}

// Endpoint for the dashboard to get all registered devices
router.get('/devices', async (req: Request, res: Response): Promise<void> => {
  try {
    const snapshot = await db.collection('devices').get();
    const devices: any[] = [];
    
    snapshot.forEach((doc: QueryDocumentSnapshot) => {
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

function getParamString(param: string | string[] | undefined): string {
  if (!param) return '';
  return Array.isArray(param) ? param[0] : param;
}

// Endpoint for the dashboard to get past location history for a device
const getDeviceHistoryHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const deviceId = getParamString(req.params.deviceId);
    if (!deviceId) {
      res.status(400).json({ error: 'deviceId is required' });
      return;
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

    const docRef = db.collection('devices').doc(deviceId);
    const deviceDoc = await docRef.get();

    if (!deviceDoc.exists) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    const historyCol = docRef.collection('history');
    let historyDocs: any[] = [];

    try {
      // Order by timestamp descending (newest first)
      const snapshot = await historyCol.orderBy('timestamp', 'desc').limit(limit).get();
      snapshot.forEach((doc: QueryDocumentSnapshot) => {
        historyDocs.push({
          id: doc.id,
          ...doc.data()
        });
      });
    } catch (orderErr) {
      console.warn('History orderBy index fallback:', orderErr);
      const snapshot = await historyCol.limit(limit).get();
      snapshot.forEach((doc: QueryDocumentSnapshot) => {
        historyDocs.push({
          id: doc.id,
          ...doc.data()
        });
      });
    }

    // Ensure sorted in descending order (newest first)
    historyDocs.sort((a, b) => {
      const timeA = new Date(a.timestamp || a.createdAt || 0).getTime();
      const timeB = new Date(b.timestamp || b.createdAt || 0).getTime();
      return timeB - timeA;
    });

    // If no entries exist in the history subcollection yet (e.g. registered before history feature),
    // but the device doc has a current location, include it as a legacy initial entry
    const deviceData = deviceDoc.data();
    if (
      historyDocs.length === 0 &&
      deviceData?.location &&
      deviceData.location.latitude !== undefined &&
      deviceData.location.longitude !== undefined
    ) {
      historyDocs.push({
        id: 'legacy-latest',
        latitude: deviceData.location.latitude,
        longitude: deviceData.location.longitude,
        locationDetails: deviceData.location,
        telemetry: deviceData.telemetry || {},
        ipAddress: deviceData.ipAddress || null,
        timestamp: deviceData.lastUpdated || new Date().toISOString(),
        isLegacy: true
      });
    }

    res.status(200).json({
      deviceId,
      deviceName: deviceData?.deviceName || 'Unknown Device',
      count: historyDocs.length,
      history: historyDocs
    });
  } catch (error) {
    console.error('Error fetching device history:', error);
    res.status(500).json({ error: 'Failed to fetch location history' });
  }
};

router.get('/devices/:deviceId/history', getDeviceHistoryHandler);
router.get('/history/:deviceId', getDeviceHistoryHandler);

// Endpoint to delete/remove a device and its history subcollection
const removeDeviceHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const deviceId = getParamString(req.params.deviceId);
    if (!deviceId) {
      res.status(400).json({ error: 'deviceId is required' });
      return;
    }
    const docRef = db.collection('devices').doc(deviceId);
    const doc = await docRef.get();

    if (!doc.exists) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    // 1. Delete all history subcollection documents
    await deleteSubcollection(docRef.collection('history'));

    // 2. Delete the parent device document
    await docRef.delete();

    console.log(`Device removed: ${deviceId}`);
    res.status(200).json({
      message: `Device ${deviceId} and all location history removed successfully`,
      deletedDeviceId: deviceId
    });
  } catch (error) {
    console.error('Error removing device:', error);
    res.status(500).json({ error: 'Failed to remove device' });
  }
};

router.delete('/devices/:deviceId', removeDeviceHandler);
router.delete('/device/:deviceId', removeDeviceHandler);

// Endpoint to clear only the location history of a device
router.delete('/devices/:deviceId/history', async (req: Request, res: Response): Promise<void> => {
  try {
    const deviceId = getParamString(req.params.deviceId);
    if (!deviceId) {
      res.status(400).json({ error: 'deviceId is required' });
      return;
    }
    const docRef = db.collection('devices').doc(deviceId);
    const doc = await docRef.get();

    if (!doc.exists) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    await deleteSubcollection(docRef.collection('history'));

    // Reset ping count on device doc
    await docRef.update({
      totalPings: 0
    });

    res.status(200).json({
      message: `Location history cleared for device ${deviceId}`,
      deviceId
    });
  } catch (error) {
    console.error('Error clearing device history:', error);
    res.status(500).json({ error: 'Failed to clear device history' });
  }
});

// Endpoint for the dashboard to trigger a location fetch for a specific device
router.post('/ping/:deviceId', async (req: Request, res: Response): Promise<void> => {
  try {
    const deviceId = getParamString(req.params.deviceId);
    if (!deviceId) {
      res.status(400).json({ error: 'deviceId is required' });
      return;
    }
    
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

export interface PingResult {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  devices: Array<{
    deviceId: string;
    deviceName?: string;
    status: 'sent' | 'failed' | 'no_token';
    messageId?: string;
    error?: string;
  }>;
}

// Reusable function to ping all registered devices with valid FCM tokens
export async function pingAllDevices(): Promise<PingResult> {
  const snapshot = await db.collection('devices').get();
  const devicesResult: PingResult['devices'] = [];

  const promises = snapshot.docs.map(async (doc) => {
    const deviceId = doc.id;
    const deviceData = doc.data();
    const fcmToken = deviceData?.fcmToken;
    const deviceName = deviceData?.deviceName || 'Unknown Device';

    if (!fcmToken) {
      devicesResult.push({
        deviceId,
        deviceName,
        status: 'no_token',
        error: 'No FCM push token registered'
      });
      return;
    }

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

    try {
      const response = await messaging.send(message);
      devicesResult.push({
        deviceId,
        deviceName,
        status: 'sent',
        messageId: response
      });
    } catch (err: any) {
      console.error(`[Ping] Failed to ping device ${deviceId}:`, err.message);
      devicesResult.push({
        deviceId,
        deviceName,
        status: 'failed',
        error: err.message
      });
    }
  });

  await Promise.allSettled(promises);

  const success = devicesResult.filter((d) => d.status === 'sent').length;
  const failed = devicesResult.filter((d) => d.status === 'failed').length;
  const skipped = devicesResult.filter((d) => d.status === 'no_token').length;

  return {
    total: snapshot.size,
    success,
    failed,
    skipped,
    devices: devicesResult
  };
}

// Handler for triggering a location fetch for ALL registered devices at once
const pingAllHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await pingAllDevices();
    res.status(200).json({
      message: `Ping dispatched to ${result.success} of ${result.total} devices`,
      ...result
    });
  } catch (error) {
    console.error('Error pinging all devices:', error);
    res.status(500).json({ error: 'Failed to ping all devices' });
  }
};

// Supports both POST and GET (useful for browser address bar and basic cron services)
router.post('/ping-all', pingAllHandler);
router.get('/ping-all', pingAllHandler);

export default router;

