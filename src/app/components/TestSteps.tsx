/**
 * "What to test" (owner's request, 2026-11-09): a small 🧪 tab on the right edge of every screen
 * opens the same test steps the owner gets in the chat (docs/TEST-NOW.md, built into the app), so
 * they can test on the iPhone without switching apps. Numbered steps get tick boxes that are kept
 * on the phone; a dot on the tab marks steps not opened yet.
 */
import { useMemo, useState } from 'preact/hooks';
import { APP_VERSION } from '../env';
import { parseMd, renderMd } from '../miniMarkdown';
import { testText, textKey } from '../testText';

const SEEN_KEY = 'testSteps.seen';
const TICKS_KEY = 'testSteps.ticks.';

function readTicks(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(TICKS_KEY + key) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function TestSteps() {
  const text = useMemo(() => testText(APP_VERSION), []);
  const key = useMemo(() => textKey(text), [text]);
  const blocks = useMemo(() => parseMd(text), [text]);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(SEEN_KEY) === key;
    } catch {
      return true;
    }
  });
  const [ticks, setTicks] = useState(() => readTicks(key));

  const show = () => {
    setOpen(true);
    if (!seen) {
      setSeen(true);
      try {
        localStorage.setItem(SEEN_KEY, key);
      } catch {
        /* private mode: the dot just stays */
      }
    }
  };
  const toggle = (id: string) => {
    const next = new Set(ticks);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTicks(next);
    try {
      // Only the latest steps' ticks are kept.
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k?.startsWith(TICKS_KEY) && k !== TICKS_KEY + key) localStorage.removeItem(k);
      }
      localStorage.setItem(TICKS_KEY + key, JSON.stringify([...next]));
    } catch {
      /* not kept, still shown */
    }
  };

  const steps = blocks.filter((b) => b.kind === 'ol').reduce((n, b) => n + (b.kind === 'ol' ? b.items.length : 0), 0);
  const done = [...ticks].length;

  return (
    <>
      <button class="test-tab" aria-label="What to test" data-testid="test-tab" onClick={show}>
        <span aria-hidden="true">🧪</span>
        <span class="test-tab-word">Test</span>
        {!seen && <span class="test-tab-dot" data-testid="test-tab-new" aria-label="New steps" />}
      </button>
      {open && (
        <div class="test-sheet" role="dialog" aria-label="What to test" data-testid="test-sheet">
          <div class="test-sheet-bar">
            <strong class="grow">🧪 What to test</strong>
            <button class="btn btn-small" data-testid="test-close" onClick={() => setOpen(false)}>
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
          <button class="btn btn-block" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      )}
    </>
  );
}
