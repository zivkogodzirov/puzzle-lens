/**
 * The puzzle's **Picture** tab (M9 part 4, design plan §4 item 6): how far the puzzle is, and filling spots.
 * - Header: a progress ring and "988 of 1,008 · 20 to go".
 * - The box picture as a zoomable map (PictureMap.tsx): spots in the puzzle bright, empty ones dimmed, a ring
 *   where an empty spot's piece is waiting. A tap on a spot opens the **spot sheet** (components/FillSpot.tsx):
 *   the pieces that may go there, "Show on my table", and "Not there" / "It fits". "Fill a spot" opens it on
 *   the first spot whose piece is waiting (the way in without tapping the picture, e.g. with VoiceOver).
 * - "Photograph the puzzle so far": the scan camera (it comes back to this tab), for one photo of the puzzle with
 *   its holes; what the new photo changed shows at the top afterwards.
 * - The notes about the box picture (the empty spots from your puzzle photo, its fit, the table's contrast), then
 *   the pieces by status, the border pieces left and the batch. "How often the app is right" is on More (Tester mode).
 *
 * Gets everything from `usePuzzle()` (context.ts); owned by the Picture tab's builder (PuzzleScreen.tsx explains
 * the contract).
 */
import { useMemo, useState } from 'preact/hooks';
import { Icon } from '../../ui/icons';
import { Callout } from '../../ui/Callout';
import { ListRow, ListSection } from '../../ui/List';
import { FillSpot, type Cell } from '../../components/FillSpot';
import { BoxFitNotice } from '../../components/BoxFitNotice';
import { TableContrast } from '../../components/TableContrast';
import { go } from '../../router';
import { updateProject } from '../../../project/store';
import { undoFits } from '../../../project/answers';
import { batchNumber } from '../../../project/batches';
import { puzzleProgress, type PuzzleProgress } from '../../../project/progress';
import { nearestSpot } from '../../../project/fillSpot';
import type { PlacementCache } from '../../../project/placements';
import type { PieceRow } from '../../../project/types';
import { logError } from '../../../log/logger';
import { borderCounts, pieceGroup } from './shared';
import { usePuzzle } from './context';
import { PictureMap } from './PictureMap';
// M9 part 6 help: percentages in Tester mode only.
import { settings } from '../../settings';

/** Numbers with thousands separators ("1,008"). */
const num = (n: number) => n.toLocaleString('en-US');
const pc = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);

export function PictureTab() {
  const ctx = usePuzzle();
  const { project, boxUrl, places, rows, allRows, unplaced, shownPlaces, openCells, answers, photoPlaced, setPhotoPlaced, placing } = ctx;
  const grid = project.grid;
  const prog = useMemo(
    () =>
      grid
        ? puzzleProgress({
            grid,
            pieces: allRows,
            shown: shownPlaces,
            open: places?.open?.cells.length ? places.open.cells : null,
            gapCount: !places?.open?.cells.length && project.openSpots ? project.openSpots.gaps.length : null,
            taken: new Set(answers.view.taken.keys()),
            finished: Boolean(project.finishedAt && !project.openSpots),
          })
        : null,
    [project, allRows, shownPlaces, places, answers],
  );
  /** The spots whose piece is waiting, in reading order (Fill a spot starts there; Previous / Next on the whole picture). */
  const sure = useMemo(() => {
    const out: Cell[] = [];
    if (!prog || !grid) return out;
    for (let i = 0; i < prog.cellState.length; i++) if (prog.cellState[i] === 2) out.push([i % grid.cols, Math.floor(i / grid.cols)]);
    return out;
  }, [prog, grid?.cols]);
  const openSorted = useMemo(() => (openCells ? [...openCells].sort((a, b) => a[1] - b[1] || a[0] - b[0]) : null), [openCells]);
  const filled = useMemo(() => new Set(answers.view.taken.keys()), [answers]);

  const [spot, setSpot] = useState<Cell | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const canFill = Boolean(project.box && grid && boxUrl && places);
  const openSheet = (s: Cell) => {
    setHint(null);
    setSpot(s);
    setSheetOpen(true);
  };
  /** A tap on the map: among the empty spots of a puzzle photo the nearest one; on the whole picture the spot tapped. */
  const pick = (x: number, y: number) => {
    if (!grid) return;
    if (!canFill) {
      setHint(
        placing
          ? 'One moment: the app is still finding the spots of your pieces.'
          : rows.length || unplaced.length
            ? 'The spots of your pieces aren’t known yet.'
            : 'Scan your pieces first: then tap a spot to see which piece goes there.',
      );
      return;
    }
    if (openCells) {
      const s = nearestSpot(openCells, x, y);
      if (!s) return setHint('Tap one of the empty spots (the dimmed squares with a white outline).');
      return openSheet(s);
    }
    openSheet([Math.max(0, Math.min(grid.cols - 1, Math.floor(x))), Math.max(0, Math.min(grid.rows - 1, Math.floor(y)))]);
  };
  const fillFirst = () => {
    if (!grid) return;
    // The first spot whose piece is waiting (then the first empty one, the last one shown, the middle).
    openSheet(sure[0] ?? openSorted?.[0] ?? spot ?? [Math.floor(grid.cols / 2), Math.floor(grid.rows / 2)]);
  };
  const photoPuzzle = () => go('scan', project.id, 'picture');

  return (
    <>
      {photoPlaced && (
        <Callout kind="good" icon={<Icon name="camera" />} title="Your new photo of the puzzle" role="status" testId="photo-placed">
          <p>
            <strong>{photoPlaced.filled}</strong> {photoPlaced.filled === 1 ? 'spot' : 'spots'} filled since the last one.{' '}
            {photoPlaced.ids.length
              ? `${photoPlaced.ids.length === 1 ? 'The piece the app had for it is' : `The ${photoPlaced.ids.length} pieces the app had for them are`} now counted as in the puzzle.`
              : 'The app wasn’t sure which pieces went there, so none were marked.'}
          </p>
          <div class="callout-buttons">
            {photoPlaced.ids.length > 0 && (
              <button
                class="btn btn-small"
                data-testid="photo-placed-undo"
                onClick={() =>
                  void (async () => {
                    let next = project;
                    for (const pid of photoPlaced.ids) next = await undoFits(project.id, pid);
                    ctx.setProject(next);
                    setPhotoPlaced(null);
                    void ctx.reload().catch((err) => logError('puzzle', 'The piece counts could not be read', err));
                  })().catch((err) => logError('place', 'Could not take the pieces out again', err))
                }
              >
                Undo
              </button>
            )}
            <button class="btn btn-small" onClick={() => setPhotoPlaced(null)}>
              OK
            </button>
          </div>
        </Callout>
      )}

      {prog && grid ? (
        <ProgressHead prog={prog} />
      ) : (
        <div data-testid="progress-page">
          <p class="muted">Progress shows once the puzzle has its grid (set-up).</p>
        </div>
      )}

      {prog && grid && boxUrl && (
        <section class="card pic-map-card" aria-label="The box picture">
          <PictureMap
            boxUrl={boxUrl}
            grid={grid}
            aspect={project.box ? project.box.width / project.box.height : grid.cols / grid.rows}
            cellState={prog.cellState}
            open={openCells}
            selected={sheetOpen ? spot : null}
            onPick={pick}
            label={`The box picture: ${num(prog.done)} of ${num(prog.cells)} spots in the puzzle, ${num(prog.known)} empty ${prog.known === 1 ? 'spot' : 'spots'} with ${prog.known === 1 ? 'its' : 'their'} piece waiting.`}
          >
            <button
              type="button"
              class="btn btn-small btn-tinted"
              data-testid="fill-toggle"
              aria-haspopup="dialog"
              aria-label={`Fill a spot${sure.length ? `: ${sure.length} with a piece waiting` : ''}`}
              disabled={!canFill}
              onClick={fillFirst}
            >
              <Icon name="target" size={20} /> Fill a spot
            </button>
          </PictureMap>
          <p class="pic-legend">
            Bright: in the puzzle · <span class="pic-ring-sample" aria-hidden="true" /> its piece is waiting · Dim: still to find
          </p>
          {placing && (
            <p class="pic-legend" data-testid="picture-placing">
              Finding the spots of your pieces… {placing.done} of {placing.total}
            </p>
          )}
          {hint && (
            <Callout kind="warn" icon={<Icon name="alert-triangle" />} testId="fill-hint">
              {hint}
            </Callout>
          )}
        </section>
      )}

      {ctx.canScan && (
        <div class="pic-photo">
          <button type="button" class="btn btn-block" data-testid="photo-puzzle" onClick={photoPuzzle}>
            <Icon name="camera" size={22} /> Photograph the puzzle so far
          </button>
          <p class="pic-photo-help" data-testid={project.openSpots ? 'photo-puzzle-help' : 'open-spots-tip'}>
            {project.openSpots
              ? 'Put more pieces in? Photograph it again: the empty spots are updated.'
              : 'Most of it done? One photo of the whole puzzle with its holes (take it, or Choose a photo in Scan): your leftover pieces are then matched only to the holes, which is far more reliable.'}
          </p>
        </div>
      )}

      {project.box && rows.length > 0 && project.openSpots && (
        <OpenSpots
          open={places?.open ?? null}
          rows={rows}
          onWholePicture={() => {
            void updateProject(project.id, { openSpots: null })
              .then(ctx.setProject)
              .catch((err) => logError('place', 'Could not switch to the whole picture', err));
          }}
        />
      )}
      {project.box && rows.length > 0 && !placing && <BoxFitNotice project={project} shown={shownPlaces} onProject={ctx.setProject} />}
      {boxUrl && grid && rows.length > 0 && <TableContrast project={project} pieces={allRows} boxUrl={boxUrl} />}

      {prog && grid && <PieceLists prog={prog} pieces={allRows} />}

      {canFill && spot && (
        <FillSpot
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          project={project}
          boxUrl={boxUrl!}
          spot={spot}
          onSpot={setSpot}
          shown={shownPlaces}
          spots={openCells}
          steps={openSorted ?? sure}
          pieces={unplaced}
          filled={filled}
          onAnswer={(p, s, fits) => {
            // "It fits" closes the sheet: the ring counts up, with "Placed at …" and Undo in a toast. "Not there" keeps it open.
            if (fits) setSheetOpen(false);
            ctx.answer(p, s, fits, 'fill');
          }}
          onPickPiece={(p, s) => {
            setSheetOpen(false);
            ctx.openCard(p.id, 'fill', s);
          }}
          onShowOnTable={(ids, spotOf) => {
            setSheetOpen(false);
            // Over this tab (review 2026-11-11: it switched to Table and left the spot behind): the best piece green,
            // the others amber, It fits / Not there for this spot in the live view, and back to this spot's sheet.
            ctx.pointOut(ids, [], {
              title: ids.length === 1 ? 'The piece for this spot' : 'Pieces for this spot',
              legend:
                'The pulsing pieces may go in this spot: the green one first, then the amber ones. Tap one to answer. An arrow at the edge shows the way when one is out of view.',
              best: ids[0],
              spotOf,
              onClose: () => setSheetOpen(true),
            });
          }}
        />
      )}
    </>
  );
}

/** The ring and "988 of 1,008 · 20 to go", and where the count comes from. */
function ProgressHead({ prog }: { prog: PuzzleProgress }) {
  const { project } = usePuzzle();
  const s = prog.status;
  const left = prog.cells - prog.done;
  const share = prog.cells ? prog.done / prog.cells : 0;
  const R = 26;
  const C = 2 * Math.PI * R;
  return (
    <div data-testid="progress-page">
      <div class="card pic-head" data-testid="progress-done">
        <div
          class="pic-ring"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={prog.cells}
          aria-valuenow={prog.done}
          aria-valuetext={`${num(prog.done)} of ${num(prog.cells)}`}
          aria-label="In the puzzle"
        >
          <svg viewBox="0 0 64 64" width={64} height={64} aria-hidden="true">
            <circle cx={32} cy={32} r={R} class="pic-ring-track" />
            <circle
              cx={32}
              cy={32}
              r={R}
              class="pic-ring-done"
              // None in yet: no dot (a round cap on a stroke of length 0).
              visibility={share > 0 ? undefined : 'hidden'}
              stroke-dasharray={`${(C * share).toFixed(2)} ${C.toFixed(2)}`}
              transform="rotate(-90 32 32)"
              data-testid="progress-ring"
            />
          </svg>
          <span class="pic-ring-pc" aria-hidden="true">
            {/* M9 part 6 help: the percentage in Tester mode only (design plan §3.7); the count is beside the ring. */}
            {left === 0 ? <Icon name="check" size={24} /> : settings.testerMode.value ? `${pc(prog.done, prog.cells)}%` : null}
          </span>
        </div>
        <div class="pic-head-text">
          <p class="pic-count">
            <strong>{num(prog.done)}</strong> of {num(prog.cells)}{' '}
            {left === 0 ? (
              <span class="pic-togo" data-testid="progress-togo">
                · finished <Icon name="party-popper" size={22} class="icon-inline" label="Hooray" />
              </span>
            ) : (
              <span class="pic-togo" data-testid="progress-togo">
                · {num(left)} to go
              </span>
            )}
          </p>
          <p class="pic-source" data-testid="progress-source">
            {prog.doneFrom === 'photo'
              ? project.finishedAt && !project.openSpots
                ? 'Your last photo of the puzzle shows it complete.'
                : `From your photo of the puzzle${project.openSpots ? ` (${project.openSpots.gaps.length} empty spots)` : ''}${s.placed ? `, and ${s.placed} ${s.placed === 1 ? 'piece' : 'pieces'} fitted since` : ''}.`
              : s.placed
                ? 'The pieces you said fit. Photograph the nearly finished puzzle to count the rest.'
                : 'None in yet: tap It fits when a piece goes in, or photograph the puzzle when it is nearly finished.'}
          </p>
        </div>
      </div>
    </div>
  );
}

/** The pieces by status (with how many spots are still empty), the border pieces left, and the batch. */
function PieceLists({ prog, pieces }: { prog: PuzzleProgress; pieces: PieceRow[] }) {
  const { project } = usePuzzle();
  const grid = project.grid!;
  const groups = useMemo(() => {
    const cell: [number, number] | null = project.piecePitch ? [project.piecePitch.wMm, project.piecePitch.hMm] : null;
    const g = { corner: 0, edge: 0, interior: 0, unsure: 0 };
    for (const q of pieces) if (q.status === 'table' || q.status === 'tray' || q.status === 'pending') g[pieceGroup(q, cell)]++;
    return g;
  }, [pieces, project.piecePitch]);
  const s = prog.status;
  const left = prog.cells - prog.done;
  const want = borderCounts(grid);
  return (
    <>
      <div data-testid="progress-status">
        <ListSection
          header="Pieces"
          footer={
            <span data-testid="progress-left">
              {left === 0 ? (
                <strong>The puzzle is finished.</strong>
              ) : (
                <>
                  <strong>{num(left)}</strong> {left === 1 ? 'spot' : 'spots'} still empty:{' '}
                  {prog.toFindExact ? (
                    <>
                      the piece for <strong>{num(prog.known)}</strong> of them is on your table or in a tray; <strong>{num(prog.toFind)}</strong> still to find.
                    </>
                  ) : (
                    <>
                      the piece is known for <strong>{num(prog.known)}</strong>; about <strong>{num(prog.toFind)}</strong>{' '}
                      {prog.toFind === 1 ? 'piece' : 'pieces'} not read yet (≈: pieces read twice, or not puzzle pieces, make this a little low).
                    </>
                  )}
                </>
              )}
            </span>
          }
        >
          <ListRow
            title="On the table"
            subtitle={s.pending ? `${s.pending} to check` : undefined}
            value={<strong>{num(s.table + s.pending)}</strong>}
            testId="progress-table"
          />
          {(s.tray > 0 || prog.trays.length > 0) && (
            <ListRow
              title="In trays"
              subtitle={prog.trays.map(([l, n]) => `${l} ${n}`).join(' · ') || undefined}
              value={<strong>{num(s.tray)}</strong>}
              testId="progress-trays"
            />
          )}
          <ListRow title="You said it fits" value={<strong>{num(s.placed)}</strong>} testId="progress-placed" />
          {s.aside > 0 && <ListRow title="Set aside (earlier batches)" value={<strong>{num(s.aside)}</strong>} testId="progress-aside" />}
          {s.missing > 0 && <ListRow title="No longer seen at their spot" value={<strong>{num(s.missing)}</strong>} />}
        </ListSection>
      </div>
      {s.table + s.tray + s.pending > 0 && (
        <div data-testid="progress-border">
          <ListSection header="Not in the puzzle yet, by shape" footer={`The whole puzzle has ${want.corners} corners and ${num(want.edges)} edge pieces.`}>
            <ListRow title="Corner pieces" value={num(groups.corner)} />
            <ListRow title="Edge pieces" value={num(groups.edge)} />
            <ListRow title="Inside pieces" value={num(groups.interior)} />
            {groups.unsure > 0 && <ListRow title="Not sure yet" subtitle="A close-up helps" value={num(groups.unsure)} />}
          </ListSection>
        </div>
      )}
      <p class="list-footer pic-batch" data-testid="progress-batch">
        {/* M9 part 6 help: "lot", the owner's word (design plan §3.7). */}
        Lot {batchNumber(project)}
        {project.batch ? `, started ${new Date(project.batch.startedAt).toLocaleString()}` : ''}.
      </p>
    </>
  );
}

/** The empty spots from a photo of the puzzle (M7). */
function OpenSpots({ open, rows, onWholePicture }: { open: PlacementCache['open']; rows: PieceRow[]; onWholePicture: () => void }) {
  const spots = open?.cells.length ?? 0;
  const noKnobs = rows.filter((r) => r.patch && !r.patch.sides).length;
  return (
    <Callout
      kind="info"
      icon={<Icon name="image" />}
      title="Matched to your empty spots"
      testId="open-spots"
      action={{ label: 'Use the whole picture', onClick: onWholePicture, testId: 'whole-picture' }}
    >
      {open && !spots ? (
        <p>Your finished-puzzle photo doesn’t line up with the box picture (its grid is a different size), so the whole picture is used.</p>
      ) : (
        <p>
          Leftover pieces are matched only to the <strong>{spots || '…'} empty spots</strong> from your finished-puzzle photo, one piece per spot.
        </p>
      )}
      {spots > 0 && (!open?.sides || noKnobs > 0) && (
        <p data-testid="knobs-off">
          <strong>Knob shapes not used yet</strong> (read before this version): {!open?.sides ? 'choose your photo of the puzzle with its holes again' : ''}
          {!open?.sides && noKnobs > 0 ? ', then ' : ''}
          {noKnobs > 0
            ? `scan your leftover pieces again (${noKnobs === rows.length ? 'all of them' : `${noKnobs} of them`}: More → Delete scanned pieces → Delete and scan again)`
            : ''}
          .
        </p>
      )}
    </Callout>
  );
}
