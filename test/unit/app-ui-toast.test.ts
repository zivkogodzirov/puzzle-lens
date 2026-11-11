/**
 * src/app/ui/toast.ts (M9 part 2): one toast at a time, 8 s by default (decision 22, a11y rule 11), a new one
 * replaces the old one (and the old one's timer can't close the new one), the action runs once and closes it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOAST_MS, currentToast, dismissToast, runToastAction, toast } from '../../src/app/ui/toast';

beforeEach(() => {
  vi.useFakeTimers();
  dismissToast();
});
afterEach(() => {
  dismissToast();
  vi.useRealTimers();
});

describe('toast', () => {
  it('shows for 8 s by default, then closes', () => {
    expect(TOAST_MS).toBe(8000);
    toast({ text: 'Placed' });
    expect(currentToast.value?.text).toBe('Placed');
    vi.advanceTimersByTime(7999);
    expect(currentToast.value?.text).toBe('Placed');
    vi.advanceTimersByTime(1);
    expect(currentToast.value).toBeNull();
  });

  it('keeps its own time when `ms` is given', () => {
    toast({ text: 'Short', ms: 2000 });
    vi.advanceTimersByTime(1999);
    expect(currentToast.value).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(currentToast.value).toBeNull();
  });

  it('shows one at a time: a new toast replaces the old one and gets its full 8 s', () => {
    toast({ text: 'First' });
    vi.advanceTimersByTime(6000);
    toast({ text: 'Second' });
    expect(currentToast.value?.text).toBe('Second');
    // The first one's timer (due at 8 s) must not close the second one.
    vi.advanceTimersByTime(2500);
    expect(currentToast.value?.text).toBe('Second');
    vi.advanceTimersByTime(5500);
    expect(currentToast.value).toBeNull();
  });

  it('runs the action once, then closes', () => {
    const run = vi.fn();
    toast({ text: 'Placed', action: { label: 'Undo', run } });
    const id = currentToast.value!.id;
    runToastAction(id);
    runToastAction(id);
    expect(run).toHaveBeenCalledTimes(1);
    expect(currentToast.value).toBeNull();
    vi.advanceTimersByTime(10_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("an old toast's action or close can't touch a newer toast", () => {
    const first = vi.fn();
    const closeFirst = toast({ text: 'First', action: { label: 'Undo', run: first } });
    const oldId = currentToast.value!.id;
    toast({ text: 'Second' });
    runToastAction(oldId);
    closeFirst();
    expect(first).not.toHaveBeenCalled();
    expect(currentToast.value?.text).toBe('Second');
  });

  it('the returned function closes it early', () => {
    const close = toast({ text: 'Bye' });
    close();
    expect(currentToast.value).toBeNull();
  });
});
