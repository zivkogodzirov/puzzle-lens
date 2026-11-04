/**
 * Sends a prepared file through the iOS share sheet (AirDrop, Mail, Messages, Files…), or offers it
 * as a download when sharing isn't possible.
 *
 * iOS only opens the share sheet within ~5 s of a tap (transient activation; RESEARCH §3, §14).
 * So: make the file first, then call shareOrDownload() as the FIRST thing in the click handler,
 * with no `await` before it.
 */

export type ShareOutcome =
  | { kind: 'shared' }
  /** The user closed the share sheet: nothing to do. */
  | { kind: 'cancelled' }
  /** Sharing isn't possible or failed: show a visible `<a download href={url}>` link. */
  | { kind: 'download'; url: string; reason: string };

export const SHARE_TITLE = 'Puzzle Lens report';

/** Object URLs we made, per file, so each file gets one URL and old ones can be freed. */
const urls = new Map<Blob, string>();

/** True if this browser can share this file with the share sheet. */
export function canShareFile(file: File): boolean {
  try {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    return typeof nav?.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/** A download link address for the file (made once per file; freed by revokeDownloadUrls). */
export function downloadUrl(file: Blob): string {
  let url = urls.get(file);
  if (!url) {
    url = URL.createObjectURL(file);
    urls.set(file, url);
  }
  return url;
}

/** Frees the memory behind old download links. Pass `keep` for a file whose link is still on screen. */
export function revokeDownloadUrls(keep?: Blob): void {
  for (const [blob, url] of urls) {
    if (blob === keep) continue;
    URL.revokeObjectURL(url);
    urls.delete(blob);
  }
}

function describe(err: unknown): string {
  const e = err as { name?: string; message?: string } | null;
  if (e && typeof e === 'object' && (e.name || e.message)) return `${e.name ?? 'Error'}: ${e.message ?? ''}`.trim();
  return String(err);
}

function offerDownload(file: File, reason: string): ShareOutcome {
  return { kind: 'download', url: downloadUrl(file), reason };
}

/**
 * Opens the share sheet for an already-prepared file. Must be called synchronously from the tap's
 * click handler. Never rejects:
 * - shared → `{ kind: 'shared' }`
 * - the user cancelled (AbortError) → `{ kind: 'cancelled' }`
 * - not supported, not allowed (NotAllowedError, e.g. the 5-second window passed) or any other
 *   failure → `{ kind: 'download', url }` for a visible download link (works in Safari).
 */
export function shareOrDownload(file: File, title: string = SHARE_TITLE): Promise<ShareOutcome> {
  if (!canShareFile(file)) return Promise.resolve(offerDownload(file, 'This browser cannot share files'));
  let pending: Promise<void>;
  try {
    pending = navigator.share({ files: [file], title });
  } catch (err) {
    return Promise.resolve(offerDownload(file, describe(err)));
  }
  return pending.then(
    (): ShareOutcome => ({ kind: 'shared' }),
    (err: unknown): ShareOutcome => ((err as { name?: string } | null)?.name === 'AbortError' ? { kind: 'cancelled' } : offerDownload(file, describe(err))),
  );
}
