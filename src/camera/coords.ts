/**
 * Coordinate helpers: from a tracker frame (which iOS may deliver in the sensor's landscape
 * orientation) to the on-screen <video> element (object-fit: contain).
 */

export interface Size {
  width: number;
  height: number;
}

/** Rotation (clockwise degrees) needed to show the frame the way the <video> element shows it. */
export function frameRotation(frame: Size, video: Size, reported?: number | null): 0 | 90 | 180 | 270 {
  if (reported === 90 || reported === 180 || reported === 270) return reported;
  const frameLandscape = frame.width > frame.height;
  const videoLandscape = video.width > video.height;
  return frameLandscape !== videoLandscape ? 90 : 0;
}

/** Rotates a point in frame pixels clockwise by `rot` degrees; returns rotated-frame pixels. */
export function rotatePoint(x: number, y: number, frame: Size, rot: 0 | 90 | 180 | 270): [number, number] {
  switch (rot) {
    case 90:
      return [frame.height - y, x];
    case 180:
      return [frame.width - x, frame.height - y];
    case 270:
      return [y, frame.width - x];
    default:
      return [x, y];
  }
}

export interface ContainBox {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** Where a video of `video` size is drawn inside an element of `el` size with object-fit: contain. */
export function containBox(video: Size, el: Size): ContainBox {
  const scale = Math.min(el.width / video.width, el.height / video.height);
  return { scale, offsetX: (el.width - video.width * scale) / 2, offsetY: (el.height - video.height * scale) / 2 };
}

/**
 * Maps a point from tracker-frame pixels to CSS pixels inside the video element.
 * `frame` is the size of the frame the tracker saw; `video` is videoWidth/videoHeight.
 */
export function frameToElement(
  x: number,
  y: number,
  frame: Size,
  video: Size,
  el: Size,
  reportedRotation?: number | null,
): [number, number] {
  const rot = frameRotation(frame, video, reportedRotation);
  const [rx, ry] = rotatePoint(x, y, frame, rot);
  const rotated = rot === 90 || rot === 270 ? { width: frame.height, height: frame.width } : frame;
  const vx = (rx * video.width) / rotated.width;
  const vy = (ry * video.height) / rotated.height;
  const box = containBox(video, el);
  return [box.offsetX + vx * box.scale, box.offsetY + vy * box.scale];
}
