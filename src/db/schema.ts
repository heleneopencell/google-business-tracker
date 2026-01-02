import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'data', 'tracker.db');

export function ensureDataDir() {
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

export function initDatabase(): Database.Database {
  ensureDataDir();
  
  const db = new Database(DB_PATH);
  
  // Enable foreign keys
  db.pragma('foreign_keys = ON');
  
  // Create businesses table
  db.exec(`
    CREATE TABLE IF NOT EXISTS businesses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonicalBusinessKey TEXT UNIQUE NOT NULL,
      placeId TEXT UNIQUE,
      cid TEXT UNIQUE,
      url TEXT NOT NULL,
      name TEXT,
      spreadsheetId TEXT,
      folderId TEXT,
      lastCheckedDate TEXT,
      lastCheckedAt TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  
  // Add url column if it doesn't exist (migration)
  try {
    db.exec('ALTER TABLE businesses ADD COLUMN url TEXT');
  } catch (e) {
    // Column already exists, ignore
  }
  
  // Create run_state table (single row)
  db.exec(`
    CREATE TABLE IF NOT EXISTS run_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      lastRunAt TEXT,
      lastRunStatus TEXT,
      lastRunError TEXT
    )
  `);
  
  // Initialize run_state if empty
  const existing = db.prepare('SELECT COUNT(*) as count FROM run_state').get() as { count: number };
  if (existing.count === 0) {
    db.prepare('INSERT INTO run_state (id) VALUES (1)').run();
  }
  
  return db;
}

export type Business = {
  id: number;
  canonicalBusinessKey: string;
  placeId: string | null;
  cid: string | null;
  name: string | null;
  spreadsheetId: string | null;
  folderId: string | null;
  lastCheckedDate: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RunState = {
  id: number;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunError: string | null;
};

