/**
 * What happens after the scan camera's shutter (M9 part 5, design plan §3.4 "Feedback", §3.8 rule 12, §4 item 5):
 * - ShutterFlash: a short white flash over the viewfinder (none under Reduce Motion: the frozen photo is the
 *   still frame instead);
 * - ScanWait: while the photo is read, the frozen photo dimmed, with named stages ("Reading photo · Finding
 *   pieces · Saving") and, after 10 s, Cancel;
 * - ResultSheet: the result as a sheet (instead of M8's note over the camera): a title ("Found 22 pieces"),
 *   a short list of what to do, and "See where they go", "Take another", "See photo".
 * The scan screen (screens/Scan.tsx) builds the result and decides what each button does.
 */
import type { ComponentChildren } from 'preact';
import { Fragment } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Sheet } from '../ui/Sheet';
import { Button, IconButton } from '../ui/Button';
import { Icon, type IconName } from '../ui/icons';

import type { ResultTone, ScanResult } from '../scanResult';

const TONE_ICON: Record<ResultTone, IconName> = { good: 'check', warn: 'alert-triangle', bad: 'alert-triangle', info: 'info' };

/**
 * A line's words. A "✓" in them ("Coin found ✓") is drawn as the check icon (M9 part 2); one in quotes names
 * a button ("✓ in the puzzle") and stays text.
 */
function Words({ text }: { text: string }) {
  const parts = text.split(/(?<!")✓/);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((t, i) => (
        <Fragment key={i}>
          {i > 0 && <Icon name="check" size={16} class="inline-icon" />}
          {t}
        </Fragment>
      ))}
    </>
  );
}

export interface ResultSheetProps {
  result: ScanResult | null;
  open: boolean;
  onClose: () => void;
  /** "See where they go" (the puzzle's Table tab); null: not offered. */
  onSeeTable: (() => void) | null;
  /** "Take another": closes the sheet, back to the camera. */
  onAnother: () => void;
  /** "See photo" (the photo viewer); null: not offered. */
  onSeePhoto: (() => void) | null;
}

/**
 * The result sheet. Its dialog keeps the data-testid "scan-note" (the old note's), so the title and every line
 * can be found as before; each line is a <p>. As tall as its words (at most the medium height; swipe up for
 * all of it), with the buttons always in view under the list.
 */
export function ResultSheet({ result, open, onClose, onSeeTable, onAnother, onSeePhoto }: ResultSheetProps) {
  if (!result) return null;
  return (
    <Sheet open={open} onClose={onClose} title={result.title} testId="scan-note">
      <div class={`scan-result scan-result-${result.ok ? 'ok' : 'bad'}`} data-kind={result.kind}>
        <div class="scan-result-list">
          {result.sub && <p class="scan-result-sub">{result.sub}</p>}
          <ul role="list">
            {result.items.map((it, i) => (
              <li key={i} class={`scan-result-item tone-${it.tone}`}>
                <span class="scan-result-icon">
                  <Icon name={TONE_ICON[it.tone]} size={20} />
                </span>
                <p>
                  <Words text={it.text} />
                </p>
              </li>
            ))}
          </ul>
        </div>
        <div class={`scan-result-actions${onSeeTable ? '' : ' no-table'}`}>
          {onSeeTable && (
            <Button variant="filled" testId="result-see-table" class="scan-result-main" onClick={onSeeTable}>
              <Icon name="scan-eye" size={20} />
              See where they go
            </Button>
          )}
          <Button variant={onSeeTable ? 'tinted' : 'filled'} testId="result-another" onClick={onAnother}>
            <Icon name="camera" size={20} />
            Take another
          </Button>
          {onSeePhoto && (
            <Button testId="result-see-photo" onClick={onSeePhoto}>
              <Icon name="image" size={20} />
              See photo
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

/** The white flash at the shutter (drawn anew for each photo: give it a new `key`). */
export function ShutterFlash({ onEnd }: { onEnd: () => void }) {
  useEffect(() => {
    // Under Reduce Motion there is no animation (and so no animationend): it goes after the same time.
    const t = setTimeout(onEnd, 400);
    return () => clearTimeout(t);
  }, []);
  return <div class="shutter-flash" data-testid="shutter-flash" aria-hidden="true" />;
}

export type WaitStage = 'read' | 'find' | 'save';

const STAGES: Array<[WaitStage, string]> = [
  ['read', 'Reading photo'],
  ['find', 'Finding pieces'],
  ['save', 'Saving'],
];

/** After this long (ms) Cancel is offered (design plan §3.8 rule 12). */
export const CANCEL_AFTER_MS = 10_000;

/** The frozen photo: the camera picture at the shutter (a canvas), or a chosen photo (an object URL). */
export type Frozen = { canvas: HTMLCanvasElement } | { url: string };

function FrozenPhoto({ f }: { f: Frozen }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!('canvas' in f) || !box.current) return;
    const c = f.canvas;
    box.current.append(c);
    return () => c.remove();
  }, [f]);
  return 'url' in f ? <img class="scan-wait-photo" src={f.url} alt="" decoding="async" /> : <div ref={box} class="scan-wait-photo-box" />;
}

export interface ScanWaitProps {
  stage: WaitStage;
  /** When the wait began (performance.now()). */
  since: number;
  frozen: Frozen | null;
  /** Stops waiting for this photo; null while it can't be stopped (saving). */
  onCancel: (() => void) | null;
  /** Leaves the camera (the wait covers its top bar; review 2026-11-11: Back couldn't be tapped while a photo was read). */
  onBack?: () => void;
  children?: ComponentChildren;
}

/** The wait for a photo's result: the frozen photo dimmed, the stages in order, Cancel after 10 s. */
export function ScanWait({ stage, since, frozen, onCancel, onBack }: ScanWaitProps) {
  const [late, setLate] = useState(() => performance.now() - since >= CANCEL_AFTER_MS);
  useEffect(() => {
    const left = CANCEL_AFTER_MS - (performance.now() - since);
    if (left <= 0) {
      setLate(true);
      return;
    }
    setLate(false);
    const t = setTimeout(() => setLate(true), left);
    return () => clearTimeout(t);
  }, [since]);
  const at = STAGES.findIndex(([k]) => k === stage);
  return (
    <div class="scan-wait" data-testid="scan-wait" data-stage={stage}>
      {frozen && <FrozenPhoto f={frozen} />}
      {onBack && (
        <IconButton class="btn-cam scan-wait-back" label="Back" testId="scan-wait-back" onClick={onBack}>
          <Icon name="chevron-left" />
        </IconButton>
      )}
      <div class="scan-wait-card">
        <div role="status" aria-label="Reading the photo">
          <ol class="scan-wait-stages">
            {STAGES.map(([k, label], i) => (
              <li key={k} data-state={i < at ? 'done' : i === at ? 'now' : 'next'} data-testid={`wait-${k}`} aria-current={i === at ? 'step' : undefined}>
                <span class="scan-wait-mark" aria-hidden="true">
                  {i < at ? <Icon name="check" size={18} /> : i === at ? <span class="spinner" /> : <span class="scan-wait-dot" />}
                </span>
                {label}
              </li>
            ))}
          </ol>
        </div>
        {late && onCancel && (
          <button type="button" class="btn btn-small scan-wait-cancel" data-testid="scan-cancel" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
