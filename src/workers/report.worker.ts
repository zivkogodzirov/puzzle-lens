/// <reference lib="webworker" />
/**
 * Packs a report (or later, a backup) into one ZIP file, off the main thread. The file is fully
 * prepared BEFORE the user taps "Share", because iOS only allows the share sheet within ~5 s of
 * a tap (RESEARCH §3, §14).
 */
import * as Comlink from 'comlink';
import { buildZip, type ZipEntry } from '../report/zip';
import type { ReportFileInput, ReportWorkerApi } from '../shared/apis';

const api: ReportWorkerApi = {
  async build(files: ReportFileInput[]): Promise<Blob> {
    const entries: ZipEntry[] = [];
    for (const f of files) {
      if (f.text !== undefined) entries.push({ name: f.name, data: f.text, stored: f.stored });
      else if (f.blob) entries.push({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()), stored: f.stored ?? true });
    }
    const bytes = buildZip(entries);
    return new Blob([bytes as BlobPart], { type: 'application/zip' });
  },
};

Comlink.expose(api);
