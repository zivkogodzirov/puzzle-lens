/**
 * The piece card (M9 part 3, design plan §4 item 4 and decisions 6, 7, 19, 22): one bottom sheet for a piece,
 * opened from the pieces, the table photo and live view ("Show where it goes") and Fill a spot. It replaces
 * the panel that opened under the pieces (PieceSpots).
 * - Header: the piece's cut-out, its spot "Column 18 · Row 7", how sure the app is in words (the % only in
 *   Tester mode) and the side of the frame.
 * - The box picture zoomed on the spot (about 5 cells across × 3 down, about 200 px tall), the spot ringed and
 *   the rest dimmed; "Whole picture" shows all of it.
 * - "Did it fit?": "Not there" (grey, left) and "It fits" (green, right), 56 px; one above the other ("It fits"
 *   on top) when they don't fit side by side. The page shows the Undo toasts: "It fits" closes the card,
 *   "Not there" moves it to the next best spot.
 * - "Point it out" (the live view pulsing this piece), "Partners (n)", "Also possible" (tap one to show it),
 *   "It's in the puzzle" for a piece without a sure spot, and "Not a piece" (one tap, with Undo) at the bottom.
 *
 * The sheet is `testId="spot"`: its ✕ is spot-close, its scrim spot-scrim; the content is piece-spots.
 */
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { SpotChoice } from '../../cv/openSpots';
import type { SidePartners } from '../../project/pairs';
import { frameSide, SIDE_WORDS } from '../../project/progress';
import type { PieceRow, Project } from '../../project/types';
import { useBlobUrl } from '../screens/puzzle/shared';
import { settings } from '../settings';
import { Icon } from '../ui/icons';
import { Sheet } from '../ui/Sheet';
import { ANSWER, CONFIDENCE_WORDS } from '../words';
import { BoxCrop, pairWords } from './Matches';

/** A chance in whole percent, never shown as a certain 100 %. */
const pct = (p: number): number => Math.min(99, Math.round(p * 100));

/** Rows of cells the zoomed spot shows (decision 19); the cells across follow from its width. */
const CROP_ROWS = 3;

export interface CardSpot {
  col: number;
  row: number;
  rot: 0 | 1 | 2 | 3;
}

export interface PieceCardProps {
  open: boolean;
  onClose: () => void;
  /** The piece (null once it is gone: the card then closes, still showing what it showed). */
  piece: PieceRow | null;
  choice: SpotChoice | null;
  project: Project;
  boxUrl: string | null;
  /** The empty spots pieces are matched to (on the whole picture), or null for the whole picture. */
  spots: Array<[number, number]> | null;
  /** The spot to show first (from Fill a spot), else its best spot. */
  startAt?: { col: number; row: number } | null;
  /** "It fits" / "Not there" at the spot shown. */
  onAnswer: (spot: CardSpot, fits: boolean) => void;
  /** Spots the owner said it doesn't fit, and a way to take those answers back. */
  ruledOut: number;
  onClearRuledOut: () => void;
  /** "It's in the puzzle" without a known spot (M7 part 4). */
  onInPuzzle: () => void;
  /** "Not a piece": removes it (the page offers Undo). */
  onRemove: () => void;
  /** "Point it out" in the live view; left out for the piece just tapped there. */
  onFind?: () => void;
  /** Which pieces may join its four sides (M6), as it lies on the box picture. */
  partners?: SidePartners[] | null;
  pieceById?: (id: string) => PieceRow | undefined;
}

export function PieceCard(props: PieceCardProps) {
  // While it slides away it keeps showing what it showed (the piece may be in the puzzle or removed by then).
  const last = useRef<PieceCardProps | null>(null);
  const live = props.open && props.piece !== null;
  if (live) last.current = props;
  const p = live ? props : last.current;
  const root = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ col: number; row: number } | null>(props.startAt ?? null);
  const [whole, setWhole] = useState(false);
  const [partnersOpen, setPartnersOpen] = useState(false);
  const [width, setWidth] = useState(() => Math.max(240, Math.min(innerWidth, 720) - 32));
  const url = useBlobUrl(p?.piece?.thumbBlobId, p?.piece?.updatedAt);
  // The zoomed spot fills the card's width at its height.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setWidth((old) => (Math.abs(old - w) > 1 ? w : old));
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [Boolean(p)]);
  // While the sheet slides up, its buttons don't take taps: a tap right after opening lands on the sheet itself
  // (nothing happens) or on the dimmed page (it closes), never on a button sliding past under the finger
  // (M8 part 4's lesson for the old panel: a quick tap meant for ✓ Fits landed on "Remove it").
  useLayoutEffect(() => {
    const sheet = root.current?.closest<HTMLElement>('.ui-sheet');
    if (!sheet || !props.open) return;
    const anims = sheet.getAnimations?.() ?? [];
    if (!anims.length) return;
    sheet.dataset.opening = '';
    let on = true;
    void Promise.all(anims.map((a) => a.finished.catch(() => undefined))).then(() => {
      if (on) delete sheet.dataset.opening;
    });
    return () => {
      on = false;
      delete sheet.dataset.opening;
    };
  }, [props.open]);

  if (!p || !p.piece) return null;
  const { piece, choice, project, boxUrl, spots } = p;
  const grid = project.grid!;
  const tester = settings.testerMode.value;
  const place = choice?.placement ?? null;
  const fits = choice?.fits ?? true;
  // The spots worth showing: the best, and the others at 1 % or more.
  const top = place ? place.top.filter((t, i) => i === 0 || t.p >= 0.01) : [];
  const shownAt = at ? top.findIndex((t) => t.col === at.col && t.row === at.row) : 0;
  const idx = Math.max(0, shownAt);
  const spot = top[idx] ?? null;
  const sure = (i: number, prob: number) => {
    const w = i === 0 ? CONFIDENCE_WORDS[place!.verdict] : CONFIDENCE_WORDS.likely;
    return tester ? `${w}, ${pct(prob)} %` : w;
  };
  const sureClass = (i: number) => `legend-${i === 0 ? place!.verdict : 'likely'}`;
  const side = spot && fits ? frameSide(spot.col, spot.row, grid.cols, grid.rows) : null;
  const name = (t: { col: number; row: number }) => `Column ${t.col + 1} · Row ${t.row + 1}`;
  const aspect = project.box ? project.box.width / project.box.height : grid.cols / grid.rows;
  const cellAspect = (aspect * grid.rows) / grid.cols;
  // About 200 px tall (decision 19), less on a short screen so the answers stay in the medium sheet.
  const cropH = Math.max(120, Math.min(200, Math.round(innerHeight * 0.24)));
  const across = (CROP_ROWS * (width / cropH)) / cellAspect;
  const others = top.map((t, i) => ({ t, i })).filter(({ i }) => i !== idx);
  // "Partners (n)" when at least one piece may join it (what's left, e.g. "partner not scanned yet", shows with them).
  const partnerAll = p.partners && p.pieceById && fits ? partnerSummary(p.partners) : null;
  const partnerInfo = partnerAll?.found.length ? partnerAll : null;
  const answer = (yes: boolean) => {
    if (!spot) return;
    p.onAnswer({ col: spot.col, row: spot.row, rot: spot.rot }, yes);
    // "Not there": the next best spot comes next.
    if (!yes) setAt(null);
  };

  const title = (
    <span class="card-head">
      <span class="card-thumb">{url ? <img src={url} alt="" /> : null}</span>
      {spot ? (
        <span class="card-head-text" data-testid="spot-verdict">
          <span class="card-name" data-testid="spot-name">
            {fits ? name(spot) : `Closest: ${name(spot)}`}
          </span>
          <span class="card-sub">
            <span class={sureClass(idx)} data-testid="spot-confidence">
              {fits ? sure(idx, spot.p) : 'Fits no empty spot well'}
            </span>
            {side ? <span data-testid="spot-side"> · {SIDE_WORDS[side]}</span> : null}
          </span>
        </span>
      ) : (
        <span class="card-head-text">
          <span class="card-name">Where it goes</span>
        </span>
      )}
    </span>
  );

  return (
    <Sheet open={live} onClose={props.onClose} title={title} testId="spot">
      <div class="piece-card" data-testid="piece-spots" ref={root}>
        {!spot && (
          <p data-testid="spot-verdict">
            {p.ruledOut > 0
              ? 'You said it doesn’t fit any of its suggested spots.'
              : choice && spots
                ? 'It fits none of the empty spots (by its shape or its picture). It may not be a piece, or it may come from somewhere else.'
                : 'No spot yet: scan this piece again (a Whole table photo or a Close-up).'}
          </p>
        )}
        {spot && !fits && (
          <p class="small" data-testid="spot-nofit">
            It fits none of the empty spots well. It may not be a piece (a label, a shadow), or it may come from somewhere else.
          </p>
        )}
        {spot && boxUrl && (
          <div class="card-picture">
            {whole ? (
              <WholePicture boxUrl={boxUrl} grid={grid} aspect={aspect} spots={spots} top={top} shown={idx} />
            ) : (
              <BoxCrop
                boxUrl={boxUrl}
                project={project}
                cells={[[spot.col, spot.row]]}
                around={[across, CROP_ROWS]}
                dim
                class="card-crop"
                testId="spot-crop"
                label={`The box picture around column ${spot.col + 1}, row ${spot.row + 1}, ringed`}
              />
            )}
            <button
              class={`btn btn-small card-whole${spot.row >= grid.rows - 1 ? ' card-whole-top' : ''}`}
              data-testid="spot-whole"
              aria-pressed={whole}
              onClick={() => setWhole(!whole)}
            >
              <Icon name={whole ? 'target' : 'image'} size={20} /> {whole ? 'Close-up' : 'Whole picture'}
            </button>
          </div>
        )}
        {spot && (
          <div class="card-answer-block" role="group" aria-label={`Did it fit in column ${spot.col + 1}, row ${spot.row + 1}?`} data-testid="spot-answer">
            <p class="card-question" aria-hidden="true">
              Did it fit?
            </p>
            <div class="card-answer">
              <button
                class="btn card-answer-btn"
                data-testid="spot-not"
                aria-label={`${ANSWER.not}: column ${spot.col + 1}, row ${spot.row + 1}`}
                onClick={() => answer(false)}
              >
                <Icon name="x" size={22} /> {ANSWER.not}
              </button>
              <button
                class="btn btn-good btn-fits card-answer-btn"
                data-testid="spot-fits"
                aria-label={`${ANSWER.fits} in column ${spot.col + 1}, row ${spot.row + 1}`}
                onClick={() => answer(true)}
              >
                <Icon name="check" size={22} /> {ANSWER.fits}
              </button>
            </div>
          </div>
        )}
        {p.ruledOut > 0 && (
          <div class="card-row" data-testid="spot-ruled-out">
            <p class="small grow">{p.ruledOut === 1 ? '1 spot' : `${p.ruledOut} spots`} ruled out by your answers.</p>
            <button class="btn btn-small" data-testid="spot-clear" onClick={p.onClearRuledOut}>
              Ask again
            </button>
          </div>
        )}
        {(p.onFind || partnerInfo) && (
          <div class="card-secondary">
            {p.onFind && (
              <button class="btn btn-small" data-testid="spot-find" onClick={p.onFind}>
                <Icon name="scan-eye" size={20} /> Point it out
              </button>
            )}
            {partnerInfo && (
              <button class="btn btn-small" data-testid="spot-partners" aria-expanded={partnersOpen} onClick={() => setPartnersOpen(!partnersOpen)}>
                <Icon name="link" size={20} /> Partners ({partnerInfo.found.length})
              </button>
            )}
          </div>
        )}
        {partnersOpen && partnerInfo && <PiecePartners info={partnerInfo} pieceById={p.pieceById!} />}
        {!partnerInfo && partnerAll && partnerAll.rest.length > 0 && (
          // No partner found yet: still say what is known about its sides (review 2026-11-11: as before M9 part 3).
          <p class="small muted" data-testid="spot-partner-rest">
            Joins: {partnerAll.rest.join(' · ')}.
          </p>
        )}
        {fits && others.length > 0 && boxUrl && (
          <section class="card-others" data-testid="spot-others">
            <h3 class="card-section">Also possible</h3>
            <div class="card-alts">
              {others.map(({ t, i }) => (
                <button
                  key={`${t.col},${t.row}`}
                  class="card-alt"
                  data-testid="spot-alt"
                  aria-label={`Show column ${t.col + 1}, row ${t.row + 1} (${sure(i, t.p)})`}
                  onClick={() => setAt({ col: t.col, row: t.row })}
                >
                  <BoxCrop boxUrl={boxUrl} project={project} cells={[[t.col, t.row]]} around={[3, 3]} dim class="card-alt-crop" testId="spot-alt-crop" />
                  <span class="card-alt-name">
                    {t.col + 1} · {t.row + 1}
                  </span>
                  <span class={`card-alt-sure ${sureClass(i)}`}>{sure(i, t.p)}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        {(!spot || !fits || place?.verdict === 'several') && (
          <div class="card-row" data-testid="spot-in-puzzle-row">
            <p class="small grow">Put it in already, somewhere the app didn’t know?</p>
            <button class="btn btn-small" data-testid="spot-in-puzzle" onClick={p.onInPuzzle}>
              <Icon name="check" size={20} /> It’s in the puzzle
            </button>
          </div>
        )}
        <button class="btn btn-plain card-remove" data-testid="spot-remove" onClick={p.onRemove}>
          <Icon name="trash" size={20} /> Not a piece
        </button>
      </div>
    </Sheet>
  );
}

/** The whole box picture: the spot shown (green), the other possible spots (dashed) and the empty spots (white outlines). */
function WholePicture({
  boxUrl,
  grid,
  aspect,
  spots,
  top,
  shown,
}: {
  boxUrl: string;
  grid: { cols: number; rows: number };
  aspect: number;
  spots: Array<[number, number]> | null;
  top: Array<{ col: number; row: number }>;
  shown: number;
}) {
  return (
    <svg
      class="spot-box card-box"
      style={{ aspectRatio: String(aspect) }}
      viewBox={`0 0 ${grid.cols} ${grid.rows}`}
      preserveAspectRatio="none"
      data-testid="spot-box"
      role="img"
      aria-label={`The whole box picture, column ${top[shown]!.col + 1}, row ${top[shown]!.row + 1} marked`}
    >
      <image href={boxUrl} x={0} y={0} width={grid.cols} height={grid.rows} preserveAspectRatio="none" />
      {spots?.map(([c, r]) => (
        <rect key={`open-${c},${r}`} x={c} y={r} width={1} height={1} class="spot-open" vector-effect="non-scaling-stroke" />
      ))}
      {top
        .map((t, i) => ({ t, i }))
        .sort((a, b) => Number(a.i === shown) - Number(b.i === shown))
        .map(({ t, i }) => (
          <rect
            key={`${t.col},${t.row}`}
            x={t.col}
            y={t.row}
            width={1}
            height={1}
            class={i === shown ? 'spot-best' : 'spot-other'}
            vector-effect="non-scaling-stroke"
          />
        ))}
    </svg>
  );
}

const SIDE_NAMES = ['above it', 'on its right', 'below it', 'on its left'] as const;

interface PartnerInfo {
  found: Array<{ e: number; s: SidePartners }>;
  rest: string[];
}

/** The pieces that may join a piece's sides (M6), most likely first, and what's left; null when there is nothing to say. */
function partnerSummary(partners: SidePartners[]): PartnerInfo | null {
  const found = partners
    .map((s, e) => ({ e, s }))
    .filter((x) => x.s.partners[0] && x.s.partners[0].p >= 0.2)
    .sort((x, y) => y.s.partners[0]!.p - x.s.partners[0]!.p);
  const notYet = partners.filter((s) => s.notScanned >= 0.5).length;
  const edge = partners.filter((s) => s.edge >= 0.5).length;
  const done = partners.filter((s) => s.inPuzzle >= 0.5).length;
  const sides = (n: number) => (n === 1 ? '1 side' : `${n} sides`);
  const rest = [
    notYet ? `partner not scanned yet on ${sides(notYet)}` : '',
    done ? `next to the done part on ${sides(done)}` : '',
    edge ? `${sides(edge)} on the puzzle's edge` : '',
  ].filter(Boolean);
  return found.length || rest.length ? { found, rest } : null;
}

function PiecePartners({ info, pieceById }: { info: PartnerInfo; pieceById: (id: string) => PieceRow | undefined }) {
  return (
    <div class="piece-partners" data-testid="piece-partners">
      <p class="small">
        <strong>Joins</strong> (as on the box picture):
      </p>
      {info.found.map(({ e, s }) => (
        <div class="row small" key={e} data-testid="piece-partner">
          <PartnerThumb piece={pieceById(s.partners[0]!.id)} />
          <span class="grow">
            {SIDE_NAMES[e]} · {pairWords(s.partners[0]!.p)}
            {s.partners[1] && s.partners[1].p >= 0.2 ? ` (or another piece: ${pairWords(s.partners[1].p)})` : ''}
          </span>
        </div>
      ))}
      {info.rest.length > 0 && <p class="muted small">{info.rest.join(' · ').replace(/^./, (ch) => ch.toUpperCase())}.</p>}
    </div>
  );
}

function PartnerThumb({ piece }: { piece: PieceRow | undefined }) {
  const url = useBlobUrl(piece?.thumbBlobId, piece?.updatedAt);
  return url ? <img src={url} class="match-thumb" alt="Its partner" /> : <span class="match-thumb catalog-empty" />;
}
