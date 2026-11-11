/**
 * M9 part 3, the outline language (design plan §3.2, decisions 9 and 10, accessibility rules 3 and 10) in
 * WebKit:
 * - "Show my table" (seeded: 30 pieces close together on one photo, every spot known, three flagged):
 *   dashed outlines carry a badge saying why, the column·row pills never overlap (the rest get a dot), the
 *   "?" legend sheet, the one-time "17·9" tip;
 * - the live view (a scanned synthetic table, every spot known): badges on the flagged pieces, a square of
 *   4 drawn as one quad with one label, labels without overlaps, "It fits" / "Not there", and the "Pieces in
 *   view" list selecting a piece as a tap on the picture would; 44 px targets.
 */
import { createCanvas } from '@napi-rs/canvas';
import { generatePuzzle, renderScene } from '../synth/index';
import type { SceneOptions } from '../synth/types';
import { test, expect, gotoScreen } from './fixtures';
import type { Page } from '@playwright/test';

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (r: Box[]) => {
  let n = 0;
  for (let i = 0; i < r.length; i++)
    for (let j = i + 1; j < r.length; j++) {
      const a = r[i]!;
      const b = r[j]!;
      if (a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5) n++;
    }
  return n;
};

async function expectTarget(page: Page, testId: string) {
  const b = (await page.getByTestId(testId).first().boundingBox())!;
  expect(Math.min(b.width, b.height), `${testId}: at least 44 px`).toBeGreaterThanOrEqual(44);
}

/** Every spot known (pieces in order across a cols-wide grid), with a box picture to place them on. */
async function seedPlacements(page: Page, pid: string, cols: number, rows: number) {
  await page.evaluate(
    async ([pid, cols, rows]) => {
      const req = indexedDB.open('puzzle-lens');
      const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      const c = Object.assign(document.createElement('canvas'), { width: 80, height: 60 });
      const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/jpeg'));
      const pieces = await new Promise<Array<{ id: string; patch?: { ts: number } | null }>>((res) => {
        const r = dbh.transaction('pieces').objectStore('pieces').getAll();
        r.onsuccess = () => res((r.result as Array<{ id: string; projectId: string; patch?: { ts: number } | null }>).filter((q) => q.projectId === pid));
      });
      const project = await new Promise<Record<string, unknown>>((res) => {
        const r = dbh.transaction('projects').objectStore('projects').get(pid);
        r.onsuccess = () => res(r.result as Record<string, unknown>);
      });
      const byPiece: Record<string, unknown> = {};
      pieces.forEach((q, i) => {
        if (i >= cols * rows) return;
        byPiece[q.id] = {
          ts: q.patch?.ts ?? 0,
          placement: { top: [{ col: i % cols, row: Math.floor(i / cols), rot: 0, score: 1, p: 0.95 }], verdict: 'strong' },
        };
      });
      const corners = '0,0;80,0;80,60;0,60';
      await new Promise<void>((res) => {
        const tx = dbh.transaction(['projects', 'blobs', 'settings'], 'readwrite');
        tx.objectStore('blobs').put({ id: `${pid}:box`, ts: 1, kind: 'box', blob });
        tx.objectStore('projects').put({
          ...project,
          updatedAt: Date.now(),
          box: {
            photoBlobId: `${pid}:box`,
            rectifiedBlobId: `${pid}:box`,
            corners: [
              [0, 0],
              [80, 0],
              [80, 60],
              [0, 60],
            ],
            photoWidth: 80,
            photoHeight: 60,
            width: 80,
            height: 60,
          },
        });
        tx.objectStore('settings').put({
          key: `placement:${pid}`,
          value: { boxKey: `${pid}:box|${corners}|${cols}x${rows}`, colour: null, open: null, byPiece },
        });
        tx.oncomplete = () => res();
      });
      dbh.close();
    },
    [pid, cols, rows] as const,
  );
}

/** The flags of some pieces (faint, touching). */
async function flagPieces(page: Page, pid: string, flags: Array<Record<string, boolean>>) {
  await page.evaluate(
    async ([pid, flags]) => {
      const req = indexedDB.open('puzzle-lens');
      const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      const pieces = await new Promise<Array<Record<string, unknown> & { id: string; projectId: string }>>((res) => {
        const r = dbh.transaction('pieces').objectStore('pieces').getAll();
        r.onsuccess = () => res((r.result as Array<Record<string, unknown> & { id: string; projectId: string }>).filter((q) => q.projectId === pid));
      });
      pieces.sort((a, b) => a.id.localeCompare(b.id));
      await new Promise<void>((res) => {
        const tx = dbh.transaction('pieces', 'readwrite');
        flags.forEach((f, i) => tx.objectStore('pieces').put({ ...pieces[i]!, flags: f }));
        tx.oncomplete = () => res();
      });
      dbh.close();
    },
    [pid, flags] as const,
  );
}

/** The overview photo: 600 × 400 px of a 300 × 200 mm table, a grey square per piece. */
function photo(pieces: Array<{ x: number; y: number }>): string {
  const c = createCanvas(600, 400);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ede6d8';
  ctx.fillRect(0, 0, 600, 400);
  ctx.fillStyle = '#6b6b6b';
  for (const p of pieces) ctx.fillRect((p.x - 9) * 2, (p.y - 9) * 2, 36, 36);
  return c.encodeSync('jpeg', 90).toString('base64');
}

test.describe('Show my table', () => {
  test.use({ persistentStorage: true });
  test.setTimeout(120_000);

  test('dashed outlines carry a badge; labels never overlap; the legend sheet; the tip shows once', async ({ page }) => {
    // 30 pieces 21 mm apart: on the phone each label is wider than the gap, so they crowd.
    const pieces = Array.from({ length: 30 }, (_, i) => ({ id: `p${String(i).padStart(2, '0')}`, x: 40 + (i % 6) * 21, y: 40 + Math.floor(i / 6) * 21 }));
    await gotoScreen(page, '');
    await page.evaluate(
      async ([ps, jpg]) => {
        const bytes = (b64: string) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
        const req = indexedDB.open('puzzle-lens');
        const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
        await new Promise<void>((res) => {
          const tx = dbh.transaction(['projects', 'pieces', 'blobs', 'snaps'], 'readwrite');
          tx.objectStore('blobs').put({ id: 'e2e-ov:scan-s1', ts: 1, kind: 'scan', blob: new Blob([bytes(jpg)], { type: 'image/jpeg' }) });
          tx.objectStore('snaps').put({
            id: 'ov-s1',
            projectId: 'e2e-ov',
            kind: 'overview',
            ts: 5,
            width: 600,
            height: 400,
            zoom: 1,
            imgToTable: [0.5, 0, 0, 0, 0.5, 0, 0, 0, 1],
            quality: null,
            blobId: 'e2e-ov:scan-s1',
            pieceIds: ps.map((p) => p.id),
          });
          tx.objectStore('projects').put({
            id: 'e2e-ov',
            name: 'Outlines',
            createdAt: 1,
            updatedAt: 2,
            pieceCount: 30,
            grid: { cols: 6, rows: 5, source: 'suggested' },
            box: null,
            markerMap: null,
            tableModel: null,
            piecePitch: { wMm: 18, hMm: 18, n: 30 },
            setupStep: 6,
            tracking: 'pieces',
            scaleSource: 'coin',
          });
          ps.forEach((p) =>
            tx.objectStore('pieces').put({
              id: p.id,
              projectId: 'e2e-ov',
              createdAt: 1,
              updatedAt: 1,
              status: 'table',
              table: { x: p.x, y: p.y, angleDeg: 0, lastSeen: 1, snapId: 'ov-s1' },
              outlineMm: [-9, -9, 9, -9, 9, 9, -9, 9],
              areaMm2: 324,
              sizeMm: [18, 18],
              colour: { meanLab: [50, 0, 0], hueHist: [0, 0, 0, 0, 0, 0, 0, 0] },
              thumbBlobId: null,
              seen: 1,
              bestPxPerMm: 5,
              flags: {},
              patch: null,
            }),
          );
          tx.oncomplete = () => res();
        });
        dbh.close();
      },
      [pieces, photo(pieces)] as const,
    );
    await seedPlacements(page, 'e2e-ov', 6, 5);
    // Faint, touching, and a part outline (faint too).
    await flagPieces(page, 'e2e-ov', [{ weak: true }, { clump: true }, { weak: true, part: true }]);
    await page.evaluate(() => (location.hash = '#/puzzle/e2e-ov'));
    await page.getByTestId('table-toggle').click();
    const svg = page.getByTestId('table-photo-svg');
    await expect(svg.locator('.lit-outline')).toHaveCount(30);

    // One pattern, one meaning: exactly the three flagged outlines are dashed, each with its badge.
    const dashed = svg.locator('.lit-outline[stroke-dasharray]');
    await expect(dashed).toHaveCount(3);
    expect(await dashed.evaluateAll((els) => els.map((e) => e.getAttribute('data-mark')).sort())).toEqual(['faint', 'faint', 'touching']);
    const badges = svg.getByTestId('ov-badge');
    await expect(badges).toHaveCount(3);
    expect(await badges.evaluateAll((els) => els.map((e) => e.getAttribute('data-mark')).sort())).toEqual(['faint', 'faint', 'touching']);
    // The touching badge is the split glyph, the faint one a "?".
    await expect(svg.locator('[data-mark="touching"] path')).toHaveCount(1);
    await expect(svg.locator('[data-mark="faint"] text').first()).toHaveText('?');

    // Labels: column·row pills that never overlap each other nor a badge; the crowd's rest get a dot.
    const pills = svg.locator('.ov-label rect');
    const nPills = await pills.count();
    expect(nPills).toBeGreaterThan(3);
    // Every spot here is sure: no dots (a dot means an unsure spot).
    await expect(svg.getByTestId('photo-dot')).toHaveCount(0);
    const boxes = [...(await pills.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as Box)))];
    const badgeBoxes = await badges.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as Box));
    expect(overlaps(boxes)).toBe(0);
    expect(overlaps([...boxes, ...badgeBoxes]) - overlaps(badgeBoxes)).toBe(0);
    // 15 px semibold on screen.
    const text = svg.getByTestId('photo-label').first();
    expect(await text.evaluate((el) => Math.round((el as SVGTextElement).getBoundingClientRect().height))).toBeGreaterThanOrEqual(14);
    await expect(text).toHaveText(/^\d+·\d+$/);

    // The one-time tip: "17·9" means column 17, row 9.
    const tip = page.getByTestId('overlay-tip');
    await expect(tip).toBeVisible();
    await expect(tip).toContainText('means column 17, row 9');
    await expectTarget(page, 'overlay-tip-ok');
    await page.getByTestId('overlay-tip-ok').click();
    await expect(tip).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('table-photo-outlines.png') });

    // The legend behind "?" (44 px), in a sheet.
    await expectTarget(page, 'overlay-legend-open');
    await expect(page.getByTestId('overlay-legend-open')).toHaveAccessibleName('What the outlines mean');
    await page.getByTestId('overlay-legend-open').click();
    const legend = page.getByTestId('overlay-legend');
    await expect(legend).toBeVisible();
    await expect(legend).toHaveAttribute('role', 'dialog');
    for (const words of [
      'Solid line: fine',
      'faint outline',
      'touching pieces',
      'moved?',
      'not a piece',
      'column 17, row 9',
      'its spot isn’t sure yet',
      '17–18 · 7–8',
    ])
      await expect(legend).toContainText(words);
    await page.screenshot({ path: test.info().outputPath('legend.png') });
    await page.getByTestId('overlay-legend-close').click();
    await expect(legend).toHaveCount(0);

    // Shown once: not again on this photo, nor after a reload.
    await page.getByTestId('table-photo-close').click();
    await page.getByTestId('table-toggle').click();
    await expect(svg.locator('.ov-label')).not.toHaveCount(0);
    await expect(tip).toHaveCount(0);
    await page.reload();
    await page.getByTestId('table-toggle').click();
    await expect(svg.locator('.ov-label')).not.toHaveCount(0);
    await page.waitForTimeout(500);
    await expect(tip).toHaveCount(0);
  });
});

const W = 4032;
const H = 3024;
let overview = '';
let closer = '';
let visible = 0;

test.describe('the live view', () => {
  test.beforeAll(async () => {
    const puzzle = generatePuzzle({ cols: 8, rows: 6, cellMm: [17.8, 19.4], seed: 12 });
    const base: SceneOptions = {
      puzzle,
      seed: 44,
      markers: [],
      layout: { areaMm: [600, 450], originMm: [100, 80] },
      camera: { x: 400, y: 305, heightMm: 680, tiltDeg: 1, imageSize: [W, H] },
      light: { dirDeg: 200 },
    };
    const o = await renderScene(base);
    overview = `data:image/jpeg;base64,${o.jpeg.toString('base64')}`;
    visible = o.truth.pieces.filter((p) => !p.faceDown && p.visibleShare > 0.99).length;
    // The live view from lower down: pieces big enough for their labels, close together.
    const c = await renderScene({ ...base, camera: { ...base.camera, heightMm: 260, x: 390, y: 300 } });
    closer = `data:image/jpeg;base64,${c.jpeg.toString('base64')}`;
  });
  test.use({ fakeCameraOptions: { width: W, height: H, fps: 8 }, persistentStorage: true });
  test.setTimeout(420_000);

  test('badges, a square of 4 as one quad, labels apart, the pieces-in-view list', async ({ page }) => {
    await page.addInitScript((url) => {
      (window as unknown as { __fakeScene?: string }).__fakeScene = url;
    }, overview);
    await gotoScreen(page, '');
    const id = 'e2e-ov-live';
    await page.evaluate(async (pid) => {
      const req = indexedDB.open('puzzle-lens');
      const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      await new Promise<void>((res) => {
        const tx = dbh.transaction('projects', 'readwrite');
        tx.objectStore('projects').put({
          id: pid,
          name: 'Live outlines',
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
    }, id);
    await page.evaluate((pid) => (location.hash = `#/puzzle/${pid}`), id);
    await page.getByTestId('scan-pieces').click();
    await page.getByTestId('allow-tilt').click();
    await page.evaluate(() => setInterval(() => dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: 0, beta: 1, gamma: -1 })), 50));
    await expect(page.getByTestId('scan-note')).toContainText('Found', { timeout: 150_000 });
    const n = Number((await page.getByTestId('scan-count').innerText()).match(/\d+/)![0]);
    expect(n).toBeGreaterThanOrEqual(Math.floor(0.85 * visible));

    await seedPlacements(page, id, 8, 6);
    // Every 6th piece faint, every 6th (others) touching: some of them are in view.
    await flagPieces(
      page,
      id,
      Array.from({ length: n }, (_, i): Record<string, boolean> => (i % 6 === 1 ? { weak: true } : i % 6 === 4 ? { clump: true } : {})),
    );
    await page.reload();
    await page.evaluate((url) => ((window as unknown as { __fakeScene?: string }).__fakeScene = url), closer);
    await page.evaluate((pid) => (location.hash = `#/puzzle/${pid}`), id);
    await page.evaluate(() => ((window as unknown as { __liveDebug: boolean }).__liveDebug = true));
    await page.getByTestId('live-toggle').click();
    await expect(page.getByTestId('live-status')).toHaveAttribute('data-kind', 'good', { timeout: 60_000 });
    const overlay = page.getByTestId('live-table-overlay');
    await expect.poll(async () => Number(await overlay.getAttribute('data-drawn')), { timeout: 20_000 }).toBeGreaterThanOrEqual(6);

    type Dbg = {
      labels: Array<{ x: number; y: number; w: number; h: number; key: string; text: string }>;
      badges: Array<{ id: string; mark: string; x: number; y: number }>;
      quads: Array<{ ids: string[]; label: string }>;
      size: [number, number];
    };
    const dbg = () => page.evaluate(() => (window as unknown as { __liveOverlay: unknown }).__liveOverlay as Dbg);
    // Dashed with a badge: the two pieces flagged here (and any the scan flagged itself), one badge each.
    await expect.poll(async () => (await dbg()).badges.map((b) => b.mark), { timeout: 10_000 }).toEqual(expect.arrayContaining(['faint', 'touching']));
    const flagged = await page.evaluate(async (pid) => {
      const req = indexedDB.open('puzzle-lens');
      const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      const all = await new Promise<Array<{ id: string; projectId: string; flags: Record<string, boolean> }>>((res) => {
        const r = dbh.transaction('pieces').objectStore('pieces').getAll();
        r.onsuccess = () => res(r.result as Array<{ id: string; projectId: string; flags: Record<string, boolean> }>);
      });
      dbh.close();
      return all.filter((p) => p.projectId === pid && (p.flags.weak || p.flags.clump || p.flags.part)).map((p) => p.id);
    }, id);
    {
      const d0 = await dbg();
      const onScreen = flagged.filter((f) => f in (d0 as unknown as { centres: Record<string, unknown> }).centres);
      // A badge only on a flagged piece; every flagged piece on screen dashed (a badge that would cover another is left out).
      for (const b of d0.badges) expect(onScreen).toContain(b.id);
      expect((d0 as unknown as { dashed: number }).dashed).toBe(onScreen.length);
    }
    // Labels on screen, never over each other: count overlaps in this crowded scene (every spot known).
    await page.waitForTimeout(1000);
    await page.screenshot({ path: test.info().outputPath('live-outlines.png') });
    await expect.poll(async () => (await dbg()).labels.length, { timeout: 10_000 }).toBeGreaterThan(5);
    const d = await dbg();
    expect(overlaps(d.labels.map((l) => ({ x: l.x, y: l.y, width: l.w, height: l.h })))).toBe(0);
    for (const l of d.labels) {
      expect(l.x).toBeGreaterThanOrEqual(0);
      expect(l.x + l.w).toBeLessThanOrEqual(d.size[0] + 0.5);
    }
    await page.screenshot({ path: test.info().outputPath('live-outlines.png') });

    // "?" on the camera chrome opens the legend.
    await expectTarget(page, 'overlay-legend-open');
    await page.getByTestId('overlay-legend-open').click();
    await expect(page.getByTestId('overlay-legend')).toBeVisible();
    await page.getByTestId('overlay-legend-close').click();
    await expect(page.getByTestId('overlay-legend')).toHaveCount(0);

    // "Pieces in view": a list of the outlined pieces as buttons; one selects it as a tap on the picture would.
    await expectTarget(page, 'live-pieces-open');
    await expect(page.getByTestId('live-pieces-open')).toContainText('Pieces in view');
    await page.getByTestId('live-pieces-open').click();
    const sheet = page.getByTestId('live-pieces');
    await expect(sheet).toBeVisible();
    const items = sheet.getByTestId('live-piece-item');
    // The pieces outlined when it opened (the count can move by one as pieces reach the screen's edge).
    expect(Math.abs((await items.count()) - Number(await overlay.getAttribute('data-drawn')))).toBeLessThanOrEqual(2);
    await expect(sheet).toContainText('check outline');
    await expect(sheet).toContainText('touching another piece');
    await expect(items.filter({ hasText: /column \d+ row \d+/ }).first()).toBeVisible();
    await expectTarget(page, 'live-piece-item');
    await page.screenshot({ path: test.info().outputPath('live-pieces-list.png') });
    // A piece in the upper middle of the picture (clear of the buttons, and of the piece box that opens below).
    const centres = (await dbg()) as unknown as { centres: Record<string, [number, number]> };
    const ids = await items.evaluateAll((els) => els.filter((e) => /column \d+ row \d+/.test(e.textContent ?? '')).map((e) => e.getAttribute('data-id')!));
    const pid = ids.filter((i) => centres.centres[i]).sort((a, b) => Math.abs(centres.centres[a]![1] - 330) - Math.abs(centres.centres[b]![1] - 330))[0]!;
    const pick = sheet.locator(`[data-id="${pid}"]`);
    const spot = (await pick.innerText()).match(/column (\d+) row (\d+)/)!;
    await pick.click();
    await expect(sheet).toHaveCount(0);
    const info = page.getByTestId('live-info');
    await expect(info).toBeVisible();
    await expect(info).toContainText(`${spot[1]}·${spot[2]}`);
    // The tapped piece's label shows (it comes first).
    await page.screenshot({ path: test.info().outputPath('live-picked.png') });
    await expect.poll(async () => (await dbg()).labels.some((l) => l.text === `${spot[1]}·${spot[2]}`)).toBe(true);

    // The answer words (decision 7), the testids kept.
    await expect(page.getByTestId('live-fits')).toHaveText('It fits');
    await expect(page.getByTestId('live-not')).toHaveText('Not there');
    await page.getByTestId('live-not').click();
    await expect(page.getByTestId('live-note')).toContainText('Noted');
    await expect(page.getByTestId('live-undo')).toBeVisible();
    // Undo it, so the square of 4 below doesn't depend on which piece was answered (it was flaky: a "Not there"
    // on one of its pieces could leave a pair first in "What next").
    await page.getByTestId('live-undo').click();
    await expect(page.getByTestId('live-note')).toContainText('Undone');

    // A square of 4 ("What next" → Point them out): its four confirmed lines drawn as one translucent quad with
    // one label instead of four, its pieces without labels of their own.
    await page.getByTestId('live-table-close').click();
    await page.getByTestId('matches-toggle').click();
    // The square of 4 may be first ("What next") or further down the list, depending on how the synthetic table
    // was read: take the first card that is a square.
    const next = page.locator('[data-testid="match-next"], [data-testid="match-block"]').filter({ hasText: 'A square of 4' }).first();
    await expect(next).toBeVisible({ timeout: 20_000 });
    await next.getByTestId('match-find').click();
    await expect(page.getByTestId('live-table')).toBeVisible();
    await expect(page.getByTestId('live-status')).toHaveAttribute('data-kind', 'good', { timeout: 60_000 });
    await expect.poll(async () => Number(await overlay.getAttribute('data-quads')), { timeout: 20_000 }).toBe(1);
    const dq = await dbg();
    const q = dq.quads[0]!;
    expect(q.ids).toHaveLength(4);
    // "17–18 · 7–8" when the pieces' spots are labelled; this view (Find the 4 pieces) has no spot labels: ✓.
    expect(q.label).toMatch(/^(\d+–\d+ · \d+–\d+|✓)$/);
    const ql = dq.labels.filter((l) => l.key.startsWith('square:'));
    expect(ql).toHaveLength(1);
    for (const pid of q.ids) expect(dq.labels.some((l) => l.key === pid)).toBe(false);
    // No ✓ marks on the square's own lines: the one label stands for them.
    expect(dq.labels.filter((l) => l.key.startsWith('line:'))).toHaveLength(0);
    await page.screenshot({ path: test.info().outputPath('live-square.png') });
  });
});
