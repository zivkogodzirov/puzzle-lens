/**
 * Outlines drawn over photos and the camera picture (M9 part 1, design review §3.1 "Overlays on
 * photos and video"). The colours are tokens (--ov-* in styles.css, OV in tokens.ts). The owner's table is cream: a pale outline alone vanishes on it, so every
 * piece outline sits on a dark halo, 0.6 black at 2.4 × the line's width (the halo is 4.9–5.4:1
 * against the owner's table, measured on two of the owner's photos).
 *
 * Line colours, against that halo over the cream table (#EDE6D8):
 * - found  #ede7dc 5.4:1 (the grey #9aa7b4 before: 2.7:1)
 * - shape  #cabdff 3.9:1 (the blue #4fb3ff before: 2.9:1)
 * - placed #3ccf7a 3.3:1 (unchanged; also the join lines' ✓ and Fill this spot's best piece)
 * - bad    #ff9a8f 3.3:1 (the red #ff6b6b before: 2.4:1): a piece not at its spot, not a piece
 * The yellow #ffd84a (4.8:1), orange #ff9f2e (3.3:1) and the scan's pale grey (5.3–5.6:1) stay.
 */
import type { PieceState } from '../project/progress';
import { OV } from './tokens';

/** The halo under every outline. */
export const HALO = OV.halo;
/** Its width, times the line's. */
export const HALO_SCALE = 2.4;

/** Outline colours by piece state, on photos and the live picture (the page's own dots use the CSS classes state-found / state-shape / state-placed). */
export const OVERLAY_STATE: Record<PieceState, string> = { found: OV.found, shape: OV.shape, placed: OV.placed };
/** Not where it was / not a piece. */
export const OVERLAY_BAD = OV.bad;

/**
 * Strokes the halo of the context's current path (canvas), for a line `width` wide drawn next; solid,
 * also under dashed lines, so the dashes stay readable on any table. The caller sets the line's own
 * style and dash afterwards. Each piece is drawn halo, fill, line in turn on one path: in WebKit
 * that costs ~20 % more than no halo, where a pass of all halos first (Path2D) cost ~70 % more.
 */
export function strokeHalo(ctx: CanvasRenderingContext2D, width: number): void {
  ctx.setLineDash([]);
  ctx.strokeStyle = HALO;
  ctx.lineWidth = width * HALO_SCALE;
  ctx.stroke();
}
