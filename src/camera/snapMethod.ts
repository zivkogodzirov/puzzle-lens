/**
 * How Snap takes its picture. Chosen on the phone by the Device check "Photo test", because on
 * some iPhones takePhoto() fails in some (or all) ways — measured on the owner's phone on
 * 2026-11-06: every takePhoto() call failed with "Internal error" / "setMaxPhotoDimensions failed".
 */
import type { PhotoSettingsLike } from '../types/media';

export type PhotoSize = 'none' | 'as-delivered' | 'landscape' | 'caps-max' | 'camera-default';

export type SnapMethod =
  | {
      kind: 'takePhoto';
      size: PhotoSize;
      /** The live tracking must be paused around the photo (the clone in the worker gets in the way). */
      pauseTracking: boolean;
      /** Take it from a fresh clone of the camera track. */
      onClone: boolean;
    }
  | { kind: 'grabFrame' }
  | { kind: 'file' };

export function parseSnapMethod(raw: string): SnapMethod | null {
  if (!raw) return null;
  try {
    const m = JSON.parse(raw) as SnapMethod;
    if (m && (m.kind === 'takePhoto' || m.kind === 'grabFrame' || m.kind === 'file')) return m;
  } catch {
    /* fall through */
  }
  return null;
}

export function describeSnapMethod(m: SnapMethod | null): string {
  if (!m) return 'Automatic';
  if (m.kind === 'grabFrame') return 'Full-size live picture';
  if (m.kind === 'file') return "iPhone's camera screen";
  const size = { none: 'no size', 'as-delivered': 'size as the camera delivers it', landscape: 'sideways size', 'caps-max': 'largest size offered', 'camera-default': "camera's own setting" }[m.size];
  return `Camera photo (${size}${m.pauseTracking ? ', tracking paused' : ''}${m.onClone ? ', from a copy of the camera' : ''})`;
}

/** The photo size to ask for. `delivered` = the track's current width/height; caps/defaults from ImageCapture. */
export function photoSizeFor(
  size: PhotoSize,
  delivered: { width?: number; height?: number },
  caps: { imageWidth?: { max: number }; imageHeight?: { max: number } } | null,
  cameraDefault: PhotoSettingsLike | null,
): PhotoSettingsLike | null {
  const w = delivered.width ?? 0;
  const h = delivered.height ?? 0;
  switch (size) {
    case 'none':
      return null;
    case 'as-delivered':
      return w && h ? { imageWidth: w, imageHeight: h } : null;
    case 'landscape':
      return w && h ? { imageWidth: Math.max(w, h), imageHeight: Math.min(w, h) } : null;
    case 'caps-max':
      return caps?.imageWidth?.max && caps.imageHeight?.max ? { imageWidth: caps.imageWidth.max, imageHeight: caps.imageHeight.max } : null;
    case 'camera-default':
      return cameraDefault?.imageWidth && cameraDefault.imageHeight ? { imageWidth: cameraDefault.imageWidth, imageHeight: cameraDefault.imageHeight } : null;
  }
}
