/**
 * What every modal in the kit shares (Sheet, ActionSheet): stays drawn while it slides out, moves focus in
 * and back out, keeps Tab inside, closes on Escape, and stops the page behind it from scrolling.
 */
import type { RefObject } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The sheet animation's length in ms, or 0 under Reduce Motion (then it just disappears). */
export function exitMs(): number {
  try {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
  } catch {
    /* no matchMedia: animate */
  }
  return 350;
}

/** `open` → drawn now; closed → drawn for one more animation (`closing`), then removed. */
export function usePresence(open: boolean): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    const ms = exitMs();
    const t = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(t);
  }, [open]);
  return { mounted: open || mounted, closing: !open && mounted };
}

let openCount = 0;

/**
 * Safari doesn't move focus to a button when it is tapped or clicked, so "what had focus" is often the page
 * itself. The control last pressed is remembered here, so focus can go back to the button that opened a sheet.
 */
let lastPressed: HTMLElement | null = null;
if (typeof document !== 'undefined')
  document.addEventListener(
    'pointerdown',
    (e) => {
      const t = e.target as Element | null;
      lastPressed = t?.closest?.<HTMLElement>(FOCUSABLE) ?? null;
    },
    true,
  );

function opener(): HTMLElement | null {
  const a = document.activeElement as HTMLElement | null;
  if (a && a !== document.body && a !== document.documentElement) return a;
  return lastPressed;
}

/**
 * Focus in (to `initial`, else the first button, else the dialog) when it opens; back to what had it when it
 * closes. Escape calls `onClose`; Tab cycles inside. The page behind doesn't scroll while it is open.
 */
export function useModalFocus(open: boolean, dialog: RefObject<HTMLElement | null>, onClose: () => void, initial?: RefObject<HTMLElement | null>): void {
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    if (!open) return;
    const before = opener();
    const el = dialog.current;
    const first = initial?.current ?? el?.querySelector<HTMLElement>(FOCUSABLE) ?? el;
    try {
      first?.focus({ preventScroll: true });
    } catch {
      first?.focus();
    }
    openCount++;
    document.documentElement.classList.add('ui-modal-open');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const a = items[0]!;
      const z = items[items.length - 1]!;
      if (e.shiftKey && (document.activeElement === a || !el.contains(document.activeElement))) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && (document.activeElement === z || !el.contains(document.activeElement))) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      openCount = Math.max(0, openCount - 1);
      if (openCount === 0) document.documentElement.classList.remove('ui-modal-open');
      if (before && before.isConnected) {
        try {
          before.focus({ preventScroll: true });
        } catch {
          before.focus();
        }
      }
    };
  }, [open]);
}
