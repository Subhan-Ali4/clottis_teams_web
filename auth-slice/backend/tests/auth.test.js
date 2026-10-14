import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/security.js';

const OWNER = { name: 'Olivia Owner', email: 'owner@example.com', password: 'owner-password-1' };

function setup() {
  const db = openDb(':memory:', { seedDemo: false });
  const app = createApp(db);
  const seed = (name, email, role, password) =>
    db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)')
      .run(name, email, hashPassword(password), role);
  seed(OWNER.name, OWNER.email, 'owner', OWNER.password);
  // A "client" is one browser: it keeps its own cookie jar.
  const client = () => request.agent(app).set('X-Requested-With', 'XMLHttpRequest');
  const login = (c, email, password) => c.post('/api/auth/login').send({ email, password });
  const loggedIn = async (email, password) => {
    const c = client();
    const res = await login(c, email, password);
    assert.equal(res.status, 200, `login failed for ${email}`);
    return c;
  };
  const createUser = async (adminClient, body) => {
    const res = await adminClient.post('/api/users').send(body);
    assert.equal(res.status, 201);
    return res.body;
  };
  return { db, app, seed, client, login, loggedIn, createUser };
}

// ---------------------------------------------------------------------------
// Login / session / logout
// ---------------------------------------------------------------------------
test('login succeeds, sets an httpOnly cookie and /me returns the user without secrets', async () => {
  const { client, login } = setup();
  const c = client();
  const res = await login(c, OWNER.email, OWNER.password);
  assert.equal(res.status, 200);
  assert.equal(res.body.user.email, OWNER.email);
  assert.equal(res.body.user.role, 'owner');
  assert.equal(res.body.user.passwordHash, undefined);
  assert.equal(res.body.user.password_hash, undefined);
  const cookie = res.headers['set-cookie'].join(';');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);

  const me = await c.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.name, OWNER.name);
});

test('session survives repeated requests ("refresh") and email login is case-insensitive', async () => {
  const { client, login } = setup();
  const c = client();
  assert.equal((await login(c, 'OWNER@Example.com', OWNER.password)).status, 200);
  for (let i = 0; i < 3; i++) assert.equal((await c.get('/api/auth/me')).status, 200);
});

test('wrong password and unknown email get the same generic 401', async () => {
  const { client, login } = setup();
  const wrongPw = await login(client(), OWNER.email, 'not-the-password');
  const unknown = await login(client(), 'nobody@example.com', 'whatever-123');
  assert.equal(wrongPw.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrongPw.body.error, unknown.body.error);
  assert.equal(wrongPw.headers['set-cookie'], undefined);
});

test('login with missing fields is a 400', async () => {
  const { client } = setup();
  const res = await client().post('/api/auth/login').send({ email: OWNER.email });
  assert.equal(res.status, 400);
});

test('logout ends access, and the old cookie cannot be replayed', async () => {
  const { app, client, login } = setup();
  const c = client();
  const res = await login(c, OWNER.email, OWNER.password);
  const stolenCookie = res.headers['set-cookie'][0].split(';')[0];

  assert.equal((await c.post('/api/auth/logout')).status, 204);
  assert.equal((await c.get('/api/auth/me')).status, 401);

  const replay = await request(app).get('/api/auth/me').set('Cookie', stolenCookie);
  assert.equal(replay.status, 401);
});

test('unauthenticated requests are denied on protected endpoints', async () => {
  const { client } = setup();
  const c = client();
  assert.equal((await c.get('/api/auth/me')).status, 401);
  assert.equal((await c.get('/api/users')).status, 401);
  assert.equal((await c.post('/api/users').send({})).status, 401);
  assert.equal((await c.post('/api/auth/change-password').send({})).status, 401);
});

test('state-changing requests without the CSRF header are rejected', async () => {
  const { app } = setup();
  const res = await request(app).post('/api/auth/login')
    .send({ email: OWNER.email, password: OWNER.password });
  assert.equal(res.status, 403);
});

test('malformed JSON returns 400, not a stack trace', async () => {
  const { client } = setup();
  const res = await client().post('/api/auth/login')
    .set('Content-Type', 'application/json').send('{bad json');
  assert.equal(res.status, 400);
  assert.ok(res.body.error);
});

// ---------------------------------------------------------------------------
// Create user
// ---------------------------------------------------------------------------
test('Owner creates a user and that user can log in with the generated password', async () => {
  const { client, loggedIn, login } = setup();
  const owner = await loggedIn(OWNER.email, OWNER.password);

  const created = await owner.post('/api/users')
    .send({ name: 'Mia Member', email: 'Mia@Example.com', role: 'member' });
  assert.equal(created.status, 201);
  assert.equal(created.body.user.email, 'mia@example.com');
  assert.equal(created.body.user.role, 'member');
  assert.equal(created.body.user.isActive, true);
  assert.ok(created.body.initialPassword.length >= 12);
  assert.equal(created.body.user.passwordHash, undefined);

  const res = await login(client(), 'mia@example.com', created.body.initialPassword);
  assert.equal(res.status, 200);
  assert.equal(res.body.user.role, 'member');
});

test('only a hash is stored: plaintext never appears in the database', async () => {
  const { db, loggedIn, createUser } = setup();
  const owner = await loggedIn(OWNER.email, OWNER.password);
  const { initialPassword } = await createUser(owner, { name: 'Hash Check', email: 'h@example.com', role: 'member' });

  const rows = db.prepare('SELECT * FROM users').all();
  for (const row of rows) {
    assert.match(row.password_hash, /^scrypt\$/);
    assert.ok(!JSON.stringify(row).includes(initialPassword));
    assert.ok(!JSON.stringify(row).includes(OWNER.password));
  }
});

test('Admin can create admins and members', async () => {
  const { seed, loggedIn } = setup();
  seed('Ali Admin', 'admin@example.com', 'admin', 'admin-password-1');
  const admin = await loggedIn('admin@example.com', 'admin-password-1');
  assert.equal((await admin.post('/api/users').send({ name: 'New Member', email: 'm1@example.com', role: 'member' })).status, 201);
  assert.equal((await admin.post('/api/users').send({ name: 'New Admin', email: 'a1@example.com', role: 'admin' })).status, 201);
});

test('duplicate email is rejected, case-insensitively, without changing the original user', async () => {
  const { db, loggedIn, createUser } = setup();
  const owner = await loggedIn(OWNER.email, OWNER.password);
  await createUser(owner, { name: 'First User', email: 'dup@example.com', role: 'member' });
  const before = db.prepare("SELECT password_hash FROM users WHERE email = 'dup@example.com'").get();

  const res = await owner.post('/api/users').send({ name: 'Second User', email: 'DUP@example.com', role: 'admin' });
  assert.equal(res.status, 409);
  assert.equal(res.body.initialPassword, undefined);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM users WHERE email = 'dup@example.com'").get().c, 1);
  assert.equal(db.prepare("SELECT password_hash FROM users WHERE email = 'dup@example.com'").get().password_hash, before.password_hash);
});

test('create-user validates name, email and role', async () => {
  const { loggedIn } = setup();
  const owner = await loggedIn(OWNER.email, OWNER.password);
  const bad = [
    { name: 'A', email: 'ok@example.com', role: 'member' },
    { name: 'Valid Name', email: 'not-an-email', role: 'member' },
    { name: 'Valid Name', email: 'ok@example.com', role: 'superuser' },
    { name: 'Valid Name', email: 'ok@example.com' },
  ];
  for (const body of bad) assert.equal((await owner.post('/api/users').send(body)).status, 400);
});

test('Admin cannot create an Owner', async () => {
  const { seed, loggedIn } = setup();
  seed('Ali Admin', 'admin@example.com', 'admin', 'admin-password-1');
  const admin = await loggedIn('admin@example.com', 'admin-password-1');
  const res = await admin.post('/api/users').send({ name: 'Sneaky Owner', email: 'o2@example.com', role: 'owner' });
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------------------
// Role enforcement
// ---------------------------------------------------------------------------
test('Member cannot perform any Owner/Admin action', async () => {
  const { seed, loggedIn } = setup();
  seed('Mia Member', 'member@example.com', 'member', 'member-password-1');
  seed('Target User', 'target@example.com', 'member', 'target-password-1');
  const member = await loggedIn('member@example.com', 'member-password-1');

  assert.equal((await member.get('/api/users')).status, 403);
  assert.equal((await member.post('/api/users').send({ name: 'X Y', email: 'x@example.com', role: 'member' })).status, 403);
  assert.equal((await member.post('/api/users/2/reset-password')).status, 403);
  assert.equal((await member.patch('/api/users/2/status').send({ isActive: false })).status, 403);
  assert.equal((await member.get('/api/auth/me')).status, 200); // still fine for own account
});

test('Admin cannot reset or deactivate an Owner; nobody can deactivate themselves', async () => {
  const { seed, loggedIn } = setup();
  seed('Ali Admin', 'admin@example.com', 'admin', 'admin-password-1');
  const admin = await loggedIn('admin@example.com', 'admin-password-1');
  assert.equal((await admin.post('/api/users/1/reset-password')).status, 403);
  assert.equal((await admin.patch('/api/users/1/status').send({ isActive: false })).status, 403);

  const owner = await loggedIn(OWNER.email, OWNER.password);
  assert.equal((await owner.patch('/api/users/1/status').send({ isActive: false })).status, 400);
});

test('user admin endpoints return 404 for unknown ids', async () => {
  const { loggedIn } = setup();
  const owner = await loggedIn(OWNER.email, OWNER.password);
  assert.equal((await owner.post('/api/users/999/reset-password')).status, 404);
  assert.equal((await owner.patch('/api/users/abc/status').send({ isActive: false })).status, 404);
});

// ---------------------------------------------------------------------------
// Change password
// ---------------------------------------------------------------------------
test('changing password invalidates the old password and enables the new one', async () => {
  const { seed, client, loggedIn, login } = setup();
  seed('Mia Member', 'member@example.com', 'member', 'member-password-1');
  const member = await loggedIn('member@example.com', 'member-password-1');

  const res = await member.post('/api/auth/change-password')
    .send({ currentPassword: 'member-password-1', newPassword: 'brand-new-password-2' });
  assert.equal(res.status, 204);

  assert.equal((await login(client(), 'member@example.com', 'member-password-1')).status, 401);
  assert.equal((await login(client(), 'member@example.com', 'brand-new-password-2')).status, 200);
  assert.equal((await member.get('/api/auth/me')).status, 200); // current session stays signed in
});

test('changing password signs out the other sessions of that user', async () => {
  const { seed, loggedIn } = setup();
  seed('Mia Member', 'member@example.com', 'member', 'member-password-1');
  const laptop = await loggedIn('member@example.com', 'member-password-1');
  const phone = await loggedIn('member@example.com', 'member-password-1');

  await laptop.post('/api/auth/change-password')
    .send({ currentPassword: 'member-password-1', newPassword: 'brand-new-password-2' });

  assert.equal((await laptop.get('/api/auth/me')).status, 200);
  assert.equal((await phone.get('/api/auth/me')).status, 401);
});

test('change-password rejects wrong current, weak and unchanged passwords', async () => {
  const { seed, loggedIn } = setup();
  seed('Mia Member', 'member@example.com', 'member', 'member-password-1');
  const member = await loggedIn('member@example.com', 'member-password-1');

  const wrong = await member.post('/api/auth/change-password').send({ currentPassword: 'nope-nope-1', newPassword: 'valid-new-password' });
  const weak = await member.post('/api/auth/change-password').send({ currentPassword: 'member-password-1', newPassword: 'short' });
  const same = await member.post('/api/auth/change-password').send({ currentPassword: 'member-password-1', newPassword: 'member-password-1' });
  assert.equal(wrong.status, 400);
  assert.equal(weak.status, 400);
  assert.equal(same.status, 400);

  // original password still works after the failed attempts
  const check = await member.post('/api/auth/change-password').send({ currentPassword: 'member-password-1', newPassword: 'another-valid-pass' });
  assert.equal(check.status, 204);
});

// ---------------------------------------------------------------------------
// Reset password / activate / deactivate
// ---------------------------------------------------------------------------
test('Admin reset gives a new password, kills the old one and signs the user out', async () => {
  const { seed, client, loggedIn, login } = setup();
  seed('Mia Member', 'member@example.com', 'member', 'member-password-1');
  const member = await loggedIn('member@example.com', 'member-password-1');
  const owner = await loggedIn(OWNER.email, OWNER.password);

  const res = await owner.post('/api/users/2/reset-password');
  assert.equal(res.status, 200);
  assert.ok(res.body.newPassword.length >= 12);
  assert.notEqual(res.body.newPassword, 'member-password-1');

  assert.equal((await member.get('/api/auth/me')).status, 401);
  assert.equal((await login(client(), 'member@example.com', 'member-password-1')).status, 401);
  assert.equal((await login(client(), 'member@example.com', res.body.newPassword)).status, 200);
});

test('deactivated users lose access immediately and cannot log in; reactivation restores login', async () => {
  const { seed, client, loggedIn, login } = setup();
  seed('Mia Member', 'member@example.com', 'member', 'member-password-1');
  const member = await loggedIn('member@example.com', 'member-password-1');
  const owner = await loggedIn(OWNER.email, OWNER.password);

  const off = await owner.patch('/api/users/2/status').send({ isActive: false });
  assert.equal(off.status, 200);
  assert.equal(off.body.user.isActive, false);

  assert.equal((await member.get('/api/auth/me')).status, 401); // existing session is dead
  const attempt = await login(client(), 'member@example.com', 'member-password-1');
  assert.equal(attempt.status, 403);
  assert.equal(attempt.headers['set-cookie'], undefined);

  const on = await owner.patch('/api/users/2/status').send({ isActive: true });
  assert.equal(on.body.user.isActive, true);
  assert.equal((await login(client(), 'member@example.com', 'member-password-1')).status, 200);
});

test('a deactivated user whose session row still exists is still refused', async () => {
  // Simulates a missed cleanup: is_active is flipped directly in the DB.
  const { db, seed, loggedIn } = setup();
  seed('Mia Member', 'member@example.com', 'member', 'member-password-1');
  const member = await loggedIn('member@example.com', 'member-password-1');
  db.prepare("UPDATE users SET is_active = 0 WHERE email = 'member@example.com'").run();
  assert.equal((await member.get('/api/auth/me')).status, 401);
});

test('expired sessions are refused', async () => {
  const { db, seed, loggedIn } = setup();
  seed('Mia Member', 'member@example.com', 'member', 'member-password-1');
  const member = await loggedIn('member@example.com', 'member-password-1');
  db.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() - 1000);
  assert.equal((await member.get('/api/auth/me')).status, 401);
});

test('user list never exposes password hashes', async () => {
  const { loggedIn } = setup();
  const owner = await loggedIn(OWNER.email, OWNER.password);
  const res = await owner.get('/api/users');
  assert.equal(res.status, 200);
  assert.ok(!JSON.stringify(res.body).toLowerCase().includes('scrypt'));
  assert.ok(!JSON.stringify(res.body).toLowerCase().includes('hash'));
});
