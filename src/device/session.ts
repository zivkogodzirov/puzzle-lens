/**
 * Device check state and the four runs (automatic, camera, file camera, memory). Kept outside
 * the screen component so an automatic run keeps going (and is saved) if you leave the screen;
 * the camera and memory tests are stopped when you leave.
 */
import { signal } from '@preact/signals';
import { APP_VERSION, displayMode } from '../app/env';
import { stopCamera } from '../camera/camera';
import { beginExternalCapture, cancelExternalCapture } from '../camera/snap';
import { logError, logInfo } from '../log/logger';
import { collectEnvironment, runAutomaticChecks, type RunHooks } from './autoChecks';
import { fileCameraEntry, runCameraTests, safeStopPump } from './cameraChecks';
import { runPhotoProbe } from './photoProbe';
import { applyRun, carryForward, formatMB, newResults } from './format';
import { BACKGROUND_STOP_MESSAGE, startMemoryTest, takeCrashedMemoryResult, type MemoryTestHandle } from './memoryRunner';
import { loadDeviceCheckHistory, saveDeviceCheck } from './store';
import type { CheckEntry, DeviceCheckResults, DeviceEnvironment, DisplayMode, RunPart } from './types';
import { errorMessage } from './util';

export const deviceCheck = {
  /** The results on screen (saved ones, or the current run's so far). */
  results: signal<DeviceCheckResults | null>(null),
  /**
   * When each mode was last checked (newest saved row). On an iPhone only the current mode is ever
   * filled in: the Safari tab and the Home Screen app keep separate storage.
   */
  savedByMode: signal<Partial<Record<DisplayMode, number>>>({}),
  running: signal<RunPart | null>(null),
  progress: signal(''),
  memoryMB: signal<number | null>(null),
  /** A one-off message shown at the top (e.g. the memory result found after a crash). */
  notice: signal<string | null>(null),
  lastError: signal<string | null>(null),
  loaded: signal(false),
};

/** Newest saved results for the current display mode. */
let sameModeSaved: DeviceCheckResults | null = null;
let aborted = false;
let memoryHandle: MemoryTestHandle | null = null;
let fileOpenedAt = 0;

/**
 * What a new run adds to: the results already on screen or saved for this mode. After an app update
 * the earlier rows are kept (each remembers the version that measured it), so no part silently
 * drops out of the screen or the report.
 */
function baseResults(env: DeviceEnvironment): DeviceCheckResults {
  const mode = displayMode();
  const shown = deviceCheck.results.value;
  if (shown && shown.mode === mode) return carryForward(shown, APP_VERSION);
  if (sameModeSaved && sameModeSaved.mode === mode) return carryForward(sameModeSaved, APP_VERSION);
  return newResults(APP_VERSION, mode, env, Date.now());
}

async function save(results: DeviceCheckResults): Promise<void> {
  try {
    await saveDeviceCheck(results);
    sameModeSaved = results;
    deviceCheck.savedByMode.value = { ...deviceCheck.savedByMode.value, [results.mode]: results.ts };
  } catch (err) {
    deviceCheck.lastError.value = `Could not save the results: ${errorMessage(err)}`;
    logError('device', 'Could not save Device check results', err);
  }
}

/**
 * Runs one part. `body` is called synchronously (before any await), which the camera tests
 * rely on: iOS only shows the camera permission prompt for a call made inside the tap.
 */
function execute(part: RunPart, body: (h: RunHooks) => Promise<void>): Promise<void> {
  if (deviceCheck.running.value) return Promise.resolve();
  deviceCheck.running.value = part;
  deviceCheck.lastError.value = null;
  aborted = false;
  const env = collectEnvironment();
  const before = deviceCheck.results.value;
  const base = baseResults(env);
  const collected: CheckEntry[] = [];
  const show = () => {
    deviceCheck.results.value = applyRun(base, collected, null, Date.now(), env);
  };
  show();
  let work: Promise<void>;
  try {
    work = body({
      onCheck: (e) => {
        collected.push(e);
        show();
      },
      onProgress: (m) => {
        deviceCheck.progress.value = m;
      },
      isAborted: () => aborted,
    });
  } catch (err) {
    work = Promise.reject(err);
  }
  return work
    .catch((err: unknown) => {
      deviceCheck.lastError.value = errorMessage(err);
      logError('device', `Device check (${part}) stopped with an error`, err);
    })
    .then(async () => {
      if (aborted) {
        deviceCheck.results.value = before;
        return;
      }
      if (!collected.length) return;
      const final = applyRun(base, collected, part, Date.now(), env);
      deviceCheck.results.value = final;
      await save(final);
      logInfo('device', `Device check (${part}) finished: ${collected.length} results`);
    })
    .finally(() => {
      deviceCheck.running.value = null;
      deviceCheck.progress.value = '';
      deviceCheck.memoryMB.value = null;
    });
}

/** Loads the saved results; also turns an unfinished memory test into its result (the app was closed by iOS). */
export async function loadSaved(): Promise<void> {
  try {
    const h = await loadDeviceCheckHistory();
    sameModeSaved = h.byMode[displayMode()]?.results ?? null;
    // Only this mode's results: on an iPhone the other mode's are in separate storage anyway.
    if (!deviceCheck.running.value) deviceCheck.results.value = sameModeSaved;
    deviceCheck.savedByMode.value = { browser: h.byMode.browser?.results.ts, standalone: h.byMode.standalone?.results.ts };
  } catch (err) {
    deviceCheck.lastError.value = `Could not load saved results: ${errorMessage(err)}`;
  }
  deviceCheck.loaded.value = true;
  if (deviceCheck.running.value) return;
  const crashed = takeCrashedMemoryResult();
  if (crashed) {
    if (crashed.status === 'yes') {
      deviceCheck.notice.value = `Memory test result: ${crashed.value}. That's the measurement — thank you!`;
      await execute('memory', async (hooks) => hooks.onCheck(crashed));
    } else {
      // Interrupted rather than measured: say so, but don't replace an earlier real result.
      deviceCheck.notice.value = `${crashed.value}.`;
      logInfo('device', `Unfinished memory test found: ${crashed.value}`);
    }
  }
}

export function startAutomatic(): void {
  void execute('automatic', (h) => runAutomaticChecks(h));
}

/** Call directly from the tap (camera permission). */
export function startCameraTests(video: HTMLVideoElement): void {
  void execute('camera', (h) => runCameraTests({ ...h, video }));
}

/** The Photo test. Call directly from the tap (camera permission). */
export function startPhotoProbe(video: HTMLVideoElement): void {
  void execute('photoProbe', (h) => runPhotoProbe({ ...h, video }));
}

/** Leaving the screen stops the camera tests and the Photo test (nothing is saved for an unfinished run). */
export function abortCameraTests(): void {
  if (deviceCheck.running.value !== 'camera' && deviceCheck.running.value !== 'photoProbe') return;
  aborted = true;
  safeStopPump();
  stopCamera();
}

/** Opens the iPhone's camera screen. Call directly from the tap. */
export function openFileCamera(input: HTMLInputElement): void {
  if (deviceCheck.running.value) return;
  fileOpenedAt = beginExternalCapture();
  input.click();
}

export function fileCameraChosen(file: File | null): void {
  cancelExternalCapture();
  if (!file) return;
  void execute('fileCamera', async (h) => {
    h.onProgress('Measuring the photo…');
    h.onCheck(await fileCameraEntry(file, fileOpenedAt));
  });
}

export function startMemory(): void {
  void execute('memory', async (h) => {
    h.onProgress('Memory test: starting…');
    deviceCheck.memoryMB.value = 0;
    const handle = startMemoryTest((mb) => {
      deviceCheck.memoryMB.value = mb;
      h.onProgress(`Memory test: ${formatMB(mb)} so far…`);
    });
    memoryHandle = handle;
    try {
      const entry = await handle.done;
      if (entry === null) {
        deviceCheck.notice.value = BACKGROUND_STOP_MESSAGE;
        logInfo('device', 'Memory test stopped: the app went to the background');
      } else if (!h.isAborted()) h.onCheck(entry);
    } finally {
      memoryHandle = null;
    }
  });
}

/** Leaving the screen stops the memory test. */
export function cancelMemory(): void {
  if (!memoryHandle) return;
  aborted = true;
  memoryHandle.cancel();
}

export function dismissNotice(): void {
  deviceCheck.notice.value = null;
}
