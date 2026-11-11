/**
 * M9 part 6 "type" (design plan §3.3, decision 11, §3.8 rule 4): the text follows the iPhone's Text Size
 * setting. On the iPhone the root font is `-apple-system-body` (17 px at the default size, up to about 31 px at
 * the largest accessibility size, in Settings → Accessibility → Display & Text Size → Larger Text); every font
 * size is in rem from there. WebKit on a Mac doesn't have that font, so the largest size is simulated here by
 * setting the root font to 31 px, as the iPhone does.
 * At the largest size, on every screen (Home, a puzzle's four tabs, the piece card, Settings, Help, the scan
 * camera and its result sheet): no sideways scroll, no clipped text, targets still 44 px or more; the camera's
 * text stays at about 24 px or less so it doesn't bury the picture.
 * TS_SHOTS=<folder> also saves a screenshot of each screen there (light and dark, 402×874 and 375×667).
 */
import type { Page } from '@playwright/test';
import { generatePuzzle, renderScene } from '../synth/index';
import { test, expect, gotoScreen, openTab } from './fixtures';
import { cardSettled, seedCard, thumbs, PROJECT } from './place-seed';

// TS_ROOT=17 runs the same checks at the default size (for before / after pictures).
const LARGEST = Number(process.env.TS_ROOT ?? 31);
const SHOTS = process.env.TS_SHOTS ?? '';

/** The iPhone's largest accessibility text size: the root font at 31 px (17 px is the default). */
async function largest(page: Page): Promise<void> {
  await page.addStyleTag({ content: `html { font-size: ${LARGEST}px !important; }` });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(`${LARGEST}px`);
}

interface Problems {
  sideways: string[];
  clipped: string[];
  small: string[];
}

/**
 * What is wrong on the page as it is now: sideways scroll; text cut off (by its own box or by a box around it
 * that hides overflow, or past the screen's sides); buttons and links under 44 × 44 px.
 */
async function audit(page: Page): Promise<Problems> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const sideways: string[] = [];
    const se = document.scrollingElement!;
    if (se.scrollWidth > se.clientWidth + 1) sideways.push(`page ${se.scrollWidth} > ${se.clientWidth}`);
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${[...el.classList].join('.')}${el.getAttribute('data-testid') ? `[${el.getAttribute('data-testid')}]` : ''} "${(el.textContent ?? '').trim().slice(0, 28)}"`;
    const shown = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) return false;
      for (let a: HTMLElement | null = el; a; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return false;
        if (a.getAttribute('aria-hidden') === 'true' && a.closest('.ui-sheet-root.is-closing')) return false;
      }
      return true;
    };
    const clipped: string[] = [];
    for (const el of document.body.querySelectorAll<HTMLElement>('*')) {
      if (!(el instanceof HTMLElement) || el.closest('svg, canvas, video, pre, .hud, .test-tab, [inert]')) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim());
      if (!own || !shown(el)) continue;
      const cs = getComputedStyle(el);
      // Its own box: hidden overflow or clamped lines.
      if (cs.overflowX !== 'visible' && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll' && el.scrollWidth > el.clientWidth + 1) {
        clipped.push(`${name(el)} width ${el.scrollWidth} > ${el.clientWidth}`);
        continue;
      }
      if (cs.overflowY !== 'visible' && cs.overflowY !== 'auto' && cs.overflowY !== 'scroll' && el.scrollHeight > el.clientHeight + 1) {
        clipped.push(`${name(el)} height ${el.scrollHeight} > ${el.clientHeight}`);
        continue;
      }
      const r = el.getBoundingClientRect();
      if (r.left < -1 || r.right > vw + 1) {
        clipped.push(`${name(el)} past the screen's side (${Math.round(r.left)}–${Math.round(r.right)})`);
        continue;
      }
      // A box around it that hides what sticks out (not one that scrolls).
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const ac = getComputedStyle(a);
        const hideX = ac.overflowX === 'hidden' || ac.overflowX === 'clip';
        const hideY = ac.overflowY === 'hidden' || ac.overflowY === 'clip';
        if (!hideX && !hideY) continue;
        const ar = a.getBoundingClientRect();
        if ((hideX && (r.left < ar.left - 1 || r.right > ar.right + 1)) || (hideY && (r.top < ar.top - 1 || r.bottom > ar.bottom + 1))) {
          clipped.push(`${name(el)} cut off by ${name(a)}`);
          break;
        }
      }
    }
    const small: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('button, a[href], [role=button], input, select')) {
      if (el.closest('[inert], .test-tab') || !shown(el) || el.matches('.sr-only, [type=file], [type=checkbox][switch]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 43.5 || r.height < 43.5) small.push(`${name(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return { sideways, clipped, small };
  });
}

/** Saves the screen's pictures (TS_SHOTS only), light and dark, at this test's phone size. */
async function shots(page: Page, label: string): Promise<void> {
  if (!SHOTS) return;
  const { width, height } = page.viewportSize()!;
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/${label}-${scheme}-${width}x${height}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

/**
 * The screen as it is: nothing to fix (each problem is listed). The phone size is set per test, not changed
 * here: resizing with a sheet open sets off the pieces' ResizeObserver, which isn't what is tested.
 */
async function check(page: Page, label: string): Promise<void> {
  const { width } = page.viewportSize()!;
  await page.waitForTimeout(200);
  const p = await audit(page);
  expect.soft(p.sideways, `${label} ${width}: sideways scroll`).toEqual([]);
  expect.soft(p.clipped, `${label} ${width}: clipped text`).toEqual([]);
  expect.soft(p.small, `${label} ${width}: targets under 44 px`).toEqual([]);
  await shots(page, label);
}

/** The biggest font size of any text in the camera's view (not in a sheet over it). */
const cameraBiggest = (page: Page) =>
  page.evaluate(() => {
    let max = 0;
    let at = '';
    for (const el of document.querySelectorAll<HTMLElement>('.live *')) {
      if (el.closest('svg, .ui-sheet-root, .hud')) continue;
      if (![...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim())) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs > max) [max, at] = [fs, `${el.className} "${(el.textContent ?? '').trim().slice(0, 20)}"`];
    }
    return { max, at };
  });

test.use({ colorScheme: 'light' });

/** The Home Screen app on an iPhone 17 Pro (402 × 874, safe areas 62 / 34) and an iPhone SE in Safari's view (375 × 667). */
const PHONES = [
  { width: 402, height: 874 },
  { width: 375, height: 667 },
];

test('the root font follows the Text Size setting: 17 px by default, everything in proportion at the largest size', async ({ page }) => {
  await gotoScreen(page, 'settings');
  const sizes = () =>
    page.evaluate(() => ({
      root: getComputedStyle(document.documentElement).fontSize,
      body: getComputedStyle(document.body).fontSize,
      title: getComputedStyle(document.querySelector('.large-title, .navbar-title, h1')!).fontSize,
      row: getComputedStyle(document.querySelector('.list-row, .btn, p')!).fontSize,
    }));
  const before = await sizes();
  expect(before.root).toBe('17px');
  expect(before.body).toBe('17px');
  await largest(page);
  const after = await sizes();
  expect(after.body).toBe(`${LARGEST}px`);
  // Each text grows with the setting (the navigation bar's title has a ceiling, so it's not checked here).
  expect(parseFloat(after.row)).toBeCloseTo((parseFloat(before.row) * LARGEST) / 17, 0);
});

for (const vp of PHONES) {
  test.describe(() => {
    test.use({ viewport: vp });

    test(`${vp.width}×${vp.height}, at the largest size: Home, Settings and Help have no sideways scroll, no clipped text, 44 px targets`, async ({ page }) => {
      await gotoScreen(page, '');
      await largest(page);
      await check(page, 'home-empty');
      await gotoScreen(page, 'settings');
      await largest(page);
      await check(page, 'settings');
      await gotoScreen(page, 'help');
      await largest(page);
      await check(page, 'help');
    });

    test.describe(() => {
      test.use({ persistentStorage: true });
      test.setTimeout(240_000);

      test(`${vp.width}×${vp.height}, at the largest size: a puzzle on Home, its four tabs and the piece card`, async ({ page }) => {
        await seedCard(page, { tester: false });
        await largest(page);
        await check(page, 'tab-pieces');
        await thumbs(page).nth(0).click();
        await cardSettled(page);
        // The answer buttons one above the other ("It fits" on top), each 44 px or more.
        const fits = (await page.getByTestId('spot-fits').boundingBox())!;
        const not = (await page.getByTestId('spot-not').boundingBox())!;
        expect.soft(fits.y + fits.height, '"It fits" above "Not there"').toBeLessThanOrEqual(not.y + 1);
        await check(page, 'piece-card');
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('spot')).toHaveCount(0);
        for (const tab of ['table', 'picture', 'more'] as const) {
          await openTab(page, tab);
          await page.waitForTimeout(500);
          await check(page, `tab-${tab}`);
        }
        await page.evaluate(() => (location.hash = '#/'));
        await expect(page.locator('#app > .app.route-home')).toBeAttached();
        await expect(page.getByText('Card test').first()).toBeVisible();
        await check(page, 'home');
        expect(PROJECT).toBe('e2e-card');
      });
    });

    test.describe(() => {
      test.use({ persistentStorage: true, fakeCameraOptions: { width: 4032, height: 3024, fps: 4 } });
      test.setTimeout(300_000);

      test(`${vp.width}×${vp.height}, at the largest size: the scan camera (its text 24 px at most) and the result sheet`, async ({ page }) => {
        const few = (await renderScene({
          puzzle: generatePuzzle({ cols: 2, rows: 2, cellMm: [17.8, 19.4], seed: 5 }),
          seed: 44,
          markers: [],
          layout: { areaMm: [600, 450], originMm: [100, 80] },
          camera: { x: 400, y: 305, heightMm: 680, tiltDeg: 1, imageSize: [4032, 3024] },
          light: { dirDeg: 200 },
        }).then((s) => s.jpeg)) as Buffer;
        await gotoScreen(page, '');
        await page.evaluate(async () => {
          const req = indexedDB.open('puzzle-lens');
          const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
          await new Promise<void>((res) => {
            const tx = dbh.transaction(['projects', 'settings'], 'readwrite');
            tx.objectStore('settings').put({ key: 'scanMode', value: 'quick' });
            tx.objectStore('settings').put({ key: 'testerMode', value: false });
            tx.objectStore('projects').put({
              id: 'e2e-type-cam',
              name: 'Type',
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
        await page.evaluate(() => (location.hash = '#/scan/e2e-type-cam'));
        await expect(page.getByTestId('table-camera')).toBeVisible();
        // First the card asking for the tilt sensor, then (tilted) the status capsule with its instruction.
        await expect(page.getByTestId('allow-tilt')).toBeVisible({ timeout: 60_000 });
        const normal = await cameraBiggest(page);
        await largest(page);
        let big = await cameraBiggest(page);
        expect.soft(big.max, `the camera's biggest text (${big.at})`).toBeLessThanOrEqual(24.5);
        expect.soft(big.max, 'the camera text grows a little').toBeGreaterThan(normal.max);
        await check(page, 'scan-camera-tilt-card');
        await page.getByTestId('allow-tilt').click();
        await page.evaluate(() => setInterval(() => dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: 0, beta: 20, gamma: 0 })), 50));
        await expect(page.getByTestId('camera-status')).toContainText('Hold the phone flat', { timeout: 120_000 });
        big = await cameraBiggest(page);
        expect.soft(big.max, `the camera's biggest text (${big.at})`).toBeLessThanOrEqual(24.5);
        await check(page, 'scan-camera');

        await page.getByTestId('pick-photo-input').setInputFiles({ name: 'IMG_0001.jpeg', mimeType: 'image/jpeg', buffer: few });
        const note = page.getByTestId('scan-note');
        await expect(note).toContainText('Hardly any pieces', { timeout: 150_000 });
        await page.waitForTimeout(600);
        await check(page, 'result-sheet');
        // Its buttons are all on screen or reached by scrolling the sheet.
        for (const id of ['result-another', 'result-see-photo']) {
          await page.getByTestId(id).scrollIntoViewIfNeeded();
          await expect(page.getByTestId(id)).toBeInViewport();
        }
      });
    });
  });
}

/** M9 part 6 fixes: at about 53 px (a browser's own biggest text, past the iPhone's largest) the piece card's answers and title stay on the screen. */
for (const vp of PHONES) {
  test.describe(() => {
    test.use({ viewport: vp, persistentStorage: true });
    test.setTimeout(240_000);

    test(`${vp.width}×${vp.height}, root 53 px: the piece card's answers and title stay inside the screen`, async ({ page }) => {
      await seedCard(page, { tester: false });
      await page.addStyleTag({ content: 'html { font-size: 53px !important; }' });
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('53px');
      await thumbs(page).nth(0).click();
      await cardSettled(page);
      for (const [id, el] of [
        ['spot-fits', page.getByTestId('spot-fits')],
        ['spot-not', page.getByTestId('spot-not')],
        ['title', page.getByTestId('spot').locator('.ui-sheet-title')],
      ] as const) {
        await el.scrollIntoViewIfNeeded();
        const r = await el.evaluate((e) => {
          const b = e.getBoundingClientRect();
          // Its words inside its own box too (not spilling out of the button).
          return { left: b.left, right: b.right, overX: e.scrollWidth - e.clientWidth, overY: e.scrollHeight - e.clientHeight };
        });
        expect.soft(r.left, `${id} left`).toBeGreaterThanOrEqual(-1);
        expect.soft(r.right, `${id} right`).toBeLessThanOrEqual(vp.width + 1);
        expect.soft(r.overX, `${id} words wider than it`).toBeLessThanOrEqual(1);
        expect.soft(r.overY, `${id} words taller than it`).toBeLessThanOrEqual(1);
      }
      const fits = (await page.getByTestId('spot-fits').boundingBox())!;
      const not = (await page.getByTestId('spot-not').boundingBox())!;
      expect.soft(fits.y + fits.height, '"It fits" above "Not there"').toBeLessThanOrEqual(not.y + 1);
      await page.screenshot({ path: test.info().outputPath(`card-53-${vp.width}.png`) });
    });
  });
}

test('root 53 px: Help’s pictures keep their own text sizes and the step numbers fit their circles', async ({ page }) => {
  await gotoScreen(page, 'help');
  await page.addStyleTag({ content: 'html { font-size: 53px !important; }' });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('53px');
  const r = await page.evaluate(() => ({
    art: [...document.querySelectorAll('.how-art text')].map((t) => getComputedStyle(t).fontSize),
    nums: [...document.querySelectorAll<HTMLElement>('.how-n')].map((n) => {
      const b = n.getBoundingClientRect();
      const t = document.createRange();
      t.selectNodeContents(n);
      const tb = t.getBoundingClientRect();
      return {
        inside: tb.left >= b.left - 1 && tb.right <= b.right + 1 && tb.top >= b.top - 1 && tb.bottom <= b.bottom + 1,
        round: Math.abs(b.width - b.height) <= 1,
      };
    }),
  }));
  expect(r.art.length).toBeGreaterThan(0);
  for (const fs of r.art) expect(['12px', '13px', '17px']).toContain(fs);
  expect(r.nums.length).toBe(4);
  for (const n of r.nums) expect(n).toEqual({ inside: true, round: true });
});
