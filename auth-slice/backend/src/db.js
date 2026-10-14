import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from './migrations.js';

// Uses Node's built-in SQLite (Node 22.13+), so there is nothing native to compile.
// Schema changes live in src/migrations.js and run automatically on start.
// `seedDemo` controls migration 003 (demo users, projects and sample tasks).
export function openDb(
  file = process.env.DB_FILE || './data.sqlite',
  { seedDemo = process.env.SEED_DEMO_DATA !== 'false' } = {},
) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db, { seedDemo });
  return db;
}
