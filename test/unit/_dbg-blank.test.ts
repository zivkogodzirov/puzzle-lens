import { it } from 'vitest';
import { scanMarkerless } from '../../src/cv/scanMarkerless';
import { readShape } from '../../src/cv/shapeRead';
import { getCv } from '../helpers/cv';
import { renderScene, segmentationScore, type SynthScene } from '../synth/index';
import { sceneOptions, val48 } from '../synth/sets';
import { writeFileSync } from 'node:fs';
const buf = (s: SynthScene) => ({ data: s.rgba, width: s.width, height: s.height, stride: s.stride });
it('blank', async () => {
  const cv = await getCv();
  const item = val48.items.find((i) => i.kind === 'overview' && i.name.includes('-b0-'))!;
  const opts = sceneOptions(item);
  const s = await renderScene({ ...opts, markers: [] });
  const r = scanMarkerless(cv, buf(s), { catalog: [], zoom: 1, kind: 'overview', table: null, pieceAreaShare: 1 });
  const sc = segmentationScore(r.pieces, s.truth);
  const { createCanvas } = await import('@napi-rs/canvas');
  let made = 0;
  for (const m of sc.matches) {
    const f = r.pieces[m.foundIndex]!;
    const tp = opts.puzzle.pieces.find((p) => p.id === m.id)!;
    const rd = readShape(f.outlineMm, opts.puzzle.cellMm);
    if (!rd || !rd.sides.some((x) => x.kind === 'unsure') || f.flags.clump || f.flags.cut) continue;
    const t = s.truth.pieces.find((p) => p.id === m.id)!;
    const [x, y, w, h] = f.bboxImg;
    const pad = 20, K = 6;
    const W = Math.round(w + 2 * pad), H = Math.round(h + 2 * pad);
    const x0 = Math.round(x - pad), y0 = Math.round(y - pad);
    const c = createCanvas(W * K, H * K); const ctx = c.getContext('2d');
    const id = ctx.createImageData(W * K, H * K);
    for (let yy = 0; yy < H * K; yy++) for (let xx = 0; xx < W * K; xx++) {
      const sx = Math.min(s.width - 1, Math.max(0, x0 + Math.floor(xx / K))), sy = Math.min(s.height - 1, Math.max(0, y0 + Math.floor(yy / K)));
      const si = sy * s.stride + sx * 4, di = (yy * W * K + xx) * 4;
      id.data[di] = s.rgba[si]!; id.data[di + 1] = s.rgba[si + 1]!; id.data[di + 2] = s.rgba[si + 2]!; id.data[di + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    const draw = (o: number[], col: string) => { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); for (let i = 0; i < o.length; i += 2) ctx.lineTo((o[i]! - x0 + 0.5) * K, (o[i + 1]! - y0 + 0.5) * K); ctx.closePath(); ctx.stroke(); };
    draw(t.outlineImg, '#00ff00');
    draw(f.outlineImg, '#ff00ff');
    writeFileSync(`/private/tmp/claude-501/-Users-zivkogodzirov-Downloads-puzzle-solver-ios/05876976-61fb-4285-9668-5e483433ae5e/scratchpad/blank${made}.png`, c.encodeSync('png'));
    console.log('made', made, tp.sides, rd.sides.map((q) => q.kind), 'ppm', r.pxPerMm);
    if (++made >= 3) break;
  }
}, 300000);
