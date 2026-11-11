/**
 * The Scan screen's layout when something is wrong (M8 part 4, 2026-11-10): with camera access
 * refused, the notice is readable in light mode and nothing is drawn on top of anything else, also
 * once a chosen photo's result note shows; a puzzle that isn't on this iPhone gets the normal top
 * bar with a way back.
 *
 * The result is readable (review 2026-11-10: M8's note was squeezed to 2-3 lines, its key lines out of
 * view, cut off completely on a phone held sideways). M9 part 5 replaced the note with a result sheet:
 * from 375×553 to 402×874 and sideways its title and first lines are in view, the rest a scroll away
 * inside it, nothing cut off sideways, its buttons in view; for the owner's nearly finished puzzle the
 * saved empty spots and the loose pieces are in view as it opens. Closed ("Take another", one tap),
 * nothing lies over the shutter or the other controls, and the gauge is as it was.
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
      // notice (M9 part 5: one card in the middle, between the top bar and the dock).
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
          // M9 part 5 result: the result is a sheet over the screen (tests in "the result sheet is readable");
          // "Take another" closes it, and the screen's own parts are checked below as before.
          await page.getByTestId('result-another').click();
          await expect(page.getByTestId('scan-note')).toHaveCount(0);
          await allApart(page, {
            notice: '[data-testid="camera-problem"]',
            counts: '.scan-counts',
            overview: '[data-testid="mode-overview"]',
            detail: '[data-testid="mode-detail"]',
            pick: '[data-testid="pick-photo"]',
            last: '[data-testid="show-photo"]',
            snap: '[data-testid="snap"]',
          });
          for (const id of ['start-camera', 'mode-overview', 'mode-detail', 'pick-photo', 'show-photo']) await page.getByTestId(id).click({ trial: true });
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
 * M9 part 5 result: per line (<p>) of the result sheet, where it is: `shown` = all of it inside the sheet's list
 * as it is scrolled now and inside the screen; `cut` = some of it lies outside the screen sideways or outside
 * the list across (it could never be read by scrolling).
 */
async function sheetLines(page: Page): Promise<Array<{ text: string; shown: boolean; cut: boolean }>> {
  await settled(page);
  return page.getByTestId('scan-note').evaluate((sheet) => {
    const list = sheet.querySelector('.scan-result-list')!;
    const l = list.getBoundingClientRect();
    const top = Math.max(0, l.top);
    const bottom = Math.min(innerHeight, l.bottom);
    return [...sheet.querySelectorAll('p')].map((p) => {
      const range = document.createRange();
      range.selectNodeContents(p);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
      // The letters: a line's box less ~3 px of spacing above and below.
      return {
        text: p.textContent ?? '',
        shown: rects.length > 0 && rects.every((r) => r.top + 3 >= top && r.bottom - 3 <= bottom),
        cut: rects.some((r) => r.left < Math.max(0, l.left) - 0.5 || r.right > Math.min(innerWidth, l.right) + 0.5),
      };
    });
  });
}

/** Scrolled to its end, the sheet's last line is in view: every line can be read. */
async function lastLineReachable(page: Page): Promise<boolean> {
  await page.locator('[data-testid="scan-note"] .scan-result-list').evaluate((el) => (el.scrollTop = el.scrollHeight));
  const lines = await sheetLines(page);
  await page.locator('[data-testid="scan-note"] .scan-result-list').evaluate((el) => (el.scrollTop = 0));
  return lines.at(-1)!.shown;
}

/** The sheet has stopped moving (it slides up, and its height follows a new screen size). */
async function settled(page: Page): Promise<void> {
  await page
    .getByTestId('scan-note')
    .evaluate((el) => Promise.all((el.closest('.ui-sheet-root') ?? el).getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined))));
}

/** The whole sheet is on the screen, with its buttons in view and at least 44 px. */
async function sheetInView(page: Page): Promise<void> {
  await settled(page);
  const s = (await page.getByTestId('scan-note').boundingBox())!;
  const vp = page.viewportSize()!;
  expect(s.y).toBeGreaterThanOrEqual(-0.5);
  expect(s.y + s.height).toBeLessThanOrEqual(vp.height + 0.5);
  expect(s.x).toBeGreaterThanOrEqual(-0.5);
  expect(s.x + s.width).toBeLessThanOrEqual(vp.width + 0.5);
  for (const id of ['result-another', 'scan-note-close']) {
    const b = (await page.getByTestId(id).boundingBox())!;
    expect(b.y + b.height, id).toBeLessThanOrEqual(vp.height + 0.5);
    expect(Math.min(b.width, b.height), id).toBeGreaterThanOrEqual(44);
  }
  // No sideways scroll.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

/** What must stay apart from each other (and stay tappable) once the sheet is closed. */
const CONTROLS = {
  counts: '.scan-counts',
  overview: '[data-testid="mode-overview"]',
  detail: '[data-testid="mode-detail"]',
  pick: '[data-testid="pick-photo"]',
  last: '[data-testid="show-photo"]',
  snap: '[data-testid="snap"]',
};

/** "Take another" closes the sheet in one tap; then nothing lies over the shutter and the other controls. */
async function takeAnother(page: Page): Promise<void> {
  await page.getByTestId('result-another').click();
  await expect(page.getByTestId('scan-note')).toHaveCount(0);
  for (const sel of Object.values(CONTROLS))
    await expect
      .poll(() =>
        page
          .locator(sel)
          .first()
          .evaluate((el) => {
            const r = el.getBoundingClientRect();
            const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return Boolean(at && (at === el || el.contains(at)));
          }),
      )
      .toBe(true);
}

test.describe('the result sheet is readable (M9 part 5; was "the result note is readable", review 2026-11-10)', () => {
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
    // Ready, the touching pieces, …, Quick scan done.
    expect(await page.getByTestId('scan-note').locator('.scan-result-item').count()).toBeGreaterThanOrEqual(3);
  }

  test('a long result: its lines in view or a scroll away, the buttons in view, at 402×681, 375×553, 375×500 and sideways', async ({ page }) => {
    test.setTimeout(180_000);
    await crowdedNote(page, 'e2e-note-room');
    for (const [width, height] of [
      [402, 681],
      [402, 874],
      [375, 553],
      [375, 500],
      [874, 402],
    ] as const) {
      await page.setViewportSize({ width, height });
      await expect.poll(async () => (await sheetLines(page)).some((l) => l.cut), { message: `${width}×${height}` }).toBe(false);
      const lines = await sheetLines(page);
      // The title, what is new and the first lines are in view; the rest scroll inside the sheet.
      await expect(page.getByTestId('scan-note').locator('.ui-sheet-title')).toBeInViewport({ ratio: 1 });
      expect(
        lines.slice(0, 2).map((l) => l.shown),
        `${width}×${height}`,
      ).toEqual([true, true]);
      expect(await lastLineReachable(page), `${width}×${height}`).toBe(true);
      await sheetInView(page);
      await page.screenshot({ path: test.info().outputPath(`sheet-${width}x${height}.png`) });
    }
    await page.setViewportSize({ width: 402, height: 681 });
    await takeAnother(page);
    await allApart(page, { ...CONTROLS, tilt: '[data-testid="allow-tilt"]' });
  });

  test('camera paused (as while the photo library is open): the sheet reads the same, and "Resume camera" is there once it is closed', async ({ page }) => {
    test.setTimeout(180_000);
    await crowdedNote(page, 'e2e-note-paused');
    // The system mutes the camera; it counts as paused 2.5 s later.
    await page.evaluate(() => {
      const t = ((document.querySelector('[data-testid="live-video"]') as HTMLVideoElement).srcObject as MediaStream).getVideoTracks()[0]!;
      Object.defineProperty(t, 'muted', { get: () => true, configurable: true });
      t.dispatchEvent(new Event('mute'));
    });
    const resume = page.getByRole('button', { name: 'Resume camera' });
    await expect(resume).toBeAttached({ timeout: 10_000 });
    expect((await sheetLines(page)).some((l) => l.cut)).toBe(false);
    await sheetInView(page);
    await page.screenshot({ path: test.info().outputPath('sheet-paused-402x681.png') });
    await page.getByTestId('result-another').click();
    await expect(page.getByTestId('scan-note')).toHaveCount(0);
    await allApart(page, { ...CONTROLS, resume: '[data-testid="camera-paused"] button' });
    for (const id of ['mode-overview', 'mode-detail', 'pick-photo', 'show-photo']) await page.getByTestId(id).click({ trial: true });
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

    test('with the gauge: the sheet over it, and the gauge as it was once it is closed', async ({ page }) => {
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

      // Hardly any pieces: no photo takes itself until a tap.
      await page.getByTestId('pick-photo-input').setInputFiles({ name: 'few.jpg', mimeType: 'image/jpeg', buffer: few });
      await expect(note).toContainText('Hardly any pieces', { timeout: 150_000 });
      for (const [width, height] of [
        [402, 681],
        [375, 553],
      ] as const) {
        await page.setViewportSize({ width, height });
        await expect.poll(async () => (await sheetLines(page)).every((l) => l.shown && !l.cut), { message: `${width}×${height}` }).toBe(true);
        await sheetInView(page);
        await page.screenshot({ path: test.info().outputPath(`gauge-sheet-${width}x${height}.png`) });
      }
      // Closed: the full gauge (its height line), nothing squeezed for a note any more.
      await takeAnother(page);
      await expect(page.locator('.gauge-sub')).toBeVisible();
      await page.setViewportSize({ width: 402, height: 681 });
      await allApart(page, { ...CONTROLS, gauge: '.gauge' });

      // A good photo: the sheet, then photos take themselves again (close-ups next) once it is closed.
      await page.getByTestId('pick-photo-input').setInputFiles({ name: 'table.jpg', mimeType: 'image/jpeg', buffer: crowded });
      await expect(note).toContainText('Found', { timeout: 150_000 });
      await expect(page.getByTestId('table-camera')).toHaveAttribute('data-mode', 'detail');
      await takeAnother(page);
      await expect(page.locator('.gauge-sub')).toBeVisible();
      await allApart(page, { ...CONTROLS, gauge: '.gauge', map: '[data-testid="coverage-map-open"]' });
    });
  });

  // The owner's nearly finished puzzle (21 gaps, loose pieces beside it): the longest result. Only on this Mac:
  // the owner's photos are never committed (test/fixtures/real/README.md).
  const nearlyFinished = new URL('../fixtures/real/IMG_9280.jpeg', import.meta.url);
  for (const camera of ['on', 'refused', 'gauge'] as const) {
    test.describe(() => {
      // The gauge needs pieces in the camera's view: the synthetic table.
      if (camera === 'gauge') test.use({ fakeCameraOptions: { width: 4032, height: 3024, fps: 4 } });

      test(`the nearly finished puzzle, camera ${camera}: the count, the saved spots and the loose pieces in view, all of it readable`, async ({ page }) => {
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
        // From the smallest screen (an iPhone SE in Safari) up to the owner's Home Screen app, and sideways.
        await page.setViewportSize({ width: 375, height: 553 });
        await page.getByTestId('pick-photo-input').setInputFiles({ name: 'IMG_9280.jpeg', mimeType: 'image/jpeg', buffer: readFileSync(nearlyFinished) });
        const note = page.getByTestId('scan-note');
        await expect(note).toContainText('Finished puzzle', { timeout: 240_000 });
        await expect(note.locator('.ui-sheet-title')).toHaveText('Finished puzzle: 28 × 36');
        for (const [width, height] of [
          [375, 553],
          [402, 681],
          [402, 874],
          [874, 402],
        ] as const) {
          await page.setViewportSize({ width, height });
          await expect.poll(async () => (await sheetLines(page)).some((l) => l.cut), { message: `${width}×${height}` }).toBe(false);
          const lines = await sheetLines(page);
          const act = lines.filter((l) => /^Saved|loose piece/.test(l.text));
          // What to do next (the saved spots, the loose pieces) is in view as it opens; the gaps a scroll away.
          expect(act.length).toBe(2);
          if (width < 800)
            expect(
              act.map((l) => l.shown),
              `${width}×${height}`,
            ).toEqual([true, true]);
          expect(await lastLineReachable(page), `${width}×${height}`).toBe(true);
          await sheetInView(page);
          await page.screenshot({ path: test.info().outputPath(`finished-${camera}-${width}x${height}.png`) });
        }
        // Sideways the sheet is short: swiped up (the grabber), the saved spots and the loose pieces are in view too.
        await page.getByTestId('scan-note-grabber').click();
        await expect(note).toHaveAttribute('data-detent', 'large');
        await expect.poll(async () => (await sheetLines(page)).filter((l) => /^Saved|loose piece/.test(l.text)).every((l) => l.shown)).toBe(true);
        await page.screenshot({ path: test.info().outputPath(`finished-${camera}-874x402-large.png`) });
        await page.setViewportSize({ width: 402, height: 681 });
        await takeAnother(page);
      });
    });
  }
});
