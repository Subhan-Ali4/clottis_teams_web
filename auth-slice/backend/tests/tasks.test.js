import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/security.js';
import { DEMO_PASSWORD, DEMO_USERS } from '../src/migrations.js';

const PW = 'test-password-1';

function setup() {
  const db = openDb(':memory:', { seedDemo: false });
  const app = createApp(db);
  const user = (name, email, role = 'member') =>
    Number(db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)')
      .run(name, email, hashPassword(PW), role).lastInsertRowid);
  const owner = user('Olivia Owner', 'owner@example.com', 'owner');
  const aisha = user('Aisha', 'aisha@example.com');
  const bilal = user('Bilal', 'bilal@example.com');
  const sara = user('Sara', 'sara@example.com');

  const project = (key) => {
    const pid = Number(db.prepare('INSERT INTO projects (key, name) VALUES (?, ?)').run(key, `Project ${key}`).lastInsertRowid);
    const sprint = Number(db.prepare('INSERT INTO sprints (project_id, name) VALUES (?, ?)').run(pid, `${key} Sprint`).lastInsertRowid);
    const cols = ['To Do', 'Doing', 'Done'].map((n, i) =>
      Number(db.prepare('INSERT INTO board_columns (project_id, name, position) VALUES (?,?,?)').run(pid, n, i).lastInsertRowid));
    return { pid, sprint, todo: cols[0], doing: cols[1], done: cols[2] };
  };
  const A = project('AAA');
  const B = project('BBB');

  const loggedIn = async (email) => {
    const c = request.agent(app).set('X-Requested-With', 'XMLHttpRequest');
    const res = await c.post('/api/auth/login').send({ email, password: PW });
    assert.equal(res.status, 200);
    return c;
  };
  return { db, app, ids: { owner, aisha, bilal, sara }, A, B, loggedIn };
}

const base = (A, extra = {}) => ({ title: 'Write docs', projectId: A.pid, ...extra });

async function makeTask(c, A, extra = {}) {
  const res = await c.post('/api/tasks').send(base(A, extra));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.task;
}

// ---------------------------------------------------------------------------
// Migration and demo seed
// ---------------------------------------------------------------------------
test('migration seeds demo users, project data and sample tasks; demo users can log in', async () => {
  const db = openDb(':memory:', { seedDemo: true });
  const app = createApp(db);
  const emails = db.prepare('SELECT email FROM users').all().map((r) => r.email);
  for (const u of DEMO_USERS) assert.ok(emails.includes(u.email), `${u.email} seeded`);
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM projects').get().n >= 2);
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n >= 1);

  // Only a hash is stored for demo users too.
  const row = db.prepare('SELECT password_hash FROM users WHERE email = ?').get(DEMO_USERS[1].email);
  assert.ok(row.password_hash.startsWith('scrypt$'));
  assert.ok(!row.password_hash.includes(DEMO_PASSWORD));

  const c = request.agent(app).set('X-Requested-With', 'XMLHttpRequest');
  const res = await c.post('/api/auth/login').send({ email: DEMO_USERS[1].email, password: DEMO_PASSWORD });
  assert.equal(res.status, 200);
  const list = await c.get('/api/tasks');
  assert.equal(list.status, 200);
  assert.ok(list.body.tasks.length >= 1);
});

test('migrations run once: reopening the same database does not duplicate anything', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mig-')), 'db.sqlite');
  openDb(file, { seedDemo: true }).close();
  const db = openDb(file, { seedDemo: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, DEMO_USERS.length);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 3);
});

test('with seedDemo off there are no demo users, and the demo migration can still run later', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mig-')), 'db.sqlite');
  const first = openDb(file, { seedDemo: false });
  assert.equal(first.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
  assert.ok(first.prepare('SELECT 1 FROM sqlite_master WHERE name = ?').get('tasks'), 'tasks table exists');
  first.close();
  const second = openDb(file, { seedDemo: true });
  assert.equal(second.prepare('SELECT COUNT(*) AS n FROM users').get().n, DEMO_USERS.length);
});

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------
test('task endpoints need a signed-in user; writes need the request header', async () => {
  const { app, A, loggedIn } = setup();
  const anon = request(app);
  assert.equal((await anon.get('/api/tasks')).status, 401);
  assert.equal((await anon.get('/api/projects')).status, 401);
  assert.equal((await anon.get('/api/directory/users')).status, 401);
  assert.equal((await anon.post('/api/tasks').set('X-Requested-With', 'XMLHttpRequest').send(base(A))).status, 401);

  const c = await loggedIn('aisha@example.com');
  const noHeader = await request.agent(app).post('/api/tasks').send(base(A));
  assert.equal(noHeader.status, 403);
  assert.equal((await c.get('/api/tasks')).status, 200);
});

test('directory lists active users with only id, name and role', async () => {
  const { db, ids, loggedIn } = setup();
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(ids.sara);
  const c = await loggedIn('aisha@example.com');
  const res = await c.get('/api/directory/users');
  assert.equal(res.status, 200);
  const names = res.body.users.map((u) => u.name);
  assert.ok(names.includes('Bilal'));
  assert.ok(!names.includes('Sara'), 'deactivated users are not offered');
  assert.deepEqual(Object.keys(res.body.users[0]).sort(), ['id', 'name', 'role']);
});

test('projects endpoint returns columns in order and sprints', async () => {
  const { A, loggedIn } = setup();
  const c = await loggedIn('aisha@example.com');
  const res = await c.get('/api/projects');
  const p = res.body.projects.find((x) => x.id === A.pid);
  assert.deepEqual(p.columns.map((x) => x.name), ['To Do', 'Doing', 'Done']);
  assert.equal(p.sprints.length, 1);
});

// ---------------------------------------------------------------------------
// Create / detail / list
// ---------------------------------------------------------------------------
test('create stores every field, defaults to the first column and writes a "created" activity', async () => {
  const { A, ids, loggedIn } = setup();
  const c = await loggedIn('aisha@example.com');
  const res = await c.post('/api/tasks').send({
    title: '  Build board  ', description: 'Kanban', projectId: A.pid, sprintId: A.sprint,
    priority: 'high', dueDate: '2026-10-20', assigneeId: ids.bilal, reviewerId: ids.sara,
    acceptanceCriteria: 'Cards can be dragged',
  });
  assert.equal(res.status, 201);
  const t = res.body.task;
  assert.equal(t.title, 'Build board');
  assert.equal(t.columnId, A.todo);
  assert.equal(t.position, 0);
  assert.equal(t.version, 1);
  assert.equal(t.priority, 'high');
  assert.equal(t.dueDate, '2026-10-20');
  assert.equal(t.assignee.name, 'Bilal');
  assert.equal(t.reviewer.name, 'Sara');
  assert.equal(t.sprint.name, 'AAA Sprint');
  assert.equal(t.createdBy.name, 'Aisha');

  const detail = await c.get(`/api/tasks/${t.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.activity.length, 1);
  assert.equal(detail.body.activity[0].type, 'created');
  assert.equal(detail.body.activity[0].actor.name, 'Aisha');
});

test('optional fields default sensibly and new tasks go to the bottom of the column', async () => {
  const { A, loggedIn } = setup();
  const c = await loggedIn('aisha@example.com');
  const t1 = await makeTask(c, A, { title: 'one' });
  const t2 = await makeTask(c, A, { title: 'two' });
  assert.equal(t1.priority, 'medium');
  assert.equal(t1.assigneeId, null);
  assert.equal(t1.dueDate, null);
  assert.equal(t1.sprintId, null);
  assert.deepEqual([t1.position, t2.position], [0, 1]);
});

test('invalid input is rejected with a message per field', async () => {
  const { A, loggedIn } = setup();
  const c = await loggedIn('aisha@example.com');
  const cases = [
    [{ title: '   ' }, 'title'],
    [{ title: 'x'.repeat(201) }, 'title'],
    [{ priority: 'critical' }, 'priority'],
    [{ dueDate: '2026-02-31' }, 'dueDate'],
    [{ dueDate: '20/10/2026' }, 'dueDate'],
    [{ description: 'x'.repeat(5001) }, 'description'],
  ];
  for (const [extra, field] of cases) {
    const res = await c.post('/api/tasks').send(base(A, extra));
    assert.equal(res.status, 400, field);
    assert.equal(res.body.code, 'VALIDATION_ERROR');
    assert.ok(res.body.fields[field], `message for ${field}`);
  }
  const noProject = await c.post('/api/tasks').send({ title: 'x' });
  assert.equal(noProject.status, 400);
  assert.ok(noProject.body.fields.projectId);
});

test('invalid relationships are rejected: wrong-project sprint/column, unknown or deactivated users, same reviewer', async () => {
  const { db, ids, A, B, loggedIn } = setup();
  const c = await loggedIn('aisha@example.com');
  const post = (extra) => c.post('/api/tasks').send(base(A, extra));

  let res = await post({ sprintId: B.sprint });
  assert.equal(res.status, 400);
  assert.match(res.body.fields.sprintId, /does not belong/);

  res = await post({ columnId: B.todo });
  assert.equal(res.status, 400);
  assert.match(res.body.fields.columnId, /does not belong/);

  res = await post({ sprintId: 9999 });
  assert.match(res.body.fields.sprintId, /not found/);

  res = await post({ assigneeId: 9999 });
  assert.match(res.body.fields.assigneeId, /not found/);

  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(ids.sara);
  res = await post({ reviewerId: ids.sara });
  assert.match(res.body.fields.reviewerId, /deactivated/);

  res = await post({ assigneeId: ids.bilal, reviewerId: ids.bilal });
  assert.match(res.body.fields.reviewerId, /different person/);

  res = await c.post('/api/tasks').send({ title: 'x', projectId: 9999 });
  assert.match(res.body.fields.projectId, /not found/);

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n, 0, 'nothing was saved');
});

test('list supports filters and returns tasks in column then position order', async () => {
  const { ids, A, B, loggedIn } = setup();
  const c = await loggedIn('aisha@example.com');
  await makeTask(c, A, { title: 'a1', assigneeId: ids.bilal, priority: 'high', sprintId: A.sprint });
  await makeTask(c, A, { title: 'a2', columnId: A.doing });
  await makeTask(c, A, { title: 'a3' });
  await makeTask(c, B, { title: 'b1' });

  const all = await c.get('/api/tasks');
  assert.equal(all.body.tasks.length, 4);
  const inA = await c.get(`/api/tasks?projectId=${A.pid}`);
  assert.deepEqual(inA.body.tasks.map((t) => t.title), ['a1', 'a3', 'a2']); // To Do first, then Doing
  assert.equal((await c.get(`/api/tasks?assigneeId=${ids.bilal}`)).body.tasks.length, 1);
  assert.equal((await c.get('/api/tasks?priority=high')).body.tasks.length, 1);
  assert.equal((await c.get(`/api/tasks?sprintId=${A.sprint}`)).body.tasks.length, 1);
  assert.equal((await c.get('/api/tasks?sprintId=none')).body.tasks.length, 3);
  assert.equal((await c.get(`/api/tasks?columnId=${A.doing}`)).body.tasks.length, 1);
  assert.equal((await c.get('/api/tasks?projectId=abc')).status, 400);
  assert.equal((await c.get('/api/tasks?priority=nope')).status, 400);
});

test('detail of a missing task is a 404', async () => {
  const { loggedIn } = setup();
  const c = await loggedIn('aisha@example.com');
  assert.equal((await c.get('/api/tasks/9999')).status, 404);
  assert.equal((await c.get('/api/tasks/abc')).status, 404);
});

// ---------------------------------------------------------------------------
// Update and stale-update protection
// ---------------------------------------------------------------------------
test('update changes only the sent fields, bumps the version and records what changed', async () => {
  const { ids, A, loggedIn } = setup();
  const c = await loggedIn('aisha@example.com');
  const t = await makeTask(c, A, { description: 'keep me' });
  const res = await c.patch(`/api/tasks/${t.id}`).send({
    version: t.version, title: 'New title', priority: 'urgent', assigneeId: ids.bilal,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.task.title, 'New title');
  assert.equal(res.body.task.description, 'keep me');
  assert.equal(res.body.task.priority, 'urgent');
  assert.equal(res.body.task.assignee.name, 'Bilal');
  assert.equal(res.body.task.version, 2);

  const detail = await c.get(`/api/tasks/${t.id}`);
  const upd = detail.body.activity.find((a) => a.type === 'updated');
  assert.deepEqual(upd.details.changes.title, { from: 'Write docs', to: 'New title' });
  assert.deepEqual(upd.details.changes.assigneeId, { from: null, to: 'Bilal' });
});

test('an update that changes nothing keeps the version and adds no activity', async () => {
  const { A, loggedIn } = setup();
  const c = await loggedIn('aisha@example.com');
  const t = await makeTask(c, A);
  const res = await c.patch(`/api/tasks/${t.id}`).send({ version: t.version, title: t.title });
  assert.equal(res.status, 200);
  assert.equal(res.body.task.version, 1);
  assert.equal((await c.get(`/api/tasks/${t.id}`)).body.activity.length, 1);
});

test('stale update returns 409 VERSION_CONFLICT with the current task, and changes nothing', async () => {
  const { A, loggedIn } = setup();
  const alice = await loggedIn('aisha@example.com');
  const bob = await loggedIn('bilal@example.com');
  const t = await makeTask(alice, A);

  const first = await alice.patch(`/api/tasks/${t.id}`).send({ version: 1, title: 'Alice was first' });
  assert.equal(first.status, 200);

  const stale = await bob.patch(`/api/tasks/${t.id}`).send({ version: 1, title: 'Bob is late' });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'VERSION_CONFLICT');
  assert.equal(stale.body.current.title, 'Alice was first');
  assert.equal(stale.body.current.version, 2);

  const after = await bob.get(`/api/tasks/${t.id}`);
  assert.equal(after.body.task.title, 'Alice was first');

  // Retrying with the version from the conflict response works.
  const retry = await bob.patch(`/api/tasks/${t.id}`).send({ version: stale.body.current.version, title: 'Bob, retried' });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.task.version, 3);
});

test('update needs a version, a real task, and valid relationships', async () => {
  const { ids, A, B, loggedIn } = setup();
  const c = await loggedIn('aisha@example.com');
  const t = await makeTask(c, A, { assigneeId: ids.bilal });

  assert.equal((await c.patch(`/api/tasks/${t.id}`).send({ title: 'x' })).status, 400);
  assert.equal((await c.patch('/api/tasks/9999').send({ version: 1, title: 'x' })).status, 404);

  let res = await c.patch(`/api/tasks/${t.id}`).send({ version: 1, sprintId: B.sprint });
  assert.equal(res.status, 400);
  assert.ok(res.body.fields.sprintId);

  res = await c.patch(`/api/tasks/${t.id}`).send({ version: 1, projectId: B.pid });
  assert.equal(res.status, 400);
  assert.match(res.body.fields.projectId, /another project/);

  res = await c.patch(`/api/tasks/${t.id}`).send({ version: 1, reviewerId: ids.bilal });
  assert.match(res.body.fields.reviewerId, /different person/);

  res = await c.patch(`/api/tasks/${t.id}`).send({ version: 1, title: '' });
  assert.ok(res.body.fields.title);

  const unchanged = await c.get(`/api/tasks/${t.id}`);
  assert.equal(unchanged.body.task.version, 1);
});

test('clearing optional fields with null works', async () => {
  const { ids, A, loggedIn } = setup();
  const c = await loggedIn('aisha@example.com');
  const t = await makeTask(c, A, { assigneeId: ids.bilal, dueDate: '2026-10-20', sprintId: A.sprint });
  const res = await c.patch(`/api/tasks/${t.id}`).send({ version: 1, assigneeId: null, dueDate: null, sprintId: null });
  assert.equal(res.status, 200);
  assert.equal(res.body.task.assigneeId, null);
  assert.equal(res.body.task.dueDate, null);
  assert.equal(res.body.task.sprintId, null);
});

test('changing the board column in an edit moves the task to the bottom of that column', async () => {
  const { A, loggedIn } = setup();
  const c = await loggedIn('aisha@example.com');
  await makeTask(c, A, { title: 'already doing', columnId: A.doing });
  const t = await makeTask(c, A, { title: 'to move' });
  const res = await c.patch(`/api/tasks/${t.id}`).send({ version: 1, columnId: A.doing });
  assert.equal(res.status, 200);
  assert.equal(res.body.task.columnId, A.doing);
  assert.equal(res.body.task.position, 1);
  const detail = await c.get(`/api/tasks/${t.id}`);
  assert.ok(detail.body.activity.some((a) => a.type === 'moved'));
});

// ---------------------------------------------------------------------------
// Movement and ordering
// ---------------------------------------------------------------------------
async function titles(c, columnId) {
  const res = await c.get(`/api/tasks?columnId=${columnId}`);
  return res.body.tasks.map((t) => `${t.position}:${t.title}`);
}

test('moving across columns re-orders both columns without gaps, and the order survives a refresh', async () => {
  const { A, loggedIn } = setup();
  const c = await loggedIn('aisha@example.com');
  const a = await makeTask(c, A, { title: 'a' });
  const b = await makeTask(c, A, { title: 'b' });
  const d = await makeTask(c, A, { title: 'd' });
  const x = await makeTask(c, A, { title: 'x', columnId: A.doing });
  const y = await makeTask(c, A, { title: 'y', columnId: A.doing });

  // b -> Doing, between x and y
  const res = await c.post(`/api/tasks/${b.id}/move`).send({ columnId: A.doing, position: 1, version: b.version });
  assert.equal(res.status, 200);
  assert.equal(res.body.task.columnId, A.doing);
  assert.equal(res.body.task.position, 1);
  assert.equal(res.body.task.version, 2);

  // "refresh": a brand-new client reads the board from the database
  const fresh = await loggedIn('bilal@example.com');
  assert.deepEqual(await titles(fresh, A.todo), ['0:a', '1:d']);
  assert.deepEqual(await titles(fresh, A.doing), ['0:x', '1:b', '2:y']);
  void a; void d; void x; void y;
});

test('moving inside one column re-orders it (down and up)', async () => {
  const { A, loggedIn } = setup();
  const c = await loggedIn('aisha@example.com');
  const t = {};
  for (const n of ['a', 'b', 'c', 'd']) t[n] = await makeTask(c, A, { title: n });

  let res = await c.post(`/api/tasks/${t.a.id}/move`).send({ columnId: A.todo, position: 2, version: 1 });
  assert.equal(res.status, 200);
  assert.deepEqual(await titles(c, A.todo), ['0:b', '1:c', '2:a', '3:d']);

  res = await c.post(`/api/tasks/${t.d.id}/move`).send({ columnId: A.todo, position: 0, version: 1 });
  assert.equal(res.status, 200);
  assert.deepEqual(await titles(c, A.todo), ['0:d', '1:b', '2:c', '3:a']);
});

test('a move to the bottom of an empty or non-empty column works at the boundary', async () => {
  const { A, loggedIn } = setup();
  const c = await loggedIn('aisha@example.com');
  const a = await makeTask(c, A, { title: 'a' });
  const b = await makeTask(c, A, { title: 'b' });
  let res = await c.post(`/api/tasks/${a.id}/move`).send({ columnId: A.done, position: 0, version: 1 });
  assert.equal(res.status, 200);
  res = await c.post(`/api/tasks/${b.id}/move`).send({ columnId: A.done, position: 1, version: 1 });
  assert.equal(res.status, 200);
  assert.deepEqual(await titles(c, A.done), ['0:a', '1:b']);
  assert.deepEqual(await titles(c, A.todo), []);
});

test('a move writes a "moved" activity entry with from/to column and position', async () => {
  const { A, loggedIn } = setup();
  const c = await loggedIn('bilal@example.com');
  const t = await makeTask(c, A);
  await c.post(`/api/tasks/${t.id}/move`).send({ columnId: A.doing, position: 0, version: 1 });
  const detail = await c.get(`/api/tasks/${t.id}`);
  const moved = detail.body.activity.find((a) => a.type === 'moved');
  assert.equal(moved.actor.name, 'Bilal');
  assert.equal(moved.fromColumn.name, 'To Do');
  assert.equal(moved.toColumn.name, 'Doing');
  assert.equal(moved.fromPosition, 0);
  assert.equal(moved.toPosition, 0);
});

test('moves are validated: other project\'s column, unknown column, bad position, missing version', async () => {
  const { db, A, B, loggedIn } = setup();
  const c = await loggedIn('aisha@example.com');
  const t = await makeTask(c, A);
  const move = (body) => c.post(`/api/tasks/${t.id}/move`).send({ version: 1, ...body });

  let res = await move({ columnId: B.todo, position: 0 });
  assert.equal(res.status, 400);
  assert.match(res.body.fields.columnId, /does not belong/);

  res = await move({ columnId: 9999, position: 0 });
  assert.match(res.body.fields.columnId, /not found/);

  for (const position of [-1, 1.5, '0', null, 5]) {
    res = await move({ columnId: A.doing, position });
    assert.equal(res.status, 400, `position ${position}`);
    assert.ok(res.body.fields.position);
  }

  res = await c.post(`/api/tasks/${t.id}/move`).send({ columnId: A.doing, position: 0 });
  assert.equal(res.status, 400);
  assert.equal((await c.post('/api/tasks/9999/move').send({ columnId: A.doing, position: 0, version: 1 })).status, 404);

  const row = db.prepare('SELECT column_id, position, version FROM tasks WHERE id = ?').get(t.id);
  assert.deepEqual({ ...row }, { column_id: A.todo, position: 0, version: 1 }, 'task untouched');
});

test('moving a stale card returns 409 and leaves the board unchanged', async () => {
  const { A, loggedIn } = setup();
  const alice = await loggedIn('aisha@example.com');
  const bob = await loggedIn('bilal@example.com');
  const t = await makeTask(alice, A);
  await alice.patch(`/api/tasks/${t.id}`).send({ version: 1, title: 'edited' }); // version is now 2

  const res = await bob.post(`/api/tasks/${t.id}/move`).send({ columnId: A.doing, position: 0, version: 1 });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'VERSION_CONFLICT');
  assert.equal(res.body.current.columnId, A.todo);
  assert.deepEqual(await titles(bob, A.todo), ['0:edited']);
});

test('dropping a card where it already is does nothing (no new version, no activity)', async () => {
  const { A, loggedIn } = setup();
  const c = await loggedIn('aisha@example.com');
  const t = await makeTask(c, A);
  const res = await c.post(`/api/tasks/${t.id}/move`).send({ columnId: A.todo, position: 0, version: 1 });
  assert.equal(res.status, 200);
  assert.equal(res.body.task.version, 1);
  assert.equal((await c.get(`/api/tasks/${t.id}`)).body.activity.length, 1);
});
