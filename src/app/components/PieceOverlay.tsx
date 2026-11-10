import { useEffect, useRef } from 'preact/hooks';
import { latestFrame, latestFrameAt } from '../../camera/framePump';
import { frameToElement } from '../../camera/coords';
import { applyH } from '../../geo/homography';
import type { PieceRow } from '../../project/types';
import { strokeHalo } from '../overlay';

/**
 * Outlines of catalogued pieces drawn over the live video (PLAN §5 "Overlay state colours"):
 * grey = detected; orange dashed = probably touching pieces ("spread these apart"); yellow = pale
 * piece with a weak outline (check it). Outlines are stored in table mm, so they stay on their
 * pieces while the phone moves (each frame's own table position maps them into the picture).
 * Each outline sits on a dark halo, so it shows on a cream table too (M9 part 1).
 */
export function PieceOverlay({ video, pieces }: { video: HTMLVideoElement | null; pieces: PieceRow[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const list = useRef(pieces);
  list.current = pieces;

  useEffect(() => {
    let raf = 0;
    let drawn: unknown = null;
    let drawnList: unknown = null;
    let drawnStale = false;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas || !video || !video.videoWidth) return;
      // Redraw only for a new tracker result, new pieces, or to clear stale outlines (battery).
      const stale = performance.now() - latestFrameAt > 500;
      if (latestFrame.value === drawn && list.current === drawnList && stale === drawnStale) return;
      drawn = latestFrame.value;
      drawnList = list.current;
      drawnStale = stale;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const f = latestFrame.value;
      if (!f || !f.table || performance.now() - latestFrameAt > 500) return;
      const H = f.table.tableToImg;
      const frame = { width: f.width, height: f.height };
      const vid = { width: video.videoWidth, height: video.videoHeight };
      const el = { width: w, height: h };
      for (const p of list.current) {
        if (p.status !== 'table') continue;
        const o = p.outlineMm;
        if (o.length < 6) continue;
        ctx.beginPath();
        // Every 3rd point is plenty at screen size.
        const step = o.length > 120 ? 6 : 2;
        for (let i = 0; i < o.length; i += step) {
          const q = applyH(H, [p.table.x + o[i]!, p.table.y + o[i + 1]!]);
          const [x, y] = frameToElement(q[0], q[1], frame, vid, el, f.rotation);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        const [colour, dash, width] = p.flags.clump ? ['#ff9f2e', [6, 4], 2.5] : p.flags.weak ? ['#ffd84a', [], 2] : ['rgba(225, 230, 235, 0.9)', [], 1.5];
        strokeHalo(ctx, width);
        ctx.strokeStyle = colour;
        ctx.setLineDash(dash);
        ctx.lineWidth = width;
        ctx.stroke();
      }
      ctx.setLineDash([]);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [video]);

  return <canvas ref={canvasRef} class="overlay" data-testid="piece-overlay" />;
}
