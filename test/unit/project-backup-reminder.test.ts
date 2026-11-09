/** Backup reminders (M7 part 3, src/project/backupReminder.ts). */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, eraseAllData } from '../../src/db/db';
import { createProject, getProject } from '../../src/project/store';
import { BACKUP_REMIND, backupReminder, markBackedUp, snoozeBackupReminder } from '../../src/project/backupReminder';
import type { PieceRow } from '../../src/project/types';

const DAY = 24 * 3600 * 1000;
const T0 = Date.UTC(2026, 10, 1);
const rows = (n: number, at: number) => Array.from({ length: n }, () => ({ updatedAt: at }));

beforeEach(async () => {
  await eraseAllData();
});

describe('backup reminder', () => {
  it('never backed up: only once there is something worth keeping', () => {
    expect(backupReminder({}, rows(BACKUP_REMIND.NEVER_MIN - 1, T0), T0)).toBeNull();
    expect(backupReminder({}, rows(BACKUP_REMIND.NEVER_MIN, T0), T0)).toMatchObject({ never: true, pieces: BACKUP_REMIND.NEVER_MIN });
  });

  it('after a backup: when something changed and the backup is old, or a lot changed', () => {
    const p = { lastBackup: { at: T0, pieces: 50, answers: 0 } };
    // Nothing changed: never, however old.
    expect(backupReminder(p, rows(50, T0 - 1), T0 + 30 * DAY)).toBeNull();
    // A few changes, recent backup: not yet.
    const few = [...rows(48, T0 - 1), ...rows(2, T0 + 1)];
    expect(backupReminder(p, few, T0 + 1 * DAY)).toBeNull();
    // A few changes, backup 3 days old: yes.
    expect(backupReminder(p, few, T0 + 3 * DAY)).toMatchObject({ never: false, days: 3, pieces: 2, answers: 0 });
    // Many changes: yes at once.
    expect(backupReminder(p, rows(BACKUP_REMIND.MANY_CHANGES, T0 + 1), T0 + 1000)).toMatchObject({ days: 0, pieces: BACKUP_REMIND.MANY_CHANGES });
    // Answers count as changes.
    const answered = { ...p, answers: [{ at: T0 + 5 } as never], pairAnswers: [{ at: T0 + 6 } as never, { at: T0 - 6 } as never] };
    expect(backupReminder(answered, rows(50, T0 - 1), T0 + 4 * DAY)).toMatchObject({ pieces: 0, answers: 2 });
  });

  it('"Not now" hides it for a day; a backup taken resets the count and the snooze', async () => {
    const pz = await createProject({ name: 'The Kiss', pieceCount: 1000 });
    await db().pieces.bulkPut(Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, projectId: pz.id, status: 'table', updatedAt: T0 }) as unknown as PieceRow));
    const snoozed = await snoozeBackupReminder(pz.id, T0);
    const all = await db().pieces.toArray();
    expect(backupReminder(snoozed, all, T0 + 3600 * 1000)).toBeNull();
    expect(backupReminder(snoozed, all, T0 + 25 * 3600 * 1000)).toMatchObject({ never: true });
    const backed = await markBackedUp(pz.id, T0 + 2 * DAY);
    expect(backed.lastBackup).toEqual({ at: T0 + 2 * DAY, pieces: 30, answers: 0 });
    expect(backed.backupSnoozedUntil).toBeNull();
    expect((await getProject(pz.id))!.lastBackup!.at).toBe(T0 + 2 * DAY);
    expect(backupReminder(backed, all, T0 + 10 * DAY)).toBeNull();
  });
});
