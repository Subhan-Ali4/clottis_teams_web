import { hashToken } from './security.js';

export const COOKIE_NAME = 'sid';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const toPublicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  isActive: !!u.is_active,
  createdAt: u.created_at,
});

// `body` adds extra JSON fields to the error response (e.g. field errors, the current record).
export function httpError(status, message, body) {
  const e = new Error(message);
  e.status = status;
  if (body) e.body = body;
  return e;
}

// Cookie auth needs CSRF protection: every state-changing request must carry a
// custom header, which a cross-site form post cannot add. Cookie is also SameSite=Lax.
export function requireCustomHeader(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'XMLHttpRequest') {
    return next(httpError(403, 'Missing required request header'));
  }
  next();
}

// Looks up the session on EVERY request and re-checks that the user is still active,
// so deactivation takes effect immediately.
export function loadSession(db) {
  const find = db.prepare(`
    SELECT s.id AS session_id, s.expires_at, u.*
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ?`);
  const drop = db.prepare('DELETE FROM sessions WHERE id = ?');

  return (req, _res, next) => {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) return next();
    const row = find.get(hashToken(token));
    if (!row) return next();
    if (row.expires_at < Date.now() || !row.is_active) {
      drop.run(row.session_id);
      return next();
    }
    req.user = row;
    req.sessionId = row.session_id;
    next();
  };
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(httpError(401, 'Authentication required'));
  next();
}

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(httpError(401, 'Authentication required'));
  if (!roles.includes(req.user.role)) return next(httpError(403, 'You do not have permission to do this'));
  next();
};
