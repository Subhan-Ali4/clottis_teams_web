import { Router } from 'express';
import {
  hashPassword, verifyPassword, burnPasswordCheck, newSessionToken, hashToken,
  normalizeEmail, isValidPassword,
} from '../security.js';
import {
  COOKIE_NAME, SESSION_TTL_MS, toPublicUser, httpError, requireAuth,
} from '../middleware.js';

export function authRoutes(db, { secureCookies }) {
  const r = Router();

  const cookieOpts = {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookies,
    path: '/',
  };

  const findByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
  const insertSession = db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)');
  const deleteSession = db.prepare('DELETE FROM sessions WHERE id = ?');
  const deleteOtherSessions = db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?');
  const setPassword = db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?");
  const GENERIC = 'Invalid email or password';

  r.post('/login', (req, res, next) => {
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;
    if (!email || typeof password !== 'string' || !password) {
      return next(httpError(400, 'Email and password are required'));
    }

    const user = findByEmail.get(email);
    if (!user) {
      burnPasswordCheck(password); // same cost whether or not the email exists
      return next(httpError(401, GENERIC));
    }
    if (!verifyPassword(password, user.password_hash)) return next(httpError(401, GENERIC));
    if (!user.is_active) {
      return next(httpError(403, 'This account is deactivated. Please contact an administrator.'));
    }

    const token = newSessionToken();
    insertSession.run(hashToken(token), user.id, Date.now() + SESSION_TTL_MS);
    res.cookie(COOKIE_NAME, token, { ...cookieOpts, maxAge: SESSION_TTL_MS });
    res.json({ user: toPublicUser(user) });
  });

  r.post('/logout', (req, res) => {
    if (req.sessionId) deleteSession.run(req.sessionId);
    res.clearCookie(COOKIE_NAME, cookieOpts);
    res.status(204).end();
  });

  r.get('/me', requireAuth, (req, res) => {
    res.json({ user: toPublicUser(req.user) });
  });

  r.post('/change-password', requireAuth, (req, res, next) => {
    const { currentPassword, newPassword } = req.body ?? {};
    if (typeof currentPassword !== 'string' || !currentPassword) {
      return next(httpError(400, 'Current password is required'));
    }
    if (!isValidPassword(newPassword)) {
      return next(httpError(400, 'New password must be 8 to 128 characters'));
    }
    if (!verifyPassword(currentPassword, req.user.password_hash)) {
      return next(httpError(400, 'Current password is incorrect'));
    }
    if (currentPassword === newPassword) {
      return next(httpError(400, 'New password must be different from the current one'));
    }

    setPassword.run(hashPassword(newPassword), req.user.id);
    deleteOtherSessions.run(req.user.id, req.sessionId); // other devices are signed out
    res.status(204).end();
  });

  return r;
}
