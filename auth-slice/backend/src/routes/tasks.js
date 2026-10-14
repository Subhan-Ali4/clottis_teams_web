import { Router } from 'express';
import { httpError } from '../middleware.js';

export const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const MAX_TEXT = 5000;

const isId = (v) => Number.isInteger(v) && v > 0;

function validationError(fields, message = 'Please fix the highlighted fields') {
  return httpError(400, message, { code: 'VALIDATION_ERROR', fields });
}

function isRealDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Runs fn inside one transaction: all statements succeed together or none do.
function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const TASK_SELECT = `
  SELECT t.*, p.key AS project_key, p.name AS project_name,
         s.name AS sprint_name, c.name AS column_name,
         a.name AS assignee_name, r.name AS reviewer_name, cb.name AS created_by_name
  FROM tasks t
  JOIN projects p       ON p.id = t.project_id
  JOIN board_columns c  ON c.id = t.column_id
  LEFT JOIN sprints s   ON s.id = t.sprint_id
  LEFT JOIN users a     ON a.id = t.assignee_id
  LEFT JOIN users r     ON r.id = t.reviewer_id
  LEFT JOIN users cb    ON cb.id = t.created_by`;

const ref = (id, name) => (id == null ? null : { id, name });

export function toTask(t) {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    projectId: t.project_id,
    project: { id: t.project_id, key: t.project_key, name: t.project_name },
    sprintId: t.sprint_id,
    sprint: ref(t.sprint_id, t.sprint_name),
    columnId: t.column_id,
    column: { id: t.column_id, name: t.column_name },
    position: t.position,
    priority: t.priority,
    dueDate: t.due_date,
    assigneeId: t.assignee_id,
    assignee: ref(t.assignee_id, t.assignee_name),
    reviewerId: t.reviewer_id,
    reviewer: ref(t.reviewer_id, t.reviewer_name),
    acceptanceCriteria: t.acceptance_criteria,
    version: t.version,
    createdBy: ref(t.created_by, t.created_by_name),
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Projects (read-only: the board needs their columns and sprints)
// ---------------------------------------------------------------------------
export function projectRoutes(db) {
  const r = Router();
  const projects = db.prepare('SELECT * FROM projects ORDER BY id');
  const columns = db.prepare('SELECT id, name, position FROM board_columns WHERE project_id = ? ORDER BY position');
  const sprints = db.prepare(
    'SELECT id, name, start_date AS startDate, end_date AS endDate FROM sprints WHERE project_id = ? ORDER BY id');

  r.get('/', (_req, res) => {
    res.json({
      projects: projects.all().map((p) => ({
        id: p.id, key: p.key, name: p.name,
        columns: columns.all(p.id), sprints: sprints.all(p.id),
      })),
    });
  });
  return r;
}

// Active users that can be picked as assignee / reviewer. Safe for every signed-in role:
// id, name and role only (no email or hashes).
export function directoryRoutes(db) {
  const r = Router();
  const list = db.prepare('SELECT id, name, role FROM users WHERE is_active = 1 ORDER BY name');
  r.get('/users', (_req, res) => res.json({ users: list.all() }));
  return r;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
export function taskRoutes(db) {
  const r = Router();

  const getTaskRow = db.prepare(`${TASK_SELECT} WHERE t.id = ?`);
  const getRaw = db.prepare('SELECT * FROM tasks WHERE id = ?');
  const getProject = db.prepare('SELECT id FROM projects WHERE id = ?');
  const getSprint = db.prepare('SELECT id, project_id, name FROM sprints WHERE id = ?');
  const getColumn = db.prepare('SELECT id, project_id, name FROM board_columns WHERE id = ?');
  const firstColumn = db.prepare('SELECT id FROM board_columns WHERE project_id = ? ORDER BY position LIMIT 1');
  const getUser = db.prepare('SELECT id, name, is_active FROM users WHERE id = ?');
  const countInColumn = db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE column_id = ?');
  const countOthersInColumn = db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE column_id = ? AND id != ?');

  const insertTask = db.prepare(`
    INSERT INTO tasks (project_id, sprint_id, column_id, title, description, priority, due_date,
                       assignee_id, reviewer_id, acceptance_criteria, position, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertActivity = db.prepare(`
    INSERT INTO task_activity (task_id, actor_id, type, from_column_id, to_column_id, from_position, to_position, details)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

  const loadTask = (id) => {
    const row = getTaskRow.get(id);
    return row ? toTask(row) : null;
  };

  function parseId(raw) {
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  function requireTask(req) {
    const id = parseId(req.params.id);
    const row = id ? getRaw.get(id) : null;
    if (!row) throw httpError(404, 'Task not found');
    return row;
  }

  // Stale-update protection: the client sends the version it last saw.
  function checkVersion(body, row) {
    if (!Number.isInteger(body?.version) || body.version < 1) {
      throw validationError({ version: 'version is required (send the version you last loaded)' },
        'version is required');
    }
    if (body.version !== row.version) {
      throw httpError(409, 'This task was changed by someone else. Reload it and try again.', {
        code: 'VERSION_CONFLICT',
        current: loadTask(row.id),
      });
    }
  }

  // Field validation for create and update. Returns normalised values for the fields
  // that were provided; throws a 400 with a per-field message map on any problem.
  function parseFields(body, existing) {
    const b = body ?? {};
    const has = (k) => Object.hasOwn(b, k);
    const errors = {};
    const v = {};

    const text = (key, label, { required = false, max }) => {
      if (!(required || has(key))) return;
      const raw = b[key];
      const s = raw == null ? '' : raw;
      if (typeof s !== 'string') { errors[key] = `${label} must be text`; return; }
      const t = s.trim();
      if (required && !t) errors[key] = `${label} is required`;
      else if (t.length > max) errors[key] = `${label} must be ${max} characters or fewer`;
      else v[key] = t;
    };
    text('title', 'Title', { required: !existing || has('title'), max: 200 });
    text('description', 'Description', { max: MAX_TEXT });
    text('acceptanceCriteria', 'Acceptance criteria', { max: MAX_TEXT });

    if (has('priority')) {
      if (!PRIORITIES.includes(b.priority)) errors.priority = `Priority must be one of: ${PRIORITIES.join(', ')}`;
      else v.priority = b.priority;
    }

    if (has('dueDate')) {
      if (b.dueDate === null || b.dueDate === '') v.dueDate = null;
      else if (!isRealDate(b.dueDate)) errors.dueDate = 'Due date must be a real date in YYYY-MM-DD format';
      else v.dueDate = b.dueDate;
    }

    // Project: required on create, fixed afterwards (its columns and sprints depend on it).
    let projectId = existing?.project_id;
    if (!existing) {
      if (!isId(b.projectId)) errors.projectId = 'Project is required';
      else if (!getProject.get(b.projectId)) errors.projectId = 'Project not found';
      else { v.projectId = b.projectId; projectId = b.projectId; }
    } else if (has('projectId') && b.projectId !== existing.project_id) {
      errors.projectId = 'A task cannot be moved to another project';
    }

    if (projectId) {
      if (has('sprintId')) {
        if (b.sprintId === null) v.sprintId = null;
        else if (!isId(b.sprintId)) errors.sprintId = 'Sprint is invalid';
        else {
          const s = getSprint.get(b.sprintId);
          if (!s) errors.sprintId = 'Sprint not found';
          else if (s.project_id !== projectId) errors.sprintId = 'Sprint does not belong to the selected project';
          else v.sprintId = s.id;
        }
      }
      if (has('columnId') && !(existing && b.columnId === existing.column_id)) {
        if (!isId(b.columnId)) errors.columnId = 'Board column is invalid';
        else {
          const c = getColumn.get(b.columnId);
          if (!c) errors.columnId = 'Board column not found';
          else if (c.project_id !== projectId) errors.columnId = 'Board column does not belong to the selected project';
          else v.columnId = c.id;
        }
      }
    }

    for (const [key, label, current] of [
      ['assigneeId', 'Assignee', existing?.assignee_id],
      ['reviewerId', 'Reviewer', existing?.reviewer_id],
    ]) {
      if (!has(key)) continue;
      if (b[key] === null) { v[key] = null; continue; }
      if (!isId(b[key])) { errors[key] = `${label} is invalid`; continue; }
      if (b[key] === current) { v[key] = b[key]; continue; } // unchanged: do not re-check
      const u = getUser.get(b[key]);
      if (!u) errors[key] = `${label} not found`;
      else if (!u.is_active) errors[key] = `${label} is deactivated`;
      else v[key] = u.id;
    }

    if (has('assigneeId') || has('reviewerId')) {
      const a = has('assigneeId') ? v.assigneeId : existing?.assignee_id;
      const rv = has('reviewerId') ? v.reviewerId : existing?.reviewer_id;
      if (a != null && rv != null && a === rv && !errors.reviewerId && !errors.assigneeId) {
        errors.reviewerId = 'Reviewer must be a different person from the assignee';
      }
    }

    if (Object.keys(errors).length) throw validationError(errors);
    return v;
  }

  // Moves a task to (columnId, position) keeping every column gapped-free (0..n-1).
  // `position` is the index the task should have in the target column once it has
  // left its old place. Must run inside a transaction.
  function relocate(task, columnId, position) {
    db.prepare('UPDATE tasks SET column_id = ?, position = -1 WHERE id = ?').run(columnId, task.id);
    db.prepare('UPDATE tasks SET position = position - 1 WHERE column_id = ? AND position > ?')
      .run(task.column_id, task.position);
    db.prepare('UPDATE tasks SET position = position + 1 WHERE column_id = ? AND position >= ?')
      .run(columnId, position);
    db.prepare('UPDATE tasks SET position = ? WHERE id = ?').run(position, task.id);
  }

  // ----- list ---------------------------------------------------------------
  r.get('/', (req, res) => {
    const where = [];
    const params = [];
    const intFilter = (key, column) => {
      if (req.query[key] === undefined) return;
      const id = parseId(req.query[key]);
      if (!id) throw httpError(400, `Invalid ${key}`);
      where.push(`${column} = ?`);
      params.push(id);
    };
    intFilter('projectId', 't.project_id');
    intFilter('columnId', 't.column_id');
    intFilter('assigneeId', 't.assignee_id');
    if (req.query.sprintId === 'none') where.push('t.sprint_id IS NULL');
    else intFilter('sprintId', 't.sprint_id');
    if (req.query.priority !== undefined) {
      if (!PRIORITIES.includes(req.query.priority)) throw httpError(400, 'Invalid priority');
      where.push('t.priority = ?');
      params.push(req.query.priority);
    }
    const sql = `${TASK_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY t.project_id, c.position, t.position, t.id`;
    res.json({ tasks: db.prepare(sql).all(...params).map(toTask) });
  });

  // ----- detail (with activity) --------------------------------------------
  r.get('/:id', (req, res) => {
    const row = requireTask(req);
    const activity = db.prepare(`
      SELECT a.*, u.name AS actor_name, fc.name AS from_column_name, tc.name AS to_column_name
      FROM task_activity a
      JOIN users u ON u.id = a.actor_id
      LEFT JOIN board_columns fc ON fc.id = a.from_column_id
      LEFT JOIN board_columns tc ON tc.id = a.to_column_id
      WHERE a.task_id = ? ORDER BY a.id`).all(row.id).map((a) => ({
      id: a.id,
      type: a.type,
      actor: { id: a.actor_id, name: a.actor_name },
      fromColumn: ref(a.from_column_id, a.from_column_name),
      toColumn: ref(a.to_column_id, a.to_column_name),
      fromPosition: a.from_position,
      toPosition: a.to_position,
      details: a.details ? JSON.parse(a.details) : null,
      createdAt: a.created_at,
    }));
    res.json({ task: loadTask(row.id), activity });
  });

  // ----- create -------------------------------------------------------------
  r.post('/', (req, res) => {
    const v = parseFields(req.body, null);
    const id = tx(db, () => {
      const columnId = v.columnId ?? firstColumn.get(v.projectId)?.id;
      if (!columnId) throw validationError({ projectId: 'This project has no board columns' });
      const position = countInColumn.get(columnId).n; // append to the bottom
      const info = insertTask.run(
        v.projectId, v.sprintId ?? null, columnId, v.title, v.description ?? '',
        v.priority ?? 'medium', v.dueDate ?? null, v.assigneeId ?? null, v.reviewerId ?? null,
        v.acceptanceCriteria ?? '', position, req.user.id);
      const taskId = Number(info.lastInsertRowid);
      insertActivity.run(taskId, req.user.id, 'created', null, columnId, null, position, null);
      return taskId;
    });
    res.status(201).json({ task: loadTask(id) });
  });

  // ----- update -------------------------------------------------------------
  r.patch('/:id', (req, res) => {
    const row = requireTask(req);
    checkVersion(req.body, row);
    const v = parseFields(req.body, row);

    const label = {
      title: ['title', row.title], description: ['description', row.description],
      priority: ['priority', row.priority], dueDate: ['due_date', row.due_date],
      acceptanceCriteria: ['acceptance_criteria', row.acceptance_criteria],
      sprintId: ['sprint_id', row.sprint_id], assigneeId: ['assignee_id', row.assignee_id],
      reviewerId: ['reviewer_id', row.reviewer_id],
    };
    const changes = {};
    const sets = {};
    for (const [key, [col, oldVal]] of Object.entries(label)) {
      if (Object.hasOwn(v, key) && v[key] !== oldVal) {
        sets[col] = v[key];
        changes[key] = { from: oldVal, to: v[key] };
      }
    }
    // Show names instead of bare ids in the activity entry.
    const nameOf = (table, id) => (id == null ? null : db.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(id)?.name ?? id);
    for (const key of ['assigneeId', 'reviewerId']) {
      if (changes[key]) changes[key] = { from: nameOf('users', changes[key].from), to: nameOf('users', changes[key].to) };
    }
    if (changes.sprintId) changes.sprintId = { from: nameOf('sprints', changes.sprintId.from), to: nameOf('sprints', changes.sprintId.to) };

    const moving = v.columnId !== undefined && v.columnId !== row.column_id;
    if (!Object.keys(sets).length && !moving) {
      return res.json({ task: loadTask(row.id) }); // nothing changed: no new version, no activity
    }

    tx(db, () => {
      const cols = Object.keys(sets);
      const result = db.prepare(
        `UPDATE tasks SET ${cols.map((c) => `${c} = ?`).concat(["version = version + 1", "updated_at = datetime('now')"]).join(', ')}
         WHERE id = ? AND version = ?`).run(...cols.map((c) => sets[c]), row.id, row.version);
      if (result.changes !== 1) {
        throw httpError(409, 'This task was changed by someone else. Reload it and try again.',
          { code: 'VERSION_CONFLICT', current: loadTask(row.id) });
      }
      if (Object.keys(changes).length) {
        insertActivity.run(row.id, req.user.id, 'updated', null, null, null, null, JSON.stringify({ changes }));
      }
      if (moving) {
        const toPos = countOthersInColumn.get(v.columnId, row.id).n; // to the bottom of the new column
        relocate(row, v.columnId, toPos);
        insertActivity.run(row.id, req.user.id, 'moved', row.column_id, v.columnId, row.position, toPos, null);
      }
    });
    res.json({ task: loadTask(row.id) });
  });

  // ----- move (drag and drop) ----------------------------------------------
  r.post('/:id/move', (req, res) => {
    const row = requireTask(req);
    checkVersion(req.body, row);

    const { columnId, position } = req.body ?? {};
    const errors = {};
    const target = isId(columnId) ? getColumn.get(columnId) : null;
    if (!target) errors.columnId = 'Board column not found';
    else if (target.project_id !== row.project_id) errors.columnId = 'Board column does not belong to this task\'s project';
    let others = 0;
    if (target && !errors.columnId) others = countOthersInColumn.get(target.id, row.id).n;
    if (!Number.isInteger(position) || position < 0 || position > others) {
      errors.position = target && !errors.columnId
        ? `Position must be a whole number from 0 to ${others}`
        : 'Position must be a whole number of 0 or more';
    }
    if (Object.keys(errors).length) throw validationError(errors);

    if (target.id === row.column_id && position === row.position) {
      return res.json({ task: loadTask(row.id) }); // dropped where it already was
    }

    tx(db, () => {
      const result = db.prepare(
        "UPDATE tasks SET version = version + 1, updated_at = datetime('now') WHERE id = ? AND version = ?")
        .run(row.id, row.version);
      if (result.changes !== 1) {
        throw httpError(409, 'This task was changed by someone else. Reload it and try again.',
          { code: 'VERSION_CONFLICT', current: loadTask(row.id) });
      }
      relocate(row, target.id, position);
      insertActivity.run(row.id, req.user.id, 'moved', row.column_id, target.id, row.position, position, null);
    });
    res.json({ task: loadTask(row.id) });
  });

  return r;
}
