/**
 * A simulated iPhone back camera for the end-to-end tests. Installed with
 * `page.addInitScript(installFakeCamera, options)`, so it runs in the page before the app.
 *
 * What it replaces:
 * - navigator.mediaDevices.getUserMedia → a stream captured from a hidden canvas (1280×960 by
 *   default) that shows a grey "table" with an ArUco DICT_4X4_50 marker id 0 on a white quiet
 *   zone, moving slowly so every frame is different;
 * - navigator.mediaDevices.enumerateDevices → one camera called "Back Camera" (labels only after
 *   getUserMedia was called, as in Safari);
 * - navigator.permissions.query({ name: 'camera' }) → 'granted';
 * - window.ImageCapture → takePhoto() returns a JPEG of the current canvas after ~200 ms.
 * Each track gets getSettings()/getCapabilities() that report the canvas size, because canvas
 * capture tracks don't report a width and height of their own.
 *
 * IMPORTANT: Playwright sends this function to the page as source text, so it must be fully
 * self-contained: no imports, no references to anything outside its body, no class fields.
 */

export interface FakeCameraOptions {
  width?: number;
  height?: number;
  fps?: number;
  /** How long takePhoto() takes. */
  photoDelayMs?: number;
  /**
   * false: track.clone() returns a stand-in that can't be sent to a worker, so the app must use
   * its fallback frame path (main thread → ImageBitmap → worker), as on iPhones before iOS 18.
   */
  directFrames?: boolean;
  /** A picture (data: URL) to show instead of the moving marker, e.g. a simulated table photo. Shown still. */
  scene?: string;
}

/** What the fake camera exposes on `window.__fakeCamera` for tests to inspect. */
export interface FakeCameraStats {
  getUserMediaCalls: number;
  photosTaken: number;
  framesDrawn: number;
  width: number;
  height: number;
  /** Camera tracks from getUserMedia that are still running (must be 0 after leaving Live). */
  liveCameraTracks: number;
  /** Clones made on the main thread that are still running (fallback test: the un-sendable clone). */
  liveClones: number;
}

export function installFakeCamera(options: FakeCameraOptions = {}): void {
  const W = options.width ?? 1280;
  const H = options.height ?? 960;
  const FPS = options.fps ?? 30;
  const PHOTO_DELAY_MS = options.photoDelayMs ?? 200;
  const DIRECT_FRAMES = options.directFrames ?? true;
  const DEVICE_ID = 'fake-back-camera';
  const GROUP_ID = 'fake-camera-group';
  const LABEL = 'Back Camera';

  const win = window as unknown as Record<string, unknown>;
  if (win.__fakeCamera) return;
  const cameraTracks: MediaStreamTrack[] = [];
  const clones: MediaStreamTrack[] = [];
  const countLive = (list: MediaStreamTrack[]) => list.filter((t) => t.readyState === 'live').length;
  const stats = { getUserMediaCalls: 0, photosTaken: 0, framesDrawn: 0, width: W, height: H, liveCameraTracks: 0, liveClones: 0 };
  Object.defineProperty(stats, 'liveCameraTracks', { get: () => countLive(cameraTracks), enumerable: true });
  Object.defineProperty(stats, 'liveClones', { get: () => countLive(clones), enumerable: true });
  win.__fakeCamera = stats;

  // ArUco DICT_4X4_50 id 0, copied from public/test-marker.svg (6×6 cells including the black border).
  const MARKER = ['111111', '101001', '110101', '111001', '111011', '111111'];

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;left:-20000px;top:0;width:8px;height:6px;pointer-events:none;';
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const c2d: CanvasRenderingContext2D = ctx;

  // A fixed "table" texture (drawn once with a simple seeded random generator) so the picture has detail.
  const background = document.createElement('canvas');
  background.width = W;
  background.height = H;
  const bg = background.getContext('2d');
  if (bg) {
    bg.fillStyle = '#5a6470';
    bg.fillRect(0, 0, W, H);
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 260; i++) {
      const shade = Math.round(70 + rnd() * 90);
      bg.fillStyle = `rgb(${shade},${shade + 8},${shade + 16})`;
      bg.fillRect(rnd() * W, rnd() * H, 8 + rnd() * 60, 8 + rnd() * 60);
    }
  }

  const t0 = performance.now();
  /** The scene's transform (canvas px) at performance time `at`: identity without motion. */
  function sceneMatrix(at: number): [number, number, number, number, number, number] {
    const mo = win.__fakeSceneMotion as { vx: number; vy: number; rot: number; since: number } | undefined;
    if (!mo) return [1, 0, 0, 1, 0, 0];
    const dt = Math.max(0, at - mo.since) / 1000;
    const a = mo.rot * dt;
    const c = Math.cos(a);
    const s2 = Math.sin(a);
    // Turn about the canvas centre, then shift.
    const tx = W / 2 + mo.vx * dt - (c * W) / 2 + (s2 * H) / 2;
    const ty = H / 2 + mo.vy * dt - (s2 * W) / 2 - (c * H) / 2;
    return [c, s2, -s2, c, tx, ty];
  }
  (stats as unknown as { sceneMatrix: typeof sceneMatrix }).sceneMatrix = sceneMatrix;
  let sceneImg: HTMLImageElement | null = null;
  if (options.scene) {
    sceneImg = new Image();
    sceneImg.src = options.scene;
  }
  function draw(): void {
    const t = (performance.now() - t0) / 1000;
    c2d.setTransform(1, 0, 0, 1, 0, 0);
    // A scene can also be given later through window.__fakeScene (set by a test's own init script).
    if (typeof win.__fakeScene === 'string' && (!sceneImg || sceneImg.dataset.src !== win.__fakeScene)) {
      const img = new Image();
      img.dataset.src = win.__fakeScene;
      img.src = win.__fakeScene;
      // Keep showing the old picture until the new one has loaded.
      if (!sceneImg) sceneImg = img;
      else img.onload = () => (sceneImg = img);
    }
    if (sceneImg) {
      // A steady camera move over the scene (live view tests): window.__fakeSceneMotion =
      // { vx, vy (canvas px per second), rot (radians per second), since (performance.now()) }.
      const mo = win.__fakeSceneMotion as { vx: number; vy: number; rot: number; since: number } | undefined;
      if (mo) {
        c2d.fillStyle = '#e9e7e1';
        c2d.fillRect(0, 0, W, H);
        const m = sceneMatrix(performance.now());
        c2d.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      }
      if (sceneImg.complete && sceneImg.naturalWidth) c2d.drawImage(sceneImg, 0, 0, W, H);
      c2d.setTransform(1, 0, 0, 1, 0, 0);
      // One changing pixel in the corner keeps frames distinct without moving the picture.
      c2d.fillStyle = stats.framesDrawn % 2 ? '#fefefe' : '#fdfdfd';
      c2d.fillRect(0, 0, 1, 1);
      stats.framesDrawn++;
      return;
    }
    c2d.drawImage(background, 0, 0);
    // The marker drifts slowly in a small circle and turns a little (like a hand-held phone).
    const cell = Math.round(Math.min(W, H) / 24); // 40 px at 1280×960
    const cx = W / 2 + Math.cos(t * 0.8) * cell * 0.6;
    const cy = H / 2 + Math.sin(t * 0.8) * cell * 0.6;
    c2d.translate(cx, cy);
    c2d.rotate(Math.sin(t * 0.5) * 0.08);
    const quiet = 10 * cell; // 6 marker cells + 2 white cells on each side
    c2d.fillStyle = '#ffffff';
    c2d.fillRect(-quiet / 2, -quiet / 2, quiet, quiet);
    c2d.fillStyle = '#000000';
    for (let row = 0; row < 6; row++) {
      const bits = MARKER[row] ?? '';
      for (let col = 0; col < 6; col++) {
        if (bits[col] === '1') c2d.fillRect((col - 3) * cell, (row - 3) * cell, cell, cell);
      }
    }
    c2d.setTransform(1, 0, 0, 1, 0, 0);
    // A frame counter, so consecutive frames always differ.
    c2d.fillStyle = '#ffffff';
    c2d.font = '24px sans-serif';
    c2d.fillText(`fake camera · frame ${stats.framesDrawn}`, 16, H - 16);
    stats.framesDrawn++;
  }
  draw();

  let drawing: ReturnType<typeof setInterval> | null = null;
  function ensureDrawing(): void {
    if (!canvas.isConnected) {
      const parent = document.body ?? document.documentElement;
      if (parent) parent.appendChild(canvas);
    }
    if (drawing === null) drawing = setInterval(draw, Math.round(1000 / FPS));
  }

  function settingsFor(): MediaTrackSettings {
    return { width: W, height: H, frameRate: FPS, aspectRatio: W / H, deviceId: DEVICE_ID, groupId: GROUP_ID, facingMode: 'environment' };
  }

  function capabilitiesFor(): MediaTrackCapabilities {
    return {
      width: { min: 1, max: W },
      height: { min: 1, max: H },
      frameRate: { min: 1, max: FPS },
      aspectRatio: { min: 0.1, max: 10 },
      deviceId: DEVICE_ID,
      groupId: GROUP_ID,
      facingMode: ['environment'],
    };
  }

  /**
   * WebKit may garbage-collect the JavaScript wrapper of a DOM object that nothing references and
   * make a fresh one later, losing any properties we added to it. So every object we patch
   * directly is also kept here.
   */
  const keepAlive: unknown[] = [];

  /** Makes a canvas capture track look like a camera track (label, settings, capabilities). */
  function patchTrack(track: MediaStreamTrack): MediaStreamTrack {
    keepAlive.push(track);
    let constraints: MediaTrackConstraints = {};
    const define = (name: string, value: unknown) => Object.defineProperty(track, name, { value, configurable: true, writable: true });
    Object.defineProperty(track, 'label', { get: () => LABEL, configurable: true });
    define('getSettings', () => settingsFor());
    define('getCapabilities', () => capabilitiesFor());
    define('getConstraints', () => constraints);
    // Canvas tracks can't change size; accept and remember the request, like a camera that ignores it.
    define('applyConstraints', async (c?: MediaTrackConstraints) => {
      constraints = c ?? {};
    });
    const realClone = track.clone.bind(track);
    // Direct-frame clones are transferred to the worker, so only un-sendable clones are counted.
    define('clone', () => (DIRECT_FRAMES ? patchTrack(realClone()) : unsendableClone()));
    return track;
  }

  /** A track look-alike that postMessage refuses to transfer (DataCloneError). */
  function unsendableClone(): MediaStreamTrack {
    const fake = new EventTarget() as MediaStreamTrack & Record<string, unknown>;
    let state: MediaStreamTrackState = 'live';
    Object.defineProperty(fake, 'kind', { value: 'video' });
    Object.defineProperty(fake, 'label', { value: LABEL });
    Object.defineProperty(fake, 'readyState', { get: () => state });
    fake.enabled = true;
    fake.getSettings = () => settingsFor();
    fake.getCapabilities = () => capabilitiesFor();
    fake.getConstraints = () => ({});
    fake.applyConstraints = async () => {};
    fake.stop = () => {
      state = 'ended';
    };
    fake.clone = () => unsendableClone();
    clones.push(fake);
    return fake;
  }

  function fakeDevice(deviceId: string, label: string, groupId: string): MediaDeviceInfo {
    const info = { kind: 'videoinput' as MediaDeviceKind, deviceId, label, groupId };
    return { ...info, toJSON: () => info } as MediaDeviceInfo;
  }

  async function getUserMedia(constraints?: MediaStreamConstraints): Promise<MediaStream> {
    stats.getUserMediaCalls++;
    if (!constraints || !constraints.video) throw new DOMException('The fake camera only provides video', 'NotSupportedError');
    ensureDrawing();
    draw();
    const stream = canvas.captureStream(FPS);
    for (const t of stream.getVideoTracks()) {
      patchTrack(t);
      cameraTracks.push(t);
    }
    return stream;
  }

  async function enumerateDevices(): Promise<MediaDeviceInfo[]> {
    // Like Safari: before the camera was allowed, devices have no names or ids.
    return stats.getUserMediaCalls > 0 ? [fakeDevice(DEVICE_ID, LABEL, GROUP_ID)] : [fakeDevice('', '', '')];
  }

  const method = (target: object, name: string, value: unknown) => Object.defineProperty(target, name, { value, configurable: true, writable: true });
  const nav = navigator as Navigator & Record<string, unknown>;
  const g = globalThis as unknown as Record<string, { prototype: object } | undefined>;

  // Patch the prototypes (they live as long as the page), and the instances too, kept alive.
  let mediaDevices = navigator.mediaDevices as MediaDevices | undefined;
  if (!mediaDevices) {
    mediaDevices = new EventTarget() as MediaDevices;
    Object.defineProperty(nav, 'mediaDevices', { value: mediaDevices, configurable: true });
  }
  const mediaDevicesProto = g.MediaDevices?.prototype;
  if (mediaDevicesProto) {
    method(mediaDevicesProto, 'getUserMedia', getUserMedia);
    method(mediaDevicesProto, 'enumerateDevices', enumerateDevices);
  }
  method(mediaDevices, 'getUserMedia', getUserMedia);
  method(mediaDevices, 'enumerateDevices', enumerateDevices);
  keepAlive.push(mediaDevices);

  // Camera permission: always granted.
  const permissionsProto = g.Permissions?.prototype as Permissions | undefined;
  const realQuery = permissionsProto?.query;
  const permissions = navigator.permissions as Permissions | undefined;
  const fakeQuery = async function (this: Permissions | undefined, desc: PermissionDescriptor): Promise<PermissionStatus> {
    if (desc && (desc.name as string) === 'camera') {
      const status = new EventTarget() as PermissionStatus;
      Object.defineProperty(status, 'state', { value: 'granted' });
      Object.defineProperty(status, 'name', { value: 'camera' });
      Object.defineProperty(status, 'onchange', { value: null, writable: true });
      return status;
    }
    if (!realQuery) throw new TypeError('permissions.query is not available');
    return realQuery.call(this ?? navigator.permissions, desc);
  };
  if (permissionsProto) method(permissionsProto, 'query', fakeQuery);
  if (permissions) {
    method(permissions, 'query', fakeQuery);
    keepAlive.push(permissions);
  } else {
    Object.defineProperty(nav, 'permissions', { value: { query: fakeQuery }, configurable: true });
  }

  // ImageCapture: a "photo" is a JPEG of the current canvas, ready after PHOTO_DELAY_MS.
  function canvasJpeg(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new DOMException('Could not encode the photo', 'UnknownError'))), 'image/jpeg', 0.92);
    });
  }

  function FakeImageCapture(this: { track: MediaStreamTrack }, track: MediaStreamTrack) {
    if (!(this instanceof FakeImageCapture)) throw new TypeError("Constructor ImageCapture requires 'new'");
    if (!track || track.kind !== 'video') throw new DOMException('ImageCapture needs a video track', 'NotSupportedError');
    this.track = track;
  }
  FakeImageCapture.prototype.takePhoto = async function (this: { track: MediaStreamTrack }): Promise<Blob> {
    if (this.track.readyState !== 'live') throw new DOMException('The camera track is not live', 'InvalidStateError');
    stats.photosTaken++;
    await new Promise((r) => setTimeout(r, PHOTO_DELAY_MS));
    draw();
    return canvasJpeg();
  };
  FakeImageCapture.prototype.getPhotoCapabilities = async function () {
    return {
      imageWidth: { min: 640, max: W, step: 1 },
      imageHeight: { min: 480, max: H, step: 1 },
      fillLightMode: ['off'],
      redEyeReduction: 'never',
    };
  };
  FakeImageCapture.prototype.getPhotoSettings = async function () {
    return { imageWidth: W, imageHeight: H, fillLightMode: 'off', redEyeReduction: false };
  };
  FakeImageCapture.prototype.grabFrame = function (): Promise<ImageBitmap> {
    return createImageBitmap(canvas);
  };
  Object.defineProperty(window, 'ImageCapture', { value: FakeImageCapture, configurable: true, writable: true });
}
