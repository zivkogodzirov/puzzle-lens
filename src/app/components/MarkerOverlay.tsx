import { useEffect, useRef } from 'preact/hooks';
import { latestFrame, latestFrameAt } from '../../camera/framePump';
import { frameToElement } from '../../camera/coords';
import { OV } from '../tokens';

/**
 * Draws detected printed markers (green outlines + id) over the live video.
 * The frame's own rotation is used when the browser reports it; otherwise it is guessed from the
 * frame and video shapes (0° or 90°). Whether that is right in every phone orientation is checked
 * on the iPhone (M1 checklist) — WebKit 27.2 doesn't report VideoFrame.rotation.
 */
export function MarkerOverlay({ video }: { video: HTMLVideoElement | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas || !video || !video.videoWidth) return;
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
      // Don't show stale outlines (e.g. the tracker stopped).
      if (!f || performance.now() - latestFrameAt > 500) return;
      const frame = { width: f.width, height: f.height };
      const vid = { width: video.videoWidth, height: video.videoHeight };
      const el = { width: w, height: h };
      ctx.lineWidth = 3;
      ctx.strokeStyle = OV.marker;
      ctx.fillStyle = OV.marker;
      ctx.font = '600 16px -apple-system, system-ui';
      for (const m of f.markers) {
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const [x, y] = frameToElement(m.corners[2 * i]!, m.corners[2 * i + 1]!, frame, vid, el, f.rotation);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
        const [lx, ly] = frameToElement(m.corners[0]!, m.corners[1]!, frame, vid, el, f.rotation);
        ctx.fillText(`#${m.id}`, lx + 4, ly - 6);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [video]);

  return <canvas ref={canvasRef} class="overlay" />;
}
