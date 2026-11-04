/**
 * Shared set-up for every end-to-end test:
 * - the simulated camera is installed before the app starts (fake-camera.ts);
 * - uncaught page errors are collected, and any of them fails the test;
 * - console errors and warnings are collected and attached to the test report (the app's own log
 *   prints errors from the workers there too);
 * - `test.use({ persistentStorage: true })` runs a test in a browser profile on disk instead of
 *   Playwright's default throw-away (private) session. WebKit refuses to store photos (Blobs) in
 *   IndexedDB in throw-away sessions, which a real iPhone in normal browsing does not.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as base, expect, type Page, type TestInfo } from '@playwright/test';
import { installFakeCamera, type FakeCameraOptions, type FakeCameraStats } from './fake-camera';

export interface PageProblems {
  pageErrors: string[];
  consoleErrors: string[];
  consoleWarnings: string[];
}

interface Fixtures {
  fakeCameraOptions: FakeCameraOptions;
  persistentStorage: boolean;
  problems: PageProblems;
}

export const test = base.extend<Fixtures>({
  fakeCameraOptions: [{}, { option: true }],
  persistentStorage: [false, { option: true }],

  context: async (
    { context, persistentStorage, playwright, browserName, headless, viewport, screen, userAgent, isMobile, hasTouch, deviceScaleFactor, baseURL, acceptDownloads },
    use,
  ) => {
    if (!persistentStorage) {
      await use(context);
      return;
    }
    const dir = await mkdtemp(join(tmpdir(), 'puzzle-lens-e2e-'));
    const persistent = await playwright[browserName].launchPersistentContext(dir, {
      headless,
      viewport,
      screen,
      userAgent,
      isMobile,
      hasTouch,
      deviceScaleFactor,
      baseURL,
      acceptDownloads,
    });
    try {
      await use(persistent);
    } finally {
      await persistent.close();
      await rm(dir, { recursive: true, force: true });
    }
  },

  page: async ({ page, fakeCameraOptions }, use) => {
    await page.addInitScript(installFakeCamera, fakeCameraOptions);
    await use(page);
  },

  problems: [
    async ({ page }, use, testInfo) => {
      const problems: PageProblems = { pageErrors: [], consoleErrors: [], consoleWarnings: [] };
      page.on('pageerror', (err) => problems.pageErrors.push(`${err.name}: ${err.message}\n${err.stack ?? ''}`.trim()));
      page.on('console', (msg) => {
        if (msg.type() === 'error') problems.consoleErrors.push(msg.text());
        else if (msg.type() === 'warning') problems.consoleWarnings.push(msg.text());
      });
      await use(problems);
      await attachProblems(testInfo, problems);
      expect(problems.pageErrors, 'uncaught errors in the page').toEqual([]);
    },
    { auto: true },
  ],
});

async function attachProblems(testInfo: TestInfo, p: PageProblems): Promise<void> {
  const lines = [
    ...p.pageErrors.map((e) => `PAGE ERROR: ${e}`),
    ...p.consoleErrors.map((e) => `console.error: ${e}`),
    ...p.consoleWarnings.map((e) => `console.warn: ${e}`),
  ];
  if (lines.length) await testInfo.attach('page-console.txt', { body: lines.join('\n'), contentType: 'text/plain' });
}

/** Counters from the simulated camera (window.__fakeCamera). */
export async function fakeCameraStats(page: Page): Promise<FakeCameraStats> {
  return page.evaluate(() => (window as unknown as { __fakeCamera: FakeCameraStats }).__fakeCamera);
}

/** Opens a screen of the app by its #/ address, e.g. gotoScreen(page, 'live'). */
export async function gotoScreen(page: Page, screen: '' | 'live' | 'device' | 'settings' | 'report' | 'help' | 'log'): Promise<void> {
  await page.goto(screen ? `./#/${screen}` : './');
  // "Attached", not "visible": the Live screen is pinned to the viewport (position: fixed), so its
  // container has no height of its own and Playwright would call it hidden.
  await expect(page.locator(`#app > .app.route-${screen || 'home'}`)).toBeAttached();
}

export { expect };
