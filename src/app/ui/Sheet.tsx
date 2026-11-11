/**
 * Bottom sheet (M9 part 2, design plan §3.5): slides up over a dimmed page, with a 36×5 grabber, a title and
 * a round ✕. Two heights ("detents"): medium (about 60 % of the screen) and large (almost all of it).
 * - role=dialog with aria-modal; focus moves into it and returns to the button that opened it;
 * - closes on swipe down (on the grabber or the title row), a tap on the dimmed page, ✕ or Escape;
 *   swiping up (or tapping the grabber) makes it large, swiping down from large makes it medium;
 * - respects the safe areas and Reduce Motion (no slide, it just appears and disappears).
 *
 *   const [open, setOpen] = useState(false);
 *   <button class="btn" onClick={() => setOpen(true)}>Show piece</button>
 *   <Sheet open={open} onClose={() => setOpen(false)} title="Column 18 · Row 7" testId="piece-sheet">…</Sheet>
 *
 * It is drawn where it is placed (position: fixed), so put it at the end of the screen's markup.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { useModalFocus, usePresence } from './modal';

export type Detent = 'medium' | 'large';

export interface SheetProps {
  open: boolean;
  /** Called when the person closes it (swipe, tap outside, ✕, Escape); set `open` to false there. */
  onClose: () => void;
  /** The heading (Title 3); also the dialog's name for VoiceOver. */
  title: ComponentChildren;
  /** The height it opens at (default medium). */
  detent?: Detent;
  /** false: only the height it opens at (no swipe up to large). Default true. */
  resizable?: boolean;
  /** The ✕ button's name (default "Close"). */
  closeLabel?: string;
  testId?: string;
  children?: ComponentChildren;
}

/** How far (px) a swipe must go before it changes the height or closes the sheet. */
const SWIPE = 60;

export function Sheet({ open, onClose, title, detent = 'medium', resizable = true, closeLabel = 'Close', testId, children }: SheetProps) {
  const { mounted, closing } = usePresence(open);
  const [size, setSize] = useState<Detent>(detent);
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ y: number; t: number; grabber: boolean } | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (open) setSize(detent);
  }, [open, detent]);
  const moved = useRef(false);
  // Focus goes to the dialog itself, so VoiceOver reads its title first.
  useModalFocus(open, dialog, onClose, dialog);
  if (!mounted) return null;

  const onDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('button:not(.ui-sheet-grabber), a, input, select, textarea')) return;
    start.current = { y: e.clientY, t: performance.now(), grabber: Boolean((e.target as HTMLElement).closest('.ui-sheet-grabber')) };
    moved.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag(0);
  };
  const onMove = (e: PointerEvent) => {
    if (!start.current) return;
    const dy = e.clientY - start.current.y;
    if (Math.abs(dy) > 6) moved.current = true;
    // Down follows the finger; up gives a little (rubber band) unless it can grow to large.
    setDrag(dy > 0 ? dy : resizable && size === 'medium' ? dy : dy / 4);
  };
  const onUp = (e: PointerEvent) => {
    const s = start.current;
    start.current = null;
    setDrag(null);
    if (!s) return;
    const dy = e.clientY - s.y;
    // A tap on the grabber (not a swipe) switches the height. Handled here: with the pointer captured by the
    // title row, the click lands on the row, not on the grabber.
    if (s.grabber && !moved.current) {
      if (resizable) setSize(size === 'large' ? 'medium' : 'large');
      return;
    }
    const fast = Math.abs(dy) / Math.max(1, performance.now() - s.t) > 0.5 && Math.abs(dy) > 20;
    if (dy > SWIPE || (fast && dy > 0)) {
      if (size === 'large' && resizable && detent === 'medium') setSize('medium');
      else onClose();
    } else if ((dy < -SWIPE || (fast && dy < 0)) && resizable) setSize('large');
  };
  const onCancel = () => {
    start.current = null;
    setDrag(null);
  };
  const dragStyle = drag != null && drag !== 0 ? { transform: `translateY(${Math.max(drag, -40)}px)` } : undefined;

  return (
    <div class={`ui-sheet-root${closing ? ' is-closing' : ''}`} data-testid={testId ? `${testId}-root` : undefined}>
      <div class="ui-scrim" data-testid={testId ? `${testId}-scrim` : 'ui-scrim'} onClick={onClose} aria-hidden="true" />
      <div
        ref={dialog}
        class={`ui-sheet ui-sheet-${size}${drag != null ? ' is-dragging' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid={testId}
        data-detent={size}
        style={dragStyle}
      >
        <div class="ui-sheet-head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}>
          {resizable ? (
            <button
              class="ui-sheet-grabber"
              aria-label={size === 'large' ? 'Make smaller' : 'Make larger'}
              data-testid={testId ? `${testId}-grabber` : undefined}
              onClick={(e) => {
                // Keyboard and VoiceOver (detail 0); a finger or mouse tap is handled in onUp.
                if (e.detail === 0) setSize(size === 'large' ? 'medium' : 'large');
              }}
            />
          ) : (
            <span class="ui-sheet-grabber" aria-hidden="true" />
          )}
          <h2 class="ui-sheet-title" id={titleId}>
            {title}
          </h2>
          <button class="btn-icon" aria-label={closeLabel} data-testid={testId ? `${testId}-close` : undefined} onClick={onClose}>
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div class="ui-sheet-body">{children}</div>
      </div>
    </div>
  );
}
