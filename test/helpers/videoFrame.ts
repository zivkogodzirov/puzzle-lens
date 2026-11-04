/**
 * A stand-in for WebCodecs' VideoFrame (Node has none), good enough for
 * src/shared/frameRead.ts readVideoFrame(): an NV12 frame whose luma plane comes from a
 * prepared grey image. Counts open / closed frames so tests can prove every frame is closed.
 */
import type { PixelBuffer } from '../../src/cv/frameAnalyser';

export interface PlaneLayoutLike {
  offset: number;
  stride: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class FakeFrameSource {
  created = 0;
  closed = 0;
  open = 0;
  maxOpen = 0;
  doubleClosed = 0;
  copies = 0;
  /** Frames still open, for reporting which ones leaked. */
  readonly openFrames = new Set<FakeVideoFrame>();

  /**
   * @param luma grey picture used as the frame's Y plane
   * @param stride bytes per row of the Y plane inside the frame (≥ width; iOS pads rows)
   */
  make(luma: PixelBuffer, opts: { timestamp: number; stride?: number; failCopy?: boolean; format?: string | null }): FakeVideoFrame {
    const f = new FakeVideoFrame(this, luma, opts.stride ?? luma.width, opts.timestamp, opts.failCopy ?? false, opts.format === undefined ? 'NV12' : opts.format);
    this.created++;
    this.open++;
    this.maxOpen = Math.max(this.maxOpen, this.open);
    this.openFrames.add(f);
    return f;
  }

  noteClosed(f: FakeVideoFrame): void {
    this.closed++;
    this.open--;
    this.openFrames.delete(f);
  }
}

export class FakeVideoFrame {
  readonly codedWidth: number;
  readonly codedHeight: number;
  readonly displayWidth: number;
  readonly displayHeight: number;
  readonly visibleRect: Rect;
  private isClosed = false;

  constructor(
    private readonly source: FakeFrameSource,
    private readonly luma: PixelBuffer,
    private readonly stride: number,
    readonly timestamp: number,
    private readonly failCopy: boolean,
    private readonly fmt: string | null,
  ) {
    this.codedWidth = luma.width;
    this.codedHeight = luma.height;
    this.displayWidth = luma.width;
    this.displayHeight = luma.height;
    this.visibleRect = { x: 0, y: 0, width: luma.width, height: luma.height };
  }

  get format(): string | null {
    return this.isClosed ? null : this.fmt;
  }

  get closed(): boolean {
    return this.isClosed;
  }

  /** NV12: full-size Y plane + half-size interleaved UV plane. */
  allocationSize(options?: { rect?: Rect }): number {
    this.assertOpen();
    const r = options?.rect ?? this.visibleRect;
    const stride = options?.rect ? r.width : this.stride;
    return stride * r.height + stride * Math.ceil(r.height / 2);
  }

  async copyTo(dest: Uint8Array, options?: { rect?: Rect }): Promise<PlaneLayoutLike[]> {
    this.assertOpen();
    if (this.failCopy) throw new Error('simulated copyTo failure (camera hiccup)');
    const r = options?.rect ?? this.visibleRect;
    const stride = options?.rect ? r.width : this.stride;
    if (dest.byteLength < this.allocationSize(options)) throw new TypeError('destination too small');
    const src = this.luma;
    for (let y = 0; y < r.height; y++) {
      const s = (r.y + y) * src.stride + r.x;
      dest.set(src.data.subarray(s, s + r.width), y * stride);
    }
    // UV plane: leave the bytes as they are (grey analysis never reads them).
    this.source.copies++;
    return [
      { offset: 0, stride },
      { offset: stride * r.height, stride },
    ];
  }

  close(): void {
    if (this.isClosed) {
      this.source.doubleClosed++;
      return;
    }
    this.isClosed = true;
    this.source.noteClosed(this);
  }

  private assertOpen(): void {
    if (this.isClosed) throw new DOMException('VideoFrame is closed', 'InvalidStateError');
  }
}
