/**
 * M9 part 6 help, in WebKit (design plan §4 item 10 and §3.8):
 * - Help is "How it works": four illustrated steps in order (scan, find, confirm, photograph the puzzle so far);
 *   the tester guide ("For testing") shows only in Tester mode, or from Settings → Diagnostics;
 * - every main screen, read the way VoiceOver reads it (Playwright's aria snapshot): one main landmark, one level-1
 *   heading, headings in order, the tab bar a navigation landmark, and no button, link or field without a name;
 * - busy states and results are read from the screen's one permanent status region: the scan's stages and the
 *   toasts (with their Undo);
 * - the piece card and the live view are dialogs named by their titles.
 */
import type { Page } from '@playwright/test';
import { generatePuzzle, renderScene } from '../synth/index';
import { test, expect, gotoScreen, openTab } from './fixtures';
import { cardSettled, PROJECT, seedCard, thumbs } from './place-seed';

test.use({ persistentStorage: true });
test.setTimeout(240_000);

async function setTester(page: Page, on: boolean): Promise<void> {
  await page.evaluate(() => (location.hash = '#/settings'));
  await page.getByTestId(on ? 'tester-on' : 'tester-off').click();
  await expect(page.getByTestId(on ? 'tester-on' : 'tester-off')).toHaveAttribute('aria-pressed', 'true');
}

test('Help is "How it works": four illustrated steps in order; "For testing" only in Tester mode or from Settings → Diagnostics', async ({ page }) => {
  await gotoScreen(page, 'help');
  await expect(page).toHaveTitle('How it works · Puzzle Lens');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('How it works');
  const steps = page.getByTestId('help-how').locator(':scope > li');
  await expect(steps).toHaveCount(4);
  const ids = await steps.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  expect(ids).toEqual(['help-step-scan', 'help-step-find', 'help-step-confirm', 'help-step-picture']);
  // Each step: its picture (drawn from the app's shapes: inline SVG, no image files) and a heading VoiceOver reads as "Step n: …".
  const titles = ['Step 1: Scan your pieces', 'Step 2: Find where they go', 'Step 3: Say whether it fits', 'Step 4: Photograph the puzzle so far'];
  for (let i = 0; i < 4; i++) {
    const step = steps.nth(i);
    await expect(step.locator('svg.how-art')).toHaveAttribute('aria-hidden', 'true');
    await expect(step.locator('img, image')).toHaveCount(0);
    await expect(step.getByRole('heading', { level: 2 })).toHaveAccessibleName(titles[i]!);
  }
  // Today's words: the tabs and buttons as they are named in the app.
  await expect(page.getByTestId('help-step-find')).toContainText('Table');
  await expect(page.getByTestId('help-step-find')).toContainText('Pieces in view');
  await expect(page.getByTestId('help-step-confirm')).toContainText('It fits');
  await expect(page.getByTestId('help-step-confirm')).toContainText('Not there');
  await expect(page.getByTestId('help-step-confirm')).toContainText('Undo');
  await expect(page.getByTestId('help-step-picture')).toContainText('Photograph the puzzle so far');
  // Tester mode (on by default): the tester guide follows, after the four steps.
  const testing = page.getByTestId('help-testing');
  await expect(testing).toBeVisible();
  for (const id of ['help-index', 'help-install', 'help-camera', 'help-marker', 'help-device', 'help-report', 'help-send-list', 'help-open-test-steps'])
    await expect(testing.getByTestId(id), id).toBeAttached();
  // Step 3 gives the address that opens at For testing (it shows only in Tester mode or at #/help/testing).
  await expect(testing.getByTestId('guide-address')).toHaveText(/#\/help\/testing$/);
  await expect(testing.getByTestId('help-marker')).not.toContainText('tap How it works');
  await testing.getByTestId('help-open-test-steps').click();
  await expect(page.getByTestId('test-sheet')).toBeVisible();
  await page.getByTestId('test-close').click();

  // Tester mode off: only the four steps (and nothing for testing anywhere on the page).
  await setTester(page, false);
  await page.evaluate(() => (location.hash = '#/help'));
  await expect(page.getByTestId('help-how').locator(':scope > li')).toHaveCount(4);
  await expect(page.getByTestId('help-testing')).toHaveCount(0);
  for (const id of ['help-camera', 'help-marker', 'help-device', 'help-report', 'help-send-list', 'show-test-marker'])
    await expect(page.getByTestId(id)).toHaveCount(0);
  // In a Safari tab (as here) the install steps stay, for everyone, after the four steps.
  await expect(page.getByTestId('help-install')).toBeVisible();

  // Tester mode on: Settings → Diagnostics → "For testing" opens Help at that section.
  await setTester(page, true);
  await page.getByTestId('settings-testing-guide').click();
  await expect(page).toHaveURL(/#\/help\/testing$/);
  await expect(page.getByTestId('help-testing')).toBeInViewport();
  // More's "How it works" and Home's row lead here.
  await gotoScreen(page, '');
  await expect(page.getByTestId('tool-help')).toHaveAttribute('href', '#/help');
  await expect(page.getByTestId('tool-help')).toContainText('How it works');
});

/** The page as VoiceOver reads it (aria snapshot): landmarks, headings and every control's name. */
async function checkScreen(page: Page, where: string, opts: { nav?: boolean } = {}): Promise<void> {
  await page.waitForTimeout(500);
  const snap = await page.locator('body').ariaSnapshot();
  const lines = snap.split('\n');
  const count = (re: RegExp) => lines.filter((l) => re.test(l)).length;
  expect(count(/^\s*- main\b/), `${where}: one main landmark\n${snap}`).toBe(1);
  expect(count(/^\s*- heading .*\[level=1\]/), `${where}: one level-1 heading\n${snap}`).toBe(1);
  if (opts.nav) expect(count(/^\s*- navigation\b/), `${where}: the tab bar is a navigation landmark`).toBeGreaterThanOrEqual(1);
  // No control without a name: "- button", "- button [disabled]", "- link:", "- textbox", … with no quoted name.
  const unnamed = lines.filter((l) => /^\s*- (button|link|textbox|combobox|checkbox|switch|slider|tab|menuitem|spinbutton|searchbox)\b(?!\s+")/.test(l));
  expect(unnamed, `${where}: controls without a name\n${snap}`).toEqual([]);
  // Headings in order: none more than one level below the one before it.
  const levels = lines
    .map((l) => /^\s*- heading .*\[level=(\d)\]/.exec(l)?.[1])
    .filter(Boolean)
    .map(Number);
  for (let i = 1; i < levels.length; i++) expect(levels[i]! - levels[i - 1]!, `${where}: heading levels ${levels.join(',')}`).toBeLessThanOrEqual(1);
  // The one status region is there on every screen (toasts and news for VoiceOver): the toast's, or, while a modal
  // layer is open (the live view), one inside the topmost modal (M9 part 6 fixes: WebKit may not read one outside).
  const region = page.locator('[role="status"], [aria-live]');
  await expect(region, `${where}: one status region`).toHaveCount(1);
  const inPlace = await region.evaluate((el) => {
    const modals = document.querySelectorAll('[aria-modal="true"]');
    const top = modals[modals.length - 1];
    return top ? el.getAttribute('data-testid') === 'modal-status' && el.parentElement === top : el.getAttribute('data-testid') === 'toast-region';
  });
  expect(inPlace, `${where}: the status region is in the topmost layer`).toBe(true);
}

test('every main screen: one main landmark, one h1, headings in order, named controls, one status region', async ({ page }) => {
  await seedCard(page);
  for (const s of ['', 'settings', 'help', 'report', 'device', 'log'] as const) {
    await gotoScreen(page, s);
    await checkScreen(page, s || 'home');
  }
  await page.evaluate((id) => (location.hash = `#/puzzle/${id}`), PROJECT);
  await expect(page.getByTestId('tab-panel-table')).toBeAttached();
  await checkScreen(page, 'table tab', { nav: true });
  for (const t of ['picture', 'pieces', 'more'] as const) {
    await openTab(page, t);
    await checkScreen(page, `${t} tab`, { nav: true });
  }
  for (const s of ['joins', 'sort', 'trays', 'accuracy']) {
    await page.evaluate(([r, id]) => (location.hash = `#/${r}/${id}`), [s, PROJECT]);
    await expect(page.locator(`#app > .app.route-${s}`)).toBeAttached();
    await checkScreen(page, s);
  }
  // The camera screens: a main landmark and a heading too (the camera's title is a status capsule).
  await page.evaluate((id) => (location.hash = `#/scan/${id}`), PROJECT);
  await expect(page.getByTestId('table-camera')).toBeVisible();
  await checkScreen(page, 'scan');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Scan pieces');
  await gotoScreen(page, 'live');
  await checkScreen(page, 'live camera');

  // The piece card: a dialog named by its title; its answers name the spot.
  await page.evaluate((id) => (location.hash = `#/puzzle/${id}/pieces`), PROJECT);
  await thumbs(page).nth(0).click();
  await cardSettled(page);
  await expect(page.getByRole('dialog', { name: 'Column 3 · Row 2' })).toBeVisible();
  await expect(page.getByTestId('spot-fits')).toHaveAccessibleName('It fits in column 3, row 2');
  await expect(page.getByTestId('spot-not')).toHaveAccessibleName('Not there: column 3, row 2');
});

test('the status region reads out toasts with their Undo; a toast goes with its screen', async ({ page }) => {
  await seedCard(page);
  await thumbs(page).nth(0).click();
  await cardSettled(page);
  await page.getByTestId('spot-fits').click();
  const region = page.getByTestId('toast-region');
  await expect(region).toHaveAttribute('role', 'status');
  await expect(region.getByTestId('toast-text')).toHaveText('Placed at 3·2');
  await expect(region.getByRole('button', { name: 'Undo' })).toBeVisible();
  // A screen change takes the screen's news with it.
  await openTab(page, 'more');
  await expect(region.getByTestId('toast')).toHaveCount(0);
});

test.describe('the scan', () => {
  const W = 4032;
  const H = 3024;
  let photo: Buffer = Buffer.alloc(0);
  test.use({ fakeCameraOptions: { width: W, height: H, fps: 4 } });
  test.beforeAll(async () => {
    const puzzle = generatePuzzle({ cols: 8, rows: 6, cellMm: [17.8, 19.4], seed: 12 });
    photo = (
      await renderScene({
        puzzle,
        seed: 44,
        markers: [],
        layout: { areaMm: [600, 450], originMm: [100, 80] },
        camera: { x: 400, y: 305, heightMm: 680, tiltDeg: 1, imageSize: [W, H] },
        light: { dirDeg: 200 },
      })
    ).jpeg;
  });

  test('its stages are read out from the one status region, in order; the result opens as a named dialog', async ({ page }) => {
    // Every announcement, as VoiceOver would get it (the region's hidden words, each time they change).
    await page.addInitScript(() => {
      const said: string[] = [];
      const inWait: string[] = [];
      Object.assign(window, { __said: said, __inWait: inWait });
      new MutationObserver(() => {
        const el = document.querySelector('[role="status"] [data-testid="announce"]');
        const t = el?.textContent ?? '';
        if (t && said.at(-1) !== t) {
          said.push(t);
          // M9 part 6 fixes: read from inside the wait (an aria-modal dialog) while it is open.
          if (el!.closest('[data-testid="scan-wait"]')) inWait.push(t);
        }
      }).observe(document, { subtree: true, childList: true, characterData: true });
    });
    await gotoScreen(page, '');
    await page.evaluate(async () => {
      const req = indexedDB.open('puzzle-lens');
      const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      await new Promise<void>((res) => {
        const tx = dbh.transaction(['projects', 'settings'], 'readwrite');
        tx.objectStore('settings').put({ key: 'scanMode', value: 'quick' });
        tx.objectStore('projects').put({
          id: 'e2e-a11y-scan',
          name: 'Access',
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
    });
    await page.reload();
    await page.evaluate(() => (location.hash = '#/scan/e2e-a11y-scan'));
    await expect(page.getByTestId('table-camera')).toBeVisible();
    await page.getByTestId('pick-photo-input').setInputFiles({ name: 'IMG_0001.jpeg', mimeType: 'image/jpeg', buffer: photo });
    await expect(page.getByRole('dialog', { name: /Found \d+ pieces?/ })).toBeVisible({ timeout: 150_000 });
    const said = await page.evaluate(() => (window as unknown as { __said: string[] }).__said);
    const stages = said.filter((s) => ['Reading photo', 'Finding pieces', 'Saving'].includes(s));
    expect(stages, said.join(' | ')).toEqual(['Reading photo', 'Finding pieces', 'Saving']);
    const inWait = await page.evaluate(() => (window as unknown as { __inWait: string[] }).__inWait);
    expect(
      inWait.filter((s) => s !== 'Saving'),
      inWait.join(' | '),
    ).toEqual(['Reading photo', 'Finding pieces']);
    // The wait itself has no live region of its own: one status region on the screen (inside the result dialog now).
    await expect(page.locator('[role="status"], [aria-live]')).toHaveCount(1);
  });
});
