/**
 * TypeScript's WebWorker library lacks MediaStreamTrack, but Safari exposes it in dedicated
 * workers (the tracker receives a transferred camera track). Only `stop()` is used there.
 * Kept minimal so it merges cleanly with the full DOM definition in the main-thread build.
 */
interface MediaStreamTrack {
  stop(): void;
}
