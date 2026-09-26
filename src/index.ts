import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import deviceRoutes from './routes/deviceRoutes.js';
import adminRoutes from './routes/adminRoutes.js';

import { startAutoPingScheduler } from './scheduler.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Trust proxy to get real IP if hosted behind a reverse proxy (e.g., Render, Heroku)
app.set('trust proxy', true);

// Routes
app.use('/api/device', deviceRoutes);
app.use('/api/admin', adminRoutes);

// Serve static frontend files
app.use(express.static('public'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);

  // Automatically start background scheduler to ping all devices every 30 minutes
  const AUTO_PING_INTERVAL = Number(process.env.AUTO_PING_INTERVAL_MINUTES) || 30;
  const ENABLE_AUTO_PING = process.env.ENABLE_AUTO_PING !== 'false';

  if (ENABLE_AUTO_PING) {
    startAutoPingScheduler(AUTO_PING_INTERVAL);
  }
});

