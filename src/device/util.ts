/**
 * Small helpers for the Device check. Worker-safe (no DOM-only APIs), so the probe worker can
 * use them too.
 */

export class TimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`${what} took longer than ${ms >= 1000 ? `${Math.round(ms / 1000)} s` : `${ms} ms`}`);
    this.name = 'TimeoutError';
  }
}

/** Rejects with a TimeoutError if `p` hasn't settled after `ms`. The original promise keeps running. */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(what, ms)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Polls `test` every `everyMs` until it is true or `ms` passes. Resolves to the last result. */
export async function waitFor(test: () => boolean, ms: number, everyMs = 50): Promise<boolean> {
  const end = performance.now() + ms;
  while (!test()) {
    if (performance.now() >= end) return false;
    await sleep(everyMs);
  }
  return true;
}

/** A readable message from anything that was thrown. */
export function errorMessage(err: unknown): string {
  if (err == null) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    const e = err as { name?: unknown; message?: unknown };
    const msg = typeof e.message === 'string' ? e.message : '';
    const name = typeof e.name === 'string' ? e.name : '';
    if (msg && name && name !== 'Error' && !msg.startsWith(name)) return `${name}: ${msg}`;
    if (msg) return msg;
    if (name) return name;
  }
  return String(err);
}

/**
 * Makes details safe to store in IndexedDB and to show as JSON: drops functions, turns errors
 * into {name, message}, and cuts cycles.
 */
export function toPlain(value: unknown): unknown {
  if (value === undefined) return undefined;
  const seen = new WeakSet<object>();
  try {
    const text = JSON.stringify(value, (_key, v: unknown) => {
      if (typeof v === 'bigint') return Number(v);
      if (typeof v === 'function' || typeof v === 'symbol') return undefined;
      if (v && typeof v === 'object') {
        if (v instanceof Error || (typeof DOMException !== 'undefined' && v instanceof DOMException)) {
          const e = v as Error;
          return { name: e.name, message: e.message };
        }
        if (seen.has(v)) return '[circular]';
        seen.add(v);
      }
      return v;
    });
    return text === undefined ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return String(value);
  }
}

/**
 * Whether the camera tests' cleanup may stop the camera and the frame pump. A finished run (you are
 * still on Device check) always cleans up. An aborted run (you left the screen; the camera was
 * already stopped then) only stops a camera it started itself: by now Live may have started its own.
 */
export function mayStopCamera<T>(aborted: boolean, current: T | null, ownTracks: ReadonlySet<T>): boolean {
  if (!aborted) return true;
  return current === null || ownTracks.has(current);
}
