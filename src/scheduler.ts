import { pingAllDevices } from './routes/adminRoutes.js';

let timer: NodeJS.Timeout | null = null;
let isPinging = false;

/**
 * Triggers a ping cycle for all registered devices with FCM tokens.
 */
export async function triggerScheduledPingCycle(): Promise<void> {
  if (isPinging) {
    console.log('[Auto-Ping] Previous ping cycle is still in progress, skipping duplicate.');
    return;
  }

  isPinging = true;
  const startTime = new Date();
  console.log(`\n[Auto-Ping] ⏰ [${startTime.toLocaleTimeString()}] Triggering scheduled location ping for all devices...`);

  try {
    const result = await pingAllDevices();
    const duration = ((Date.now() - startTime.getTime()) / 1000).toFixed(1);
    console.log(
      `[Auto-Ping] ✅ Ping cycle completed in ${duration}s. ` +
      `Total: ${result.total} | Sent: ${result.success} | Failed: ${result.failed} | Skipped (No FCM): ${result.skipped}`
    );
  } catch (err: any) {
    console.error('[Auto-Ping] ❌ Scheduled ping error:', err?.message || err);
  } finally {
    isPinging = false;
  }
}

/**
 * Starts the automatic 30-minute ping background timer.
 * @param intervalMinutes Interval in minutes (defaults to 30)
 * @param runImmediatelyOnStart If true, runs one ping cycle upon startup
 */
export function startAutoPingScheduler(intervalMinutes = 30, runImmediatelyOnStart = false): NodeJS.Timeout {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  const intervalMs = intervalMinutes * 60 * 1000;
  console.log(`[Auto-Ping] 🚀 Scheduler active: pinging all registered devices every ${intervalMinutes} minutes.`);

  if (runImmediatelyOnStart) {
    triggerScheduledPingCycle().catch(() => {});
  }

  timer = setInterval(() => {
    triggerScheduledPingCycle().catch(() => {});
  }, intervalMs);

  return timer;
}

export function stopAutoPingScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[Auto-Ping] Scheduler stopped.');
  }
}
