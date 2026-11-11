/**
 * The puzzle's **Pieces** tab (M9 part 4, design plan §4 item 7), top to bottom:
 * - a "Pieces to check (n)" callout when a rescan saw pieces where no known piece was (at the top: it asks for an
 *   answer, and nothing above it moves while the spots are found);
 * - one compact header: how many pieces were read (on the table, in trays, set aside, the batch), the progress
 *   line (found · shapes read · placed on the box, and the pieces in the puzzle, with a way to take one out) and
 *   the place summary (how many have a spot on the box picture);
 * - two rows that each push a full page (PiecesPages.tsx): "Which pieces join (n) ›" (`#/joins/<id>`) and
 *   "Sort into trays ›" (`#/sort/<id>`), with Back to this tab;
 * - a segmented filter, All · Border · Inside · Check (Check: shape not sure, to check, or a faint outline), with
 *   the border counts under Border;
 * - a one-line legend of the tiles' badges and the grid, 4 across (PiecesGrid.tsx); a tile opens the piece's card.
 *
 * The filter and the place on the page are kept while a pushed page is open, so Back returns to the same spot.
 * Gets everything from `usePuzzle()` (context.ts); owned by the Pieces tab's builder (PuzzleScreen.tsx explains
 * the contract).
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from '../../ui/icons';
import { Callout } from '../../ui/Callout';
import { ListRow, ListSection } from '../../ui/List';
import { Segmented } from '../../ui/Segmented';
import { go } from '../../router';
import { resolvePending } from '../../../project/pending';
import { progressCounts, SIDE_ARROW, type FrameSide } from '../../../project/progress';
import type { SpotChoice } from '../../../cv/openSpots';
import type { PieceRow } from '../../../project/types';
import { logError, logInfo } from '../../../log/logger';
import { plural } from '../../words';
import { borderCounts, useBlobUrl } from './shared';
import { usePuzzle } from './context';
import { needsCheck, PiecesGrid } from './PiecesGrid';
import { keepTab, takeKeptTab } from './PiecesPages';

type Show = 'all' | 'border' | 'interior' | 'check';

export function PiecesTab() {
  const ctx = usePuzzle();
  const { project, canScan, counts, piecesRead, rows, allRows, states } = ctx;
  const { all, table, tray, missing, placed, aside } = counts;
  const [inPuzzleOpen, setInPuzzleOpen] = useState(false);
  const inPuzzle = useMemo(() => allRows.filter((r) => r.status === 'placed').length, [allRows]);
  const progress = useMemo(() => progressCounts([...states.values()]), [states]);
  const showProgress = canScan && all !== null && piecesRead && rows.length > 0;
  return (
    <>
      {/* First: it asks for an answer, and nothing above it changes size while the spots are found. */}
      {canScan && piecesRead && rows.some((r) => r.status === 'pending') && (
        <PendingPanel
          projectId={project.id}
          rows={allRows}
          onDone={() => void ctx.reload().catch((err) => logError('puzzle', 'The piece counts could not be read', err))}
        />
      )}
      <div class="card pieces-head" data-testid="pieces-head">
        <p class="pieces-head-count" data-testid="puzzle-pieces">
          <strong>{all === null ? '—' : plural(all, 'piece')} read</strong>
          {all !== null && (tray > 0 || missing > 0 || placed > 0 || aside > 0) && (
            <span class="muted" data-testid="puzzle-status-counts">
              {': '}
              {[
                `${table} on the table`,
                missing > 0 ? `${missing} no longer seen at ${missing === 1 ? 'its' : 'their'} spot` : '',
                tray > 0 ? `${tray} in trays` : '',
                placed > 0 ? `${placed} in the puzzle` : '',
                aside > 0 ? `${aside} set aside` : '',
              ]
                .filter(Boolean)
                .join(', ')}
            </span>
          )}
          {(project.batch?.n ?? 1) > 1 && (
            <span class="muted" data-testid="puzzle-batch">
              {' · '}Batch {project.batch!.n}
            </span>
          )}
        </p>
        {!canScan && <p class="muted small">Reading pieces starts after the set-up.</p>}
        {showProgress && (
          <p class="small pieces-head-line" data-testid="progress">
            {/* Each count kept whole on one line (the line wraps between them). */}
            <span class="nw">
              <span class="state-dot state-found" />
              {progress.found} found
            </span>
            {' · '}
            <span class="nw">
              <span class="state-dot state-shape" />
              {progress.shape} shapes read
            </span>
            {' · '}
            <span class="nw">
              <span class="state-dot state-placed" />
              {progress.placed} placed on box
            </span>
            {inPuzzle > 0 && (
              <>
                {' · '}
                <button class="link-btn" data-testid="in-puzzle" aria-expanded={inPuzzleOpen} onClick={() => setInPuzzleOpen(!inPuzzleOpen)}>
                  <Icon name="check" size={18} class="inline-icon" /> {inPuzzle} in the puzzle
                </button>
              </>
            )}
          </p>
        )}
        {showProgress && project.box && <PlaceSummary />}
      </div>
      {inPuzzleOpen && inPuzzle > 0 && <InPuzzleList />}
      {canScan && all !== null && <Catalog />}
    </>
  );
}

/** The pieces in the puzzle (M5 part 2), each with a way to take it out again. */
function InPuzzleList() {
  const { allRows, takeOut } = usePuzzle();
  return (
    <div class="card in-puzzle-list" data-testid="in-puzzle-list">
      <p class="small muted">Pieces you said fit. Tapped “It fits” by mistake? Take it out: it goes back on the table (or into its tray).</p>
      {allRows
        .filter((r) => r.status === 'placed')
        .sort((a, b) => (b.placedAt?.at ?? 0) - (a.placedAt?.at ?? 0))
        .map((r) => (
          <InPuzzleRow
            key={r.id}
            piece={r}
            onTakeOut={() => void takeOut(r.id).catch((err) => logError('answer', 'Could not take the piece out again', err))}
          />
        ))}
    </div>
  );
}

/** The rows that push a page, the pieces to check, the filter and the grid. */
function Catalog() {
  const ctx = usePuzzle();
  const { project, rows, allRows, groups, shownPlaces, sideOf, pairs, selectedPiece, openCard } = ctx;
  const projectId = project.id;
  const grid = project.grid;
  const markers = project.tracking === 'markers';
  // Back from a page pushed from here: the same filter, and the same place on the tab (once the grid is drawn).
  const [back] = useState(() => takeKeptTab(projectId));
  const [show, setShow] = useState<Show>((back?.show as Show | undefined) ?? 'all');
  const restore = useRef(back?.scroll ?? null);
  useLayoutEffect(() => {
    if (restore.current === null || !ctx.piecesRead) return;
    scrollTo(0, restore.current);
    restore.current = null;
  });
  const push = (to: 'joins' | 'sort') => {
    keepTab(projectId, { show, scroll: scrollY });
    go(to, projectId);
  };
  // Sort into trays: a row that pushes its page.
  const traysRow = <ListRow icon={<Icon name="inbox" />} tone="accent" title="Sort into trays" chevron testId="trays-toggle" onClick={() => push('sort')} />;
  if (!ctx.piecesRead) return <p class="muted">Loading…</p>;
  if (!rows.length)
    return allRows.some((q) => q.status === 'tray') ? (
      <div>
        <p class="muted small">All your scanned pieces are in trays.</p>
        <ListSection testId="puzzle-tools">{traysRow}</ListSection>
      </div>
    ) : (
      <p class="muted small" data-testid="catalog-empty">
        {allRows.length ? 'No pieces on the table now.' : 'No pieces yet.'} Spread pieces face up{' '}
        {markers ? 'inside the markers' : 'on the table, with small gaps'} and tap Scan.
      </p>
    );
  const n = { corner: 0, edge: 0, interior: 0, unsure: 0 };
  for (const g of groups.values()) n[g]++;
  const check = rows.filter((r) => needsCheck(r, groups.get(r.id)));
  const count: Record<Show, number> = { all: rows.length, border: n.corner + n.edge, interior: n.interior, check: check.length };
  const want = borderCounts(grid ?? { cols: 0, rows: 0 });
  const tooMany = grid && (n.corner > want.corners || n.edge > want.edges);
  const sideCounts = new Map<FrameSide, number>();
  for (const r of rows) {
    const s = sideOf(r.id);
    if (s) sideCounts.set(s, (sideCounts.get(s) ?? 0) + 1);
  }
  const shown =
    show === 'check'
      ? // To check first (a rescan's), then the rest as listed.
        check.slice().sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending'))
      : rows
          .filter((r) => {
            const g = groups.get(r.id)!;
            return show === 'all' || (show === 'border' ? g === 'corner' || g === 'edge' : g === show);
          })
          // Border view: corners first.
          .sort((a, b) => (show === 'border' ? Number(groups.get(b.id) === 'corner') - Number(groups.get(a.id) === 'corner') : 0));
  const joins = pairs && grid ? pairs.list.pairs.length : null;
  return (
    <div class="pieces-catalog">
      {/* The tab's tools: each opens its own page (M9 part 4; they opened inline before). */}
      <ListSection testId="puzzle-tools">
        {joins !== null && (
          <ListRow
            icon={<Icon name="link" />}
            tone="accent"
            title="Which pieces join"
            value={joins > 0 ? <span data-testid="matches-count">{joins}</span> : undefined}
            chevron
            testId="matches-toggle"
            onClick={() => push('joins')}
          />
        )}
        {traysRow}
      </ListSection>
      <div class="catalog-groups" data-testid="catalog-groups">
        <Segmented<Show>
          label="Show pieces"
          testId="group"
          nowrap
          value={show}
          onChange={setShow}
          options={[
            ['all', 'All', count.all],
            ['border', 'Border', count.border],
            ['interior', 'Inside', count.interior],
            ['check', 'Check', count.check],
          ]}
        />
      </div>
      {show === 'border' && (
        <p class="small" data-testid="border-counts">
          <span class="legend-corner">Corners {grid ? `${n.corner} of ${want.corners}` : n.corner}</span> ·{' '}
          <span class="legend-edge">Edges {grid ? `${n.edge} of ${want.edges}` : n.edge}</span>
          {n.unsure ? <span class="muted"> · {n.unsure} not sure yet (a close-up helps)</span> : null}
          {sideCounts.size > 0 && (
            <span data-testid="side-counts">
              <br />
              Side of the frame known: {[...sideCounts].map(([s, k]) => `${SIDE_ARROW[s]} ${k}`).join(' · ')}
            </span>
          )}
        </p>
      )}
      {show === 'check' && count.check > 0 && (
        <p class="small muted" data-testid="check-note">
          Shapes not sure yet (a close-up helps), pieces a rescan saw where no known piece was, and faint outlines.
        </p>
      )}
      {tooMany && (
        <Callout kind="warn" icon={<Icon name="alert-triangle" />} testId="border-warning">
          More {n.corner > want.corners ? 'corner' : 'edge'} pieces than a {grid!.cols} × {grid!.rows} puzzle has: some shapes were misread, or the grid may be
          wrong. Check?
        </Callout>
      )}
      <PiecesGrid
        resetKey={show}
        rows={shown}
        groups={groups}
        places={shownPlaces}
        sideOf={sideOf}
        selected={selectedPiece}
        onOpen={(id) => openCard(id)}
        empty={
          <p class="muted small pieces-none" data-testid="catalog-none">
            {show === 'check' ? 'Nothing to check.' : 'No pieces here.'}
          </p>
        }
      />
    </div>
  );
}

/**
 * Pieces to check (M5 part 3): a rescan saw these where no known piece was, and each may be a piece
 * moved since. The owner says which ("same piece") or that it's a new one.
 */
function PendingPanel({ projectId, rows, onDone }: { projectId: string; rows: PieceRow[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const pending = rows.filter((r) => r.status === 'pending');
  const byId = new Map(rows.map((r) => [r.id, r]));
  const settle = (id: string, into: string | null) =>
    void resolvePending(projectId, id, into)
      .then(() => {
        logInfo('pending', into ? 'A piece to check was the same as a known piece' : 'A piece to check is a new piece');
        onDone();
      })
      .catch((err) => logError('pending', 'Could not settle the piece', err));
  return (
    <div class="callout callout-warn pending-panel" data-testid="pending-panel">
      <span class="callout-icon" aria-hidden="true">
        <Icon name="alert-triangle" size={20} />
      </span>
      <div class="callout-body">
        <strong class="callout-title" data-testid="pending-title">
          Pieces to check ({pending.length})
        </strong>
        <div class="callout-text">
          A rescan saw {pending.length === 1 ? 'a piece' : 'pieces'} where no known piece was. Each may be one you moved, or a new one.
        </div>
      </div>
      <button class="btn btn-small callout-action" data-testid="pending-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Hide' : 'Check them'}
      </button>
      {open &&
        pending.map((p) => (
          <div class="pending-row" key={p.id} data-testid="pending-row">
            <PendingThumb piece={p} label="Seen now" />
            <span class="small">Same piece as:</span>
            {(p.maybe ?? [])
              .map((id) => byId.get(id))
              .filter((c): c is PieceRow => Boolean(c))
              .map((c) => (
                <button key={c.id} class="btn btn-small pending-choice" data-testid="pending-same" onClick={() => settle(p.id, c.id)}>
                  <PendingThumb piece={c} label={c.status === 'missing' ? 'Missing' : c.status === 'aside' ? 'Set aside' : 'Known'} />
                  This one
                </button>
              ))}
            <button class="btn btn-small" data-testid="pending-new" onClick={() => settle(p.id, null)}>
              A different piece
            </button>
          </div>
        ))}
    </div>
  );
}

function PendingThumb({ piece, label }: { piece: PieceRow; label: string }) {
  const url = useBlobUrl(piece.thumbBlobId, piece.updatedAt);
  return (
    <span class="pending-thumb">
      {url ? <img src={url} alt={label} /> : <span class="catalog-empty" />}
      <span class="tiny muted">{label}</span>
    </span>
  );
}

/** A piece in the puzzle (M5 part 2), with a way to take it out again. */
function InPuzzleRow({ piece, onTakeOut }: { piece: PieceRow; onTakeOut: () => void }) {
  const url = useBlobUrl(piece.thumbBlobId, piece.updatedAt);
  const at = piece.placedAt;
  return (
    <div class="row in-puzzle-row" data-testid="in-puzzle-row">
      {url ? <img src={url} class="spot-thumb" alt="A piece" /> : <span class="spot-thumb" />}
      <span class="grow small">
        {at && at.col >= 0 ? `Column ${at.col + 1}, row ${at.row + 1}` : 'In the puzzle (spot not known)'}
        {at?.by === 'photo' ? ' · from your puzzle photo' : ''}
      </span>
      <button class="btn btn-small" data-testid="take-out" onClick={onTakeOut}>
        Take it out
      </button>
    </div>
  );
}

/** How many pieces have a spot on the box picture, and progress while placing. */
function PlaceSummary() {
  const { rows, shownPlaces, placing, places } = usePuzzle();
  const learned = places?.colour?.affine && places.learned?.n ? places.learned.n : 0;
  return <PlaceSummaryLine shown={shownPlaces} rows={rows} placing={placing} learned={learned} />;
}

function PlaceSummaryLine({
  shown,
  rows,
  placing,
  learned = 0,
}: {
  shown: Map<string, SpotChoice>;
  rows: PieceRow[];
  placing: { done: number; total: number } | null;
  /** Pieces in the puzzle the colours were learned from (M8), 0 if not. */
  learned?: number;
}) {
  const n = { strong: 0, likely: 0, several: 0, nofit: 0 };
  for (const r of rows) {
    const c = shown.get(r.id);
    if (!c) continue;
    if (!c.fits) n.nofit++;
    else n[c.placement.verdict]++;
  }
  const none = rows.length - n.strong - n.likely - n.several - n.nofit;
  return (
    <p class="small pieces-head-line" data-testid="place-summary">
      {placing ? (
        <span data-testid="placing">
          Finding spots on the box picture… {placing.done} of {placing.total}
        </span>
      ) : (
        <>
          On the box picture: <span class="legend-strong">{n.strong} very likely</span> · <span class="legend-likely">{n.likely} maybe</span> · {n.several}{' '}
          where several places look alike
          {n.nofit > 0 ? <span> · {n.nofit} fit none of the empty spots</span> : null}
          {none > 0 ? <span class="muted"> · {none} not placed yet (scanned before this version: scan again)</span> : null}. Tap a piece to see where it goes.
          {learned > 0 && (
            <span class="muted" data-testid="colours-learned">
              {' '}
              Colours learned from your {plural(learned, 'piece')} in the puzzle.
            </span>
          )}
        </>
      )}
    </p>
  );
}
