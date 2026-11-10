/**
 * "What to test" (owner's request, 2026-11-09): a 🧪 button opens the same test steps the owner
 * gets in the chat (docs/TEST-NOW.md, built into the app), so they can test on the iPhone without
 * switching apps. Numbered steps get tick boxes that are kept on the phone; a red dot on the
 * button marks steps not opened yet.
 *
 * M9 part 1: the 🧪 button sits in the top bar of each screen (TestButton) and in the camera
 * screens' own top row, instead of a tab on the right edge of every screen. Only one shows at a
 * time: an overlay's (the live view over the puzzle page) before the screen's own. Where none
 * shows (a screen without one, or a full-screen picture over the screen's: useTestStrip), the thin
 * edge tab is still there, so the steps can be opened from everywhere. All of it only in Tester
 * mode (Settings).
 */
import { signal } from '@preact/signals';
import { useLayoutEffect, useMemo, useState } from 'preact/hooks';
import { APP_VERSION } from '../env';
import { parseMd, renderMd } from '../miniMarkdown';
import { settings } from '../settings';
import { testText, textKey } from '../testText';

const SEEN_KEY = 'testSteps.seen';
const TICKS_KEY = 'testSteps.ticks.';

const TEXT = testText(APP_VERSION);
const KEY = textKey(TEXT);

function readTicks(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(TICKS_KEY + key) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function readSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === KEY;
  } catch {
    return true;
  }
}

/** The steps sheet is open. */
const sheetOpen = signal(false);
/** The current steps were opened once (no red dot). */
const seenSteps = signal(readSeen());

/** Opens the test steps (and clears the "new steps" dot). */
export function openTestSteps(): void {
  sheetOpen.value = true;
  if (!seenSteps.value) {
    seenSteps.value = true;
    try {
      localStorage.setItem(SEEN_KEY, KEY);
    } catch {
      /* private mode: the dot just stays */
    }
  }
}

/**
 * Places that can show the 🧪 entry. The one shown: an overlay's (priority 1) before a screen's
 * top bar (0), and of equal ones the latest. 'strip' = the edge tab instead of a button.
 */
interface Slot {
  id: number;
  priority: 0 | 1;
  kind: 'button' | 'strip';
}
const slots = signal<Slot[]>([]);
let nextSlot = 1;

function useSlot(priority: 0 | 1, kind: Slot['kind']): number {
  const [id] = useState(() => nextSlot++);
  useLayoutEffect(() => {
    slots.value = [...slots.value, { id, priority, kind }];
    return () => {
      slots.value = slots.value.filter((s) => s.id !== id);
    };
  }, []);
  return id;
}

function shownSlot(): Slot | null {
  let best: Slot | null = null;
  for (const s of slots.value) if (!best || s.priority > best.priority || (s.priority === best.priority && s.id > best.id)) best = s;
  return best;
}

/**
 * The 🧪 button: `bar` in a screen's top bar, `camera` in a camera screen's top row (an overlay
 * over the screen, so it wins over the screen's own).
 */
export function TestButton({ variant = 'bar' }: { variant?: 'bar' | 'camera' }) {
  const id = useSlot(variant === 'camera' ? 1 : 0, 'button');
  if (!settings.testerMode.value || shownSlot()?.id !== id) return null;
  const seen = seenSteps.value;
  return (
    <button
      class={variant === 'camera' ? 'chip test-btn test-btn-camera' : 'test-btn'}
      aria-label={seen ? 'What to test' : 'What to test (new steps)'}
      data-testid="test-tab"
      onClick={openTestSteps}
    >
      <span aria-hidden="true">🧪</span>
      {!seen && <span class="test-btn-dot" data-testid="test-tab-new" />}
    </button>
  );
}

/** Put inside a full-screen picture that covers the screen's 🧪 button: the edge tab shows while it is open. */
export function TestStrip() {
  useSlot(1, 'strip');
  return null;
}

/** The steps sheet, and the edge tab where no 🧪 button shows. */
export function TestSteps() {
  const blocks = useMemo(() => parseMd(TEXT), []);
  const open = sheetOpen.value;
  const close = () => (sheetOpen.value = false);
  const seen = seenSteps.value;
  const [ticks, setTicks] = useState(() => readTicks(KEY));
  const shown = shownSlot();

  const toggle = (id: string) => {
    const next = new Set(ticks);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTicks(next);
    try {
      // Only the latest steps' ticks are kept.
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k?.startsWith(TICKS_KEY) && k !== TICKS_KEY + KEY) localStorage.removeItem(k);
      }
      localStorage.setItem(TICKS_KEY + KEY, JSON.stringify([...next]));
    } catch {
      /* not kept, still shown */
    }
  };

  const steps = blocks.filter((b) => b.kind === 'ol').reduce((n, b) => n + (b.kind === 'ol' ? b.items.length : 0), 0);
  const done = [...ticks].length;

  return (
    <>
      {settings.testerMode.value && (!shown || shown.kind === 'strip') && (
        <button class="test-tab" aria-label="What to test" data-testid="test-tab" onClick={openTestSteps}>
          <span aria-hidden="true">🧪</span>
          <span class="test-tab-word">Test</span>
          {!seen && <span class="test-tab-dot" data-testid="test-tab-new" aria-label="New steps" />}
        </button>
      )}
      {open && (
        <div class="test-sheet" role="dialog" aria-label="What to test" data-testid="test-sheet">
          <div class="test-sheet-bar">
            <strong class="grow">🧪 What to test</strong>
            <button class="btn btn-small" data-testid="test-close" onClick={close}>
              Close
            </button>
          </div>
          <p class="muted small">
            This app: version {APP_VERSION}
            {steps > 0 && (
              <>
                {' '}
                · {Math.min(done, steps)} of {steps} steps ticked
              </>
            )}
          </p>
          <div class="test-body">
            {renderMd(blocks, (content, bi, ii) => {
              const b = blocks[bi]!;
              if (b.kind !== 'ol') return content;
              const id = `${bi}.${ii}`;
              return (
                <label class={`test-step${ticks.has(id) ? ' is-done' : ''}`}>
                  <input type="checkbox" data-testid="test-tick" checked={ticks.has(id)} onChange={() => toggle(id)} />
                  {content}
                </label>
              );
            })}
          </div>
          <p class="muted small">Something wrong or unclear? Take a screenshot and send it to me in Claude.</p>
          <button class="btn btn-block" onClick={close}>
            Close
          </button>
        </div>
      )}
    </>
  );
}
