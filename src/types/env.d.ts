/// <reference types="vite/client" />

/** Injected at build time by vite.config.ts: "0.1.0+abc1234 (2026-11-04T10:00Z)". */
declare const __APP_VERSION__: string;

/** The custom OpenCV.js build (vendor/opencv/opencv.mjs, Emscripten ES module factory). */
declare module '*/opencv.mjs' {
  const createOpenCv: (moduleOverrides?: Record<string, unknown>) => Promise<unknown>;
  export default createOpenCv;
}
