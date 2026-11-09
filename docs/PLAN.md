# Puzzle Lens: plan and status

_Last updated: 2026-11-06. M1 is checked on your iPhone. M2 (set-up wizard, markers, piece finding, catalog) is built and tested on the Mac and waits for your iPhone check (`docs/M2-CHECKLIST.md`). Setup: phone held by hand, no mat, a large white glossy table, and **no printed markers** (the pieces themselves are the reference; markers optional)._

| Milestone | Status |
|---|---|
| M0 Research and plan | ✅ Approved 2026-11-04 |
| M1 Skeleton on your phone | ✅ Checked on your iPhone 2026-11-06 (Safari tab + Home Screen app); waiting for your OK to start M2 |
| M2 Detection and catalog (no markers needed) | 🔧 Built and tested on the Mac; **waiting for your iPhone check** (`docs/M2-CHECKLIST.md`) |
| M3 Shape reading and Border groups | 🔧 Parts 1–2 built and tested on the Mac (shape reading, Border mode, finished-puzzle check); **waiting for your iPhone check** (`docs/M3-CHECKLIST.md`) and the 7 × 7 go/no-go photos |
| M4 Box placement | 🔧 Part 1 built; part 1b fixes from your real test (pale-piece outlines, confidence fitted on real photos, finished check with pieces out); part 2: leftover pieces matched only to the empty spots of the nearly finished puzzle, one piece per spot; part 2b: the holes photo is recognised on close-ups too (it wasn't, so your test stayed on the whole picture); tested in the app with your photos: 8 Strong, all right; part 3: knob shapes (holes' outlines + pieces' sides, interlocking neighbours): in the app 17 Strong, all right. Real: whole picture 5 of 21 first; among your 21 holes about 14 of 19 real pieces right, 9 Strong all right. Parts 2, 2b and 3 ✅ checked on your iPhone 2026-11-09 (the top-right wall pieces land in their holes). Part 4: **trays by colour** (zones measured first and were too unreliable on your real pieces: right zone 60 % for finished-puzzle spots, 8 of 19 loose pieces; the AI picture model was no help either), tested in the app with your photos; **waiting for your iPhone check** (`docs/M4-CHECKLIST.md`, Part H). Still open: Fill this spot, green outlines, box setup questions |
| M5 Live tracking and re-identification | ⏳ |
| M6 Piece-to-piece matching | ⏳ |
| M7 Batch workflow | ⏳ |
| M8 Tuning on your real puzzle | ⏳ |

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
- **Box setup:**
  - border question (the box photo itself is taken in the M2 wizard)
  - table-contrast check
  - box-to-grid correction after the first batch
- **Placement:**
  - colour calibration v1 (grey-patch white balance; one-time statistics match)
  - placement pipeline (CPU) with top-5 probabilities and verdicts
  - one-piece-per-cell assignment (✅ part 2, among the empty spots of a nearly finished puzzle)
  - leftover pieces matched only to the empty spots from a finished-puzzle photo (✅ part 2)
  - green "spot known" outlines; progress "placed on box"
  - border-side labels (top / bottom / left / right)
- **Groups and tools:**
  - ~~**Zones:** A–F, adjustable 2–12.~~ Replaced by colour groups (part 4): zones need each piece's spot, too unreliable on real loose pieces (RESEARCH §9).
  - **Trays** (✅ part 4, by colour): pick a colour group, its pieces light up on your table photo, tap "These went into tray C" to set their status, and print tray labels.
  - Area search, Fill this spot, Colour families, Box view.
- ~~**Embedding benchmark**~~ (✅ measured part 4: DINOv2-small far worse than the current method on real spots, 0.4 % vs 26 % first; not added, RESEARCH §12).
- **WebGPU accelerator,** only if the full-rescore budget is missed on your phone.
- **Tests:** placement top-1 and top-5 for detailed, plain and all cells; Strong-verdict precision and share; calibration.
- **From you:** pieces whose suggested spot was wrong (photo + where they really go).

### M5: Live tracking and re-identification
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

### M7: Batch workflow
- **Marking placed:** tap "Placed" first; then optional reading of the assembly board with a second marker set. Placed neighbours constrain placement and Fill-this-spot.
- **Progress dashboard.**
- **Full backup:** export and import, with reminders.
- **Multi-batch sessions.**
- **Tests:** backup round trip; backup timing on a 1000-piece project; multi-batch re-identification; the 1000-piece synthetic run end to end.

### M8: Tuning on your real puzzle
- Refit thresholds, weights and probability calibration from your photos and answers (on a held-back part, so the reported accuracy stays honest).
- Learned colour transform.
- Speed, battery and memory optimisation (WebGPU where it pays).

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
| Backup / report preparation for a 1000-piece project | measured in M7; shared only once prepared |

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