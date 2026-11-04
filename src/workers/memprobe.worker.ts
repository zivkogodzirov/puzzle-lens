/// <reference lib="webworker" />
/**
 * Memory headroom test (Device check, opt-in). Grows a WebAssembly memory in steps and touches
 * every byte, reporting after each step. If iOS kills the page, the main thread's last saved
 * step tells us roughly how much memory was available (RESEARCH §19 item 8).
 */
interface Start {
  stepMB: number;
  maxMB: number;
}

const PAGE = 64 * 1024;

self.onmessage = async (ev: MessageEvent<Start>) => {
  const { stepMB, maxMB } = ev.data;
  const stepPages = Math.round((stepMB * 1024 * 1024) / PAGE);
  const maxPages = Math.min(65536, Math.round((maxMB * 1024 * 1024) / PAGE));
  let mem: WebAssembly.Memory;
  try {
    mem = new WebAssembly.Memory({ initial: 1, maximum: maxPages });
  } catch (err) {
    self.postMessage({ kind: 'error', message: String(err), reachedMB: 0 });
    return;
  }
  let pages = 1;
  while (pages + stepPages <= maxPages) {
    try {
      mem.grow(stepPages);
    } catch (err) {
      self.postMessage({ kind: 'limit', message: String(err), reachedMB: Math.round((pages * PAGE) / 1048576) });
      return;
    }
    // Touch the new pages so they really count against the page's memory.
    new Uint8Array(mem.buffer, pages * PAGE, stepPages * PAGE).fill(1);
    pages += stepPages;
    self.postMessage({ kind: 'step', reachedMB: Math.round((pages * PAGE) / 1048576) });
    // Give the main thread time to save progress before we push further.
    await new Promise((r) => setTimeout(r, 120));
  }
  self.postMessage({ kind: 'done', reachedMB: Math.round((pages * PAGE) / 1048576) });
};
