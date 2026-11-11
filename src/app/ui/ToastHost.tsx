/**
 * Draws the toast from ui/toast.ts (call `toast({ … })` from anywhere). The role=status region is always
 * there, so VoiceOver announces each new toast. Placed above the puzzle page's action bar (--action-bar-h)
 * or the tab bar, and above the Home bar (safe area). A screen can move it with the CSS variable
 * --toast-bottom on `.app` (e.g. over a camera's own bottom controls). A toast closes when the screen changes:
 * its Undo belongs to the screen it was shown on.
 */
import { useEffect, useRef } from 'preact/hooks';
import { route, routeArg } from '../router';
import { currentToast, dismissToast, runToastAction } from './toast';

/** Layers that open over a screen: the live view and camera views, full-screen photos, sheets and dialogs, the test steps. */
// The piece card (its sheet, testid "spot") is left out: opening the next piece's card keeps the last answer's Undo
// (review 2026-11-11: otherwise a mistaken "Not a piece" was gone once the next piece was tapped).
const OVER_PAGE = '.live, .photo-result, [role="dialog"]:not([data-testid="spot"]), [role="alertdialog"], .test-sheet';

export function ToastHost() {
  const t = currentToast.value;
  const where = `${route.value}/${routeArg.value ?? ''}`;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) first.current = false;
    else dismissToast();
  }, [where]);
  // Something opening over the page (the live view, a photo, a sheet, the test steps) closes the toast: its Undo
  // belongs to the page, and on top of that layer it would cover that layer's own buttons (review 2026-11-11: it
  // lay over the live view's "Doesn't fit", so a tap there undid the previous piece).
  useEffect(() => {
    if (!t) return;
    const before = new Set(document.querySelectorAll(OVER_PAGE));
    const mo = new MutationObserver(() => {
      for (const el of document.querySelectorAll(OVER_PAGE)) if (!before.has(el)) return dismissToast();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [t?.id]);
  return (
    <div class="ui-toast-wrap" role="status" aria-live="polite" data-testid="toast-region">
      {t && (
        <div key={t.id} class="ui-toast" data-testid="toast">
          <span class="ui-toast-text" data-testid="toast-text">
            {t.text}
          </span>
          {t.action && (
            <button class="ui-toast-action" data-testid="toast-action" onClick={() => runToastAction(t.id)}>
              {t.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
