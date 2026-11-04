/**
 * The functions each worker offers to the main thread (called through Comlink).
 * Declared here, not in the worker files, so the main thread never imports worker code.
 */
import type {
  CvBenchResult,
  PhotoStats,
  TrackerFrameResult,
  TrackerStatus,
  TwoXResult,
  WorkerInitInfo,
  WorkerMemory,
} from './types';

export interface TrackerApi {
  init(): Promise<WorkerInitInfo>;
  /** Takes ownership of a cloned camera track (transferred) and reads its frames until detach(). */
  attachTrack(track: MediaStreamTrack, onResult: (r: TrackerFrameResult) => void): Promise<{ ok: boolean; error?: string }>;
  /** Fallback path: one frame sent as an ImageBitmap (transferred). */
  processBitmap(bitmap: ImageBitmap, timestampUs: number): Promise<TrackerFrameResult | null>;
  /** Stops reading the attached track; resolves once the loop has finished and stopped the track. */
  detach(): Promise<void>;
  setRate(fps: number): void;
  /** Longest gap between camera frames inside [startAbs, endAbs] (ms since epoch). */
  maxFrameGap(startAbs: number, endAbs: number): number;
  status(): TrackerStatus;
  recentFrames(): Blob[];
}

export interface ReaderApi {
  init(): Promise<WorkerInitInfo>;
  analysePhoto(blob: Blob): Promise<PhotoStats>;
  twoX(oneXBlob: Blob, twoXBlob: Blob): Promise<TwoXResult>;
  bench(): Promise<CvBenchResult>;
  /** A small JPEG of the photo. Pass the photo's size when known, so it isn't decoded at full size just to measure it. */
  preview(blob: Blob, maxSide: number, size?: { width: number; height: number }): Promise<Blob>;
  memory(): WorkerMemory;
}

export interface ReportFileInput {
  name: string;
  blob?: Blob;
  text?: string;
  /** Store without compression (JPEG/PNG). Defaults to true for blobs. */
  stored?: boolean;
}

export interface ReportWorkerApi {
  build(files: ReportFileInput[]): Promise<Blob>;
}
