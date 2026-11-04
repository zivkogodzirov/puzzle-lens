/**
 * End-to-end UI tests (BRIEF §11, PLAN §6 M1): the built app in WebKit (Safari's engine) with a
 * simulated camera (test/e2e/fake-camera.ts). Run with `npm run test:e2e`.
 *
 * The tests run against `vite preview` of a real production build, so the service worker,
 * the OpenCV WASM files and the worker bundles are exactly what GitHub Pages serves.
 */
import { defineConfig, devices } from '@playwright/test';

const CI = Boolean(process.env.CI);
const PORT = 4173;

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // Each test starts OpenCV workers (~6 MB of WASM each); two at a time keeps them from starving each other.
  workers: CI ? 1 : 2,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}/puzzle-lens/`,
    trace: 'on-first-retry',
    acceptDownloads: true,
  },
  projects: [
    {
      name: 'webkit-iphone',
      use: {
        // iPhone-sized screen and Safari's iPhone user agent, but always the WebKit engine.
        ...devices['iPhone 17 Pro'],
        browserName: 'webkit',
      },
    },
  ],
  webServer: {
    command: `npx vite build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/puzzle-lens/`,
    reuseExistingServer: !CI,
    timeout: 240_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
