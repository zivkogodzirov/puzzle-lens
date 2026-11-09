/**
 * Table-contrast check on the puzzle page (M4): which parts of the box picture are close to your
 * table's colour (src/cv/contrast.ts), so pieces from there are harder for a scan to find.
 */
import { useEffect, useState } from 'preact/hooks';
import { closeToTable, CONTRAST, hardShare, labStatsOf, tableInBox, type Lab } from '../../cv/contrast';
import { labImage, patchStats, PATCH_SIZE } from '../../cv/placement';
import { loadPatches, tableLight } from '../../project/groups';
import { getBlob } from '../../project/store';
import type { PieceRow, Project } from '../../project/types';
import { logWarn } from '../../log/logger';

const CELL = 8;

async function boxLab(blob: Blob, cols: number, rows: number): Promise<Float32Array> {
  const bmp = await createImageBitmap(blob);
  const w = cols * CELL;
  const h = rows * CELL;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const id = ctx.getImageData(0, 0, w, h);
  return labImage({ data: id.data, width: w, height: h, stride: w * 4 }, w, h);
}

/** Pieces needed before the pieces' colours are matched to the whole box picture (RESEARCH §9.5). */
const MATCH_MIN = 15;

export function TableContrast({ project, pieces, boxUrl }: { project: Project; pieces: PieceRow[]; boxUrl: string }) {
  const [res, setRes] = useState<{ share: number; close: Float32Array } | null>(null);
  const [show, setShow] = useState(false);
  const grid = project.grid;
  const blobId = project.box?.rectifiedBlobId;
  useEffect(() => {
    if (!grid || !blobId) return;
    let live = true;
    void (async () => {
      const light = await tableLight(pieces);
      const blob = await getBlob(blobId);
      if (!light || !blob || !live) return;
      const l = labImage({ data: new Uint8Array([...light.map(Math.round), 255]), width: 1, height: 1, stride: 4 }, 1, 1);
      const lab = await boxLab(blob, grid.cols, grid.rows);
      // The table's colour as it would look in the box picture: pieces' colours (all of them) matched to the whole picture's.
      const patches = await loadPatches(pieces);
      const from = patches.length >= MATCH_MIN ? patchStats(patches.map((rgba) => ({ size: PATCH_SIZE, rgba }))) : null;
      const match = from ? { from, to: labStatsOf(lab) } : null;
      const close = closeToTable(lab, grid.cols, grid.rows, CELL, tableInBox([l[0]!, l[1]!, l[2]!] as Lab, match));
      if (live) setRes({ share: hardShare(close), close });
    })().catch((err) => logWarn('contrast', 'The table-contrast check could not run', err));
    return () => {
      live = false;
    };
  }, [blobId, grid?.cols, grid?.rows, pieces.length]);
  if (!res || !grid) return null;
  const pc = Math.round(res.share * 100);
  const aspect = project.box ? project.box.width / project.box.height : grid.cols / grid.rows;
  const map = show && (
    <svg
      class="spot-box"
      style={{ aspectRatio: String(aspect) }}
      viewBox={`0 0 ${grid.cols} ${grid.rows}`}
      preserveAspectRatio="none"
      data-testid="contrast-map"
    >
      <image href={boxUrl} x={0} y={0} width={grid.cols} height={grid.rows} preserveAspectRatio="none" />
      {[...res.close].map((v, i) =>
        v >= CONTRAST.cellShare ? <rect key={i} x={i % grid.cols} y={Math.floor(i / grid.cols)} width={1} height={1} class="contrast-cell" /> : null,
      )}
    </svg>
  );
  const toggle = (
    <button class="btn btn-small" data-testid="contrast-show" onClick={() => setShow(!show)}>
      {show ? 'Hide' : 'Show where'}
    </button>
  );
  if (res.share < 0.005)
    return (
      <p class="small muted" data-testid="contrast-ok">
        Table contrast ✓ Your table’s colour stands out from the whole picture.
      </p>
    );
  if (res.share < CONTRAST.warnShare)
    return (
      <div class="small muted" data-testid="contrast-ok">
        <p>
          Table contrast ✓ Only {pc < 1 ? 'under 1' : `about ${pc}`} % of the picture is close to your table’s colour: pieces from there are a bit harder to
          find. {toggle}
        </p>
        {map}
      </div>
    );
  return (
    <div class="notice notice-warn small" data-testid="contrast-warn">
      <p>
        <strong>Table contrast:</strong> about {pc} % of the picture is close to your table’s colour. Pieces from there stand out little, so a scan may miss
        them: check they’re found, or sort them on a darker cloth. {toggle}
      </p>
      {map}
    </div>
  );
}
