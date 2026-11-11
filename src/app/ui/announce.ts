/**
 * One place for VoiceOver news (M9 part 6, design plan §3.8 rule 7): busy states and results are read out
 * from the one permanent role=status region (ToastHost's, mounted once for every screen), not from
 * regions that appear with their text (VoiceOver often misses those).
 *
 *   announce('Finding pieces');            // from anywhere
 *   useAnnounce(busy ? 'Saving…' : null);  // in a component: says the text each time it changes
 *   useAnnounceSettled(levelMessage);       // only words that stayed 1.5 s (a level's message changes a lot)
 *
 * The words are drawn visually hidden inside the region; a toast's own text is read from the same region. While a
 * modal layer is open (aria-modal: the scan's wait, the live view, a sheet) that region is inside the topmost one
 * (M9 part 6 fixes: WebKit may ignore a live region outside an aria-modal dialog), still one per screen.
 */
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';

export interface Announcement {
  id: number;
  text: string;
  /** The screen's address when it was said: a screen shows only its own news. */
  at: string;
}

/** The latest news for VoiceOver, or null. */
export const announcement = signal<Announcement | null>(null);

let nextId = 1;

/** Has VoiceOver read `text` (politely, after what it is saying now). The same words again are read again. */
export function announce(text: string | null | undefined): void {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return;
  announcement.value = { id: nextId++, text: t, at: location.hash };
}

/** Announces `text` whenever it changes (null or empty: nothing). */
export function useAnnounce(text: string | null | undefined): void {
  useEffect(() => announce(text), [text]);
}

/** How long words must stay before useAnnounceSettled reads them. */
export const SETTLE_MS = 1500;

/**
 * Announces `text` once it has stayed the same for `ms` (M9 part 6 fixes: the level's instruction changes as the
 * phone moves, and reading every one was chatty). Words that change sooner are never read.
 */
export function useAnnounceSettled(text: string | null | undefined, ms = SETTLE_MS): void {
  useEffect(() => {
    if (!text) return;
    const id = setTimeout(() => announce(text), ms);
    return () => clearTimeout(id);
  }, [text, ms]);
}
