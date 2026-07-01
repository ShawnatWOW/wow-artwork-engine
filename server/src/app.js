// Express app factory. Kept separate from index.js so tests can mount the app
// without binding a port.
import express from 'express';
import logger from './config/logger.js';
import healthRouter from './routes/health.js';

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
