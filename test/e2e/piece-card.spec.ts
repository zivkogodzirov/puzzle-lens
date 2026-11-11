/**
 * The piece card (M9 part 3, design plan §4 item 4): tapping a piece opens one bottom sheet with its cut-out,
 * its spot and how sure the app is, the box picture zoomed on that spot (ringed, the rest dimmed), and the
 * answers "Not there" / "It fits", each with an Undo toast; "Not a piece" at one tap, with Undo; "Also possible"
 * spots to show instead; "Point it out" in the live view and back. Also: the answers side by side or one above
 * the other, 44 px targets, focus into the sheet and back, and a quick tap right after opening (M8 part 4's
 * lesson: it lands on "It fits" or on nothing, never on another button).
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { cardSettled, pieceRow, seedCard, thumbs } from './place-seed';

test.setTimeout(180_000);
// Blobs in IndexedDB need a persistent WebKit context (as in scan-bin.spec.ts).
test.use({ persistentStorage: true });

/** Buttons and links under 44 × 44 px inside `within` (as in puzzle-page.spec.ts). */
async function smallTargets(page: Page, within: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const out: string[] = [];
    for (const root of document.querySelectorAll(sel))
      for (const el of root.querySelectorAll<HTMLElement>('button, a[href], [role=button], input, select')) {
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

const box = async (l: Locator) => (await l.boundingBox())!;

/** r1c2 (first in id order) goes in column 3, row 2. */
const FIRST = 'r1c2';

/** A piece with three possible spots (stored placement), listed last. */
const EXTRA = {
  id: 'x1',
  top: [
    { col: 6, row: 5, p: 0.5 },
    { col: 2, row: 6, p: 0.3 },
    { col: 8, row: 0, p: 0.15 },
  ],
  verdict: 'likely' as const,
};

test('the card is a sheet: its cut-out, spot, words, the zoomed spot ringed; focus goes in and back', async ({ page }) => {
  await seedCard(page, { tester: false });
  await thumbs(page).nth(0).click();
  await cardSettled(page);
  const sheet = page.getByTestId('spot');
  await expect(sheet).toHaveAttribute('role', 'dialog');
  await expect(sheet).toHaveAttribute('aria-modal', 'true');
  await expect(sheet).toHaveAttribute('data-detent', 'medium');
  await expect(sheet.getByTestId('piece-spots')).toBeVisible();
  // Focus is in the sheet (on the dialog, so VoiceOver reads its title first).
  expect(await page.evaluate(() => document.activeElement?.closest('[data-testid="spot"]') !== null)).toBe(true);
  await expect(sheet).toHaveAccessibleName(/Column 3 · Row 2/);
  // Header: the 64 px cut-out, the spot (Title 3), how sure in words (no % outside Tester mode).
  const thumb = sheet.locator('.card-thumb img');
  await expect(thumb).toBeVisible();
  expect(Math.round((await box(sheet.locator('.card-thumb'))).width)).toBe(64);
  await expect(page.getByTestId('spot-name')).toHaveText('Column 3 · Row 2');
  expect(await page.getByTestId('spot-name').evaluate((e) => getComputedStyle(e).fontSize)).toBe('20px');
  await expect(page.getByTestId('spot-confidence')).toHaveText(/^(Very likely|Maybe|Several places look alike)$/);
  // The zoomed spot: 3 rows down, its cell ringed (column 3, row 2 = cell 2,1), about 200 px tall (less on a short
  // screen: this Safari tab is 681 px tall), the card's full width, not stretched.
  const crop = page.getByTestId('spot-crop');
  await expect(crop).toHaveAttribute('data-cells', '2,1');
  await expect(page.getByTestId('spot-crop-cell')).toHaveAttribute('x', '2');
  await expect(page.getByTestId('spot-crop-cell')).toHaveAttribute('y', '1');
  const [x, y, w, h] = (await crop.getAttribute('viewBox'))!.split(' ').map(Number);
  expect(h).toBe(3);
  expect(w!).toBeGreaterThan(4);
  expect(w!).toBeLessThan(9);
  expect(x! <= 2 && x! + w! >= 3 && y! <= 1 && y! + h! >= 2, 'the ringed cell is in view').toBe(true);
  const cb = await box(crop);
  const vh = await page.evaluate(() => innerHeight);
  expect(cb.height).toBeGreaterThan(Math.min(200, vh * 0.24) - 4);
  expect(cb.height).toBeLessThan(204);
  expect(cb.width).toBeGreaterThan(320);
  // Cells 17.8 × 19.4 mm: the picture keeps their shape.
  expect(cb.width / cb.height).toBeCloseTo((w! * (17.8 / 19.4)) / h!, 1);
  await expect(crop.locator('.crop-dim')).toHaveCount(1);
  // "Whole picture" and back.
  await page.getByTestId('spot-whole').click();
  await expect(page.getByTestId('spot-box')).toBeVisible();
  await expect(page.getByTestId('spot-whole')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('spot-whole').click();
  await expect(page.getByTestId('spot-crop')).toBeVisible();
  // The answers and "Not a piece" show at the medium height, above the Home bar.
  for (const id of ['spot-not', 'spot-fits']) await expect(page.getByTestId(id)).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId('spot-remove')).toHaveText(/Not a piece/);
  // Escape closes it; focus goes back to the piece tapped.
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.classList.contains('thumb-btn'))).toBe(true);
  // A swipe up (here a tap on the grabber) makes it large.
  await thumbs(page).nth(0).click();
  await cardSettled(page);
  await page.getByTestId('spot-grabber').focus();
  await page.keyboard.press('Enter');
  await expect(sheet).toHaveAttribute('data-detent', 'large');
  await page.getByTestId('spot-close').click();
  await expect(sheet).toHaveCount(0);
});

test('It fits: the card closes, "Placed at 3·2" with Undo; Undo puts the piece back on the table', async ({ page }) => {
  await seedCard(page);
  await thumbs(page).nth(0).click();
  await expect(page.getByTestId('spot-confidence')).toContainText('%'); // Tester mode: the % after the word
  await page.getByTestId('spot-fits').click();
  await expect(page.getByTestId('spot')).toHaveCount(0);
  await expect(page.getByTestId('toast-text')).toHaveText('Placed at 3·2');
  await expect.poll(async () => (await pieceRow(page, FIRST))?.status).toBe('placed');
  await expect(thumbs(page)).toHaveCount(5);
  await page.getByTestId('toast-action').click();
  await expect.poll(async () => (await pieceRow(page, FIRST))?.status).toBe('table');
  await expect(thumbs(page)).toHaveCount(6);
});

test('Not there: the card moves to the next spot, "Not at 3·2" with Undo; Undo shows that spot again', async ({ page }) => {
  await seedCard(page);
  await thumbs(page).nth(0).click();
  await expect(page.getByTestId('spot-name')).toHaveText('Column 3 · Row 2');
  await page.getByTestId('spot-not').click();
  // In place: the same card, now on another spot.
  await expect(page.getByTestId('spot')).toBeVisible();
  await expect(page.getByTestId('spot-name')).not.toHaveText('Column 3 · Row 2');
  await expect(page.getByTestId('spot-crop')).not.toHaveAttribute('data-cells', '2,1');
  await expect(page.getByTestId('toast-text')).toHaveText('Not at 3·2');
  // The toast sits above the medium sheet, clear of its answers.
  const toastBox = await box(page.getByTestId('toast'));
  expect(toastBox.y + toastBox.height).toBeLessThanOrEqual((await box(page.getByTestId('spot'))).y);
  await page.getByTestId('toast-action').click();
  await expect(page.getByTestId('spot-name')).toHaveText('Column 3 · Row 2');
  await expect(page.getByTestId('spot-ruled-out')).toHaveCount(0);
});

test('Not a piece: one tap removes it ("Removed" with Undo); Undo brings its row back', async ({ page }) => {
  await seedCard(page);
  await thumbs(page).nth(0).click();
  await expect(page.getByTestId('spot-remove')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.getByTestId('spot-remove').click();
  await expect(page.getByTestId('spot')).toHaveCount(0);
  await expect(page.getByTestId('spot-remove-yes')).toHaveCount(0);
  await expect(page.getByTestId('toast-text')).toContainText('Removed');
  await expect.poll(() => pieceRow(page, FIRST)).toBeNull();
  await expect(thumbs(page)).toHaveCount(5);
  // Opening the next piece's card keeps that Undo (review 2026-11-11: the next card used to close it).
  await thumbs(page).nth(0).click();
  await expect(page.getByTestId('spot')).toBeVisible();
  await expect(page.getByTestId('toast-text')).toContainText('Removed');
  await page.getByTestId('spot-close').click();
  await expect(page.getByTestId('spot')).toHaveCount(0);
  await page.getByTestId('toast-action').click();
  await expect.poll(async () => (await pieceRow(page, FIRST))?.status).toBe('table');
  await expect(thumbs(page)).toHaveCount(6);
  // It is placed again as before.
  await thumbs(page).nth(0).click();
  await expect(page.getByTestId('spot-name')).toHaveText('Column 3 · Row 2');
});

test('Also possible: the other spots as small crops with words; a tap shows one, and It fits answers for it', async ({ page }) => {
  await seedCard(page, { extra: [EXTRA] });
  await expect(thumbs(page)).toHaveCount(7);
  await thumbs(page).nth(6).click();
  await expect(page.getByTestId('spot-name')).toHaveText('Column 7 · Row 6');
  await expect(page.getByTestId('spot-confidence')).toHaveText('Maybe, 50 %');
  const alts = page.getByTestId('spot-alt');
  await expect(alts).toHaveCount(2);
  await expect(alts.nth(0)).toContainText('3 · 7');
  await expect(alts.nth(0)).toContainText('Maybe');
  await expect(alts.nth(0).getByTestId('spot-alt-crop')).toHaveAttribute('data-cells', '2,6');
  await alts.nth(0).click();
  await expect(page.getByTestId('spot-name')).toHaveText('Column 3 · Row 7');
  await expect(page.getByTestId('spot-crop')).toHaveAttribute('data-cells', '2,6');
  // The best one is now among the others.
  await expect(alts.nth(0)).toContainText('7 · 6');
  expect(await smallTargets(page, '[data-testid=spot]')).toEqual([]);
  await page.getByTestId('spot-fits').click();
  await expect(page.getByTestId('toast-text')).toHaveText('Placed at 3·7');
  const row = await page.evaluate(async () => {
    const req = indexedDB.open('puzzle-lens');
    const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
    const r = await new Promise<{ placedAt: { col: number; row: number } }>((res) => {
      const q = dbh.transaction('pieces').objectStore('pieces').get('x1');
      q.onsuccess = () => res(q.result);
    });
    dbh.close();
    return r.placedAt;
  });
  expect([row.col, row.row]).toEqual([2, 6]);
});

test('Point it out: the live view pulses this piece; closing it brings the card back (without Point it out)', async ({ page }) => {
  await seedCard(page);
  await thumbs(page).nth(0).click();
  await page.getByTestId('spot-find').click();
  await expect(page.getByTestId('spot')).toHaveCount(0);
  await expect(page.getByTestId('live-table')).toBeVisible();
  await expect(page.getByTestId('live-table')).toContainText('Find this piece');
  await page.getByTestId('live-table-close').click();
  await expect(page.getByTestId('live-table')).toHaveCount(0);
  await expect(page.getByTestId('spot-name')).toHaveText('Column 3 · Row 2');
  await expect(page.getByTestId('spot-find')).toHaveCount(0);
});

test('Fill a spot: a candidate’s picture opens its card on that spot; the answers there are “Not there” / “It fits”', async ({ page }) => {
  await seedCard(page);
  await page.getByTestId('fill-toggle').click();
  // r3c7's spot: column 8, row 4.
  const svg = page.getByTestId('fill-picture');
  const b = await box(svg);
  await svg.click({ position: { x: (7.5 / 10) * b.width, y: (3.5 / 8) * b.height } });
  const cand = page.getByTestId('fill-best').getByTestId('fill-cand');
  await expect(cand).toHaveCount(1);
  await expect(cand.getByTestId('fill-not')).toHaveText('Not there');
  await expect(cand.getByTestId('fill-fits')).toHaveText('It fits');
  // "It fits" on the right of "Not there", or above it when they don't fit side by side.
  const [nb, fb] = [await box(cand.getByTestId('fill-not')), await box(cand.getByTestId('fill-fits'))];
  expect(fb.x > nb.x || fb.y < nb.y).toBe(true);
  await cand.getByTestId('fill-cand-pick').click();
  await expect(page.getByTestId('spot-name')).toHaveText('Column 8 · Row 4');
  await page.getByTestId('spot-not').click();
  await expect(page.getByTestId('toast-text')).toHaveText('Not at 8·4');
});

for (const size of [
  { width: 402, height: 874 },
  { width: 375, height: 667 },
])
  test(`${size.width} px: the answers side by side, 56 px tall with 12 px between; 44 px targets; larger text stacks them`, async ({ page }) => {
    await page.setViewportSize(size);
    await seedCard(page);
    if (size.width === 402) await page.addStyleTag({ content: ':root { --safe-top: 62px !important; --safe-bottom: 34px !important; }' });
    await thumbs(page).nth(0).click();
    await cardSettled(page);
    const not = page.getByTestId('spot-not');
    const fits = page.getByTestId('spot-fits');
    await expect(fits).toBeInViewport({ ratio: 1 });
    let [nb, fb] = [await box(not), await box(fits)];
    expect(Math.round(nb.height)).toBe(56);
    expect(Math.round(fb.height)).toBe(56);
    expect(Math.abs(nb.y - fb.y), 'one row').toBeLessThan(1);
    expect(fb.x, '"It fits" on the right').toBeGreaterThan(nb.x);
    expect(Math.round(fb.x - (nb.x + nb.width))).toBe(12);
    await expect(fits).toHaveClass(/btn-good/);
    await expect(fits).toHaveAccessibleName('It fits');
    await expect(not).toHaveAccessibleName('Not there');
    // Above the Home bar at the medium height.
    expect(fb.y + fb.height).toBeLessThanOrEqual(size.height - (size.width === 402 ? 34 : 0));
    expect(await smallTargets(page, '[data-testid=spot]')).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    // Larger text (the iPhone Text Size above the default): one above the other, "It fits" on top.
    await page.addStyleTag({ content: ':root { --t-headline: 600 26px/32px var(--font-family) !important; }' });
    [nb, fb] = [await box(not), await box(fits)];
    expect(fb.y + fb.height, '"It fits" on top').toBeLessThanOrEqual(nb.y);
    expect(Math.round(nb.y - (fb.y + fb.height))).toBe(12);
    expect(Math.round(fb.width)).toBe(Math.round(nb.width));
  });

// The old panel (M8 part 4, 2026-11-10) was scrolled into view after it was drawn, and a quick tap on ✓ Fits landed on
// "Remove it". The card is a sheet: it doesn't scroll the page, and while it slides up its buttons take no taps.
test('a quick tap right after opening lands on It fits or on nothing, never on another button; then It fits stays put', async ({ page }) => {
  await seedCard(page);
  // Where "It fits" ends up: open once, let it settle, close.
  await thumbs(page).nth(0).click();
  await expect.poll(() => page.getByTestId('spot').evaluate((e) => e.hasAttribute('data-opening'))).toBe(false);
  const fb = await box(page.getByTestId('spot-fits'));
  const P = [fb.x + fb.width / 2, fb.y + fb.height / 2] as const;
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('spot')).toHaveCount(0);
  // Again, noting in every frame what a tap at that point would hit while the sheet slides up.
  await page.evaluate(([x, y]) => {
    const hits: Array<{ button: string | null; opening: boolean | null }> = [];
    (window as unknown as { __hits: typeof hits }).__hits = hits;
    const t0 = performance.now();
    const frame = () => {
      const sheet = document.querySelector('[data-testid="spot"]');
      const b = document.elementFromPoint(x, y)?.closest('button');
      hits.push({ button: b ? (b.dataset.testid ?? b.className) : null, opening: sheet ? sheet.hasAttribute('data-opening') : null });
      if (performance.now() - t0 < 1500) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, P);
  await thumbs(page).nth(0).click();
  await page.waitForTimeout(1600);
  const hits = (await page.evaluate(() => (window as unknown as { __hits: Array<{ button: string | null; opening: boolean | null }> }).__hits)).filter(
    (h) => h.opening !== null,
  );
  expect(
    hits.some((h) => h.opening),
    'frames while it slides up',
  ).toBe(true);
  expect(
    hits.filter((h) => h.button && h.button !== 'spot-fits'),
    'no other button under the finger',
  ).toEqual([]);
  expect(hits.at(-1)!.button).toBe('spot-fits');
  // Settled: it doesn't move (the cut-out and the box picture are drawn by now), and the tap counts.
  const at = await box(page.getByTestId('spot-fits'));
  await page.mouse.move(P[0], P[1]);
  await page.mouse.down();
  await page.waitForTimeout(300);
  const now = await box(page.getByTestId('spot-fits'));
  expect(Math.abs(now.x + now.width / 2 - (at.x + at.width / 2))).toBeLessThan(0.5);
  expect(Math.abs(now.y + now.height / 2 - (at.y + at.height / 2))).toBeLessThan(0.5);
  await page.mouse.up();
  await expect(page.getByTestId('toast-text')).toHaveText('Placed at 3·2');
});

test('Reduce Motion: the card appears at once; a tap on It fits right away counts and It fits doesn’t move under the finger', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedCard(page);
  // The pieces at the bottom of the screen, just above the action bar (where the old panel opened out of sight).
  const bar = (await box(page.getByTestId('action-bar'))).y;
  await page.evaluate((bottom) => {
    const g = document.querySelector('[data-testid="catalog"]')!.getBoundingClientRect();
    scrollBy(0, g.bottom - bottom + 4);
  }, bar);
  const t = await box(thumbs(page).nth(0));
  await page.mouse.click(t.x + t.width / 2, t.y + t.height / 2);
  const at = await page.getByTestId('spot-fits').evaluate((b) => b.getBoundingClientRect().toJSON() as DOMRect);
  expect(at.top).toBeGreaterThanOrEqual(0);
  expect(at.bottom).toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
  expect(await page.getByTestId('spot').evaluate((e) => e.hasAttribute('data-opening'))).toBe(false);
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(100);
  const now = await page.getByTestId('spot-fits').evaluate((b) => b.getBoundingClientRect().toJSON() as DOMRect);
  expect(Math.abs(now.top - at.top)).toBeLessThan(2);
  expect(Math.abs(now.bottom - at.bottom)).toBeLessThan(2);
  await page.mouse.up();
  await expect(page.getByTestId('in-puzzle')).toContainText('1 in the puzzle');
});
