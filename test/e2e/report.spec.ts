import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { test, expect, gotoScreen } from './fixtures';
import { hudNumber, startLiveCamera } from './live-helpers';

test('report: prepare, download, and the zip holds report.json with the app version', async ({ page }, testInfo) => {
  await gotoScreen(page, 'report');
  await expect(page.getByTestId('report-facts')).toContainText('Not run yet');
  // Only this mode's Device check is visible from here; the other mode is explained in words.
  await expect(page.getByTestId('report-check-status')).toContainText('Not run yet');
  await expect(page.getByTestId('report-mode-note')).toContainText('This report only has the Safari tab results. Send another one from the Home Screen app.');
  await expect(page.getByTestId('report-missing-steps')).toContainText('Automatic checks, Camera tests, iPhone camera screen');
  await expect(page.getByTestId('report-facts')).not.toContainText('Device check in the Home Screen app');

  await page.getByTestId('prepare-report').click();
  await expect(page.getByTestId('report-ready')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('report-error')).toHaveCount(0);
  await expect(page.getByTestId('report-size')).toHaveText(/\d/);
  await expect(page.getByTestId('share-report')).toBeVisible();

  const link = page.getByTestId('download-report');
  await expect(link).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  const path = await download.path();
  const zip = unzipSync(new Uint8Array(await readFile(path)));
  const names = Object.keys(zip).sort();
  testInfo.annotations.push({ type: 'zip contents', description: names.join(', ') });
  expect(names).toContain('report.json');
  expect(names).toContain('README.txt');

  const reportBytes = zip['report.json'];
  expect(reportBytes).toBeDefined();
  const report = JSON.parse(strFromU8(reportBytes!)) as { app?: string; appVersion?: unknown; displayMode?: string; logs?: unknown[] };
  expect(report.app).toBe('Puzzle Lens');
  expect(typeof report.appVersion).toBe('string');
  expect((report.appVersion as string).length).toBeGreaterThan(0);
  expect(report.displayMode).toBe('browser');
  expect(Array.isArray(report.logs)).toBe(true);
  const readme = strFromU8(zip['README.txt']!);
  expect(readme).toContain('your latest Device check in the Safari tab');
  expect(readme).toContain('Send another report from the Home Screen app.');
  console.log(`[report] ${download.suggestedFilename()}: ${names.join(', ')}; appVersion ${String(report.appVersion)}`);
});

test.describe('report after a Snap', () => {
  test.use({ persistentStorage: true });

  test('the zip holds live frames, the photo preview and (when ticked) the full photo', async ({ page }, testInfo) => {
    await startLiveCamera(page);
    await expect.poll(() => hudNumber(page, 'markers-seen'), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
    await page.getByTestId('snap').click();
    await expect(page.getByTestId('snap-size')).toContainText('1280 × 960', { timeout: 30_000 });
    await expect(page.getByTestId('snap-sheet')).not.toContainText('Something went wrong');

    // Same page (hash navigation), so the tracker worker is still running and can hand over its frames.
    await page.goto('./#/report');
    await expect(page.getByTestId('report-facts')).not.toContainText('None yet');
    const fullPhoto = page.getByTestId('include-full-photo');
    await expect(fullPhoto).toBeEnabled();
    await fullPhoto.check();

    await page.getByTestId('prepare-report').click();
    await expect(page.getByTestId('report-ready')).toBeVisible({ timeout: 30_000 });
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-report').click()]);
    const zip = unzipSync(new Uint8Array(await readFile(await download.path())));
    const names = Object.keys(zip).sort();
    testInfo.annotations.push({ type: 'zip contents', description: names.join(', ') });
    console.log(`[report+snap] ${names.join(', ')}`);

    expect(names).toContain('report.json');
    expect(names.some((n) => /^frames\/recent-\d+\.jpg$/.test(n)), 'live camera frames are included').toBe(true);
    expect(names.some((n) => /^photo\/last-snap-preview\.(jpg|jpeg|png|webp)$/.test(n)), 'photo preview is included').toBe(true);
    expect(names.some((n) => /^photo\/last-snap-full\.(jpg|jpeg)$/.test(n)), 'full photo is included').toBe(true);

    const report = JSON.parse(strFromU8(zip['report.json']!)) as {
      lastSnap: { bytes: number; includedAtFullSize: boolean } | null;
      camera: { lenses: string[] };
      workers: { tracker: { running: boolean } };
      problems: string[];
    };
    expect(report.lastSnap?.includedAtFullSize).toBe(true);
    expect(report.camera.lenses).toContain('Back Camera');
    expect(report.workers.tracker.running).toBe(true);
    expect(report.problems, 'parts that could not be collected').toEqual([]);
  });
});
