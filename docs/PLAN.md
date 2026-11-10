# Puzzle Lens: plan and status

_Last updated: 2026-11-09. M4 (box placement) is finished and checked on your iPhone; M5 (live view, Fits / Doesn't fit, rescans) and M6 (which pieces join, box-led after the go/no-go) are built and wait for your iPhone check. M1 is checked on your iPhone. M2 (set-up wizard, markers, piece finding, catalog) is built and tested on the Mac and waits for your iPhone check (`docs/M2-CHECKLIST.md`). Setup: phone held by hand, no mat, a large white glossy table, and **no printed markers** (the pieces themselves are the reference; markers optional)._

| Milestone | Status |
|---|---|
| M0 Research and plan | ✅ Approved 2026-11-04 |
| M1 Skeleton on your phone | ✅ Checked on your iPhone 2026-11-06 (Safari tab + Home Screen app); waiting for your OK to start M2 |
| M2 Detection and catalog (no markers needed) | 🔧 Built and tested on the Mac; **waiting for your iPhone check** (`docs/M2-CHECKLIST.md`) |
| M3 Shape reading and Border groups | 🔧 Parts 1–2 built and tested on the Mac (shape reading, Border mode, finished-puzzle check); **waiting for your iPhone check** (`docs/M3-CHECKLIST.md`). The go/no-go was run in M6 on your 21 pieces with known spots instead of the 7 × 7 block photos (no-go: M6 is box-led) |
| M4 Box placement | ✅ Finished and checked on your iPhone 2026-11-09 (parts 2–7). Part 1 built; part 1b fixes from your real test (pale-piece outlines, confidence fitted on real photos, finished check with pieces out); part 2: leftover pieces matched only to the empty spots of the nearly finished puzzle, one piece per spot; part 2b: the holes photo is recognised on close-ups too (it wasn't, so your test stayed on the whole picture); tested in the app with your photos: 8 Strong, all right; part 3: knob shapes (holes' outlines + pieces' sides, interlocking neighbours): in the app 17 Strong, all right. Real: whole picture 5 of 21 first; among your 21 holes about 14 of 19 real pieces right, 9 Strong all right. Parts 2, 2b and 3 ✅ checked on your iPhone 2026-11-09 (the top-right wall pieces land in their holes). Part 4: **trays by colour** (zones measured first and were too unreliable on your real pieces: right zone 60 % for finished-puzzle spots, 8 of 19 loose pieces; the AI picture model was no help either); your check: some groups mixed → part 4b evens out the lamp's light; ✅ checked on your iPhone 2026-11-09 (dark and wall pieces in separate trays). Part 5: **Fill this spot** (tap a spot, see its pieces, lit up on your photo), tested in the app with your 21 holes; ✅ checked on your iPhone 2026-11-09. Part 6: **green outlines** ("Show my table": every piece on your scan photo by state, spot labels, tap to zoom; progress line; frame sides), tested in the app with your photo; ✅ checked on your iPhone 2026-11-09. Part 7: **box setup checks** (border question in the wizard, table-contrast check, box-to-grid correction offered from confident pieces), tested in the app; ✅ checked on your iPhone 2026-11-09 (table-contrast line and Show where). With part 7, M4's box setup and placement work is built. Left out on purpose, with the reasons in the decisions table: zones (measured, too unreliable on real pieces; trays by colour instead), the AI picture model (measured, no help), area search by dragging (Fill this spot covers one spot at a time), grey-patch colour calibration (marker puzzles only; you scan without markers), WebGPU (placement is fast enough without it) |
| M5 Live tracking and re-identification | 🔧 Part 1 built and tested on the Mac: **live view of your table without markers** (pieces outlined on the live camera in their state colours, tap a piece, point it out, Find it live from Fill this spot) and the **🧪 Test tab** with the test steps inside the app; part 1b tested on your photos (guided matching). Part 2: **Fits / Doesn't fit** (pieces into the puzzle, ruled-out spots, neighbours' knobs) and **📊 How often is the app right?**; 2b self-tested on your photos with fixes. Part 3: **rescans that don't count pieces twice** (partial sightings, touching pieces, the coin; moved pieces recognised by a picture fingerprint; unsure ones become **pieces to check**). Part 4: **smoother live view** (prediction, calmer when still), **moved pieces noticed** in the live view (red dashed), unsure tracking dashed, **Quick / Full scan mode**. Parts 1–4 tested on the Mac with your photos; **waiting for your iPhone check** (the 🧪 tab, or `docs/M5-CHECKLIST.md`) |
| M6 Piece-to-piece matching | 🔧 Built and tested on the Mac with your photos and in the app with your Kiss puzzle: the go/no-go on your 21 pieces (shape alone: true partner first 0 of 48 sides) made it **box-led**; **🧩 Which pieces join** with What next, squares of 4 ✓, Point them out, They fit / Don't fit; partners per side; lines in the live view; pair answers on the 📊 page. Real: true partner first 36 of 48 sides, pairs ≥ 50 % right 15 of 15, 3 squares all right. **Waiting for your iPhone check** (the 🧪 tab, or `docs/M6-CHECKLIST.md`) |
| M7 Batch workflow | 🔧 Part 1 built and tested on the Mac with your photos: **🔄 Start a new batch** (the pieces on the table are set aside, trays and the puzzle stay, the next photo starts a fresh table; only this batch's photos in the live view). Pieces spread out again are read as new: measured, the picture alone can't tell hundreds of set-aside pieces apart safely. Part 2: **📈 Progress page** (pieces in the puzzle, the box picture lit where done, yellow dots where the piece is on the table, pieces by status and shape, accuracy, batch); in the app with your Kiss photos: 987 of 1008 in, 17 of the 21 holes have their piece on the table. Part 3: **full backup with reminders** (the pieces' spots and the scan bin now travel too; a reminder when there's no backup yet or it's old; last backup shown); a 1000-piece puzzle backs up in 1.9 s (57 MB) and imports in 2.2 s on the Mac; your Kiss puzzle restored identical. Part 4: **a new photo of the puzzle marks the pieces that went in** (and a photo of the finished puzzle counts every piece as in; fixed: after pieces were scanned, a puzzle photo couldn't be read at all), **✓ It's in the puzzle** for pieces without a sure spot, and **the 1000-piece run end to end**: 4 batches + the end game, 848 of 1008 in (84 %), first try 75 %. With your photos: holes, pieces, then IMG_9272: 17 pieces counted in, progress 1008 of 1008. **M7 is built; waiting for your iPhone check** (the 🧪 tab, or `docs/M7-CHECKLIST.md`) |
| M8 Tuning on your real puzzle | 🔧 Part 1 built and tested on your photos: **colours learned from your pieces** (after 12 pieces are in the puzzle at known spots, the app learns how your photos' colours map to the box picture and places the rest again). Your 19 real pieces on the whole picture: right spot first 1 → 6, top 5 3 → 9 (each with colours learned from the others); computer-made puzzles about neutral. Part 3: **faster scans and a lighter live view**: an 18 MP photo of your pieces is read in 4.4–7.2 s instead of 7.4–11.5 s, the next photo at about the same height in 1.6–2.0 s; the live view analyses 7 frames a second while held still instead of 25. Follow-up: your IMG_9127 showed 44 pieces because most of its ~60 pieces touch (all were found); pieces outlined only in part (pale on cream) are now marked and their shape isn't trusted. Part 4: **fixes from the app review** (bugs and speed), each checked against the version before by an independent check, then a many-agent "did it get worse?" review (7 findings: 5 fixed, 2 kept on purpose): scan photos about a fifth faster, no freeze after a new batch, placement 3–6 × faster, trays in 0.05 s; the scan note no longer covers the gauge, loose pieces beside a finished puzzle are counted, a count that doesn't match the grid saves nothing. Part 2 waits for a backup with your answers |
| M9 Professional design | 🔧 Part 1 **"readable now"** built and tested on the Mac (2026-11-10), the first of the review's 6 design stages: colours that pass contrast in light mode, bigger answer buttons, Reduce Motion, a dark edge under every piece outline, Undo in the live view, Tester mode, the 🧪 button in the top bar, plain wording, the last puzzle reopened at launch, a bottom action bar on the puzzle page, pinch-zoom, the screen kept awake on puzzle pages. **Waiting for your iPhone check** (`docs/M9-CHECKLIST.md`). Stages 2–6 (components, the piece card, tabs, the scan camera, polish) follow, each tested on your iPhone |

The reasons behind every choice are in [`RESEARCH.md`](RESEARCH.md); section numbers like "R§4" point there. Your original brief is kept in [`BRIEF.md`](BRIEF.md).

---

## 1. What we're building (plain English)

**How a session goes:**
1. You spread 200–300 pieces face up on your table with 8 printed markers around them.
2. Holding the phone flat above the table, you take **one overview photo**, then **about 4–6 closer photos**. The app shows a level-and-height gauge and takes each photo by itself when the phone is level and still. It shows which parts of the table still need a photo.
3. From these it builds a **catalog**. For every piece it works out:
   - its colours and its exact position on the table;
   - its four sides: flat, tab or blank;
   - where it probably goes on the box picture, as the top 5 places with percentages;
   - which other pieces it probably joins.
4. You point the phone at the table. The **live view** draws coloured outlines, rings and arrows over the real pieces, pinned in place as you move the phone.
5. You tap groups to light them up: border, zones of the picture, colour families, shape types, an area you drag on the box picture, or "fill this spot".
6. Tap any piece to see its spot and partners, and answer **Fits / Doesn't fit**.
   - A "Doesn't fit" removes that suggestion straight away.
   - All your answers feed a running accuracy score.
   - In M8 the app is re-tuned from your answers.
7. When a batch is done, you mark pieces as placed, add new ones and scan again. Known pieces are recognised and not added twice.

**Being honest about accuracy:**
- The percentage targets in §7 are measured on **computer-made test puzzles**. How well the app does on your real pieces is first measured in M2–M3, and will probably be somewhat lower.
- **"Which piece joins which" is the least certain feature.** Phone photos are much less sharp than the setups that made shape-matching work elsewhere. In M3 I test this on your own pieces and tell you the result before building M6 (R§11).
- Plain areas (sky, water) get "one of these few", not a single answer.

**Privacy:** it doesn't need the internet after the first load, and your photos never leave the phone unless you share a report or backup.

---

## 2. Physical setup (taught by the in-app wizard)

| Item | Recommendation | Why |
|---|---|---|
| Table | **Your own table, as it is** (large, white, glossy). No mat. Clear a sorting area about 70 × 50 cm for 300 pieces, with ~15 cm around it for the markers. Before the first scan the app takes one photo of the **empty sorting area** to learn what the table looks like. | The app finds pieces as "not table". A white table works well for most of your picture's colours; pale pieces are found from their edges and the thin shadow along their sides (§3.3). |
| Markers | **8 markers** on 2 A4 sheets the app prints. Cut them out and lay (or tape) them on the table around the sorting area: one at each corner and one at the middle of each side. Each sheet has a 100 mm check bar and a grey patch. Print at 100% ("actual size"). Markers stay on the table between sessions if you can leave them. | The phone always knows where it is, in millimetres, even held by hand. The bar catches printer rescaling; the grey patch sets colour and exposure (R§5). |
| Pieces | Face up, small gaps between them, not touching. | Touching pieces get an orange dashed outline and "spread these apart". |
| Light | **Light from the side** (a window or a lamp off to one side), **not a lamp straight above the table**. | On a glossy table a lamp above you reflects straight into the camera (glare), and your phone, hands and head throw a shadow on the pieces. Side light avoids both. The app finds glare spots and asks for a retake from a slightly different angle (§3.3). |
| Phone | **Held by hand, flat, about 60–70 cm above the table** (standing at the table, arms slightly bent). Overview photo at 1× with all 8 markers in view (~65–70 cm; ~4 px per mm, about 75 px across a piece: enough to find and colour it). Close-ups at **2× from about the same height** (~65 cm; ~8.5 px per mm, about 165 px across a piece): your phone passed the 2× test (true optical 2×, measured 1.83 and 2.40). About **6 close-ups** cover a 70 × 50 cm area; the app shows where to aim. The app shows a level-and-height gauge from the markers and takes the photo itself when the phone is level (≤ 5°), at the right height and still. If a photo comes out blurred it asks again. | Straight-down photos and a narrow view keep piece outlines accurate (R§4). One height for both photo types is easy to keep by hand. Each close-up is planned to include a ring marker; the middle one of a 3 × 3 plan can't, so it uses the phone's tilt sensor while aiming and is placed from the overview's pieces afterwards (decision 2026-11-06). |
| Puzzle size | **Nothing to measure.** You type the piece count from the box (e.g. 1000) and take a photo of the box picture. The app suggests the grid (e.g. 28 across × 36 down = 1008 for a portrait Ravensburger 1000) from the count and the picture's shape. It measures the real piece size, and so the finished size, from your first overview photo. | Fewer questions; the measured size is more exact than the box label. |

---

## 3. How the app is built

### 3.1 Parts and where they run

```
 Main thread (UI)                          Workers (background, never block the UI)
 ───────────────────────────────           ──────────────────────────────────────────────
 Preact screens, buttons                   TRACKER worker  (OpenCV.js WASM SIMD, small heap)
 <video> camera preview                      • gets live camera frames directly (clone of track)
 Overlay canvas (≥30 fps)   ◄── H + time ──  • finds markers; optical-flow tracking
 ImageCapture.takePhoto()                    • table↔camera mapping (homography), timestamped
 Wake Lock, tilt sensor                      • nothing else: keeps a steady frame rate
          │
          │ Snap (photo) ──────────────►   READER worker   (OpenCV.js WASM SIMD, capped heap)
          │                                  • tiles big photos, finds pieces, reads shapes
          │                                  • fingerprint, re-identification, placement
          │                                  • low-rate change detection when idle
          │                                  • writes to the catalog (IndexedDB), one transaction per change
          │
          │                                MATCHER worker  (TypeScript; WebGPU later if needed)
          │                                  • piece-to-piece matches, 2×2 loops, assignment
          │
          │                                ML worker (only if M4 proves it helps; runs when reader idle)
          ▼
 IndexedDB (Dexie, versioned): projects, pieces, matches, photos, feedback, jobs, logs
```

**Camera contract** (from the review of WebKit's code; R§3):
1. The camera opens on a **4:3 full-sensor format** (e.g. 4032 × 3024 at 30 fps) when your phone offers one. That way a Snap doesn't force a format switch.
2. The track is **cloned**:
   - The main thread keeps the original for the preview and for `takePhoto()`.
   - The clone is transferred to the tracker worker, which asks for small frames (~960 px wide) and reads them with `MediaStreamTrackProcessor` (iOS 18+).
   - Fallback: `requestVideoFrameCallback` → `createImageBitmap` → transfer.
3. `takePhoto()` is always called with an explicit size equal to the current format. The real photo size is recorded every time.
4. A Snap or the file-input camera can briefly **mute** the camera. While one is in progress, mute/unmute is expected, and automatic camera recovery is paused.
5. Camera frames are read with `VideoFrame.copyTo` rather than canvas readback, which Safari's fingerprinting protection can add noise to (R§3).
6. The measured behaviour on your phone (M1 Device check) decides the details.

**Overlay in step with the video:**
- Each homography carries the timestamp of the frame it came from.
- The main thread compares it with the frame on screen (`requestVideoFrameCallback`) and predicts forward from recent motion.
- If that isn't good enough on your phone, the alternative is to draw the analysed frame and the overlay together. That's decided in M1/M5 by an on-device test.

**Other rules:**
- **No WebAssembly threads.** GitHub Pages can't send the required headers (R§3). Parallel work uses separate workers, messaging via Comlink.
- **OpenCV.js 4.14 custom build:** SIMD, separate `.wasm`, ES module (the unwrapped `opencv_js.js`), trimmed modules (R§18). It lives in `vendor/opencv/` with its build script.
- **Resumable work:** long jobs leave a "to do" record in the database and resume when the app reopens. iOS freezes background web apps.

### 3.2 Coordinate systems

- **Image (px):** a camera frame or photo.
- **Table (mm):** fixed to the table (set by the markers), origin at marker 0. Every piece position is stored here, so highlights stay pinned when the phone moves.
- **Piece (canonical):** the piece's 4 corners mapped onto a square. Removes rotation, scale and perspective; used for fingerprints and placement.
- **Box grid:** (column, row, rotation 0/90/180/270), plus a fitted box-to-grid correction (R§9).
- **Mapping:** a homography H links table and image for each frame or photo. It comes from markers, plus known pieces when few markers are visible.

### 3.3 Pipeline summary (detail in RESEARCH)

| Stage | Method | Where | Budget (iPhone) |
|---|---|---|---|
| Markers → table mapping | ArUco DICT_4X4_50, sub-pixel corners, RANSAC homography, moved-marker check; LK optical flow between detections; registration from catalogued pieces when markers are few | tracker | ≤ 25 ms per frame, ≤ 750 ms per second |
| Live overlay | Catalogued outlines (stored in mm) drawn through the latest timestamped H, predicted forward to the displayed frame | main | ≥ 30 fps, ≤ 8 ms per draw |
| Change detection | Downscaled segmentation vs expected occupancy (pieces "in tray" or "placed" are expected to be gone) | reader, when idle | 1–2 per second |
| Handheld auto-capture | Tilt and height from the marker homography each frame (tilt sensor as backup), steadiness over ~0.3 s; Snap fires by itself when level, at height and still | tracker + main | every live frame |
| Photo quality gate | Marker-edge sharpness (motion blur), clipped-pixel share, **glare spots on pieces** (bright, low-colour, moving between photos), tilt from H (≤ 5° for detail photos) → "please retake" | reader | ≤ 100 ms |
| Segmentation | Table model (learned from the empty-table photo; white, glossy) + per-photo lighting field + edge and thin-side-shadow cues for pale pieces + glare mask (pixels under glare are filled from a second photo taken at a slightly different angle) + shadow-aware distance, hysteresis, morphology, marker masking, size gate in mm², watershed only for flagged blobs, sub-pixel outline, **print vs wall separation** for detail reads (R§4, R§6) | reader | overview of 300 pieces ≤ 8 s; detail ≤ 6 s |
| Shape reading | Hybrid corner search (curvature + centroid candidates, 4-subset score with straight shoulders and expected cell size in mm), line-fit refinement, flat/tab/blank with an uncertain band; overview reads only provisional (R§7) | reader | ≤ 15 ms per piece |
| Fingerprint and re-ID | Canonical Lab thumbnail ZNCC at 4 rotations + side-type word + side profiles in mm + colour stats; union shortlist; ratio test; pending + "close-up please"; one-to-one per photo (R§8) | reader | ≤ 20 ms per piece |
| Box placement | Canonical piece vs grid at 8/16/32 px per cell, 4 rotations, texture-gated ZNCC + gradient cues, border and neighbour constraints, calibrated softmax, assignment + Sinkhorn, box-to-grid correction (R§9) | reader / matcher | ≤ 50 ms per piece (CPU); full re-score of 1000 ≤ 30 s, resumable |
| Pair matching | Tab↔blank, length ±8%, box-neighbour prior, Procrustes/ICP shape residual on top-face outlines, seam colour agreement, logistic calibration, 2×2 confirmation (R§11) | matcher | ≤ 100 ms per new piece |

---

## 4. Data model (IndexedDB via Dexie, versioned)

| Table | Key fields |
|---|---|
| `projects` | id, name, created/updated, nominal piece count, grid {cols, rows}, finished size (mm, measured: grid × piece pitch), box {photo blob, 4 corners, rectified blob, px per cell, picture-border answer, box-to-grid correction}, zone layout {count 2–12, cell→zone}, colour calibration {white balance, 3×3+offset transform}, markers {dictionary, size mm, print-scale factor, id→position on the table}, table model {Lab stats, spatial map, glare history}, measured piece pitch (mm), settings (units, scan mode, thresholds) |
| `cells` | [project+index], texture class (detailed/plain, by the frozen rule), zone, descriptors (Float32Array), optional embedding |
| `pieces` | id, project, first batch, **status** (on table / in tray + tray name / placed / missing / pending), **type** (corner/edge/interior) + confidence + provisional flag, **4 sides** {flat/tab/blank + confidence, chord mm, 64-point profile, knob/neck scalars, seam colour strip, outline-quality weight}, shape class (e.g. TTBB), corners, top-face outline in mm, colour stats, thumbnail + canonical images (blobs), optional embedding, read quality and read count, **placement** {top-5 [(cell, rotation, p)], assigned cell, verdict}, groups {zone, colour family, border side}, **table position** {x, y mm, angle, last seen, photo id}, your marks (confirmed / rejected) |
| `pairs` | (piece A, side) ↔ (piece B, side), probability, shape and colour scores, confirmed by (2×2 / you), rejected |
| `snaps` | id, session, kind (overview / detail), time, actual photo size, lens/zoom, homography, camera pose, quality-gate result, optional image blob |
| `sessions` | id, project, start/end, pieces on the table |
| `feedback` | every Fits / Doesn't-fit answer with the scores at that moment (accuracy page + tuning) |
| `jobs` | pending background work (re-score, re-match) with the calibration version, for resume after interruption |
| `blobs` | large binary data kept apart from records |
| `logs` | error and timing ring buffer for reports |

**Rules:**
- **Every schema change** gets a version number, an upgrade function and an automated test that upgrades a database from the previous version. App updates never wipe your catalog.
- **Backup:** "Export backup" prepares one `.pfbackup` file (ZIP of JSON + images) in a worker, then "Share" sends it via the share sheet, with a download fallback. "Import backup" restores it. A minimal version arrives in M2; the full version, with reminders, in M7.

---

## 5. Screens

| Screen | Contents | Built in |
|---|---|---|
| **Home** | Your puzzles, "New puzzle". A banner if you're in a Safari tab rather than the Home Screen app: "Install first, then start your puzzle there". | M1 (shell), M2 |
| **New puzzle wizard** | 0. Home Screen check (first!) → 1. piece count from the box → 2. box picture (photo or import from Photos), corners with magnifier → 3. grid suggestion from count + picture shape / manual entry → 4. print markers (check 100 mm bar) → 5. lay out markers, empty-table photo + marker map photo, light check (glare and shadow) → later: "does the picture have a border or continue past the edges?", table-contrast check (which parts of the picture are close to your table's white) | M2 (steps 0–5), M4 (border question, table-contrast check) |
| **Live** (main) | Camera + overlay; tracking indicator (good / weak / lost); Snap button; scan coverage map; progress counter **"pieces read · shapes read · placed on box"**; mode chips: Border · Zones · Trays · Colours · Shapes · Area · Fill spot · What next. Tap a piece → panel with thumbnail, box spot (zoomed), partners per side with %, **Fits / Doesn't fit** | M1 camera, M2 onward |
| **Overlay state colours** (from the brief) | Outline/dot colour shows the piece's *state*: grey = detected, blue = shape read, green = its spot on the box is known, red/hollow = tracking uncertain. *Group* modes use rings (corners orange, edges teal, zone colours), so the two never clash. | grey M2, blue M3, green M4, red M5 |
| **Box view** | Rectified picture, zones, drag to area-search, tap a cell to fill that spot | M4 |
| **Catalog** | Thumbnail grid; filter by group, zone, status, confidence | M3 |
| **Groups** | Border counts ("Corners 3/4, Edges 112/120"), shape types (M3); zones, trays, colour swatches (M4) | M3–M4 |
| **Matches** | Confirmed / likely pairs, 2×2 blocks | M6 |
| **Progress** | Totals per status and group, accuracy so far, pieces never seen | M7 |
| **Settings** | Units (mm / cm / inches, display only); **scan mode**: *Quick* (1 overview photo: finds, colours and places pieces; corner/edge marks provisional; **no** piece-to-piece suggestions) or *Full* (overview + ~4 close-ups: everything); live tracking rate (30 / 15 fps, for battery); thresholds; **Accuracy** (running accuracy from your answers, with a confidence range) | M1 shell, M2 units, M5 scan mode + Accuracy |
| **Device check** | Every brief §2 capability + R§19 measurements, for Safari tab and Home Screen app separately | M1 |
| **Report** | Prepares a file of recent frames, the box picture, catalog stats, timings, device capabilities and errors, then one tap shares it | M1 |

**UI rules:**
- Big touch targets, one-handed use, plain-English labels, dark mode.
- The screen stays awake during sessions.
- Every number shown to you comes with a confidence.

---

## 6. Milestones

**Every milestone ends the same way:**
1. Automated tests pass.
2. It's deployed to GitHub Pages.
3. You get a plain-English iPhone test checklist.
   - Items that touch the camera, Snap, Wake Lock or storage are run **both** in a Safari tab and in the Home Screen app.
   - Use a throw-away test puzzle in Safari, because the two keep separate data.
4. Known issues are listed here.
5. `CHANGELOG.md` is updated.
6. **I wait for your feedback.**

Nothing is called "done" until it has worked on your iPhone.

### M1: Skeleton on your phone
- **Build:**
  - Project setup: Vite 8, TypeScript 7, Preact 11, Vitest 5, Playwright 1.64.
  - Versioned database.
  - GitHub repository and an automatic GitHub Pages deploy on every push to `main`.
  - PWA: manifest, icons, offline service worker (with the large-file limit raised), "update available" banner.
  - Home screen and Settings shells.
- **Camera:**
  - "Start camera" button, lens picker, requested vs actual resolution and frame rate, torch.
  - Camera contract (§3.1), automatic recovery after interruptions, Wake Lock.
  - Frames to the tracker worker.
- **Snap:** `takePhoto()` with the file-input fallback; big photos decoded safely in tiles.
- **OpenCV:** the custom SIMD build, a load smoke test, and a speed benchmark.
- **Device check screen** (brief §2 + R§19), including:
  - photo size per format
  - Snap mute and frame gap
  - 2× sharpness test
  - canvas-noise probe
  - WebGPU self-test
  - storage persistence and quota
  - memory headroom
- **Performance HUD:** fps, ms per stage, gap between H updates, WASM memory per worker, live OpenCV objects, open frames.
- **Report:** prepared in a worker, then shared.
- **Your setup guide (numbered steps):** open the address, Add to Home Screen, run Device check, send me photos and reports by AirDrop/Mail.
- **Tests:** unit tests; WebKit smoke test with a simulated camera; OpenCV leak tracker.
- **From you:** answers to §12, a photo of the box, a photo of your mat, and the Device check report from your phone (Safari and Home Screen).

### M2: Detection, markers and catalog
- **Wizard steps 0–5:** Home Screen check, piece count, box photo with corners, grid suggestion from count + picture shape (manual entry possible), marker printing with scale check, empty-table photo + marker map + light check.
- **Table mapping** for every photo (markers + piece-based registration).
- **Segmentation (white glossy table):** table model, lighting flattening, edge and side-shadow cues for pale pieces, glare mask with fill-in from a second photo, clump warnings, sub-pixel outlines, marker masking; the photo quality gate (blur, glare, tilt).
- **Handheld guidance:** level-and-height gauge from the markers (tilt sensor as backup); **auto-capture** when level, at height and still; best height from the measured piece size; finished size measured from the first overview.
- **Catalog:**
  - Overview Snap fills it (positions, thumbnails, colours).
  - Coverage map for the detail Snaps.
  - Progress counter "pieces read".
  - Grey "detected" outlines on the photo/live view.
- **Minimal export/import** of a project.
- **Synthetic puzzle generator v1** (R§16); frozen validation and test sets at 48 / 300 / 1000 pieces.
- **Tests:** segmentation (per piece) on synthetic **white glossy tables** with glare spots, side shadows and pale pieces; handheld tilt 0–10° and motion blur; position accuracy in mm; lens-distortion check (detail tiles vs overview); tiling memory; database upgrade.
- **ML segmentation trigger** (R§6): if your real photos give per-piece recall < 98%, or > 5% clumps after spreading, I benchmark the ML segmenters.
- **From you:** print the markers; photos of ~50 pieces on your table (overview + close-ups), including some of the palest pieces; any photo where pieces were missed or glare hid a piece.

### M3: Shape reading and Border groups
- **Shape reading:**
  - corner finder
  - print vs wall separation
  - flat/tab/blank with confidence
  - read quality and two-read agreement
  - provisional types from overview reads
- **Piece types:** corner/edge/interior and shape classes; blue "shape read" outlines; progress "shapes read".
- **Groups:**
  - **Border mode** (corners orange, edges teal, with counts against the confirmed grid, provisional marks shown as such).
  - Shape-type groups.
  - "Grid may be wrong — check?" warning.
- **Catalog screen.**
- **Simple per-frame marker tracking** in the live view, so highlights stay on their pieces when the phone moves. Smoothing comes in M5.
- **Tests:**
  - **outline error in mm** (median and 95th percentile, by shoulder / knob / neck and by distance from photo centre)
  - corner position error in mm
  - side-type accuracy, and corner/edge recall and precision
  - whole-puzzle consistency checks
  - shape-only partner ranking (synthetic)
- **Go / no-go on your real pieces** (R§11):
  1. You assemble a ~7 × 7 block and photograph it.
  2. You break it up and Snap the pieces.
  3. I measure how well shape alone finds true partners, and tell you the result and what it means for M6.
- **From you:** the 7 × 7 block photos; photos of pieces whose type was wrong.
- **What you get:** after M3 you can use the app to build the frame.

### M4: Box placement
- **Box setup:** (✅ part 7)
  - border question (the box photo itself is taken in the M2 wizard)
  - table-contrast check
  - box-to-grid correction after the first batch
- **Placement:**
  - colour calibration v1 (grey-patch white balance; one-time statistics match)
  - placement pipeline (CPU) with top-5 probabilities and verdicts
  - one-piece-per-cell assignment (✅ part 2, among the empty spots of a nearly finished puzzle)
  - leftover pieces matched only to the empty spots from a finished-puzzle photo (✅ part 2)
  - green "spot known" outlines; progress "placed on box" (✅ part 6: on the scan photo, "Show my table")
  - border-side labels (top / bottom / left / right) (✅ part 6, once a piece's spot is known)
- **Groups and tools:**
  - ~~**Zones:** A–F, adjustable 2–12.~~ Replaced by colour groups (part 4): zones need each piece's spot, too unreliable on real loose pieces (RESEARCH §9).
  - **Trays** (✅ part 4, by colour): pick a colour group, its pieces light up on your table photo, tap "These went into tray C" to set their status, and print tray labels.
  - Area search, Fill this spot (✅ part 5), Colour families (✅ as trays by colour, part 4), Box view.
- ~~**Embedding benchmark**~~ (✅ measured part 4: DINOv2-small far worse than the current method on real spots, 0.4 % vs 26 % first; not added, RESEARCH §12).
- **WebGPU accelerator,** only if the full-rescore budget is missed on your phone.
- **Tests:** placement top-1 and top-5 for detailed, plain and all cells; Strong-verdict precision and share; calibration.
- **From you:** pieces whose suggested spot was wrong (photo + where they really go).

### M5: Live tracking and re-identification
**Parts (2026-11-09):** 1. live view without markers (tracking from the pieces, outlines, tap, point out, Find it live) and the 🧪 Test tab ✅ built; 2. Fits / Doesn't fit buttons and the Accuracy page ✅ built; 3. re-identification on rescans (moved / removed / added, pending pieces to check, fewer duplicates) ✅ built (targets not fully reached, see the decisions table); 4. scan mode (Quick / Full), smoothing with forward prediction, the live view noticing moved pieces, dashed outlines when unsure ✅ built (the tracking-rate setting exists since M1; the on-device alignment check needs your screen recording).

- **Tracking:**
  - smooth marker tracking + optical flow, markerless fallback
  - timestamped homographies with forward prediction
  - tracking-state indicator; red/hollow "uncertain" outlines
- **Overlay:** pinned at ≥ 30 fps, pulsing targets, off-screen arrows, tap-a-piece panel.
- **Fits / Doesn't fit buttons** and **Settings → Accuracy** page.
  - Confirmed placements start constraining their neighbours' tab/blank pattern.
- **Re-identification:**
  - change detection (moved / removed / added; "in tray" and "placed" expected absent)
  - fingerprint-based re-identification
  - "pending" state with a close-up prompt
  - rescans never create duplicates
- **Scan mode setting** (Quick / Full) and tracking-rate setting.
- **Tests:**
  - tracking error under simulated motion
  - on-device overlay alignment check (screen recording)
  - zero duplicates across rescans, moves, batches and camera angles
  - pending cap
  - 10-minute memory leak test
- **From you:** a short screen recording if highlights drift or a piece is duplicated.

### M6: Piece-to-piece matching
- **Matching:**
  - candidate pairs
  - shape + seam-colour scoring, in the form decided by the M3 go/no-go
  - calibrated probabilities with a "partner not scanned yet" option
- **On the table:** match lines and 2×2 confirmation ✓.
- **Screens:** "What next" suggestions and the **Matches screen**.
- **Tests:** pair ranking (top-1 over sides whose partner is present, and median rank); precision of 2×2-confirmed matches; health metric (candidates within 2× of the best).
- **From you:** Fits / Doesn't-fit answers while building.

**Built (2026-11-09), box-led as the go/no-go decided** (R§11): the go/no-go on your real 21 pieces (24 true joins) found shape alone at chance level and the seam colours weak, so partners come from the box picture: pieces whose likely spots are neighbours probably join (src/project/pairs.ts). Shape rules out impossible pairs on the whole picture (among empty spots the placement already weighs knob fit). The chances are shown as computed: a lift fitted on synthetic puzzles would have shown your real pairs too sure; M8 tunes them from your answers. **🧩 Which pieces join** (the Matches screen, as a panel on the puzzle page) with **What next**, squares of 4 ✓, **📷 Point them out** (live view with lines), **✓ They fit / ✗ Don't fit** with Undo; partners per side in a piece's panel; lines between likely pairs in the live view; pair answers on the 📊 page. The seam-colour score and the extra-sharp retry were not built: the colours along the seam were weak on your pieces, and the sharp close-ups would need your puzzle.

### M7: Batch workflow
- **Marking placed:** tap "Placed" first; then optional reading of the assembly board with a second marker set. Placed neighbours constrain placement and Fill-this-spot.
- **Progress dashboard.**
- **Full backup:** export and import, with reminders.
- **Multi-batch sessions.**
- **Tests:** backup round trip; backup timing on a 1000-piece project; multi-batch re-identification; the 1000-piece synthetic run end to end.

**Parts (2026-11-09):** 1. **batches**: "Start a new batch" sets the table's pieces aside (trays and the puzzle stay), the next photo starts a fresh table, earlier batches' photos stay out of the live view, coverage map and table photo ✅ built. Re-identifying set-aside pieces by their picture was measured and is off (R§8: on synthetic 300-piece batches 3.5–8.7 % of new pieces would be merged into old ones); leftovers kept on the table are recognised by position. 2. **progress page** (totals per status and group, the puzzle filled in on the box picture, accuracy so far, pieces never seen) ✅ built. 3. **full backup** with reminders, timed on a 1000-piece project ✅ built. 4. **"Placed" in one tap**, the puzzle photo marking placed pieces, and the 1000-piece synthetic run end to end ✅ built.

### M8: Tuning on your real puzzle
- Refit thresholds, weights and probability calibration from your photos and answers (on a held-back part, so the reported accuracy stays honest).
- Learned colour transform.
- Speed, battery and memory optimisation (WebGPU where it pays).

**Parts (2026-11-10):** 1. **learned colour transform** ✅ built: once ≥ 12 pieces are in at known spots (✓ Fits, not "It's in the puzzle"), on the whole picture, an affine Lab correction on top of the one-time match is fitted from them (pulled towards no change), checked on pieces it wasn't fitted from, used when clearly better, and every piece is placed again; again after every 10 more. 2. **retune from your answers**: thresholds, Strong / Likely cut-offs and chances refitted from the answers in a backup you send, on a held-back half. 3. **speed, battery and memory** ✅ built (measured on the Mac with your photos; the iPhone's own numbers come from a Device check / report). 4. **fixes from the app review** ✅ built (2026-11-10): the review's bugs and speed-ups (REPORT §1–2), built by 7 builders each with an independent checker, then a 12-lens review of the merged result ("did it get worse?") with skeptics per finding and a completeness critic; of its 7 confirmed findings 5 were fixed, each checked again, and 2 kept on purpose (extra scan work that real photos need). The design suggestions (REPORT §3) come later.


### M9: Professional design
The app review's design plan (2026-11-10), in 6 stages, each tested on your iPhone before the next: 1. **readable now** (quick fixes); 2. **foundation** (colour tokens everywhere, buttons, lists, sheets, icons); 3. **core loop** (the piece card from the bottom with It fits / Not there and Undo; the outline language); 4. **structure** (four tabs inside a puzzle: Table · Picture · Pieces · More); 5. **the scan camera** like the iPhone Camera app; 6. **polish** (cut-out piece tiles, text that follows the iPhone Text Size, VoiceOver).

**Part 1, readable now (2026-11-10)** ✅ built: per-theme colour tokens (light mode passes 4.5:1 for text and 3:1 for lines, checked by a unit test, no raw hex outside the token block), "shape read" violet; small buttons 44 px, answer buttons 56 px side by side; Reduce Motion; a 0.6-black halo under every piece outline on photos and video (overlay colours re-picked to ≥ 3.3:1 against the halo); Undo for 10 s after a live-view answer; Tester mode (default on) hides the developer tools and numbers, the HUD starts off; the 🧪 entry is a 44 px button in the top bar; singular/plural and plain error sentences; the last puzzle reopens at launch; the set-up checklist folds to one line when done; the screen stays awake on puzzle pages; pinch-zoom allowed outside the camera screens; theme-color per appearance; portrait in the Home Screen app; screen titles and focus; a bottom action bar (Scan · Live view · Fill a spot · Joins) on the puzzle page.
---

## 7. How accuracy is measured

**In plain English:** each feature gets an automatic test with a minimum score it must reach before a milestone counts as done. The scores below are first targets on computer-made test puzzles. Real-photo scores are reported alongside from M2, and the bars only ever go up.

**Datasets:**
- **Synthetic validation sets:** for tuning only.
- **Frozen synthetic test sets** (separate artwork): for reporting only.
- **Real set:** your photos in `test/fixtures/real/`, hand-labelled where possible. They're kept out of the public repository, so real-photo tests run on this Mac before every deploy; the online build skips them.
- **Live feedback:** your Fits / Doesn't-fit answers.

**Rules:**
- **End to end:** no ground-truth outlines are fed in. There's also an "oracle" mode, to tell which stage failed.
- **Enough samples:** each tier pools several puzzles. 48-piece tier ≥ 10 puzzles; 300-piece tier ≥ 4 batches; 1000-piece tier ≥ 2 full puzzles in 300-piece batches.
- **Pass/fail on the conservative end:** the lower end of the 95% confidence range must clear the bar (the upper end, for error rates). Noise can't fake a pass or a fail.
- **Precision always comes with coverage:** e.g. how many pieces got a "Strong" verdict, so the app can't look accurate by rarely committing.
- **Thresholds only go up (ratchet).** Lowering one needs a written reason here.

**Initial thresholds** (synthetic test sets, end to end):

| Test | Definition | 48 | 300 | 1000 | Milestone |
|---|---|---|---|---|---|
| Segmentation | Per piece; match = IoU ≥ 0.85 with the true top face; non-touching pieces. Recall / precision | ≥ 98% / ≥ 98% | same | same (in 300-piece batches) | M2 |
| Position | Piece-centre error in table mm, markers visible: median / 95th percentile | ≤ 1 / ≤ 2 mm | same | same | M2 |
| **Outline error** | Detail reads; mm from the true top-face outline: median / 95th percentile (also reported by shoulder/knob/neck and distance from centre) | ≤ 0.25 / ≤ 0.6 mm | same | same | M3 |
| Corner position | Detail reads; median / 95th percentile | ≤ 0.3 / ≤ 0.8 mm | same | same | M3 |
| Side type | Detail reads / overview reads (provisional) | ≥ 98% / ≥ 92% | same | same | M3 |
| Corner and edge pieces | Recall and precision for each class, detail reads, pooled | ≥ 97% | ≥ 97% | ≥ 97% | M3 |
| Shape-only partner ranking | Over all sides whose partner is present: top-1 and median rank | reported | reported | reported | M3 (real go/no-go: median rank ≤ 3, top-1 ≥ 50%) |
| Placement, **detailed** cells | top-1 / top-5 (cell class by the frozen rule, R§9) | ≥ 90% / ≥ 97% | ≥ 75% / ≥ 90% | ≥ 65% / ≥ 85% | M4 |
| Placement, **plain** cells | top-5 | ≥ 60% | ≥ 45% | ≥ 35% | M4 |
| Placement, all cells | top-1 / top-5 | reported | reported | reported | M4 |
| "Strong" placement verdicts | Share that are right; share of detailed-cell pieces that get one is reported | ≥ 95% | ≥ 95% | ≥ 95% | M4 |
| Probability calibration | The displayed top-1 probability; calibration error pooled over ≥ 1,000 predictions per tier; Brier score reported | ≤ 0.05 | ≤ 0.05 | ≤ 0.05 | M4 |
| Re-identification: duplicates | 5 rescans with 20% moved, 10% removed and returned, rotation, light changes, **camera angle 0–20°, off-centre, 1× and 2×** | 0 | 0 | 0 | M5 |
| Re-identification: wrong merges / still pending after one close-up rescan | | ≤ 0.5% / ≤ 5% | same | same | M5 |
| Tracking | Homography error per analysed frame, markers / markerless; on-device displayed overlay error while moving slowly (screen recording) | ≤ 2 mm / ≤ 5 mm; displayed ≤ 4 mm | same | same | M5 |
| Pair matching | Detail reads, with box prior: top-1 over sides whose partner is present (median rank reported) | ≥ 85% | ≥ 75% | ≥ 70% | M6 (form set by the M3 go/no-go) |
| 2×2-confirmed pairs | Share right, with ≥ 50 confirmations pooled per tier; share of pairs confirmed is reported | ≥ 98% | ≥ 98% | ≥ 98% | M6 |
| 10-minute live loop | WASM memory growth after warm-up; live OpenCV objects back to baseline; open frames | ≤ 1%; yes; ≤ 2 | | | M1 / M5 |

**Real-photo results:**
- Reported next to the synthetic ones from M2 onwards.
- The real-photo bars are set once there are enough of your photos.
- The M3 go/no-go is the first real-photo gate.

---

## 8. Speed and memory budgets (on your iPhone, shown in the HUD)

| Item | Budget |
|---|---|
| Overlay frame rate | ≥ 30 fps |
| Tracker (markers + flow) | ≤ 25 ms per frame and ≤ 750 ms of work per second; gap between H updates shown in the HUD |
| Overview Snap of 300 pieces, to catalog | ≤ 8 s |
| Each detail Snap | ≤ 6 s |
| Backup / report preparation for a 1000-piece project | measured in M7 (Mac, WebKit, 1000 pieces + 10 full photos, 57 MB): backup 1.9 s, import 2.2 s; expect a few times longer on the iPhone; shared only once prepared |
| Marker-free overview photo (your 18 MP photos, 24–44 pieces) | measured in M8 (Mac): first photo of a scan 4.4–7.2 s, the next at about the same height 1.6–2.0 s; OpenCV memory 102 MB after the first, no growth after |
| Live view while held still | measured in M8 (WebKit, simulated camera at 30 fps): 7 frames analysed per second (25 while moving) |
| Your 41 photos, every kind of scan (M8 part 4) | measured on the Mac (Node, the real reader code; old and new back to back on a quiet Mac, twice): in all 609 → 485 s (0.80 ×), per photo 0.81 × (median); the first photo of a scan 0.57–0.96 × (median 0.83 ×): a photo of the puzzle so far (IMG_9280) 6.2 → 4.1 s, of the finished puzzle (IMG_9272) 5.5 → 3.7 s, of loose pieces (IMG_9127, IMG_9276) 5.7 → 5.3 s; the same pieces found, except IMG_9226 and IMG_9227 started from a wrong remembered height, which now recover |
| First photo after "Start a new batch" (600–900 pieces set aside) | M8 part 4 (Mac): the screen froze 1.8–2.6 s while the photo was added; now under 1 ms for that step |
| Where pieces go on the whole box picture (1000 pieces) | M8 part 4: 3.3 × faster in Node (11.2 → 3.4 ms a piece), 5.7–6.3 × in WebKit, the same spots and chances |
| Sort into trays by colour (opening it) | M8 part 4 (WebKit, 1000 pieces): about 0.5 s → 50–74 ms; the screen never freezes more than 0.08 s |

**Memory** (iOS kills the page at about 1.4–2 GB depending on the model; everything below shares that limit):

| Part | Budget |
|---|---|
| Main thread (screens, video, overlay, one decoded photo at a time) | ≤ 250 MB |
| Tracker worker WASM (starts at 32 MB; measured 32 MB in the Mac tests) | ≤ 160 MB |
| Reader worker WASM (capped; restarted after each scan, because WASM memory never shrinks) | ≤ 384 MB |
| Matcher worker | ≤ 128 MB |
| ML worker (only while the reader is idle) or WebGPU buffers | ≤ 200 MB |
| **Total worst case** | **≤ 1.1 GB (typical < 800 MB)** |

These are adjusted to the headroom measured on your phone in M1. Automated timing tests use the same budgets, scaled by a phone-to-Mac speed factor also measured in M1.

---

## 9. Risks and what we do about them

| Risk | Mitigation |
|---|---|
| Shape matching isn't discriminative at phone resolution (the biggest risk) | Close-ups at 2× (confirmed optical on your phone), level and still thanks to auto-capture; print vs wall separation; box picture as the primary signal; honest probabilities; **real-piece go/no-go in M3** with a defined fallback (box-led matching) before M6 is built |
| Piece walls distort outlines (parallax) | Narrow 2× view, most-central view per piece, print vs wall separation, outline-error test (R§4) |
| `takePhoto()` interferes with the live stream / gives smaller photos | Camera contract (§3.1); measured on your phone in M1 |
| iOS kills the page for memory | Per-part budgets, tiles, HUD counters, reader restart, leak tests |
| iOS WebGPU / ML runtime bugs | CPU first; GPU and ML only behind self-tests; soak tests |
| Home Screen camera-permission bug | One-tap start, automatic recovery |
| Share sheet refuses after slow preparation (5-second rule) | Prepare first, then share; download fallback |
| An app update wipes data | Versioned database with upgrade tests; minimal export from M2 |
| iOS freezes the app mid-job | Resumable jobs, single-transaction merges |
| Safari fingerprinting protection adds noise to pixels | Read frames via `VideoFrame.copyTo`; noise probe; WASM JPEG decode fallback |
| Box art cropped or extended vs the real puzzle | Border question + fitted box-to-grid correction |
| Printer rescales the marker sheet | 100 mm check bar; scale-free grid cues |
| Glare on your glossy table | Side light advice and a light check in the wizard; glare spots found in every photo; pixels under glare filled from a second photo at a slightly different angle; "retake" when glare covers a piece |
| Pale pieces on a white table | Edge and side-shadow cues, not colour alone; table-contrast check warns which parts of the picture are pale; pale pieces that are still missed can be added with one tap (M3). Measured on your real pale pieces in M2 |
| Hand shake and tilt (no stand) | Auto-capture only when level and still; blur check after every photo; tilt ≤ 5° for close-ups; the markers correct the remaining perspective |
| Shadow of the phone and your hands | Side light advice; shadows are told apart from pieces (shadow-aware segmentation); the light check shows them in the wizard |
| Puzzle brand with uniform cuts | Shape counts for less; placement and colour still work; percentages stay honest |
| Losing a 1000-piece catalog | Home Screen install first, `persist()`, backups with reminders |

---

## 10. Known issues

**M8 part 4 (2026-11-10), still open after the review:**
- **IMG_9244 (the puzzle part done) reads as "finished" 28 × 37**, one row too many. Nothing is saved from it now (the count doesn't match the grid), and the note asks to check the grid although the grid is right. Follow-up: when the grid is known and each count is within 1 of it, read the gaps at the grid's own count.
- **The loose-piece count beside a finished puzzle is rough:** IMG_9244 16 (14 by eye); IMG_9280 after its own pieces were scanned 11 (8 by eye; that catalog's piece size is off).
- **IMG_9245** (brown pieces in the lid) after a photo at another height stays unplaced, as before.
- **Scan note:** "More ▾" can cover the end of the last line in view (tapping it shows all). Pre-existing, unchanged: sideways the middle panel can cover the gauge's message, and with no note it covers "Allow the tilt sensor"; with the camera paused "‹ Back" can't be tapped (the centre overlay lies over it); at 375 × 553 (SE in Safari), while photos take themselves, the note covers the gauge's message; a three-line gauge message overlaps the panel by about 17 px.
- **The gauge's height** can read far off (e.g. "406 cm") when few pieces are in view (frameAnalyser measurePieces).
- **Piece panel:** a real piece's picture loads 15–30 ms after the panel opens and moves ✓ Fits down 25 px (as before); reserve its place.
- **Test flake (WebKit):** a page reload while piece pictures are being read gives "Cannot load blob … access control checks" (the old code failed 4 of 30 runs, the new 1 of 30).
- **The photo reader** is restarted only after a 120 s time-out on Scan (PS-9).
- **Bin card:** if an older version of the app empties the bin while the puzzle page is open, Restore says "The newer scan is now in the bin." although nothing was swapped (as before).

**Found on your iPhone (first report, 2026-11-06, Safari tab):** every in-app photo (`takePhoto()`) failed: "Internal error" when a size was given, "setMaxPhotoDimensions failed" without one, in every format, and the 2× test too. Everything else worked (4032×3024 live at 30 fps, direct frames, 9 ms per frame, WebGPU, offline, memory headroom about 1,728 MB). Response:
- a **Photo test** (Device check step 4) that tries each possible cause on its own and remembers what works;
- **Cause found** (second report, Home Screen app): with live tracking OFF every photo works at full 12.2 MP (~0.7 s). With tracking ON, photos come out at the tracker's shrunk size (540×960) or fail. The Photo test now only chooses ways that give a full-size picture, and also tries tracking with a full-size camera copy. The camera tests (step 2) take their photos with tracking paused.
- **Fourth report:** even with the tracker's copy fully closed, photos stay 540×960 until the camera restarts. The live-picture backup gives 3024×4032 but is visibly soft (video processing). New Snap option: pause tracking + restart the camera (~1 s). The Photo test runs each stage on a freshly started camera.
- **Fifth report: solved.** With a full-size tracker copy, photos are full 12.2 MP and sharp (sharpness 3,810 vs 55 for the live picture) while tracking keeps running. The 2× test measured 1.83, a true optical 2×. Cost: tracker 17 fps (GPU shrink 47 ms per frame). The fix reads big frames directly and shrinks them ×4 in OpenCV (Mac 18.7 ms), and the tracker times both ways on the phone and keeps the faster. **Confirmed on the phone (sixth report):** tracker 27.8 fps, 22.9 ms per frame (direct 20 ms vs GPU 52 ms); Snap sharp 3024×4032. Full-size tracking is now the default everywhere.
- Snap now falls back to the **full-size live picture** (12 MP in the 4:3 format), then to the iPhone camera screen. It is checked with exact pixel reading, but its saved JPEG goes through a canvas (it may carry Safari's tiny privacy noise, which only matters for reports).

**First look at your real table photo (2026-11-07):** a half-built puzzle and everyday objects (headphones, remote, coaster, box lid) were taken for "touching pieces", and loose pieces inside the puzzle's frame were missed. Fixed: the table is found first (floor and rim ignored), the assembled part and objects are reported separately (green / red on "See the last photo"), holes inside an assembled frame stay table. On that photo: 66 of about 95 loose pieces found (27 still flagged as touching: the dense dark group), scale within 7 %, 2.3 s on the Mac. Real pieces show a top face of about 79 % of their cell (measured on one photo, to re-check on yours). Synthetic accuracy changed by under 1 point (test sets 93.9–94.0 %).

**Marker-free mode (2026-11-07), before your iPhone check:**
- Every later photo is placed by matching its pieces to the catalog: 82 of 82 test photos placed (phone turned 90°/180°, middle close-ups, 10 % of pieces moved); every photo of a different puzzle refused. Position vs truth: median 0.6 mm / 95th percentile 1.7 mm (300-piece tests), 1.2 / 3.9 mm (48-piece tests: too few pieces in the first overview to level its small tilt). About 1 % of pieces counted twice (pale, cut or touching pieces whose outline differs between photos).
- Sizes are estimates from a typical piece (18.6 mm); everything is shown with "≈".
- Outlines are shown on each photo, not live (live marker-free tracking: M5).
- A 300-piece overview takes 3.5–4.4 s on the Mac, so roughly 5–10 s on the phone: over the 8 s budget at the slow end.

**Box lids and trays (2026-11-07), measured on 3 photos you sent (IMG_9244–9246):**
- **White table, nearly finished puzzle (IMG_9244):** all ~18 loose pieces on the table found (about 5 labelled "object" by mistake); light pieces lying *on top of* the built picture mostly missed; pieces inside a box lid in that photo not found.
- **Grey grainy tray, ~120 pieces, phone close (IMG_9246):** scale found by itself (7.1 px/mm; the tray then measures 243 × 324 mm, matching your box); 43 found in the tray, 22 as clean single pieces; the dense brown pile is mostly reported as one area (touching pieces). Before the change: almost none.
- **Brown pieces in a brown cardboard lid (IMG_9245):** ~13 of ~25 found; scale 6.1 px/mm, probably ~12 % low because pieces are only partly outlined. Brown on brown is the hardest case: a contrasting surface (white table, grey tray) works much better.
- Your earlier white-table photos give the same results as before.

**M2 (2026-11-06), before your iPhone check:**
1. **Piece finding is below its 98 % bar on computer-made test photos.** Frozen test sets (white glossy table, glare, side light, hand shadows, hand-held 1× overviews at 65–75 cm and 2× close-ups): pieces found **94.8 %** (48-piece set) and **94.3 %** (300-piece set), precision 93.9 % / 94.2 %; 2× close-ups 94.8–97.8 %. **Near-white pieces: 34 % (15 of 44).** Positions are well inside their bar (median 0.15 mm, 95th percentile 0.5 mm). The bars stay at 98 %; your real photos (Part D of the checklist) decide what to do next: a full-resolution cut-line cue, preferring close-up reads, the ML fallback (RESEARCH §6), or a one-tap "add missed piece".
2. **A close-up with no marker in view** (the middle of a 3 × 3 plan) can't be placed yet: the app says so and adds nothing. Placing it from the overview's pieces is still to do.
3. **Moved pieces** may be counted twice (matching is by position only); recognising moved pieces is M5. *(2026-11-08: a first version is in; see the decisions table.)*
4. **Touching pieces** are flagged (orange dashes), not split.
5. **Measured piece size** is a first estimate from piece areas (M3 measures cells from corners). The finished size shown is marked "rough".
6. **Speed:** a 300-piece overview takes about 3 s on the Mac, so roughly 4–8 s on the phone, close to the 8 s budget. The phone measures it (scan log).
7. **Full-size photos** of the latest 10 scans are kept (3–10 MB each) so they can travel in a backup for checking; older ones are dropped.
8. Printing from the Home Screen app (`window.print()`) is untested on iOS; "Send to my Mac" is the fallback.
9. **A whole finished puzzle in one photo (IMG_9272, 2026-11-08)** is only partly recognised as one assembled area (~70 %): its darker, beige lower part is missed, and 3 small bits inside it would be listed as loose pieces. The same photo confirms the grid (28 × 36 seams counted) and the picture's true 50 × 70 shape (within 0.5 %). It is kept as the real reference for M3 (every piece's outline in place) and M4 (every spot's true colours). *(2026-11-08: fixed, see the decisions table.)*

**Seventh report (2026-11-06, Safari tab) — M1 checked on the phone:** Device check steps 1–5 all done in the Safari tab; Snap sharp 3024×4032 with full-size tracking (chosen by the Photo test, now also the default); tracker 22–28 fps; memory headroom 1,792 MB (the most the test tries). The marker test was right in all three positions (upright, sideways left and right).
- **The 2× lens test now gives a verdict.** Your phone measured 1.83 and 2.40; ≥ 1.3 counts as a true 2× lens. A lower ratio only says "not confirmed" (digital zoom has not been measured on a phone, so it is never called that).
- **Watch item:** after the Photo test (about 25 full-size photos in a row) the next visit noted that the page had ended while on screen. iOS may have reclaimed the page. Normal use takes far fewer photos in a row; M2's memory tests will include long photo series.

**M1 (2026-11-04).** Remaining notes:

3. **Big photos.** While a photo is checked, one full-size decoded copy is in memory (about 48 MB for 12 MP). Photos bigger than 16 MP (e.g. 48 MP from the iPhone camera screen) are checked at 12 MP size and reported with their real size. M2 decodes in tiles.
4. **The memory test result can be up to about 64 MB too low.** The last step may not be saved at the moment iOS closes the app.
5. Report sharing works on the phone (seven reports received). How `takePhoto()` behaves with the live camera is measured and handled (see the reports above).
6. **Camera permission is asked at every launch of the Home Screen app.** This is a known iOS bug (WebKit 327237), not ours.
7. **The memory readouts show the size of each helper's WebAssembly memory.** It only grows, never shrinks. They start at 32 MB, so growth is visible, but they don't show the bytes actually in use.
8. **Automatic publishing is waiting for a permission.** This Mac's GitHub login can't push the workflow file yet (it needs the `workflow` permission). Until you grant it (one step in the checklist), I publish by hand from the `gh-pages` branch, after running every test on the Mac.
9. **GitHub's test machine.** It runs WebKit on Linux, which may lack the direct frame path or WebGPU. The tests accept either frame path, and those Device check rows are allowed to be "not available".

---

## 11. Decisions log

| Date | Decision | Reason |
|---|---|---|
| 2026-11-04 | 8 markers in the mat margin instead of 4; check bar + grey patch on each sheet | Close-up views see only part of the table; printers rescale; white paper clips (R§5) |
| 2026-11-04 | Overview + detail Snaps; one stand height with 1× / 2× | ~12 MP limit; shapes need ~180–250 px per piece; 2× halves the piece-wall problem (R§4) |
| 2026-11-04 | Snaps only for cataloguing; live video for pointing | Live frames too low-resolution and unsteady (R§4) |
| 2026-11-04 | Print vs wall separation mandatory for detail reads | The silhouette fills tab undercuts; line pull-back can't fix it (R§4, review) |
| 2026-11-04 | Camera contract for `takePhoto()` | WebKit mutes all clones and may switch format, depending on the requested size (R§3, review) |
| 2026-11-04 | Markers and table mapping move from M5 to M2; simple tracking in M3 | All measurements depend on them; highlights must stay put from M3 |
| 2026-11-04 | Grid confirmation in the wizard from M2, with manual entry | Border counts in M3 need it; common layouts were outside the first window (R§10) |
| 2026-11-04 | Minimal export in M2; versioned database from M1 | Real use starts in M3 (R§14) |
| 2026-11-04 | Accuracy page in M5 | Visible as soon as you start answering Fits / Doesn't fit |
| 2026-11-04 | CPU-first, WebGPU as accelerator | Per-piece cost is small; iOS WebGPU crash bugs; fallback needed anyway (R§13) |
| 2026-11-04 | No WASM threads; multiple workers; change detection out of the tracker | GitHub Pages can't set isolation headers (R§3); the tracker must keep its frame rate |
| 2026-11-04 | Custom OpenCV.js 4.14 SIMD build, unwrapped ES module | Official builds have no SIMD; the UMD wrapper breaks ES modules (R§18) |
| 2026-11-04 | Embedding model is an M4 experiment, not a dependency | No evidence yet that it helps here; adds 45 MB (R§12) |
| 2026-11-04 | ML segmentation benchmark deferred to M2 with a trigger | Only needed if classical segmentation fails on your photos (R§6) |
| 2026-11-04 | Dexie over idb | Catalog needs indexed queries |
| 2026-11-04 | Real photos are kept out of the public repository by default | Privacy; the repository must be public for free GitHub Pages |
| 2026-11-04 | OpenCV build: Emscripten 6.0.13, native wasm exceptions, one build for all workers, memory starts at 32 MiB (OpenCV's 128 MiB default patched out) | Errors can be caught instead of killing a worker; memory growth is visible from the start (R§18) |
| 2026-11-04 | Every OpenCV catch goes through `cvGuard` (restores the WASM stack pointer and frees the C++ error) | Without it, ~65 caught errors kill the module (found by the M1 tests) |
| 2026-11-04 | Tracker per-frame code in `src/cv/trackerCore.ts`, shared by the worker and the leak test | The leak test must run the real code, including GPU-shrunk big frames, fallback frames and thumbnails |
| 2026-11-04 | The direct frame path has a watchdog (falls back to copied frames after 4 s without frames) and the tracker restarts itself after 30 errors in a row (at most 3 times) | A silent stall would look like "Live" with no tracking |
| 2026-11-04 | 2× test uses a band-pass detail measure; no verdict is shown until checked on your phone | The first measure couldn't tell a real 2× from digital zoom (R§4); BRIEF §1: never present a guess as certain |
| 2026-11-04 | Photos over 16 MP are checked at reduced size | BRIEF §2: never decode a 48 MP photo at full size |
| 2026-11-04 | Device check keeps results across app updates (each row tagged with its version) and shows only the current mode | Safari tab and Home Screen app keep separate data; results were silently dropped after an update |
| 2026-11-06 | Snap takes its picture the way the Photo test found to work; fallback chain: camera photo → full-size live picture (grabFrame) → iPhone camera screen | On the owner's iPhone every takePhoto() call failed; the live picture is already 12 MP in the 4:3 format |
| 2026-11-04 | Crash notice only when the app was on screen when it ended | iOS reloads backgrounded apps without firing pagehide; that is not a crash |
| 2026-11-06 | **No stand: the phone is always held by hand.** Level-and-height gauge from the markers and auto-capture when level and still | Your choice; the app is meant to be used handheld. The markers give tilt and height every frame, so the app can wait for a good moment instead of asking you to hold still |
| 2026-11-06 | **No mat: pieces lie on your white glossy table.** Table model from an empty-table photo; edge and side-shadow cues for pale pieces; glare detection with fill-in from a second photo; side-light advice | Your choice. Replaces BRIEF §4's "require a matte mat"; glare and pale-piece risks are handled in software and measured on your photos in M2 |
| 2026-11-06 | **Finished size is measured, not asked.** Wizard asks only the piece count; grid from count + box picture shape; size = grid × piece pitch measured from the first overview photo. The box photo moves from M4 to the M2 wizard | Your request; the box picture's shape is needed for the grid anyway |
| 2026-11-06 | Close-ups at 2× from about the same ~65 cm height as the overview; ~6 planned close-ups that each include a ring marker where possible; the middle one uses the tilt sensor and is placed from the overview's pieces | Your phone's 2× lens is a true optical 2× (measured 1.83 and 2.40); one height is easier to keep by hand. Tests showed that at 2× a close-up of the table's middle sees no ring marker (M2 geometry tests) |
| 2026-11-06 | Printed markers kept (you can print A4) | Handheld tracking needs them even more than a stand would |
| 2026-11-06 | Markers 54 mm on 90 mm cards, 4 per A4 sheet; table frame = marker 0; marker map from ONE photo of the empty table by joint least squares (8 squares of known size) | No measuring by the owner; tests place all 8 within 2 mm from a hand-held photo |
| 2026-11-06 | Table frame is "image-like" (x right, y towards you, z into the table) | Matches how markers are printed and seen; found by the generator (mirrored images otherwise) |
| 2026-11-06 | Photo quality gate measures blur from the marker edges (10–90 % edge width) | Scale-free and exact: markers are known perfect steps |
| 2026-11-06 | Synthetic generator renders linear light with iPhone-like auto-exposure; overviews at 650–750 mm with all 8 markers in view | First version clipped the white table and hid glare (found while tuning piece finding) |
| 2026-11-06 | M2 ships below the 98 % segmentation bar, with the shortfall stated | Owner's real photos are the deciding data; the bar is not lowered (PLAN §7 ratchet) |
| 2026-11-06 | Full photos of the latest 10 scans kept and included in backups | The owner can send real scans for measurement without extra steps |
| 2026-11-07 | **No printed markers by default.** The first overview defines the table; every other photo is placed by matching its pieces (colour, size and the pattern they form) to the catalog; tilt from the phone's sensor; height from the pieces' apparent size; markers stay as an option | The owner puzzles away from home without a printer. Matching pieces also places the middle close-up, which markers couldn't |
| 2026-11-07 | **Grainy surfaces (box lids, trays):** when the surface's brightness noise is above 0.015 (white table ≤ 0.010; lid and tray 0.028–0.043), colour thresholds use the surface's measured colour noise, and piece-sized darker patches count as print; a "phone closer than usual" check re-detects at the scale piece-shaped clumps imply. White-table behaviour unchanged | The owner sorts pieces in the box tray and lids, not only on the table (photos 2026-11-07) |
| 2026-11-08 | **M4 part 1, box placement:** piece patch = the piece straightened by its shape-read corners to 32 px per cell + 12 px margin, masked by its outline (eroded 2 px); box picture resampled to 8/16/32 px per cell (Lab); score = texture-gated ZNCC of L, a, b (weights 1, 0.6, 0.6) − mean ΔE/60 − share outside the picture; coarse to fine (all cells × 4 turns → 48 → ±2 px shifts → 12); trusted corner/edge reads only where their flat sides face the picture's edges; softmax T = 0.008 with "somewhere else" at −0.04; Strong p ≥ 0.75, Likely ≥ 0.4; one-time colour match (Reinhard, Lab) from the first ≥ 20 pieces | Synthetic, scanned and traced end to end with a photographed-lid box picture: val48 top-1 90.6 %, top-5 97.1 %; val300 top-1 83.6 %, top-5 91.9 % (RESEARCH §9 cites 78–86 % for comparable methods); Strong right 95.4 % (78 % of pieces). Real: spots of one finished-puzzle photo found in another 48 % (screenshot at 37 px per cell, glare, app overlays); same-photo spots 100 %; real loose pieces not yet measured (needs the M4 checklist Part D) |
| 2026-11-08 | **M4 part 1b, real-photo fixes** (owner's 21 pieces IMG_9276, holes photo IMG_9280, app screenshot IMG_9288): (1) piece outlines use the print's linen texture where colour can't tell (smooth table, ≥ 6 px/mm): local spread of high-passed brightness (σ 0.2 mm, window 0.25 mm, capped at 2 × the piece's typical value so the dark edge line doesn't spread), on when the piece's is ≥ 3 × the table's, only where colour didn't decide the edge; (2) placement softmax T 0.02, "somewhere else" at −0.06, Strong ≥ 0.75, Likely ≥ 0.55; (3) finished check: the box-outline finder's corners only when each lies on the outline, else the 4 sides fitted as lines; a gap = ≥ 55 % of the cell's middle within ΔE 15 of the table and that part ΔE/5 + σ/12 < 1 | Real truth from the holes. Box picture vs real puzzle: within 0.15 cell. Pale-piece outlines: 9 of 21 wrong → all right; accuracy sets unchanged (val300 placement 82.8 %, with texture off 80.0 / on 80.1 % in a wider-search run). Old calibration on real: 74 % of finished-puzzle spots Strong (27 % of those wrong), 14 of 21 loose pieces Strong (9 wrong); new: 25 Strong of 90 spots, all right; loose 4 Strong, 3 right; synthetic Strong 96–97 % right. A wider search (150/30 candidates, ±1 px) cost 2–3 % on val300 and gained nothing real once outlines were right: not used. Colour match from the true areas would lift loose pieces only to 8 of 21 first. Holes photo: exactly the 21 gaps, none on IMG_9272. Real loose pieces: right spot first 5 / 21, top 5 7 / 21 |
| 2026-11-09 | **M4 part 2, leftover pieces into the empty spots** (owner's screenshots IMG_9294/9295: "Strong" on spots that aren't holes): the finished check keeps its gaps and the puzzle straightened at 8 px per cell (Project.openSpots); at placement it is turned to the box picture (best Lab correlation over the quarter turns that fit the grid), pieces are scored at every gap (no pruning), colours matched to the gaps' box colours, then one piece per spot (Hungarian on score − (−0.2), pieces/spots may stay unpaired) with chances from Sinkhorn balancing (T 0.04, dustbin row/column); Strong ≥ 0.75, Likely ≥ 0.55 of that chance; "Use the whole picture instead" | Real (21 patches vs the 21 holes, truth from IMG_9272 with the pieces in place): 14 of 19 real pieces right (best spot alone 13; whole picture 5 of 21), 9 Strong all right, 2 Likely both right, table patch left unpaired. Synthetic val48 (every piece's cell + 20 % unscanned spots): 95.1 % right (best spot alone 90.7 %), Strong 73 % of pieces, 99.7 % right; val300 with nearly every spot open (~360): 86.9 % right (alone 83.2 %), Strong 23 %, all right; 24–306 ms per piece on the Mac (grows with the number of spots) |
| 2026-11-09 | **M4 part 2b: finished-puzzle check on every photo, not only overviews** (owner's screenshots IMG_9297/9298: still whole-picture mode, the same wrong Strong) | After the first overview the scan screen switches to close-ups; the holes photo was then read as a close-up (no finished check; 11 of its spots catalogued as pieces). On IMG_9280 and IMG_9272 the check gives the same grid and gaps read as a close-up (zoom 2) as an overview; a close-up of part of a puzzle can't pass the count test. Tested end to end in the app (local build, owner's photos): 21 gaps saved, 8 Strong all right, 2 non-pieces fit none |
| 2026-11-09 | **M4 part 3: knob fit among the empty spots.** (1) Hole sides from the holes photo: for each gap side facing a piece in place, the side's true line from the table edge 0.28–0.34 of a cell either side of the knob axis, then table share just outside (0.1–0.3 of a cell: knob out) vs piece share just inside (knob in), decided at a 0.2 margin. (2) Piece sides from shape reading (kind + confidence; × 0.6 when the read isn't trusted), kept with the patch. (3) Placement in empty-spots mode returns every turn's score per spot; pairing objective = score + per side ±(0.025 / 0.12) × confidences for hole sides and for neighbouring pieces' shared sides (interlock); found from the plain one-per-spot pairing by local search (turn, swap two, move to a free spot / unpair; only the moved pieces' parts recomputed); chances by Sinkhorn on each piece's score with its spot's current neighbours. "Fits none" cut-off kept at −0.2 | Real holes photo IMG_9280: 33 sides read, all right, 3 unread. Real pieces (box picture from the app screenshot, truth from knob patterns of the complete puzzle IMG_9272 + appearance): 13 → 16 of 19 right, Strong 9 → 12 (all right); in the app (pieces photo with the coin, 23 found): 17 Strong, all right, 1 Likely right. A looser cut-off (−0.35 / −0.5) placed one more wall piece but let the bottle label take a hole as Likely/Strong: not used. Synthetic, two hole groups (5 × 2, 4 × 3): val300 89.3 → 97.6 %, Strong 19 → 54 % (100 % right); val48 93.8 → 94.3 %, Strong 79 → 91 % (99.4 %) |
| 2026-11-09 | **M4 part 4: trays by colour, not zones.** Zones (equal-area rectangles, piece zone = most placement chance) measured before building: synthetic 87–91 % right, but real only 60 % (spots cut from the finished puzzle, 6 zones) and 8 of 19 loose pieces; the finished-puzzle photo as reference barely helped (5 of 21 first). DINOv2-small embeddings: 0.4 % first on real spots (current 26 %), 22 % even on spots from the box picture itself: not added. Built instead: colour groups (each piece's main colour from a 2-means split of its patch, k-means++ groups darkest first, 2–12, default 6; fixed while any tray holds pieces), status 'tray' + letter (not expected on the table; still placed and still competing for empty spots), the group lit up on the newest scan photos (up to 3), labels 6 per A4 with the letter, colour and up to 8 piece photos. The box-picture colour map was dropped (5–7 of 21 groups lit their own area: the photos' colour casts differ too much) | Owner's choice after the measurements (2026-11-09). In the app with the owner's 21 pieces: 6 coherent groups (wall pieces together, the label and table patch together); tray pieces kept in the empty-spot matching (else 17 → 11 Strong) |
| 2026-11-09 | **M4 part 4b: colours evened out for the lamp before grouping.** The table's colour 2–4 mm around each piece (measured during the scan, kept with the patch; for older pieces from the saved scan photo the patch came from) is a white reference: linear RGB × median table / this table; lightness weight 0.4 | Owner's screenshot IMG_9299 ("some are mixed"). On the 21 pieces: wall in one group at 3, 4 and 6 trays, no dark–wall mix (before: wall over 2–4 groups) |
| 2026-11-09 | **M4 part 5: Fill this spot.** A spot's candidates are read from what each piece already shows: among empty spots every piece has a chance at every spot (one per spot, the chosen piece first); on the whole picture only pieces with the spot in their top 5. Chances below 2 % not listed. Taps snap to the nearest empty spot within 3 spots; on the whole picture a 9-spot close-up with a grid and arrows picks the exact spot. Lit up on the scan photo: chosen green, others yellow; pieces in trays named, not lit | Owner's choice (2026-11-09). In the app with the owner's 21 holes: every hole answers; 17 Strong / 1 Likely / 2 several, matching the piece list |
| 2026-11-09 | **M4 part 6: green outlines on the scan photo, not the live camera.** States (PLAN §5 colours): green = fits a spot with Strong/Likely, blue = shape read, grey = found; green pieces labelled column·row; tap = zoom 2.5× on the piece + its spot and frame side; frame side only from a known spot on the picture's edge. Up to 6 photos to show every piece. Pinch-zoom is off in the app, so the view zooms on tap | Live outlines need tracking, which works only with printed markers until M5; the owner scans with photos. Real: 18 green / 3 blue / 2 grey on IMG_9276, sides match the holes' flat sides |
| 2026-11-09 | **M5 part 1: live view without markers.** The puzzle's newest overview photos (≤ 3, read at 1280 px) give ORB features (2,500 per photo, ≤ 6,000) with their place on the table (mm). Each live frame (analysed at 960 px; markers not looked for): ORB (1,000) → 2-NN Hamming match, ratio 0.8 → RANSAC homography table mm → frame px (4 px, ≥ 20 inliers; good from 40 and ≥ 30 % of matches), checked plausible (no mirror, 0.25–40 px/mm, a square stretched ≤ 2.2×, no horizon in view). Between full matches (every 6th frame) the inliers (≤ 400) are followed by pyramidal Lucas–Kanade (21 px, 3 levels) and refitted; back to a full match when < 30 points or < 60 % agree. Drawn with the latest fix; not drawn after 600 ms without one | Synthetic val300 (960 × 720 live frames from other camera places): worst piece error 0.5–1.0 mm (moved 80 mm + turned 25°, turned 90°, tilted 18°, 30 % lower / higher); slow pan 1.2 mm, 12 of 14 frames by flow (4–5 ms; full match ~50 ms on the Mac). Real IMG_9263 → IMG_9264: 465 / 484 points agree, worst 0.42 mm on 23 pieces. Leak: 18,000 frames, WASM 0.00 % growth, table found in all but the 400 covered frames |
| 2026-11-10 | **M9 part 1: readable now (design stage 1).** Built by 4 parallel builders, each in its own copy, merged by the lead; quick wins 1, 2, 4, 5, 7–11, 13–18, 20 of the design plan (3, 6, 12 and 19 were done in M8 part 4). Choices: Tester mode **on** by default (you are testing; nothing disappears by surprise), HUD off by default; theme-color matches today's page backgrounds; the 🧪 edge strip stays only where a full-screen picture covers the top bar; the halo is drawn per piece (one pass), not in a separate pass (+70–80 % draw cost) | Contrast unit test over every token pair, both themes; halo pixels checked in WebKit; live-view outline drawing +10–20 % at 40 pieces, about +2 ms per frame at 300+ pieces (Mac WebKit); e2e for reopen-last-puzzle, the bar not covering ✓ Fits or the Undo note, titles, Tester mode on/off, Undo after a live answer |
| 2026-11-10 | **M8 part 4: fixes from the app review (bugs and speed).** Scan: the scale hint only from the newest snap of the same kind and zoom; a hinted scan rerun without the hint only when it spoiled it (< 5 clean pieces), sharing the scale pre-pass; the finished check before any retry, none on a finished puzzle; loose pieces beside a finished puzzle counted (FinishedCheck.loose) at the grid's own scale; a finished count that doesn't match the project grid saves and marks nothing (Scan.tsx gridMatches). Scan screen: the result note in the panel with a height budget, More ▾ and a sheet, needs-room (coin choice hidden, compact gauge while auto-off, portrait only) only for a note that doesn't fit; the reader started when Scan opens (no warm-up scan: it slowed the first photo). Puzzle page: one placement run per puzzle at a time; status counts by index; the bin's size in its own settings row with a key-only check (BinCheck); pieces read once on open and per ✓ Fits; the panel scrolled in a layout effect only when its head is out of view; setupSteps() (4 without markers). Speed: classify/explainShadows/peelRegions typed loops, one shrink per estimatePxPerMm; placement per-turn pixel lists and top-48 selection; planMerge cheap gates and O(1) pairs; trays read only the pieces needed, time-sliced. The darker-cloth advice withdrawn (never tested; synthetic: worse) | Golden harness, 150 outputs (41 owner photos × first/next/placed/stale scenarios): 146 identical, 4 intended (IMG_9226/9227 stale recoveries); 22 batch catalogs identical; per-photo time median 0.81 × (quiet, back to back, twice; total 609 → 485 s). Placement 3.3 × (Node), 5.7–6.3 × (WebKit), identical spots. New batch 1.8–2.6 s → < 1 ms. Trays 0.5 s → 50–74 ms. Early reader start only 0.1–0.6 s (REPORT's 2.5–3 s was overstated). Review: 12 lenses, skeptics per finding, 7 confirmed, critic: nothing new. Fixed: the note squeezed upright and clipped sideways, the panel jump, the loose line missing at a stale scale, the bin's size row stale after the older app. Kept: the no-hint rerun's extra cost on unusable photos (2 findings): every gate measured lost real recoveries (shot-9294 at 1.15×, shot-9273 at 1.28×), now pinned by a real-photo test. Refuted: the Test tab's size, memory kept after a finished photo, placement 6–17 % slower with one open corner. Left: IMG_9245 stale-placed still unplaced; loose count rough (IMG_9244 16 vs 14 by eye); frameAnalyser gauge "406 cm"; PS-9 reader restart |
| 2026-11-10 | **M8 part 3 follow-up: IMG_9127's 44 pieces; outlines found only in part.** Checked on 1:1 crops: about 60 loose pieces (not ~95), all inside an outline (27 single, ≈ 29 in 15 outlines of touching pieces, 1 pale piece in part). New rule (src/cv/scanMarkerless.ts PART_OUTLINE): a single piece under 0.6 × the median single piece of the photo is marked `weak` + `part`; its shape isn't trusted (sides unread, group "not sure"), its picture still is; the scan note says so | Owner's 20 photos: no whole piece marked (whole ≥ 0.73); marked IMG_9127 1, IMG_9245 2, and 16 false pieces inside assembled areas. Synthetic: 12 of 2639 singles marked, none whole. Partial outlines at 0.7–0.8 stay unmarked (too close to whole pieces) |
| 2026-11-10 | **M8 part 3: speed, battery, memory.** (1) The texture check's two levels (the table's lower quartile, the piece's median) by quickselect instead of sorting every pixel (identical values): 90 % of the outline time. (2) A scale hint: the newest photo of the batch at the same zoom (its px/mm × this photo's size / its size) starts detection, skipping the second detection the nominal guess needed (your 18 MP photos are at 8–14 px/mm against a guess of 5.7); checked against the pieces like the guess. (3) Live view idle: when the table stays within 0.4 % of the frame of where it was for 1 s, 8 frames a second (worker and main-thread paths); stillness is measured against where it began (the full re-match lands ~4.4 px off every 6th frame). (4) Each scan step timed (`find.*`, outline sub-steps). | Your photos (Mac, Node): IMG_9127 11.5 → 7.2 s, next photo 1.9 s; IMG_9276 7.2 → 4.9 s / 1.6 s; IMG_9263 7.4 → 4.4 s / 1.6 s; IMG_9280 (holes) 5.5 s (no gain: the finished-puzzle route); same pieces found (± 1 with the hint). OpenCV memory 102 MB after the first photo, then flat. Live view held still: 25 → 7 frames/s, moving 25/s. Remaining: shrinking the 18 MP photo (~0.45 s per detection) and classification (~0.5–0.8 s) |
| 2026-11-10 | **M8 part 1: learned colour transform** (src/cv/colourFit.ts; RESEARCH §9.5 step 3). Samples: pieces in the puzzle at a known spot (placedAt col ≥ 0, not "It's in the puzzle"), 4 × 4 blocks of each patch's core (≥ half covered) turned as it sits, against the box picture's blocks. Fit: Lab affine on top of the current match, ridge 3 per pair towards no change (offset free), trimmed 20 % twice; composed with the match into ColourMatch.affine. Used when the median block ΔE on held-out pieces (3 folds by piece) is < 0.85 × the current match's. Learned from ≥ 12 pieces, again after every 10 more, whole picture only (among empty spots the colours come from the spots); all pieces placed again; stored in the placement cache (and backups); "Colours learned from your N pieces" on the puzzle page | The owner's 19 real pieces (IMG_9276, true spots known), whole picture, each placed with a transform from the other 18: first 1 → 6, top 5 3 → 9; held-out ΔE 12.7 → ~7.3. Tried: no pull (1 → 5 real, val300 80.5 → 78.7 %), per-channel only (real 1 → 4, val300 75.9 %), pulls 0.1–1 (real 1 → 5, val300 78.8–79.4 %). Synthetic, 30 confirmed pieces, reported on the others: val48 70.9 → 74.2 %, val300 80.5 → 79.3 %; held-back test48 67.0 → 65.9 %, test300 85.4 → 84.8 % (about neutral: their box pictures differ from the pieces by a global cast the one-time match already undoes) |
| 2026-11-10 | **M7 part 4: placed without tapping each, and the 1000-piece run.** (1) A new photo of the puzzle with empty spots: after its placements, spots of the old photo not empty any more were filled; the piece the old one-per-spot pairing had there (Strong / Likely, still on the table, in a tray or to check) is marked placed (by: 'photo'), with a note and Undo. (2) A photo with no empty spots: every old empty spot filled, the same marking done on the scan screen; Project.finishedAt makes Progress count all cells. (3) "It's in the puzzle" for a piece without a sure spot: placed with no spot (−1, −1). (4) Fixed: a photo that can't be matched to the catalog kept no assembled areas, so a puzzle photo taken after loose pieces were scanned was never read as one; now its areas stay (in its own frame). (5) test/unit/cv-run-1000.test.ts: val1000 in 4 batches (overview + 4 close-ups each, marker-free), whole-picture placement, a simulated owner answering truthfully up to 5 tries, new batches setting leftovers aside, then the end game among the empty spots | val1000 puzzle 1: 20 photos all placed, 5.3 s per photo (Mac); 972 of 988 read, 1 counted twice, 0 mixed up; first try 75.3 %, within 5 tries 78.4 % (762 in after the batches); end game: 246 empty spots, 145 pieces left, 86 in after 5 rounds: 848 of 1008 (84.1 %). The rest: pieces never read (16), read without a straightened picture, or not placed in 5 tries. Owner's photos in the app: holes IMG_9280, pieces IMG_9276, then the finished IMG_9272: "All 21 empty spots are filled now", 17 pieces counted in, Progress 1008 of 1008 |
| 2026-11-09 | **M7 part 3: full backup with reminders.** Backup format 2: settings also hold the placement cache (copies: keyed by the copy's box blob and piece ids) and the scan bin (copies: new piece / photo / blob ids); version 1 files still import. Pieces to check keep their candidates (remapped). Reminder (src/project/backupReminder.ts): never backed up once ≥ 20 pieces are read; else when anything changed since (pieces' updatedAt, answers' times) and the backup is ≥ 3 days old or ≥ 100 things changed; "Not now" = 24 h; a backup counts once shared or downloaded (Project.lastBackup) | Owner's request in the brief (backups, never lose the puzzle). Measured: 1000-piece puzzle (thumbnails, patches, placements, answers, 10 × 4 MB photos) backup 1.9 s / 56.7 MB, import 2.2 s (Mac, WebKit). The owner's Kiss puzzle in the app: 2.5 MB in 0.2 s; deleted and restored: the same spots without placing again, the fitted piece kept |
| 2026-11-09 | **M7 part 2: progress page** (`#/progress/<id>`, src/project/progress.ts puzzleProgress). In the puzzle: with a puzzle photo, every spot but its empty ones plus those filled since (answers / placed pieces); without, the pieces answered "Fits". Per spot: in (bright), its piece known (a waiting piece on the table, in a tray or to check has it as a Strong / Likely spot: yellow dot), still to find (dark). Still to find is exact among a photo's empty spots, an estimate on the whole picture (cells − in − read, marked ≈). Pieces by status and tray, shape groups of the pieces not in yet, first-choice and pair accuracy, batch | Owner's Kiss photos in the app (box shot-9294, holes IMG_9280, pieces IMG_9276): 987 of 1008 in, 21 empty spots, 17 with their piece on the table, 4 to find (truth: 2 holes have no loose piece) |
| 2026-11-09 | **M7 part 1: batches.** Project.batch {n, startedAt}; "Start a new batch" sets table / pending / missing pieces to the new status 'aside' (kept, not on the table, not placed, not matched), trays and placed pieces stay; photos before startedAt are left out of the live view's references, the scan's coverage map and the table photo; the next photo has an empty registration catalog, so it starts a fresh table. Set-aside pieces are not re-identified by picture (BATCH.asideCost −1); pieces to check never list them | Measured before choosing (R§8): synthetic val300 new batches (100 new + 50 returning, 150 set aside): picture matching recognised ≤ 42 % of returning pieces and merged 3.5–8.7 % of new ones wrongly at any limit; with the M5 rules 81 % of new pieces became "to check". The owner's same 21 pieces re-spread (IMG_9274–9277): 126–202 of 252 recognised at cost 12–20 (0–4 wrong), but no new pieces in those photos to test wrong merges. The app recommends keeping leftovers on the table (position-based rescans, M5 part 3) |
| 2026-11-09 | **M6: box-led piece-to-piece matching** (the go/no-go on the owner's 21 pieces: shape alone first 0 of 48 sides, median rank 19; seam colours 4 of 48, median 9: no-go). Partners from the placements: P(B on A's side e) = Σ_c p_A(c) · q_B(c + e), spot shares capped at one, the rest "not scanned yet", plus edge, "joins the puzzle" and "not sure" (src/project/pairs.ts). Shape (both sides read ≥ 0.6) rules pairs out on the whole picture only. Chances shown as computed (no synthetic lift). Squares of 4 from pairs ≥ 50 % (whole) / ≥ 70 % (empty spots). Pair answers (Project.pairAnswers) hide answered pairs and feed the 📊 page. Live view: lines for the 6 likeliest pairs | Real (21 pieces among the 21 holes): true partner first 36 of 48 sides (75 %), median rank 1; pairs ≥ 50 % right 15 of 15; 3 squares, all right; in the app the first suggestion a right square (98 %). Synthetic held-back test48: first 88.5 % (whole; 95 % range from 86.7 %) / 95.3 % (empty spots); squares' pairs right 99.5 % / 99.5 %. Held-back test300 (300-piece batches): 83.3 % (from 82.1 %) / 86.0 % (from 84.9 %); pairs ≥ 50 % right 99.7 % / 98.9 %; squares' pairs 362 / 492, all right. (Tuning set val300: 74.6 % / 77.4 %.) 1000-piece tier not measured. Tried and dropped: the veto among empty spots (real 36 → 33 of 48), a synthetic chance lift (real pairs shown ≥ 50 %: 18 of 22 right), shape as a × 2 tie-breaker (no gain) |
| 2026-11-09 | **M5 part 4: live prediction, presence, scan mode.** Prediction (src/app/livePredict.ts): 4 table points (the frame's corners 15 % in, kept while in view) followed in frame px; velocity from the last two fixes (frame clock; arrival times when the frame clock doesn't advance), extrapolated by (now − arrival + processing) ≤ 120 ms when faster than 0.02 px/ms, else eased 30 % per refresh. Presence (src/cv/presence.ts): every 4th fix, per piece |median grey inside − median 3 mm outside| + spread inside, against the same in the reference photos; gone < 0.4 ×, there ≥ 0.6 ×, unknown below 14 grey levels in the reference; shown gone after 3 of the last 4 checks. Weak fixes drawn dashed. Scan mode setting (full / quick). Tracker skips frames while preparing references | Simulated pan (WebKit, steady 150 px/s + 0.12 rad/s): synthetic 1.0 → 0.1 screen px median, the owner's IMG_9275 2.5 → 0.5 px (p90 5.2 → 2.4). Presence on the owner's IMG_9274/9275/9277: 21 there, 0 gone, 1 unknown; IMG_9276 with 3 moved digitally: exactly 3 gone. Synthetic live view with 4 pieces taken away: "4 not where they were" |
| 2026-11-09 | **M5 part 3: re-identification on rescans.** Same place: outline overlap ≥ 0.6 of the smaller outline also matches (partial / shadowed sightings); a sharper photo never replaces a whole outline by a part. A clump covering known pieces' centres stands for them; a fragment overlapping a piece matched in the photo (≥ 0.5 of its own area) is dropped. Fingerprints (src/cv/fingerprint.ts; 4 × 4 Lab grid + 8 × 8 brightness z-scores, 4 turns, side shapes) kept with each patch. Moved: candidates = known pieces not matched at their spot (table, pending, missing; spot in view or not); cost = fingerprint + 6 × outline distance ≤ 14 (spot still covered) / 24 (spot empty, missing or out of view); greedy by cost, accepted when the next choice on either side costs ≥ 1.35 × + 3. Unsure → 'pending' with up to 3 candidates; settled by a later scan (candidate seen elsewhere → new; clear best, or its spot seen empty → merged) or by the owner ("Pieces to check"). Same spot refused when fingerprint > 20 and outline > 1.1 mm. The chosen coin is looked for in every photo | Stress test (5 rescans, 20 % moved, 10 % away and back, camera and light changes), old → new: val48 duplicates 55 → 28 (+25 pending, the true piece among those offered for 23), wrong merges 1.15 → 0.98 %; val300 duplicates 108 → 30 (+110 pending, 64), wrong merges 4.71 → 2.70 %. Targets (0, ≤ 0.5 %) not reached. Without moves: duplicates val48 6 → 0, val300 13 → 0 (false missing 4 → 1). Tried and dropped: ignoring rivals that clearly belong elsewhere (val48 duplicates 51, wrong merges 1.56 %), checking same-spot matches against the photo's other sightings (val300 duplicates 44, wrong merges 2.86 %). Owner's photos: IMG_9274–9277 rescans add nothing twice; IMG_9276 with 3 pieces moved digitally: 3/3 recognised |
| 2026-11-09 | **M5 part 2b (self-tested on the owner's photos).** (1) scanMarkerless: when clumps + regions ≥ 6 and > 1.5 × the clean single pieces, the scale-robust pre-pass (estimatePxPerMm) is asked; its scale is kept when it is > 1.3 × the current one and gives > 1.5 × the single pieces. (2) Among empty spots, a piece whose offered spots are all ruled out is offered the other empty spots (equal chances, "several"). (3) "Not a puzzle piece": deletes the row, its answers undone. (4) The pieces in the puzzle listed with Take it out. | IMG_9277 (≈3× closer): 3.7 → 11.5 px/mm (coin 11.2), 12 → 21 clean pieces; all other real photos unchanged (same scale and counts); synthetic val48/val300 scan accuracy compared before/after. Simulated owner on the real 21 pieces × 21 holes: 18/19 first try, 19/19 placed with (2); live view on IMG_9274–9277 (12 pairs): worst 1.8 mm |
| 2026-11-09 | **M5 part 2: Fits / Doesn't fit.** Answers kept on the puzzle (Project.answers: piece, spot, turn, fits, grid, and what the app said: verdict, the spot's chance, its rank). Fits → status 'placed' with placedAt (from table / tray, for Undo); its spot is taken. Doesn't fit → spot ruled out for that piece; whole picture: remaining chances divided by (1 − ruled-out mass), verdict from the new first chance (PLACE.strongP / likelyP); empty spots: left out of the one-piece-per-spot pairing. Placed pieces' sides (read with ≥ 0.6 sureness, ×0.6 when the read isn't trusted) set the facing side of neighbouring holes (opposite knob), or drop whole-picture spots whose own sure knob would meet the same kind. Accuracy: first choice (rank 0) right by verdict with a Wilson 95 % range, by bands of the shown chance, tries per placed piece; undone answers left out | Plan §6 M5; the owner's answers become the real-photo accuracy measure (the synthetic sets can't tell how a lamp-lit, glossy real piece behaves) |
| 2026-11-09 | **M5 part 1b: guided matching.** After the first RANSAC fit, each frame feature is matched only against reference features projected within 24 px, then 8 px (Hamming ≤ 64 bits, local ratio 0.85), refitted (RANSAC 3 px) while the inliers grow; flow follows the final inliers | Owner's photos: IMG_9263 → 9264 worst 0.42 → 0.32 mm (716 points); IMG_9272 → 9280 holes median 21 → 5 mm, worst 46 → 8 mm; IMG_9225/9226 88/39 → 250/151 points; IMG_9227 (very steep) still not found. Simulated phone over IMG_9276: median 0.3 mm, 95 % 1.3–1.5 mm; over IMG_9280 (repeating seams): median ~0.8 mm but some frames 3–6 cm off. Stricter guided settings, narrower radii, 2,000 features and stricter flow tried: no clear gain (2,000 features halves the bad frames over the finished puzzle at 2× the time) |
| 2026-11-09 | **🧪 Test tab** (owner's request): docs/TEST-NOW.md is built into the app and shown from a tab on every screen, with tick boxes kept on the phone (reset when the steps change) and a dot for unopened steps. The same text is what I send in the chat | The owner tests on the iPhone without switching to Claude |
| 2026-11-09 | **M4 part 7: box setup checks.** Border question after straightening (exact / frame → corners inside it / differs / not sure, kept on the box). Table contrast: the table's colour (median of the colours measured around pieces) moved into the box picture's colours with a whole-picture match from the pieces' patches (≥ 15 pieces), spots with ≥ 50 % of pixels within ΔE 14; warning from 2 % of the picture. Box-to-grid correction: placements report their fine offset (±0.19 of a spot); per axis a robust line fit (RANSAC over pairs, inliers within 0.06, ≥ 15 Strong pieces spread over ≥ 40 % of the picture) of offset vs spot centre gives the box grid as a·x + b; offered when the edges are off by ≥ 0.1 of a spot; applied by straightening the box photo again with the corrected corners | Synthetic val300 (box picture made too big / too small, scanned end to end): fits 82.8 %; 1 % too big 74.3 → 82.3 %; 2 % 50.9 → 82.1 %; 1.5 % too small → 80.2 % (a found 1.031 for 1.030); on fitting box pictures the fit stays within 0.015 of a spot (never offered). Real: the owner's box fits within 0.15 of a spot (not offered); contrast 1.4 % (lace sleeve, collar) |
| 2026-11-08 | **M3 part 2:** after the scale is settled, a clump ≤ 1.6 × a piece's area that reads as one clean piece (trusted, sides 0.75–1.25 × a piece side, knobs < 0.55 × side) is one piece; size check in shape reading allows the traced face to be 84–103 % of the cell; trust = least sure flat/not-flat call | Owner's IMG_9276: 4 long-knob single pieces were clumps. Doing it inside the piece finder broke IMG_9245's close-up scale check, so it runs after. Traced val48: trusted 97 % (overview) / 98 % (close-up), right 96.7 / 97.0 %; real IMG_9263/9264: 26 inside pieces, 0 border, 0 not sure. Accuracy sets unchanged except val48 duplicates 6 → 7 of 482 |
| 2026-11-08 | **M3 shape reading:** corners = the 4 sharp outward turns (±1.5 mm) that best form the cell rectangle with straight shoulders; each side decided in its middle third (tab ≥ 13.5 % of the side outwards, blank ≥ 3.2 % inwards, flat otherwise); trusted when every side ≥ 0.5 sure and the rectangle fits | Traced val48 outlines: flat sides never dip inwards in the middle (99 % < 0.9 mm) but bulge out ≤ 1 mm (wall/shadow); a blank partly filled by shadow still dips. Piece type right 95.7 % (overview) / 96.1 % (2× close-up); 87–95 % trusted, 97 % of those right. Treating shadow as table in the per-piece closing was tried and dropped: recall fell 95.6 → 89.2 % (dark print looks like shadow) |
| 2026-11-08 | **Finished-puzzle check:** the largest assembled area (≥ 20 % of the photo) → corners (box-picture finder when it agrees, else the area's outline snapped to the photo's edges) → straightened → rows/columns from the seams' repeat length (searched near the size the box's piece count implies, refined over many pieces) → gaps = cells whose middle is table-coloured (ΔE < 12) and plain (σ < 5) | Owner's request. IMG_9272: 28 × 36, no gaps; one piece removed digitally: exactly that gap. Reported only when the count is within 6 % of the box and ≤ 10 % of cells look empty; the photo is not catalogued |
| 2026-11-08 | **Shape-only partner ranking (synthetic, M3 test):** side profiles (48 points), the other side turned round and rigidly fitted, mean distance | 28 × 36 generator puzzle, all blanks as candidates: close-up quality top-1 37 %, top-5 63 %; overview 7 % / 19 %. Generator knobs are deliberately alike (wrong blanks within 0.1–0.2 mm), so the real-piece go/no-go decides; shape alone from overviews is not enough |
| 2026-11-08 | **Table region is convex where it must be:** non-table areas inside the convex hull of the table area join it when their open sides (photo edge, hull chord) are ≤ 0.3 × their border with the table; a pale (weak) blob is dropped when ≥ 50 % of a ring half a piece side outside its box is an assembled area | Owner's finished puzzle IMG_9272 nearly touches the photo's edge: ~30 % of it was taken as off the table and 3 bits were listed as pieces. Now one assembled area (> 95 % of the puzzle), no pieces on it. That photo's ratio is 0.2; bays and floor on all other real photos ≥ 0.4; the gap rule removes nothing on them |
| 2026-11-08 | **Phone held very close:** when the scale pre-pass finds fewer than 8 piece-sized blobs from the usual first guess (4 px/mm at 1×), it starts again from 2.4× and 5.5× that guess and keeps the start that finds the most | Owner's overview taken ~3× closer (≈12 px/mm): every piece was 9× the expected area, none counted, so pieces became "objects", the coin was searched at the wrong size and 8 shadows/fragments were catalogued. Now 19+ single pieces and the coin found; earlier real photos unchanged |
| 2026-11-08 | **Moved pieces (first re-identification, ahead of M5):** planMerge gets the photo's view; known pieces whose spot is inside it (≥ 0.8 × size from the edge) and not covered by a clump/weak/cut/position-matched blob have left; unmatched found pieces are compared with those and with missing pieces by a 72-angle outline-radius signature at the best rotation (≤ 0.6 mm mean), area (20 %), colour (ΔE 12) and an unambiguity margin (1.35); unmatched leavers become "missing" only when clear and the photo is ≥ 0.85 × as sharp as their best | Owner: a piece moved a little counted as new (23 pieces → 30). Synthetic val48/val300 with no movement: 0 false moved, 3/1193 false missing; registration, errors and duplicates unchanged |
| 2026-11-08 | **Scan bin:** "Delete scanned pieces" moves all pieces and overview/close-up records (with the measured pitch and scale source) into one per-puzzle bin (settings row); photos and thumbnails stay stored; "Restore" puts them back, swapping with a newer scan if there is one; deleting again frees the older bin's pictures; deleting the puzzle deletes the bin. Not in backups | Owner's request: delete the scanned pieces, restore them, and rescan. Marker-free scans can't be merged (each first photo defines its own frame), hence swap rather than merge |
| 2026-11-07 | **Lit sides of glossy pieces:** shadow-like pixels next to print (≤ 3 mm, breadth-first) join the piece when off the table's colour (≥ max(0.03, 3 × the table's colour noise)) in the same colour direction as the print beside them (cos ≥ 0.9); not on grainy surfaces. Object aspect gate 1.9 → 2.3 | Owner's 26-piece photos IMG_9263/9264 with a 2-denar coin: outlines were bitten on the lamp side; now 26 found and scale within 1.5 % of the coin. IMG_9224's estimate moved 3.46 → 3.15 (its truth is a range, 3.1–4.0) |
| 2026-11-07 | Coin finding also by colour (brass vs table chromaticity) and roundness from the convex hull; rim = outermost strong brightness-or-colour edge per ray | Owner's shiny 2-denar coin was as bright as the cream table and touched a damp mark (screenshot IMG_9262) |
| 2026-11-07 | Optional coin for true size (Macedonian denari): found as a round coin-sized blob, measured along 72 rays at the steepest edge (the lower 30 % of radii, so a contact shadow can't enlarge it); rescales the catalog from the typical-piece estimate to real mm | The owner has no printer; a coin is always at hand. Tests: within 0.6–0.7 % |

---

## 12. Questions for you (please answer with your OK)

1. ~~**Name**~~ → answered 2026-11-04: **Puzzle Lens**, at https://zivkogodzirov.github.io/puzzle-lens/
2. ~~**Your iPhone**~~ → answered: an iPhone **Pro** (48 MP main camera, true optical 2× confirmed). **No stand**: the app is used handheld (2026-11-06).
3. ~~**Your puzzle**~~ → answered: Ravensburger, 1000 pieces, *The Kiss* (Hayez), portrait. The box is a little bigger than A4; the finished size is measured by the app (2026-11-06).
4. ~~**Your setup**~~ → answered 2026-11-06: **no mat**, a very large white glossy table that fits the whole finished puzzle, and **an A4 printer**.
5. ~~**GitHub**~~ → answered 2026-11-04: use the Mac's account `zivkogodzirov`, public repository `puzzle-lens`; real photos stay out of it.