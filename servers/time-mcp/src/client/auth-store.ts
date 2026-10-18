import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';

interface StoredAuth {
  url: string;
  token: string;
  userId: string;
  savedAt: number;
}

const CONFIG_DIR = join(homedir(), '.time-mcp');
const AUTH_FILE = join(CONFIG_DIR, 'auth.json');
const KEYCHAIN_SERVICE = 'cu-time-mcp';

function normalizeUrl(timeUrl: string): string {
  return timeUrl.replace(/\/$/, '');
}

function loadFromKeychain(timeUrl: string): StoredAuth | null {
  if (platform() !== 'darwin') {
    return null;
  }

  const result = spawnSync(
    'security',
    ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', normalizeUrl(timeUrl), '-w'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  );
  const token = result.status === 0 ? result.stdout.trim() : '';
  return token
    ? { url: normalizeUrl(timeUrl), token, userId: '', savedAt: 0 }
    : null;
}

export function loadSavedAuth(timeUrl: string): StoredAuth | null {
  try {
    const keychainAuth = loadFromKeychain(timeUrl);
    if (keychainAuth) {
      return keychainAuth;
    }

    if (!existsSync(AUTH_FILE)) {
      return null;
    }
    const data = JSON.parse(readFileSync(AUTH_FILE, 'utf-8')) as StoredAuth;
    if (data.url === normalizeUrl(timeUrl) && data.token) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveAuth(timeUrl: string, token: string, userId: string): void {
  try {
    if (platform() === 'darwin') {
      const result = spawnSync(
        'security',
        [
          'add-generic-password', '-U',
          '-s', KEYCHAIN_SERVICE,
          '-a', normalizeUrl(timeUrl),
          '-w', token,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] }
      );
      if (result.status === 0) {
        return;
      }
      console.error('Could not use macOS Keychain; falling back to a mode-0600 file');
    }

    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    const data: StoredAuth = {
      url: normalizeUrl(timeUrl),
      token,
      userId,
      savedAt: Date.now(),
    };
    writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  } catch (error) {
    console.error('Failed to save auth:', error);
  }
}

export function clearSavedAuth(timeUrl = 'https://time.cu.ru'): void {
  try {
    if (platform() === 'darwin') {
      spawnSync(
        'security',
        ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', normalizeUrl(timeUrl)],
        { encoding: 'utf8', stdio: ['ignore', 'ignore', 'ignore'] }
      );
    }
    if (existsSync(AUTH_FILE)) {
      unlinkSync(AUTH_FILE);
    }
  } catch {
    // ignore
  }
}
