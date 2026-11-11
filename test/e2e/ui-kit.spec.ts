/**
 * M9 part 2 ("foundation") in WebKit: the component kit (src/app/ui/) on its gallery page, #/ui.
 * - the gallery is reached from Settings in Tester mode only;
 * - NavBar: back goes to the parent screen (not the browser history); the hairline and the small title
 *   appear once the page scrolls;
 * - bottom sheet: role=dialog, focus moves in and returns, Escape, a tap outside, ✕ and a swipe close it,
 *   swiping up makes it large;
 * - action sheet: focus on Cancel; Cancel, outside and Escape keep things; the red button acts;
 * - toast: role=status, Undo works within 8 s, gone after 8 s, and never over the action bar or tab bar;
 * - every button and link at least 44 × 44 px, no sideways scroll at 375 and 402 px;
 * - Reduce Motion: a sheet just disappears (no slide).
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect, gotoScreen } from './fixtures';

async function openGallery(page: Page): Promise<void> {
  await page.goto('./#/ui');
  await expect(page.getByTestId('ui-gallery')).toBeVisible();
}

/** True when the element with focus is inside `loc`. */
async function focusInside(loc: Locator): Promise<boolean> {
  return loc.evaluate((el) => el.contains(document.activeElement));
}

async function focusedTestId(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);
}

test('Settings shows "Components (for testing)" in Tester mode only; it opens the gallery', async ({ page }) => {
  await gotoScreen(page, 'settings');
  await expect(page.getByTestId('tester-on')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('settings-components').click();
  await expect(page.getByTestId('ui-gallery')).toBeVisible();
  await expect(page).toHaveTitle('Components · Puzzle Lens');
  await page.getByTestId('navbar-back').click();
  await expect(page.getByTestId('settings-components')).toBeVisible();
  await page.getByTestId('tester-off').click();
  await expect(page.getByTestId('settings-components')).toHaveCount(0);
  await page.getByTestId('tester-on').click();
});

test('NavBar: back goes to the parent screen; a hairline and the small title once scrolled', async ({ page }) => {
  // Arrive at the gallery straight from Home: back still goes to its parent, Settings, not to Home.
  await gotoScreen(page, '');
  await page.evaluate(() => (location.hash = '#/ui'));
  const bar = page.getByTestId('navbar');
  await expect(bar).toBeVisible();
  const back = page.getByRole('button', { name: 'Back to Settings' });
  await expect(back).toContainText('Settings');
  await expect(bar).not.toHaveClass(/is-scrolled/);
  await expect(bar).not.toHaveClass(/is-collapsed/);
  await page.evaluate(() => scrollTo(0, 600));
  await expect(bar).toHaveClass(/is-scrolled/);
  await expect(bar).toHaveClass(/is-collapsed/);
  // Sticky: still at the top of the screen after scrolling.
  expect((await bar.boundingBox())!.y).toBeLessThanOrEqual(1);
  await back.click();
  await expect(page).toHaveURL(/#\/settings$/);
  // Settings (via TopBar): back to Home, the title in the bar.
  await expect(page.getByRole('button', { name: 'Back to home' })).toBeVisible();
  await expect(page.locator('.navbar h1')).toHaveText('Settings');
  await page.getByRole('button', { name: 'Back to home' }).click();
  await expect(page.getByTestId('your-puzzles')).toBeVisible();
});

test('bottom sheet: focus moves in and back; Escape, a tap outside, ✕ and a swipe down close it; swipe up for large', async ({ page }) => {
  await openGallery(page);
  const opener = page.getByTestId('g-open-sheet');
  const sheet = page.getByTestId('g-sheet');

  // Escape.
  await opener.click();
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute('role', 'dialog');
  await expect(sheet).toHaveAttribute('aria-modal', 'true');
  await expect(page.getByRole('dialog', { name: 'Column 18 · Row 7' })).toBeVisible();
  await expect(sheet).toHaveAttribute('data-detent', 'medium');
  expect(await focusInside(sheet)).toBe(true);
  // The medium height is about 60 % of the screen.
  const vh = page.viewportSize()!.height;
  const h = (await sheet.boundingBox())!.height;
  expect(h / vh).toBeGreaterThan(0.55);
  expect(h / vh).toBeLessThan(0.65);
  // Tab stays inside.
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  expect(await focusInside(sheet)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  expect(await focusedTestId(page)).toBe('g-open-sheet');

  // A tap on the dimmed page above it.
  await opener.click();
  await expect(sheet).toBeVisible();
  await page.mouse.click(200, 40);
  await expect(sheet).toHaveCount(0);
  expect(await focusedTestId(page)).toBe('g-open-sheet');

  // ✕.
  await opener.click();
  await page.getByTestId('g-sheet-close').click();
  await expect(sheet).toHaveCount(0);
  expect(await focusedTestId(page)).toBe('g-open-sheet');

  // Swipe up on the title row: large; swipe down: medium again; swipe down: closed.
  await opener.click();
  await expect(sheet).toBeVisible();
  const swipe = async (dy: number) => {
    await page.waitForTimeout(400); // once it has slid in
    const head = (await sheet.locator('.ui-sheet-title').boundingBox())!;
    const x = head.x + 20;
    const y = head.y + head.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(x, y + (dy * i) / 6);
    await page.mouse.up();
  };
  await swipe(-150);
  await expect(sheet).toHaveAttribute('data-detent', 'large');
  await page.waitForTimeout(400);
  expect((await sheet.boundingBox())!.height / vh).toBeGreaterThan(0.9);
  await swipe(150);
  await expect(sheet).toHaveAttribute('data-detent', 'medium');
  await page.waitForTimeout(400);
  await swipe(150);
  await expect(sheet).toHaveCount(0);

  // The grabber is a button too (VoiceOver): it switches the height.
  await opener.click();
  await page.getByTestId('g-sheet-grabber').click();
  await expect(sheet).toHaveAttribute('data-detent', 'large');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);

  // One height only: no grabber button, and a swipe up keeps it medium.
  await page.getByTestId('g-open-sheet-fixed').click();
  await expect(page.getByTestId('g-sheet-grabber')).toHaveCount(0);
  await swipe(-150);
  await expect(sheet).toHaveAttribute('data-detent', 'medium');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
});

test('action sheet: focus on Cancel; Cancel, outside and Escape keep things; the red button acts', async ({ page }) => {
  await openGallery(page);
  const sheet = page.getByTestId('g-action');
  await page.getByTestId('g-open-action').click();
  await expect(sheet).toBeVisible();
  await expect(page.getByRole('alertdialog', { name: 'Delete “Harbour at dusk”?' })).toBeVisible();
  expect(await focusedTestId(page)).toBe('g-action-cancel');
  // Cancel is in its own box, below the red button (measured once it has slid in).
  await page.waitForTimeout(450);
  const del = (await page.getByTestId('g-action-delete').boundingBox())!;
  const cancel = (await page.getByTestId('g-action-cancel').boundingBox())!;
  expect(cancel.y).toBeGreaterThan(del.y + del.height + 4);
  await page.getByTestId('g-action-cancel').click();
  await expect(sheet).toHaveCount(0);
  expect(await focusedTestId(page)).toBe('g-open-action');
  await expect(page.getByTestId('g-answer')).toHaveText('No answer yet.');

  await page.getByTestId('g-open-action').click();
  await page.mouse.click(200, 40);
  await expect(sheet).toHaveCount(0);
  await page.getByTestId('g-open-action').click();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('g-answer')).toHaveText('No answer yet.');

  await page.getByTestId('g-open-action').click();
  await page.getByTestId('g-action-delete').click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('g-answer')).toHaveText('Answer: Deleted (example)');

  // confirmAction(): resolves true for the red button, false for Escape.
  await page.getByTestId('g-confirm').click();
  await expect(page.getByRole('alertdialog', { name: 'Delete all scanned pieces?' })).toBeVisible();
  await page.getByTestId('confirm-sheet-ok').click();
  await expect(page.getByTestId('g-answer')).toHaveText('Answer: Deleted');
  await page.getByTestId('g-confirm').click();
  await expect(page.getByTestId('confirm-sheet')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('confirm-sheet')).toHaveCount(0);
  await expect(page.getByTestId('g-answer')).toHaveText('Answer: Kept');
});

test('toast: Undo works within 8 s, it is gone after 8 s, one at a time, never over the action bar or tab bar', async ({ page }) => {
  await page.clock.install();
  await openGallery(page);
  const toast = page.getByTestId('toast');
  await expect(page.getByTestId('toast-region')).toHaveAttribute('role', 'status');

  for (const bar of ['action', 'tabs'] as const) {
    await page.getByTestId(`g-bottom-${bar}`).click();
    const barEl = page.getByTestId(bar === 'action' ? 'g-action-bar' : 'g-tabbar-fixed');
    await expect(barEl).toBeVisible();
    await page.getByTestId('g-toast').click();
    await expect(toast).toBeVisible();
    await expect(page.getByTestId('toast-region')).toContainText('Placed at column 4 · row 2');
    // The region, which doesn't move (the capsule itself rises 8 px as it appears).
    const tb = (await page.getByTestId('toast-region').boundingBox())!;
    const bb = (await barEl.boundingBox())!;
    expect(tb.y + tb.height, `toast above the ${bar} bar`).toBeLessThanOrEqual(bb.y);
    // Still there after 7.5 s; Undo works.
    await page.clock.runFor(7500);
    await expect(toast).toBeVisible();
    await page.getByTestId('toast-action').click();
    await expect(toast).toHaveCount(0);
  }
  await expect(page.getByTestId('g-undos')).toHaveText('Undo tapped 2 times.');

  // Gone after 8 s.
  await page.getByTestId('g-toast').click();
  await expect(toast).toBeVisible();
  await page.clock.runFor(8100);
  await expect(toast).toHaveCount(0);

  // One at a time: a new one replaces the old one.
  await page.getByTestId('g-toast').click();
  await page.getByTestId('g-toast-plain').click();
  await expect(toast).toHaveCount(1);
  await expect(page.getByTestId('toast-text')).toHaveText('Backup saved to Files.');
  await expect(page.getByTestId('toast-action')).toHaveCount(0);

  // Another screen: the toast (and its Undo) stays behind.
  await page.evaluate(() => (location.hash = '#/settings'));
  await expect(page.getByTestId('navbar')).toContainText('Settings');
  await expect(toast).toHaveCount(0);
  await page.evaluate(() => (location.hash = '#/ui'));
  await page.getByTestId('g-toast-plain').click();
  await expect(toast).toBeVisible();

  // With no bar at the bottom, it sits just above the bottom of the screen.
  await page.getByTestId('g-bottom-none').click();
  const tb = (await page.getByTestId('toast-region').boundingBox())!;
  expect(tb.y + tb.height).toBeLessThanOrEqual(page.viewportSize()!.height - 8);
});

test('tab bar: the selected item is marked; badges are read out', async ({ page }) => {
  await openGallery(page);
  const bar = page.getByTestId('g-tabbar');
  await expect(bar.getByTestId('g-tab-table')).toHaveAttribute('aria-current', 'page');
  await bar.getByTestId('g-tab-pieces').click();
  await expect(bar.getByTestId('g-tab-pieces')).toHaveAttribute('aria-current', 'page');
  await expect(bar.getByTestId('g-tab-table')).not.toHaveAttribute('aria-current', 'page');
  await expect(bar.getByRole('button', { name: 'Pieces, 3' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'More, backup due' })).toBeVisible();
  // 4 items in one row, each at least 44 px wide and 49 px tall.
  const boxes = await bar.locator('.tabbar-item').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
  expect(boxes).toHaveLength(4);
  for (const b of boxes) {
    expect(b.height).toBeGreaterThanOrEqual(49);
    expect(b.width).toBeGreaterThanOrEqual(44);
    expect(b.y).toBe(boxes[0]!.y);
  }
});

/** Every visible button and link in the page (or `within`) is at least 44 × 44 px. */
async function smallTargets(page: Page, within = '#app'): Promise<string[]> {
  return page.evaluate((sel) => {
    const out: string[] = [];
    for (const el of document.querySelector(sel)!.querySelectorAll<HTMLElement>('button, a[href], [role=button], input, select')) {
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

for (const size of [
  { width: 375, height: 667 },
  { width: 402, height: 874 },
]) {
  test(`${size.width} px: no button or link under 44 px, no sideways scroll (sheets open too)`, async ({ page }) => {
    await page.setViewportSize(size);
    await openGallery(page);
    const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(await smallTargets(page)).toEqual([]);
    expect(await sideways()).toBeLessThanOrEqual(0);
    await page.getByTestId('g-bottom-tabs').click();
    expect(await smallTargets(page)).toEqual([]);
    expect(await sideways()).toBeLessThanOrEqual(0);
    await page.getByTestId('g-open-sheet').click();
    await expect(page.getByTestId('g-sheet')).toBeVisible();
    expect(await smallTargets(page, '[data-testid=g-sheet]')).toEqual([]);
    expect(await sideways()).toBeLessThanOrEqual(0);
    await page.keyboard.press('Escape');
    await page.getByTestId('g-open-action').click();
    await expect(page.getByTestId('g-action')).toBeVisible();
    expect(await smallTargets(page, '[data-testid=g-action]')).toEqual([]);
    expect(await sideways()).toBeLessThanOrEqual(0);
    await page.keyboard.press('Escape');
    // The screens that now use the NavBar and the new buttons.
    await page.goto('./#/settings');
    await expect(page.getByTestId('navbar')).toBeVisible();
    expect(await sideways()).toBeLessThanOrEqual(0);
    expect(await smallTargets(page, '[data-testid=navbar]')).toEqual([]);
  });
}

test('Reduce Motion: no slide; the sheet goes at once; no press shrink', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openGallery(page);
  await page.getByTestId('g-open-sheet').click();
  const sheet = page.getByTestId('g-sheet');
  await expect(sheet).toBeVisible();
  expect(await sheet.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await page.keyboard.press('Escape');
  // Gone without waiting for the 350 ms slide.
  expect(await page.evaluate(() => new Promise<number>((res) => setTimeout(() => res(document.querySelectorAll('[data-testid=g-sheet]').length), 50)))).toBe(0);
  // Pressing a button doesn't shrink it.
  const btn = page.getByTestId('g-btn-filled');
  const box = (await btn.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  expect(await btn.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
  await page.mouse.up();
});
