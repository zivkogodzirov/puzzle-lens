import { test, expect, gotoScreen } from './fixtures';

/** Every row "Run checks" produces (the camera, photo, file-camera and memory rows come from the other steps). */
const AUTOMATIC_IDS = [
  // Basics
  'secure-context',
  'running-as',
  'browser-version',
  'background-workers',
  // Camera (no camera needed for these)
  'getusermedia',
  'camera-permission',
  'camera-permission-history',
  'mstp-worker',
  'videoframe',
  'rvfc',
  // Photos
  'imagecapture',
  // Graphics & speed
  'offscreen-canvas',
  'image-bitmap-worker',
  'webgpu-adapter',
  'webgpu-limits',
  'webgpu-f16',
  'webgpu-device',
  'webgpu-compute-main',
  'webgpu-compute-worker',
  'wasm-simd',
  'wasm-exceptions',
  'wasm-jspi',
  'canvas-noise-main',
  'canvas-noise-worker',
  'videoframe-readback',
  'opencv-load',
  'opencv-bench',
  // Storage & offline
  'storage-space',
  'storage-persist',
  'opfs',
  'indexeddb',
  'service-worker',
  // Other
  'wake-lock',
  'web-share-files',
  'orientation-permission',
];

/** Rows that must work in any browser that can run Puzzle Lens at all. */
const MUST_BE_YES = ['secure-context', 'background-workers', 'wasm-simd', 'wasm-exceptions', 'indexeddb', 'opencv-load'];

/**
 * Rows whose test may genuinely fail on a CI machine (no graphics chip, throw-away storage, no
 * screen to keep awake…). Any other row showing "test failed" is a bug.
 */
const MAY_ERROR = [/^webgpu-/, /^opfs$/, /^wake-lock$/, /^videoframe-readback$/, /^canvas-noise-worker$/];

test('device check: "Run checks" fills in the results', async ({ page }, testInfo) => {
  test.slow(); // OpenCV speed test and WebGPU self-test run in WebKit; allow up to 3 minutes
  await gotoScreen(page, 'device');
  await expect(page.getByTestId('device-check-empty')).toContainText('No results yet');
  await expect(page.getByTestId('device-checked-browser')).toContainText('Not checked yet in the Safari tab');
  // Only this mode's status is shown; the other mode is explained in words.
  await expect(page.getByTestId('device-checked-standalone')).toHaveCount(0);
  await expect(page.getByTestId('device-check-reminder')).toContainText("Also run this in the Home Screen app");
  await expect(page.getByTestId('device-check-reminder')).toContainText("this screen can't see that run");

  await page.getByTestId('run-checks').click();
  const results = page.getByTestId('device-check-results');
  await expect(results).toBeVisible({ timeout: 30_000 });
  await expect(results).toHaveAttribute('data-running', 'false', { timeout: 150_000 });
  await expect(results).toHaveAttribute('data-mode', 'browser');
  await expect(page.getByTestId('run-checks')).toBeEnabled();

  const rows = results.locator('.check-row');
  const count = await rows.count();

  // Record what WebKit reports, for the test report (attached before the assertions so it's there on failure too).
  const summary = await rows.evaluateAll((els) =>
    els.map((el) => {
      const name = el.querySelector('.check-name')?.textContent?.trim() ?? '';
      const value = el.querySelector('.check-value')?.textContent?.trim() ?? '';
      return `${el.getAttribute('data-testid')} [${el.getAttribute('data-status')}] ${name}: ${value}`;
    }),
  );
  await testInfo.attach('device-check-rows.txt', { body: summary.join('\n'), contentType: 'text/plain' });
  console.log(`[device-check] ${count} rows:\n${summary.join('\n')}`);

  // Exactly the automatic rows, every one of them.
  for (const id of AUTOMATIC_IDS) await expect(results.getByTestId(`check-${id}`), `row ${id}`).toHaveCount(1);
  expect(count, 'number of result rows').toBe(AUTOMATIC_IDS.length);
  expect(await results.locator('section[data-testid^="device-section-"]').count()).toBeGreaterThanOrEqual(5);

  // The essentials work.
  for (const id of MUST_BE_YES) await expect(results.getByTestId(`check-${id}`), `row ${id}`).toHaveAttribute('data-status', 'yes');
  // The speed test ran (it may be "limited" on a slow CI machine, but must not fail).
  await expect(results.getByTestId('check-opencv-bench')).toHaveAttribute('data-status', /^(yes|partial)$/);

  // No test failed except the ones that depend on the machine.
  const statuses = await rows.evaluateAll((els) => els.map((el) => [el.getAttribute('data-testid')!.replace(/^check-/, ''), el.getAttribute('data-status')!]));
  const failed = statuses.filter(([id, status]) => status === 'error' && !MAY_ERROR.some((re) => re.test(id!))).map(([id]) => id);
  expect(failed, 'rows whose test failed').toEqual([]);

  // Being in a Safari tab is expected for this check: shown as "normal", not as a problem.
  await expect(results.getByTestId('check-running-as')).toHaveAttribute('data-status', 'info');
  // A plain verdict and a summary in words.
  await expect(page.getByTestId('device-check-verdict')).toBeVisible();
  await expect(page.getByTestId('device-check-summary')).toContainText(`${AUTOMATIC_IDS.length} checks:`);
  await expect(page.getByTestId('device-check-summary')).toContainText('working');

  // Step 1 of 3 is ticked; the camera steps are not.
  await expect(page.getByTestId('device-checked-browser')).toContainText('1 of 3 steps done');
  await expect(page.getByTestId('device-part-automatic')).toHaveAttribute('data-done', 'true');
  await expect(page.getByTestId('device-part-camera')).toHaveAttribute('data-done', 'false');
  await expect(page.getByTestId('device-part-fileCamera')).toHaveAttribute('data-done', 'false');
  await expect(page.getByTestId('device-all-done')).toHaveCount(0);

  // Tapping a row shows its details.
  await rows.first().click();
  await expect(results.locator('[data-testid^="check-details-"]').first()).toBeVisible();

  // The run is saved for this mode (Safari tab), and survives a reload.
  await page.reload();
  await expect(page.getByTestId('device-check-results')).toBeVisible();
  expect(await page.getByTestId('device-check-results').locator('.check-row').count()).toBe(count);
  await expect(page.getByTestId('device-checked-browser')).toContainText('1 of 3 steps done');
});

test('device check: a memory test that iOS cut short is picked up on the next visit', async ({ page }) => {
  await gotoScreen(page, '');
  // Simulate iOS closing the app during the memory test: an unfinished record with a recent step.
  await page.evaluate(() => {
    const now = Date.now();
    localStorage.setItem('puzzle-lens.memprobe', JSON.stringify({ startedAt: now - 30_000, lastStepAt: now - 20_000, reachedMB: 1344, finished: false, mode: 'browser' }));
  });
  await page.reload();
  const waiting = page.getByTestId('memory-result-waiting');
  await expect(waiting).toContainText('The memory test finished');
  await expect(page.getByTestId('crash-notice')).toHaveCount(0);

  await waiting.getByRole('link', { name: 'Open Device check' }).click();
  await expect(page.getByText('iOS closed the app at about 1,344 MB').first()).toBeVisible();
  await expect(page.getByTestId('check-memory-headroom')).toHaveAttribute('data-status', 'yes');
  await expect(page.getByTestId('device-part-memory')).toHaveAttribute('data-done', 'true');

  // The record is used once: back on Home, the notice is gone.
  await page.goto('./#/');
  await expect(page.getByTestId('memory-result-waiting')).toHaveCount(0);
});

test('device check: an old unfinished memory test is reported as interrupted, not as a result', async ({ page }) => {
  await gotoScreen(page, '');
  await page.evaluate(() => {
    const longAgo = Date.now() - 60 * 60_000;
    localStorage.setItem('puzzle-lens.memprobe', JSON.stringify({ startedAt: longAgo, lastStepAt: longAgo + 10_000, reachedMB: 640, finished: false }));
  });
  await page.goto('./#/device');
  await expect(page.getByText('The memory test was interrupted; please run it again').first()).toBeVisible();
  await expect(page.getByTestId('check-memory-headroom')).toHaveCount(0);
});

test('device check: camera tests run on the simulated camera and record the live frames', async ({ page }, testInfo) => {
  test.slow();
  await gotoScreen(page, 'device');
  await page.getByTestId('start-camera-tests').click();
  const results = page.getByTestId('device-check-results');
  await expect(results).toBeVisible({ timeout: 30_000 });
  await expect(results).toHaveAttribute('data-running', 'false', { timeout: 170_000 });

  const rows = results.locator('.check-row');
  const summary = await rows.evaluateAll((els) =>
    els.map((el) => `${el.getAttribute('data-testid')} [${el.getAttribute('data-status')}] ${el.querySelector('.check-value')?.textContent?.trim() ?? ''}`),
  );
  await testInfo.attach('camera-test-rows.txt', { body: summary.join('\n'), contentType: 'text/plain' });
  console.log(`[camera-tests]\n${summary.join('\n')}`);

  // The live frames reached the helper, and what they look like is recorded.
  const frameInfo = results.getByTestId('check-camera-frame-info');
  await expect(frameInfo).toHaveAttribute('data-status', 'yes');
  await expect(frameInfo).toContainText('1280×960');
  await frameInfo.click();
  const details = page.getByTestId('check-details-camera-frame-info');
  await expect(details).toContainText('screenOrientation');
  await expect(details).toContainText('pleaseAlsoCheck');

  // Focus/exposure controls are a known iPhone limit: shown as normal, not as a failure.
  await expect(results.getByTestId('check-camera-controls')).toHaveAttribute('data-status', /^(yes|info)$/);
  // The 2× test never gives a ✗ verdict.
  await expect(results.getByTestId('check-two-x-test')).not.toHaveAttribute('data-status', 'no');

  // Step 2 is ticked, and the camera is off again afterwards.
  await expect(page.getByTestId('device-part-camera')).toHaveAttribute('data-done', 'true');
  await expect(page.getByTestId('device-camera-preview')).toBeHidden();
});
