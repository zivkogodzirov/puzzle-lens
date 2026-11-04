import { afterEach, describe, expect, it, vi } from 'vitest';
import { canShareFile, downloadUrl, revokeDownloadUrls, shareOrDownload, SHARE_TITLE } from '../../src/report/share';

const makeFile = () => new File([new Uint8Array([0x50, 0x4b, 3, 4])], 'puzzle-lens-report-2026-11-04-1432.zip', { type: 'application/zip' });

function stubNavigator(nav: Partial<Pick<Navigator, 'share' | 'canShare'>>): void {
  vi.stubGlobal('navigator', nav);
}

afterEach(() => {
  revokeDownloadUrls();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('report: share or download', () => {
  it('calls navigator.share synchronously, with the prepared file and title', async () => {
    const share = vi.fn<(data: ShareData) => Promise<void>>(() => Promise.resolve());
    stubNavigator({ share, canShare: () => true });
    const file = makeFile();
    const pending = shareOrDownload(file);
    // Called before any await: required to keep the tap's permission on iOS.
    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0]![0]).toEqual({ files: [file], title: SHARE_TITLE });
    await expect(pending).resolves.toEqual({ kind: 'shared' });
  });

  it('does nothing when the user cancels the share sheet', async () => {
    const createUrl = vi.spyOn(URL, 'createObjectURL');
    stubNavigator({ share: () => Promise.reject(new DOMException('Share canceled', 'AbortError')), canShare: () => true });
    await expect(shareOrDownload(makeFile())).resolves.toEqual({ kind: 'cancelled' });
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('offers a download when sharing is not allowed (e.g. too long after the tap)', async () => {
    stubNavigator({ share: () => Promise.reject(new DOMException('Not allowed', 'NotAllowedError')), canShare: () => true });
    const outcome = await shareOrDownload(makeFile());
    expect(outcome.kind).toBe('download');
    if (outcome.kind !== 'download') return;
    expect(outcome.url).toMatch(/^blob:/);
    expect(outcome.reason).toContain('NotAllowedError');
  });

  it('offers a download when sharing files is not supported', async () => {
    const share = vi.fn(() => Promise.resolve());
    stubNavigator({ share, canShare: () => false });
    const outcome = await shareOrDownload(makeFile());
    expect(outcome.kind).toBe('download');
    expect(share).not.toHaveBeenCalled();

    stubNavigator({});
    expect((await shareOrDownload(makeFile())).kind).toBe('download');
  });

  it('offers a download when share throws straight away', async () => {
    stubNavigator({
      share: () => {
        throw new TypeError('bad data');
      },
      canShare: () => true,
    });
    const outcome = await shareOrDownload(makeFile());
    expect(outcome).toMatchObject({ kind: 'download', reason: expect.stringContaining('bad data') });
  });

  it('treats a throwing canShare as "cannot share"', () => {
    stubNavigator({
      share: () => Promise.resolve(),
      canShare: () => {
        throw new Error('nope');
      },
    });
    expect(canShareFile(makeFile())).toBe(false);
  });

  it('makes one download address per file and frees old ones', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const a = makeFile();
    const b = makeFile();
    const urlA = downloadUrl(a);
    expect(downloadUrl(a)).toBe(urlA);
    const urlB = downloadUrl(b);
    expect(urlB).not.toBe(urlA);

    revokeDownloadUrls(b);
    expect(revoke).toHaveBeenCalledWith(urlA);
    expect(revoke).not.toHaveBeenCalledWith(urlB);
    expect(downloadUrl(b)).toBe(urlB); // kept

    revokeDownloadUrls();
    expect(revoke).toHaveBeenCalledWith(urlB);
    expect(downloadUrl(a)).not.toBe(urlA); // a fresh one after freeing
  });
});
