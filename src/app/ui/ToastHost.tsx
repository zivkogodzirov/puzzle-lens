/**
 * Draws the toast from ui/toast.ts (call `toast({ … })` from anywhere). The role=status region is always
 * there, so VoiceOver announces each new toast. Placed above the puzzle's tab bar (--action-bar-h, M9 part 4)
 * and above the Home bar (safe area). A screen can move it with the CSS variable
 * --toast-bottom on `.app` (e.g. over a camera's own bottom controls). A toast closes when the screen changes:
 * its Undo belongs to the screen it was shown on.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { route, routeArg } from '../router';
import { currentToast, dismissToast, runToastAction } from './toast';
// M9 part 6 help: busy states and results are read from this same region (announce.ts).
import { announcement } from './announce';

/** Layers that open over a screen: the live view and camera views, full-screen photos, sheets and dialogs, the test steps. */
// The piece card (its sheet, testid "spot") is left out: opening the next piece's card keeps the last answer's Undo
// (review 2026-11-11: otherwise a mistaken "Not a piece" was gone once the next piece was tapped).
const OVER_PAGE = '.live, .photo-result, [role="dialog"]:not([data-testid="spot"]), [role="alertdialog"], .test-sheet';

/** The topmost open modal layer (aria-modal), or null: VoiceOver reads nothing outside it while it is open. */
function useTopModal(): Element | null {
  const [modal, setModal] = useState<Element | null>(null);
  useEffect(() => {
    const look = () => {
      const all = document.querySelectorAll('[aria-modal="true"]');
      setModal(all.length ? all[all.length - 1]! : null);
    };
    look();
    const mo = new MutationObserver(look);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal'] });
    return () => mo.disconnect();
  }, []);
  return modal;
}

export function ToastHost() {
  const t = currentToast.value;
  // M9 part 6 fixes: while a modal layer is open (the scan's wait, the live view, a sheet) the screen's one status
  // region is inside it (WebKit may not read a region outside an aria-modal dialog); the toast stays drawn here.
  const modal = useTopModal();
  const news = announcement.value && announcement.value.at === location.hash ? announcement.value : null;
  const inModal = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!modal) return;
    const el = document.createElement('div');
    el.className = 'sr-only';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.dataset['testid'] = 'modal-status';
    modal.appendChild(el);
    inModal.current = el;
    return () => {
      el.remove();
      inModal.current = null;
    };
  }, [modal]);
  useEffect(() => {
    const el = inModal.current;
    if (!el) return;
    const said: HTMLElement[] = [];
    if (news) {
      const s = document.createElement('span');
      s.className = 'sr-only';
      s.dataset['testid'] = 'announce';
      s.textContent = news.text;
      said.push(s);
    }
    if (t) {
      const s = document.createElement('span');
      s.className = 'sr-only';
      s.textContent = t.text;
      said.push(s);
    }
    el.replaceChildren(...said);
  }, [modal, news?.id, t?.id]);
  // A puzzle's tabs and its pages (Which pieces join, Sort into trays) count as one place: an answer's Undo stays
  // while you move between them (review 2026-11-11).
  const place = route.value === 'joins' || route.value === 'sort' ? 'puzzle' : route.value;
  const where = `${place}/${routeArg.value ?? ''}`;
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
    <div class="ui-toast-wrap" role={modal ? undefined : 'status'} aria-live={modal ? undefined : 'polite'} data-testid="toast-region">
      {/* M9 part 6 help: the screen's news for VoiceOver (announce()), visually hidden. */}
      {/* Only this screen's own news (the last screen's goes with it; a new screen may speak as it opens). */}
      {news && !modal && (
        <span key={news.id} class="sr-only" data-testid="announce">
          {news.text}
        </span>
      )}
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
