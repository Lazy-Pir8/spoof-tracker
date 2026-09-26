import 'dotenv/config';

// Parse command line arguments
const args = process.argv.slice(2);
const isRunOnce = args.includes('--once');
const urlIndex = args.indexOf('--url');
const intervalIndex = args.indexOf('--interval');

const DEFAULT_SERVER_URL = process.env.SERVER_URL || 'https://spoof-tracker.onrender.com';
const SERVER_URL = (urlIndex !== -1 && args[urlIndex + 1])
  ? args[urlIndex + 1].replace(/\/+$/, '')
  : DEFAULT_SERVER_URL.replace(/\/+$/, '');

const INTERVAL_MINUTES = (intervalIndex !== -1 && Number(args[intervalIndex + 1]))
  ? Number(args[intervalIndex + 1])
  : Number(process.env.AUTO_PING_INTERVAL_MINUTES) || 30;

const INTERVAL_MS = INTERVAL_MINUTES * 60 * 1000;

console.log('===========================================================');
console.log('🛰️  Spoof Tracker — Automated Device Ping Runner');
console.log('===========================================================');
console.log(`Target Server : ${SERVER_URL}`);
console.log(`Mode          : ${isRunOnce ? 'Single Run (--once)' : `Continuous (Every ${INTERVAL_MINUTES} minutes)`}`);
console.log('===========================================================\n');

async function pingAll() {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[${timestamp}] 📡 Contacting server to ping all devices...`);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout in case server is waking from cold start

    const response = await fetch(`${SERVER_URL}/api/admin/ping-all`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'SpoofTracker-AutoPing/1.0',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[${timestamp}] ❌ Server returned HTTP ${response.status}: ${errText}`);
      return;
    }

    const data = await response.json();
    console.log(`[${timestamp}] ✅ ${data.message || 'Ping completed successfully'}`);

    if (Array.isArray(data.devices)) {
      data.devices.forEach((d: any) => {
        const icon = d.status === 'sent' ? '✅' : d.status === 'no_token' ? '⚠️' : '❌';
        console.log(`   ${icon} ${d.deviceId} (${d.deviceName || 'Device'}): ${d.status}${d.error ? ` - ${d.error}` : ''}`);
      });
    }

    if (!isRunOnce) {
      const nextTime = new Date(Date.now() + INTERVAL_MS).toLocaleTimeString();
      console.log(`\n⏳ Next ping cycle scheduled in ${INTERVAL_MINUTES} minutes at ${nextTime}.\n`);
    }
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error(`[${timestamp}] ⚠️ Request timed out after 60s (server may be waking from cold sleep). Will retry next cycle.`);
    } else {
      console.error(`[${timestamp}] ❌ Network or server error:`, error.message);
    }
  }
}

// Main execution loop
async function main() {
  // Execute first run immediately
  await pingAll();

  if (isRunOnce) {
    process.exit(0);
  }

  // Set recurring interval
  setInterval(() => {
    pingAll().catch((err) => {
      console.error('Unhandled interval error:', err);
    });
  }, INTERVAL_MS);
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Auto-ping runner stopped by user (SIGINT).');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Auto-ping runner terminated (SIGTERM).');
  process.exit(0);
});

main();
