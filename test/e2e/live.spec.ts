import type { Page, TestInfo } from '@playwright/test';
import { test, expect, fakeCameraStats } from './fixtures';
import { hudNumber, startLiveCamera } from './live-helpers';

/** Notes which way frames reached the tracker ("direct (worker)" = MediaStreamTrackProcessor, or the fallback). */
async function noteFramePath(page: Page, testInfo: TestInfo): Promise<string> {
  const hudText = await page.getByTestId('hud').innerText();
  const framesLine = (hudText.split('\n').find((l) => l.trim().startsWith('frames')) ?? '(no frames line)').trim();
  testInfo.annotations.push({ type: 'frames', description: framesLine });
  console.log(`[live] HUD ${framesLine}`);
  return framesLine;
}

test('live camera: frames reach the tracker worker and OpenCV finds the marker', async ({ page }, testInfo) => {
  await startLiveCamera(page);
  expect((await fakeCameraStats(page)).getUserMediaCalls).toBeGreaterThanOrEqual(1);
  await expect(page.locator('.live-top .title')).toHaveText('Live');

  const hud = page.getByTestId('hud');
  await expect(hud).toBeVisible();
  await expect(hud).toContainText('camera 1280×960');

  await expect.poll(() => hudNumber(page, 'tracker-fps'), { message: 'tracker fps should rise above 0', timeout: 15_000 }).toBeGreaterThan(0);
  await expect
    .poll(() => hudNumber(page, 'markers-seen'), { message: 'the tracker should see the test marker', timeout: 20_000 })
    .toBeGreaterThanOrEqual(1);

  const framesLine = await noteFramePath(page, testInfo);
  expect(framesLine).toMatch(/direct \(worker\)|copied \(fallback\)/);

  // The tracker's memory readout arrives with its once-a-second status report.
  await expect(hud).toContainText(/memory tracker [1-9]\d* MB/, { timeout: 5_000 });
  const hudText = await hud.innerText();
  testInfo.annotations.push({ type: 'hud', description: hudText.replace(/\n/g, ' | ') });
  console.log(`[live] HUD: ${hudText.replace(/\n/g, ' | ')}`);
  expect(hudText, 'the HUD shows no tracker error').not.toContain('⚠');

  // Leaving the screen turns the camera off cleanly (no page errors: checked by the fixture).
  await page.getByRole('button', { name: '‹ Home' }).click();
  await expect(page.getByTestId('install-banner')).toBeVisible();
  await expect.poll(async () => (await fakeCameraStats(page)).liveCameraTracks, { message: 'camera tracks left running' }).toBe(0);
});

test.describe('snap', () => {
  test.use({ persistentStorage: true });

  test('takes a photo, checks it and shows its size', async ({ page }, testInfo) => {
    await startLiveCamera(page);
    await expect.poll(() => hudNumber(page, 'tracker-fps'), { timeout: 15_000 }).toBeGreaterThan(0);

    await page.getByTestId('snap').click();
    const sheet = page.getByTestId('snap-sheet');
    await expect(sheet).toBeVisible({ timeout: 30_000 });
    const size = page.getByTestId('snap-size');
    await expect(size).toContainText('×');
    await expect(size).toContainText('1280 × 960');
    await expect(sheet).toContainText('the app (ImageCapture)');
    await expect(sheet.getByRole('img', { name: 'Last photo' })).toBeVisible();
    await expect(sheet.getByTestId('snap-error')).toHaveCount(0);
    await expect(sheet.getByTestId('snap-save-warning')).toHaveCount(0);
    expect((await fakeCameraStats(page)).photosTaken).toBe(1);

    const sheetText = (await sheet.innerText()).replace(/\n/g, ' | ');
    testInfo.annotations.push({ type: 'snap', description: sheetText });
    console.log(`[snap] ${sheetText}`);

    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('button', { name: 'Last photo' })).toBeVisible();
  });
});

test('snap in a private (throw-away) session: photo checked, only a gentle note that it could not be kept', async ({ page }, testInfo) => {
  // Playwright's default WebKit session behaves like Private Browsing: IndexedDB refuses Blobs, so
  // the photo can't be saved for reports. The photo itself must still be taken and checked, with
  // no red error (that used to say "Something went wrong").
  await startLiveCamera(page);
  await page.getByTestId('snap').click();
  const sheet = page.getByTestId('snap-sheet');
  await expect(sheet).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('snap-size')).toContainText('1280 × 960');
  await expect(sheet.getByRole('img', { name: 'Last photo' })).toBeVisible();
  await expect(sheet.getByTestId('snap-error')).toHaveCount(0);
  const note = sheet.getByTestId('snap-save-warning');
  if (await note.count()) {
    await expect(note).toContainText('Photo checked');
    testInfo.annotations.push({ type: 'private-session snap note', description: await note.innerText() });
  }
});

/** Like the owner's iPhone (2026-11-06): every takePhoto() call fails with an internal camera error. */
async function breakTakePhoto(page: Page, alsoGrabFrame = false): Promise<void> {
  await page.evaluate((grab) => {
    const IC = (window as unknown as { ImageCapture: { prototype: { takePhoto: () => Promise<Blob>; grabFrame: () => Promise<ImageBitmap> } } }).ImageCapture;
    IC.prototype.takePhoto = async () => {
      throw new DOMException('Internal error', 'UnknownError');
    };
    if (grab)
      IC.prototype.grabFrame = async () => {
        throw new DOMException('simulated grab failure', 'UnknownError');
      };
  }, alsoGrabFrame);
}

test('when the camera refuses photos, Snap uses the full-size live picture instead', async ({ page }) => {
  await startLiveCamera(page);
  await breakTakePhoto(page);
  await page.getByTestId('snap').click();
  const sheet = page.getByTestId('snap-sheet');
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('snap-size')).toContainText('1280 × 960');
  await expect(sheet).toContainText('full-size live picture');
  await expect(sheet.getByTestId('snap-error')).toHaveCount(0);
  await expect(sheet.getByRole('img', { name: 'Last photo' })).toBeVisible();
});

test('when both ways fail, the iPhone camera screen is offered', async ({ page }) => {
  await startLiveCamera(page);
  await breakTakePhoto(page, true);
  await page.getByTestId('snap').click();
  const sheet = page.getByTestId('snap-sheet');
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  await expect(sheet.getByTestId('snap-error')).toContainText("didn't come back from the camera");
  await expect(sheet.getByTestId('use-system-camera')).toBeVisible();
});

test('a photo that comes back small (540×960, like the owner\'s iPhone with tracking on) is replaced by the full-size live picture', async ({ page }) => {
  await startLiveCamera(page);
  await page.evaluate(() => {
    const IC = (window as unknown as { ImageCapture: { prototype: { takePhoto: () => Promise<Blob> } } }).ImageCapture;
    IC.prototype.takePhoto = () =>
      new Promise<Blob>((resolve) => {
        const c = document.createElement('canvas');
        c.width = 540;
        c.height = 960;
        c.getContext('2d')!.fillRect(0, 0, 10, 10);
        c.toBlob((b) => resolve(b!), 'image/jpeg', 0.9);
      });
  });
  await page.getByTestId('snap').click();
  const sheet = page.getByTestId('snap-sheet');
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('snap-size')).toContainText('1280 × 960');
  await expect(sheet).toContainText('full-size live picture');
  await expect(sheet.getByTestId('snap-send-report')).toBeVisible();
});
