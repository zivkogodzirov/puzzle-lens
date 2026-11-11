/**
 * What happens after the scan camera's shutter (M9 part 5, design plan §3.4 "Feedback", §3.8 rule 12, §4 item 5):
 * - the flash, the shutter sound and the haptic tick once per photo (tapped or taken by itself), none for a
 *   photo chosen from the library, none with "Sounds and taps" off, and no flash animation under Reduce Motion;
 * - the wait: the frozen photo, dimmed, with its stages in order; Cancel after 10 s, after which the photo's
 *   result is ignored when it arrives (the catalog's rows are unchanged, the photo helper keeps going);
 * - the result sheet: its title and lines, "See where they go" (the Table tab), "Take another" (the camera,
 *   nothing over the shutter), "See photo" (the viewer: zoom and drag, a flagged outline's Retake / It's fine);
 * - no photo takes itself while the sheet is open; 44 px buttons.
 * The sound and the tick are spied on where the page makes them: AudioBufferSourceNode.start() and the click on
 * the hidden switch's label (feedback.ts). Whether the iPhone plays and vibrates is checked on the phone.
 */
import { generatePuzzle, renderScene } from '../synth/index';
import { test, expect, gotoScreen } from './fixtures';
import type { Page } from '@playwright/test';

const W = 4032;
const H = 3024;
let scene = '';
let shifted = '';
let photo: Buffer = Buffer.alloc(0);
let crowded: Buffer = Buffer.alloc(0);
let few: Buffer = Buffer.alloc(0);

test.beforeAll(async () => {
  const puzzle = generatePuzzle({ cols: 8, rows: 6, cellMm: [17.8, 19.4], seed: 12 });
  const base = {
    puzzle,
    seed: 44,
    markers: [],
    layout: { areaMm: [600, 450] as [number, number], originMm: [100, 80] as [number, number] },
    camera: { x: 400, y: 305, heightMm: 680, tiltDeg: 1, imageSize: [W, H] as [number, number] },
    light: { dirDeg: 200 },
  };
  photo = (await renderScene(base)).jpeg;
  scene = `data:image/jpeg;base64,${photo.toString('base64')}`;
  // The phone moved on along the table (a photo doesn't take itself twice at the same spot).
  shifted = `data:image/jpeg;base64,${(await renderScene({ ...base, camera: { ...base.camera, x: 240, y: 260 } })).jpeg.toString('base64')}`;
  crowded = (await renderScene({ ...base, layout: { ...base.layout, touchingShare: 0.4 } })).jpeg;
  few = (await renderScene({ ...base, puzzle: generatePuzzle({ cols: 2, rows: 2, cellMm: [17.8, 19.4], seed: 5 }) })).jpeg;
});

/** Spies installed before the app starts: the sound, the tick, the flash and the wait's stages, the reader worker. */
function spies(): void {
  const w = window as unknown as {
    __fb: { sound: number; haptic: number; flash: number; flashShown: string[]; stages: string[] };
    __slowReader: number;
    __readerReplies: number;
    __readerStarts: number;
  };
  w.__fb = { sound: 0, haptic: 0, flash: 0, flashShown: [], stages: [] };
  w.__slowReader = 0;
  w.__readerReplies = 0;
  w.__readerStarts = 0;
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a: Parameters<typeof start>) {
    w.__fb.sound++;
    return start.apply(this, a);
  };
  document.addEventListener(
    'click',
    (e) => {
      if (e.target instanceof HTMLLabelElement && e.target.classList.contains('haptic-tick')) w.__fb.haptic++;
    },
    true,
  );
  const stage = (el: Element) => {
    const s = el.getAttribute('data-stage') ?? '';
    if (w.__fb.stages.at(-1) !== s) w.__fb.stages.push(s);
  };
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'attributes' && m.target instanceof Element && m.target.matches('[data-testid="scan-wait"]')) stage(m.target);
      for (const n of m.addedNodes) {
        if (!(n instanceof Element)) continue;
        if (n.matches('[data-testid="shutter-flash"]')) {
          w.__fb.flash++;
          const cs = getComputedStyle(n);
          w.__fb.flashShown.push(`${cs.display}/${cs.animationName}`);
        }
        const wait = n.matches('[data-testid="scan-wait"]') ? n : n.querySelector('[data-testid="scan-wait"]');
        if (wait) {
          w.__fb.stages.push('|');
          stage(wait);
        }
      }
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-stage'] });
  // The reader worker: its messages can be held back (a slow photo), and its replies and starts are counted.
  const Base = window.Worker;
  window.Worker = class extends Base {
    private slow: boolean;
    constructor(url: string | URL, opts?: WorkerOptions) {
      super(url, opts);
      this.slow = opts?.name === 'reader';
      if (this.slow) {
        w.__readerStarts++;
        this.addEventListener('message', () => w.__readerReplies++);
      }
    }
    override postMessage(m: unknown, t?: Transferable[] | StructuredSerializeOptions): void {
      const d = this.slow ? w.__slowReader : 0;
      if (d) setTimeout(() => super.postMessage(m, t as Transferable[]), d);
      else super.postMessage(m, t as Transferable[]);
    }
  };
}

const fb = (page: Page) =>
  page.evaluate(() => (window as unknown as { __fb: { sound: number; haptic: number; flash: number; flashShown: string[]; stages: string[] } }).__fb);
const hasSwitch = (page: Page) => page.evaluate(() => 'switch' in HTMLInputElement.prototype);

/** A marker-free puzzle (quick scan: it stays on overviews), its Scan screen open. */
async function openScan(page: Page, id: string, scanMode: 'quick' | 'full' = 'quick'): Promise<void> {
  await gotoScreen(page, '');
  await page.evaluate(
    async ({ pid, scanMode }) => {
      const req = indexedDB.open('puzzle-lens');
      const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      await new Promise<void>((res) => {
        const tx = dbh.transaction(['projects', 'settings'], 'readwrite');
        tx.objectStore('settings').put({ key: 'scanMode', value: scanMode });
        tx.objectStore('projects').put({
          id: pid,
          name: 'Result',
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
        tx.oncomplete = () => res();
      });
      dbh.close();
    },
    { pid: id, scanMode },
  );
  await page.reload();
  await page.evaluate((pid) => (location.hash = `#/scan/${pid}`), id);
  await expect(page.getByTestId('table-camera')).toBeVisible();
}

/** The puzzle's rows in the database (pieces, photos, stored pictures), to see that nothing changed. */
async function rows(page: Page, id: string): Promise<{ pieces: string; snaps: number; blobs: number }> {
  return page.evaluate(async (pid) => {
    const req = indexedDB.open('puzzle-lens');
    const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
    const all = <T>(store: string) =>
      new Promise<T[]>((res) => {
        const q = dbh.transaction(store).objectStore(store).getAll();
        q.onsuccess = () => res(q.result as T[]);
      });
    const pieces = (await all<{ id: string; projectId: string; updatedAt: number; table: unknown }>('pieces')).filter((p) => p.projectId === pid);
    const snaps = (await all<{ projectId: string }>('snaps')).filter((s) => s.projectId === pid).length;
    const blobs = (await all<{ id: string }>('blobs')).length;
    dbh.close();
    pieces.sort((a, b) => (a.id < b.id ? -1 : 1));
    return { pieces: JSON.stringify(pieces.map((p) => [p.id, p.updatedAt, p.table])), snaps, blobs };
  }, id);
}

async function pick(page: Page, buffer: Buffer): Promise<void> {
  await page.getByTestId('pick-photo-input').setInputFiles({ name: 'IMG_0001.jpeg', mimeType: 'image/jpeg', buffer });
}

/** Every visible button here is at least 44 × 44 px. */
async function bigEnough(page: Page, ids: string[]): Promise<void> {
  for (const id of ids) {
    const b = (await page.getByTestId(id).boundingBox())!;
    expect(b, id).not.toBeNull();
    expect(Math.min(b.width, b.height), id).toBeGreaterThanOrEqual(43.9); // (sub-pixel rounding)
  }
}

/** The element at the centre of `id` is `id` itself (or inside it): nothing lies over it. */
async function onTop(page: Page, id: string): Promise<boolean> {
  return page.getByTestId(id).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return Boolean(at && (at === el || el.contains(at)));
  });
}

test.use({ persistentStorage: true, fakeCameraOptions: { width: W, height: H, fps: 4 } });
test.setTimeout(300_000);

test('the shutter: flash, sound and tick once per photo; none for a chosen photo or with "Sounds and taps" off; no flash animation under Reduce Motion', async ({
  page,
}) => {
  await page.addInitScript((url) => ((window as unknown as { __fakeScene?: string }).__fakeScene = url), scene);
  await page.addInitScript(spies);
  await openScan(page, 'e2e-res-fb');
  const tick = (await hasSwitch(page)) ? 1 : 0;
  // A photo from the library: no shutter, so none of it (and it is read all the same).
  await pick(page, photo);
  await expect(page.getByTestId('scan-note')).toContainText('Found', { timeout: 150_000 });
  expect(await fb(page)).toMatchObject({ sound: 0, haptic: 0, flash: 0 });
  await page.getByTestId('result-another').click();
  await expect(page.getByTestId('scan-note')).toHaveCount(0);
  // The shutter button: one flash, one sound, one tick.
  await expect(page.getByTestId('snap')).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId('snap').click();
  await expect(page.getByTestId('scan-note')).toContainText('Found', { timeout: 150_000 });
  expect(await fb(page)).toMatchObject({ sound: 1, haptic: tick, flash: 1 });
  expect((await fb(page)).flashShown[0]).toBe('block/shutter-flash');

  // "Sounds and taps" off (Settings): no flash, sound or tick.
  await page.evaluate(() => (location.hash = '#/settings'));
  await expect(page.getByTestId('sounds-taps')).toBeVisible();
  await bigEnough(page, ['sounds-taps-on', 'sounds-taps-off']);
  await page.getByTestId('sounds-taps-off').click();
  await expect(page.getByTestId('sounds-taps-off')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => (location.hash = '#/scan/e2e-res-fb'));
  await expect(page.getByTestId('snap')).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId('snap').click();
  await expect(page.getByTestId('scan-note')).toContainText('Found', { timeout: 150_000 });
  expect(await fb(page)).toMatchObject({ sound: 1, haptic: tick, flash: 1 });

  // On again, with Reduce Motion: the sound and the tick, but the flash is not drawn (no animation).
  await page.getByTestId('result-another').click();
  await expect(page.getByTestId('scan-note')).toHaveCount(0);
  await page.evaluate(() => (location.hash = '#/settings'));
  await page.getByTestId('sounds-taps-on').click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => (location.hash = '#/scan/e2e-res-fb'));
  await expect(page.getByTestId('snap')).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId('snap').click();
  await expect(page.getByTestId('scan-note')).toContainText('Found', { timeout: 150_000 });
  const after = await fb(page);
  expect(after).toMatchObject({ sound: 2, haptic: 2 * tick, flash: 2 });
  expect(after.flashShown[1]).toMatch(/^none\//);
});

test('a photo that takes itself: flash, sound and tick once; no other photo while the result is open; "Take another" lets it go on', async ({ page }) => {
  await page.addInitScript((url) => ((window as unknown as { __fakeScene?: string }).__fakeScene = url), scene);
  await page.addInitScript(spies);
  await openScan(page, 'e2e-res-auto');
  const tick = (await hasSwitch(page)) ? 1 : 0;
  // The tilt sensor allowed and the phone held flat: the photo takes itself.
  await page.getByTestId('allow-tilt').click();
  await page.evaluate(() => {
    setInterval(() => dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: 0, beta: 1, gamma: -1 })), 50);
  });
  await expect(page.getByTestId('scan-note')).toContainText('Found', { timeout: 150_000 });
  expect(await fb(page)).toMatchObject({ sound: 1, haptic: tick, flash: 1 });
  // Open for a while: no other photo is taken.
  await page.waitForTimeout(8_000);
  expect((await fb(page)).flash).toBe(1);
  await expect(page.getByTestId('scan-note')).toBeVisible();
  // "Take another", and the phone moves on: the next photo takes itself, with its own flash, sound and tick.
  await page.getByTestId('result-another').click();
  await expect(page.getByTestId('scan-note')).toHaveCount(0);
  await page.evaluate((url) => ((window as unknown as { __fakeScene?: string }).__fakeScene = url), shifted);
  await expect.poll(async () => (await fb(page)).flash, { timeout: 90_000 }).toBe(2);
  await expect(page.getByTestId('scan-note')).toBeVisible({ timeout: 150_000 });
  expect(await fb(page)).toMatchObject({ sound: 2, haptic: 2 * tick, flash: 2 });
});

test('the wait: the frozen photo and its stages in order; Cancel after 10 s ignores the photo (the catalog is unchanged, the helper goes on)', async ({
  page,
}) => {
  await page.addInitScript(spies);
  await openScan(page, 'e2e-res-wait');
  // A first photo: the frozen photo shows while it is read, and the stages go in order.
  await pick(page, photo);
  await expect(page.getByTestId('scan-wait')).toBeVisible();
  // A chosen photo shows from a small copy (a canvas) where the browser can resize, else the photo itself.
  await expect(page.locator('.scan-wait-photo, .scan-wait-photo-box > canvas').first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('wait.png') });
  await expect(page.getByTestId('scan-note')).toContainText('Found', { timeout: 150_000 });
  await expect(page.getByTestId('scan-wait')).toHaveCount(0);
  expect((await fb(page)).stages).toEqual(['|', 'read', 'find', 'save']);
  await page.getByTestId('result-another').click();
  await expect(page.getByTestId('scan-note')).toHaveCount(0);
  const before = await rows(page, 'e2e-res-wait');
  expect(before.snaps).toBe(1);

  // A slow photo (its message to the helper held back 14 s): no Cancel at first, Cancel after 10 s.
  const replies = await page.evaluate(() => (window as unknown as { __readerReplies: number }).__readerReplies);
  await page.evaluate(() => ((window as unknown as { __slowReader: number }).__slowReader = 14_000));
  const t0 = Date.now();
  await pick(page, photo);
  await expect(page.getByTestId('scan-wait')).toHaveAttribute('data-stage', 'find');
  await expect(page.getByTestId('wait-read')).toHaveAttribute('data-state', 'done');
  await expect(page.getByTestId('wait-find')).toHaveAttribute('data-state', 'now');
  await expect(page.getByTestId('wait-save')).toHaveAttribute('data-state', 'next');
  await page.waitForTimeout(3_000);
  await expect(page.getByTestId('scan-cancel')).toHaveCount(0);
  // Back can be tapped during the wait (review 2026-11-11: the wait covered the camera's top bar).
  await expect(page.getByTestId('scan-wait-back')).toHaveAccessibleName('Back');
  await page.getByTestId('scan-wait-back').click({ trial: true });
  await bigEnough(page, ['scan-wait-back']);
  await expect(page.getByTestId('scan-cancel')).toBeVisible({ timeout: 12_000 });
  expect(Date.now() - t0).toBeGreaterThanOrEqual(9_500);
  await bigEnough(page, ['scan-cancel']);
  await page.screenshot({ path: test.info().outputPath('wait-cancel.png') });
  await page.getByTestId('scan-cancel').click();
  await expect(page.getByTestId('scan-wait')).toHaveCount(0);
  await expect(page.getByTestId('scan-note')).toHaveCount(0);
  // The photo's result arrives later: ignored. Nothing saved, no sheet, the same helper.
  await page.evaluate(() => ((window as unknown as { __slowReader: number }).__slowReader = 0));
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __readerReplies: number }).__readerReplies), { timeout: 150_000 })
    .toBeGreaterThan(replies);
  await page.waitForTimeout(1_500);
  await expect(page.getByTestId('scan-note')).toHaveCount(0);
  expect(await rows(page, 'e2e-res-wait')).toEqual(before);
  expect(await page.evaluate(() => (window as unknown as { __readerStarts: number }).__readerStarts)).toBe(1);
  // The next photo is read as usual (by the same helper).
  await pick(page, photo);
  await expect(page.getByTestId('scan-note')).toContainText('Found', { timeout: 150_000 });
  expect((await rows(page, 'e2e-res-wait')).snaps).toBe(2);
  expect(await page.evaluate(() => (window as unknown as { __readerStarts: number }).__readerStarts)).toBe(1);
});

test('the result sheet: titles and lines; See where they go, Take another, See photo; 44 px; nothing over the shutter once closed', async ({ page }) => {
  await openScan(page, 'e2e-res-sheet');
  // Hardly any pieces.
  await pick(page, few);
  const note = page.getByTestId('scan-note');
  await expect(note).toContainText('Hardly any pieces', { timeout: 150_000 });
  await expect(note.locator('.ui-sheet-title')).toHaveText('Hardly any pieces');
  await expect(note.locator('p')).toHaveText(['Hardly any pieces in this photo, so it wasn’t used.', /tap the shutter button/]);
  await expect(page.getByTestId('result-see-table')).toHaveCount(0);
  await bigEnough(page, ['result-another', 'result-see-photo', 'scan-note-close']);
  // A tap beside the sheet closes it: the shutter is free.
  await page.getByTestId('scan-note-scrim').click({ position: { x: 20, y: 20 } });
  await expect(note).toHaveCount(0);
  await expect.poll(() => onTop(page, 'snap')).toBe(true);

  // Many touching pieces: "Found …", what is new, ready, touching, quick scan.
  await pick(page, crowded);
  await expect(note).toContainText('Found', { timeout: 150_000 });
  await expect(note.locator('.ui-sheet-title')).toHaveText(/^Found \d+ pieces$/);
  await expect(note.locator('.scan-result-sub')).toHaveText(/^\d+ new/);
  const lines = await note.locator('p').allInnerTexts();
  expect(lines.some((l) => /^\d+ ready$/.test(l))).toBe(true);
  expect(lines.some((l) => /spots? where pieces touch .*spread them apart/.test(l))).toBe(true);
  expect(lines.at(-1)).toMatch(/^Quick scan done/);
  await bigEnough(page, ['result-see-table', 'result-another', 'result-see-photo', 'scan-note-close']);
  // While it is open, the dock is under it; "Take another" closes it in one tap and the shutter is free again.
  await page.screenshot({ path: test.info().outputPath('sheet-found.png') });
  await page.getByTestId('result-another').click();
  await expect(page.getByTestId('scan-note')).toHaveCount(0);
  await expect(note).toHaveCount(0);
  await expect.poll(() => onTop(page, 'snap')).toBe(true);
  await expect(page.getByTestId('snap')).toBeEnabled();

  // A photo spread anew: "Couldn't match this photo".
  await pick(page, few);
  await expect(note).toContainText('could not be matched', { timeout: 150_000 });
  await expect(note.locator('.ui-sheet-title')).toHaveText('Couldn’t match this photo');
  await page.getByTestId('result-another').click();
  await expect(page.getByTestId('scan-note')).toHaveCount(0);

  // Back to the crowded photo: See photo opens the viewer; Done goes back to the sheet.
  await pick(page, crowded);
  await expect(note).toContainText('Found', { timeout: 150_000 });
  await page.getByTestId('result-see-photo').click();
  const viewer = page.getByTestId('photo-result');
  await expect(viewer).toBeVisible();
  await expect(note).toHaveCount(0);
  await expect(page.getByTestId('photo-legend')).toContainText('Touching');
  await bigEnough(page, ['photo-done', 'overlay-legend-open']);
  await page.getByTestId('photo-done').click();
  await expect(viewer).toHaveCount(0);
  await expect(note).toBeVisible();

  // See where they go: the puzzle's Table tab.
  await page.getByTestId('result-see-table').click();
  await expect(page).toHaveURL(/#\/puzzle\/e2e-res-sheet\/table$/);
  await expect(page.getByTestId('tab-table')).toHaveAttribute('aria-current', 'page');
});

test('the photo viewer: pinch, double-tap and drag zoom inside it; a flagged outline zooms in with Retake / It’s fine', async ({ page }) => {
  await openScan(page, 'e2e-res-view');
  await pick(page, crowded);
  await expect(page.getByTestId('scan-note')).toContainText('Found', { timeout: 150_000 });
  await page.getByTestId('result-see-photo').click();
  const svg = page.getByTestId('photo-view-svg');
  const port = page.getByTestId('photo-view-port');
  await expect(svg).toHaveAttribute('data-scale', '1.00');
  const box = (await port.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // Double-tap: closer.
  await page.mouse.click(cx, cy);
  await page.mouse.click(cx, cy);
  await expect.poll(async () => Number(await svg.getAttribute('data-scale'))).toBeGreaterThan(2);
  // Drag: the photo moves (the page doesn't).
  const t0 = await svg.getAttribute('viewBox');
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 80, cy - 60, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => svg.getAttribute('viewBox')).not.toBe(t0);
  // Double-tap until the closest zoom, then once more: back to the whole photo.
  for (let i = 0; i < 4 && Number(await svg.getAttribute('data-scale')) < 5.99; i++) {
    await page.mouse.click(cx, cy);
    await page.mouse.click(cx, cy);
    await page.waitForTimeout(400);
  }
  await page.mouse.click(cx, cy);
  await page.mouse.click(cx, cy);
  await expect(svg).toHaveAttribute('data-scale', '1.00');
  // Pinch (two fingers apart): closer.
  await port.evaluate(
    (el, { x, y }) => {
      const ev = (type: string, id: number, px: number) =>
        el.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: px, clientY: y, bubbles: true, isPrimary: id === 1, pointerType: 'touch' }));
      ev('pointerdown', 1, x - 30);
      ev('pointerdown', 2, x + 30);
      for (let d = 30; d <= 120; d += 15) {
        ev('pointermove', 1, x - d);
        ev('pointermove', 2, x + d);
      }
      ev('pointerup', 1, x - 120);
      ev('pointerup', 2, x + 120);
    },
    { x: cx, y: cy },
  );
  await expect.poll(async () => Number(await svg.getAttribute('data-scale'))).toBeGreaterThan(3);
  await page.mouse.click(cx, cy);
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(400);
  while (Number(await svg.getAttribute('data-scale')) > 1) {
    await page.mouse.click(cx, cy);
    await page.mouse.click(cx, cy);
    await page.waitForTimeout(400);
  }

  // A flagged outline (touching pieces): a tap zooms to it and offers Retake / It's fine.
  const flagged = page.locator('[data-testid="photo-result"] polygon.res-outline.res-clump');
  expect(await flagged.count()).toBeGreaterThan(0);
  const tapFlagged = async () => {
    const b = (await flagged.first().boundingBox())!;
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  };
  await tapFlagged();
  await expect(page.getByTestId('flag-offer')).toBeVisible();
  await expect(page.getByTestId('flag-offer')).toContainText('Pieces touching');
  await expect(page.getByTestId('photo-picked')).toHaveCount(1);
  await expect.poll(async () => Number(await svg.getAttribute('data-scale'))).toBeGreaterThan(1);
  await bigEnough(page, ['flag-retake', 'flag-fine']);
  await page.screenshot({ path: test.info().outputPath('viewer-flag.png') });
  // It's fine: the offer goes, the whole photo again; nothing else changes.
  await page.getByTestId('flag-fine').click();
  await expect(page.getByTestId('flag-offer')).toHaveCount(0);
  await expect(svg).toHaveAttribute('data-scale', '1.00');
  await expect(page.getByTestId('photo-done')).toBeVisible();
  // Retake: back to the camera (the viewer and the sheet closed).
  await tapFlagged();
  await expect(page.getByTestId('flag-offer')).toBeVisible();
  await page.getByTestId('flag-retake').click();
  await expect(page.getByTestId('photo-result')).toHaveCount(0);
  await expect(page.getByTestId('scan-note')).toHaveCount(0);
  await expect.poll(() => onTop(page, 'snap')).toBe(true);
});

test('from the dock: the last photo opens the viewer, Done goes back to the camera', async ({ page }) => {
  await openScan(page, 'e2e-res-dock');
  await pick(page, photo);
  await expect(page.getByTestId('scan-note')).toContainText('Found', { timeout: 150_000 });
  await page.getByTestId('result-another').click();
  await expect(page.getByTestId('scan-note')).toHaveCount(0);
  await page.getByTestId('show-photo').click();
  await expect(page.getByTestId('photo-result')).toBeVisible();
  await page.getByTestId('photo-done').click();
  await expect(page.getByTestId('photo-result')).toHaveCount(0);
  await expect(page.getByTestId('scan-note')).toHaveCount(0);
  await expect.poll(() => onTop(page, 'snap')).toBe(true);
});
