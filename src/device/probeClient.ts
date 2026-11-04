/**
 * Starts the Device check's probe worker for one run and stops it afterwards. Every call has a
 * timeout and fails fast if the worker itself can't start, so a broken worker never hangs the
 * check. (Uses the same `new Worker(new URL(…))` pattern as src/app/workers.ts; no worker code
 * is imported here.)
 */
import * as Comlink from 'comlink';
import type { ProbeApi } from '../shared/probeApi';
import { withTimeout } from './util';

export interface ProbeSession {
  call<T>(fn: (api: Comlink.Remote<ProbeApi>) => Promise<T>, ms: number, what: string): Promise<T>;
  close(): void;
}

export function startProbeWorker(): ProbeSession {
  const worker = new Worker(new URL('../workers/probe.worker.ts', import.meta.url), { type: 'module', name: 'probe' });
  const api = Comlink.wrap<ProbeApi>(worker);
  let failure: ((err: Error) => void) | null = null;
  const failed = new Promise<never>((_, reject) => {
    failure = reject;
  });
  failed.catch(() => {}); // only observed through call()
  worker.addEventListener('error', (ev) => {
    failure?.(new Error(ev.message || 'The background helper could not start'));
  });
  let closed = false;
  return {
    call<T>(fn: (a: Comlink.Remote<ProbeApi>) => Promise<T>, ms: number, what: string): Promise<T> {
      if (closed) return Promise.reject(new Error('Probe worker closed'));
      return withTimeout(Promise.race([fn(api), failed]), ms, what);
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        api[Comlink.releaseProxy]();
      } catch {
        /* ignore */
      }
      worker.terminate();
    },
  };
}
