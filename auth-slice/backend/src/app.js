import express from 'express';
import cookieParser from 'cookie-parser';
import { loadSession, requireAuth, requireCustomHeader } from './middleware.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';

export function createApp(db, { secureCookies = false } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());
  app.use(requireCustomHeader);
  app.use(loadSession(db));

  app.use('/api/auth', authRoutes(db, { secureCookies }));
  app.use('/api/users', requireAuth, userRoutes(db));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // Error handler: logs only the message (never request bodies, so no passwords).
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error('Server error:', err.message);
    res.status(status).json({
      error: status >= 500 ? 'Something went wrong' : err.message,
    });
  });

  return app;
}
