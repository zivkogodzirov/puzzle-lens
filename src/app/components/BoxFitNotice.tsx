/**
 * Box-to-grid correction on the puzzle page (M4, src/cv/boxFit.ts): when the confident placements
 * show that the box picture is a little bigger or smaller than the real puzzle, offer to straighten
 * the box photo again with corrected corners. The pieces are then placed again by themselves.
 */
import { useMemo, useState } from 'preact/hooks';
import { correctedCorners, fitBoxCorrection, fitMatters } from '../../cv/boxFit';
import type { SpotChoice } from '../../cv/openSpots';
import { getBlob, putBlob, updateProject } from '../../project/store';
import type { Project } from '../../project/types';
import { readerWorker } from '../workers';
import { logError, logInfo } from '../../log/logger';
import { errorWords, plural } from '../words';

export function BoxFitNotice({ project, shown, onProject }: { project: Project; shown: Map<string, SpotChoice>; onProject: (p: Project) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const grid = project.grid;
  const box = project.box;
  const fit = useMemo(() => {
    if (!grid) return null;
    const samples = [...shown.values()]
      .filter((c) => c.fits && c.placement.verdict === 'strong' && c.placement.top[0]?.ox !== undefined)
      .map((c) => ({ col: c.placement.top[0]!.col, row: c.placement.top[0]!.row, ox: c.placement.top[0]!.ox!, oy: c.placement.top[0]!.oy! }));
    return fitBoxCorrection(samples, grid.cols, grid.rows);
  }, [shown, grid?.cols, grid?.rows]);
  if (!box || !grid || box.fitDismissed || !fitMatters(fit)) return null;
  // The puzzle covers a share a of the box picture on each axis: a < 1, the box shows more.
  const a = (fit!.x.a + fit!.y.a) / 2;
  const pc = Math.round(Math.abs(1 / a - 1) * 1000) / 10;
  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const corners = correctedCorners(box.corners, grid.cols, grid.rows, fit!);
      const photo = await getBlob(box.photoBlobId);
      if (!corners || !photo) throw new Error('The box photo is no longer saved.');
      const r = await readerWorker().api.rectifyBox(
        new Blob([await photo.arrayBuffer()], { type: photo.type }),
        corners.map(([x, y]) => [x / box.photoWidth, y / box.photoHeight] as [number, number]),
      );
      await putBlob(box.rectifiedBlobId, 'box-rectified', r.jpeg, { aspect: r.aspect, ms: Math.round(r.ms) });
      const next = await updateProject(project.id, {
        box: {
          ...box,
          corners: r.cornersPx,
          photoWidth: r.photoWidth,
          photoHeight: r.photoHeight,
          width: r.width,
          height: r.height,
          fitted: (box.fitted ?? 0) + 1,
        },
      });
      logInfo(
        'place',
        `Box-to-grid correction applied: x a ${fit!.x.a.toFixed(4)} b ${fit!.x.b.toFixed(3)}, y a ${fit!.y.a.toFixed(4)} b ${fit!.y.b.toFixed(3)} (edge shift ${fit!.edgeShift.toFixed(2)} of a spot, ${fit!.x.n}/${fit!.y.n} pieces)`,
      );
      onProject(next);
    } catch (err) {
      logError('place', 'The box picture could not be corrected', err);
      setError(errorWords(err));
    }
    setBusy(false);
  };
  const dismiss = () => {
    void updateProject(project.id, { box: { ...box, fitDismissed: true } })
      .then(onProject)
      .catch((err) => logError('place', 'Could not save the answer', err));
  };
  return (
    <div class="notice notice-warn small" data-testid="box-fit">
      <p>
        <strong>Box picture check:</strong> your pieces show that the box picture is about {pc} % {a < 1 ? 'bigger' : 'smaller'} than the real puzzle (it shows{' '}
        {a < 1 ? 'a little more' : 'a little less'} of the scene), so spots near its edges are off by up to {Math.round(fit!.edgeShift * 100) / 100} of a piece.
        Measured from {plural(Math.min(fit!.x.n, fit!.y.n), 'piece')} the app is sure about.
      </p>
      <div class="row" style={{ gap: '8px', flexWrap: 'wrap' }}>
        <button class="btn btn-small btn-primary" data-testid="box-fit-apply" disabled={busy} onClick={() => void apply()}>
          {busy ? 'Correcting…' : 'Correct the box picture'}
        </button>
        <button class="btn btn-small" data-testid="box-fit-dismiss" disabled={busy} onClick={dismiss}>
          Not now
        </button>
      </div>
      {error && <p data-testid="box-fit-error">The box picture couldn’t be corrected: {error}</p>}
    </div>
  );
}
