/**
 * Minimal types for camera APIs that Safari ships but TypeScript's DOM library doesn't
 * describe (or describes only partly). Accessed through these helpers so the rest of the
 * app never touches `any` directly.
 */

export interface PhotoSettingsLike {
  imageWidth?: number;
  imageHeight?: number;
  fillLightMode?: 'auto' | 'off' | 'flash';
  redEyeReduction?: boolean;
}

export interface PhotoCapabilitiesLike {
  imageWidth?: { min: number; max: number; step?: number };
  imageHeight?: { min: number; max: number; step?: number };
  fillLightMode?: string[];
  redEyeReduction?: string;
}

export interface ImageCaptureLike {
  takePhoto(settings?: PhotoSettingsLike): Promise<Blob>;
  getPhotoCapabilities?(): Promise<PhotoCapabilitiesLike>;
  getPhotoSettings?(): Promise<PhotoSettingsLike>;
  grabFrame?(): Promise<ImageBitmap>;
}

type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCaptureLike;

export function imageCaptureCtor(): ImageCaptureCtor | undefined {
  return (globalThis as unknown as { ImageCapture?: ImageCaptureCtor }).ImageCapture;
}

/** Camera capabilities including the non-standard-in-TS ones (zoom, torch, focusDistance…). */
export interface CameraCapabilities extends MediaTrackCapabilities {
  zoom?: { min: number; max: number; step?: number };
  torch?: boolean;
  focusDistance?: { min: number; max: number; step?: number };
  focusMode?: string[];
  whiteBalanceMode?: string[];
  exposureMode?: string[];
  powerEfficient?: boolean[];
}

export interface CameraSettings extends MediaTrackSettings {
  zoom?: number;
  torch?: boolean;
  focusDistance?: number;
  whiteBalanceMode?: string;
}

export function trackCapabilities(track: MediaStreamTrack): CameraCapabilities {
  try {
    return (track.getCapabilities?.() ?? {}) as CameraCapabilities;
  } catch {
    return {};
  }
}

export function trackSettings(track: MediaStreamTrack): CameraSettings {
  return track.getSettings() as CameraSettings;
}

/** requestVideoFrameCallback is in Safari since 15.4 but not in every TS DOM version. */
export interface VideoFrameMeta {
  presentationTime: number;
  expectedDisplayTime: number;
  width: number;
  height: number;
  mediaTime: number;
  presentedFrames: number;
}

type RvfcVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: VideoFrameMeta) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export function rvfc(video: HTMLVideoElement): RvfcVideo {
  return video as RvfcVideo;
}
