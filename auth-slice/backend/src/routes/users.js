import { Router } from 'express';
import {
  hashPassword, generatePassword, normalizeEmail, isValidEmail, isValidName, ROLES,
} from '../security.js';
import { toPublicUser, httpError, requireRole } from '../middleware.js';

export function userRoutes(db) {
  const r = Router();
  r.use(requireRole('owner', 'admin'));

  const listUsers = db.prepare('SELECT * FROM users ORDER BY id');
  const getUser = db.prepare('SELECT * FROM users WHERE id = ?');
  const findByEmail = db.prepare('SELECT id FROM users WHERE email = ?');
  const insertUser = db.prepare(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)');
  const setPassword = db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?");
  const setActive = db.prepare("UPDATE users SET is_active = ?, updated_at = datetime('now') WHERE id = ?");
  const deleteAllSessions = db.prepare('DELETE FROM sessions WHERE user_id = ?');

  // Admins cannot create or touch Owner accounts; only an Owner can.
  const canManage = (actor, target) => actor.role === 'owner' || target.role !== 'owner';

  function loadTarget(req) {
    const id = Number(req.params.id);
    const target = Number.isInteger(id) ? getUser.get(id) : null;
    if (!target) throw httpError(404, 'User not found');
    if (!canManage(req.user, target)) throw httpError(403, 'You do not have permission to manage this user');
    return target;
  }

  r.get('/', (_req, res) => {
    res.json({ users: listUsers.all().map(toPublicUser) });
  });

  r.post('/', (req, res, next) => {
    const { name, role } = req.body ?? {};
    const email = normalizeEmail(req.body?.email);

    if (!isValidName(name)) return next(httpError(400, 'Name must be 2 to 100 characters'));
    if (!isValidEmail(email)) return next(httpError(400, 'A valid email address is required'));
    if (!ROLES.includes(role)) return next(httpError(400, 'Role must be owner, admin or member'));
    if (role === 'owner' && req.user.role !== 'owner') {
      return next(httpError(403, 'Only an Owner can create another Owner'));
    }
    if (findByEmail.get(email)) return next(httpError(409, 'A user with this email already exists'));

    // The plaintext exists only in this response; only the hash is stored.
    const initialPassword = generatePassword();
    let info;
    try {
      info = insertUser.run(name.trim(), email, hashPassword(initialPassword), role);
    } catch (e) {
      if (/UNIQUE constraint failed/i.test(String(e.message))) {
        return next(httpError(409, 'A user with this email already exists'));
      }
      throw e;
    }
    res.status(201).json({ user: toPublicUser(getUser.get(info.lastInsertRowid)), initialPassword });
  });

  r.post('/:id/reset-password', (req, res) => {
    const target = loadTarget(req);
    if (target.id === req.user.id) {
      throw httpError(400, 'Use change password for your own account');
    }
    const newPassword = generatePassword();
    setPassword.run(hashPassword(newPassword), target.id);
    deleteAllSessions.run(target.id); // sign the user out everywhere
    res.json({ user: toPublicUser(getUser.get(target.id)), newPassword });
  });

  r.patch('/:id/status', (req, res) => {
    const target = loadTarget(req);
    const { isActive } = req.body ?? {};
    if (typeof isActive !== 'boolean') throw httpError(400, 'isActive must be true or false');
    if (target.id === req.user.id && !isActive) {
      throw httpError(400, 'You cannot deactivate your own account');
    }
    setActive.run(isActive ? 1 : 0, target.id);
    if (!isActive) deleteAllSessions.run(target.id);
    res.json({ user: toPublicUser(getUser.get(target.id)) });
  });

  return r;
}
