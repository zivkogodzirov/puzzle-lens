/**
 * "Which pieces join" (M6, the Matches screen of PLAN §5, with "What next"), on its own page from the puzzle's
 * Pieces tab (#/joins/<id>, M9 part 4: it opened inline before):
 * pairs of pieces that probably join, from where each piece goes on the box picture
 * (src/project/pairs.ts), most likely first. Squares of four pieces whose pairs all agree are marked
 * ✓. Each pair shows the two pieces as photographed and their two spots on the box picture; the
 * owner can have them pointed out on the table (live view) and say whether they fit.
 */
import { useMemo, useState } from 'preact/hooks';
import type { PairModel, PairSuggestion, BlockSuggestion } from '../../project/pairs';
import { blockSuggestions, confirmedPairs, pairKey, pairSuggestions, PAIRS } from '../../project/pairs';
import type { PairAnswerView } from '../../project/pairAnswers';
import type { PieceRow, Project } from '../../project/types';
import { useBlobUrl } from '../screens/puzzle/shared';
import { Icon } from '../ui/icons';
import { toast } from '../ui/toast';
import { settings } from '../settings';
import { ANSWER, CONFIDENCE_WORDS } from '../words';

/** Pairs listed at most (the rest are counted). */
const SHOW_MAX = 12;
const pct = (p: number): number => Math.min(99, Math.round(p * 100));

/**
 * How sure a pair is, in words (decision 7): pairs at 70 % or more join 97–100 % of the time (the evidence
 * under PAIRS.blockMinP, src/project/pairs.ts); below that, "Maybe". The % follows only in Tester mode.
 */
export function pairWords(p: number): string {
  const w = p >= 0.7 ? CONFIDENCE_WORDS.strong : CONFIDENCE_WORDS.likely;
  return settings.testerMode.value ? `${w}, ${pct(p)} %` : w;
}

/** The part of the picture a BoxCrop shows: [x, y, width, height] in cells. */
export function cropView(grid: { cols: number; rows: number }, cells: Array<[number, number]>, around?: [number, number]): [number, number, number, number] {
  if (around) {
    const w = Math.min(around[0], grid.cols);
    const h = Math.min(around[1], grid.rows);
    const cx = cells.reduce((s, c) => s + c[0] + 0.5, 0) / cells.length;
    const cy = cells.reduce((s, c) => s + c[1] + 0.5, 0) / cells.length;
    return [Math.max(0, Math.min(grid.cols - w, cx - w / 2)), Math.max(0, Math.min(grid.rows - h, cy - h / 2)), w, h];
  }
  const c0 = Math.max(0, Math.min(...cells.map((c) => c[0])) - 1);
  const r0 = Math.max(0, Math.min(...cells.map((c) => c[1])) - 1);
  const c1 = Math.min(grid.cols, Math.max(...cells.map((c) => c[0])) + 2);
  const r1 = Math.min(grid.rows, Math.max(...cells.map((c) => c[1])) + 2);
  return [c0, r0, c1 - c0, r1 - r0];
}

export interface MatchList {
  /** Pairs to suggest, not yet answered, most likely first. */
  pairs: PairSuggestion[];
  /** Closed squares of 4 among all likely pairs (answered ones included), with at least one pair not yet joined. */
  blocks: BlockSuggestion[];
  /** Pairs that are part of a closed square (pairKey). */
  confirmed: Set<string>;
  /** The one thing to do next: a square, or the most likely pair. */
  next: { kind: 'block'; block: BlockSuggestion } | { kind: 'pair'; pair: PairSuggestion } | null;
}

/** What the panel shows, from the pair model and the owner's answers. */
export function matchList(model: PairModel, answers: PairAnswerView, onTable: Set<string>): MatchList {
  const likely = pairSuggestions(model).filter((s) => onTable.has(s.a) && onTable.has(s.b));
  const minBlock = PAIRS.blockMinP[model.mode];
  const blocks = blockSuggestions(likely, minBlock).filter((b) => {
    const [tl, tr, bl, br] = b.ids;
    return [pairKey(tl, tr, 1), pairKey(bl, br, 1), pairKey(tl, bl, 2), pairKey(tr, br, 2)].some((k) => !answers.joined.has(k));
  });
  const confirmed = confirmedPairs(blockSuggestions(likely, minBlock));
  const pairs = likely.filter((s) => !answers.joined.has(pairKey(s.a, s.b, s.dir)));
  // Next: a confirmed square if one is about as likely as the best pair, else the best pair.
  const best = pairs[0];
  const next =
    blocks[0] && (!best || blocks[0].p >= best.p - 0.1) ? { kind: 'block' as const, block: blocks[0] } : best ? { kind: 'pair' as const, pair: best } : null;
  return { pairs, blocks, confirmed, next };
}

function Thumb({ piece, label }: { piece: PieceRow | undefined; label: string }) {
  const url = useBlobUrl(piece?.thumbBlobId, piece?.updatedAt);
  return url ? <img src={url} class="match-thumb" alt={label} title={label} /> : <span class="match-thumb catalog-empty" title={label} />;
}

/**
 * Spots on the box picture, close up: by default the cells with one cell of margin (the pairs and squares
 * here). `around` [across, down]: that many cells instead, centred on the spots and kept inside the picture
 * (the piece card's zoomed spot, M9 part 3); `dim`: everything but the spots darkened, the spots ringed.
 */
export function BoxCrop({
  boxUrl,
  project,
  cells,
  testId,
  around,
  dim = false,
  class: cls = 'match-box',
  label,
}: {
  boxUrl: string;
  project: Project;
  cells: Array<[number, number]>;
  testId: string;
  around?: [number, number];
  dim?: boolean;
  class?: string;
  /** What it shows, for VoiceOver (without it, it is left out for VoiceOver: a picture beside its own words). */
  label?: string;
}) {
  const grid = project.grid!;
  const aspect = project.box ? project.box.width / project.box.height : grid.cols / grid.rows;
  const cellAspect = (aspect * grid.rows) / grid.cols;
  const v = cropView(grid, cells, around);
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return (
    <svg
      class={cls}
      style={{ aspectRatio: String((v[2] * cellAspect) / v[3]) }}
      viewBox={v.map(r3).join(' ')}
      preserveAspectRatio="none"
      data-testid={testId}
      data-cells={cells.map(([c, r]) => `${c},${r}`).join(' ')}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
    >
      <image href={boxUrl} x={0} y={0} width={grid.cols} height={grid.rows} preserveAspectRatio="none" />
      {dim && (
        <path
          class="crop-dim"
          fill-rule="evenodd"
          d={`M${r3(v[0])} ${r3(v[1])}h${r3(v[2])}v${r3(v[3])}h${r3(-v[2])}z${cells.map(([c, r]) => `M${c} ${r}h1v1h-1z`).join('')}`}
        />
      )}
      {cells.map(([c, r]) =>
        dim ? (
          <g key={`${c},${r}`}>
            <rect x={c} y={r} width={1} height={1} class="crop-ring-halo" vector-effect="non-scaling-stroke" />
            <rect x={c} y={r} width={1} height={1} class="crop-ring" vector-effect="non-scaling-stroke" data-testid={`${testId}-cell`} />
          </g>
        ) : (
          <rect key={`${c},${r}`} x={c} y={r} width={1} height={1} class="spot-best" vector-effect="non-scaling-stroke" />
        ),
      )}
    </svg>
  );
}

const DIR_WORDS = { 1: 'side by side', 2: 'one above the other' } as const;

function PairCard({
  s,
  byId,
  project,
  boxUrl,
  confirmed,
  next,
  onFind,
  onAnswer,
}: {
  s: PairSuggestion;
  byId: Map<string, PieceRow>;
  project: Project;
  boxUrl: string | null;
  confirmed: boolean;
  next?: boolean;
  onFind: (ids: string[]) => void;
  onAnswer: (s: PairSuggestion, fits: boolean) => void;
}) {
  const bCell: [number, number] = s.dir === 1 ? [s.col + 1, s.row] : [s.col, s.row + 1];
  return (
    <div class={`card match-card${next ? ' match-next' : ''}`} data-testid={next ? 'match-next' : 'match-pair'} data-pair={pairKey(s.a, s.b, s.dir)}>
      {next && <p class="match-next-title">What next</p>}
      <div class="row match-row">
        <div class={`match-pieces match-dir-${s.dir}`}>
          <Thumb piece={byId.get(s.a)} label={s.dir === 1 ? 'Left piece' : 'Top piece'} />
          <Thumb piece={byId.get(s.b)} label={s.dir === 1 ? 'Right piece' : 'Bottom piece'} />
        </div>
        {boxUrl && project.grid && <BoxCrop boxUrl={boxUrl} project={project} cells={[[s.col, s.row], bCell]} testId="match-box" />}
        <div class="grow small">
          <p>
            <strong>These two join</strong> ({DIR_WORDS[s.dir]}, as on the box) · <span class="nw">{pairWords(s.p)}</span>
            {confirmed && (
              <span class="match-ok nw" title="Part of a square of 4 pieces that all join" data-testid="match-confirmed">
                {' '}
                <Icon name="check" size={16} class="inline-icon" /> square
              </span>
            )}
          </p>
          <p class="muted">
            Column {s.col + 1}
            {s.dir === 1 ? `–${s.col + 2}` : ''}, row {s.row + 1}
            {s.dir === 2 ? `–${s.row + 2}` : ''}
            {s.shape === 'fits' ? ' · knob and hole match' : ''}
          </p>
        </div>
      </div>
      <div class="row match-buttons">
        <button class="btn btn-small" data-testid="match-find" onClick={() => onFind([s.a, s.b])}>
          <Icon name="scan-eye" size={20} /> Point them out
        </button>
        {/* "Not there" left, "They fit" right, as in iPhone alerts (decision 6). */}
        <button class="btn btn-small" data-testid="match-not" onClick={() => onAnswer(s, false)}>
          <Icon name="x" size={20} /> {ANSWER.not}
        </button>
        <button class="btn btn-small btn-fits btn-good" data-testid="match-fits" onClick={() => onAnswer(s, true)}>
          <Icon name="check" size={20} /> {ANSWER.groupFits}
        </button>
      </div>
    </div>
  );
}

function BlockCard({
  b,
  byId,
  project,
  boxUrl,
  next,
  onFind,
  onAnswerAll,
}: {
  b: BlockSuggestion;
  byId: Map<string, PieceRow>;
  project: Project;
  boxUrl: string | null;
  next?: boolean;
  onFind: (ids: string[]) => void;
  onAnswerAll: (b: BlockSuggestion) => void;
}) {
  return (
    <div class={`card match-card${next ? ' match-next' : ''}`} data-testid={next ? 'match-next' : 'match-block'}>
      {next && <p class="match-next-title">What next</p>}
      <div class="row match-row">
        <div class="match-square">
          {b.ids.map((id, i) => (
            <Thumb key={id} piece={byId.get(id)} label={['Top left', 'Top right', 'Bottom left', 'Bottom right'][i]!} />
          ))}
        </div>
        {boxUrl && project.grid && (
          <BoxCrop
            boxUrl={boxUrl}
            project={project}
            cells={[
              [b.col, b.row],
              [b.col + 1, b.row],
              [b.col, b.row + 1],
              [b.col + 1, b.row + 1],
            ]}
            testId="match-block-box"
          />
        )}
        <div class="grow small">
          <p>
            <strong>
              A square of 4 <Icon name="check" size={16} class="inline-icon" label="all four pairs agree" />
            </strong>{' '}
            · <span class="nw">{pairWords(b.p)}</span>
          </p>
          <p class="muted">
            All four pairs agree: columns {b.col + 1}–{b.col + 2}, rows {b.row + 1}–{b.row + 2}.
          </p>
        </div>
      </div>
      <div class="row match-buttons">
        <button class="btn btn-small" data-testid="match-find" onClick={() => onFind([...b.ids])}>
          <Icon name="scan-eye" size={20} /> Point them out
        </button>
        <button class="btn btn-small btn-fits btn-good" data-testid="match-block-fits" onClick={() => onAnswerAll(b)}>
          <Icon name="check" size={20} /> {ANSWER.groupFits}
        </button>
      </div>
      <p class="muted small">If one of them isn’t right, answer its pair below.</p>
    </div>
  );
}

export function MatchesPanel({
  project,
  boxUrl,
  list,
  pieces,
  joined,
  onFind,
  onAnswer,
  onUndo,
}: {
  project: Project;
  boxUrl: string | null;
  list: MatchList;
  /** The pieces (for thumbnails). */
  pieces: PieceRow[];
  /** Pairs the owner joined (pairKey → pieces). */
  joined: Array<{ key: string; a: string; b: string }>;
  onFind: (ids: string[], pairs: Array<[string, string]>) => void;
  onAnswer: (pairs: PairSuggestion[], fits: boolean, confirmed: boolean) => Promise<void>;
  onUndo: (keys: string[]) => Promise<void>;
}) {
  const byId = useMemo(() => new Map(pieces.map((p) => [p.id, p])), [pieces]);
  const [joinedOpen, setJoinedOpen] = useState(false);
  const { pairs, blocks, confirmed, next } = list;
  // Each answer: a toast with Undo (M9 part 2; was a note with Undo and OK in the panel).
  const answer = (ss: PairSuggestion[], fits: boolean, conf: boolean) =>
    void onAnswer(ss, fits, conf).then(() => {
      const keys = ss.map((s) => pairKey(s.a, s.b, s.dir));
      toast({
        text: fits ? (ss.length > 1 ? 'Noted: the 4 pieces are joined.' : 'Noted: joined.') : 'Noted: that pair isn’t suggested again.',
        action: { label: 'Undo', run: () => void onUndo(keys) },
      });
    });
  const blockPairs = (b: BlockSuggestion): PairSuggestion[] => {
    const [tl, tr, bl, br] = b.ids;
    const all = [...pairs];
    const find = (a: string, bb: string, dir: 1 | 2) => all.find((s) => s.a === a && s.b === bb && s.dir === dir);
    return [find(tl, tr, 1), find(bl, br, 1), find(tl, bl, 2), find(tr, br, 2)].filter((s): s is PairSuggestion => Boolean(s));
  };
  const find = (ids: string[], ps: Array<[string, string]>) => onFind(ids, ps);
  const shownPairs = pairs.filter((s) => !(next?.kind === 'pair' && next.pair === s)).slice(0, SHOW_MAX);
  return (
    <div class="matches" data-testid="matches">
      <p class="muted small">
        From where each piece goes on the box picture: two pieces whose spots are next to each other probably join. The shapes only rule out pairs that can't
        fit. <Icon name="check" size={16} class="inline-icon" /> square = four pieces whose pairs all agree.
      </p>
      {!next && (
        <p class="small" data-testid="match-none">
          No likely pairs yet. Pairs show up when two pieces' spots on the box picture are next to each other: scan more pieces (or a close-up of pieces whose
          spot isn't sure).
        </p>
      )}
      {next?.kind === 'block' && (
        <BlockCard
          b={next.block}
          byId={byId}
          project={project}
          boxUrl={boxUrl}
          next
          onFind={(ids) => find(ids, blockLines(next.block))}
          onAnswerAll={(b) => answer(blockPairs(b), true, true)}
        />
      )}
      {next?.kind === 'pair' && (
        <PairCard
          s={next.pair}
          byId={byId}
          project={project}
          boxUrl={boxUrl}
          confirmed={confirmed.has(pairKey(next.pair.a, next.pair.b, next.pair.dir))}
          next
          onFind={(ids) => find(ids, [[next.pair.a, next.pair.b]])}
          onAnswer={(s, fits) => answer([s], fits, confirmed.has(pairKey(s.a, s.b, s.dir)))}
        />
      )}
      {blocks.length > (next?.kind === 'block' ? 1 : 0) && (
        <>
          <h3>Squares of 4</h3>
          {blocks.slice(next?.kind === 'block' ? 1 : 0, 4).map((b) => (
            <BlockCard
              key={b.ids.join('|')}
              b={b}
              byId={byId}
              project={project}
              boxUrl={boxUrl}
              onFind={(ids) => find(ids, blockLines(b))}
              onAnswerAll={(bb) => answer(blockPairs(bb), true, true)}
            />
          ))}
        </>
      )}
      {shownPairs.length > 0 && (
        <>
          <h3>Pairs</h3>
          {shownPairs.map((s) => (
            <PairCard
              key={pairKey(s.a, s.b, s.dir)}
              s={s}
              byId={byId}
              project={project}
              boxUrl={boxUrl}
              confirmed={confirmed.has(pairKey(s.a, s.b, s.dir))}
              onFind={(ids) => find(ids, [[s.a, s.b]])}
              onAnswer={(ss, fits) => answer([ss], fits, confirmed.has(pairKey(ss.a, ss.b, ss.dir)))}
            />
          ))}
          {pairs.length - (next?.kind === 'pair' ? 1 : 0) > shownPairs.length && (
            <p class="muted small">…and {pairs.length - (next?.kind === 'pair' ? 1 : 0) - shownPairs.length} less likely pairs.</p>
          )}
        </>
      )}
      {joined.length > 0 && (
        <p class="small">
          <button class="link-btn" data-testid="match-joined" aria-expanded={joinedOpen} onClick={() => setJoinedOpen(!joinedOpen)}>
            <Icon name="check" size={18} class="inline-icon" /> {joined.length} pair{joined.length === 1 ? '' : 's'} joined
          </button>
        </p>
      )}
      {joinedOpen &&
        joined.map((j) => (
          <div class="row match-joined" key={j.key} data-testid="match-joined-row">
            <Thumb piece={byId.get(j.a)} label="A piece" />
            <Thumb piece={byId.get(j.b)} label="Its partner" />
            <span class="grow" />
            <button class="btn btn-small" data-testid="match-unjoin" onClick={() => void onUndo([j.key])}>
              Take back
            </button>
          </div>
        ))}
    </div>
  );
}

/** The four joins of a square, for lines on the table. */
function blockLines(b: BlockSuggestion): Array<[string, string]> {
  const [tl, tr, bl, br] = b.ids;
  return [
    [tl, tr],
    [bl, br],
    [tl, bl],
    [tr, br],
  ];
}
