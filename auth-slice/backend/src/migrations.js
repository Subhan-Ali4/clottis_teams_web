import { hashPassword } from './security.js';

// Password for every DEMO user created by migration 003. Demo data only:
// set SEED_DEMO_DATA=false before the first start to skip it.
export const DEMO_PASSWORD = 'DemoPass#2026';

export const DEMO_USERS = [
  { name: 'Demo Admin', email: 'admin.demo@example.com', role: 'admin' },
  { name: 'Aisha Khan', email: 'aisha.demo@example.com', role: 'member' },
  { name: 'Bilal Ahmed', email: 'bilal.demo@example.com', role: 'member' },
  { name: 'Sara Malik', email: 'sara.demo@example.com', role: 'member' },
];

// Each migration runs once, in order, and is recorded in schema_migrations.
// Add new schema changes as a NEW entry at the end; never edit an applied one.
export const migrations = [
  {
    name: '001_auth_baseline',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          name          TEXT    NOT NULL,
          email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
          password_hash TEXT    NOT NULL,
          role          TEXT    NOT NULL CHECK (role IN ('owner','admin','member')),
          is_active     INTEGER NOT NULL DEFAULT 1,
          created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
          updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        -- Only a SHA-256 of the session token is stored, never the token itself.
        CREATE TABLE IF NOT EXISTS sessions (
          id         TEXT    PRIMARY KEY,
          user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TEXT    NOT NULL DEFAULT (datetime('now')),
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      `);
    },
  },

  {
    name: '002_tasks_schema',
    up(db) {
      db.exec(`
        CREATE TABLE projects (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          key        TEXT NOT NULL UNIQUE COLLATE NOCASE,
          name       TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE sprints (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name       TEXT NOT NULL,
          start_date TEXT,
          end_date   TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_sprints_project ON sprints(project_id);

        -- Board columns belong to one project, so a task can never sit in another project's column.
        CREATE TABLE board_columns (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name       TEXT NOT NULL,
          position   INTEGER NOT NULL,
          UNIQUE (project_id, position)
        );

        CREATE TABLE tasks (
          id                  INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id          INTEGER NOT NULL REFERENCES projects(id),
          sprint_id           INTEGER REFERENCES sprints(id),
          column_id           INTEGER NOT NULL REFERENCES board_columns(id),
          title               TEXT NOT NULL,
          description         TEXT NOT NULL DEFAULT '',
          priority            TEXT NOT NULL DEFAULT 'medium'
                                CHECK (priority IN ('low','medium','high','urgent')),
          due_date            TEXT,
          assignee_id         INTEGER REFERENCES users(id),
          reviewer_id         INTEGER REFERENCES users(id),
          acceptance_criteria TEXT NOT NULL DEFAULT '',
          -- Order inside a column: 0..n-1 with no gaps. Stored, so it survives a refresh.
          position            INTEGER NOT NULL,
          -- Optimistic locking: bumped on every update or move of this task.
          version             INTEGER NOT NULL DEFAULT 1,
          created_by          INTEGER NOT NULL REFERENCES users(id),
          created_at          TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_tasks_column ON tasks(column_id, position);
        CREATE INDEX idx_tasks_project ON tasks(project_id);

        CREATE TABLE task_activity (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id        INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          actor_id       INTEGER NOT NULL REFERENCES users(id),
          type           TEXT NOT NULL CHECK (type IN ('created','updated','moved')),
          from_column_id INTEGER REFERENCES board_columns(id),
          to_column_id   INTEGER REFERENCES board_columns(id),
          from_position  INTEGER,
          to_position    INTEGER,
          details        TEXT,
          created_at     TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_activity_task ON task_activity(task_id, id);
      `);
    },
  },

  {
    // Demo users (for assignee / reviewer), two projects with sprints and board
    // columns, and a few sample tasks. Skipped when SEED_DEMO_DATA=false.
    name: '003_seed_demo_data',
    demoOnly: true,
    up(db) {
      const insertUser = db.prepare(
        'INSERT OR IGNORE INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)');
      for (const u of DEMO_USERS) {
        insertUser.run(u.name, u.email, hashPassword(DEMO_PASSWORD), u.role);
      }
      const uid = (email) => db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;
      const aisha = uid('aisha.demo@example.com');
      const bilal = uid('bilal.demo@example.com');
      const sara = uid('sara.demo@example.com');
      const admin = uid('admin.demo@example.com');

      const addProject = db.prepare('INSERT INTO projects (key, name) VALUES (?, ?)');
      const addSprint = db.prepare(
        'INSERT INTO sprints (project_id, name, start_date, end_date) VALUES (?, ?, ?, ?)');
      const addColumn = db.prepare(
        'INSERT INTO board_columns (project_id, name, position) VALUES (?, ?, ?)');
      const COLUMNS = ['To Do', 'In Progress', 'In Review', 'Done'];

      const makeProject = (key, name, sprints) => {
        const pid = Number(addProject.run(key, name).lastInsertRowid);
        const sprintIds = sprints.map(([n, s, e]) => Number(addSprint.run(pid, n, s, e).lastInsertRowid));
        const columnIds = COLUMNS.map((c, i) => Number(addColumn.run(pid, c, i).lastInsertRowid));
        return { pid, sprintIds, columnIds };
      };

      const web = makeProject('WEB', 'Clottis Web Platform', [
        ['Sprint 1', '2026-10-05', '2026-10-18'],
        ['Sprint 2', '2026-10-19', '2026-11-01'],
      ]);
      makeProject('OPS', 'Operations Tooling', [['Ops Sprint 1', '2026-10-05', '2026-10-18']]);

      const addTask = db.prepare(`
        INSERT INTO tasks (project_id, sprint_id, column_id, title, description, priority, due_date,
                           assignee_id, reviewer_id, acceptance_criteria, position, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const addActivity = db.prepare(
        "INSERT INTO task_activity (task_id, actor_id, type, to_column_id, to_position) VALUES (?, ?, 'created', ?, ?)");

      const [todo, doing, review, done] = web.columnIds;
      const samples = [
        [todo, 0, 'Design task board layout', 'Sketch the Kanban columns and card layout.', 'medium', '2026-10-16', aisha, sara,
          'Layout approved by sir.'],
        [todo, 1, 'Write API contract notes', 'Document request and response shapes.', 'low', '2026-10-17', bilal, aisha,
          'Contract is in the README.'],
        [doing, 0, 'Build task movement endpoint', 'Validate column and position, record activity.', 'high', '2026-10-14', bilal, sara,
          'Moving a card persists after refresh.'],
        [review, 0, 'Add priority badges', 'Show priority colour on every card.', 'low', '2026-10-15', aisha, bilal,
          'Badge visible on all cards.'],
        [done, 0, 'Set up project repository', 'Create the repo and CI skeleton.', 'medium', '2026-10-10', sara, admin,
          'Repository exists with a README.'],
      ];
      for (const [col, pos, title, desc, prio, due, a, r, ac] of samples) {
        const info = addTask.run(web.pid, web.sprintIds[0], col, title, desc, prio, due, a, r, ac, pos, admin);
        addActivity.run(Number(info.lastInsertRowid), admin, col, pos);
      }
    },
  },
];

export function runMigrations(db, { seedDemo = true } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));

  for (const m of migrations) {
    if (applied.has(m.name)) continue;
    if (m.demoOnly && !seedDemo) continue; // stays pending, so it can still run later
    db.exec('BEGIN');
    try {
      m.up(db);
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(m.name);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${m.name} failed: ${e.message}`);
    }
  }
}
