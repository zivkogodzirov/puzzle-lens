/**
 * Starts the background workers (lazily) and gives typed access to them (PLAN §3.1).
 */
import * as Comlink from 'comlink';
import { signal } from '@preact/signals';
import type { ReaderApi, ReportWorkerApi, TrackerApi } from '../shared/apis';
import type { WorkerInitInfo } from '../shared/types';
import { logError, logInfo } from '../log/logger';

interface Handle<T> {
  worker: Worker;
  api: Comlink.Remote<T>;
  ready: Promise<WorkerInitInfo | null>;
}

export const trackerInfo = signal<WorkerInitInfo | null>(null);
export const readerInfo = signal<WorkerInitInfo | null>(null);

let tracker: Handle<TrackerApi> | null = null;
let reader: Handle<ReaderApi> | null = null;
let reporter: { worker: Worker; api: Comlink.Remote<ReportWorkerApi> } | null = null;

function attachErrorLog(worker: Worker, name: string): void {
  worker.addEventListener('error', (ev) => logError(name, ev.message || 'Worker error', { file: ev.filename, line: ev.lineno }));
  worker.addEventListener('messageerror', () => logError(name, 'Worker message could not be read'));
}

export function trackerWorker(): Handle<TrackerApi> {
  if (!tracker) {
    const worker = new Worker(new URL('../workers/tracker.worker.ts', import.meta.url), { type: 'module', name: 'tracker' });
    attachErrorLog(worker, 'tracker');
    const api = Comlink.wrap<TrackerApi>(worker);
    const ready = api
      .init()
      .then((info) => {
        trackerInfo.value = info;
        (info.ok ? logInfo : logError)('tracker', info.ok ? `OpenCV ready in ${Math.round(info.cvLoadMs)} ms` : `OpenCV failed: ${info.error}`);
        return info;
      })
      .catch((err) => {
        logError('tracker', 'Tracker worker failed to start', err);
        return null;
      });
    tracker = { worker, api, ready };
  }
  return tracker;
}

export function readerWorker(): Handle<ReaderApi> {
  if (!reader) {
    const worker = new Worker(new URL('../workers/reader.worker.ts', import.meta.url), { type: 'module', name: 'reader' });
    attachErrorLog(worker, 'reader');
    const api = Comlink.wrap<ReaderApi>(worker);
    const ready = api
      .init()
      .then((info) => {
        readerInfo.value = info;
        if (!info.ok) logError('reader', `OpenCV failed: ${info.error}`);
        return info;
      })
      .catch((err) => {
        logError('reader', 'Reader worker failed to start', err);
        return null;
      });
    reader = { worker, api, ready };
  }
  return reader;
}

/** The tracker if it is already running (doesn't start one). */
export function peekTracker(): Handle<TrackerApi> | null {
  return tracker;
}

/** The reader if it is already running (doesn't start one). */
export function peekReader(): Handle<ReaderApi> | null {
  return reader;
}

/** Throws the tracker away (e.g. after repeated errors); the next trackerWorker() call starts a fresh one. */
export function restartTracker(reason: string): void {
  if (!tracker) return;
  tracker.api[Comlink.releaseProxy]();
  tracker.worker.terminate();
  tracker = null;
  trackerInfo.value = null;
  logInfo('tracker', `Tracker worker restarted: ${reason}`);
}

/** The reader's WebAssembly memory never shrinks; restarting it is how we give memory back. */
export function restartReader(): void {
  if (!reader) return;
  reader.api[Comlink.releaseProxy]();
  reader.worker.terminate();
  reader = null;
  readerInfo.value = null;
  logInfo('reader', 'Reader worker restarted to free memory');
}

export function reportWorker(): Comlink.Remote<ReportWorkerApi> {
  if (!reporter) {
    const worker = new Worker(new URL('../workers/report.worker.ts', import.meta.url), { type: 'module', name: 'report' });
    attachErrorLog(worker, 'report');
    reporter = { worker, api: Comlink.wrap<ReportWorkerApi>(worker) };
  }
  return reporter.api;
}

export { Comlink };
