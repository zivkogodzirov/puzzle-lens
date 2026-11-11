/**
 * The puzzle's Pieces tab (M9 part 4, design plan §4 item 7): the segmented filter All · Border · Inside · Check,
 * "Which pieces join" and "Sort into trays" as pages of their own (#/joins/<id>, #/sort/<id>) with Back to the tab
 * (also after a deep link and a reload), the "Pieces to check" callout, the badge legend, the grid 4 across at
 * 375 and 402 px, a tile opening the piece's card, 44 px targets with nothing under the tab bar, and a 1000-piece
 * grid that stays fast (times in the test output).
 */
import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect, openTab } from './fixtures';
import { PROJECT, seedPieces } from './pieces-seed';

test.setTimeout(180_000);
// Blobs in IndexedDB need a persistent WebKit context (as in scan-bin.spec.ts).
test.use({ persistentStorage: true });

const tiles = (page: Page) => page.locator('[data-testid="catalog"] .thumb-btn');
const hash = (page: Page) => page.evaluate(() => location.hash);

/** Every visible button and link (in `within`) at least 44 × 44 px; links inside a sentence are left out. */
async function smallTargets(page: Page, within = '#app'): Promise<string[]> {
  return page.evaluate((sel) => {
    const out: string[] = [];
    for (const root of document.querySelectorAll(sel))
      for (const el of root.querySelectorAll<HTMLElement>('button, a[href], [role=button], input, select')) {
        if (el.classList.contains('link-btn')) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') continue;
        if (r.width < 43.5 || r.height < 43.5)
          out.push(
            `${el.tagName} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(r.width)}×${Math.round(r.height)}`,
          );
      }
    return out;
  }, within);
}

const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

test('the four segments filter the grid: All, Border (corners first), Inside, Check (not sure, to check, faint)', async ({ page }) => {
  await seedPieces(page, { pending: [{ id: 'seen-1', like: 'r2c3', maybe: ['r2c3', 'r2c4'] }], weak: ['r1c6'] });
  const seg = page.getByTestId('catalog-groups');
  await expect(seg.getByRole('group', { name: 'Show pieces' })).toBeVisible();
  for (const id of ['group-all', 'group-border', 'group-interior', 'group-check']) await expect(page.getByTestId(id)).toBeVisible();
  await expect(page.getByTestId('group-all')).toHaveAttribute('aria-pressed', 'true');
  const count = async (id: string) => Number((await page.getByTestId(id).locator('.segmented-count').innerText()).trim());
  await expect(tiles(page)).toHaveCount(13);
  expect(await count('group-all')).toBe(13);
  const groupsOf = () => tiles(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-group')));
  const all = await groupsOf();
  // To check: shape not sure, a rescan's piece ("?") or a faint outline.
  const toCheck = await tiles(page).evaluateAll(
    (els) => els.filter((b) => b.getAttribute('data-group') === 'unsure' || b.querySelector('[data-testid="pending-tag"], .flag-weak')).length,
  );
  expect(toCheck).toBeGreaterThanOrEqual(2);
  // Border: corners and edges only, corners first.
  await page.getByTestId('group-border').click();
  await expect(page.getByTestId('group-border')).toHaveAttribute('aria-pressed', 'true');
  const border = await groupsOf();
  expect(border.length).toBe(all.filter((g) => g === 'corner' || g === 'edge').length);
  expect(border.length).toBe(await count('group-border'));
  expect(border.length).toBeGreaterThan(0);
  expect(border.every((g) => g === 'corner' || g === 'edge')).toBe(true);
  expect(border.indexOf('edge') === -1 || border.lastIndexOf('corner') < border.indexOf('edge')).toBe(true);
  await expect(page.getByTestId('border-counts')).toContainText('Corners');
  // Inside.
  await page.getByTestId('group-interior').click();
  const inside = await groupsOf();
  expect(inside.length).toBe(await count('group-interior'));
  expect(inside.length).toBe(all.filter((g) => g === 'interior').length);
  expect(inside.every((g) => g === 'interior')).toBe(true);
  // Check: the shapes not sure, the piece to check (first, with its "?") and the faint one.
  await page.getByTestId('group-check').click();
  const check = await groupsOf();
  expect(check.length).toBe(await count('group-check'));
  expect(check.length).toBe(toCheck);
  await expect(tiles(page).first().getByTestId('pending-tag')).toBeVisible();
  await expect(page.getByTestId('check-note')).toBeVisible();
  await expect(page.getByTestId('pieces-legend')).toContainText('to check');
  // Back to All.
  await page.getByTestId('group-all').click();
  await expect(tiles(page)).toHaveCount(13);
  // The callout: "Pieces to check (1)", its rows behind "Check them".
  await expect(page.getByTestId('pending-panel')).toContainText('Pieces to check (1)');
  await page.getByTestId('pending-toggle').click();
  await expect(page.getByTestId('pending-row')).toHaveCount(1);
  // The legend lists only the badges on screen.
  const legend = page.getByTestId('pieces-legend');
  await expect(legend).toContainText('very likely');
  await expect(legend).toContainText('check outline');
  await expect(legend).not.toContainText('colour group');
});

test('Which pieces join opens as a page: Back to the Pieces tab (same filter), deep link and reload', async ({ page }) => {
  await seedPieces(page);
  // The square of 4's four pairs and the pair beside it, at least.
  await expect(page.getByTestId('matches-count')).toHaveText(/^\d+$/);
  const pairs = Number(await page.getByTestId('matches-count').innerText());
  expect(pairs).toBeGreaterThanOrEqual(5);
  await page.getByTestId('group-border').click();
  await page.getByTestId('matches-toggle').click();
  expect(await hash(page)).toBe(`#/joins/${PROJECT}`);
  await expect(page.getByTestId('joins-page')).toBeVisible();
  await expect(page.getByTestId('navbar').locator('h1')).toHaveText('Which pieces join');
  await expect(page.getByTestId('navbar-back')).toHaveAccessibleName('Back to Pieces');
  await expect(page.getByTestId('scan-pieces')).toHaveCount(0);
  await expect(page.getByTestId('puzzle-tabs')).toHaveCount(0);
  await expect(page.getByTestId('match-next')).toContainText('A square of 4');
  await expect(page).toHaveTitle('Which pieces join · Harbour at dusk · Puzzle Lens');
  expect(await page.evaluate(() => scrollY)).toBe(0);
  // An answer, then Back: the count on the tab follows, and the tab shows Border as before.
  await page.getByTestId('match-next').getByTestId('match-block-fits').click();
  await expect(page.getByTestId('toast-text')).toContainText('the 4 pieces are joined');
  await page.getByTestId('navbar-back').click();
  expect(await hash(page)).toBe(`#/puzzle/${PROJECT}/pieces`);
  await expect(page.getByTestId('tab-pieces')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('group-border')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('matches-count')).toHaveText(String(pairs - 4));
  await expect(page).toHaveTitle('Harbour at dusk · Puzzle Lens');
  // The answer's Undo stays across the page and its tab (review 2026-11-11), and the browser's Back (the edge swipe)
  // from the tab doesn't land on Which pieces join again: ‹ Pieces went back in the history.
  await expect(page.getByTestId('toast-text')).toContainText('the 4 pieces are joined');
  await page.goBack();
  expect(await hash(page)).not.toBe(`#/joins/${PROJECT}`);
  // A deep link, and a reload of it.
  await page.goto(`./#/joins/${PROJECT}`);
  await page.reload();
  await expect(page.getByTestId('match-next')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('match-joined')).toContainText('4 pairs joined');
  await expect(page).toHaveTitle('Which pieces join · Harbour at dusk · Puzzle Lens');
  await page.getByTestId('navbar-back').click();
  await expect(page.getByTestId('tab-pieces')).toHaveAttribute('aria-current', 'page');
  // A fresh visit of the tab starts at All.
  await expect(page.getByTestId('group-all')).toHaveAttribute('aria-pressed', 'true');
});

test('Sort into trays opens as a page: a group shows its pieces below, the labels come back to it, Back to Pieces', async ({ page }) => {
  await seedPieces(page);
  await page.getByTestId('trays-toggle').click();
  expect(await hash(page)).toBe(`#/sort/${PROJECT}`);
  await expect(page.getByTestId('navbar').locator('h1')).toHaveText('Sort into trays');
  await expect(page.getByTestId('puzzle-tabs')).toHaveCount(0);
  await expect(page.getByTestId('tray-groups')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('sort-grid-head')).toContainText('On the table (12)');
  await expect(tiles(page)).toHaveCount(12);
  await expect(page.getByTestId('tray-tag')).toHaveCount(12);
  await expect(page.getByTestId('pieces-legend')).toContainText('colour group');
  // A group: only its pieces below.
  const first = page.getByTestId('tray-groups').locator('button').first();
  const letter = (await first.getAttribute('data-testid'))!.replace('tray-group-', '');
  await first.click();
  await expect(page.getByTestId('tray-detail')).toBeVisible();
  const n = await tiles(page).count();
  await expect(page.getByTestId('sort-grid-head')).toContainText(`Group ${letter} (${n})`);
  await expect(page.getByTestId('tray-tag')).toHaveText(Array.from({ length: n }, () => new RegExp(`^${letter}`)));
  // A tile opens its card here too.
  await tiles(page).first().click();
  await expect(page.getByTestId('spot')).toBeVisible();
  await page.getByTestId('spot-close').click();
  await expect(page.getByTestId('spot')).toHaveCount(0);
  // The labels' Back returns to this page; a reload keeps it.
  await page.getByTestId('print-tray-labels').click();
  await expect(page.getByTestId('tray-labels')).toBeVisible();
  await page.getByTestId('labels-back').click();
  expect(await hash(page)).toBe(`#/sort/${PROJECT}`);
  await page.reload();
  await expect(page.getByTestId('tray-groups')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('navbar-back').click();
  expect(await hash(page)).toBe(`#/puzzle/${PROJECT}/pieces`);
  await expect(page.getByTestId('tab-pieces')).toHaveAttribute('aria-current', 'page');
});

for (const size of [
  { width: 375, height: 667 },
  { width: 402, height: 874 },
]) {
  test(`${size.width} px: the grid is 4 across, a tile opens its card, 44 px targets, no sideways scroll, nothing under the tab bar`, async ({ page }) => {
    await page.setViewportSize(size);
    await seedPieces(page, { cut: true, pending: [{ id: 'seen-1', like: 'r2c3', maybe: ['r2c3'] }] });
    await page.addStyleTag({ content: ':root { --safe-top: 62px !important; --safe-bottom: 34px !important; }' });
    const boxes = await tiles(page).evaluateAll((els) => els.slice(0, 5).map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
    expect(new Set(boxes.slice(0, 4).map((b) => Math.round(b.y))).size).toBe(1);
    expect(boxes[4]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 1);
    for (const b of boxes) {
      expect(b.width).toBeGreaterThanOrEqual(75);
      expect(b.width).toBeLessThanOrEqual(95);
    }
    expect(await smallTargets(page)).toEqual([]);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    // M9 part 6: square tiles, each piece cut out by its outline (a clip-path polygon), loaded and checked.
    for (const b of boxes) expect(Math.abs(b.width - b.height)).toBeLessThanOrEqual(1);
    await expect(tiles(page).locator('.tile-cut')).toHaveCount(13);
    await expect.poll(() => tiles(page).locator('.tile-piece:not(.tile-wait)').count()).toBe(13);
    const cut = await tiles(page)
      .first()
      .evaluate((b) => ({ cut: b.getAttribute('data-cut'), clip: getComputedStyle(b.querySelector('.tile-cut')!).clipPath }));
    expect(cut.cut).toBe('outline');
    expect(cut.clip).toMatch(/^polygon\(/);
    // Nothing under the tab bar at the bottom of the tab.
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(300);
    const barTop = (await page.getByTestId('puzzle-tabs').boundingBox())!.y;
    const lastBottom = await page.evaluate(() => {
      let bottom = 0;
      for (const el of document.querySelectorAll('main *')) {
        if ((el as HTMLElement).closest('.tabbar')) continue;
        const r = el.getBoundingClientRect();
        if (r.height > 0) bottom = Math.max(bottom, r.bottom);
      }
      return bottom;
    });
    expect(lastBottom).toBeLessThanOrEqual(barTop);
    // A tile opens the piece's card.
    await tiles(page).last().click();
    await expect(page.getByTestId('spot')).toBeVisible();
    await page.getByTestId('spot-close').click();
    // The two pages.
    for (const [row, pageId] of [
      ['matches-toggle', 'joins-page'],
      ['trays-toggle', 'sort-page'],
    ] as const) {
      await page.evaluate(() => scrollTo(0, 0));
      await page.getByTestId(row).click();
      await expect(page.getByTestId(pageId)).toBeVisible();
      if (pageId === 'sort-page') await expect(page.getByTestId('tray-groups')).toBeVisible({ timeout: 30_000 });
      else await expect(page.getByTestId('match-next')).toBeVisible();
      await page.waitForTimeout(300);
      expect(await smallTargets(page), pageId).toEqual([]);
      expect(await sideways(page), pageId).toBeLessThanOrEqual(0);
      await page.getByTestId('navbar-back').click();
      await expect(page.getByTestId('tab-pieces')).toHaveAttribute('aria-current', 'page');
    }
  });
}

test('M9 part 6: the tiles: a cut-out per piece, one badge per state, VoiceOver names, no rings', async ({ page }) => {
  await seedPieces(page, { cut: true, pending: [{ id: 'seen-1', like: 'r2c3', maybe: ['r2c3', 'r2c4'] }], weak: ['r1c6'], clump: ['r2c4'] });
  const tile = (id: string) => page.locator(`[data-testid="catalog"] .thumb-btn[data-id="${id}"]`);
  await expect(tiles(page)).toHaveCount(13);
  await expect(page.locator('[data-testid="catalog"] [data-cut="outline"]')).toHaveCount(13);
  // No coloured rings: no outline on a tile or its picture (only the open piece's tile has one).
  const rings = await tiles(page).evaluateAll(
    (els) =>
      els.filter((b) =>
        [b, ...b.querySelectorAll('img')].some((e) => getComputedStyle(e).outlineStyle !== 'none' && getComputedStyle(e).outlineWidth !== '0px'),
      ).length,
  );
  expect(rings).toBe(0);
  // Corner / edge glyph top-left, the spot bottom-right, "?" / "!" top-right.
  await expect(tile('r0c0').getByTestId('kind-tag')).toHaveAttribute('data-kind', 'corner');
  await expect(tile('r0c5').getByTestId('kind-tag')).toHaveAttribute('data-kind', 'edge');
  await expect(tile('r2c4').getByTestId('kind-tag')).toHaveCount(0);
  await expect(tile('seen-1').getByTestId('pending-tag')).toHaveText('?');
  await expect(tile('r1c6').getByTestId('check-tag')).toHaveText('!');
  // Touching another piece: its own badge (arrows apart, as on the photo's outlines), not the faint outline's "!".
  await expect(tile('r2c4').getByTestId('check-tag')).toHaveAttribute('data-flag', 'clump');
  await expect(tile('r2c4').getByTestId('check-tag').locator('svg.tile-split')).toHaveCount(1);
  await expect(tile('r2c4').getByTestId('check-tag')).not.toHaveText('!');
  const spots = await tiles(page).evaluateAll((els) =>
    els.map((b) => [b.getAttribute('data-place'), b.querySelector('[data-testid="spot-tag"]')?.getAttribute('data-spot') ?? null]),
  );
  for (const [place, spot] of spots) {
    if (place === 'strong' || place === 'likely') expect(spot).toBe(place);
    else expect(spot === 'shape' || spot === null).toBe(true);
  }
  expect(spots.some(([, s]) => s === 'strong')).toBe(true);
  // The badges sit in the tile's corners.
  const at = await tile('r0c0').evaluate((b) => {
    const r = b.getBoundingClientRect();
    const k = b.querySelector('[data-testid="kind-tag"]')!.getBoundingClientRect();
    const s = b.querySelector('[data-testid="spot-tag"]')!.getBoundingClientRect();
    return [k.left - r.left, k.top - r.top, r.right - s.right, r.bottom - s.bottom];
  });
  for (const v of at) expect(v).toBeLessThanOrEqual(10);
  // VoiceOver names.
  const names = await tiles(page).evaluateAll((els) => Object.fromEntries(els.map((b) => [b.getAttribute('data-id'), b.getAttribute('aria-label')])));
  expect(names['r0c0']).toMatch(/^Corner piece, .*number \d+$/);
  expect(names['r0c5']).toMatch(/^Edge piece/);
  // (the piece touching another one is left out: touching makes its shape unsure)
  const placed = await tiles(page).evaluateAll((els) =>
    els.filter((b) => b.getAttribute('data-place') === 'strong' && b.getAttribute('data-id') !== 'r2c4').map((b) => b.getAttribute('aria-label')),
  );
  expect(placed.length).toBeGreaterThan(0);
  for (const n of placed) expect(n).toMatch(/^(Corner|Edge|Inside) piece, very likely column \d+ row \d+/);
  expect(names['r1c6']).toMatch(/check outline, number \d+$/);
  expect(names['r2c4']).toMatch(/touching another piece, number \d+$/);
  expect(names['r2c4']).not.toContain('check outline');
  expect(names['seen-1']).toContain('to check, may be a piece you moved');
  // Every name is different.
  expect(new Set(Object.values(names)).size).toBe(13);
  // The legend: the same glyphs, with words.
  const legend = page.getByTestId('pieces-legend');
  for (const w of ['corner', 'edge', 'very likely', 'shape read', 'to check', 'check outline', 'touching', 'frame side']) await expect(legend).toContainText(w);
  await expect(legend.locator('.tile-kind')).toHaveCount(2);
  // A tile opens the piece's card.
  await tile('r0c0').click();
  await expect(page.getByTestId('spot')).toBeVisible();
});

test('M9 part 6: after an answer the other tiles keep their cut-outs (none left waiting)', async ({ page }) => {
  await seedPieces(page, { cut: true });
  await expect(tiles(page)).toHaveCount(12);
  await expect.poll(() => tiles(page).locator('.tile-piece:not(.tile-wait)').count()).toBe(12);
  // "It fits" on a piece with a spot: the rows are read again (new cut-out objects, same pictures).
  await tiles(page).locator('xpath=self::*[@data-place="strong" or @data-place="likely"]').first().click();
  await expect(page.getByTestId('spot-fits')).toBeVisible();
  await page.waitForTimeout(400);
  await page.getByTestId('spot-fits').click();
  await expect(page.getByTestId('spot')).toHaveCount(0);
  await expect(page.getByTestId('toast-text')).toContainText('Placed');
  await page.waitForTimeout(500);
  const n = await tiles(page).count();
  expect(n).toBeGreaterThan(0);
  await expect(page.locator('[data-testid="catalog"] .tile-wait')).toHaveCount(0);
  await expect(page.locator('[data-testid="catalog"] [data-cut="outline"] .tile-cut')).toHaveCount(n);
});

test('M9 part 6: pieces without a photo of them keep their thumbnail in the tile', async ({ page }) => {
  await seedPieces(page);
  await expect(tiles(page)).toHaveCount(12);
  await expect(page.locator('[data-testid="catalog"] [data-cut="thumb"] img.tile-thumb')).toHaveCount(12);
  await expect(page.locator('[data-testid="catalog"] .tile-cut')).toHaveCount(0);
});

test('1000 pieces on the table: the Pieces tab opens and scrolls fast, Show more adds 200', async ({ page }) => {
  await seedPieces(page, { cut: true, bulk: 988, open: null });
  await page.evaluate((pid) => (location.hash = `#/puzzle/${pid}/table`), PROJECT);
  await expect(page.getByTestId('tab-table')).toHaveAttribute('aria-current', 'page');
  // Wait until the shell has read the pieces (the Pieces tab's tools only show then).
  await openTab(page, 'pieces');
  await expect(page.getByTestId('group-all')).toContainText('1000', { timeout: 60_000 });
  await openTab(page, 'table');
  // Tap Pieces → 200 tiles drawn, their pictures loaded.
  const open = await page.evaluate(async () => {
    const t0 = performance.now();
    (document.querySelector('[data-testid="tab-pieces"]') as HTMLElement).click();
    const done = () => {
      const imgs = [...document.querySelectorAll<HTMLImageElement>('[data-testid="catalog"] img')];
      return imgs.length >= 200 && imgs.slice(0, 40).every((i) => i.complete && i.naturalWidth > 0);
    };
    let drawn = 0;
    while (!done()) {
      await new Promise((r) => requestAnimationFrame(r));
      if (!drawn && document.querySelectorAll('[data-testid="catalog"] .thumb-btn').length >= 200) drawn = performance.now() - t0;
      if (performance.now() - t0 > 20_000) break;
    }
    return { drawn: Math.round(drawn), pictures: Math.round(performance.now() - t0) };
  });
  await expect(tiles(page)).toHaveCount(200);
  // M9 part 6: the tiles are cut-outs.
  await expect(page.locator('[data-testid="catalog"] [data-cut="outline"]')).toHaveCount(200);
  await expect(page.getByTestId('catalog-more')).toContainText('Show 200 more of 800');
  // Scroll to the bottom and back over 1.5 s: the longest frame.
  const scroll = await page.evaluate(async () => {
    const frames: number[] = [];
    const end = document.documentElement.scrollHeight - innerHeight;
    let last = performance.now();
    const t0 = last;
    while (performance.now() - t0 < 1500) {
      const k = (performance.now() - t0) / 1500;
      scrollTo(0, end * (k < 0.5 ? 2 * k : 2 - 2 * k));
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      frames.push(now - last);
      last = now;
    }
    frames.sort((a, b) => a - b);
    return { frames: frames.length, p95: Math.round(frames[Math.floor(frames.length * 0.95)]!), max: Math.round(frames[frames.length - 1]!) };
  });
  // Show more: 400 tiles.
  const more = await page.evaluate(async () => {
    const t0 = performance.now();
    (document.querySelector('[data-testid="catalog-more"]') as HTMLElement).click();
    while (document.querySelectorAll('[data-testid="catalog"] .thumb-btn').length < 400) await new Promise((r) => requestAnimationFrame(r));
    return Math.round(performance.now() - t0);
  });
  // A filter: Border.
  const filter = await page.evaluate(async () => {
    const t0 = performance.now();
    (document.querySelector('[data-testid="group-border"]') as HTMLElement).click();
    while (document.querySelector('[data-testid="group-border"]')!.getAttribute('aria-pressed') !== 'true') await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    return Math.round(performance.now() - t0);
  });
  const result = { open, scroll, more, filter };
  writeFileSync(test.info().outputPath('pieces-1000.json'), JSON.stringify(result, null, 2));
  console.log('pieces-1000', JSON.stringify(result));
  expect(open.drawn).toBeLessThan(3000);
  expect(more).toBeLessThan(3000);
  expect(filter).toBeLessThan(2000);
});
