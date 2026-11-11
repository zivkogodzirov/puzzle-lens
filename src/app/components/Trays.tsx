/**
 * Trays by colour (M4), on the Sort into trays page of a puzzle's Pieces tab (#/sort/<id>, M9 part 4: it opened
 * inline before): the pieces' colour groups as swatches, one per tray; tap one to see its pieces (in the grid
 * below, and lit up on your table photo), then "These went into tray A". Labels to print are on #/trays/<id>.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { go } from '../router';
import { GROUPS, type PieceColours } from '../../cv/colourGroups';
import { loadPieceColours, makeGroups, type Group, type Groups } from '../../project/groups';
import { emptyTray, moveToTray, trayCountOf, trayCounts } from '../../project/trays';
import { updateProject } from '../../project/store';
import type { PieceRow, Project } from '../../project/types';
import { logError, logInfo } from '../../log/logger';
import { Icon } from '../ui/icons';
import { Callout } from '../ui/Callout';
import { TablePhoto } from './TablePhoto';

/** Pieces whose colours the groups need (src/project/groups.ts makeGroups): those on the table. */
const isOnTable = (p: PieceRow) => p.status === 'table';
/** …and, for the tray labels, those in trays too (their pictures are picked by colour). */
const isOnTableOrInTray = (p: PieceRow) => p.status === 'table' || p.status === 'tray';

/**
 * The colour groups of a puzzle's pieces (null while reading the pieces' colours), and how many
 * pieces' colours couldn't be evened out for the light (no measurement of the table around them).
 * `colours` holds the pieces on the table and those in trays: placed and set-aside pieces (most of
 * them, later on) aren't read. Measured 2026-11-10 at 1000 pieces (300 on the table): reading all of
 * them took about 0.5 s on the Mac, without a break for the screen. Tray pieces are read too (about
 * 20 ms per 200) so that pieces taken back out of a tray already have their colours: the groups don't
 * flicker to a different grouping while the new read runs.
 */
export function useColourGroups(
  enabled: boolean,
  project: Project,
  pieces: PieceRow[],
  withTrays = true,
): { groups: Groups | null; colours: Map<string, PieceColours> | null; uneven: number } {
  const [read, setRead] = useState<{ colours: Map<string, PieceColours>; uneven: number } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    // All pieces still go in: the typical light is measured over all of them.
    loadPieceColours(pieces, withTrays ? isOnTableOrInTray : isOnTable)
      .then((m) => live && setRead(m))
      .catch((err) => logError('trays', 'Piece colours could not be read', err));
    return () => {
      live = false;
    };
  }, [enabled, pieces, withTrays]);
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
      setNote(`${n} ${n === 1 ? 'piece' : 'pieces'} in tray ${g.letter}.`);
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
        <Callout kind="good" icon={<Icon name="check" />} role="status" testId="tray-note">
          {note}
        </Callout>
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
            <button class="btn btn-filled" data-testid="tray-move" disabled={busy || !members.length} onClick={() => void move()}>
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
        <Icon name="printer" size={20} /> Print tray labels
      </button>
      {photo && g && <TablePhoto projectId={project.id} pieces={members} colour={g.hex} title={`Group ${g.letter}`} onClose={() => setPhoto(false)} />}
    </div>
  );
}
