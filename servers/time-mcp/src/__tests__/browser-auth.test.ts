import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  cookies: vi.fn(),
  goto: vi.fn(),
  launchPersistentContext: vi.fn(),
  mkdirSync: vi.fn(),
  waitForTimeout: vi.fn(),
}));

vi.mock('node:fs', () => ({ mkdirSync: mocks.mkdirSync }));
vi.mock('node:os', () => ({ homedir: () => '/home/testuser' }));
vi.mock('playwright-core', () => ({
  chromium: { launchPersistentContext: mocks.launchPersistentContext },
}));

vi.mock('../client/time-client.js', () => ({
  TimeClient: class MockTimeClient {
    constructor(
      public readonly baseUrlValue: string,
      public readonly tokenValue: string
    ) {}

    async getMe() {
      if (this.tokenValue !== 'working-session') {
        throw new Error('unauthorized');
      }
      return { id: 'user-1' };
    }
  },
}));

import { loginWithBrowser } from '../client/browser-auth.js';

describe('browser-assisted authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TIME_BROWSER_EXECUTABLE;
    delete process.env.TIME_BROWSER_PROFILE_DIR;
    process.env.TIME_BROWSER_CHANNEL = 'chrome';

    const page = {
      goto: mocks.goto,
      waitForTimeout: mocks.waitForTimeout,
    };
    mocks.launchPersistentContext.mockResolvedValue({
      pages: () => [page],
      newPage: vi.fn().mockResolvedValue(page),
      cookies: mocks.cookies,
      close: mocks.close,
    });
  });

  it('captures a valid TiME session cookie and closes the browser', async () => {
    mocks.cookies.mockResolvedValue([
      { name: 'MMAUTHTOKEN', value: 'working-session' },
    ]);

    const result = await loginWithBrowser('https://time.cu.ru');

    expect(mocks.mkdirSync).toHaveBeenCalledWith(
      '/home/testuser/.time-mcp/browser-profile',
      { recursive: true, mode: 0o700 }
    );
    expect(mocks.launchPersistentContext).toHaveBeenCalledWith(
      '/home/testuser/.time-mcp/browser-profile',
      expect.objectContaining({ headless: false, channel: 'chrome' })
    );
    expect(mocks.goto).toHaveBeenCalledWith(
      'https://time.cu.ru/login',
      { waitUntil: 'domcontentloaded' }
    );
    expect(result.userId).toBe('user-1');
    expect(result.client.tokenValue).toBe('working-session');
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it('accepts the legacy MMSID session cookie', async () => {
    mocks.cookies.mockResolvedValue([
      { name: 'MMSID', value: 'working-session' },
    ]);

    const result = await loginWithBrowser('https://time.cu.ru/');

    expect(result.userId).toBe('user-1');
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
