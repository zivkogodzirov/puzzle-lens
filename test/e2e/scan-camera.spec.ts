/**
 * M9 part 5 (design stage 5): the scan camera laid out like the iPhone Camera app (design plan §3.5 camera
 * chrome, §4 item 5, decisions 14 and 15).
 * - Top bar: Back, the gear, zoom and 🧪 (44 px targets), and under them the status capsule with the one
 *   instruction and a level dot; the level is a reticle in the middle, with nothing else over the middle.
 * - The dock: the mode words (Whole table / Close-ups), the last photo, the shutter and Photos, each with a
 *   name VoiceOver reads and a 44 px or bigger target; the shutter's ring fills while the phone is held still
 *   and then the photo takes itself.
 * - The mini map bottom-left above the dock opens large; the gear opens a sheet with the coin chooser and help.
 * - The tilt sensor is asked once on a card; a refused or paused camera is one card in the middle, with Back
 *   still working; Photos opens the photo picker.
 * - From 375×553 (an iPhone SE in Safari) to 402×874 (the Home Screen app), and sideways (874×402): nothing
 *   overlaps, nothing is cut off, no sideways scroll.
 */
import { generatePuzzle, renderScene } from '../synth/index';
import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';

type Box = { x: number; y: number; width: number; height: number };
const apart = (a: Box, b: Box) => a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1 || a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1;

let photo: Buffer = Buffer.alloc(0);
let scene = '';
test.beforeAll(async () => {
  const puzzle = generatePuzzle({ cols: 8, rows: 6, cellMm: [17.8, 19.4], seed: 12 });
  photo = (
    await renderScene({
      puzzle,
      seed: 44,
      markers: [],
      layout: { areaMm: [600, 450], originMm: [100, 80] },
      camera: { x: 400, y: 305, heightMm: 680, tiltDeg: 1, imageSize: [4032, 3024] },
      light: { dirDeg: 200 },
    })
  ).jpeg;
  scene = `data:image/jpeg;base64,${photo.toString('base64')}`;
});

/** A marker-free puzzle; `onePiece`: one piece on the table already (the screen opens on close-ups, with the map). */
async function seedPuzzle(page: Page, id: string, onePiece: boolean): Promise<void> {
  await page.goto('./');
  await page.evaluate(
    async ({ pid, onePiece }) => {
      const req = indexedDB.open('puzzle-lens');
      const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      await new Promise<void>((res) => {
        const tx = dbh.transaction(['projects', 'pieces'], 'readwrite');
        tx.objectStore('projects').put({
          id: pid,
          name: 'Camera',
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
    { pid: id, onePiece },
  );
}

async function openScan(page: Page, id: string): Promise<void> {
  await page.evaluate((pid) => (location.hash = `#/puzzle/${pid}`), id);
  await page.getByTestId('scan-pieces').click();
  await expect(page.getByTestId('table-camera')).toBeVisible();
}

/** Allows the tilt sensor and plays a phone held `beta` degrees from flat (window.__beta changes it later). */
async function tilt(page: Page, beta: number): Promise<void> {
  await expect(page.getByTestId('allow-tilt')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('allow-tilt').click();
  await page.evaluate((b) => {
    const w = window as unknown as { __beta: number };
    w.__beta = b;
    // WebKit here can't construct a DeviceOrientationEvent: a plain event with the same fields.
    setInterval(() => dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: 0, beta: w.__beta, gamma: 0 })), 50);
  }, beta);
}

const refuseCamera = (page: Page) =>
  page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });

/** A button with a name VoiceOver reads and a target at least 44 px each way. */
async function namedTarget(button: Locator, name: RegExp | string): Promise<void> {
  await expect(button).toBeVisible();
  await expect(button).toHaveAccessibleName(name);
  const b = (await button.boundingBox())!;
  expect(Math.min(b.width, b.height), `${String(name)}: at least 44 px`).toBeGreaterThanOrEqual(44);
}

/** The visible chrome: each inside the screen, none over another, none over the middle of the picture. */
async function chromeClear(page: Page, where: string, extra: Record<string, string> = {}): Promise<void> {
  const parts: Record<string, string> = {
    back: '[data-testid="camera-close"]',
    gear: '[data-testid="camera-settings"]',
    zoom: '[data-testid="camera-zoom"]',
    status: '[data-testid="camera-status"]',
    overview: '[data-testid="mode-overview"]',
    detail: '[data-testid="mode-detail"]',
    snap: '[data-testid="snap"]',
    photos: '[data-testid="pick-photo"]',
    counts: '[data-testid="scan-counts"]',
    map: '[data-testid="coverage-map-open"]',
    last: '[data-testid="show-photo"]',
    ...extra,
  };
  const vw = page.viewportSize()!;
  const boxes: Record<string, Box> = {};
  for (const [k, sel] of Object.entries(parts)) {
    const l = page.locator(sel).first();
    if (!(await l.isVisible())) continue;
    const b = (await l.boundingBox())!;
    boxes[k] = b;
    expect(b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= vw.width + 0.5 && b.y + b.height <= vw.height + 0.5, `${where}: ${k} inside the screen`).toBe(true);
  }
  const keys = Object.keys(boxes);
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++) expect(apart(boxes[keys[i]!]!, boxes[keys[j]!]!), `${where}: ${keys[i]} × ${keys[j]}`).toBe(true);
  // The middle of the picture (a 100 px square) stays clear (the level reticle is drawn there, nothing else).
  const mid = { x: vw.width / 2 - 50, y: vw.height / 2 - 50, width: 100, height: 100 };
  for (const k of keys) if (!k.startsWith('card')) expect(apart(boxes[k]!, mid), `${where}: ${k} over the middle of the picture`).toBe(true);
  const m = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(m.scroll, `${where}: no sideways scroll`).toBeLessThanOrEqual(m.client);
}

const SIZES = [
  { width: 375, height: 553 },
  { width: 375, height: 667 },
  { width: 402, height: 681 },
  { width: 402, height: 874 },
  { width: 874, height: 402 },
];

test.describe('scan camera (M9 part 5)', () => {
  test.use({ colorScheme: 'light' });

  test.describe(() => {
    // The level needs pieces in the camera's view: the synthetic table.
    // WebKit keeps photos (Blobs) in IndexedDB only in a profile on disk.
    test.use({ fakeCameraOptions: { width: 4032, height: 3024, fps: 4 }, viewport: { width: 402, height: 681 }, persistentStorage: true });

    test('the chrome at every size: named 44 px targets, nothing over anything or the middle; mode words; the mini map; the gear sheet', async ({ page }) => {
      test.setTimeout(240_000);
      await page.addInitScript((url) => ((window as unknown as { __fakeScene?: string }).__fakeScene = url), scene);
      // M9 part 6 fixes: when each level message showed and when VoiceOver was told (only one that stayed 1.5 s).
      await page.addInitScript(() => {
        const shown: { t: number; text: string }[] = [];
        const said: { t: number; text: string }[] = [];
        Object.assign(window, { __shown: shown, __said: said });
        new MutationObserver(() => {
          const m = document.querySelector('.gauge-msg')?.textContent ?? '';
          if (m && shown.at(-1)?.text !== m) shown.push({ t: performance.now(), text: m });
          const a = document.querySelector('[data-testid="announce"]')?.textContent ?? '';
          if (a && said.at(-1)?.text !== a) said.push({ t: performance.now(), text: a });
        }).observe(document, { subtree: true, childList: true, characterData: true });
      });
      await seedPuzzle(page, 'cam-chrome', true);
      await openScan(page, 'cam-chrome');
      // Tilted, so no photo takes itself while the chrome is checked.
      await tilt(page, 20);
      await expect(page.getByTestId('level-gauge')).toBeVisible({ timeout: 120_000 });
      await expect(page.getByTestId('camera-status')).toContainText('Hold the phone flat');
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { __said: { text: string }[] }).__said.some((s) => s.text.includes('Hold the phone flat'))))
        .toBe(true);
      type Line = { t: number; text: string };
      const { shown, said } = await page.evaluate(() => {
        const w = window as unknown as { __shown: Line[]; __said: Line[] };
        return { shown: w.__shown, said: w.__said };
      });
      for (const s of said) {
        const last = shown.filter((m) => m.t <= s.t).at(-1);
        if (last && last.text === s.text) expect(s.t - last.t, `"${s.text}" read after it stayed`).toBeGreaterThanOrEqual(1400);
      }
      await expect(page.getByTestId('camera-status')).toHaveAttribute('data-level', 'tilted');
      // The reticle: 104 px, in the middle, no panel behind it.
      const ret = (await page.locator('.gauge svg').boundingBox())!;
      expect(Math.round(ret.width)).toBe(104);
      expect(await page.locator('.gauge').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');

      await namedTarget(page.getByTestId('camera-close'), 'Back');
      await namedTarget(page.getByTestId('camera-settings'), 'Coin and help');
      await namedTarget(page.getByTestId('snap'), 'Take the photo now');
      await namedTarget(page.getByTestId('pick-photo'), /Choose a photo/);
      await expect(page.getByTestId('pick-photo').locator('svg[data-icon="image"]')).toHaveCount(1);
      const snap = (await page.getByTestId('snap').boundingBox())!;
      expect(Math.round(snap.width)).toBe(78);
      for (const id of ['mode-overview', 'mode-detail']) {
        const b = (await page.getByTestId(id).boundingBox())!;
        expect(Math.min(b.width, b.height), id).toBeGreaterThanOrEqual(44);
      }
      await expect(page.getByTestId('mode-overview')).toHaveText('Whole table');
      await expect(page.getByTestId('mode-detail')).toHaveText('Close-ups');
      await expect(page.getByTestId('scan-counts')).toHaveText(/^1 piece found · 0 close-ups/);

      for (const size of SIZES) {
        await page.setViewportSize(size);
        await chromeClear(page, `${size.width}×${size.height}`);
        // The map is bottom-left, just above the dock.
        const map = (await page.getByTestId('coverage-map-open').boundingBox())!;
        const dockTop = (await page.getByTestId('camera-dock').boundingBox())!;
        expect(map.x, 'map on the left').toBeLessThan(size.width / 4);
        if (size.width < size.height) expect(map.y + map.height, 'map above the dock').toBeLessThanOrEqual(dockTop.y + 1);
        else expect(map.y + map.height, 'map at the bottom').toBeGreaterThan(size.height * 0.6);
        await page.screenshot({ path: test.info().outputPath(`chrome-${size.width}x${size.height}.png`) });
      }
      await page.setViewportSize({ width: 402, height: 681 });

      // The mode words switch the kind of photo (the selected one yellow and underlined, and pressed).
      await expect(page.getByTestId('table-camera')).toHaveAttribute('data-mode', 'detail');
      await expect(page.getByTestId('mode-detail')).toHaveAttribute('aria-pressed', 'true');
      await page.getByTestId('mode-overview').click();
      await expect(page.getByTestId('table-camera')).toHaveAttribute('data-mode', 'overview');
      await expect(page.getByTestId('mode-overview')).toHaveAttribute('aria-pressed', 'true');
      expect(await page.getByTestId('mode-overview').evaluate((el) => getComputedStyle(el).color)).toBe('rgb(255, 214, 10)');
      expect(await page.getByTestId('mode-detail').evaluate((el) => getComputedStyle(el).color)).toBe('rgb(255, 255, 255)');
      await page.getByTestId('mode-detail').click();
      await expect(page.getByTestId('table-camera')).toHaveAttribute('data-mode', 'detail');

      // The mini map opens large, with what it shows in words.
      await page.getByTestId('coverage-map-open').click();
      const mapSheet = page.getByTestId('coverage-map-sheet');
      await expect(mapSheet).toBeVisible();
      await expect(mapSheet.getByTestId('coverage-map-big')).toBeVisible();
      await expect(mapSheet).toContainText('Green: a close-up has them');
      await page.getByTestId('coverage-map-sheet-close').click();
      await expect(mapSheet).toHaveCount(0);

      // The gear: coin chooser and help in a sheet.
      await page.getByTestId('camera-settings').click();
      const gear = page.getByTestId('camera-settings-sheet');
      await expect(gear).toBeVisible();
      await expect(gear.getByTestId('scan-help')).toContainText('How to scan');
      await gear.getByTestId('coin-select').selectOption('mk-5');
      await page.getByTestId('camera-settings-sheet-close').click();
      await expect(gear).toHaveCount(0);
      await page.getByTestId('camera-settings').click();
      await expect(page.getByTestId('coin-select')).toHaveValue('mk-5');
      await page.screenshot({ path: test.info().outputPath('gear-402x681.png') });
      await page.keyboard.press('Escape');
      await expect(gear).toHaveCount(0);
    });

    test('the shutter’s ring fills while the phone is held still, then the photo takes itself; then the dock has its three buttons', async ({ page }) => {
      test.setTimeout(300_000);
      await page.addInitScript((url) => ((window as unknown as { __fakeScene?: string }).__fakeScene = url), scene);
      // No pieces yet: a whole-table photo, which takes itself when the phone is flat and still.
      await seedPuzzle(page, 'cam-ring', false);
      await openScan(page, 'cam-ring');
      await expect(page.getByTestId('table-camera')).toHaveAttribute('data-mode', 'overview');
      await tilt(page, 20);
      await expect(page.getByTestId('level-gauge')).toBeVisible({ timeout: 120_000 });
      // Tilted: the ring stays empty.
      await page.waitForTimeout(1500);
      await expect(page.getByTestId('snap-ring')).toHaveAttribute('data-fill', '0.00');
      // Flat: it fills (seen part-way), and then the photo takes itself.
      await page.evaluate(() => {
        const w = window as unknown as { __beta: number; __fills: number[] };
        w.__fills = [];
        w.__beta = 1;
        const ring = () => document.querySelector('[data-testid="snap-ring"]');
        const iv = setInterval(() => {
          const f = Number(ring()?.getAttribute('data-fill') ?? 0);
          w.__fills.push(f);
          if (document.querySelector('[data-testid="camera-busy"]')) clearInterval(iv);
        }, 20);
      });
      await expect(page.getByTestId('scan-note')).toContainText('Found', { timeout: 150_000 });
      const fills = await page.evaluate(() => (window as unknown as { __fills: number[] }).__fills);
      expect(
        fills.some((f) => f > 0 && f < 1),
        `part-way fills seen: ${fills
          .filter((f) => f > 0)
          .slice(0, 10)
          .join(', ')}`,
      ).toBe(true);
      // M9 part 5 result: the result is a sheet over the dock; "Take another" closes it.
      await page.getByTestId('result-another').click();
      await expect(page.getByTestId('scan-note')).toHaveCount(0);
      // The last photo is in the dock now: three buttons with names, 44 px or bigger.
      await namedTarget(page.getByTestId('show-photo'), 'See the last photo');
      await namedTarget(page.getByTestId('snap'), 'Take the photo now');
      await namedTarget(page.getByTestId('pick-photo'), /Choose a photo/);
      const thumb = (await page.getByTestId('show-photo').boundingBox())!;
      expect(Math.round(thumb.width)).toBe(50);
      const snap = (await page.getByTestId('snap').boundingBox())!;
      const photos = (await page.getByTestId('pick-photo').boundingBox())!;
      // Last photo left of the shutter, Photos right, on one row.
      expect(thumb.x + thumb.width).toBeLessThan(snap.x);
      expect(photos.x).toBeGreaterThan(snap.x + snap.width);
      expect(Math.abs(thumb.y + thumb.height / 2 - (snap.y + snap.height / 2))).toBeLessThan(2);
      await page.screenshot({ path: test.info().outputPath('after-photo-402x681.png') });
    });

    test('the tilt sensor: one card in the middle; "Not now" leaves a small button; allowing shows the level', async ({ page }) => {
      test.setTimeout(180_000);
      await page.addInitScript((url) => ((window as unknown as { __fakeScene?: string }).__fakeScene = url), scene);
      await seedPuzzle(page, 'cam-tilt', true);
      await openScan(page, 'cam-tilt');
      const card = page.getByTestId('tilt-card');
      await expect(card).toBeVisible({ timeout: 30_000 });
      await expect(card).toContainText('Allow the tilt sensor');
      await namedTarget(card.getByTestId('allow-tilt'), 'Allow');
      await expect(page.getByTestId('level-gauge')).toHaveCount(0);
      for (const size of SIZES) {
        await page.setViewportSize(size);
        await chromeClear(page, `tilt card ${size.width}×${size.height}`, { card: '[data-testid="tilt-card"]' });
        // Centred across the screen.
        const b = (await card.boundingBox())!;
        expect(Math.abs(b.x + b.width / 2 - (size.width < size.height ? size.width / 2 : (size.width - (await dockWidth(page))) / 2))).toBeLessThan(3);
      }
      await page.setViewportSize({ width: 402, height: 681 });
      await page.screenshot({ path: test.info().outputPath('tilt-card-402x681.png') });
      await card.getByTestId('tilt-later').click();
      await expect(card).toHaveCount(0);
      const small = page.getByTestId('allow-tilt');
      await namedTarget(small, 'Allow the tilt sensor');
      await chromeClear(page, 'tilt later', { allow: '[data-testid="allow-tilt"]' });
      await small.click();
      await page.evaluate(() => setInterval(() => dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: 0, beta: 20, gamma: 0 })), 50));
      await expect(page.getByTestId('allow-tilt')).toHaveCount(0);
      await expect(page.getByTestId('level-gauge')).toBeVisible({ timeout: 120_000 });
    });
  });

  test('camera refused: one card with the steps and Start camera, nothing over it; Back works', async ({ page }) => {
    await refuseCamera(page);
    await seedPuzzle(page, 'cam-refused', true);
    await openScan(page, 'cam-refused');
    const card = page.getByTestId('camera-problem');
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText('Allow the camera');
    await expect(card.locator('ol li')).toHaveCount(3);
    await expect(card).toContainText('Settings › Apps › Safari › Camera');
    // Light text on the dark card in the light theme too.
    expect(await card.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(238, 242, 246)');
    await expect(page.getByTestId('start-camera')).toHaveCount(1);
    await namedTarget(card.getByTestId('start-camera'), 'Start camera');
    // No camera, nothing to aim with: no map.
    await expect(page.getByTestId('coverage-map-open')).toHaveCount(0);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await chromeClear(page, `refused ${size.width}×${size.height}`, { card: '[data-testid="camera-problem"]' });
      await expect(card.getByTestId('start-camera')).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: test.info().outputPath(`refused-${size.width}x${size.height}.png`) });
    }
    await page.setViewportSize({ width: 402, height: 681 });
    await page.getByTestId('start-camera').click();
    await expect(card).toBeVisible();
    await page.getByTestId('camera-close').click();
    await expect(page).toHaveURL(/#\/puzzle\/cam-refused/);
  });

  test('camera paused: Resume camera in the middle and tappable, and Back works', async ({ page }) => {
    await seedPuzzle(page, 'cam-paused', true);
    await openScan(page, 'cam-paused');
    await expect(page.getByTestId('tilt-card')).toBeVisible({ timeout: 30_000 });
    // The system mutes the camera (as while the photo library is open); it counts as paused 2.5 s later.
    await page.evaluate(() => {
      const t = ((document.querySelector('[data-testid="live-video"]') as HTMLVideoElement).srcObject as MediaStream).getVideoTracks()[0]!;
      Object.defineProperty(t, 'muted', { get: () => true, configurable: true });
      t.dispatchEvent(new Event('mute'));
    });
    const resume = page.getByRole('button', { name: 'Resume camera' });
    await expect(resume).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('camera-paused')).toContainText('Camera paused');
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await chromeClear(page, `paused ${size.width}×${size.height}`, { card: '[data-testid="camera-paused"]' });
      await resume.click({ trial: true });
    }
    await page.setViewportSize({ width: 402, height: 681 });
    await page.screenshot({ path: test.info().outputPath('paused-402x681.png') });
    // Back is tapped for real (it couldn't be while paused before).
    await page.getByTestId('camera-close').click();
    await expect(page).toHaveURL(/#\/puzzle\/cam-paused/);
  });

  test.describe(() => {
    // WebKit keeps photos (Blobs) in IndexedDB only in a profile on disk.
    test.use({ persistentStorage: true });

    test('Photos opens the photo picker, and the chosen photo is read', async ({ page }) => {
      test.setTimeout(180_000);
      await refuseCamera(page);
      await seedPuzzle(page, 'cam-photos', false);
      await openScan(page, 'cam-photos');
      await expect(page.getByTestId('camera-problem')).toBeVisible({ timeout: 30_000 });
      const chooser = page.waitForEvent('filechooser');
      await page.getByTestId('pick-photo').click();
      await (await chooser).setFiles({ name: 'table.jpg', mimeType: 'image/jpeg', buffer: photo });
      await expect(page.getByTestId('scan-note')).toContainText('Found', { timeout: 150_000 });
      await namedTarget(page.getByTestId('show-photo'), 'See the last photo');
      await expect(page.getByTestId('show-photo').locator('img')).toHaveAttribute('src', /^blob:/);
    });
  });
});

/** The width of the dock column (sideways). */
async function dockWidth(page: Page): Promise<number> {
  return (await page.getByTestId('camera-dock').boundingBox())!.width;
}
