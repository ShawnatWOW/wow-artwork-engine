// Express app factory. Kept separate from index.js so tests can mount the app
// without binding a port.
import express from 'express';
import logger from './config/logger.js';
import healthRouter from './routes/health.js';
import runsRouter from './routes/runs.js';
import artworksRouter from './routes/artworks.js';
import handoffRouter from './routes/handoff.js';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Lightweight request logging (pino-http when available, else a shim).
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      logger.info(
        { method: req.method, url: req.url, status: res.statusCode, ms: Date.now() - start },
        'request',
      );
    });
    next();
  });

  app.use(healthRouter);
  // Dashboard + orchestration API. Namespaced under /api so it drops cleanly
  // into the shared WOW dashboard (unstuckllc/wow-contract-query) behind its
  // existing /api proxy.
  app.use('/api', runsRouter);
  app.use('/api', artworksRouter);
  app.use('/api', handoffRouter);

  // 404
  app.use((req, res) => res.status(404).json({ error: 'not_found', path: req.path }));

  // Error handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    logger.error({ err: err.message }, 'Unhandled error');
    res.status(err.status || 500).json({ error: 'internal_error' });
  });

  return app;
}

export default createApp;
