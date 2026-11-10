/**
 * M5 part 4 in WebKit: how far the live outlines trail a moving camera, with and without the
 * prediction (src/app/livePredict.ts). A simulated table is scanned, then the simulated camera pans
 * and turns steadily over it; each drawn outline centre is compared with where its piece is in the
 * newest camera frame (screen px). Measured 2026-11-09: median 0.9 px without, 0.1 px with.
 */
import { generatePuzzle, renderScene } from '../synth/index';
import type { SceneOptions } from '../synth/types';
import { test, expect, gotoScreen } from './fixtures';

const W = 1920;
const H = 1440;
let scene = '';
test.beforeAll(async () => {
  const puzzle = generatePuzzle({ cols: 8, rows: 6, cellMm: [17.8, 19.4], seed: 12 });
  const base: SceneOptions = {
    puzzle,
    seed: 44,
    markers: [],
    layout: { areaMm: [420, 300], originMm: [190, 155] },
    camera: { x: 400, y: 305, heightMm: 560, tiltDeg: 1, imageSize: [W, H] },
    light: { dirDeg: 200 },
  };
  scene = `data:image/jpeg;base64,${(await renderScene(base)).jpeg.toString('base64')}`;
});
test.use({ fakeCameraOptions: { width: W, height: H, fps: 30 }, persistentStorage: true });
test.setTimeout(300_000);

test('the live outlines follow a panning camera; the prediction removes most of the lag', async ({ page }) => {
  await page.addInitScript((u) => ((window as unknown as { __fakeScene?: string }).__fakeScene = u), scene);
  await gotoScreen(page, '');
  const id = 'e2e-motion';
  await page.evaluate(async (pid) => {
    const req = indexedDB.open('puzzle-lens');
    const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
    await new Promise<void>((res) => {
      const tx = dbh.transaction('projects', 'readwrite');
      tx.objectStore('projects').put({
        id: pid,
        name: 'Motion',
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
  await expect(page.getByTestId('snap')).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId('snap').click();
  await expect(page.getByTestId('scan-note')).toContainText('Found', { timeout: 120_000 });
  await page.evaluate((pid) => (location.hash = `#/puzzle/${pid}`), id);
  await page.getByTestId('live-toggle').click();
  await expect(page.getByTestId('live-status')).toHaveAttribute('data-kind', 'good', { timeout: 60_000 });

  // Each piece's place in the scene picture (canvas px at the scan): its table mm through the scan photo's mapping.
  const pieces = await page.evaluate(async (pid) => {
    const req = indexedDB.open('puzzle-lens');
    const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
    const all = <T>(store: string) =>
      new Promise<T[]>((res) => {
        const r = dbh.transaction(store).objectStore(store).getAll();
        r.onsuccess = () => res(r.result as T[]);
      });
    const snaps = (await all<{ projectId: string; kind: string; imgToTable: number[] }>('snaps')).filter((s) => s.projectId === pid && s.kind === 'overview');
    const ps = (await all<{ id: string; projectId: string; table: { x: number; y: number } }>('pieces')).filter((p) => p.projectId === pid);
    dbh.close();
    return { H: snaps[0]!.imgToTable, ps: ps.map((p) => ({ id: p.id, x: p.table.x, y: p.table.y })) };
  }, id);

  const run = async (predict: boolean) => {
    return page.evaluate(
      async ({ predict, pieces, W, H }) => {
        const w = window as unknown as Record<string, unknown>;
        w.__liveDebug = true;
        w.__livePredict = predict;
        const inv = (m: number[]) => {
          const [a, b, c, d, e, f, g, h, i] = m as [number, number, number, number, number, number, number, number, number];
          const A = e * i - f * h,
            B = -(d * i - f * g),
            C = d * h - e * g;
          const det = a * A + b * B + c * C;
          return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
        };
        const ap = (m: number[], x: number, y: number) => {
          const z = m[6]! * x + m[7]! * y + m[8]!;
          return [(m[0]! * x + m[1]! * y + m[2]!) / z, (m[3]! * x + m[4]! * y + m[5]!) / z];
        };
        const tableToImg = inv(pieces.H);
        const scenePx = new Map(pieces.ps.map((p) => [p.id, ap(tableToImg, p.x, p.y)]));
        const cam = w.__fakeCamera as { sceneMatrix: (t: number) => number[] };
        const video = document.querySelector('[data-testid="live-table"] video') as HTMLVideoElement;
        const still: number[] = [];
        {
          const o = w.__liveOverlay as { t: number; centres: Record<string, [number, number]> } | undefined;
          if (o) {
            const el = video.getBoundingClientRect();
            const s = Math.min(el.width / W, el.height / H);
            const ox = (el.width - W * s) / 2;
            const oy = (el.height - H * s) / 2;
            for (const [pid, c] of Object.entries(o.centres)) {
              const sp = scenePx.get(pid);
              if (sp) still.push(Math.hypot(ox + sp[0]! * s - c[0], oy + sp[1]! * s - c[1]));
            }
            (w as Record<string, unknown>).__dbgStill = {
              still: still.slice(0, 5),
              el: [el.width, el.height],
              vid: [video.videoWidth, video.videoHeight],
              first: Object.entries(o.centres)[0],
              sp: scenePx.get(Object.keys(o.centres)[0]!),
            };
          }
        }
        w.__fakeSceneMotion = { vx: 140, vy: 50, rot: 0.12, since: performance.now() };
        const errs: number[] = [];
        const errsLate: number[] = [];
        const errsStart: number[] = [];
        const ts = new Set<number>();
        const statuses: string[] = [];
        await new Promise((r) => setTimeout(r, 600));
        for (let k = 0; k < 25; k++) {
          await new Promise((r) => setTimeout(r, 90));
          const o = w.__liveOverlay as { t: number; centres: Record<string, [number, number]> } | undefined;
          statuses.push(document.querySelector('[data-testid="live-status"]')?.textContent ?? '?');
          if (!o) continue;
          if (performance.now() - o.t > 100) continue;
          ts.add(o.t);
          const el = video.getBoundingClientRect();
          const s = Math.min(el.width / W, el.height / H);
          const ox = (el.width - W * s) / 2;
          const oy = (el.height - H * s) / 2;
          for (const [pid, c] of Object.entries(o.centres)) {
            const sp = scenePx.get(pid);
            if (!sp) continue;
            for (const [lag, list] of [
              [0, errs],
              [50, errsLate],
              [-1, errsStart],
            ] as const) {
              const m = cam.sceneMatrix(lag < 0 ? 0 : o.t - lag);
              const fx = m[0]! * sp[0]! + m[2]! * sp[1]! + m[4]!;
              const fy = m[1]! * sp[0]! + m[3]! * sp[1]! + m[5]!;
              list.push(Math.hypot(ox + fx * s - c[0], oy + fy * s - c[1]));
            }
          }
        }
        w.__fakeSceneMotion = undefined;
        const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? NaN;
        const p90 = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length * 0.9)] ?? NaN;
        const el = video.getBoundingClientRect();
        return {
          start: med(errsStart),
          fresh: ts.size,
          statuses: [...new Set(statuses)].slice(0, 4).join(' | '),
          n: errs.length,
          med: med(errs),
          p90: p90(errs),
          medLate: med(errsLate),
          p90Late: p90(errsLate),
          scale: Math.min(el.width / W, el.height / H),
        };
      },
      { predict, pieces, W, H },
    );
  };
  // Settle between runs: the scene returns to rest.
  await page.evaluate(() => ((window as unknown as { __liveDebug: boolean }).__liveDebug = true));
  await page.waitForTimeout(500);
  const off = await run(false);
  await page.waitForTimeout(1500);
  const on = await run(true);
  console.log(
    `fresh samples off ${off.fresh} on ${on.fresh}; statuses: ${on.statuses}; error vs the scene at rest: ${off.start.toFixed(1)} / ${on.start.toFixed(1)}`,
  );
  console.log(
    `no prediction: n ${off.n}, error vs the newest frame median ${off.med.toFixed(1)} px (p90 ${off.p90.toFixed(1)}), vs a frame 50 ms older ${off.medLate.toFixed(1)} px`,
  );
  console.log(
    `prediction:    n ${on.n}, error vs the newest frame median ${on.med.toFixed(1)} px (p90 ${on.p90.toFixed(1)}), vs a frame 50 ms older ${on.medLate.toFixed(1)} px`,
  );
  console.log(`(screen px; the frame is shown at ${on.scale.toFixed(3)} screen px per frame px)`);
  expect(on.fresh).toBeGreaterThanOrEqual(15);
  expect(on.start).toBeGreaterThan(20); // the outlines did move with the camera
  expect(on.med).toBeLessThan(off.med);
  expect(on.med).toBeLessThan(1);
  expect(on.p90).toBeLessThan(3);
});

test('battery (M8 part 3): held still, the live view analyses fewer frames; moving, all of them again', async ({ page }) => {
  await page.addInitScript((u) => ((window as unknown as { __fakeScene?: string }).__fakeScene = u), scene);
  await gotoScreen(page, '');
  const id = 'e2e-idle';
  await page.evaluate(async (pid) => {
    const req = indexedDB.open('puzzle-lens');
    const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
    await new Promise<void>((res) => {
      const tx = dbh.transaction('projects', 'readwrite');
      tx.objectStore('projects').put({
        id: pid,
        name: 'Idle',
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
  await expect(page.getByTestId('snap')).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId('snap').click();
  await expect(page.getByTestId('scan-note')).toContainText('Found', { timeout: 120_000 });
  await page.evaluate((pid) => (location.hash = `#/puzzle/${pid}`), id);
  await page.getByTestId('live-toggle').click();
  await expect(page.getByTestId('live-status')).toHaveAttribute('data-kind', 'good', { timeout: 60_000 });
  const rate = async () => Number(((await page.getByTestId('live-status').innerText()).match(/(\d+)\/s/) ?? [])[1] ?? NaN);
  await page.evaluate(() => ((window as unknown as Record<string, unknown>).__liveDebug = true));
  // Held still: after a second, about 8 frames a second (the rate shown is over the last 2 s).
  await page.waitForTimeout(4000);
  const still = await rate();
  // Moving: back to every frame the tracker can manage.
  await page.evaluate(() => ((window as unknown as Record<string, unknown>).__fakeSceneMotion = { vx: 140, vy: 50, rot: 0.12, since: performance.now() }));
  await page.waitForTimeout(2500);
  const moving = await rate();
  await page.evaluate(() => ((window as unknown as Record<string, unknown>).__fakeSceneMotion = undefined));
  console.log(`live view: ${still}/s held still, ${moving}/s moving`);
  expect(still).toBeLessThanOrEqual(9);
  expect(moving).toBeGreaterThan(still + 3);
});
