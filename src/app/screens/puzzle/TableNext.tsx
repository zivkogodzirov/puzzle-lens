/**
 * The Table tab's "Next step" (M9 part 4, design plan §4 item 3): a chip above the tab bar from the joins'
 * "What next" (ctx.pairs.list.next, the same one the Pieces tab's "Which pieces join" shows first), e.g.
 * "4 pieces join · Show me". It opens that card in a sheet: the pieces, the box crop, Point them out, and
 * Not there / They fit. The card is Matches.tsx's own (MatchesPanel, given only the next step: for a square of
 * 4, its four pairs follow it, so one that isn't right can be answered).
 *
 * The sheet follows the joins as they change: after an answer it shows the next step (or "No likely pairs yet").
 */
import { useState } from 'preact/hooks';
import { Icon } from '../../ui/icons';
import { Sheet } from '../../ui/Sheet';
import { MatchesPanel, type MatchList } from '../../components/Matches';
import { pairKey, type PairSuggestion } from '../../../project/pairs';
import { answerPair, undoPairAnswer } from '../../../project/pairAnswers';
import { logInfo } from '../../../log/logger';
import { pct } from './shared';
import { usePuzzle } from './context';

/** The list MatchesPanel gets in the sheet: only the next step (and, for a square, its own pairs). */
export function nextOnly(list: MatchList): MatchList {
  const { next } = list;
  if (!next) return { pairs: [], blocks: [], confirmed: list.confirmed, next: null };
  if (next.kind === 'pair') return { pairs: [next.pair], blocks: [], confirmed: list.confirmed, next };
  const [tl, tr, bl, br] = next.block.ids;
  const own = new Set([pairKey(tl, tr, 1), pairKey(bl, br, 1), pairKey(tl, bl, 2), pairKey(tr, br, 2)]);
  return { pairs: list.pairs.filter((s) => own.has(pairKey(s.a, s.b, s.dir))), blocks: [next.block], confirmed: list.confirmed, next };
}

/** "4 pieces join" / "2 pieces join". */
export function nextWords(next: NonNullable<MatchList['next']>): string {
  return next.kind === 'block' ? '4 pieces join' : '2 pieces join';
}

export function TableNext() {
  const ctx = usePuzzle();
  const { project, pairs, allRows, rows } = ctx;
  const [open, setOpen] = useState(false);
  const next = pairs?.list.next ?? null;
  // The chip: only with a next step (and pieces on the table). The sheet stays while open, whatever comes next.
  if (!pairs || !project.grid || (!open && (!next || !rows.length))) return null;
  // As on the Pieces tab (PiecesTab.tsx, Which pieces join): each answer saved, logged, and the puzzle record updated.
  const onAnswer = async (ss: PairSuggestion[], fits: boolean, confirmed: boolean) => {
    let saved = project;
    for (const sp of ss) saved = await answerPair(project.id, sp, fits, confirmed, 'matches');
    logInfo(
      'pairs',
      `${fits ? 'They fit' : "Don't fit"} (Table, next step): ${ss.length} pair${ss.length === 1 ? '' : 's'} (${ss.map((sp) => pct(sp.p)).join(', ')} %${confirmed ? ', square ✓' : ''})`,
    );
    ctx.setProject(saved);
  };
  const onUndo = async (keys: string[]) => {
    let saved = project;
    for (const k of keys) saved = await undoPairAnswer(project.id, k);
    ctx.setProject(saved);
  };
  return (
    <>
      {next && rows.length > 0 && (
        <div class="table-next">
          <button type="button" class="table-next-chip" data-testid="table-next" aria-haspopup="dialog" onClick={() => setOpen(true)}>
            <span class="table-next-icon" aria-hidden="true">
              <Icon name="link" size={20} />
            </span>
            <span class="table-next-text">
              <span class="table-next-label">Next step</span> <span data-testid="table-next-words">{nextWords(next)}</span>
            </span>
            <span class="table-next-go">Show me</span>
          </button>
        </div>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title="Next step" testId="table-next-sheet">
        <MatchesPanel
          project={project}
          boxUrl={ctx.boxUrl}
          list={nextOnly(pairs.list)}
          pieces={allRows}
          joined={[]}
          onFind={(ids, ps) => {
            setOpen(false);
            ctx.pointOut(
              ids,
              ps.map(([a, b]) => ({ a, b, label: '', confirmed: ids.length > 2 })),
            );
          }}
          onAnswer={onAnswer}
          onUndo={onUndo}
        />
      </Sheet>
    </>
  );
}
