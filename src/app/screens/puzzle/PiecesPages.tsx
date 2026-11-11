/**
 * The pages pushed from the puzzle's **Pieces** tab (M9 part 4, design plan §4 item 7): instead of opening inline,
 * "Which pieces join" and "Sort into trays" each open a full page with "‹ Pieces" back to the tab (no tab bar, no Scan).
 *
 * - `#/joins/<id>`: Which pieces join (MatchesPanel, as before);
 * - `#/sort/<id>`: Sort into trays (TraysPanel, as before), with the pieces of the tapped colour group below it
 *   (their colour letters on them); its "Print tray labels" opens `#/trays/<id>`, whose Back returns here.
 *
 * Both are drawn by the puzzle screen (PuzzleScreen.tsx) in place of the tabs, so they read the same pieces and
 * joins through `usePuzzle()` (nothing is read again on the way in or out), and the piece card and the live views
 * work from them as from a tab. A deep link or a reload opens the page directly.
 */
import { useLayoutEffect, useState } from 'preact/hooks';
import type { FunctionComponent } from 'preact';
import type { Route } from '../../router';
import { TraysPanel, useColourGroups } from '../../components/Trays';
import { MatchesPanel } from '../../components/Matches';
import { answerPair, undoPairAnswer } from '../../../project/pairAnswers';
import { logError, logInfo } from '../../../log/logger';
import { pct } from './shared';
import { usePuzzle } from './context';
import { PiecesGrid, trayTag } from './PiecesGrid';

export interface PiecesPage {
  /** The navigation bar's title (and the page title's first part, shell.ts). */
  title: string;
  Body: FunctionComponent;
}

/** The page for a route (null for every other route: the puzzle's tabs are drawn). */
export function piecesPage(r: Route): PiecesPage | null {
  return r === 'joins' ? JOINS : r === 'sort' ? SORT : null;
}

/**
 * The Pieces tab's filter and place on the page when a page was pushed from it (per puzzle), and when the last
 * page closed: Back to the tab right after returns to them; the tab opened later (from Home…) starts afresh.
 */
const kept = new Map<string, { show: string; scroll: number }>();
let closedAt = -Infinity;

export function keepTab(projectId: string, state: { show: string; scroll: number }): void {
  kept.set(projectId, state);
}

/** What the tab kept, if a page pushed from it closed just now (once: it is forgotten then). */
export function takeKeptTab(projectId: string): { show: string; scroll: number } | null {
  const k = kept.get(projectId) ?? null;
  kept.delete(projectId);
  return k && performance.now() - closedAt < 1000 ? k : null;
}

/** A page starts at the top (the tab it came from keeps its own place, above). */
function useTop() {
  useLayoutEffect(() => {
    scrollTo(0, 0);
    return () => {
      closedAt = performance.now();
    };
  }, []);
}

/** Which pieces join (M6): pairs and squares of 4 to try, with They fit / Don't fit, and the pairs joined so far. */
function JoinsPage() {
  useTop();
  const ctx = usePuzzle();
  const { project, pairs, pairView, allRows, canScan } = ctx;
  const projectId = project.id;
  let body;
  if (!canScan) body = <p class="muted">Reading pieces starts after the set-up.</p>;
  else if (!ctx.piecesRead) body = <p class="muted">Loading…</p>;
  else if (!pairs)
    body = (
      <p class="muted" data-testid="joins-no-grid">
        Which pieces join needs the puzzle’s grid (its columns and rows): set it under More, Puzzle details.
      </p>
    );
  else
    body = (
      <MatchesPanel
        project={project}
        boxUrl={ctx.boxUrl}
        list={pairs.list}
        pieces={allRows}
        joined={[...pairView.joined].map(([key, a]) => ({ key, a: a.a, b: a.b }))}
        onFind={(ids, ps) =>
          ctx.pointOut(
            ids,
            ps.map(([a, b]) => ({ a, b, label: '', confirmed: ids.length > 2 })),
          )
        }
        onAnswer={async (ss, fits, confirmed) => {
          let next = project;
          for (const sp of ss) next = await answerPair(projectId, sp, fits, confirmed, 'matches');
          logInfo(
            'pairs',
            `${fits ? 'They fit' : "Don't fit"}: ${ss.length} pair${ss.length === 1 ? '' : 's'} (${ss.map((sp) => pct(sp.p)).join(', ')} %${confirmed ? ', square ✓' : ''})`,
          );
          ctx.setProject(next);
        }}
        onUndo={async (keys) => {
          let next = project;
          for (const k of keys) next = await undoPairAnswer(projectId, k);
          ctx.setProject(next);
        }}
      />
    );
  return (
    <section class="pieces-page" id="matches-panel" data-testid="joins-page" aria-label="Which pieces join">
      {body}
    </section>
  );
}

/**
 * Sort into trays by colour (M4): the colour groups (one per tray), and below them the pieces on the table with
 * their group's letter, only the tapped group's once one is tapped.
 */
function SortPage() {
  useTop();
  const ctx = usePuzzle();
  const { project, rows, allRows, groups, shownPlaces, sideOf, selectedPiece, openCard, canScan } = ctx;
  const [trayGroup, setTrayGroup] = useState<number | null>(null);
  // The colours are read once the pieces are (they are read on every opening of this page, as when the panel opened).
  const { groups: colourGroups, uneven } = useColourGroups(ctx.piecesRead, project, allRows);
  const onPiecesChanged = () => void ctx.reload().catch((err) => logError('puzzle', 'The piece counts could not be read', err));
  let body;
  if (!canScan) body = <p class="muted">Reading pieces starts after the set-up.</p>;
  else if (!ctx.piecesRead) body = <p class="muted">Loading…</p>;
  else {
    const g = colourGroups && trayGroup !== null ? (colourGroups.groups[trayGroup] ?? null) : null;
    const groupOf = (id: string) => (colourGroups ? colourGroups.of.get(id) : undefined);
    const shown = g ? rows.filter((r) => groupOf(r.id)?.group === g.index) : rows;
    body = (
      <>
        {!rows.length && (
          <p class="muted small" data-testid="sort-empty">
            {allRows.some((q) => q.status === 'tray') ? 'All your scanned pieces are in trays.' : 'No pieces on the table now.'}
          </p>
        )}
        <TraysPanel
          project={project}
          all={allRows}
          table={rows}
          groups={colourGroups}
          uneven={uneven}
          selected={trayGroup}
          onSelect={setTrayGroup}
          onChanged={(np) => (np ? ctx.setProject(np) : onPiecesChanged())}
        />
        {rows.length > 0 && (
          <>
            <h2 class="pieces-page-head" data-testid="sort-grid-head">
              {g ? `Group ${g.letter}` : 'On the table'} <span class="muted">({shown.length})</span>
            </h2>
            <PiecesGrid
              resetKey={trayGroup ?? 'all'}
              rows={shown}
              groups={groups}
              places={shownPlaces}
              sideOf={sideOf}
              selected={selectedPiece}
              onOpen={(id) => openCard(id)}
              trayOf={(id) => trayTag(colourGroups, groupOf(id))}
            />
          </>
        )}
      </>
    );
  }
  return (
    <section class="pieces-page" data-testid="sort-page" aria-label="Sort into trays">
      {body}
    </section>
  );
}

const JOINS: PiecesPage = { title: 'Which pieces join', Body: JoinsPage };
const SORT: PiecesPage = { title: 'Sort into trays', Body: SortPage };
