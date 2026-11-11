/**
 * "Fill this spot" on the puzzle page (M4): tap a spot on the box picture (among the empty spots of
 * a nearly finished puzzle, the nearest one; on the whole picture, then precisely in a close-up of
 * that area) and see the pieces that may go there with their chances, lit up on your table photo.
 */
import { useMemo, useState } from 'preact/hooks';
import { settings } from '../settings';
import type { SpotChoice } from '../../cv/openSpots';
import { candidatesFor, nearestSpot, type SpotCandidate } from '../../project/fillSpot';
import type { PieceRow, Project } from '../../project/types';
import { useBlobUrl } from '../screens/Puzzle';
import { TablePhoto } from './Trays';
import { LiveTable } from './LiveTable';
import { OV } from '../tokens';
import { Icon } from '../ui/icons';
import { Callout } from '../ui/Callout';
import { ANSWER, CONFIDENCE_WORDS } from '../words';

/** Cells across the close-up. */
const ZOOM = 9;
const BEST: string = OV.good;
const OTHER: string = OV.weak;
const pct = (p: number): number => Math.min(99, Math.round(p * 100));

/**
 * How sure the app is that a piece goes in this spot, in words (decision 7): its own verdict when this is
 * its spot, else "Maybe"; the % after the word only in Tester mode.
 */
function sureWords(c: SpotCandidate): string {
  const w = c.chosen ? CONFIDENCE_WORDS[c.verdict] : CONFIDENCE_WORDS.likely;
  return settings.testerMode.value ? `${w}, ${pct(c.p)} %` : w;
}

/** Where a tap landed, in cells of the picture (fractional). */
function cellAt(e: MouseEvent, view: [number, number, number, number]): [number, number] {
  const r = (e.currentTarget as Element).getBoundingClientRect();
  return [view[0] + ((e.clientX - r.left) / r.width) * view[2], view[1] + ((e.clientY - r.top) / r.height) * view[3]];
}

export function FillSpot({
  project,
  boxUrl,
  shown,
  spots,
  pieces,
  onAnswer,
  onUndo,
  onLiveClosed,
  filled,
  onPickPiece,
}: {
  /** A candidate's picture tapped (M9 part 3): its piece card, showing this spot. */
  onPickPiece?: (piece: PieceRow, spot: { col: number; row: number }) => void;
  project: Project;
  boxUrl: string;
  /** What each piece not yet in the puzzle shows (its spots and chances). */
  shown: Map<string, SpotChoice>;
  /** The empty spots of a nearly finished puzzle, or null for the whole picture. */
  spots: Array<[number, number]> | null;
  /** Pieces not yet in the puzzle (on the table or in trays). */
  pieces: PieceRow[];
  /** Fits / Doesn't fit (M5 part 2) for a piece at the chosen spot. */
  onAnswer?: (piece: PieceRow, spot: { col: number; row: number; rot: 0 | 1 | 2 | 3 }, fits: boolean) => void;
  /** Undo right after an answer in the live view (M9 part 1). */
  onUndo?: (piece: PieceRow, fits: boolean) => Promise<void>;
  /** Its live view ("Find it live") closed (M9 part 2: the page shows the toast for a ✓ Fits given there now). */
  onLiveClosed?: () => void;
  /** Spots already filled with a piece that fits ("c,r"). */
  filled?: Set<string>;
}) {
  const grid = project.grid!;
  const [sel, setSel] = useState<[number, number] | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [photo, setPhoto] = useState(false);
  const [live, setLive] = useState(false);
  const aspect = project.box ? project.box.width / project.box.height : grid.cols / grid.rows;
  const cellAspect = (aspect * grid.rows) / grid.cols;
  const byId = useMemo(() => new Map(pieces.map((p) => [p.id, p])), [pieces]);
  const cands = useMemo(() => (sel ? candidatesFor(shown, sel[0], sel[1]).filter((c) => byId.has(c.id)) : []), [sel, shown, byId]);

  const pick = (x: number, y: number) => {
    if (spots) {
      const s = nearestSpot(spots, x, y);
      if (!s) return setHint('Tap one of the empty spots (the light squares).');
      setHint(null);
      return setSel(s);
    }
    setHint(null);
    setSel([Math.max(0, Math.min(grid.cols - 1, Math.floor(x))), Math.max(0, Math.min(grid.rows - 1, Math.floor(y)))]);
  };
  const move = (dc: number, dr: number) =>
    sel && setSel([Math.max(0, Math.min(grid.cols - 1, sel[0] + dc)), Math.max(0, Math.min(grid.rows - 1, sel[1] + dr))]);

  const full: [number, number, number, number] = [0, 0, grid.cols, grid.rows];
  const zw = Math.min(ZOOM, grid.cols);
  const zh = Math.min(ZOOM, grid.rows);
  const zoom: [number, number, number, number] | null = sel
    ? [Math.max(0, Math.min(grid.cols - zw, sel[0] + 0.5 - zw / 2)), Math.max(0, Math.min(grid.rows - zh, sel[1] + 0.5 - zh / 2)), zw, zh]
    : null;
  const lines = (v: [number, number, number, number]) => {
    const out = [];
    for (let c = Math.ceil(v[0]); c <= v[0] + v[2]; c++)
      out.push(<line key={`c${c}`} x1={c} y1={v[1]} x2={c} y2={v[1] + v[3]} class="fill-grid" vector-effect="non-scaling-stroke" />);
    for (let r = Math.ceil(v[1]); r <= v[1] + v[3]; r++)
      out.push(<line key={`r${r}`} x1={v[0]} y1={r} x2={v[0] + v[2]} y2={r} class="fill-grid" vector-effect="non-scaling-stroke" />);
    return out;
  };
  const picture = (v: [number, number, number, number], testId: string, withGrid: boolean) => (
    <svg
      class="spot-box fill-box"
      style={{ aspectRatio: String((v[2] * cellAspect) / v[3]) }}
      viewBox={v.join(' ')}
      preserveAspectRatio="none"
      data-testid={testId}
      onClick={(e) => pick(...cellAt(e as unknown as MouseEvent, v))}
    >
      <image href={boxUrl} x={0} y={0} width={grid.cols} height={grid.rows} preserveAspectRatio="none" />
      {withGrid && lines(v)}
      {spots?.map(([c, r]) => (
        <rect key={`o${c},${r}`} x={c} y={r} width={1} height={1} class="spot-open" vector-effect="non-scaling-stroke" />
      ))}
      {[...(filled ?? [])].map((k) => {
        const [c, r] = k.split(',').map(Number) as [number, number];
        return <rect key={`f${k}`} x={c} y={r} width={1} height={1} class="spot-filled" data-testid="spot-filled" />;
      })}
      {sel && <rect x={sel[0]} y={sel[1]} width={1} height={1} class="spot-best" vector-effect="non-scaling-stroke" data-testid={`${testId}-sel`} />}
    </svg>
  );
  const best = cands.find((c) => c.chosen) ?? null;
  const others = cands.filter((c) => c !== best);
  const onTable = cands.map((c) => byId.get(c.id)!).filter((p) => p.status === 'table' || p.status === 'pending');
  const rotAt = (id: string): 0 | 1 | 2 | 3 => shown.get(id)?.placement.top.find((t) => sel && t.col === sel[0] && t.row === sel[1])?.rot ?? 0;
  const answer =
    onAnswer && sel ? (c: SpotCandidate, fits: boolean) => onAnswer(byId.get(c.id)!, { col: sel[0], row: sel[1], rot: rotAt(c.id) }, fits) : undefined;
  const isFilled = Boolean(sel && filled?.has(`${sel[0]},${sel[1]}`));
  const pickOf = (c: SpotCandidate) => (onPickPiece && sel ? () => onPickPiece(byId.get(c.id)!, { col: sel[0], row: sel[1] }) : undefined);
  return (
    <div class="card fill-spot" data-testid="fill-spot">
      <p class="small">
        {spots
          ? 'Tap an empty spot (light square) on the box picture: the pieces that may go there show below.'
          : 'Tap the spot on the box picture, then tap it exactly in the close-up: the pieces that may go there show below.'}
      </p>
      {picture(full, 'fill-picture', false)}
      {hint && (
        <Callout kind="warn" icon={<Icon name="alert-triangle" />} testId="fill-hint">
          {hint}
        </Callout>
      )}
      {sel && zoom && (
        <>
          <p data-testid="fill-spot-name">
            <strong>
              Column {sel[0] + 1}, row {sel[1] + 1}
            </strong>
            <span class="muted small"> (counted from the top-left corner)</span>
          </p>
          {picture(zoom, 'fill-zoom', true)}
          {!spots && (
            <div class="row fill-arrows" role="group" aria-label="Move the spot">
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
          {isFilled ? (
            <Callout kind="good" icon={<Icon name="check" />} testId="fill-filled">
              This spot is filled: you said a piece fits here.
            </Callout>
          ) : !cands.length ? (
            <p class="small" data-testid="fill-none">
              {spots
                ? 'No scanned piece fits this spot well. Its piece may not be scanned yet (or is still in the box).'
                : 'No scanned piece has this spot among its best few. Its piece may not be scanned yet, or it looks like several other spots: an empty-spots photo of the nearly finished puzzle helps most.'}
            </p>
          ) : (
            <>
              {best ? (
                <div data-testid="fill-best">
                  <p class="small">
                    <strong>{spots ? 'The piece for this spot:' : 'Pieces whose best spot this is:'}</strong>
                  </p>
                  <div class="fill-cands">
                    {cands
                      .filter((c) => c.chosen)
                      .map((c) => (
                        <Candidate key={c.id} c={c} piece={byId.get(c.id)!} colour={BEST} onAnswer={answer} onPick={pickOf(c)} />
                      ))}
                  </div>
                </div>
              ) : null}
              {others.filter((c) => !c.chosen).length > 0 && (
                <div data-testid="fill-others">
                  <p class="small">
                    <strong>{best ? 'Also possible:' : 'Possible pieces:'}</strong>
                  </p>
                  <div class="fill-cands">
                    {others
                      .filter((c) => !c.chosen)
                      .map((c) => (
                        <Candidate key={c.id} c={c} piece={byId.get(c.id)!} colour={OTHER} onAnswer={answer} onPick={pickOf(c)} />
                      ))}
                  </div>
                </div>
              )}
              <button class="btn btn-block" data-testid="fill-photo" disabled={!onTable.length} onClick={() => setPhoto(true)}>
                <Icon name="map" size={20} /> Show on my table photo
              </button>
              <button class="btn btn-block" data-testid="fill-live" disabled={!onTable.length} onClick={() => setLive(true)}>
                <Icon name="scan-eye" size={20} /> Find it live
              </button>
            </>
          )}
        </>
      )}
      {live && sel && (
        <LiveTable
          projectId={project.id}
          pieces={onTable}
          colourOf={(p) => (cands.find((c) => c.id === p.id)?.chosen ? BEST : OTHER)}
          infoOf={(p) => {
            const c = cands.find((q) => q.id === p.id);
            if (!c) return 'A possible piece.';
            return `${sureWords(c)} for column ${sel[0] + 1}, row ${sel[1] + 1}.`;
          }}
          find={onTable.map((p) => p.id)}
          answer={
            onAnswer
              ? {
                  labelOf: () => `column ${sel[0] + 1}, row ${sel[1] + 1}`,
                  onAnswer: (p, fits) => onAnswer(p, { col: sel[0], row: sel[1], rot: rotAt(p.id) }, fits),
                  onUndo,
                }
              : undefined
          }
          title={`Pieces for column ${sel[0] + 1}, row ${sel[1] + 1}`}
          legend={<>Green: the best piece for this spot; yellow: also possible.</>}
          onClose={() => {
            setLive(false);
            onLiveClosed?.();
          }}
        />
      )}
      {photo && sel && (
        <TablePhoto
          projectId={project.id}
          pieces={onTable}
          colour={OTHER}
          colourOf={(p) => (cands.find((c) => c.id === p.id)?.chosen ? BEST : OTHER)}
          title={`Column ${sel[0] + 1}, row ${sel[1] + 1}`}
          onClose={() => setPhoto(false)}
        />
      )}
    </div>
  );
}

function Candidate({
  c,
  piece,
  colour,
  onAnswer,
  onPick,
}: {
  c: SpotCandidate;
  piece: PieceRow;
  colour: string;
  onAnswer?: (c: SpotCandidate, fits: boolean) => void;
  /** Its picture tapped: the piece card (M9 part 3). */
  onPick?: () => void;
}) {
  const url = useBlobUrl(piece.thumbBlobId, piece.updatedAt);
  const picture = url ? <img src={url} alt={onPick ? '' : 'A piece'} /> : <div class="catalog-empty" />;
  return (
    <div class={`fill-cand ${colour === BEST ? 'fill-cand-best' : 'fill-cand-other'}`} data-testid="fill-cand">
      {onPick ? (
        <button class="fill-cand-pick" data-testid="fill-cand-pick" aria-label="This piece: where it goes" onClick={onPick}>
          {picture}
        </button>
      ) : (
        picture
      )}
      <div class="small">
        {sureWords(c)}
        {piece.status === 'tray' && piece.tray ? <strong> · in tray {piece.tray}</strong> : null}
      </div>
      {c.best && (
        <div class="muted small">
          Best: col. {c.best.col + 1}, row {c.best.row + 1}
        </div>
      )}
      {onAnswer && (
        <div class="fill-answer">
          {/* "Not there" left, "It fits" right (decision 6); stacked, "It fits" on top, when they don't fit side by side. */}
          <button class="btn btn-small" data-testid="fill-not" onClick={() => onAnswer(c, false)}>
            <Icon name="x" size={20} /> {ANSWER.not}
          </button>
          <button class="btn btn-small btn-fits btn-good" data-testid="fill-fits" onClick={() => onAnswer(c, true)}>
            <Icon name="check" size={20} /> {ANSWER.fits}
          </button>
        </div>
      )}
    </div>
  );
}
