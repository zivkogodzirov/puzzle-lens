/**
 * Toasts (M9 part 2, design plan §3.5 and decision 22): a short message in a capsule above the action bar or
 * tab bar, with at most one action (usually "Undo"). One at a time: a new toast replaces the one showing.
 * Shown for 8 s unless `ms` says otherwise. The capsule is drawn by <ToastHost /> (mounted once in App via
 * <UiHost />), inside a permanent role=status region, so VoiceOver reads each one.
 *
 *   import { toast } from '../ui/toast';
 *   toast({ text: 'Placed at column 4 · row 2', action: { label: 'Undo', run: () => undoPlace(id) } });
 *
 * Pure logic (no DOM), so the queue and its timing are unit-tested (test/unit/app-ui-toast.test.ts).
 */
import { signal } from '@preact/signals';

export interface ToastAction {
  /** The button's word, e.g. "Undo". */
  label: string;
  /** Runs when the button is tapped; the toast then closes. */
  run: () => void;
}

export interface ToastOptions {
  text: string;
  action?: ToastAction;
  /** How long it shows, in ms (default 8000: decision 22 / a11y rule 11, at least 8 s for an Undo). */
  ms?: number;
}

export interface ShownToast {
  id: number;
  text: string;
  action?: ToastAction;
  ms: number;
}

export const TOAST_MS = 8000;

/** The toast showing now, or null. */
export const currentToast = signal<ShownToast | null>(null);

let nextId = 1;
let timer: ReturnType<typeof setTimeout> | null = null;

function clearTimer(): void {
  if (timer != null) clearTimeout(timer);
  timer = null;
}

/** Shows a toast (replacing any showing one). Returns a function that closes this toast, if it is still showing. */
export function toast(opts: ToastOptions): () => void {
  clearTimer();
  const id = nextId++;
  const ms = opts.ms ?? TOAST_MS;
  currentToast.value = { id, text: opts.text, action: opts.action, ms };
  if (ms > 0 && Number.isFinite(ms)) timer = setTimeout(() => dismissToast(id), ms);
  return () => dismissToast(id);
}

/** Closes the toast showing now (or only toast `id`, when given). */
export function dismissToast(id?: number): void {
  const cur = currentToast.value;
  if (!cur || (id != null && cur.id !== id)) return;
  clearTimer();
  currentToast.value = null;
}

/** The toast's button: runs its action once, then closes it. */
export function runToastAction(id: number): void {
  const cur = currentToast.value;
  if (!cur || cur.id !== id) return;
  dismissToast(id);
  cur.action?.run();
}
