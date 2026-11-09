/**
 * "They fit" / "They don't fit" for two pieces (M6): the owner tries a suggested pair and says
 * whether they join. Every answer is kept on the puzzle (Project.pairAnswers) with what the app said
 * then (the pair's chance, and whether a closed 2 × 2 square confirmed it), for the Accuracy page.
 *
 * - **They fit:** the pair is joined; it is shown as joined and not suggested again.
 * - **They don't fit:** the pair is never suggested again; each piece's other partners move up.
 */
import { db } from '../db/db';
import { wilson, type AccuracyRow } from './answers';
import { pairKey, type PairSuggestion } from './pairs';
import type { PairAnswer, Project } from './types';

export interface PairAnswerView {
  /** Joined pairs (pairKey → the answer). */
  joined: Map<string, PairAnswer>;
  /** Pairs that don't join (pairKey). */
  not: Set<string>;
}

export function pairAnswerView(project: Pick<Project, 'pairAnswers'>): PairAnswerView {
  const view: PairAnswerView = { joined: new Map(), not: new Set() };
  for (const a of project.pairAnswers ?? []) {
    if (a.undone) continue;
    const k = pairKey(a.a, a.b, a.dir);
    if (a.fits) {
      view.joined.set(k, a);
      view.not.delete(k);
    } else {
      view.not.add(k);
      view.joined.delete(k);
    }
  }
  return view;
}

export async function answerPair(
  projectId: string,
  pair: Pick<PairSuggestion, 'a' | 'b' | 'dir' | 'p'>,
  fits: boolean,
  confirmed: boolean,
  from: PairAnswer['from'],
): Promise<Project> {
  const d = db();
  return d.transaction('rw', d.projects, async () => {
    const project = await d.projects.get(projectId);
    if (!project) throw new Error('This puzzle is no longer on this iPhone.');
    const now = Date.now();
    const a: PairAnswer = { a: pair.a, b: pair.b, dir: pair.dir, fits, at: now, p: pair.p, confirmed, from };
    const next: Project = { ...project, pairAnswers: [...(project.pairAnswers ?? []), a], updatedAt: Math.max(now, project.updatedAt + 1) };
    await d.projects.put(next);
    return next;
  });
}

/** Takes back the latest answer about a pair (a mistake). */
export async function undoPairAnswer(projectId: string, key: string): Promise<Project> {
  const d = db();
  return d.transaction('rw', d.projects, async () => {
    const project = await d.projects.get(projectId);
    if (!project) throw new Error('This puzzle is no longer on this iPhone.');
    const answers = [...(project.pairAnswers ?? [])];
    for (let i = answers.length - 1; i >= 0; i--)
      if (!answers[i]!.undone && pairKey(answers[i]!.a, answers[i]!.b, answers[i]!.dir) === key) {
        answers[i] = { ...answers[i]!, undone: true };
        break;
      }
    const next: Project = { ...project, pairAnswers: answers, updatedAt: Math.max(Date.now(), project.updatedAt + 1) };
    await d.projects.put(next);
    return next;
  });
}

export interface PairAccuracy {
  answers: number;
  /** Pairs confirmed by a 2 × 2 square, the others, and all. */
  confirmed: AccuracyRow;
  other: AccuracyRow;
  all: AccuracyRow;
  /** Shown chance vs how often they joined. */
  calibration: Array<{ label: string; said: number; right: number; total: number }>;
}

const row = (label: string, xs: PairAnswer[]): AccuracyRow => {
  const right = xs.filter((a) => a.fits).length;
  return { label, right, total: xs.length, range: wilson(right, xs.length) };
};

export function pairAccuracyOf(answers: PairAnswer[]): PairAccuracy {
  const real = answers.filter((a) => !a.undone);
  const bands: Array<[string, number, number]> = [
    ['below 50 %', 0, 0.5],
    ['50–75 %', 0.5, 0.75],
    ['75–90 %', 0.75, 0.9],
    ['90 % and more', 0.9, 1.01],
  ];
  return {
    answers: real.length,
    confirmed: row(
      'Square of 4 ✓',
      real.filter((a) => a.confirmed),
    ),
    other: row(
      'Other pairs',
      real.filter((a) => !a.confirmed),
    ),
    all: row('All', real),
    calibration: bands
      .map(([label, lo, hi]) => {
        const xs = real.filter((a) => a.p >= lo && a.p < hi);
        return { label, said: xs.length ? xs.reduce((s, a) => s + a.p, 0) / xs.length : 0, right: xs.filter((a) => a.fits).length, total: xs.length };
      })
      .filter((b) => b.total > 0),
  };
}
