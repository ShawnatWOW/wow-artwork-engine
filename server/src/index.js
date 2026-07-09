// WOW Artwork Engine — server entry point.
import { loadSecrets } from './config/secrets.js';
import config from './config/index.js';
import logger from './config/logger.js';
import { createApp } from './app.js';
import { closePool } from './db/pool.js';
import { startScheduler } from './services/scheduler.js';
import { runWeek } from './services/orchestrator.js';

async function main() {
  await loadSecrets(); // Secrets Manager → process.env (no-op if unconfigured)
  const app = createApp();

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.env }, 'WOW Artwork Engine listening');
  });

  // Weekly generation scheduler — opt-in (SCHEDULER_ENABLED) so it only fires
  // in production, never in dev/CI.
  let scheduler = null;
  if (config.scheduler.enabled) {
    scheduler = startScheduler({
      onFire: () => runWeek({ triggeredBy: 'cron' }),
    });
    logger.info({ next: scheduler.next?.toISOString() }, 'Weekly scheduler enabled');
  } else {
    logger.info('Weekly scheduler disabled (set SCHEDULER_ENABLED=true to enable)');
  }

  const shutdown = async (signal) => {
    logger.info({ signal }, 'Shutting down');
    scheduler?.stop();
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
    // Force-exit if graceful shutdown stalls.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err: err.message }, 'Failed to start');
  process.exit(1);
});
