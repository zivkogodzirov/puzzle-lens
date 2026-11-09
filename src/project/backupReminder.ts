/**
 * Backup reminders (M7 part 3, PLAN §4 "the full version, with reminders"). Everything lives on
 * the phone only, so a lost or reset iPhone loses the puzzle unless a backup was taken off it. The
 * puzzle page reminds the owner when there's something worth saving:
 *
 * - never backed up, once at least NEVER_MIN pieces have been read;
 * - otherwise when something changed since the last backup (pieces read or moved, answers) and
 *   either the backup is older than OLD_DAYS or at least MANY_CHANGES things changed.
 *
 * "Not now" hides the reminder for SNOOZE_H hours. A backup counts once it has left the app (shared,
 * or downloaded).
 */
import { db } from '../db/db';
import type { PieceRow, Project } from './types';

export const BACKUP_REMIND = {
  NEVER_MIN: 20,
  OLD_DAYS: 3,
  MANY_CHANGES: 100,
  SNOOZE_H: 24,
};

const DAY = 24 * 3600 * 1000;

export interface BackupReminder {
  /** Never backed up. */
  never: boolean;
  /** Days since the last backup (0 = today). */
  days: number;
  /** Pieces read or changed, and answers given, since the last backup. */
  pieces: number;
  answers: number;
}

/** What changed since the last backup. */
export function changesSinceBackup(project: Pick<Project, 'lastBackup' | 'answers' | 'pairAnswers'>, pieces: Pick<PieceRow, 'updatedAt'>[]) {
  const since = project.lastBackup?.at ?? 0;
  return {
    pieces: pieces.filter((p) => p.updatedAt > since).length,
    answers: (project.answers ?? []).filter((a) => a.at > since).length + (project.pairAnswers ?? []).filter((a) => a.at > since).length,
  };
}

/** The reminder to show now, or null. */
export function backupReminder(
  project: Pick<Project, 'lastBackup' | 'backupSnoozedUntil' | 'answers' | 'pairAnswers'>,
  pieces: Pick<PieceRow, 'updatedAt'>[],
  now = Date.now(),
): BackupReminder | null {
  if (project.backupSnoozedUntil && now < project.backupSnoozedUntil) return null;
  const ch = changesSinceBackup(project, pieces);
  const last = project.lastBackup;
  if (!last) return pieces.length >= BACKUP_REMIND.NEVER_MIN ? { never: true, days: 0, ...ch } : null;
  const days = Math.floor((now - last.at) / DAY);
  const changed = ch.pieces + ch.answers;
  if (!changed) return null;
  if (days >= BACKUP_REMIND.OLD_DAYS || changed >= BACKUP_REMIND.MANY_CHANGES) return { never: false, days, ...ch };
  return null;
}

/** The backup has left the app (shared or downloaded): remember when, and how much there was. */
export async function markBackedUp(projectId: string, now = Date.now()): Promise<Project> {
  const d = db();
  return d.transaction('rw', d.projects, d.pieces, async () => {
    const project = await d.projects.get(projectId);
    if (!project) throw new Error('This puzzle is no longer on this iPhone.');
    const pieces = await d.pieces.where('projectId').equals(projectId).count();
    const answers = (project.answers?.length ?? 0) + (project.pairAnswers?.length ?? 0);
    const next: Project = { ...project, lastBackup: { at: now, pieces, answers }, backupSnoozedUntil: null };
    await d.projects.put(next);
    return next;
  });
}

/** "Not now": no reminder for SNOOZE_H hours. */
export async function snoozeBackupReminder(projectId: string, now = Date.now()): Promise<Project> {
  const d = db();
  return d.transaction('rw', d.projects, async () => {
    const project = await d.projects.get(projectId);
    if (!project) throw new Error('This puzzle is no longer on this iPhone.');
    const next: Project = { ...project, backupSnoozedUntil: now + BACKUP_REMIND.SNOOZE_H * 3600 * 1000 };
    await d.projects.put(next);
    return next;
  });
}
