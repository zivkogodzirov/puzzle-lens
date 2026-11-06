# Changelog

All notable changes to Puzzle Lens (working title in M0: "Piece Finder") are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow the milestones.

## [Unreleased]

### M2: set-up, markers, finding pieces, catalog (2026-11-06; not yet checked on your iPhone)
- **Your puzzles** on Home: new puzzle, open, export a backup, import a backup, delete.
- **New puzzle wizard:** name and piece count → box photo (drag the corners with a magnifier; the picture is straightened) → grid suggestion (28 across × 36 down for a portrait Ravensburger 1000) → print 2 marker sheets with a 100 mm ruler check → lay out the 8 cards and take one photo of the empty table, which measures where every card lies and learns your table.
- **Scan pieces:** a hand-held overview that takes itself when the phone is flat, high enough and still; then 2× close-ups with an arrow showing where to aim. Each photo is checked (blur, tilt, glare, markers), placed on the table, and its pieces are added to the catalog. A piece seen again is updated, never added twice.
- **Live outlines:** grey for pieces found, orange dashes for touching pieces, yellow for pale pieces to check. They stay on the pieces as you move the phone.
- **Puzzle screen:** piece thumbnails, the measured piece size and a rough finished size.
- **Accuracy on computer-made test photos:** about 94–95 % of pieces found (target 98 %, not met yet); near-white pieces only about a third; positions within about 0.15 mm.
- Under the hood: database version 2 (your M1 data upgrades), marker map and camera-pose maths, a level-and-height gauge, a tilt-sensor fallback, a close-up planner, a synthetic puzzle generator with frozen test sets.

### Seventh report (2026-11-06, Safari tab): M1 checked on your iPhone
- Everything in the M1 checklist has now worked on your phone, in the Safari tab and the Home Screen app: sharp 3024×4032 Snap with live tracking, tracking at 22–28 per second, memory headroom 1,792 MB, the marker outline right in all three positions.
- **The 2× lens test now gives a verdict:** your phone measured 1.83 and 2.40, so it shows "True 2× lens". A low ratio says "not confirmed" and never ✗.

### Plan changed for your setup (2026-11-06)
- **No stand:** the phone is held by hand. The app will show a level-and-height gauge from the markers and take each photo by itself when the phone is level and still (M2).
- **No mat:** pieces lie on your white glossy table. The app learns the empty table from one photo, finds pale pieces from their edges and side shadows, and detects glare and fills it in from a second photo (M2). Advice: light from the side, not straight above.
- **Finished size is measured, not asked:** you type only the piece count; the grid comes from the count and the box picture's shape, the size from the first overview photo. The box photo moves into the M2 wizard.
- Close-ups at 2× from the same height as the overview, because your 2× lens is a true optical 2×.
- Printed markers stay (you can print A4).

### Fixed after your first iPhone report (2026-11-06)
- On your iPhone, every in-app photo failed with an internal camera error (all sizes, all formats).
- **Snap** now falls back by itself to the **full-size live picture** (12 MP), and only offers the iPhone camera screen if that fails too.
- New **Photo test** (Device check step 4): it tries each possible cause separately and remembers what works:
  - with and without live tracking;
  - with no size, the upright size, the sideways size, the largest size, the camera's own setting, or a copy of the camera;
  - with the full-size live picture.
- The 2× lens test now runs inside the Photo test, using whichever way works.
- Second report (Home Screen app) found the cause: the tracker's shrunk copy of the camera makes photos small (540×960) or fail. With tracking off, photos are full 12 MP.
  - The Photo test now never picks a way that gives a small picture. The first version would have chosen 0.5 MP photos.
  - It also tries tracking with a full-size copy of the camera.
  - The camera tests take their photos with tracking paused.
- Third report: the Photo test chose correctly (photo with tracking paused), but Snap still gave 540×960.
  - The pause didn't wait for the tracker's copy of the camera to close. It does now.
  - Every Snap checks its size. A photo that comes out small is retried once, then replaced by the full-size live picture.
  - The photo panel has a "Send report" button.
- Fourth report: Snap gave a full 3024×4032 picture through the live-picture backup, but that picture is soft. Once the tracker's shrunk copy has run, photos stay small until the camera restarts.
  - The Photo test now starts every stage with a freshly started camera.
  - It also tries "pause tracking and restart the camera" before the photo.
- Fifth report: **Snap takes real, sharp 12 MP photos** while tracking keeps running, by giving the tracker a full-size copy of the camera. The 2× lens measured 1.83 (a true 2×). Tracking dropped to 17 fps, because shrinking the big frames on the GPU took about 47 ms.
  - New way to read big frames: copy the grey picture and shrink it by an exact factor of 4 in OpenCV (Mac: 18.7 ms per 12 MP frame, the shrink itself 4 ms).
  - The tracker times both ways on the phone and keeps the faster one. The HUD shows the choice under "big frames".
- Sixth report: tracking is back to 27.8 fps (22.9 ms per frame; the direct copy took 20 ms, the GPU 52 ms), and Snap still gives sharp 3024×4032 photos.
- Full-size tracking is now the starting setting everywhere, including the Safari tab before any Photo test.

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
