/**
 * Accuracy (M5 part 2, PLAN §5 Settings → Accuracy): how often the app's first suggestion was right,
 * from the owner's Fits / Doesn't fit answers, with a 95 % range (Wilson), by how sure the app was.
 * Pairs (M6): how often two pieces suggested to join did, from "They fit" / "Don't fit".
 * `#/accuracy/<puzzle id>` for one puzzle, `#/accuracy` for all of them.
 */
import { useEffect, useState } from 'preact/hooks';
import { TopBar } from '../components/TopBar';
import { routeArg } from '../router';
import { getProject, listProjects } from '../../project/store';
import { accuracyOf, type Accuracy, type AccuracyRow } from '../../project/answers';
import type { PairAnswer, SpotAnswer } from '../../project/types';
import { pairAccuracyOf, type PairAccuracy } from '../../project/pairAnswers';
import { logError } from '../../log/logger';

const pc = (v: number) => Math.round(v * 100);

function Row({ r, testId }: { r: AccuracyRow; testId: string }) {
  if (!r.total)
    return (
      <tr data-testid={testId}>
        <td>{r.label}</td>
        <td class="muted" colSpan={2}>
          no answers yet
        </td>
      </tr>
    );
  return (
    <tr data-testid={testId}>
      <td>{r.label}</td>
      <td>
        <strong>
          {r.right} of {r.total}
        </strong>{' '}
        <span class="nw">({pc(r.right / r.total)} %)</span>
      </td>
      <td class="muted small">
        range{' '}
        <span class="nw">
          {pc(r.range[0])}–{pc(r.range[1])} %
        </span>
      </td>
    </tr>
  );
}

export function AccuracyScreen() {
  const id = routeArg.value;
  const [state, setState] = useState<{ name: string; acc: Accuracy; pairs: PairAccuracy } | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      let answers: SpotAnswer[] = [];
      let pairAnswers: PairAnswer[] = [];
      let name = 'All your puzzles';
      if (id) {
        const p = await getProject(id);
        answers = p?.answers ?? [];
        pairAnswers = p?.pairAnswers ?? [];
        name = p?.name ?? 'This puzzle';
      } else
        for (const p of await listProjects()) {
          answers.push(...(p.answers ?? []));
          pairAnswers.push(...(p.pairAnswers ?? []));
        }
      if (live) setState({ name, acc: accuracyOf(answers), pairs: pairAccuracyOf(pairAnswers) });
    })().catch((err) => logError('accuracy', 'Accuracy could not be read', err));
    return () => {
      live = false;
    };
  }, [id]);

  const a = state?.acc;
  const pa = state?.pairs;
  return (
    <main class="screen">
      {/* One puzzle's answers: back to that puzzle (under its name). All puzzles: back to Settings, where it opens from. */}
      <TopBar
        title="How often is the app right?"
        back={id ? { label: state?.name ?? 'Puzzle', route: 'puzzle', arg: id } : { label: 'Settings', route: 'settings' }}
      />
      {!a ? (
        <p class="muted small">Loading…</p>
      ) : (
        <div data-testid="accuracy">
          <p>
            <strong>{state!.name}</strong>: {a.answers} answer{a.answers === 1 ? '' : 's'}
            {a.placed ? (
              <>
                {' '}
                · {a.placed} piece{a.placed === 1 ? '' : 's'} went in
                {a.triesPerPiece !== null && <>, on average on try {a.triesPerPiece.toFixed(1)}</>}
              </>
            ) : null}
            .
          </p>
          {a.answers === 0 && !pa?.answers ? (
            <p class="muted" data-testid="accuracy-empty">
              No answers yet. When you try a piece in a suggested spot, tap <strong>It fits</strong> or <strong>Not there</strong> (on the piece, in Fill this
              spot, or in the live view), or <strong>They fit</strong> for two pieces in Which pieces join. Your answers show here.
            </p>
          ) : a.answers === 0 ? null : (
            <>
              <h2>The app's first choice</h2>
              <table class="accuracy-table">
                <tbody>
                  <Row r={a.first.strong} testId="acc-strong" />
                  <Row r={a.first.likely} testId="acc-likely" />
                  <Row r={a.first.several} testId="acc-several" />
                  <Row r={a.first.all} testId="acc-all" />
                </tbody>
              </table>
              <p class="muted small">
                Right = it fitted where the app suggested first. "Range" is the 95 % range: with few answers it is wide, and it narrows as you answer more
                (about 20 answers per row give a useful idea).
              </p>
              {a.calibration.length > 0 && (
                <>
                  <h2>What it said vs what happened</h2>
                  <table class="accuracy-table" data-testid="acc-calibration">
                    <tbody>
                      {a.calibration.map((b) => (
                        <tr key={b.label}>
                          <td>
                            Said <span class="nw">{b.label}</span>
                          </td>
                          <td>
                            right {b.right} of {b.total} <span class="nw">({pc(b.right / b.total)} %)</span>
                          </td>
                          <td class="muted small">said {pc(b.said)} % on average</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p class="muted small">When the percentages it shows are honest, the two columns roughly agree.</p>
                </>
              )}
            </>
          )}
          {pa && pa.answers > 0 && (
            <div data-testid="acc-pairs">
              <h2>Which pieces join</h2>
              <p class="small">
                {pa.answers} pair{pa.answers === 1 ? '' : 's'} tried.
              </p>
              <table class="accuracy-table">
                <tbody>
                  <Row r={pa.confirmed} testId="acc-pairs-square" />
                  <Row r={pa.other} testId="acc-pairs-other" />
                  <Row r={pa.all} testId="acc-pairs-all" />
                </tbody>
              </table>
              <p class="muted small">
                Right = the two pieces fitted together. "Square of 4 ✓" are pairs that were part of a square whose four pairs all agreed.
              </p>
              {pa.calibration.length > 0 && (
                <table class="accuracy-table" data-testid="acc-pairs-calibration">
                  <tbody>
                    {pa.calibration.map((b) => (
                      <tr key={b.label}>
                        <td>
                          Said <span class="nw">{b.label}</span>
                        </td>
                        <td>
                          right {b.right} of {b.total} <span class="nw">({pc(b.right / b.total)} %)</span>
                        </td>
                        <td class="muted small">said {pc(b.said)} % on average</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
