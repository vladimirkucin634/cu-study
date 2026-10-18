import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContext } from 'playwright-core';
import { TimeClient } from './time-client.js';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const SESSION_COOKIE_NAMES = new Set(['MMAUTHTOKEN', 'MMSID']);

function authTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.TIME_AUTH_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function browserProfileDir(): string {
  return process.env.TIME_BROWSER_PROFILE_DIR || join(homedir(), '.time-mcp', 'browser-profile');
}

async function findValidSession(
  context: BrowserContext,
  timeUrl: string
): Promise<{ client: TimeClient; userId: string } | null> {
  const cookies = await context.cookies(timeUrl);
  const candidates = cookies.filter((cookie) => SESSION_COOKIE_NAMES.has(cookie.name));

  for (const cookie of candidates) {
    const client = new TimeClient(timeUrl, cookie.value);
    try {
      const me = await client.getMe();
      return { client, userId: me.id };
    } catch {
      // A stale cookie may coexist with the current one; keep looking.
    }
  }

  return null;
}

export async function loginWithBrowser(
  timeUrl: string
): Promise<{ client: TimeClient; userId: string }> {
  const profileDir = browserProfileDir();
  mkdirSync(profileDir, { recursive: true, mode: 0o700 });

  const executablePath = process.env.TIME_BROWSER_EXECUTABLE;
  const channel = process.env.TIME_BROWSER_CHANNEL || 'chrome';
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    executablePath: executablePath || undefined,
    channel: executablePath ? undefined : channel,
  });

  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(`${timeUrl.replace(/\/$/, '')}/login`, {
      waitUntil: 'domcontentloaded',
    });

    console.error('Complete CU sign-in in the opened browser window...');
    const deadline = Date.now() + authTimeoutMs();

    while (Date.now() < deadline) {
      const authenticated = await findValidSession(context, timeUrl);
      if (authenticated) {
        return authenticated;
      }
      await page.waitForTimeout(1_000);
    }

    throw new Error(
      `Browser sign-in timed out after ${Math.round(authTimeoutMs() / 1000)} seconds`
    );
  } finally {
    await context.close();
  }
}
