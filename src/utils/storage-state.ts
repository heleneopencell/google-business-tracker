import fs from 'fs';
import path from 'path';
import { BrowserContext } from 'playwright';
import { CONFIG } from '../config/constants';
import { logger } from './logger';

const STORAGE_PATH = path.join(CONFIG.STORAGE.PROFILE_PATH, CONFIG.STORAGE.STORAGE_FILE);

export type StorageState = {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
  }>;
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
};

export function loadStorageState(): StorageState | undefined {
  if (!fs.existsSync(STORAGE_PATH)) {
    return undefined;
  }
  
  try {
    const content = fs.readFileSync(STORAGE_PATH, 'utf-8');
    return JSON.parse(content) as StorageState;
  } catch (e) {
    logger.warn('Invalid storage state file, ignoring');
    return undefined;
  }
}

export async function saveStorageState(context: BrowserContext): Promise<void> {
  try {
    const storageState = await context.storageState();
    
    // Ensure directory exists
    const dir = path.dirname(STORAGE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(STORAGE_PATH, JSON.stringify(storageState, null, 2));
    logger.debug('Storage state saved successfully');
  } catch (e) {
    logger.error('Failed to save storage state:', e);
    throw e;
  }
}

export function getStorageStateAge(): number | null {
  if (!fs.existsSync(STORAGE_PATH)) {
    return null;
  }
  
  try {
    const stats = fs.statSync(STORAGE_PATH);
    return Date.now() - stats.mtimeMs;
  } catch (e) {
    logger.warn('Failed to get storage state age:', e);
    return null;
  }
}

export function ensureProfileDirectory(): void {
  if (!fs.existsSync(CONFIG.STORAGE.PROFILE_PATH)) {
    fs.mkdirSync(CONFIG.STORAGE.PROFILE_PATH, { recursive: true });
    logger.debug('Created profile directory');
  }
}

