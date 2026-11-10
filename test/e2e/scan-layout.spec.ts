/**
 * The Scan screen's layout when something is wrong (M8 part 4, 2026-11-10): with camera access
 * refused, the notice is readable in light mode and nothing is drawn on top of anything else, also
 * once a chosen photo's result note shows; a puzzle that isn't on this iPhone gets the normal top
 * bar with a way back.
 *
 * The result note is readable (review 2026-11-10: squeezed to 2-3 lines, its key lines out of view,
 * cut off completely on a phone held sideways): on the iPhone 17 Pro's Safari screen (402×681) its
 * first lines are all in view, "More ▾" opens all of it when it doesn't fit, it sits beside the gauge
 * sideways, and with the camera paused "Resume camera" moves up instead of being covered.
 * With the gauge shown (check 2026-11-10), the coin choice makes room while a note shows, the gauge
 * is smaller while no photo takes itself, and on a small phone "More ▾" doesn't cover a line.
 */
import { existsSync, readFileSync } from 'node:fs';
import { generatePuzzle, renderScene } from '../synth/index';
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

type Box = { x: number; y: number; width: number; height: number };
const apart = (a: Box, b: Box) => a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1 || a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1;

/** Every pair of these is apart (nothing drawn on top of anything else). */
async function allApart(page: Page, parts: Record<string, string>): Promise<void> {
  const boxes: Record<string, Box> = {};
  for (const [k, sel] of Object.entries(parts)) boxes[k] = (await page.locator(sel).first().boundingBox())!;
  const keys = Object.keys(boxes);
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++) expect(apart(boxes[keys[i]!]!, boxes[keys[j]!]!), `${keys[i]} × ${keys[j]}`).toBe(true);
}

let photo: Buffer = Buffer.alloc(0);
/** The same pieces with many of them touching: a result note of several lines. */
let crowded: Buffer = Buffer.alloc(0);
/** Only four pieces: "Hardly any pieces", and no photo takes itself until a tap. */
let few: Buffer = Buffer.alloc(0);
test.beforeAll(async () => {
  const puzzle = generatePuzzle({ cols: 8, rows: 6, cellMm: [17.8, 19.4], seed: 12 });
  const scene = {
    puzzle,
    seed: 44,
    markers: [],
    layout: { areaMm: [600, 450] as [number, number], originMm: [100, 80] as [number, number] },
    camera: { x: 400, y: 305, heightMm: 680, tiltDeg: 1, imageSize: [4032, 3024] as [number, number] },
    light: { dirDeg: 200 },
  };
  photo = (await renderScene(scene)).jpeg;
  crowded = (await renderScene({ ...scene, layout: { ...scene.layout, touchingShare: 0.4 } })).jpeg;
  few = (await renderScene({ ...scene, puzzle: generatePuzzle({ cols: 2, rows: 2, cellMm: [17.8, 19.4], seed: 5 }) })).jpeg;
});

/** A marker-free puzzle, with one piece on the table (so the screen opens on close-ups, with a map) or none. */
async function puzzleWithOnePiece(page: Page, id: string, onePiece = true, scanMode?: 'quick' | 'full'): Promise<void> {
  await page.goto('./');
  await page.evaluate(
    async ({ pid, onePiece, scanMode }) => {
      const req = indexedDB.open('puzzle-lens');
      const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      await new Promise<void>((res) => {
        const tx = dbh.transaction(['projects', 'pieces', 'settings'], 'readwrite');
        if (scanMode) tx.objectStore('settings').put({ key: 'scanMode', value: scanMode });
        tx.objectStore('projects').put({
          id: pid,
          name: 'No camera',
          createdAt: 1,
          updatedAt: 2,
          pieceCount: 48,
          grid: { cols: 8, rows: 6, source: 'suggested' },
          box: null,
          markerMap: null,
          tableModel: null,
          piecePitch: null,
          setupStep: 6,
          tracking: 'pieces',
        });
        if (onePiece)
          tx.objectStore('pieces').put({
            id: 'pc1',
            projectId: pid,
            createdAt: 1,
            updatedAt: 1,
            status: 'table',
            table: { x: 300, y: 200, angleDeg: 0, lastSeen: 1, snapId: 's' },
            outlineMm: [-10, -10, 10, -10, 10, 10, -10, 10],
            areaMm2: 400,
            sizeMm: [20, 20],
            colour: { meanLab: [50, 0, 0], hueHist: [1, 0, 0, 0, 0, 0, 0, 0] },
            thumbBlobId: null,
            seen: 1,
            bestPxPerMm: 4,
            flags: {},
            patch: null,
          });
        tx.oncomplete = () => res();
      });
      dbh.close();
    },
    { pid: id, onePiece, scanMode },
  );
  // The app reads its settings when it starts.
  if (scanMode) await page.reload();
}

/** Camera access refused, on the Scan screen of puzzle `id`. */
async function scanWithoutCamera(page: Page, id: string): Promise<void> {
  await page.evaluate((pid) => (location.hash = `#/puzzle/${pid}`), id);
  await page.getByTestId('scan-pieces').click();
  await expect(page.getByTestId('camera-problem')).toBeVisible({ timeout: 30_000 });
}

for (const size of [
  { width: 375, height: 812 },
  { width: 430, height: 932 },
]) {
  test.describe(`scan screen at ${size.width}×${size.height}`, () => {
    test.use({ viewport: size, colorScheme: 'light' });

    test('camera refused: a readable notice, and nothing on top of anything else', async ({ page }) => {
      await page.addInitScript(() => {
        navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
      });
      await puzzleWithOnePiece(page, 'e2e-no-camera');
      await scanWithoutCamera(page, 'e2e-no-camera');
      const notice = page.getByTestId('camera-problem');
      // Light text on the dark box, in the light theme too (it was dark on dark: 1.05:1).
      expect(await notice.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(238, 242, 246)');
      // No camera, no map to aim with: only what still works is shown. "Start camera" once, in the
      // notice (a second one in the middle of the screen landed on the buttons).
      await expect(page.getByTestId('coverage-map')).toHaveCount(0);
      await expect(page.getByTestId('start-camera')).toHaveCount(1);
      await expect(notice.getByTestId('start-camera')).toBeVisible();
      await allApart(page, {
        notice: '[data-testid="camera-problem"]',
        counts: '.scan-counts',
        overview: '[data-testid="mode-overview"]',
        detail: '[data-testid="mode-detail"]',
        pick: '[data-testid="pick-photo"]',
        snap: '[data-testid="snap"]',
      });
      // Both ways out of it still work: start the camera, or choose a photo.
      await page.getByTestId('start-camera').click({ trial: true });
      await page.getByTestId('pick-photo').click({ trial: true });
    });

    for (const scanMode of ['full', 'quick'] as const) {
      // WebKit keeps photos (Blobs) in IndexedDB only in a profile on disk.
      test.describe(() => {
        test.use({ persistentStorage: true });
        test(`camera refused, then a chosen photo (${scanMode} scan): the result note fits too`, async ({ page }) => {
          test.setTimeout(180_000);
          await page.addInitScript(() => {
            navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
          });
          const id = `e2e-no-camera-photo-${scanMode}`;
          await puzzleWithOnePiece(page, id, false, scanMode);
          await scanWithoutCamera(page, id);
          await page.getByTestId('pick-photo-input').setInputFiles({ name: 'table.jpg', mimeType: 'image/jpeg', buffer: photo });
          await expect(page.getByTestId('scan-note')).toContainText('Found', { timeout: 150_000 });
          // Full scan goes on to close-ups; quick stays on overviews (the coin choice makes room while the note shows).
          await expect(page.getByTestId('table-camera')).toHaveAttribute('data-mode', scanMode === 'full' ? 'detail' : 'overview');
          await allApart(page, {
            notice: '[data-testid="camera-problem"]',
            note: '[data-testid="scan-note"]',
            counts: '.scan-counts',
            overview: '[data-testid="mode-overview"]',
            detail: '[data-testid="mode-detail"]',
            pick: '[data-testid="pick-photo"]',
            last: '[data-testid="show-photo"]',
            snap: '[data-testid="snap"]',
          });
          // Nothing of the panel is cut off at its top (it is clipped to half the screen).
          const panel = (await page.locator('.table-camera-extra').boundingBox())!;
          expect((await page.getByTestId('scan-note').boundingBox())!.y).toBeGreaterThanOrEqual(panel.y - 1);
          for (const id of ['start-camera', 'mode-overview', 'mode-detail', 'pick-photo', 'show-photo', 'scan-note'])
            await page.getByTestId(id).click({ trial: true });
        });
      });
    }

    test('a puzzle that is not on this iPhone: top bar with a way back', async ({ page }) => {
      await page.goto('./#/scan/not-here');
      await expect(page.getByTestId('scan-missing')).toContainText('not on this iPhone');
      await page.getByRole('button', { name: 'Back to home' }).click();
      await expect(page.locator('#app > .app.route-home')).toBeAttached();
    });
  });
}

/**
 * Per paragraph of the result note: every line of it in view, i.e. inside the note's window (it
 * scrolls), inside the screen, not clipped by a box around it, and not under "More ▾".
 */
async function noteLinesInView(page: Page): Promise<boolean[]> {
  return page.getByTestId('scan-note').evaluate((note) => {
    const n = note.getBoundingClientRect();
    let top = Math.max(0, n.top + note.clientTop);
    let bottom = Math.min(innerHeight, n.top + note.clientTop + note.clientHeight);
    let left = 0;
    let right = innerWidth;
    // A box that hides what sticks out clips the note (a fixed note escapes the boxes above it).
    let fixed = getComputedStyle(note).position === 'fixed';
    for (let a = note.parentElement; a && !fixed; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.position === 'fixed') fixed = true;
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const b = a.getBoundingClientRect();
      top = Math.max(top, b.top);
      bottom = Math.min(bottom, b.bottom);
      left = Math.max(left, b.left);
      right = Math.min(right, b.right);
    }
    const more = document.querySelector('[data-testid="scan-note-more"]')?.getBoundingClientRect();
    return [...note.querySelectorAll('p')].map((p) => {
      const range = document.createRange();
      range.selectNodeContents(p);
      const lines = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
      // The letters: a line's box less ~3 px of spacing above and below.
      return (
        lines.length > 0 &&
        lines.every(
          (r) =>
            r.top + 3 >= top &&
            r.bottom - 3 <= bottom &&
            r.left >= left - 0.5 &&
            r.right <= right + 0.5 &&
            !(more && more.top < r.bottom - 3 && more.bottom > r.top + 3 && more.left < r.right && more.right > r.left),
        )
      );
    });
  });
}

/** "More ▾" lies over a line of the note that is in its window (it should sit on the padding only). */
async function moreCoversALine(page: Page): Promise<boolean> {
  return page.getByTestId('scan-note').evaluate((note) => {
    const more = document.querySelector('[data-testid="scan-note-more"]')?.getBoundingClientRect();
    if (!more) return false;
    const n = note.getBoundingClientRect();
    const top = n.top + note.clientTop;
    const bottom = top + note.clientHeight;
    return [...note.querySelectorAll('p')].some((p) => {
      const range = document.createRange();
      range.selectNodeContents(p);
      return [...range.getClientRects()].some(
        (r) =>
          r.width > 0 &&
          r.bottom - 3 > top &&
          r.top + 3 < bottom &&
          more.top < r.bottom - 3 &&
          more.bottom > r.top + 3 &&
          more.left < r.right &&
          more.right > r.left,
      );
    });
  });
}

/** The whole note box is on the screen and not cut by a box around it. */
async function noteBoxInView(page: Page): Promise<boolean> {
  return page.getByTestId('scan-note').evaluate((note) => {
    const n = note.getBoundingClientRect();
    if (n.height < 40 || n.top < 0 || n.left < 0 || n.bottom > innerHeight || n.right > innerWidth) return false;
    let fixed = getComputedStyle(note).position === 'fixed';
    for (let a = note.parentElement; a && !fixed; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.position === 'fixed') fixed = true;
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const b = a.getBoundingClientRect();
      if (n.top < b.top - 0.5 || n.bottom > b.bottom + 0.5 || n.left < b.left - 0.5 || n.right > b.right + 0.5) return false;
    }
    return true;
  });
}

/** What must stay apart from the note and from each other (and stay tappable). */
const CONTROLS = {
  note: '[data-testid="scan-note"]',
  counts: '.scan-counts',
  overview: '[data-testid="mode-overview"]',
  detail: '[data-testid="mode-detail"]',
  pick: '[data-testid="pick-photo"]',
  last: '[data-testid="show-photo"]',
  snap: '[data-testid="snap"]',
};

test.describe('the result note is readable (review 2026-11-10)', () => {
  // The iPhone 17 Pro in Safari (402×681); WebKit keeps photos (Blobs) in IndexedDB only in a profile on disk.
  test.use({ persistentStorage: true, viewport: { width: 402, height: 681 }, colorScheme: 'light' });

  /** The Scan screen with the camera on and the tilt sensor not allowed yet, then a chosen photo of many touching pieces (quick scan: stays on overviews). */
  async function crowdedNote(page: Page, id: string): Promise<void> {
    await puzzleWithOnePiece(page, id, false, 'quick');
    await page.evaluate((pid) => (location.hash = `#/puzzle/${pid}`), id);
    await page.getByTestId('scan-pieces').click();
    await expect(page.getByTestId('allow-tilt')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('pick-photo-input').setInputFiles({ name: 'table.jpg', mimeType: 'image/jpeg', buffer: crowded });
    await expect(page.getByTestId('scan-note')).toContainText('Quick scan done', { timeout: 150_000 });
    // Found…, the touching pieces (two lines), …, Quick scan done (two lines).
    expect(await page.getByTestId('scan-note').locator('p').count()).toBeGreaterThanOrEqual(3);
  }

  test('a long note: its lines in view, "More ▾" when it doesn’t fit, beside the gauge sideways', async ({ page }) => {
    test.setTimeout(180_000);
    await crowdedNote(page, 'e2e-note-room');
    // All of it in view at 402×681 (only its first two or three lines showed). It fits, so the coin
    // choice stays (check 2026-11-10: only a note that doesn't fit takes its place).
    expect(await noteLinesInView(page)).not.toContain(false);
    await expect(page.locator('.coin-pick')).toBeVisible();
    await allApart(page, { ...CONTROLS, tilt: '[data-testid="allow-tilt"]' });
    await page.screenshot({ path: test.info().outputPath('note-402x681.png') });

    // An iPhone SE in Safari (375×553): with the coin choice it doesn't all fit, so the coin choice makes
    // room (back once the note is tapped away, at the end) and then all of it is in view.
    await page.setViewportSize({ width: 375, height: 553 });
    await expect(page.locator('.coin-pick')).toBeHidden();
    await expect.poll(async () => (await noteLinesInView(page)).includes(false)).toBe(false);
    await expect(page.getByTestId('scan-note-more')).toHaveCount(0);
    // Shorter still (375×500): its first lines are in view, and "More ▾" says there is more and opens all
    // of it; a tap closes that again and the note stays.
    await page.setViewportSize({ width: 375, height: 500 });
    await expect(page.getByTestId('scan-note-more')).toBeVisible();
    expect((await noteLinesInView(page))[0]).toBe(true);
    await allApart(page, { ...CONTROLS, tilt: '[data-testid="allow-tilt"]' });
    await page.getByTestId('scan-note-more').click();
    const sheet = page.getByTestId('scan-note-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('p')).toHaveCount(await page.getByTestId('scan-note').locator('p').count());
    await expect(sheet.locator('p').last()).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: test.info().outputPath('note-sheet-375x500.png') });
    await page.getByTestId('scan-note-close').click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByTestId('scan-note')).toBeVisible();

    // Sideways (874×402): the note is in the free column on the left, not cut off, its first lines in
    // view, apart from the buttons and from "Allow the tilt sensor". (The panel itself still lies over
    // the middle there, as it always did.)
    await page.setViewportSize({ width: 874, height: 402 });
    await expect.poll(() => noteBoxInView(page)).toBe(true);
    expect((await noteLinesInView(page)).slice(0, 2)).toEqual([true, true]);
    // The coin choice makes room sideways too, so the middle panel stays below "Allow the tilt sensor",
    // which can still be tapped (check 2026-11-10).
    await expect(page.locator('.coin-pick')).toBeHidden();
    await page.getByTestId('allow-tilt').click({ trial: true, timeout: 5_000 });
    const note = (await page.getByTestId('scan-note').boundingBox())!;
    for (const sel of ['[data-testid="allow-tilt"]', ...Object.values(CONTROLS).slice(1), '[data-testid="camera-close"]'])
      expect(apart(note, (await page.locator(sel).first().boundingBox())!), sel).toBe(true);
    await page.screenshot({ path: test.info().outputPath('note-874x402.png') });
    await page.getByTestId('scan-note').click();
    await expect(page.getByTestId('scan-note')).toHaveCount(0);
    await expect(page.locator('.coin-pick')).toBeVisible();
  });

  test('camera paused (as while the photo library is open): "Resume camera" moves up, the note below it', async ({ page }) => {
    test.setTimeout(180_000);
    await crowdedNote(page, 'e2e-note-paused');
    // The system mutes the camera; it counts as paused 2.5 s later.
    await page.evaluate(() => {
      const t = ((document.querySelector('[data-testid="live-video"]') as HTMLVideoElement).srcObject as MediaStream).getVideoTracks()[0]!;
      Object.defineProperty(t, 'muted', { get: () => true, configurable: true });
      t.dispatchEvent(new Event('mute'));
    });
    const resume = page.getByRole('button', { name: 'Resume camera' });
    await expect(resume).toBeVisible({ timeout: 10_000 });
    expect(await noteLinesInView(page)).not.toContain(false);
    await allApart(page, { ...CONTROLS, resume: '.live-center button' });
    await page.screenshot({ path: test.info().outputPath('note-paused-402x681.png') });
    for (const id of ['mode-overview', 'mode-detail', 'pick-photo', 'show-photo', 'scan-note']) await page.getByTestId(id).click({ trial: true });
    await resume.click({ trial: true });
  });

  /** The tilt sensor allowed and the phone held tilted (so no photo takes itself): the gauge with its height line. */
  async function gaugeOn(page: Page): Promise<void> {
    await expect(page.getByTestId('allow-tilt')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('allow-tilt').click();
    await page.evaluate(() => {
      // WebKit here can't construct a DeviceOrientationEvent: a plain event with the same fields.
      setInterval(() => dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: 0, beta: 20, gamma: 0 })), 50);
    });
    await expect(page.locator('.gauge-sub')).toBeVisible({ timeout: 120_000 });
  }

  // The gauge needs pieces in the camera's view: the synthetic table.
  test.describe(() => {
    test.use({ fakeCameraOptions: { width: 4032, height: 3024, fps: 4 } });

    test('with the gauge: smaller only for a note that doesn’t fit while no photo takes itself; on a small phone "More ▾" covers no line', async ({ page }) => {
      test.setTimeout(300_000);
      await page.addInitScript(
        (url) => ((window as unknown as { __fakeScene?: string }).__fakeScene = url),
        `data:image/jpeg;base64,${photo.toString('base64')}`,
      );
      await puzzleWithOnePiece(page, 'e2e-note-gauge', false, 'full');
      await page.evaluate((pid) => (location.hash = `#/puzzle/${pid}`), 'e2e-note-gauge');
      await page.getByTestId('scan-pieces').click();
      await gaugeOn(page);
      const note = page.getByTestId('scan-note');

      // Hardly any pieces: no photo takes itself until a tap. Its short note fits beside the full gauge,
      // so the gauge keeps its height line and the coin choice stays (check 2026-11-10: the gauge must
      // shrink only for a note that needs the room).
      await page.getByTestId('pick-photo-input').setInputFiles({ name: 'few.jpg', mimeType: 'image/jpeg', buffer: few });
      await expect(note).toContainText('Hardly any pieces', { timeout: 150_000 });
      await expect(page.locator('.gauge-sub')).toBeVisible();
      await expect(page.locator('.coin-pick')).toBeVisible();
      expect(await noteLinesInView(page)).not.toContain(false);
      await allApart(page, { ...CONTROLS, gauge: '.gauge' });
      await page.screenshot({ path: test.info().outputPath('gauge-full-402x681.png') });

      // An iPhone SE in Safari (375×553): now the note doesn't fit. The gauge is smaller (no height line, a
      // smaller face), the coin choice makes room and the note gets the room below the gauge (with the
      // full gauge, a finished puzzle's note showed only its count).
      await page.setViewportSize({ width: 375, height: 553 });
      await expect(page.locator('.gauge-sub')).toBeHidden();
      expect((await page.locator('.gauge svg').boundingBox())!.height).toBeLessThanOrEqual(73);
      await expect(page.locator('.coin-pick')).toBeHidden();
      expect(await noteLinesInView(page)).not.toContain(false);
      await allApart(page, { ...CONTROLS, gauge: '.gauge' });
      await page.screenshot({ path: test.info().outputPath('gauge-small-375x553.png') });
      await page.setViewportSize({ width: 402, height: 681 });

      // A good photo: photos take themselves again, the gauge is back to its size and the note below it.
      await page.getByTestId('pick-photo-input').setInputFiles({ name: 'table.jpg', mimeType: 'image/jpeg', buffer: crowded });
      await expect(note).toContainText('Found', { timeout: 150_000 });
      await expect(page.getByTestId('table-camera')).toHaveAttribute('data-mode', 'detail');
      await expect(page.locator('.gauge-sub')).toBeVisible();
      await allApart(page, { ...CONTROLS, gauge: '.gauge', map: '[data-testid="coverage-map"]' });

      // An iPhone SE in Safari (375×553): the note is squeezed to about two lines. "More ▾" says there
      // is more without covering any line that shows, and keeps clear of the gauge and the buttons.
      await page.setViewportSize({ width: 375, height: 553 });
      await expect(page.getByTestId('scan-note-more')).toBeVisible();
      await expect.poll(() => moreCoversALine(page)).toBe(false);
      // (The panel itself reaches up to the gauge on this screen, as it did before.)
      const more = (await page.getByTestId('scan-note-more').boundingBox())!;
      for (const sel of ['.gauge', '.scan-counts', '[data-testid="mode-overview"]', '[data-testid="mode-detail"]'])
        expect(apart(more, (await page.locator(sel).first().boundingBox())!), sel).toBe(true);
      await page.screenshot({ path: test.info().outputPath('gauge-more-375x553.png') });
      await page.getByTestId('scan-note-more').click({ trial: true });
    });
  });

  // The owner's nearly finished puzzle (21 gaps, loose pieces beside it): a six-paragraph note. Only on
  // this Mac: the owner's photos are never committed (test/fixtures/real/README.md).
  const nearlyFinished = new URL('../fixtures/real/IMG_9280.jpeg', import.meta.url);
  for (const camera of ['on', 'refused', 'gauge'] as const) {
    test.describe(() => {
      // The gauge needs pieces in the camera's view: the synthetic table.
      if (camera === 'gauge') test.use({ fakeCameraOptions: { width: 4032, height: 3024, fps: 4 } });

      test(`the nearly finished puzzle, camera ${camera}: the count and what to do next are in view`, async ({ page }) => {
        test.skip(!existsSync(nearlyFinished), 'needs the owner’s photo IMG_9280 in test/fixtures/real/');
        test.setTimeout(300_000);
        if (camera === 'refused')
          await page.addInitScript(() => {
            navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
          });
        if (camera === 'gauge')
          await page.addInitScript(
            (url) => ((window as unknown as { __fakeScene?: string }).__fakeScene = url),
            `data:image/jpeg;base64,${photo.toString('base64')}`,
          );
        const id = `e2e-note-finished-${camera}`;
        await page.goto('./');
        await page.evaluate(async (pid) => {
          const req = indexedDB.open('puzzle-lens');
          const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
          await new Promise<void>((res) => {
            const tx = dbh.transaction('projects', 'readwrite');
            tx.objectStore('projects').put({
              id: pid,
              name: 'The Kiss',
              createdAt: 1,
              updatedAt: 2,
              pieceCount: 1000,
              grid: { cols: 28, rows: 36, source: 'suggested' },
              box: null,
              markerMap: null,
              tableModel: null,
              piecePitch: null,
              setupStep: 6,
              tracking: 'pieces',
            });
            tx.oncomplete = () => res();
          });
          dbh.close();
        }, id);
        await page.evaluate((pid) => (location.hash = `#/puzzle/${pid}`), id);
        await page.getByTestId('scan-pieces').click();
        if (camera === 'gauge') await gaugeOn(page);
        else await expect(page.getByTestId(camera === 'on' ? 'allow-tilt' : 'camera-problem')).toBeVisible({ timeout: 30_000 });
        await page.getByTestId('pick-photo-input').setInputFiles({ name: 'IMG_9280.jpeg', mimeType: 'image/jpeg', buffer: readFileSync(nearlyFinished) });
        const note = page.getByTestId('scan-note');
        await expect(note).toContainText('Finished puzzle', { timeout: 240_000 });
        const texts = await note.locator('p').allInnerTexts();
        const shown = await noteLinesInView(page);
        const act = texts.flatMap((t, i) => (/^Saved|loose piece/.test(t) ? [i] : []));
        // The count and the grid check, then the saved spots and the loose pieces (they came after the
        // long list of gaps, out of view; with the gauge, only the count showed).
        expect(act.length).toBe(2);
        expect(shown.slice(0, 2)).toEqual([true, true]);
        expect(act.map((i) => shown[i])).toEqual([true, true]);
        // What doesn't fit is not cut off without a sign: "More ▾" says so.
        expect(await note.evaluate((n) => n.scrollHeight <= n.clientHeight + 2 || document.querySelector('[data-testid="scan-note-more"]') !== null)).toBe(
          true,
        );
        await allApart(page, {
          ...CONTROLS,
          top: camera === 'gauge' ? '.gauge' : camera === 'on' ? '[data-testid="allow-tilt"]' : '[data-testid="camera-problem"]',
        });
        await page.screenshot({ path: test.info().outputPath(`finished-${camera}-402x681.png`) });

        // As tall as the owner's Home Screen app (402×778 between its safe areas): all of it in view.
        await page.setViewportSize({ width: 402, height: 778 });
        await expect.poll(async () => (await noteLinesInView(page)).includes(false)).toBe(false);
        await page.screenshot({ path: test.info().outputPath(`finished-${camera}-402x778.png`) });

        await page.setViewportSize({ width: 874, height: 402 });
        await expect.poll(() => noteBoxInView(page)).toBe(true);
        expect((await noteLinesInView(page))[0]).toBe(true);
        await page.screenshot({ path: test.info().outputPath(`finished-${camera}-874x402.png`) });
      });
    });
  }
});
