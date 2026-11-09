/**
 * Trays by colour on the puzzle page (M4): the pieces' colour groups as swatches, one per tray; tap
 * one to see its pieces (in the catalog, and lit up on your table photo), then "These went into
 * tray A". Labels to print are on #/trays/<id>.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { go } from '../router';
import { db } from '../../db/db';
import { applyH, invertH } from '../../geo/homography';
import { GROUPS, type PieceColours } from '../../cv/colourGroups';
import { loadPieceColours, makeGroups, type Group, type Groups } from '../../project/groups';
import { emptyTray, moveToTray, trayCountOf, trayCounts } from '../../project/trays';
import { getBlob, updateProject } from '../../project/store';
import type { PieceRow, Project, SnapRow } from '../../project/types';
import { logError, logInfo } from '../../log/logger';

/**
 * The colour groups of a puzzle's pieces (null while reading the pieces' colours), and how many
 * pieces' colours couldn't be evened out for the light (no measurement of the table around them).
 */
export function useColourGroups(
  enabled: boolean,
  project: Project,
  pieces: PieceRow[],
): { groups: Groups | null; colours: Map<string, PieceColours> | null; uneven: number } {
  const [read, setRead] = useState<{ colours: Map<string, PieceColours>; uneven: number } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    loadPieceColours(pieces)
      .then((m) => live && setRead(m))
      .catch((err) => logError('trays', 'Piece colours could not be read', err));
    return () => {
      live = false;
    };
  }, [enabled, pieces]);
  const groups = useMemo(() => (read ? makeGroups(project, pieces, read.colours) : null), [read, project.trays, pieces]);
  return { groups, colours: read?.colours ?? null, uneven: read?.uneven ?? 0 };
}

export function TraysPanel({
  project,
  all,
  table,
  groups,
  uneven = 0,
  selected,
  onSelect,
  onChanged,
}: {
  project: Project;
  all: PieceRow[];
  table: PieceRow[];
  groups: Groups | null;
  /** Pieces whose colours couldn't be evened out for the light. */
  uneven?: number;
  selected: number | null;
  onSelect: (g: number | null) => void;
  /** After pieces moved or the puzzle changed (reload pieces and puzzle). */
  onChanged: (p?: Project) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const count = trayCountOf(project);
  const inTrays = trayCounts(all);
  const onTable = useMemo(() => {
    const n = new Map<number, number>();
    if (groups) for (const p of table) if (groups.of.has(p.id)) n.set(groups.of.get(p.id)!.group, (n.get(groups.of.get(p.id)!.group) ?? 0) + 1);
    return n;
  }, [groups, table]);
  const setCount = async (n: number) => {
    onSelect(null);
    try {
      onChanged(await updateProject(project.id, { trays: { count: n, colours: project.trays?.colours ?? null } }));
    } catch (err) {
      logError('trays', 'The number of trays could not be saved', err);
    }
  };
  const g: Group | null = groups && selected !== null ? (groups.groups[selected] ?? null) : null;
  const members = g && groups ? table.filter((p) => groups.of.get(p.id)?.group === g.index) : [];
  const mixed = g && groups ? members.filter((p) => groups.of.get(p.id)?.also !== null).length : 0;
  const move = async () => {
    if (!g || !groups || !members.length) return;
    setBusy(true);
    try {
      const n = await moveToTray(
        project.id,
        members.map((p) => p.id),
        g.letter,
        groups.groups.map((x) => x.lab),
      );
      logInfo('trays', `${n} pieces went into tray ${g.letter}`);
      setNote(`${n} ${n === 1 ? 'piece' : 'pieces'} in tray ${g.letter} ✓`);
      onSelect(null);
      onChanged();
    } catch (err) {
      logError('trays', 'The pieces could not be put into the tray', err);
    }
    setBusy(false);
  };
  const putBack = async (letter: string) => {
    setBusy(true);
    try {
      const n = await emptyTray(project.id, letter);
      logInfo('trays', `${n} pieces from tray ${letter} back on the table`);
      setNote(`Tray ${letter}: ${n} ${n === 1 ? 'piece' : 'pieces'} back on the table.`);
      onChanged();
    } catch (err) {
      logError('trays', 'The tray could not be emptied', err);
    }
    setBusy(false);
  };
  return (
    <div class="card trays" data-testid="trays">
      <p class="small">
        Your pieces grouped by their <strong>main colour</strong>, one group per tray (a bowl, a box lid). Tap a group: its pieces show below and light up on
        your table photo. Put them in the tray, then tap <strong>“These went into tray …”</strong>.
      </p>
      <div class="row tray-count" data-testid="tray-count">
        <span>Trays:</span>
        <button class="btn btn-small" aria-label="Fewer trays" disabled={groups?.fixed || count <= GROUPS.min} onClick={() => void setCount(count - 1)}>
          −
        </button>
        <strong data-testid="tray-count-value">{count}</strong>
        <button class="btn btn-small" aria-label="More trays" disabled={groups?.fixed || count >= GROUPS.max} onClick={() => void setCount(count + 1)}>
          +
        </button>
        {groups?.fixed ? (
          <span class="muted small">Fixed while pieces are in trays</span>
        ) : groups && groups.groups.length < count ? (
          <span class="muted small" data-testid="tray-few-colours">
            Only {groups.groups.length} different colours so far
          </span>
        ) : null}
      </div>
      {!groups ? (
        <p class="muted small" data-testid="trays-reading">
          Reading the pieces’ colours…
        </p>
      ) : (
        <div class="chips tray-groups" role="group" aria-label="Colour groups" data-testid="tray-groups">
          {groups.groups.map((x) => (
            <button
              key={x.letter}
              class="chip tray-chip"
              aria-pressed={selected === x.index}
              data-testid={`tray-group-${x.letter}`}
              onClick={() => (setNote(null), onSelect(selected === x.index ? null : x.index))}
            >
              <span class="swatch" style={{ background: x.hex }} aria-hidden="true" />
              {x.letter} {onTable.get(x.index) ?? 0}
              {inTrays.get(x.letter) ? <span class="muted small"> · {inTrays.get(x.letter)} in tray</span> : null}
            </button>
          ))}
        </div>
      )}
      {groups && uneven > 0 && (
        <p class="muted small" data-testid="tray-uneven">
          {uneven} {uneven === 1 ? 'piece was' : 'pieces were'} scanned without measuring the light around {uneven === 1 ? 'it' : 'them'} (and the photo is no
          longer kept), so a lamp can put {uneven === 1 ? 'it' : 'them'} in the wrong group. Scanning again fixes that.
        </p>
      )}
      {note && (
        <div class="notice notice-good small" role="status" data-testid="tray-note">
          {note}
        </div>
      )}
      {g && (
        <div class="tray-detail" data-testid="tray-detail">
          <p>
            <strong>Group {g.letter}</strong>: {members.length} {members.length === 1 ? 'piece' : 'pieces'} on the table
            {mixed ? ` (${mixed} also ${mixed === 1 ? 'has' : 'have'} a lot of another colour: marked “+”)` : ''}.
          </p>
          <div class="row two-up">
            <button class="btn" data-testid="tray-photo" disabled={!members.length} onClick={() => setPhoto(true)}>
              Show on my table photo
            </button>
            <button class="btn btn-primary" data-testid="tray-move" disabled={busy || !members.length} onClick={() => void move()}>
              These {members.length} went into tray {g.letter}
            </button>
          </div>
        </div>
      )}
      {inTrays.size > 0 && (
        <div class="tray-summary small" data-testid="tray-summary">
          <p>
            <strong>In trays:</strong> {[...inTrays].map(([t, n]) => `${t} ${n}`).join(' · ')}
          </p>
          <div class="chips">
            {[...inTrays.keys()].map((t) => (
              <button key={t} class="btn btn-small" disabled={busy} data-testid={`tray-back-${t}`} onClick={() => void putBack(t)}>
                Put tray {t} back on the table
              </button>
            ))}
          </div>
        </div>
      )}
      <button class="btn btn-block" data-testid="print-tray-labels" disabled={!groups} onClick={() => go('trays', project.id)}>
        🖨 Print tray labels
      </button>
      {photo && g && <TablePhoto projectId={project.id} pieces={members} colour={g.hex} title={`Group ${g.letter}`} onClose={() => setPhoto(false)} />}
    </div>
  );
}

interface PhotoView {
  snap: SnapRow;
  url: string;
  /** The pieces' outlines in this photo (px, flat x, y), each in its colour. */
  outlines: Array<{ pts: number[]; colour: string }>;
  view: [number, number, number, number];
}

/**
 * The newest scan photos that show the pieces (up to 3, the fewest that show them all), with those
 * pieces lit up: everything else darkened, their outlines in the group's colour.
 */
export function TablePhoto({
  projectId,
  pieces,
  colour,
  colourOf,
  title,
  onClose,
}: {
  projectId: string;
  pieces: PieceRow[];
  /** The outline colour (or per piece with colourOf). */
  colour: string;
  colourOf?: (p: PieceRow) => string;
  title: string;
  onClose: () => void;
}) {
  const [views, setViews] = useState<PhotoView[] | null>(null);
  const [missing, setMissing] = useState(0);
  const [k, setK] = useState(0);
  useEffect(() => {
    let live = true;
    const made: string[] = [];
    void (async () => {
      const snaps = (await db().snaps.where('projectId').equals(projectId).toArray())
        .filter((s) => (s.kind === 'overview' || s.kind === 'detail') && s.blobId && s.imgToTable)
        // Overviews first, then the newest.
        .sort((a, b) => Number(b.kind === 'overview') - Number(a.kind === 'overview') || b.ts - a.ts);
      const left = new Set(pieces.map((p) => p.id));
      const out: PhotoView[] = [];
      const inPhoto = (s: SnapRow, p: PieceRow, H: number[]) => {
        const [x, y] = applyH(H, [p.table.x, p.table.y]);
        return x >= 0 && y >= 0 && x < s.width && y < s.height;
      };
      while (left.size && out.length < 3) {
        let best: { s: SnapRow; H: number[]; ids: string[] } | null = null;
        for (const s of snaps) {
          if (out.some((v) => v.snap.id === s.id)) continue;
          const H = invertH(s.imgToTable!);
          if (!H) continue;
          const ids = pieces.filter((p) => left.has(p.id) && inPhoto(s, p, H)).map((p) => p.id);
          if (ids.length > (best?.ids.length ?? 0)) best = { s, H, ids };
        }
        if (!best) break;
        const blob = await getBlob(best.s.blobId!);
        if (!blob) break;
        const url = URL.createObjectURL(blob);
        made.push(url);
        const outlines: PhotoView['outlines'] = [];
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (const p of pieces.filter((q) => best!.ids.includes(q.id))) {
          const o = p.outlineMm;
          const pts: number[] = [];
          for (let i = 0; i + 1 < o.length; i += 2) {
            const [x, y] = applyH(best.H, [p.table.x + o[i]!, p.table.y + o[i + 1]!]);
            pts.push(x, y);
            x0 = Math.min(x0, x);
            y0 = Math.min(y0, y);
            x1 = Math.max(x1, x);
            y1 = Math.max(y1, y);
          }
          outlines.push({ pts, colour: colourOf?.(p) ?? colour });
          left.delete(p.id);
        }
        // Show the part of the photo with these pieces (with room around them), at least a third of it.
        const W = best.s.width;
        const Hh = best.s.height;
        const pad = 0.15 * Math.max(x1 - x0, y1 - y0, 0.2 * Math.max(W, Hh));
        let vw = Math.max(x1 - x0 + 2 * pad, W / 3);
        let vh = Math.max(y1 - y0 + 2 * pad, Hh / 3);
        vw = Math.min(vw, W);
        vh = Math.min(vh, Hh);
        const vx = Math.max(0, Math.min(W - vw, (x0 + x1) / 2 - vw / 2));
        const vy = Math.max(0, Math.min(Hh - vh, (y0 + y1) / 2 - vh / 2));
        out.push({ snap: best.s, url, outlines, view: [vx, vy, vw, vh] });
      }
      if (live) {
        setViews(out);
        setMissing(left.size);
      }
    })().catch((err) => logError('trays', 'The table photo could not be shown', err));
    return () => {
      live = false;
      for (const u of made) URL.revokeObjectURL(u);
    };
  }, [projectId, pieces]);
  const v = views?.[k];
  const pts = (o: number[]) => o.reduce((s, val, i) => s + (i % 2 ? `,${val.toFixed(0)} ` : `${val.toFixed(0)}`), '');
  return (
    <div class="photo-result table-photo" data-testid="table-photo">
      <div class="row table-photo-bar">
        <strong class="grow">
          {title}: {pieces.length - missing} lit up
          {views && views.length > 1 ? ` · photo ${k + 1} of ${views.length}` : ''}
        </strong>
        {views && views.length > 1 && (
          <button class="btn btn-small" data-testid="table-photo-next" onClick={() => setK((k + 1) % views.length)}>
            Next photo
          </button>
        )}
        <button class="btn btn-small" data-testid="table-photo-close" onClick={onClose}>
          Close
        </button>
      </div>
      {!views ? (
        <p class="muted">Loading your photo…</p>
      ) : !v ? (
        <p class="muted" data-testid="table-photo-none">
          None of your saved scan photos shows these pieces (only the last 10 photos are kept). Scan the table again.
        </p>
      ) : (
        <svg viewBox={v.view.join(' ')} preserveAspectRatio="xMidYMid meet" data-testid="table-photo-svg">
          <defs>
            <mask id="lit">
              <rect x={0} y={0} width={v.snap.width} height={v.snap.height} fill="#fff" />
              {v.outlines.map((o, i) => (
                <polygon key={i} points={pts(o.pts)} fill="#000" stroke="#000" stroke-width={v.view[2] / 60} />
              ))}
            </mask>
          </defs>
          <image href={v.url} x={0} y={0} width={v.snap.width} height={v.snap.height} />
          <rect x={0} y={0} width={v.snap.width} height={v.snap.height} fill="#000" fill-opacity="0.6" mask="url(#lit)" />
          {v.outlines.map((o, i) => (
            <polygon key={i} points={pts(o.pts)} fill="none" stroke={o.colour} stroke-width="4" vector-effect="non-scaling-stroke" class="lit-outline" />
          ))}
        </svg>
      )}
      {missing > 0 && views && (
        <p class="muted small" data-testid="table-photo-missing">
          {missing} of them {missing === 1 ? 'isn’t' : 'aren’t'} on a saved photo.
        </p>
      )}
    </div>
  );
}
