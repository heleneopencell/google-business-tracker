import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const LOCK_FILE = path.join(process.cwd(), 'data', 'run.lock');
const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

export interface LockInfo {
  pid: number;
  startedAt: string;
  command: string;
}

export function acquireLock(overrideStale: boolean = false): LockInfo | null {
  const lockDir = path.dirname(LOCK_FILE);
  if (!fs.existsSync(lockDir)) {
    fs.mkdirSync(lockDir, { recursive: true });
  }
  
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const content = fs.readFileSync(LOCK_FILE, 'utf-8');
      const lockInfo: LockInfo = JSON.parse(content);
      
      // Check if process is still running
      try {
        process.kill(lockInfo.pid, 0); // Signal 0 checks if process exists
        // Process exists, check if stale
        const startedAt = new Date(lockInfo.startedAt).getTime();
        const now = Date.now();
        const age = now - startedAt;
        
        if (age > STALE_THRESHOLD_MS) {
          if (overrideStale) {
            // Remove stale lock
            fs.unlinkSync(LOCK_FILE);
          } else {
            return null; // Lock exists and is stale, but override not allowed
          }
        } else {
          return null; // Lock exists and is not stale
        }
      } catch (e) {
        // Process doesn't exist, remove stale lock file
        fs.unlinkSync(LOCK_FILE);
      }
    } catch (e) {
      // Invalid lock file, remove it
      fs.unlinkSync(LOCK_FILE);
    }
  }
  
  // Create new lock
  const lockInfo: LockInfo = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    command: process.argv.join(' ')
  };
  
  fs.writeFileSync(LOCK_FILE, JSON.stringify(lockInfo, null, 2));
  return lockInfo;
}

export function releaseLock(): void {
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const content = fs.readFileSync(LOCK_FILE, 'utf-8');
      const lockInfo: LockInfo = JSON.parse(content);
      
      // Only release if we own the lock
      if (lockInfo.pid === process.pid) {
        fs.unlinkSync(LOCK_FILE);
      }
    } catch (e) {
      // Ignore errors when releasing
    }
  }
}

export function withLock<T>(
  fn: () => Promise<T>,
  overrideStale: boolean = false
): Promise<T> {
  const lock = acquireLock(overrideStale);
  if (!lock) {
    throw new Error('RUN_IN_PROGRESS');
  }
  
  return fn().finally(() => {
    releaseLock();
  });
}

