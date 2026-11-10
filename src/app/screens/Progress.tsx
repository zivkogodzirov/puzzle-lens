/**
 * Progress (M7 part 2, PLAN §5 "Progress"): how much of the puzzle is done, on the box picture
 * (bright = in the puzzle, a yellow dot = its piece is on the table or in a tray, dark = still to
 * find), totals per status and per shape group, how often the app has been right, and the batch.
 * `#/progress/<puzzle id>`.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { TopBar } from '../components/TopBar';
import { routeArg } from '../router';
import { getProject } from '../../project/store';
import { db } from '../../db/db';
import { placeKeyOf, readPlacements, shownPlacements, unplacedStatus, type PlacementCache } from '../../project/placements';
import { accuracyOf, answerView, placedPieces } from '../../project/answers';
import { pairAccuracyOf } from '../../project/pairAnswers';
import { batchNumber } from '../../project/batches';
import { puzzleProgress } from '../../project/progress';
import type { PieceRow, Project } from '../../project/types';
import { borderCounts, boxVersion, pieceGroup, useBlobUrl } from './Puzzle';
import { logError } from '../../log/logger';

const pc = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);

export function ProgressScreen() {
  const id = routeArg.value;
  const [data, setData] = useState<{ project: Project; pieces: PieceRow[]; cache: PlacementCache | null } | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void (async () => {
      const project = id ? await getProject(id) : undefined;
      if (!project) {
        if (live) setData(null);
        return;
      }
      const pieces = await db().pieces.where('projectId').equals(project.id).toArray();
      const cached = await readPlacements(project.id);
      const key = placeKeyOf(project);
      if (live) setData({ project, pieces, cache: cached && key && cached.boxKey === key ? cached : null });
    })().catch((err) => {
      logError('progress', 'Progress could not be read', err);
      if (live) setData(null);
    });
    return () => {
      live = false;
    };
  }, [id]);
  const project = data?.project;
  const boxUrl = useBlobUrl(project?.box?.rectifiedBlobId, boxVersion(project?.box));
  const view = useMemo(() => {
    if (!data?.project.grid) return null;
    const { project: p, pieces, cache } = data;
    const answers = { view: answerView(p), placed: placedPieces(pieces) };
    const shown = shownPlacements(cache, pieces.filter(unplacedStatus), answers);
    const prog = puzzleProgress({
      grid: p.grid!,
      pieces,
      shown,
      open: cache?.open?.cells.length ? cache.open.cells : null,
      gapCount: !cache?.open?.cells.length && p.openSpots ? p.openSpots.gaps.length : null,
      taken: new Set(answers.view.taken.keys()),
      finished: Boolean(p.finishedAt && !p.openSpots),
    });
    // Shape groups of the pieces not in the puzzle yet.
    const cell: [number, number] | null = p.piecePitch ? [p.piecePitch.wMm, p.piecePitch.hMm] : null;
    const groups = { corner: 0, edge: 0, interior: 0, unsure: 0 };
    for (const q of pieces) if (q.status === 'table' || q.status === 'tray' || q.status === 'pending') groups[pieceGroup(q, cell)]++;
    return { prog, groups, acc: accuracyOf(p.answers ?? []), pairs: pairAccuracyOf(p.pairAnswers ?? []) };
  }, [data]);

  if (data === undefined)
    return (
      <main class="screen">
        <TopBar title="Progress" />
        <p class="muted">Loading…</p>
      </main>
    );
  if (!data || !project)
    return (
      <main class="screen">
        <TopBar title="Progress" />
        <p class="muted">This puzzle is no longer on this iPhone.</p>
      </main>
    );
  const back = (
    <a class="btn btn-small" href={`#/puzzle/${encodeURIComponent(project.id)}`}>
      ‹ Back to the puzzle
    </a>
  );
  if (!project.grid || !view)
    return (
      <main class="screen" data-testid="progress-page">
        <TopBar title="Progress" />
        {back}
        <p class="muted">Progress shows once the puzzle has its grid (set-up).</p>
      </main>
    );
  const { prog, groups, acc, pairs } = view;
  const grid = project.grid;
  const s = prog.status;
  const want = borderCounts(grid);
  const aspect = project.box ? project.box.width / project.box.height : grid.cols / grid.rows;
  // Dark over the spots not done; a dot on spots whose piece is known.
  let dark = '';
  const dots: Array<[number, number]> = [];
  for (let r = 0; r < grid.rows; r++)
    for (let c = 0; c < grid.cols; c++) {
      const v = prog.cellState[r * grid.cols + c]!;
      if (v !== 1) dark += `M${c} ${r}h1v1h-1z`;
      if (v === 2) dots.push([c, r]);
    }
  const left = prog.cells - prog.done;
  return (
    <main class="screen" data-testid="progress-page">
      <TopBar title="Progress" />
      {back}
      <h2>{project.name}</h2>
      <div class="card" data-testid="progress-done">
        <p class="progress-big">
          <strong>{prog.done}</strong> of {prog.cells} pieces in the puzzle <span class="nw">({pc(prog.done, prog.cells)} %)</span>
        </p>
        <div class="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={prog.cells} aria-valuenow={prog.done}>
          <span style={{ width: `${(100 * prog.done) / Math.max(1, prog.cells)}%` }} />
        </div>
        <p class="muted small" data-testid="progress-source">
          {prog.doneFrom === 'photo'
            ? project.finishedAt && !project.openSpots
              ? 'Your last photo of the puzzle shows it complete.'
              : `From your photo of the puzzle${project.openSpots ? ` (${project.openSpots.gaps.length} empty spots)` : ''}${s.placed ? `, and ${s.placed} ${s.placed === 1 ? 'piece' : 'pieces'} fitted since` : ''}.`
            : s.placed
              ? `The pieces you said fit (✓ Fits). Photograph the nearly finished puzzle (Scan pieces) to count the rest.`
              : 'No pieces in the puzzle yet: tap ✓ Fits when a piece goes in, or photograph the puzzle when it is nearly finished.'}
        </p>
      </div>

      {boxUrl && (
        <>
          <svg
            class="progress-map"
            style={{ aspectRatio: String(aspect) }}
            viewBox={`0 0 ${grid.cols} ${grid.rows}`}
            preserveAspectRatio="none"
            data-testid="progress-map"
          >
            <image href={boxUrl} x={0} y={0} width={grid.cols} height={grid.rows} preserveAspectRatio="none" />
            {dark && <path d={dark} class="progress-left" />}
            {dots.map(([c, r]) => (
              <ellipse key={`${c},${r}`} cx={c + 0.5} cy={r + 0.5} rx={0.28} ry={0.28 * aspect * (grid.rows / grid.cols)} class="progress-known" />
            ))}
          </svg>
          <p class="small muted">
            Bright: in the puzzle · <span class="progress-dot" /> its piece is on your table or in a tray · dark: still to find.
          </p>
        </>
      )}

      <h2>Pieces</h2>
      <table class="accuracy-table" data-testid="progress-status">
        <tbody>
          <tr>
            <td>On the table</td>
            <td data-testid="progress-table">
              <strong>{s.table + s.pending}</strong>
              {s.pending ? <span class="muted small"> ({s.pending} to check)</span> : null}
            </td>
          </tr>
          {(s.tray > 0 || prog.trays.length > 0) && (
            <tr>
              <td>In trays</td>
              <td data-testid="progress-trays">
                <strong>{s.tray}</strong> <span class="muted small">{prog.trays.map(([l, n]) => `${l} ${n}`).join(' · ')}</span>
              </td>
            </tr>
          )}
          <tr>
            <td>You said fit (✓)</td>
            <td data-testid="progress-placed">
              <strong>{s.placed}</strong>
            </td>
          </tr>
          {s.aside > 0 && (
            <tr>
              <td>Set aside (earlier batches)</td>
              <td data-testid="progress-aside">
                <strong>{s.aside}</strong>
              </td>
            </tr>
          )}
          {s.missing > 0 && (
            <tr>
              <td>No longer seen at their spot</td>
              <td>
                <strong>{s.missing}</strong>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p data-testid="progress-left">
        {left === 0 ? (
          <strong>The puzzle is finished. 🎉</strong>
        ) : (
          <>
            <strong>{left}</strong> {left === 1 ? 'spot' : 'spots'} still empty:{' '}
            {prog.toFindExact ? (
              <>
                the piece for <strong>{prog.known}</strong> of them is on your table or in a tray; <strong>{prog.toFind}</strong> still to find.
              </>
            ) : (
              <>
                the piece is known for <strong>{prog.known}</strong>; about <strong>{prog.toFind}</strong> {prog.toFind === 1 ? 'piece' : 'pieces'} not read yet
                (≈: pieces read twice, or not puzzle pieces, make this a little low).
              </>
            )}
          </>
        )}
      </p>

      {s.table + s.tray + s.pending > 0 && (
        <>
          <h2>Border</h2>
          <p data-testid="progress-border">
            Of the pieces not in the puzzle yet: <span class="legend-corner">{groups.corner === 1 ? '1 corner' : `${groups.corner} corners`}</span> ·{' '}
            <span class="legend-edge">{groups.edge === 1 ? '1 edge piece' : `${groups.edge} edge pieces`}</span> · {groups.interior} inside
            {groups.unsure ? <span class="muted"> · {groups.unsure} not sure (a close-up helps)</span> : null}.
          </p>
          <p class="muted small">
            The whole puzzle has {want.corners} corners and {want.edges} edge pieces.
          </p>
        </>
      )}

      <h2>How often the app is right</h2>
      {acc.answers + pairs.answers === 0 ? (
        <p class="muted small" data-testid="progress-accuracy">
          No answers yet: tap ✓ Fits or ✗ Doesn't fit when you try a piece.
        </p>
      ) : (
        <p data-testid="progress-accuracy">
          {acc.first.all.total > 0 && (
            <>
              First choice of spot right <strong>{acc.first.all.right}</strong> of {acc.first.all.total} ({pc(acc.first.all.right, acc.first.all.total)}{' '}
              %).{' '}
            </>
          )}
          {pairs.all.total > 0 && (
            <>
              Pairs that fitted <strong>{pairs.all.right}</strong> of {pairs.all.total} ({pc(pairs.all.right, pairs.all.total)} %).{' '}
            </>
          )}
          <a href={`#/accuracy/${encodeURIComponent(project.id)}`}>Details</a>
        </p>
      )}

      <h2>Batch</h2>
      <p class="small" data-testid="progress-batch">
        Batch {batchNumber(project)}
        {project.batch ? `, started ${new Date(project.batch.startedAt).toLocaleString()}` : ''}.
      </p>
    </main>
  );
}
