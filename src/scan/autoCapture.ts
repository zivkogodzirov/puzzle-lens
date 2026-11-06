/**
 * Hand-held capture (PLAN §2 "Phone", decision 2026-11-06): the live tracker reports where the
 * phone is above the table for every frame; this decides what the level-and-height gauge says and
 * when a Snap fires by itself (level, right height, area in view, still).
 *
 * Pure logic, no DOM: the Scan screen feeds it tracker results and reads back a GaugeState.
 */
import type { TableFix } from '../geo/tableFix';
import { applyH } from '../geo/homography';
import type { MarkerMap, Vec2 } from '../project/types';

export type CaptureKind = 'overview' | 'detail';

export interface CaptureRules {
  /** Steepest allowed tilt from straight down. */
  maxTiltDeg: number;
  /**
   * Fewest pixels per mm. Overview: the whole marker ring must fit, which by hand means ~65–70 cm
   * and ~3.5–4.3 px/mm (a 19 mm piece ≈ 70–80 px: enough to find and colour it). Detail: ≥ 8.5
   * for shape reading (RESEARCH §4).
   */
  minPxPerMm: number;
  /** How long the phone must be steady before the photo fires. */
  steadyMs: number;
  /** Largest movement of the table point under the image centre while "steady" (mm). */
  steadyMoveMm: number;
  /** Largest tilt change while steady (deg). */
  steadyTiltDeg: number;
}

export const RULES: Record<CaptureKind, CaptureRules> = {
  overview: { maxTiltDeg: 8, minPxPerMm: 3.5, steadyMs: 400, steadyMoveMm: 4, steadyTiltDeg: 1 },
  detail: { maxTiltDeg: 5, minPxPerMm: 8.5, steadyMs: 450, steadyMoveMm: 3, steadyTiltDeg: 0.8 },
};

export type GaugeStatus = 'no-map' | 'no-markers' | 'tilted' | 'too-high' | 'area-out' | 'move' | 'hold-still' | 'ready';

export interface GaugeState {
  status: GaugeStatus;
  /** One short instruction in plain English. */
  message: string;
  tiltDeg: number | null;
  heightMm: number | null;
  /** Image-space direction the phone leans (for the bubble). */
  leanImg: Vec2;
  /** 0–1: how long it has been steady, relative to steadyMs (for a filling ring). */
  steady: number;
  /** For detail photos: the table point to move to, and its direction in the image. */
  targetMm: Vec2 | null;
  targetDirImg: Vec2 | null;
}

export interface CaptureContext {
  kind: CaptureKind;
  map: MarkerMap | null;
  frame: { width: number; height: number };
  /** For detail photos: where the next photo should be centred (from the coverage map). */
  targetMm?: Vec2 | null;
  /** How close to the target the image centre must be (mm). */
  targetTolMm?: number;
}

/** The sample where the current steady streak began. */
interface Sample {
  t: number;
  centre: Vec2;
  tilt: number;
}

/** Marker centres of the map, i.e. the corners and sides of the sorting area. */
export function markerCentres(map: MarkerMap): Vec2[] {
  return map.markers.map((m) => {
    const c = m.cornersMm;
    return [(c[0]![0] + c[1]![0] + c[2]![0] + c[3]![0]) / 4, (c[0]![1] + c[1]![1] + c[2]![1] + c[3]![1]) / 4];
  });
}

/** True when every marker centre falls inside the image, `marginShare` away from its edges. */
export function areaInView(fix: TableFix, map: MarkerMap, frame: { width: number; height: number }, marginShare = 0.02): boolean {
  const mx = frame.width * marginShare;
  const my = frame.height * marginShare;
  return markerCentres(map).every((c) => {
    const p = applyH(fix.tableToImg, c);
    return p[0] >= mx && p[0] <= frame.width - mx && p[1] >= my && p[1] <= frame.height - my;
  });
}

export class AutoCapture {
  private samples: Sample[] = [];
  private firedAt = Number.NEGATIVE_INFINITY;

  /** After a photo fires, wait this long before another can (the user moves on). */
  static readonly COOLDOWN_MS = 1500;

  reset(): void {
    this.samples = [];
  }

  /** Call when a photo was taken (auto or by tapping), so the next one waits for the cooldown. */
  noteFired(t: number): void {
    this.firedAt = t;
    this.samples = [];
  }

  update(t: number, fix: TableFix | null, ctx: CaptureContext): GaugeState {
    const rules = RULES[ctx.kind];
    const base = { tiltDeg: fix?.tiltDeg ?? null, heightMm: fix?.heightMm ?? null, leanImg: fix?.leanImg ?? ([0, 0] as Vec2), steady: 0, targetMm: ctx.targetMm ?? null, targetDirImg: null };
    if (!ctx.map) return { ...base, status: 'no-map', message: 'Set up the markers first' };
    if (!fix) {
      this.samples = [];
      return { ...base, status: 'no-markers', message: 'Point at the table so the markers are in view' };
    }
    if (fix.tiltDeg > rules.maxTiltDeg) {
      this.samples = [];
      return { ...base, status: 'tilted', message: 'Hold the phone flat' };
    }
    if (fix.pxPerMm < rules.minPxPerMm) {
      this.samples = [];
      return { ...base, status: 'too-high', message: 'Move the phone lower' };
    }
    if (ctx.kind === 'overview' && !areaInView(fix, ctx.map, ctx.frame)) {
      this.samples = [];
      return { ...base, status: 'area-out', message: 'Raise the phone until all markers are in view' };
    }
    let targetDirImg: Vec2 | null = null;
    if (ctx.kind === 'detail' && ctx.targetMm) {
      const d = Math.hypot(fix.centreMm[0] - ctx.targetMm[0], fix.centreMm[1] - ctx.targetMm[1]);
      if (d > (ctx.targetTolMm ?? 60)) {
        this.samples = [];
        const a = applyH(fix.tableToImg, fix.centreMm);
        const b = applyH(fix.tableToImg, ctx.targetMm);
        const n = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        targetDirImg = [(b[0] - a[0]) / n, (b[1] - a[1]) / n];
        return { ...base, targetDirImg, status: 'move', message: 'Move the phone towards the arrow' };
      }
    }
    // Steadiness: how long the phone has stayed within the limits of where the steady streak began.
    const anchor = this.samples[0];
    if (!anchor || Math.hypot(fix.centreMm[0] - anchor.centre[0], fix.centreMm[1] - anchor.centre[1]) > rules.steadyMoveMm || Math.abs(fix.tiltDeg - anchor.tilt) > rules.steadyTiltDeg) {
      const restarted = !!anchor;
      this.samples = [{ t, centre: fix.centreMm, tilt: fix.tiltDeg }];
      if (restarted) return { ...base, targetDirImg, status: 'hold-still', message: 'Hold still', steady: 0 };
    }
    const first = this.samples[0]!;
    const held = t - first.t;
    const steady = Math.min(1, held / rules.steadyMs);
    if (steady >= 1 && t - this.firedAt >= AutoCapture.COOLDOWN_MS) {
      return { ...base, targetDirImg, status: 'ready', message: 'Taking the photo…', steady: 1 };
    }
    return { ...base, targetDirImg, status: 'hold-still', message: 'Hold still', steady };
  }
}

// ---------------------------------------------------------------------------------------------
// Marker-free capture (decision 2026-11-07): no printed markers. "Flat" comes from the phone's tilt
// sensor, "high/low" from how big the pieces look in the live picture, "everything in view" from
// pieces cut off at the picture's edge, and "still" from the pieces not moving in the picture.
// ---------------------------------------------------------------------------------------------

export interface FreeInput {
  /** Tilt from the phone's sensor (deg), or null when the sensor isn't available. */
  tiltDeg: number | null;
  pieces: { count: number; medianAreaPx: number | null; atEdge: number; bbox: [number, number, number, number] | null } | null;
  frame: { width: number; height: number };
}

export interface FreeRules {
  maxTiltDeg: number;
  /** Fewest estimated px per mm (from the pieces' apparent size and the nominal piece pitch). */
  minPxPerMm: number;
  steadyMs: number;
  /** Largest movement of the pieces' bounding-box centre while steady (share of the frame width). */
  steadyMove: number;
  steadyTiltDeg: number;
}

export const FREE_RULES: Record<CaptureKind, FreeRules> = {
  // Estimates (pale pieces read small, so allow a little slack against the marker rules).
  overview: { maxTiltDeg: 6, minPxPerMm: 3.2, steadyMs: 450, steadyMove: 0.006, steadyTiltDeg: 1 },
  detail: { maxTiltDeg: 5, minPxPerMm: 7.5, steadyMs: 450, steadyMove: 0.005, steadyTiltDeg: 0.8 },
};

/** After a photo, the picture must move this far (share of the frame width) before the next one fires by itself. */
export const FREE_MOVE_AFTER_PHOTO = 0.15;

/** Estimated px per mm from the median piece area (piece area ≈ one cell of `pitchMm`). */
export function pxPerMmFromPieces(medianAreaPx: number | null, pitchMm: number): number | null {
  return medianAreaPx && medianAreaPx > 0 ? Math.sqrt(medianAreaPx) / pitchMm : null;
}

export class FreeCapture {
  private anchor: { t: number; c: Vec2; tilt: number } | null = null;
  private firedAt = Number.NEGATIVE_INFINITY;
  /** Where the pieces were in the picture when the last photo was taken (no markers = no table position). */
  private firedC: Vec2 | null = null;
  private lastC: Vec2 | null = null;

  reset(): void {
    this.anchor = null;
  }

  /** Forget the last photo's position (e.g. switching between overview and close-ups). */
  resetFired(): void {
    this.firedC = null;
  }

  noteFired(t: number): void {
    this.firedAt = t;
    this.anchor = null;
    this.firedC = this.lastC;
  }

  update(t: number, input: FreeInput, ctx: { kind: CaptureKind; pitchMm: number; sensor: boolean }): GaugeState {
    const rules = FREE_RULES[ctx.kind];
    const ppm = pxPerMmFromPieces(input.pieces?.medianAreaPx ?? null, ctx.pitchMm);
    // Height from apparent size: H ≈ f / ppm, with f ≈ 1.25 × long side × 24 / 43.3 (24 mm-equivalent lens).
    const f = (Math.max(input.frame.width, input.frame.height) * 1.25 * 24 * (ctx.kind === 'detail' ? 2 : 1)) / Math.hypot(36, 24);
    const heightMm = ppm ? f / ppm : null;
    const base = { tiltDeg: input.tiltDeg, heightMm, leanImg: [0, 0] as Vec2, steady: 0, targetMm: null, targetDirImg: null };
    if (ctx.sensor && input.tiltDeg !== null && input.tiltDeg > rules.maxTiltDeg) {
      this.anchor = null;
      return { ...base, status: 'tilted', message: 'Hold the phone flat' };
    }
    const p = input.pieces;
    if (!p || p.count < 3 || !p.bbox) {
      this.anchor = null;
      return { ...base, status: 'no-markers', message: 'Point the camera at the pieces' };
    }
    if (ppm !== null && ppm < rules.minPxPerMm) {
      this.anchor = null;
      return { ...base, status: 'too-high', message: 'Move the phone lower' };
    }
    if (ctx.kind === 'overview' && p.atEdge >= 2) {
      this.anchor = null;
      return { ...base, status: 'area-out', message: 'Raise the phone until no piece is cut off at the edge' };
    }
    const c: Vec2 = [(p.bbox[0] + p.bbox[2]) / 2, (p.bbox[1] + p.bbox[3]) / 2];
    this.lastC = c;
    // Not the same spot again: after a photo, wait until the picture has moved on.
    if (this.firedC && Math.hypot(c[0] - this.firedC[0], c[1] - this.firedC[1]) < FREE_MOVE_AFTER_PHOTO * input.frame.width) {
      this.anchor = null;
      return { ...base, status: 'move', message: ctx.kind === 'detail' ? 'Done here: move to the next part (or tap the button)' : 'Photo taken' };
    }
    if (this.firedC) this.firedC = null;
    const tilt = input.tiltDeg ?? 0;
    const moved = (a: { c: Vec2; tilt: number }) => Math.hypot(c[0] - a.c[0], c[1] - a.c[1]) > rules.steadyMove * input.frame.width || Math.abs(tilt - a.tilt) > rules.steadyTiltDeg;
    if (!this.anchor || moved(this.anchor)) {
      const restarted = Boolean(this.anchor);
      this.anchor = { t, c, tilt };
      if (restarted) return { ...base, status: 'hold-still', message: 'Hold still', steady: 0 };
    }
    const steady = Math.min(1, (t - this.anchor.t) / rules.steadyMs);
    if (steady >= 1 && t - this.firedAt >= AutoCapture.COOLDOWN_MS) return { ...base, status: 'ready', message: 'Taking the photo…', steady: 1 };
    return { ...base, status: 'hold-still', message: 'Hold still', steady };
  }
}
