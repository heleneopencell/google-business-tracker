import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'data', 'tracker.db');

export function ensureDataDir() {
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

export interface Database {
  run: (sql: string, ...params: any[]) => Promise<{ lastID: number; changes: number }>;
  get: <T = any>(sql: string, ...params: any[]) => Promise<T | undefined>;
  all: <T = any>(sql: string, ...params: any[]) => Promise<T[]>;
  exec: (sql: string) => Promise<void>;
  close: () => Promise<void>;
}

function createDatabase(db: sqlite3.Database): Database {
  return {
    run: (sql: string, ...params: any[]) => {
      return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
          if (err) reject(err);
          else resolve({ lastID: this.lastID, changes: this.changes });
        });
      });
    },
    get: <T = any>(sql: string, ...params: any[]): Promise<T | undefined> => {
      return new Promise<T | undefined>((resolve, reject) => {
        db.get(sql, params, (err, row) => {
          if (err) reject(err);
          else resolve((row as T) || undefined);
        });
      });
    },
    all: <T = any>(sql: string, ...params: any[]): Promise<T[]> => {
      return new Promise<T[]>((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
          if (err) reject(err);
          else resolve((rows || []) as T[]);
        });
      });
    },
    exec: (sql: string) => {
      return new Promise((resolve, reject) => {
        db.exec(sql, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
    close: () => {
      return new Promise((resolve, reject) => {
        db.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  };
}

export function initDatabase(): Database {
  ensureDataDir();
  
  const db = new sqlite3.Database(DB_PATH);
  const dbAsync = createDatabase(db);
  
  // Enable foreign keys
  db.run('PRAGMA foreign_keys = ON');
  
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
  db.run('ALTER TABLE businesses ADD COLUMN url TEXT', (err) => {
    // Column already exists, ignore
  });
  
  // Create run_state table (single row)
  db.exec(`
    CREATE TABLE IF NOT EXISTS run_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      lastRunAt TEXT,
      lastRunStatus TEXT,
      lastRunError TEXT
    )
  `);
  
  // Initialize run_state if empty (synchronous check)
  db.get('SELECT COUNT(*) as count FROM run_state', (err, row: any) => {
    if (!err && row && row.count === 0) {
      db.run('INSERT INTO run_state (id) VALUES (1)');
    }
  });
  
  return dbAsync;
}

export type Business = {
  id: number;
  canonicalBusinessKey: string;
  placeId: string | null;
  cid: string | null;
  url: string;
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
