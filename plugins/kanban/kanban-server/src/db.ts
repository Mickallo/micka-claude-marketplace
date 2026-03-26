import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";

const KANBAN_DIR = path.resolve(os.homedir(), ".claude", "kanban");
const DB_PATH = path.join(KANBAN_DIR, "kanban.db");

if (!fs.existsSync(KANBAN_DIR)) fs.mkdirSync(KANBAN_DIR, { recursive: true });

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'todo',
      priority TEXT NOT NULL DEFAULT 'medium',
      pipeline TEXT NOT NULL DEFAULT 'full',
      description TEXT,
      blocks TEXT DEFAULT '[]',
      loop_count INTEGER NOT NULL DEFAULT 0,
      tags TEXT,
      attachments TEXT,
      notes TEXT,
      rank INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
  `);

  // Migrations
  try { db.exec(`ALTER TABLE tasks ADD COLUMN pipeline TEXT NOT NULL DEFAULT 'full'`); } catch { /* exists */ }
  try { db.exec(`ALTER TABLE tasks ADD COLUMN blocks TEXT DEFAULT '[]'`); } catch { /* exists */ }
  try { db.exec(`ALTER TABLE tasks ADD COLUMN loop_count INTEGER NOT NULL DEFAULT 0`); } catch { /* exists */ }
  try { db.exec(`ALTER TABLE tasks DROP COLUMN notes`); } catch { /* already dropped or doesn't exist */ }

  _db = db;
  return db;
}

export function renumberRanks(db: Database.Database, status: string) {
  const rows = db
    .prepare("SELECT id FROM tasks WHERE status = ? ORDER BY rank, id")
    .all(status) as { id: number }[];
  const stmt = db.prepare("UPDATE tasks SET rank = ? WHERE id = ?");
  for (let i = 0; i < rows.length; i++) {
    stmt.run((i + 1) * 1000, rows[i].id);
  }
}

export const KANBAN_DIR_PATH = KANBAN_DIR;
export const IMAGES_DIR = path.join(KANBAN_DIR, "images");

if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
