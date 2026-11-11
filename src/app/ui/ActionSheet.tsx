/**
 * Action sheet (M9 part 2, design plan §3.5 and decision 22): iPhone-style choices from the bottom, with
 * Cancel in its own box below. Only for big destructive actions (delete the puzzle, delete all scanned
 * pieces); frequent or reversible ones get an Undo toast instead (ui/toast.ts).
 * - role=alertdialog with aria-modal; focus starts on Cancel (the safe choice) and returns afterwards;
 * - a tap on the dimmed page or Escape is Cancel.
 *
 * Two ways to use it:
 *
 *   // 1. Ask and wait (needs <UiHost /> in App, which is there):
 *   if (await confirmAction({ title: 'Delete "Harbour"?', message: 'Its photos and pieces go too. This can't be undone.',
 *                             confirmLabel: 'Delete puzzle' })) await deletePuzzle(id);
 *
 *   // 2. As a component, for more than one choice:
 *   <ActionSheet open={open} onClose={() => setOpen(false)} title="…" actions={[{ label: 'Delete', destructive: true, run: … }]} />
 */
import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useId, useRef } from 'preact/hooks';
import { useModalFocus, usePresence } from './modal';

export interface SheetAction {
  label: string;
  /** Red words (deleting, erasing). */
  destructive?: boolean;
  run: () => void;
  testId?: string;
}

export interface ActionSheetProps {
  open: boolean;
  /** Called for Cancel, a tap outside and Escape, and after any action has run. */
  onClose: () => void;
  /** A short question or statement, e.g. 'Delete "Harbour"?' */
  title?: ComponentChildren;
  /** One or two sentences: what happens, and whether it can be undone. */
  message?: ComponentChildren;
  actions: SheetAction[];
  cancelLabel?: string;
  testId?: string;
}

export function ActionSheet({ open, onClose, title, message, actions, cancelLabel = 'Cancel', testId }: ActionSheetProps) {
  const { mounted, closing } = usePresence(open);
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const msgId = useId();
  useModalFocus(open, dialog, onClose, cancel);
  if (!mounted) return null;
  return (
    <div class={`ui-sheet-root${closing ? ' is-closing' : ''}`}>
      <div class="ui-scrim" data-testid={testId ? `${testId}-scrim` : 'ui-scrim'} onClick={onClose} aria-hidden="true" />
      <div
        ref={dialog}
        class="ui-action"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={message ? msgId : undefined}
        data-testid={testId}
      >
        <div class="ui-action-group">
          {(title || message) && (
            <div class="ui-action-head">
              {title && (
                <p class="ui-action-title" id={titleId}>
                  {title}
                </p>
              )}
              {message && (
                <p class="ui-action-message" id={msgId}>
                  {message}
                </p>
              )}
            </div>
          )}
          {actions.map((a) => (
            <button
              key={a.label}
              class={`ui-action-btn${a.destructive ? ' is-destructive' : ''}`}
              data-testid={a.testId}
              onClick={() => {
                if (closing) return;
                try {
                  a.run();
                } finally {
                  onClose();
                }
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
        <div class="ui-action-group">
          <button ref={cancel} class="ui-action-btn ui-action-cancel" data-testid={testId ? `${testId}-cancel` : undefined} onClick={onClose}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** The red button's words, e.g. "Delete puzzle". */
  confirmLabel: string;
  cancelLabel?: string;
  /** Red (default true: action sheets are for destructive actions). */
  destructive?: boolean;
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

const pending = signal<Pending | null>(null);
/** Kept drawn while it slides out (the options stay for the last frame). */
const lastShown = signal<Pending | null>(null);

/** Asks with an action sheet; resolves true for the confirm button, false for Cancel / outside / Escape. */
export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  pending.value?.resolve(false);
  return new Promise<boolean>((resolve) => {
    const p = { ...opts, resolve };
    pending.value = p;
    lastShown.value = p;
  });
}

function answer(ok: boolean): void {
  const p = pending.value;
  if (!p) return;
  pending.value = null;
  p.resolve(ok);
}

/** Draws confirmAction()'s sheet; mounted once by <UiHost />. */
export function ConfirmHost() {
  const p = pending.value;
  const shown = p ?? lastShown.value;
  return (
    <ActionSheet
      open={p != null}
      onClose={() => answer(false)}
      title={shown?.title}
      message={shown?.message}
      cancelLabel={shown?.cancelLabel}
      testId="confirm-sheet"
      actions={shown ? [{ label: shown.confirmLabel, destructive: shown.destructive ?? true, run: () => answer(true), testId: 'confirm-sheet-ok' }] : []}
    />
  );
}
