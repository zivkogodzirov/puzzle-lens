/**
 * The app shell and the puzzle page (M9 part 1, "readable now"): the last puzzle reopened at
 * launch, screen titles and focus, pinch-zoom allowed, the set-up checklist hidden once done, the
 * page filter, the screen kept awake on puzzle screens, and the action bar at the bottom of the
 * puzzle page that never covers the page's last lines or the piece panel's ✓ Fits row (M9 part 4: the tab bar).
 */
import { createCanvas } from '@napi-rs/canvas';
import type { Page } from '@playwright/test';
import { extractPatch } from '../../src/cv/placement';
import type { Vec2 } from '../../src/project/types';
import { generatePuzzle } from '../synth/index';
import { test, expect, gotoScreen, openTab } from './fixtures';

test.setTimeout(180_000);
// Blobs in IndexedDB need a persistent WebKit context (as in scan-bin.spec.ts).
test.use({ persistentStorage: true });

const pz = generatePuzzle({ cols: 10, rows: 8, cellMm: [17.8, 19.4], seed: 5 });
const art = pz.art;
const picture = { data: art.rgba, width: art.width, height: art.height, stride: art.width * 4 };
const ids = ['r1c2', 'r3c7', 'r5c4', 'r6c8', 'r2c5', 'r4c1'];

function patchFor(id: string, q: number): string {
  const p = pz.pieces.find((x) => x.id === id)!;
  const [sx, sy] = art.pxPerMm;
  const cx = (p.col + 0.5) * pz.cellMm[0];
  const cy = (p.row + 0.5) * pz.cellMm[1];
  const toPx = (x: number, y: number): Vec2 => [(x + cx) * sx, (y + cy) * sy];
  const corners = [0, 1, 2, 3].map((k) => toPx(p.cornersMm[2 * k]!, p.cornersMm[2 * k + 1]!));
  const outline: number[] = [];
  for (let i = 0; i < p.outlineMm.length; i += 2) outline.push(...toPx(p.outlineMm[i]!, p.outlineMm[i + 1]!));
  const patch = extractPatch(
    picture,
    [0, 1, 2, 3].map((k) => corners[(k + q) % 4]!),
    outline,
  )!;
  return Buffer.from(patch.rgba).toString('base64');
}

function boxJpeg(): string {
  const c = createCanvas(art.width, art.height);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(art.width, art.height);
  img.data.set(art.rgba);
  ctx.putImageData(img, 0, 0);
  return c.encodeSync('jpeg', 92).toString('base64');
}

/**
 * Puzzles in IndexedDB: `shell-done` (set-up finished, a box picture and pieces that can be placed)
 * and `shell-setup` (stopped at step 3). `current`: the puzzle the app remembers as open last.
 */
async function seed(page: Page, current: string | null, withPieces = false): Promise<void> {
  const patches = withPieces ? ids.map((pid, i) => ({ id: pid, b64: patchFor(pid, i % 4) })) : [];
  await gotoScreen(page, '');
  const ok = await page.evaluate(
    async ([box, ps, w, h, cur]) => {
      const bytes = (b64: string) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      const req = indexedDB.open('puzzle-lens');
      const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      await new Promise<void>((res) => {
        const tx = dbh.transaction(['projects', 'pieces', 'blobs', 'settings'], 'readwrite');
        if (cur) tx.objectStore('settings').put({ key: 'currentProjectId', value: cur });
        tx.objectStore('blobs').put({ id: 'shell:box', ts: 1, kind: 'box', blob: new Blob([bytes(box)], { type: 'image/jpeg' }) });
        const base = { createdAt: 1, updatedAt: 2, pieceCount: 80, markerMap: null, tableModel: null, tracking: 'pieces', openSpots: null };
        tx.objectStore('projects').put({
          ...base,
          id: 'shell-done',
          name: 'Harbour at dusk',
          grid: { cols: 10, rows: 8, source: 'suggested' },
          box: {
            photoBlobId: 'shell:box',
            rectifiedBlobId: 'shell:box',
            corners: [
              [0, 0],
              [w, 0],
              [w, h],
              [0, h],
            ],
            photoWidth: w,
            photoHeight: h,
            width: w,
            height: h,
          },
          piecePitch: { wMm: 17.8, hMm: 19.4, n: 6 },
          setupStep: 6,
          scaleSource: 'coin',
        });
        tx.objectStore('projects').put({ ...base, id: 'shell-setup', name: 'Half set up', grid: null, box: null, piecePitch: null, setupStep: 3 });
        ps.forEach((p, i) => {
          tx.objectStore('blobs').put({ id: `shell:patch-${p.id}`, ts: 1, kind: 'patch', blob: new Blob([bytes(p.b64)]) });
          tx.objectStore('pieces').put({
            id: p.id,
            projectId: 'shell-done',
            createdAt: 1,
            updatedAt: 1,
            status: 'table',
            table: { x: i * 30, y: 0, angleDeg: 0, lastSeen: 1, snapId: 's1' },
            outlineMm: [0, 0, 1, 0, 1, 1],
            areaMm2: 345,
            sizeMm: [18, 19],
            colour: { meanLab: [50, 0, 0], hueHist: [0, 0, 0, 0, 0, 0, 0, 0] },
            thumbBlobId: null,
            seen: 1,
            bestPxPerMm: 5,
            flags: {},
            patch: { blobId: `shell:patch-${p.id}`, flats: [false, false, false, false], sure: false, ts: 5 },
          });
        });
        tx.oncomplete = () => res();
      });
      dbh.close();
      return 'ok';
    },
    [boxJpeg(), patches, art.width, art.height, current] as const,
  );
  expect(ok).toBe('ok');
}

test('pinch-zoom is allowed; a theme colour for each appearance; portrait in the Home Screen app', async ({ page, request }) => {
  await gotoScreen(page, '');
  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(viewport).not.toContain('user-scalable');
  expect(viewport).not.toContain('maximum-scale');
  const themes = await page.locator('meta[name="theme-color"]').evaluateAll((ms) => ms.map((m) => `${m.getAttribute('media')}|${m.getAttribute('content')}`));
  expect(themes).toHaveLength(2);
  expect(themes.some((t) => t.startsWith('(prefers-color-scheme: light)|'))).toBe(true);
  expect(themes.some((t) => t.startsWith('(prefers-color-scheme: dark)|'))).toBe(true);
  // Each matches its page background.
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const [bg, meta] = await page.evaluate(
      (s) => [
        getComputedStyle(document.body).backgroundColor,
        document.querySelector(`meta[name="theme-color"][media="(prefers-color-scheme: ${s})"]`)!.getAttribute('content')!,
      ],
      scheme,
    );
    const hex = meta.replace('#', '');
    const rgb = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
    expect(bg, `page background in ${scheme} mode`).toBe(rgb);
  }
  expect(await page.locator('meta[name="apple-mobile-web-app-status-bar-style"]').getAttribute('content')).toBe('default');
  const manifest = await (await request.get('manifest.webmanifest')).json();
  expect(manifest.orientation).toBe('portrait');
});

test('the last puzzle opens at launch, with Home one step back; an address wins', async ({ page }) => {
  await seed(page, 'shell-setup');
  // The Home Screen app opens at its start address, with no #/… part.
  await page.goto('./');
  await expect(page.getByTestId('puzzle-screen')).toBeVisible();
  await expect(page.getByTestId('navbar').locator('h1')).toHaveText('Half set up');
  // On its Table tab (M9 part 4, decision 3).
  await expect(page.getByTestId('tab-table')).toHaveAttribute('aria-current', 'page');
  expect(new URL(page.url()).hash).toBe('#/puzzle/shell-setup');
  await expect(page).toHaveTitle('Half set up · Puzzle Lens');
  // Home is one Back away (the browser's Back, like the edge swipe), and the ‹ Home button goes there too.
  await page.goBack();
  await expect(page.getByTestId('your-puzzles')).toBeVisible();
  await expect(page).toHaveTitle('Puzzle Lens');
  // Home by its address stays Home; another screen's address opens that screen.
  await page.goto('./#/');
  await page.reload();
  await expect(page.getByTestId('your-puzzles')).toBeVisible();
  await page.goto('./#/settings');
  await page.reload();
  await expect(page).toHaveTitle('Settings · Puzzle Lens');
  // A puzzle deleted since then: Home.
  await page.evaluate(async () => {
    const req = indexedDB.open('puzzle-lens');
    const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
    await new Promise<void>((res) => {
      const tx = dbh.transaction('settings', 'readwrite');
      tx.objectStore('settings').put({ key: 'currentProjectId', value: 'gone' });
      tx.oncomplete = () => res();
    });
    dbh.close();
  });
  await page.goto('about:blank');
  await page.goto('./');
  await expect(page.getByTestId('your-puzzles')).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
});

test('each screen has its own title, and its heading gets the focus', async ({ page }) => {
  await seed(page, null);
  await expect(page).toHaveTitle('Puzzle Lens');
  for (const [hash, title, heading] of [
    ['#/settings', 'Settings · Puzzle Lens', 'Settings'],
    ['#/help', 'Setup guide · Puzzle Lens', 'Setup guide'],
    ['#/puzzle/shell-setup', 'Half set up · Puzzle Lens', 'Half set up'],
    // The old Progress address: the puzzle's Picture tab (M9 part 4).
    ['#/progress/shell-done', 'Harbour at dusk · Puzzle Lens', 'Harbour at dusk'],
    ['#/', 'Puzzle Lens', 'Puzzle Lens'],
  ] as const) {
    await page.evaluate((h) => (location.hash = h), hash);
    await expect(page).toHaveTitle(title);
    await expect(page.locator('h1').first()).toContainText(heading);
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('H1');
  }
  // Renaming the puzzle (on its More tab) renames the title.
  await page.evaluate(() => (location.hash = '#/puzzle/shell-setup/more'));
  await page.getByTestId('rename').click();
  await page.getByTestId('rename-input').fill('Lighthouse');
  await page.getByTestId('rename-save').click();
  await expect(page).toHaveTitle('Lighthouse · Puzzle Lens');
});

test('the set-up checklist shows only until set-up is finished', async ({ page }) => {
  await seed(page, null);
  // The set-up steps are on the More tab (M9 part 4); the Table tab says to finish the set-up, and there is no Scan yet.
  await page.evaluate(() => (location.hash = '#/puzzle/shell-setup'));
  await expect(page.getByTestId('table-continue-setup')).toBeVisible();
  await expect(page.getByTestId('scan-pieces')).toHaveCount(0);
  await openTab(page, 'more');
  await expect(page.getByTestId('setup-progress')).toBeVisible();
  await expect(page.getByTestId('continue-setup')).toBeVisible();
  await expect(page.getByTestId('setup-finished')).toHaveCount(0);
  await page.evaluate(() => (location.hash = '#/puzzle/shell-done/more'));
  await expect(page.getByTestId('setup-finished')).toContainText('Set-up finished');
  await expect(page.getByTestId('setup-progress')).toHaveCount(0);
  await expect(page.getByTestId('continue-setup')).toHaveCount(0);
});

test('the screen stays awake on the puzzle screens, and not elsewhere', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __locks: { held: number; asked: number } };
    w.__locks = { held: 0, asked: 0 };
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async () => {
          w.__locks.asked++;
          w.__locks.held++;
          const s = new EventTarget() as EventTarget & { release: () => Promise<void>; released: boolean };
          s.released = false;
          s.release = async () => {
            if (s.released) return;
            s.released = true;
            w.__locks.held--;
            s.dispatchEvent(new Event('release'));
          };
          return s;
        },
      },
    });
  });
  await seed(page, null);
  const held = () => page.evaluate(() => (window as unknown as { __locks: { held: number } }).__locks.held);
  expect(await held()).toBe(0);
  await page.evaluate(() => (location.hash = '#/puzzle/shell-done'));
  await expect(page.getByTestId('puzzle-screen')).toBeVisible();
  await expect.poll(held).toBe(1);
  // Every tab, and the old Progress address (now the Picture tab).
  for (const tab of ['picture', 'pieces', 'more'] as const) {
    await openTab(page, tab);
    await expect.poll(held).toBe(1);
  }
  await page.evaluate(() => (location.hash = '#/progress/shell-done'));
  await expect(page.getByTestId('tab-picture')).toHaveAttribute('aria-current', 'page');
  await expect.poll(held).toBe(1);
  await page.evaluate(() => (location.hash = '#/settings'));
  await expect.poll(held).toBe(0);
});

test('the tab bar (was the action bar): at once, never over the last lines or the ✓ Fits row; the page filter', async ({ page }) => {
  await seed(page, 'shell-done', true);
  for (const size of [
    { width: 402, height: 874 },
    { width: 375, height: 667 },
  ]) {
    await page.setViewportSize(size);
    await page.goto('./#/puzzle/shell-done/pieces');
    await page.reload();
    // Home Screen app safe areas (WebKit in Playwright reports 0).
    await page.addStyleTag({ content: ':root { --safe-top: 62px !important; --safe-bottom: 34px !important; }' });
    await expect(page.getByTestId('place-summary')).toContainText('On the box picture', { timeout: 60_000 });
    // M9 part 4: the tab bar replaced the action bar; Scan is in the navigation bar.
    const bar = page.getByTestId('puzzle-tabs');
    // In view at once, at the bottom of the screen, with the four tabs.
    await expect(bar).toBeInViewport({ ratio: 1 });
    for (const id of ['tab-table', 'tab-picture', 'tab-pieces', 'tab-more']) await expect(bar.getByTestId(id)).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('scan-pieces')).toBeInViewport({ ratio: 1 });
    const barTop = async () => (await bar.boundingBox())!.y;
    expect(await barTop()).toBeGreaterThan(size.height - 49 - 34 - 4);
    // Scrolled to the end: the page's last line sits above the bar.
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    const lastBottom = await page.evaluate(() => {
      const main = document.querySelector('main')!;
      let bottom = 0;
      for (const el of main.querySelectorAll('*')) {
        if ((el as HTMLElement).closest('.tabbar')) continue;
        const r = el.getBoundingClientRect();
        if (r.height > 0) bottom = Math.max(bottom, r.bottom);
      }
      return bottom;
    });
    expect(lastBottom).toBeLessThanOrEqual(await barTop());

    // A piece's card (M9 part 3: a sheet over the bar): its answers on screen, above the Home bar.
    await page.evaluate(() => scrollTo(0, 0));
    await page.locator('[data-testid="catalog"] .thumb-btn').nth(1).click();
    await expect(page.getByTestId('spot-fits')).toBeVisible();
    // Done sliding up.
    await expect.poll(() => page.getByTestId('spot').evaluate((e) => e.hasAttribute('data-opening'))).toBe(false);
    const answer = (await page.getByTestId('spot-answer').boundingBox())!;
    expect(answer.y).toBeGreaterThanOrEqual(0);
    expect(answer.y + answer.height).toBeLessThanOrEqual(size.height - 34);
    // Each answer on one line (check 2026-11-10: "Doesn't fit" wrapped at 375 px).
    for (const id of ['spot-fits', 'spot-not']) expect((await page.getByTestId(id).boundingBox())!.height, id).toBeLessThanOrEqual(60);
    // No label in the bar cut off.
    expect(await bar.evaluate((b) => [...b.querySelectorAll('.tabbar-label')].filter((l) => l.scrollWidth > l.clientWidth + 1).length)).toBe(0);
    await page.screenshot({ path: test.info().outputPath(`panel-${size.width}x${size.height}.png`) });
    await page.getByTestId('spot-close').click();

    // Fill a spot (Picture tab) opens the spot sheet over the bar (M9 part 4: was a panel in the page): its answers on
    // screen, above the Home bar; its ✕ closes it.
    await openTab(page, 'picture');
    await page.getByTestId('fill-toggle').click();
    await expect(page.getByTestId('fill-sheet')).toBeInViewport();
    await expect.poll(() => page.getByTestId('fill-sheet').evaluate((e) => e.hasAttribute('data-opening'))).toBe(false);
    const fill = page.getByTestId('fill-best').getByTestId('fill-fits');
    if (await fill.count()) {
      const fb = (await fill.first().boundingBox())!;
      expect(fb.y + fb.height).toBeLessThanOrEqual(size.height - 34);
    }
    await page.getByTestId('fill-sheet-close').click();
    await expect(page.getByTestId('fill-sheet')).toHaveCount(0);
  }
  await openTab(page, 'pieces');

  // The page filter: one pressed at a time.
  await page.getByTestId('group-border').click();
  await expect(page.getByTestId('group-border')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('group-all')).toHaveAttribute('aria-pressed', 'false');
  const [sel, other] = await page.evaluate(() =>
    ['group-border', 'group-all'].map((id) => getComputedStyle(document.querySelector(`[data-testid="${id}"]`)!).fontWeight),
  );
  expect(Number(sel)).toBeGreaterThan(Number(other));
  await page.getByTestId('group-all').click();
  await expect(page.getByTestId('group-all')).toHaveAttribute('aria-pressed', 'true');

  // ✓ Fits: the Undo toast (M9 part 2; was a note in the page) is in view at once, and not under the bar.
  await page.locator('[data-testid="catalog"] .thumb-btn').first().click();
  await page.getByTestId('spot-fits').click();
  const note = page.getByTestId('toast');
  await expect(note).toContainText('Placed at');
  await expect(note).toBeInViewport({ ratio: 1 });
  const nb = (await note.boundingBox())!;
  expect(nb.y + nb.height).toBeLessThanOrEqual((await page.getByTestId('puzzle-tabs').boundingBox())!.y);
  await page.screenshot({ path: test.info().outputPath('tab-bar.png') });
});
