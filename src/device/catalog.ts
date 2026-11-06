/**
 * Every Device check row: its section and plain-English name, in display order.
 * Pure data + helpers (no DOM), so it can be unit-tested and used anywhere.
 */
import type { CheckEntry, CheckStatus, SectionId } from './types';
import { toPlain } from './util';

export const SECTIONS: ReadonlyArray<{ id: SectionId; title: string }> = [
  { id: 'basics', title: 'Basics' },
  { id: 'camera', title: 'Camera' },
  { id: 'photos', title: 'Photos (Snap)' },
  { id: 'graphics', title: 'Graphics & speed' },
  { id: 'storage', title: 'Storage & offline' },
  { id: 'other', title: 'Other' },
];

/** Live camera formats tested, in order (the same names as Settings → Live camera format). */
export const CAMERA_FORMATS = ['auto-4x3', '4k', '1080p'] as const;
export type CameraFormat = (typeof CAMERA_FORMATS)[number];

export const FORMAT_NAMES: Record<CameraFormat, string> = {
  'auto-4x3': 'full sensor 4:3',
  '4k': '4K',
  '1080p': '1080p',
};

type Def = readonly [id: string, section: SectionId, label: string];

const PROBE_SIZE_NAMES = {
  none: 'no size given',
  'as-delivered': 'size as delivered (upright)',
  landscape: 'sideways size',
  'caps-max': 'largest size offered',
  'camera-default': "camera's own setting",
} as const;

const DEFS: Def[] = [
  // Basics
  ['secure-context', 'basics', 'Secure connection (https)'],
  ['running-as', 'basics', 'Running as'],
  ['browser-version', 'basics', 'Safari version'],
  ['background-workers', 'basics', 'Background helpers (workers)'],
  // Camera
  ['getusermedia', 'camera', 'Camera access'],
  ['camera-permission', 'camera', 'Camera permission right now'],
  ['camera-permission-history', 'camera', 'Home Screen app remembers camera permission'],
  ['mstp-worker', 'camera', 'Live frames go straight to a helper'],
  ['videoframe', 'camera', 'Video frames (VideoFrame)'],
  ['rvfc', 'camera', 'Frame-by-frame video timing'],
  ['camera-lenses', 'camera', 'Cameras found'],
  ['camera-capabilities', 'camera', 'Best video the camera offers'],
  ['camera-zoom', 'camera', 'Zoom range'],
  ['camera-torch', 'camera', 'Torch (flashlight)'],
  ['camera-controls', 'camera', 'Focus, white balance, exposure control'],
  ...CAMERA_FORMATS.map((f): Def => [`camera-format-${f}`, 'camera', `Live video, ${FORMAT_NAMES[f]}`]),
  ['camera-frame-format', 'camera', 'Live frame format'],
  ['camera-frame-info', 'camera', 'Live frame orientation and size'],
  // Photos (Snap)
  ['imagecapture', 'photos', 'Take photos from inside the app'],
  ...CAMERA_FORMATS.flatMap((f): Def[] => [
    [`photo-${f}-current`, 'photos', `Photo in ${FORMAT_NAMES[f]} mode, exact size`],
    [`photo-${f}-default`, 'photos', `Photo in ${FORMAT_NAMES[f]} mode, no size given`],
  ]),
  ['photo-48mp', 'photos', '48 MP photo'],
  ['two-x-test', 'photos', '2× lens test'],
  ['file-camera', 'photos', "iPhone's own camera screen (backup way)"],
  // Photo test (step 4): each possible cause of a failing in-app photo on its own
  ['photo-probe-info', 'photos', 'Photo test: what the camera says about photos'],
  ...(['none', 'as-delivered', 'landscape', 'caps-max', 'camera-default'] as const).map((s): Def => [`photo-probe-off-${s}`, 'photos', `Photo test, tracking off: ${PROBE_SIZE_NAMES[s]}`]),
  ['photo-probe-off-clone', 'photos', 'Photo test, tracking off: from a copy of the camera'],
  ...(['none', 'as-delivered', 'landscape', 'caps-max', 'camera-default'] as const).map((s): Def => [`photo-probe-on-${s}`, 'photos', `Photo test, tracking on: ${PROBE_SIZE_NAMES[s]}`]),
  ['photo-probe-on-clone', 'photos', 'Photo test, tracking on: from a copy of the camera'],
  ...(['none', 'as-delivered', 'landscape', 'caps-max', 'camera-default'] as const).map((s): Def => [`photo-probe-onfull-${s}`, 'photos', `Photo test, full-size tracking: ${PROBE_SIZE_NAMES[s]}`]),
  ['photo-probe-onfull-clone', 'photos', 'Photo test, full-size tracking: from a copy of the camera'],
  ['photo-probe-grab', 'photos', 'Photo test: full-size live picture'],
  ['photo-probe-choice', 'photos', 'How Snap will take pictures'],
  // Graphics & speed
  ['offscreen-canvas', 'graphics', 'Drawing in background helpers'],
  ['image-bitmap-worker', 'graphics', 'Picture decoding in background helpers'],
  ['webgpu-adapter', 'graphics', 'Graphics chip for maths (WebGPU)'],
  ['webgpu-limits', 'graphics', 'Graphics chip limits'],
  ['webgpu-f16', 'graphics', 'Half-precision maths (shader-f16)'],
  ['webgpu-device', 'graphics', 'Graphics chip ready to use'],
  ['webgpu-compute-main', 'graphics', 'Graphics chip test (main)'],
  ['webgpu-compute-worker', 'graphics', 'Graphics chip test (background helper)'],
  ['wasm-simd', 'graphics', 'Fast maths (WebAssembly SIMD)'],
  ['wasm-exceptions', 'graphics', 'WebAssembly error handling'],
  ['wasm-jspi', 'graphics', 'WebAssembly JSPI (for AI models later)'],
  ['canvas-noise-main', 'graphics', 'Exact pixel reading (main)'],
  ['canvas-noise-worker', 'graphics', 'Exact pixel reading (background helper)'],
  ['videoframe-readback', 'graphics', 'Exact pixel reading (video frames)'],
  ['opencv-load', 'graphics', 'Image engine (OpenCV) loads'],
  ['opencv-bench', 'graphics', 'Image engine speed'],
  // Storage & offline
  ['storage-space', 'storage', 'Storage space'],
  ['storage-persist', 'storage', 'Data protected from automatic clean-up'],
  ['opfs', 'storage', 'Private file storage (OPFS)'],
  ['indexeddb', 'storage', 'Database (IndexedDB)'],
  ['service-worker', 'storage', 'Works without internet'],
  // Other
  ['wake-lock', 'other', 'Keep the screen awake'],
  ['web-share-files', 'other', 'Share files (AirDrop, Mail, Files)'],
  ['orientation-permission', 'other', 'Tilt sensor'],
  ['memory-headroom', 'other', 'Memory headroom'],
];

export const CHECK_ORDER: readonly string[] = DEFS.map((d) => d[0]);
const BY_ID = new Map<string, Def>(DEFS.map((d) => [d[0], d]));

export function checkDef(id: string): { section: SectionId; label: string } {
  const d = BY_ID.get(id);
  return d ? { section: d[1], label: d[2] } : { section: 'other', label: id };
}

/** Builds a result row; details are made JSON-safe so they can be stored and shown. */
export function makeEntry(id: string, status: CheckStatus, value: string, details?: unknown): CheckEntry {
  const { section, label } = checkDef(id);
  const e: CheckEntry = { id, section, label, status, value };
  const plain = toPlain(details);
  if (plain !== undefined) e.details = plain;
  return e;
}
