/**
 * The spot sheet (M4 "Fill this spot"; M9 part 4: a sheet over the Picture tab, design plan §4 item 6): for one
 * spot on the box picture, the pieces that may go there, best first, as their cut-outs with how sure the app is.
 * - The best piece (on the whole picture: each piece whose own best spot this is) has the answer pair:
 *   "Not there" / "It fits" (decision 6). Its picture opens the piece's card on this spot.
 * - "Show on my table": the pieces on the table, pointed out in the live view (the tab switches to Table).
 * - The spot close up (about 5 × 3 spots, decision 19), ringed: a tap there picks the spot beside it; the arrows move
 *   it by one (whole picture). Previous / Next go through the empty spots of your puzzle photo, or (whole picture)
 *   the spots whose piece is waiting, so the sheet works with VoiceOver without tapping the picture.
 * - "Maybe": the other pieces with a chance here; a tap opens a piece's card.
 *
 * The tab owns which spot is shown and what an answer does (PictureTab.tsx).
 */
import { useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import { settings } from '../settings';
import type { SpotChoice } from '../../cv/openSpots';
import { candidatesFor, type SpotCandidate } from '../../project/fillSpot';
import type { PieceRow, Project } from '../../project/types';
import { useBlobUrl } from '../screens/puzzle/shared';
import { Icon } from '../ui/icons';
import { Callout } from '../ui/Callout';
import { Sheet } from '../ui/Sheet';
import { ANSWER, CONFIDENCE_WORDS } from '../words';

/** Spots across and down in the close-up (decision 19: about 5 × 3, about 200 px tall). */
const CROP: [number, number] = [5, 3];
const pct = (p: number): number => Math.min(99, Math.round(p * 100));

export type Cell = [number, number];

/**
 * How sure the app is that a piece goes in this spot, in words (decision 7): its own verdict when this is
 * its spot, else "Maybe"; the % after the word only in Tester mode.
 */
export function sureWords(c: SpotCandidate): string {
  const w = c.chosen ? CONFIDENCE_WORDS[c.verdict] : CONFIDENCE_WORDS.likely;
  return settings.testerMode.value ? `${w}, ${pct(c.p)} %` : w;
}

/** The close-up's view box: CROP spots around the spot, inside the picture. */
export function cropOf(grid: { cols: number; rows: number }, [c, r]: Cell): [number, number, number, number] {
  const w = Math.min(CROP[0], grid.cols);
  const h = Math.min(CROP[1], grid.rows);
  return [Math.max(0, Math.min(grid.cols - w, c + 0.5 - w / 2)), Math.max(0, Math.min(grid.rows - h, r + 0.5 - h / 2)), w, h];
}

export interface FillSpotProps {
  open: boolean;
  onClose: () => void;
  project: Project;
  boxUrl: string;
  /** The spot shown (column, row from the top-left, 0-based). */
  spot: Cell | null;
  /** Another spot picked in the sheet (a tap on the close-up, an arrow, Previous / Next). */
  onSpot: (s: Cell) => void;
  /** What each piece not yet in the puzzle shows (its spots and chances). */
  shown: Map<string, SpotChoice>;
  /** The empty spots of a nearly finished puzzle, or null for the whole picture. */
  spots: Cell[] | null;
  /** Previous / Next go through these (reading order). */
  steps: Cell[];
  /** Pieces not yet in the puzzle (on the table or in trays). */
  pieces: PieceRow[];
  /** Spots already filled with a piece that fits ("c,r"). */
  filled: Set<string>;
  onAnswer: (piece: PieceRow, spot: { col: number; row: number; rot: 0 | 1 | 2 | 3 }, fits: boolean) => void;
  /** A candidate's picture tapped: its piece card, showing this spot. */
  onPickPiece: (piece: PieceRow, spot: { col: number; row: number }) => void;
  /** "Show on my table": these pieces (on the table, best first), pointed out; `spotOf` gives each one's spot here (with its turn), to answer in the live view. */
  onShowOnTable: (ids: string[], spotOf: (id: string) => { col: number; row: number; rot: 0 | 1 | 2 | 3 } | null) => void;
}

export function FillSpot(props: FillSpotProps) {
  const { open, onClose, project, boxUrl, spot, shown, spots, steps, pieces, filled } = props;
  const grid = project.grid!;
  const byId = useMemo(() => new Map(pieces.map((p) => [p.id, p])), [pieces]);
  const cands = useMemo(() => (spot ? candidatesFor(shown, spot[0], spot[1]).filter((c) => byId.has(c.id)) : []), [spot?.[0], spot?.[1], shown, byId]);
  const root = useRef<HTMLDivElement>(null);
  // While the sheet slides up, its buttons take no taps (as the piece card: a quick second tap on the picture
  // must not land on "It fits" sliding past under the finger).
  useLayoutEffect(() => {
    const sheet = root.current?.closest<HTMLElement>('.ui-sheet');
    if (!sheet || !open) return;
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
  }, [open]);

  const best = cands.filter((c) => c.chosen);
  const others = cands.filter((c) => !c.chosen);
  const isFilled = Boolean(spot && filled.has(`${spot[0]},${spot[1]}`));
  const onTable = cands.map((c) => byId.get(c.id)!).filter((p) => p.status === 'table' || p.status === 'pending');
  const rotAt = (id: string): 0 | 1 | 2 | 3 => shown.get(id)?.placement.top.find((t) => spot && t.col === spot[0] && t.row === spot[1])?.rot ?? 0;
  const answer = (c: SpotCandidate, fits: boolean) => spot && props.onAnswer(byId.get(c.id)!, { col: spot[0], row: spot[1], rot: rotAt(c.id) }, fits);
  const pick = (c: SpotCandidate) => spot && props.onPickPiece(byId.get(c.id)!, { col: spot[0], row: spot[1] });
  const move = (dc: number, dr: number) =>
    spot && props.onSpot([Math.max(0, Math.min(grid.cols - 1, spot[0] + dc)), Math.max(0, Math.min(grid.rows - 1, spot[1] + dr))]);
  // Previous / Next: the step before / after this spot in reading order (wrapping round).
  const order = (s: Cell) => s[1] * grid.cols + s[0];
  const step = (dir: 1 | -1) => {
    if (!spot || !steps.length) return;
    const here = order(spot);
    const sorted = steps;
    const next =
      dir === 1 ? (sorted.find((s) => order(s) > here) ?? sorted[0]!) : ([...sorted].reverse().find((s) => order(s) < here) ?? sorted[sorted.length - 1]!);
    props.onSpot(next);
  };
  const stepName = spots ? 'empty spot' : 'spot with a piece waiting';
  const canStep = steps.length > 1 || (steps.length === 1 && spot !== null && order(steps[0]!) !== order(spot));

  const name = spot ? `Column ${spot[0] + 1} · Row ${spot[1] + 1}` : 'A spot';
  const sub = isFilled
    ? 'In the puzzle'
    : !cands.length
      ? 'No scanned piece found for it'
      : best.length
        ? `${best.length === 1 ? sureWords(best[0]!) : `${best.length} pieces`}${others.length ? ` · ${others.length} maybe` : ''}`
        : `${others.length} ${others.length === 1 ? 'piece' : 'pieces'} maybe`;
  const title = (
    <span class="card-head">
      <span class="card-head-text">
        <span class="card-name" data-testid="fill-spot-name">
          {name}
        </span>
        <span class="card-sub" data-testid="fill-spot-sub">
          {sub}
        </span>
      </span>
    </span>
  );

  return (
    <Sheet open={open} onClose={onClose} title={title} testId="fill-sheet">
      <div class="fill-sheet" data-testid="fill-spot" ref={root}>
        {spot && isFilled && (
          <Callout kind="good" icon={<Icon name="check" />} testId="fill-filled">
            This spot is filled: you said a piece fits here.
          </Callout>
        )}
        {spot && !isFilled && !cands.length && (
          <p class="sp-note" data-testid="fill-none">
            {spots
              ? 'No scanned piece fits this spot well. Its piece may not be scanned yet (or is still in the box).'
              : 'No scanned piece has this spot among its best few. Its piece may not be scanned yet, or it looks like several other spots: a photo of the nearly finished puzzle helps most.'}
          </p>
        )}
        {spot && !isFilled && best.length > 0 && (
          <section data-testid="fill-best" class="sp-best">
            {best.map((c) => (
              <Candidate key={c.id} c={c} piece={byId.get(c.id)!} spot={spot} onAnswer={answer} onPick={() => pick(c)} />
            ))}
          </section>
        )}
        {spot && !isFilled && cands.length > 0 && (
          <div class="sp-show">
            <button
              class="btn btn-block"
              data-testid="fill-show"
              disabled={!onTable.length}
              onClick={() =>
                props.onShowOnTable(
                  onTable.map((p) => p.id),
                  (id) => (spot ? { col: spot[0], row: spot[1], rot: rotAt(id) } : null),
                )
              }
            >
              <Icon name="scan-eye" size={20} /> Show on my table
            </button>
            {!onTable.length && (
              <p class="sp-note" data-testid="fill-show-none">
                None of these pieces is on your table now{cands.some((c) => byId.get(c.id)!.status === 'tray') ? ': look in the tray named beside it' : ''}.
              </p>
            )}
          </div>
        )}
        {spot && (
          <div class="sp-place">
            <SpotCrop
              boxUrl={boxUrl}
              grid={grid}
              aspect={project.box ? project.box.width / project.box.height : grid.cols / grid.rows}
              spot={spot}
              onPick={props.onSpot}
            />
            <div class="sp-nav">
              {!spots && (
                <div class="sp-arrows" role="group" aria-label="Move the spot">
                  <button class="btn btn-small" aria-label="Left" onClick={() => move(-1, 0)}>
                    ←
                  </button>
                  <button class="btn btn-small" aria-label="Up" onClick={() => move(0, -1)}>
                    ↑
                  </button>
                  <button class="btn btn-small" aria-label="Down" onClick={() => move(0, 1)}>
                    ↓
                  </button>
                  <button class="btn btn-small" aria-label="Right" onClick={() => move(1, 0)}>
                    →
                  </button>
                </div>
              )}
              {canStep && (
                <div class="sp-steps">
                  <button class="btn btn-small" data-testid="fill-prev" aria-label={`Previous ${stepName}`} onClick={() => step(-1)}>
                    <Icon name="chevron-left" size={20} /> Previous
                  </button>
                  <button class="btn btn-small" data-testid="fill-next" aria-label={`Next ${stepName}`} onClick={() => step(1)}>
                    Next <Icon name="chevron-right" size={20} />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {spot && !isFilled && others.length > 0 && (
          <section data-testid="fill-others" class="sp-others">
            <h3 class="card-section">{best.length ? 'Maybe' : 'Pieces that may go here'}</h3>
            <div class="sp-alts">
              {others.map((c) => (
                <Maybe key={c.id} c={c} piece={byId.get(c.id)!} onPick={() => pick(c)} />
              ))}
            </div>
          </section>
        )}
      </div>
    </Sheet>
  );
}

/** The spot close up, ringed (the rest dimmed); a tap picks the spot tapped. */
function SpotCrop({
  boxUrl,
  grid,
  aspect,
  spot,
  onPick,
}: {
  boxUrl: string;
  grid: { cols: number; rows: number };
  aspect: number;
  spot: Cell;
  onPick: (s: Cell) => void;
}) {
  const v = cropOf(grid, spot);
  const cellAspect = (aspect * grid.rows) / grid.cols;
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const [c, r] = spot;
  return (
    <svg
      class="card-crop fill-box"
      style={{ aspectRatio: String((v[2] * cellAspect) / v[3]) }}
      viewBox={v.map(r3).join(' ')}
      preserveAspectRatio="none"
      data-testid="fill-zoom"
      data-view={v.map(r3).join(' ')}
      role="img"
      aria-label={`The box picture around column ${c + 1}, row ${r + 1}, ringed`}
      onClick={(e) => {
        const b = (e.currentTarget as Element).getBoundingClientRect();
        const x = v[0] + ((e.clientX - b.left) / b.width) * v[2];
        const y = v[1] + ((e.clientY - b.top) / b.height) * v[3];
        onPick([Math.max(0, Math.min(grid.cols - 1, Math.floor(x))), Math.max(0, Math.min(grid.rows - 1, Math.floor(y)))]);
      }}
    >
      <image href={boxUrl} x={0} y={0} width={grid.cols} height={grid.rows} preserveAspectRatio="none" />
      <path class="crop-dim" fill-rule="evenodd" d={`M${r3(v[0])} ${r3(v[1])}h${r3(v[2])}v${r3(v[3])}h${r3(-v[2])}zM${c} ${r}h1v1h-1z`} />
      <rect x={c} y={r} width={1} height={1} class="crop-ring-halo" vector-effect="non-scaling-stroke" />
      <rect x={c} y={r} width={1} height={1} class="crop-ring" vector-effect="non-scaling-stroke" data-testid="fill-zoom-sel" />
    </svg>
  );
}

/** A piece whose best spot this is: its cut-out (opens its card), how sure, and the answer pair. */
function Candidate({
  c,
  piece,
  spot,
  onAnswer,
  onPick,
}: {
  c: SpotCandidate;
  piece: PieceRow;
  spot: Cell;
  onAnswer: (c: SpotCandidate, fits: boolean) => void;
  onPick: () => void;
}) {
  const url = useBlobUrl(piece.thumbBlobId, piece.updatedAt);
  return (
    <div class="sp-cand" data-testid="fill-cand">
      <div class="sp-cand-head">
        <button class="sp-pick" data-testid="fill-cand-pick" aria-label="This piece: its card" onClick={onPick}>
          {url ? <img src={url} alt="" /> : null}
        </button>
        <div class="sp-cand-text">
          <span class="sp-sure">{sureWords(c)}</span>
          <span class="sp-where">
            {piece.status === 'tray' && piece.tray ? (
              <strong>In tray {piece.tray}</strong>
            ) : piece.status === 'pending' ? (
              'On your table (to check)'
            ) : piece.status === 'table' ? (
              'On your table'
            ) : null}
          </span>
          <span class="sp-hint">Tap its picture for its card</span>
        </div>
      </div>
      <div class="card-answer-block" role="group" aria-label={`Did it fit in column ${spot[0] + 1}, row ${spot[1] + 1}?`} data-testid="fill-answer">
        <p class="card-question" aria-hidden="true">
          Did it fit?
        </p>
        {/* "Not there" left, "It fits" right (decision 6); one above the other, "It fits" on top, when they don't fit side by side. */}
        <div class="card-answer">
          <button class="btn card-answer-btn" data-testid="fill-not" onClick={() => onAnswer(c, false)}>
            <Icon name="x" size={22} /> {ANSWER.not}
          </button>
          <button class="btn btn-good btn-fits card-answer-btn" data-testid="fill-fits" onClick={() => onAnswer(c, true)}>
            <Icon name="check" size={22} /> {ANSWER.fits}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Another piece with a chance here: its cut-out and words; a tap opens its card. */
function Maybe({ c, piece, onPick }: { c: SpotCandidate; piece: PieceRow; onPick: () => void }) {
  const url = useBlobUrl(piece.thumbBlobId, piece.updatedAt);
  const words = sureWords(c);
  const tray = piece.status === 'tray' && piece.tray ? `In tray ${piece.tray}` : null;
  const elsewhere = c.best ? `Best: ${c.best.col + 1} · ${c.best.row + 1}` : null;
  return (
    <button
      class="card-alt sp-alt"
      data-testid="fill-cand"
      aria-label={[`A piece: ${words}`, tray, elsewhere && `its best spot column ${c.best!.col + 1}, row ${c.best!.row + 1}`, 'its card']
        .filter(Boolean)
        .join('; ')}
      onClick={onPick}
    >
      <span class="sp-alt-pic" data-testid="fill-cand-pick">
        {url ? <img src={url} alt="" /> : null}
      </span>
      <span class="card-alt-sure">{words}</span>
      {tray && <strong class="sp-alt-meta">{tray}</strong>}
      {elsewhere && <span class="sp-alt-meta">{elsewhere}</span>}
    </button>
  );
}
