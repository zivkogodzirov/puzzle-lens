/**
 * The puzzle's **Table** tab (M9 part 4, design plan §4 item 3; the default tab, decision 3): the main screen,
 * your table as the app sees it.
 *
 * - **With pieces on the table:** at the top, a status line ("6 pieces on the table · 4 with a sure spot") and a
 *   small progress ring (pieces in the puzzle of all, counted as on the Picture tab's Progress). Under it, the
 *   last scan photo of the table **in the tab** (TablePhoto inline): outlines and column·row labels, "?" for the
 *   legend, "Pieces in view", a tap on a piece opens its card, and the map button (`table-toggle`) shows the photo
 *   full screen (bigger, with a sentence per tapped piece). "Start live view" under the photo opens the camera.
 *   Above the tab bar, the "Next step" chip (TableNext.tsx) from the joins' "What next".
 *   The camera doesn't start by itself (decision 3 allows it when the camera permission is already granted;
 *   left for later: it would start a camera on every launch).
 * - **No pieces on the table:** a big "Scan your pieces" card; before the set-up is finished, "Continue set-up".
 *
 * Gets everything from `usePuzzle()` (context.ts); owned by the Table tab's builder (PuzzleScreen.tsx explains
 * the contract). Scan stays in the navigation bar (the shell's).
 */
import { useMemo, useState } from 'preact/hooks';
import { go } from '../../router';
import { Icon } from '../../ui/icons';
import { IconButton } from '../../ui/Button';
import { Callout } from '../../ui/Callout';
import { TablePhoto } from '../../components/TablePhoto';
import { OVERLAY_STATE } from '../../overlay';
import { puzzleProgress, spotLabel } from '../../../project/progress';
import type { PieceRow } from '../../../project/types';
import { plural } from '../../words';
import { aboutPieces, piecesHeld } from '../../pieceCounts';
import { usePuzzle } from './context';
import { TableNext } from './TableNext';

export function TableTab() {
  const ctx = usePuzzle();
  const { project, canScan, counts, piecesRead, rows, allRows, shownPlaces, places, answers, states, infoOf, openCard, openLive, scan } = ctx;
  /** The photo full screen (the map button): bigger, zoomable, a sentence per tapped piece. */
  const [photoOpen, setPhotoOpen] = useState(false);
  // In the puzzle: as the Picture tab's Progress counts it (from a photo of the puzzle, or the "It fits" answers).
  const progress = useMemo(() => {
    if (!project.grid) return null;
    const prog = puzzleProgress({
      grid: project.grid,
      pieces: allRows,
      shown: shownPlaces,
      open: places?.open?.cells.length ? places.open.cells : null,
      gapCount: !places?.open?.cells.length && project.openSpots ? project.openSpots.gaps.length : null,
      taken: new Set(answers.view.taken.keys()),
      finished: Boolean(project.finishedAt && !project.openSpots),
    });
    return { done: prog.done, total: prog.cells };
  }, [project, allRows, shownPlaces, places, answers]);

  if (!canScan)
    return (
      <Callout kind="info" icon={<Icon name="info" />} testId="table-setup" title="Finish the set-up first">
        <p>Reading pieces starts after the set-up.</p>
        <div class="callout-buttons">
          <button class="btn btn-filled btn-small" data-testid="table-continue-setup" onClick={() => go('new', project.id)}>
            Continue set-up
          </button>
        </div>
      </Callout>
    );
  if (!piecesRead && counts.all !== 0) return <p class="muted">Loading…</p>;
  if (!rows.length) {
    const markers = project.tracking === 'markers';
    return (
      <div class="card table-scan-card" data-testid="scan-card">
        <span class="table-scan-icon" aria-hidden="true">
          <Icon name="camera" size={32} />
        </span>
        <h2>Scan your pieces</h2>
        <p>
          {allRows.length
            ? allRows.some((q) => q.status === 'tray')
              ? 'All your scanned pieces are in trays.'
              : 'No pieces on the table now.'
            : 'No pieces yet.'}{' '}
          Spread pieces face up {markers ? 'inside the markers' : 'on the table, with small gaps'}, then scan them: the app finds each one and where it goes.
        </p>
        <button class="btn btn-filled btn-block" data-testid="scan-card-scan" onClick={scan}>
          <Icon name="camera" size={20} /> Scan your pieces
        </button>
      </div>
    );
  }
  const confidenceOf = (p: PieceRow) => {
    const c = shownPlaces.get(p.id);
    return c && c.fits && c.placement.top[0] ? { verdict: c.placement.verdict, p: c.placement.top[0].p } : null;
  };
  // "With a sure spot": a label on the photo (Very likely), not a dot.
  const sure = rows.filter((p) => confidenceOf(p)?.verdict === 'strong').length;
  const photoProps = {
    projectId: project.id,
    pieces: rows,
    mode: 'all' as const,
    colour: OVERLAY_STATE.found,
    colourOf: (p: PieceRow) => OVERLAY_STATE[states.get(p.id) ?? 'found'],
    labelOf: (p: PieceRow) => spotLabel(shownPlaces.get(p.id)),
    confidenceOf,
    infoOf,
    maxPhotos: 6,
    title: 'Your table',
  };
  return (
    <div class="table-tab">
      <div class="table-status" data-testid="table-status">
        <p class="table-status-text">
          {/* M10 fix: touching pieces counted as the pieces they hold, as on the Pieces tab (review 2026-11-11). */}
          <span data-testid="table-status-on">{aboutPieces(piecesHeld(rows).total, piecesHeld(rows).extra)} on the table</span> ·{' '}
          <span data-testid="table-status-sure">{sure} with a sure spot</span>
        </p>
        {progress && <ProgressRing done={progress.done} total={progress.total} />}
      </div>
      {ctx.photoPlaced && (
        // A new photo of the puzzle counted pieces as in (Scan comes back here): say so, its details and Undo are on
        // Picture (review 2026-11-11: shown only there, it was easy to miss).
        <Callout
          kind="good"
          testId="table-photo-placed"
          title="Your new photo of the puzzle"
          action={{ label: 'See', onClick: () => ctx.goTab('picture'), testId: 'table-photo-placed-see' }}
        >
          {plural(ctx.photoPlaced.filled, 'spot')} filled since the last one
          {ctx.photoPlaced.ids.length ? `; ${plural(ctx.photoPlaced.ids.length, 'piece')} now counted as in the puzzle` : ''}.
        </Callout>
      )}
      {!photoOpen && (
        <TablePhoto
          {...photoProps}
          inline
          onPick={(p) => openCard(p.id, 'photo')}
          tools={
            <IconButton label="Show my table full screen" class="btn-cam" testId="table-toggle" onClick={() => setPhotoOpen(true)}>
              <Icon name="map" />
            </IconButton>
          }
          footer={
            <button class="btn btn-filled btn-block table-live-btn" data-testid="live-toggle" onClick={openLive}>
              <Icon name="scan-eye" size={20} /> Start live view
            </button>
          }
        />
      )}
      <TableNext />
      {photoOpen && (
        <TablePhoto
          {...photoProps}
          onPick={(p) => {
            setPhotoOpen(false);
            openCard(p.id, 'photo');
          }}
          legend={
            <>
              <span class="state-dot" style={{ background: OVERLAY_STATE.placed }} />
              spot known (column·row) <span class="state-dot" style={{ background: OVERLAY_STATE.shape }} />
              shape read <span class="state-dot" style={{ background: OVERLAY_STATE.found }} />
              found. Tap a piece to zoom in and see where it goes.
            </>
          }
          onClose={() => setPhotoOpen(false)}
        />
      )}
    </div>
  );
}

/** A small ring: pieces in the puzzle of all, with the figures beside it (tabular). */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const R = 15;
  const C = 2 * Math.PI * R;
  const share = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <div class="table-ring" data-testid="table-ring" data-done={done} data-total={total}>
      <svg viewBox="0 0 36 36" width="36" height="36" aria-hidden="true">
        <circle cx="18" cy="18" r={R} class="table-ring-track" />
        <circle
          cx="18"
          cy="18"
          r={R}
          class="table-ring-done"
          stroke-dasharray={`${(share * C).toFixed(2)} ${C.toFixed(2)}`}
          transform="rotate(-90 18 18)"
          data-testid="table-ring-arc"
        />
      </svg>
      <span class="table-ring-figure">
        <span class="table-ring-done-n">{done.toLocaleString('en')}</span>
        <span class="table-ring-of"> of {total.toLocaleString('en')}</span>
        <span class="table-ring-sr"> pieces in the puzzle</span>
      </span>
    </div>
  );
}
