/**
 * OpenCV.js objects (Mat, MatVector, detectors…) live in WebAssembly memory and are NOT freed
 * by JavaScript's garbage collector. Every one must be `.delete()`d, including every `roi()`
 * view and every `MatVector.get()` result (puzzle-helper's heap grew 128 → 256 MB from missed
 * roi() deletes; RESEARCH §2).
 *
 * Rule in this codebase: per-frame / per-job objects are created through a CvScope and freed
 * when the scope ends. Long-lived objects are registered with `persistent()` and freed by their
 * owner's `dispose()`. The counters below feed the HUD and the leak tests.
 */

export interface Deletable {
  delete(): void;
  isDeleted?(): boolean;
}

export const cvCounters = {
  /** Created inside scopes and not yet freed. Must return to 0 after each frame/job. */
  liveScoped: 0,
  /** Long-lived objects currently alive. */
  livePersistent: 0,
  /** Total ever created inside scopes (for statistics). */
  createdScoped: 0,
};

export class CvScope {
  private items: Deletable[] = [];

  /** Registers an OpenCV object to be deleted when the scope ends. Returns it for chaining. */
  keep<T extends Deletable>(obj: T): T {
    this.items.push(obj);
    cvCounters.liveScoped++;
    cvCounters.createdScoped++;
    return obj;
  }

  release(): void {
    // Free in reverse order of creation (views before the matrices they point into).
    for (let i = this.items.length - 1; i >= 0; i--) {
      const obj = this.items[i]!;
      try {
        if (!obj.isDeleted?.()) obj.delete();
      } catch {
        /* already gone */
      }
      cvCounters.liveScoped--;
    }
    this.items = [];
  }
}

/** Runs `fn` with a fresh scope and always frees everything it registered, even on error. */
export function withScope<T>(fn: (s: CvScope) => T): T {
  const scope = new CvScope();
  try {
    return fn(scope);
  } finally {
    scope.release();
  }
}

/** Registers a long-lived object; call `freePersistent` from the owner's dispose(). */
export function persistent<T extends Deletable>(obj: T): T {
  cvCounters.livePersistent++;
  return obj;
}

export function freePersistent(obj: Deletable | null | undefined): void {
  if (!obj) return;
  try {
    if (!obj.isDeleted?.()) obj.delete();
  } catch {
    /* ignore */
  }
  cvCounters.livePersistent--;
}
