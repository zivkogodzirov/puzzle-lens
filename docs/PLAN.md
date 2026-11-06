# Puzzle Lens: plan and status

_Last updated: 2026-11-04. M1 is built, reviewed (53 confirmed findings fixed) and passes every automated test on the Mac. It still has to be checked on your iPhone._

| Milestone | Status |
|---|---|
| M0 Research and plan | ✅ Approved 2026-11-04 |
| M1 Skeleton on your phone | 🔧 Built and tested on the Mac; **waiting for your iPhone check** (see the checklist) |
| M2 Detection, markers and catalog | ⏳ |
| M3 Shape reading and Border groups | ⏳ |
| M4 Box placement | ⏳ |
| M5 Live tracking and re-identification | ⏳ |
| M6 Piece-to-piece matching | ⏳ |
| M7 Batch workflow | ⏳ |
| M8 Tuning on your real puzzle | ⏳ |

The reasons behind every choice are in [`RESEARCH.md`](RESEARCH.md); section numbers like "R§4" point there. Your original brief is kept in [`BRIEF.md`](BRIEF.md).

---

## 1. What we're building (plain English)

**How a session goes:**
1. You spread 200–300 pieces face up on a dark mat with 8 printed markers around it.
2. With the phone on a stand (or held flat), you take **one overview photo**, then **about 4 closer photos**. The app shows which parts of the table still need one.
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
| Mat | Plain, matte and dark (e.g. dark felt or a puzzle mat), about **16 cm larger than your sorting area on each side** (≈ 85 × 65 cm for a 70 × 50 cm area of 300 pieces). If your picture has lots of dark areas, the app may suggest a mid-tone coloured mat. | The app finds pieces as "not mat"; the markers sit in the margin. Glossy surfaces cause glare. |
| Markers | **8 markers** on 2 A4 sheets the app prints, placed in the mat margin: one at each corner and one at the middle of each side of the sorting area. Each sheet has a 100 mm check bar and a grey patch. Print at 100% ("actual size"), on matte paper. | The phone always knows where it is, in millimetres. The bar catches printer rescaling; the grey patch sets colour and exposure (R§5). |
| Pieces | Face up, small gaps between them, not touching. | Touching pieces get an orange dashed outline and "spread these apart". |
| Light | Even, diffuse light, e.g. a lamp bounced off a wall or ceiling. Avoid a single hard lamp. Phone torch optional. | The app warns about glare and hard shadows. |
| Phone | **Ideally an overhead phone stand that holds the phone ~60 cm above the table** (adjustable 50–70 cm; about A$25–40). Overview photo at 1×; close-ups at 2× from the same height, *if* your phone passes the 2× sharpness test in M1. Otherwise close-ups are taken at 1× from ~30 cm. Without a stand: hold the phone flat and follow the tilt/distance gauge. | Straight-down photos and a narrow view keep piece outlines accurate (R§4). The app works out the ideal height from your measured piece size. |

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
- **Table (mm):** fixed to the mat, origin at marker 0. Every piece position is stored here, so highlights stay pinned when the phone moves.
- **Piece (canonical):** the piece's 4 corners mapped onto a square. Removes rotation, scale and perspective; used for fingerprints and placement.
- **Box grid:** (column, row, rotation 0/90/180/270), plus a fitted box-to-grid correction (R§9).
- **Mapping:** a homography H links table and image for each frame or photo. It comes from markers, plus known pieces when few markers are visible.

### 3.3 Pipeline summary (detail in RESEARCH)

| Stage | Method | Where | Budget (iPhone) |
|---|---|---|---|
| Markers → table mapping | ArUco DICT_4X4_50, sub-pixel corners, RANSAC homography, moved-marker check; LK optical flow between detections; registration from catalogued pieces when markers are few | tracker | ≤ 25 ms per frame, ≤ 750 ms per second |
| Live overlay | Catalogued outlines (stored in mm) drawn through the latest timestamped H, predicted forward to the displayed frame | main | ≥ 30 fps, ≤ 8 ms per draw |
| Change detection | Downscaled segmentation vs expected occupancy (pieces "in tray" or "placed" are expected to be gone) | reader, when idle | 1–2 per second |
| Photo quality gate | Marker-edge sharpness, clipped-pixel share, tilt from H (≤ 5° for detail photos) → "please retake" | reader | ≤ 100 ms |
| Segmentation | Mat model + per-photo lighting field + shadow-aware distance, hysteresis, morphology, marker masking, size gate in mm², watershed only for flagged blobs, sub-pixel outline, **print vs wall separation** for detail reads (R§4, R§6) | reader | overview of 300 pieces ≤ 8 s; detail ≤ 6 s |
| Shape reading | Hybrid corner search (curvature + centroid candidates, 4-subset score with straight shoulders and expected cell size in mm), line-fit refinement, flat/tab/blank with an uncertain band; overview reads only provisional (R§7) | reader | ≤ 15 ms per piece |
| Fingerprint and re-ID | Canonical Lab thumbnail ZNCC at 4 rotations + side-type word + side profiles in mm + colour stats; union shortlist; ratio test; pending + "close-up please"; one-to-one per photo (R§8) | reader | ≤ 20 ms per piece |
| Box placement | Canonical piece vs grid at 8/16/32 px per cell, 4 rotations, texture-gated ZNCC + gradient cues, border and neighbour constraints, calibrated softmax, assignment + Sinkhorn, box-to-grid correction (R§9) | reader / matcher | ≤ 50 ms per piece (CPU); full re-score of 1000 ≤ 30 s, resumable |
| Pair matching | Tab↔blank, length ±8%, box-neighbour prior, Procrustes/ICP shape residual on top-face outlines, seam colour agreement, logistic calibration, 2×2 confirmation (R§11) | matcher | ≤ 100 ms per new piece |

---

## 4. Data model (IndexedDB via Dexie, versioned)

| Table | Key fields |
|---|---|
| `projects` | id, name, created/updated, nominal piece count, grid {cols, rows}, finished size (mm), box {photo blob, 4 corners, rectified blob, px per cell, picture-border answer, box-to-grid correction}, zone layout {count 2–12, cell→zone}, colour calibration {white balance, 3×3+offset transform}, markers {dictionary, size mm, print-scale factor, id→position on the table}, mat model {Lab stats, spatial map}, settings (units, scan mode, thresholds) |
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
| **New puzzle wizard** | 0. Home Screen check (first!) → 1. piece count + finished size from the box → 2. grid suggestion / manual entry → 3. print markers (check 100 mm bar) → 4. lay out mat + markers, empty-mat calibration + marker map photo → 5. box picture (photo or import from Photos), corners with magnifier, "does the picture have a border or continue past the edges?" → mat-contrast check | M2 (steps 0–4), M4 (step 5) |
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
- **Wizard steps 0–4:** Home Screen check, count + finished size, grid suggestion / manual entry, marker printing with scale check, empty-mat calibration + marker map.
- **Table mapping** for every photo (markers + piece-based registration).
- **Segmentation:** lighting flattening, shadow handling, clump warnings, sub-pixel outlines, marker masking; glare / hard-shadow warnings; the photo quality gate.
- **Guidance:** distance and tilt from measured piece size, markers and the tilt sensor.
- **Catalog:**
  - Overview Snap fills it (positions, thumbnails, colours).
  - Coverage map for the detail Snaps.
  - Progress counter "pieces read".
  - Grey "detected" outlines on the photo/live view.
- **Minimal export/import** of a project.
- **Synthetic puzzle generator v1** (R§16); frozen validation and test sets at 48 / 300 / 1000 pieces.
- **Tests:** segmentation (per piece); position accuracy in mm; lens-distortion check (detail tiles vs overview); tiling memory; database upgrade.
- **ML segmentation trigger** (R§6): if your real photos give per-piece recall < 98%, or > 5% clumps after spreading, I benchmark the ML segmenters.
- **From you:** print the markers; photos of ~50 pieces on your mat (overview + close-ups); any photo where pieces were missed.

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
  - wizard step 5: box photo or import, corners with loupe, border question
  - mat-contrast check
  - box-to-grid correction after the first batch
- **Placement:**
  - colour calibration v1 (grey-patch white balance; one-time statistics match)
  - placement pipeline (CPU) with top-5 probabilities and verdicts
  - one-piece-per-cell assignment
  - green "spot known" outlines; progress "placed on box"
  - border-side labels (top / bottom / left / right)
- **Groups and tools:**
  - **Zones:** A–F, adjustable 2–12.
  - **Trays:** pick a zone, its pieces light up, tap "These went into tray C" to set their status, and print tray labels.
  - Area search, Fill this spot, Colour families, Box view.
- **Embedding benchmark** (none vs DINOv2-small vs DINOv3-S): kept only if it improves top-1 or top-5.
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
| Shape matching isn't discriminative at phone resolution (the biggest risk) | Close-ups at 2× from a stand; print vs wall separation; box picture as the primary signal; honest probabilities; **real-piece go/no-go in M3** with a defined fallback (box-led matching) before M6 is built |
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
| Glare, hard shadows, dark pieces on a dark mat | Matte mat, diffuse light, photo quality gate, warnings, mat-contrast check |
| Puzzle brand with uniform cuts | Shape counts for less; placement and colour still work; percentages stay honest |
| Losing a 1000-piece catalog | Home Screen install first, `persist()`, backups with reminders |

---

## 10. Known issues

**Found on your iPhone (first report, 2026-11-06, Safari tab):** every in-app photo (`takePhoto()`) failed: "Internal error" when a size was given, "setMaxPhotoDimensions failed" without one, in every format, and the 2× test too. Everything else worked (4032×3024 live at 30 fps, direct frames, 9 ms per frame, WebGPU, offline, memory headroom about 1,728 MB). Response:
- a **Photo test** (Device check step 4) that tries each possible cause on its own and remembers what works;
- Snap now falls back to the **full-size live picture** (12 MP in the 4:3 format), then to the iPhone camera screen. It is checked with exact pixel reading, but its saved JPEG goes through a canvas (it may carry Safari's tiny privacy noise, which only matters for reports).

**M1 (2026-11-04).** The items below have not been checked on an iPhone yet.

1. **The 2× lens test only shows a number for now.** It says "Measured ratio …, not judged yet". The thresholds will be set from your phone's report, because the iPhone's own sharpening could make digital zoom look sharper than it is (R§4).
2. **Marker outlines may be drawn in the wrong place when the phone is held sideways the "other" way.** Safari doesn't say which way camera frames are turned, so the app guesses from the picture's shape. The checklist asks you to look in portrait and both landscape directions.
3. **Big photos.** While a photo is checked, one full-size decoded copy is in memory (about 48 MB for 12 MP). Photos bigger than 16 MP (e.g. 48 MP from the iPhone camera screen) are checked at 12 MP size and reported with their real size. M2 decodes in tiles.
4. **The memory test result can be up to about 64 MB too low.** The last step may not be saved at the moment iOS closes the app.
5. **Not yet confirmed on the iPhone:**
   - sharing the report `.zip`, and the "Download" link in the Home Screen app;
   - which way `takePhoto()` behaves with the live camera (does it pause the camera? does it change the photo size?). The Device check measures it.
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

---

## 12. Questions for you (please answer with your OK)

1. ~~**Name**~~ → answered 2026-11-04: **Puzzle Lens**, at https://zivkogodzirov.github.io/puzzle-lens/
2. **Your iPhone:** answered: an iPhone 15/16/17 **Pro** (48 MP main camera, 24 mm lens, true 2× crop expected). Still open: do you have, or will you get, an overhead phone stand that holds the phone ~60 cm above the table (adjustable 50–70 cm)?
3. **Your puzzle:** brand, piece count, and the finished size printed on the box (e.g. 70 × 50 cm)?
4. **Your setup:** mat size and colour, table size, and do you have a printer for A4?
5. ~~**GitHub**~~ → answered 2026-11-04: use the Mac's account `zivkogodzirov`, public repository `puzzle-lens`; real photos stay out of it.