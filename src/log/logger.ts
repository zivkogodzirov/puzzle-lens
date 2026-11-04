/**
 * App log: keeps the last entries in memory (for the screen and reports) and saves them to the
 * database in small batches. Errors from anywhere (including workers) end up here.
 */
import type { LogLevel, LogRow } from '../db/db';
import { db } from '../db/db';

const MEMORY_KEEP = 500;
const DB_KEEP = 2000;
const FLUSH_MS = 2000;
/** Warnings and errors are saved almost at once: iOS can kill the page (memory) with no warning. */
const URGENT_FLUSH_MS = 50;

export class RingBuffer<T> {
  private items: T[] = [];
  constructor(private readonly capacity: number) {}
  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
  }
  toArray(): T[] {
    return [...this.items];
  }
  get size(): number {
    return this.items.length;
  }
}

const recent = new RingBuffer<LogRow>(MEMORY_KEEP);
let pending: LogRow[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let persistEnabled = true;

export function setLogPersistence(on: boolean): void {
  persistEnabled = on;
}

let timerDue = 0;

function scheduleFlush(urgent: boolean): void {
  if (!persistEnabled) return;
  const delay = urgent ? URGENT_FLUSH_MS : FLUSH_MS;
  const due = Date.now() + delay;
  if (timer) {
    if (due >= timerDue) return;
    clearTimeout(timer);
  }
  timerDue = due;
  timer = setTimeout(() => {
    timer = null;
    void flushLogs();
  }, delay);
}

export async function flushLogs(): Promise<void> {
  if (!pending.length) return;
  const batch = pending;
  pending = [];
  try {
    const d = db();
    await d.logs.bulkAdd(batch);
    const count = await d.logs.count();
    if (count > DB_KEEP) {
      const cut = await d.logs.orderBy('id').limit(count - DB_KEEP).primaryKeys();
      await d.logs.bulkDelete(cut);
    }
  } catch {
    /* logging must never break the app */
  }
}

export function log(level: LogLevel, source: string, message: string, data?: unknown): void {
  const row: LogRow = { ts: Date.now(), level, source, message, data: safeData(data) };
  recent.push(row);
  pending.push(row);
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  fn(`[${source}] ${message}`, data ?? '');
  scheduleFlush(level !== 'info');
}

export const logInfo = (source: string, message: string, data?: unknown) => log('info', source, message, data);
export const logWarn = (source: string, message: string, data?: unknown) => log('warn', source, message, data);
export const logError = (source: string, message: string, data?: unknown) => log('error', source, message, data);

export function recentLogs(): LogRow[] {
  return recent.toArray();
}

function safeData(data: unknown): unknown {
  if (data === undefined) return undefined;
  if (data instanceof Error) return { name: data.name, message: data.message, stack: data.stack };
  try {
    return JSON.parse(JSON.stringify(data));
  } catch {
    return String(data);
  }
}

/** Catches errors nobody handled, so they show up in reports. */
export function installGlobalErrorHandlers(): void {
  addEventListener('error', (ev) => {
    logError('window', ev.message || 'Uncaught error', { file: ev.filename, line: ev.lineno, col: ev.colno, error: ev.error });
  });
  addEventListener('unhandledrejection', (ev) => {
    logError('promise', 'Unhandled promise rejection', ev.reason);
  });
  // iOS often doesn't fire pagehide when the app goes to the background, so save then too.
  addEventListener('pagehide', () => void flushLogs());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushLogs();
  });
}
