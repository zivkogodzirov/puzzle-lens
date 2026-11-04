# Changelog

All notable changes to Puzzle Lens (working title in M0: "Piece Finder") are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow the milestones.

## [Unreleased]

### Added: M1, skeleton on your phone (2026-11-04; not yet checked on an iPhone)
- **App:**
  - A Home Screen web app (PWA) that works offline, with an "update available" banner. Published at https://zivkogodzirov.github.io/puzzle-lens/.
  - Screens: Home, Live camera, Device check, Send report, Setup guide, Settings, Activity log.
- **Camera:**
  - Live camera with the "camera contract" (PLAN §3.1): 4:3 full-sensor format, lens picker (Automatic by default), 1×/2×, torch.
  - Automatic recovery after interruptions (including after a Snap and after the iPhone camera screen), and the screen kept awake.
  - A lens that stops working is reset to Automatic.
- **Tracker:**
  - A background helper finds the printed markers in live frames, with sub-pixel corners (about 0.2 px).
  - Frames go to it directly (iOS 18+), or are copied when that isn't possible. It switches to copied frames automatically if direct frames stop.
  - It restarts itself after repeated errors.
- **Snap:**
  - A full-resolution photo, checked tile by tile (size, brightness, blown-out share, sharpness) with a preview.
  - Every step has a time limit.
  - "Use the iPhone camera instead" appears when the in-app photo fails, and is used automatically after two failures.
  - A photo that can't be kept for reports (Private Browsing) only gets a gentle note.
- **Performance display (HUD):** frame rates, time per stage, the longest gap between updates, memory per helper, OpenCV objects and open frames.
- **Device check:**
  - Steps 1–3 with ticks: automatic checks, camera tests, iPhone camera screen. A memory test is optional.
  - It covers BRIEF §2 and RESEARCH §19: photo size per format, camera pause and frame gap during a Snap, a 2× measurement (number only for now), canvas-noise probe, WebGPU self-test, storage, Wake Lock, sharing, OpenCV speed, and how live frames are delivered.
  - Plain-English verdict at the top. Known iPhone limits are marked "Normal on iPhone".
  - Results are kept per mode (Safari tab / Home Screen app) and across app updates.
- **Send report:** prepared first in a background helper, then shared (AirDrop/Mail), with a download fallback. Contains `report.json`, recent frames, the last photo preview, and optionally the full photo.
- **Setup guide:** numbered steps for installing to the Home Screen (including the iOS 26/27 "⋯" and "View More" menus), plus a test marker to show on another screen.
- **Icons:** app icons (including maskable) and a test marker (`public/test-marker.svg`, ArUco id 0).
- **Vision engine:** a custom OpenCV.js 4.14 build (SIMD, ES module, native exceptions). It is 5.8 MB, 1.3 MB with brotli, and its memory starts at 32 MiB.
- **Database:** versioned, with a frozen schema history and a test that guards it.
- **Tests:**
  - 197 unit tests on the real OpenCV build.
  - A 10-minute live-loop leak test that runs the tracker's own code (18,000 frames: memory flat, every frame and bitmap closed exactly once).
  - 17 WebKit browser tests with a simulated camera, including offline, leaving the camera screen by the Back gesture, and a failing camera.
  - A GitHub Actions workflow that tests and deploys every push to `main`.

### Fixed (found by the independent M1 review: 53 confirmed findings, and by the tests)
- **Camera and tracker:**
  - Leaving the Live screen on the copied-frames path left the camera on (`cancelVideoFrameCallback` was called without its `this`).
  - Overlapping camera starts or tracker attaches could leak a camera or silently kill tracking.
  - The tracker reported success before its frame reader existed.
- **OpenCV errors:** a caught error leaked WebAssembly stack and memory, so about 65 errors killed the module. Every catch now goes through `cvGuard`.
- **Memory:** the OpenCV memory started at 128 MiB instead of 32 MiB (OpenCV's own build file overrode ours).
- **2× lens test:** it would have called a real 2× lens "digital zoom". There is a new detail measure, and no verdict is shown until it is checked on the phone.
- **Accuracy and robustness:**
  - Marker corners were up to 2.5 px off.
  - 10-bit camera formats would have been read as garbage.
  - Report zip names inside dotted folders were renamed wrongly.
- **False alarms:**
  - The crash notice appeared after ordinary app switching.
  - The memory test could save an interruption as a measurement.
  - Device check results disappeared after an app update.
- **Small fixes:**
  - The wake lock could stay on after the camera stopped.
  - The last log lines before a crash could be lost.
  - The "lag" readout measured the wrong thing.
  - Photos were decoded twice just to read their size.
  - The speed test used a slow per-pixel loop.
- Full list: PLAN §10 (what is still open) and §11 (decisions).

### Earlier
- **M0, research and plan** (2026-11-04):
  - `docs/BRIEF.md`: the original requirements, kept verbatim.
  - `docs/RESEARCH.md`: research on the reference projects, iOS 27 Safari capabilities, capture and resolution, markers, segmentation, shape reading, re-identification, box placement, grid inference, piece-to-piece matching, on-device ML, GPU compute, storage, hosting and testing. Each choice is explained.
  - `docs/PLAN.md`: architecture (including the camera contract), data model, screens, milestones with acceptance thresholds, speed and memory budgets, risks, decisions and open questions.
  - `docs/research/`: detailed notes on Harstil/piece-finder, puzzle-bot, bminaiev / jigsawlutioner / Zolver, plus a skeptic's fact-check.
- **Independent review of the plan:**
  - Four lenses (platform, vision, brief coverage, fact-check), each finding challenged by a second skeptic.
  - 49 findings confirmed and fixed. The main ones: the piece-wall (parallax) model, `takePhoto()` behaviour with the live stream, accuracy-test definitions, the 5-second share rule, database versioning, and milestone placement of several brief requirements.
- M0 was approved on 2026-11-04.
