import { useState } from 'preact/hooks';
import { go } from '../router';
import { readerWorker, restartReader } from '../workers';
import { TableCamera } from '../components/TableCamera';
import { getPrintScale, newId, projectBlobId, putBlob, type ProjectPatch } from '../../project/store';
import { db } from '../../db/db';
import { MARKER_COUNT, MARKER_PLACES, suggestedMarkerCentres } from '../../markers/layout';
import type { Project, SnapRow } from '../../project/types';
import type { TableSetupResult } from '../../cv/tableSetup';
import { logError, logInfo } from '../../log/logger';
import { errorWords } from './Puzzle';

type Phase =
  | { kind: 'intro' }
  | { kind: 'camera' }
  | { kind: 'result'; result: TableSetupResult }
  | { kind: 'error'; message: string };

const MEASURE_TIMEOUT_MS = 90_000;

/** A small picture of where the 8 cards go. */
function LayoutPicture() {
  const c = suggestedMarkerCentres(700, 500);
  const w = 810;
  const h = 610;
  return (
    <svg viewBox={`-70 -70 ${w + 140} ${h + 140}`} class="layout-picture" role="img" aria-label="Where the 8 marker cards go around the sorting area">
      <rect x={45} y={45} width={w - 90} height={h - 90} rx={12} class="layout-area" />
      <text x={w / 2} y={h / 2} class="layout-label" text-anchor="middle" dominant-baseline="middle">
        sorting area (empty)
      </text>
      <text x={w / 2} y={h + 60} class="layout-label small" text-anchor="middle">
        ↓ you stand here
      </text>
      {c.map(([x, y], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          <rect x={-45} y={-45} width={90} height={90} rx={6} class="layout-card" />
          <text class="layout-id" text-anchor="middle" dominant-baseline="central">
            {i}
          </text>
        </g>
      ))}
    </svg>
  );
}

/**
 * Wizard step 5: lay the 8 cards around the sorting area and take one photo of the empty table.
 * The photo gives the marker map (where each card lies, in mm).
 */
export function StepTable({ project, save }: { project: Project; save: (patch: ProjectPatch) => Promise<Project> }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'intro' });
  const [busy, setBusy] = useState<string | null>(null);

  const onPhoto = async (blob: Blob) => {
    setBusy('Measuring the markers…');
    const snapId = newId();
    try {
      const printScale = (await getPrintScale(project.id)) ?? 1;
      const reader = readerWorker();
      const info = await reader.ready;
      if (!info?.ok) throw new Error(info?.error ?? 'The photo helper could not start');
      const result = await Promise.race([
        reader.api.setupTable(blob, { printScale, snapId }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Measuring took too long; please try again')), MEASURE_TIMEOUT_MS)),
      ]);
      logInfo('setup', result.ok ? `Marker map measured (RMS ${result.map?.rmsMm.toFixed(2)} mm) in ${Math.round(result.ms)} ms` : 'Marker photo not usable', {
        problems: result.problems,
        missing: result.missing,
        perMarkerMm: result.perMarkerMm,
        quality: result.quality,
      });
      if (result.ok && result.map) {
        const blobId = projectBlobId(project.id, `snap-${snapId}`);
        await putBlob(blobId, 'snap', blob, { kind: 'marker-map' });
        const snap: SnapRow = {
          id: snapId,
          projectId: project.id,
          kind: 'marker-map',
          ts: Date.now(),
          width: result.width,
          height: result.height,
          zoom: 1,
          imgToTable: result.imgToTable,
          quality: result.quality,
          blobId,
          pieceIds: [],
        };
        // A new marker map is a new table frame: positions measured with the old one no longer fit.
        // Pieces found so far are set aside as "missing" (kept, not deleted) and get found again by
        // the next scan; the old marker photo is dropped.
        const old = (await db().snaps.where('projectId').equals(project.id).toArray()).filter((s) => s.kind === 'marker-map');
        await db().transaction('rw', db().snaps, db().blobs, db().pieces, async () => {
          for (const o of old) {
            await db().snaps.delete(o.id);
            if (o.blobId) await db().blobs.delete(o.blobId);
          }
          await db().pieces
            .where('projectId')
            .equals(project.id)
            .modify((p) => {
              if (p.status === 'table' || p.status === 'pending') p.status = 'missing';
            });
          await db().snaps.put(snap);
        });
        await save({ markerMap: result.map, tableModel: result.table });
      }
      setPhase({ kind: 'result', result });
    } catch (err) {
      logError('setup', 'Marker photo failed', err);
      // A helper still busy with a timed-out 12 MP job must not run a second one alongside it.
      if (/too long/.test(String((err as Error)?.message))) restartReader();
      setPhase({ kind: 'error', message: errorWords(err) });
    } finally {
      setBusy(null);
    }
  };

  if (phase.kind === 'camera') {
    return (
      <TableCamera mode="setup" map={null} busy={busy} onPhoto={(b) => void onPhoto(b)} onClose={() => setPhase({ kind: 'intro' })}>
        <p class="chip">Empty table, all 8 cards in the picture</p>
      </TableCamera>
    );
  }

  return (
    <section data-testid="step-table">
      <h2>Lay out the markers</h2>
      {phase.kind === 'intro' && (
        <>
          {project.markerMap && (
            <div class="notice notice-good" data-testid="map-done">
              Markers already measured ✓. Measure again only if you moved the cards: pieces found so far are then set aside, and the next scan finds them again.
            </div>
          )}
          <LayoutPicture />
          <ol class="steps">
            <li>Cut out the 8 cards along the dashed lines.</li>
            <li>
              Lay them around an <strong>empty</strong> area of your table about 70 × 50 cm, as in the picture: #0 at the far-left corner, then clockwise. The
              arrows point away from you. Leave a hand's width between the cards and the area.
            </li>
            <li>Make sure each card lies flat. A little tape helps if they slide.</li>
            <li>Light from the side (a window or a lamp off to one side) avoids glare on your glossy table.</li>
            <li>Stand at the near side and hold the phone flat over the middle, high enough to see all 8 cards. The photo takes itself.</li>
          </ol>
          <button class="btn btn-primary btn-block" data-testid="open-table-camera" onClick={() => setPhase({ kind: 'camera' })}>
            {project.markerMap ? 'Measure again' : 'Open the camera'}
          </button>
          {project.markerMap && (
            <button class="btn btn-block" data-testid="finish-setup" onClick={() => void save({ setupStep: 6 }).then(() => go('puzzle', project.id))}>
              Finish set-up
            </button>
          )}
        </>
      )}
      {phase.kind === 'result' && (
        <>
          {phase.result.ok ? (
            <div class="notice notice-good" data-testid="map-ok">
              <strong>All {MARKER_COUNT} markers measured ✓</strong>
              <p class="small">
                Measured cleanly (fit {phase.result.map!.rmsMm.toFixed(1)} mm; positions good to about 1–2 mm). From now on the app knows where the phone is over your table. Leave the cards where they are while
                you work; if one moves, the app notices and ignores it.
              </p>
            </div>
          ) : (
            <div class="notice notice-bad" data-testid="map-problems">
              <strong>That photo can't be used yet</strong>
              <ul>
                {phase.result.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              {phase.result.missing.length > 0 && phase.result.missing.length < MARKER_COUNT && (
                <p class="small">Missing: {phase.result.missing.map((m) => `#${m} (${MARKER_PLACES[m]})`).join(', ')}</p>
              )}
            </div>
          )}
          {phase.result.ok ? (
            <button class="btn btn-primary btn-block" data-testid="finish-setup" onClick={() => void save({ setupStep: 6 }).then(() => go('puzzle', project.id))}>
              Finish set-up
            </button>
          ) : null}
          <button class={phase.result.ok ? 'btn btn-block' : 'btn btn-primary btn-block'} data-testid="retake-table" onClick={() => setPhase({ kind: 'camera' })}>
            {phase.result.ok ? 'Measure again' : 'Try again'}
          </button>
        </>
      )}
      {phase.kind === 'error' && (
        <>
          <div class="notice notice-bad">{phase.message}</div>
          <button class="btn btn-primary btn-block" onClick={() => setPhase({ kind: 'camera' })}>
            Try again
          </button>
        </>
      )}
    </section>
  );
}
