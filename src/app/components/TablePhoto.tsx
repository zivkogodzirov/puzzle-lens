/**
 * "Show my table": the newest scan photos of the table with the pieces outlined, labelled and tappable
 * (moved out of Trays.tsx in M9 part 4, so the Table tab and the trays panel can change apart). Used by the
 * Table tab and by a tray group's photo in the trays panel.
 *
 * Two ways to show it:
 * - **full screen** (default): over the page, with Close (the trays panel's tray group, and the Table tab's
 *   full-screen view);
 * - **`inline`** (M9 part 4, the Table tab's main view): in the page, between the navigation bar and the tab bar,
 *   on a dark card: "Pieces in view (n)" and "?" over the photo, `tools` beside them, `footer` under it. A tapped
 *   piece opens its card at once (`onPick`); a tap elsewhere zooms in, a second tap zooms out.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { TestStrip } from './TestSteps';
import { db } from '../../db/db';
import { applyH, invertH } from '../../geo/homography';
import { getBlob, getProject } from '../../project/store';
import { snapsOfBatch } from '../../project/batches';
import type { PieceRow, SnapRow } from '../../project/types';
import { logError } from '../../log/logger';
import {
  badgeBox,
  DASH_SVG,
  HALO,
  HALO_SCALE,
  LABEL_PX,
  labelTextWidth,
  markOf,
  MAX_LABELS,
  placeLabels,
  pieceName,
  PRIO,
  type BadgeMark,
  type LabelRequest,
  type OutlineMark,
  type PlacedLabel,
} from '../overlay';
import { LabelTip, OverlayLegendButton, OverlayLegendSheet, SvgBadge } from './OverlayLegend';
import { useSvgScale } from './ScanMaps';
import { OV } from '../tokens';
import { Sheet } from '../ui/Sheet';
import { IconButton } from '../ui/Button';
import { Icon } from '../ui/icons';

interface PhotoView {
  snap: SnapRow;
  url: string;
  /**
   * The pieces' outlines in this photo (px, flat x, y), each in its colour, with a label at its centre: `sure`
   * false gets a dot instead (M9 part 3); `mark` is the outline language's (dashed with a badge unless 'ok').
   */
  outlines: Array<{
    id: string;
    pts: number[];
    colour: string;
    label: string | null;
    sure: boolean;
    mark: OutlineMark;
    cx: number;
    cy: number;
    size: number;
    x1: number;
    y0: number;
  }>;
  view: [number, number, number, number];
}

/**
 * The newest scan photos that show the pieces (the fewest that show them all, up to `maxPhotos`).
 * 'lit': those pieces lit up (everything else darkened), outlined in their colour. 'all': every piece
 * outlined in its colour, labelled, and tappable (`infoOf` says what a tapped piece is).
 */
export function TablePhoto({
  projectId,
  pieces,
  colour,
  colourOf,
  title,
  onClose,
  mode = 'lit',
  labelOf,
  infoOf,
  onPick,
  maxPhotos = 3,
  legend,
  confidenceOf,
  inline = false,
  tools,
  footer,
}: {
  projectId: string;
  pieces: PieceRow[];
  /** The outline colour (or per piece with colourOf). */
  colour: string;
  colourOf?: (p: PieceRow) => string;
  title: string;
  /** Full screen: Close. (Not used inline.) */
  onClose?: () => void;
  mode?: 'lit' | 'all';
  labelOf?: (p: PieceRow) => string | null;
  infoOf?: (p: PieceRow) => string;
  /** "Show where it goes" for a tapped piece. */
  onPick?: (p: PieceRow) => void;
  maxPhotos?: number;
  legend?: preact.ComponentChildren;
  /** How sure a labelled piece's spot is (M9 part 3, optional, as in LiveTable): only 'strong' gets a label, the others a dot. */
  confidenceOf?: (p: PieceRow) => { verdict: 'strong' | 'likely' | 'several'; p?: number } | null;
  /** In the page instead of full screen (M9 part 4, the Table tab): use with mode 'all'; a tapped piece is `onPick`. */
  inline?: boolean;
  /** Inline: more buttons in the bar over the photo (after "?"). */
  tools?: ComponentChildren;
  /** Inline: under the photo (e.g. the Table tab's "Start live view"). */
  footer?: ComponentChildren;
}) {
  const [views, setViews] = useState<PhotoView[] | null>(null);
  const [missing, setMissing] = useState(0);
  const [k, setK] = useState(0);
  const [tapped, setTapped] = useState<string | null>(null);
  /** 'all' mode: tapping the photo zooms in around that point (pinch-zoom is off in the app), tapping again zooms out. */
  const [focus, setFocus] = useState<[number, number] | null>(null);
  useEffect(() => {
    let live = true;
    const made: string[] = [];
    void (async () => {
      // This batch's photos only (M7): earlier batches show another table layout.
      const project = await getProject(projectId);
      const snaps = snapsOfBatch(project ?? {}, await db().snaps.where('projectId').equals(projectId).toArray())
        .filter((s) => (s.kind === 'overview' || s.kind === 'detail') && s.blobId && s.imgToTable)
        // Overviews first, then the newest.
        .sort((a, b) => Number(b.kind === 'overview') - Number(a.kind === 'overview') || b.ts - a.ts);
      const left = new Set(pieces.map((p) => p.id));
      const out: PhotoView[] = [];
      const inPhoto = (s: SnapRow, p: PieceRow, H: number[]) => {
        const [x, y] = applyH(H, [p.table.x, p.table.y]);
        return x >= 0 && y >= 0 && x < s.width && y < s.height;
      };
      while (left.size && out.length < maxPhotos) {
        let best: { s: SnapRow; H: number[]; ids: string[] } | null = null;
        for (const s of snaps) {
          if (out.some((v) => v.snap.id === s.id)) continue;
          const H = invertH(s.imgToTable!);
          if (!H) continue;
          const ids = pieces.filter((p) => left.has(p.id) && inPhoto(s, p, H)).map((p) => p.id);
          if (ids.length > (best?.ids.length ?? 0)) best = { s, H, ids };
        }
        if (!best) break;
        const blob = await getBlob(best.s.blobId!);
        if (!blob) break;
        const url = URL.createObjectURL(blob);
        made.push(url);
        const outlines: PhotoView['outlines'] = [];
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (const p of pieces.filter((q) => best!.ids.includes(q.id))) {
          const o = p.outlineMm;
          const pts: number[] = [];
          let px0 = Infinity;
          let px1 = -Infinity;
          let py0 = Infinity;
          for (let i = 0; i + 1 < o.length; i += 2) {
            const [x, y] = applyH(best.H, [p.table.x + o[i]!, p.table.y + o[i + 1]!]);
            pts.push(x, y);
            x0 = Math.min(x0, x);
            y0 = Math.min(y0, y);
            x1 = Math.max(x1, x);
            y1 = Math.max(y1, y);
            px0 = Math.min(px0, x);
            px1 = Math.max(px1, x);
            py0 = Math.min(py0, y);
          }
          const [cx, cy] = applyH(best.H, [p.table.x, p.table.y]);
          const cf = confidenceOf?.(p);
          outlines.push({
            id: p.id,
            pts,
            colour: colourOf?.(p) ?? colour,
            label: labelOf?.(p) ?? null,
            sure: cf ? cf.verdict === 'strong' : true,
            mark: markOf(p.flags),
            cx,
            cy,
            size: px1 - px0,
            x1: px1,
            y0: py0,
          });
          left.delete(p.id);
        }
        // Show the part of the photo with these pieces (with room around them), at least a third of it.
        const W = best.s.width;
        const Hh = best.s.height;
        const pad = 0.15 * Math.max(x1 - x0, y1 - y0, 0.2 * Math.max(W, Hh));
        let vw = Math.max(x1 - x0 + 2 * pad, W / 3);
        let vh = Math.max(y1 - y0 + 2 * pad, Hh / 3);
        vw = Math.min(vw, W);
        vh = Math.min(vh, Hh);
        const vx = Math.max(0, Math.min(W - vw, (x0 + x1) / 2 - vw / 2));
        const vy = Math.max(0, Math.min(Hh - vh, (y0 + y1) / 2 - vh / 2));
        out.push({ snap: best.s, url, outlines, view: [vx, vy, vw, vh] });
      }
      if (live) {
        setViews(out);
        setMissing(left.size);
      }
    })().catch((err) => logError('trays', 'The table photo could not be shown', err));
    return () => {
      live = false;
      for (const u of made) URL.revokeObjectURL(u);
    };
  }, [projectId, pieces]);
  const v = views?.[k];
  const ZOOM = 2.5;
  const viewBox = (): [number, number, number, number] => {
    if (!v) return [0, 0, 1, 1];
    if (!focus) return v.view;
    const w = v.view[2] / ZOOM;
    const h = v.view[3] / ZOOM;
    return [Math.max(0, Math.min(v.snap.width - w, focus[0] - w / 2)), Math.max(0, Math.min(v.snap.height - h, focus[1] - h / 2)), w, h];
  };
  const onPhotoTap = (e: MouseEvent) => {
    if (mode !== 'all') return;
    if (focus) return setFocus(null);
    const svg = (e.currentTarget as SVGElement).ownerSVGElement ?? (e.currentTarget as SVGSVGElement);
    const m = svg.getScreenCTM();
    if (!m) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    setFocus([p.x, p.y]);
  };
  const pts = (o: number[]) => o.reduce((s, val, i) => s + (i % 2 ? `,${val.toFixed(0)} ` : `${val.toFixed(0)}`), '');
  const tappedPiece = tapped ? (pieces.find((p) => p.id === tapped) ?? null) : null;
  // M9 part 3, the outline language: badges and column·row pills keep their screen size (px photo px per screen
  // px); labels are placed so none overlap (the tapped piece first, then sure spots); unsure spots get a dot.
  const svgRef = useRef<SVGSVGElement>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  /** Inline: the "Pieces in view" list is open. */
  const [listOpen, setListOpen] = useState(false);
  const vb = viewBox();
  const px = useSvgScale(svgRef, vb[2], vb[3]);
  // Colour, label, how sure and the badge as they are now (M9 part 4): the photo stays on the Table tab while the
  // spots on the box picture come in or change (an answer), so they're read on each draw, not with the photo.
  const byId = useMemo(() => new Map(pieces.map((p) => [p.id, p])), [pieces]);
  const outlines = (v?.outlines ?? []).map((o) => {
    const p = byId.get(o.id);
    if (!p) return o;
    const cf = confidenceOf?.(p);
    return { ...o, colour: colourOf?.(p) ?? colour, label: labelOf?.(p) ?? null, sure: cf ? cf.verdict === 'strong' : true, mark: markOf(p.flags) };
  });
  const looks = outlines.map((o) => `${o.colour}|${o.label ?? ''}|${o.sure ? 1 : 0}|${o.mark}`).join(',');
  const marks = useMemo(() => {
    if (!v)
      return {
        placed: [] as PlacedLabel[],
        dots: [] as Array<{ id: string; cx: number; cy: number; colour: string }>,
        badges: [] as Array<{ id: string; mark: BadgeMark; cx: number; cy: number }>,
      };
    const inView = (x: number, y: number) => x >= vb[0] && y >= vb[1] && x <= vb[0] + vb[2] && y <= vb[1] + vb[3];
    const m = 14 * px;
    const badges = outlines
      .filter((o) => o.mark !== 'ok' && inView(o.cx, o.cy))
      .map((o) => ({
        id: o.id,
        mark: o.mark as BadgeMark,
        cx: Math.max(vb[0] + m, Math.min(vb[0] + vb[2] - m, o.x1)),
        cy: Math.max(vb[1] + m, Math.min(vb[1] + vb[3] - m, o.y0)),
      }));
    const reqs: LabelRequest[] = [];
    const dots: Array<{ id: string; cx: number; cy: number; colour: string }> = [];
    for (const o of outlines) {
      if (!o.label || !inView(o.cx, o.cy)) continue;
      const x = o.cx - vb[0];
      const y = o.cy - vb[1];
      if (o.id === tapped) reqs.push({ key: o.id, text: o.label, x, y, r: o.size / 2, prio: PRIO.tapped });
      else if (o.sure) reqs.push({ key: o.id, text: o.label, x, y, r: o.size / 2, prio: PRIO.sure });
      else dots.push({ id: o.id, cx: o.cx, cy: o.cy, colour: o.colour });
    }
    // One badge per dashed outline, not on top of another badge; labels keep clear of the badges and of each other
    // (a sure spot whose label has no room keeps its green outline).
    const shown: typeof badges = [];
    const blocked: Array<{ x: number; y: number; w: number; h: number }> = [];
    for (const b of badges) {
      const r = badgeBox(b.mark, 0, 0);
      const box = { x: b.cx - vb[0] + r.x * px, y: b.cy - vb[1] + r.y * px, w: r.w * px, h: r.h * px };
      if (blocked.some((o) => box.x < o.x + o.w && o.x < box.x + box.w && box.y < o.y + o.h && o.y < box.y + box.h)) continue;
      blocked.push(box);
      shown.push(b);
    }
    const { placed } = placeLabels(reqs, (t) => labelTextWidth(t) * px, { w: vb[2], h: vb[3] }, blocked, MAX_LABELS, px);
    return { placed: placed.map((l) => ({ ...l, x: l.x + vb[0], y: l.y + vb[1] })), dots, badges: shown };
  }, [v, looks, vb.join(','), px, tapped]);
  // The photo with its outlines, labels, dots and badges (both ways); `pick`: a tapped outline.
  const photo = (pick: (o: PhotoView['outlines'][number]) => void) =>
    !v ? null : (
      <svg ref={svgRef} viewBox={vb.join(' ')} preserveAspectRatio="xMidYMid meet" data-testid="table-photo-svg" data-zoomed={focus ? 'yes' : 'no'}>
        {mode === 'lit' && (
          <defs>
            <mask id="lit">
              <rect x={0} y={0} width={v.snap.width} height={v.snap.height} fill={OV.maskShow} />
              {v.outlines.map((o) => (
                <polygon key={o.id} points={pts(o.pts)} fill={OV.maskHide} stroke={OV.maskHide} stroke-width={v.view[2] / 60} />
              ))}
            </mask>
          </defs>
        )}
        <image href={v.url} x={0} y={0} width={v.snap.width} height={v.snap.height} onClick={(e) => onPhotoTap(e as unknown as MouseEvent)} />
        {mode === 'lit' && <rect x={0} y={0} width={v.snap.width} height={v.snap.height} fill={OV.dim} fill-opacity="0.6" mask="url(#lit)" />}
        {/* Every outline on a dark halo, all halos first (M9 part 1: pale lines vanish on a cream table). */}
        {outlines.map((o) => (
          <polygon
            key={`h${o.id}`}
            points={pts(o.pts)}
            fill="none"
            stroke={HALO}
            stroke-width={(tapped === o.id ? 7 : 4) * HALO_SCALE}
            stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
            pointer-events="none"
            class="outline-halo"
          />
        ))}
        {outlines.map((o) => (
          <polygon
            key={o.id}
            points={pts(o.pts)}
            fill={mode === 'all' ? OV.hit : 'none'}
            stroke={o.colour}
            stroke-width={tapped === o.id ? 7 : 4}
            stroke-dasharray={o.mark === 'ok' ? undefined : DASH_SVG}
            vector-effect="non-scaling-stroke"
            class="lit-outline"
            data-id={o.id}
            data-mark={o.mark}
            onClick={mode === 'all' ? (e) => (e.stopPropagation(), pick(o)) : undefined}
          />
        ))}
        {marks.dots.map((d) => (
          <g key={`d${d.id}`} pointer-events="none" class="ov-dot" data-testid="photo-dot">
            <circle cx={d.cx} cy={d.cy} r={6 * px} fill={HALO} />
            <circle cx={d.cx} cy={d.cy} r={4 * px} fill={d.colour} />
          </g>
        ))}
        {marks.badges.map((b) => (
          <SvgBadge key={`b${b.id}`} mark={b.mark} cx={b.cx} cy={b.cy} k={px} />
        ))}
        {marks.placed.map((l) => (
          <g key={`t${l.key}`} pointer-events="none" class="ov-label" data-key={l.key}>
            <rect x={l.x} y={l.y} width={l.w} height={l.h} rx={l.h / 2} fill={OV.labelBg} />
            <text x={l.x + l.w / 2} y={l.y + l.h / 2} font-size={LABEL_PX * px} fill={OV.labelText} class="ov-label-text" data-testid="photo-label">
              {l.text}
            </text>
          </g>
        ))}
      </svg>
    );
  const status = !views ? (
    <p class="muted">Loading your photo…</p>
  ) : !v ? (
    <p class="muted" data-testid="table-photo-none">
      None of your saved scan photos shows these pieces (only the last 10 photos are kept). Scan the table again.
    </p>
  ) : null;
  const missingNote =
    missing > 0 && views ? (
      <p class="muted small" data-testid="table-photo-missing">
        {missing} of them {missing === 1 ? 'isn’t' : 'aren’t'} on a saved photo.
      </p>
    ) : null;
  // Inline (the Table tab): the pieces whose centre is in view now, for "Pieces in view" (accessibility rule 10).
  // (A piece just put in the puzzle is left out at once: its outline goes when the photo is read again.)
  const inViewIds = v
    ? v.outlines.filter((o) => byId.has(o.id) && o.cx >= vb[0] && o.cy >= vb[1] && o.cx <= vb[0] + vb[2] && o.cy <= vb[1] + vb[3]).map((o) => o.id)
    : [];
  if (inline) {
    const pick = (id: string) => {
      const p = byId.get(id);
      if (p) onPick?.(p);
    };
    const sureOf = (p: PieceRow) => {
      const cf = confidenceOf?.(p);
      return cf ? cf.verdict === 'strong' : true;
    };
    return (
      <div class="table-photo-inline" data-testid="table-photo" role="group" aria-label={title}>
        <div class="table-photo-inline-bar">
          {v && (
            <button type="button" class="table-photo-inview" data-testid="table-photo-inview" onClick={() => setListOpen(true)}>
              Pieces in view ({inViewIds.length})
            </button>
          )}
          <span class="grow" />
          {/* The legend's "?" (as OverlayLegendButton), with a name of its own: the live view's "?" can be open over this tab. */}
          <IconButton label="What the outlines mean" class="btn-cam" testId="table-photo-legend-open" onClick={() => setLegendOpen(true)}>
            <Icon name="help-circle" />
          </IconButton>
          {tools}
        </div>
        <LabelTip active={marks.placed.length > 0} />
        {status && <div class="table-photo-inline-status">{status}</div>}
        {photo((o) => pick(o.id))}
        {(focus || (views && views.length > 1) || missingNote) && (
          <div class="table-photo-inline-bar table-photo-inline-nav">
            {views && views.length > 1 && (
              <button class="btn btn-small" data-testid="table-photo-next" onClick={() => (setFocus(null), setK((k + 1) % views.length))}>
                Next photo ({k + 1} of {views.length})
              </button>
            )}
            {focus && (
              <button class="btn btn-small" data-testid="table-photo-out" onClick={() => setFocus(null)}>
                Whole photo
              </button>
            )}
            {missingNote}
          </div>
        )}
        {footer && <div class="table-photo-inline-foot">{footer}</div>}
        <OverlayLegendSheet open={legendOpen} onClose={() => setLegendOpen(false)} />
        <Sheet open={listOpen} onClose={() => setListOpen(false)} title="Pieces in view" testId="table-photo-pieces">
          {!listOpen ? null : inViewIds.length ? (
            <ul class="ov-piece-list" data-testid="table-photo-pieces-list">
              {inViewIds.map((id) => {
                const p = byId.get(id)!;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      class="ov-piece-item"
                      data-testid="table-photo-piece-item"
                      data-id={id}
                      onClick={() => {
                        setListOpen(false);
                        pick(id);
                      }}
                    >
                      {pieceName(p, labelOf?.(p) ?? null, sureOf(p))}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p class="muted" data-testid="table-photo-pieces-none">
              No piece is in this part of the photo. Tap the photo to see all of it.
            </p>
          )}
        </Sheet>
      </div>
    );
  }
  return (
    <div class="photo-result table-photo" data-testid="table-photo">
      <TestStrip />
      <div class="row table-photo-bar">
        <strong class="grow">
          {title}
          {mode === 'lit' ? `: ${pieces.length - missing} lit up` : ''}
          {views && views.length > 1 ? ` · photo ${k + 1} of ${views.length}` : ''}
        </strong>
        {views && views.length > 1 && (
          <button class="btn btn-small" data-testid="table-photo-next" onClick={() => (setFocus(null), setK((k + 1) % views.length))}>
            Next photo
          </button>
        )}
        {focus && (
          <button class="btn btn-small" data-testid="table-photo-out" onClick={() => setFocus(null)}>
            Whole photo
          </button>
        )}
        <OverlayLegendButton onOpen={() => setLegendOpen(true)} />
        <button class="btn btn-small" data-testid="table-photo-close" onClick={onClose}>
          Close
        </button>
      </div>
      {legend && <div class="table-photo-legend small">{legend}</div>}
      <LabelTip active={marks.placed.length > 0} />
      <OverlayLegendSheet open={legendOpen} onClose={() => setLegendOpen(false)} />
      {status ?? photo((o) => (setTapped(o.id), focus || setFocus([o.cx, o.cy])))}
      {tappedPiece && infoOf && (
        <div class="row table-photo-info" data-testid="table-photo-info">
          <span class="grow">{infoOf(tappedPiece)}</span>
          {onPick && (
            <button class="btn btn-small btn-filled" data-testid="table-photo-pick" onClick={() => onPick(tappedPiece)}>
              Show where it goes
            </button>
          )}
        </div>
      )}
      {missingNote}
    </div>
  );
}
