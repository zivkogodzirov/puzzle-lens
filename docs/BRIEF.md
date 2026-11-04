# Original brief (from the project owner, 2026-11-04)

_This is the requirements brief exactly as it was given. Agreed changes are recorded in `docs/PLAN.md` §11 (Decisions log) and `docs/RESEARCH.md` §17._

---

# Build "Piece Finder": an iPhone web app that helps assemble 1000+ piece jigsaw puzzles

You are building a web app that runs in Safari on my iPhone (iOS 27). I point the camera at puzzle pieces spread on my table. The app catalogs every piece, works out where each one goes on the box picture and which pieces join each other, and highlights them live on the camera view. It also sorts pieces into groups: corners, edges, zones of the picture, colours and shapes.

The open-source project "Puzzle Helper" (github.com/jellojm/puzzle-helper) is the closest existing example. Use it as inspiration, but this app must handle a full 1000+ piece puzzle worked in batches of 200–300 pieces.

---

## 1. How to work with me (read first)

- **I am not technical.** Explain everything in plain English. Whenever I need to do something (test on my phone, create an account, take photos), give me exact numbered steps.
- **Research before building.** Before you implement any major feature, research the approaches and best practices developers use for it (web search, papers, open-source projects). Write a short summary of the options, which one you picked and why, in `docs/RESEARCH.md`. Then build it.
- **Work in milestones** (section 10). At the end of each one: run the tests, deploy, give me a plain-English test checklist for my iPhone, and **wait for my feedback** before starting the next.
- **Ask me for real photos** whenever real-world data would help: the box picture, overhead shots of pieces on my mat, and any photos where the app got something wrong. Put them in `test/fixtures/real/` and add them to the automated tests.
- **Reference projects.** Study them for ideas and lessons, but write original code. Do not copy code from a repo unless its license clearly allows it. Puzzle Helper does not state a license.
  - github.com/jellojm/puzzle-helper. Read its `PLAN-hard-issues.md`: it lists real-iPhone problems (see section 3).
  - github.com/maksym-hrytsenko/puzzle-assistant (native iOS app, placement on the box picture by colour correlation).
  - github.com/kellinwood/PuzzleSolver (matching by piece-edge shape).
- **Be honest about accuracy.** Never present a guess as certain. Show confidence everywhere. For plain areas (sky, water, flat colour), show the best few candidates, not one "answer".
- Keep `docs/PLAN.md` (current plan and status), `docs/RESEARCH.md` and `CHANGELOG.md` up to date.

---

## 2. Target device and platform rules

- **iPhone, iOS 27, Safari.** It must also work when added to the Home Screen as a web app. Test both, because camera access has had Home Screen-only bugs before. Check the Safari 26 and 27 release notes for new APIs that help (camera, WebGPU, workers, storage).
- **No App Store, no backend, no accounts.** Everything runs on the phone. After the first load it works offline (service worker). Photos never leave the phone unless I export a report.
- **HTTPS is required for the camera.** Set up hosting I can reach from my phone (section 9).
- **No WebXR on iPhone Safari.** "AR" here means a canvas overlay drawn on top of the live video, pinned to the table with a homography. The table is flat, so this is all we need.
- **Feature-detect everything and build fallbacks.** Check getUserMedia max resolution and frame rate, MediaStreamTrackProcessor, ImageCapture/takePhoto, torch, focus/zoom constraints, WebGPU, OffscreenCanvas in workers, Screen Wake Lock, Web Share with files, and persistent storage. Show the results on a "Device check" screen and include them in reports.
- **iOS memory limits are strict.** Safari kills tabs that grow too large, and canvas size is capped. Never decode a 48 MP photo onto one canvas: downscale or tile it. Free every OpenCV `Mat`, every `roi()` view and every `MatVector.get()` result. Close every `ImageBitmap`/`VideoFrame`. Add a leak test that runs the live loop for 10 simulated minutes and checks memory stays flat.
- **Storage:** IndexedDB (via Dexie or idb). Call `navigator.storage.persist()`. Provide **Export backup / Import backup** (one file containing the whole puzzle project) so I never lose a 1000-piece catalog.

---

## 3. Lessons from Puzzle Helper's real-iPhone testing (design around these)

1. **Duplicate cataloguing.** One report had 566 entries for about 150 pieces. Pieces must be recognised again when re-seen, moved or brought back in a later batch (section 6.5).
2. **Colour-based masks trace only the colourful part of pale pieces**, and printed lines get read as false flat edges. Segment against a learned background model instead (section 6.3).
3. **Per-pixel JavaScript loops are very slow on the iPhone.** Do all full-frame per-pixel work in WebAssembly (OpenCV.js) or WebGPU.
4. **Glass or glossy tables cause glare.** Require a matte mat.
5. **Pieces too far away are just a few pixels.** Give live "move closer / you're tilted" guidance based on measured piece size.
6. **Relocalisation was fragile with tracking based only on landmarks.** Use printed markers (section 6.2).
7. **Lamp shadows and lighting changes broke the background model.** Flatten shadows and adapt the background over time.

---

## 4. Physical setup the app assumes (the app teaches this in a setup wizard)

- A **plain, matte mat** that contrasts with the puzzle (for example dark felt or a dark puzzle mat). Calibration step: "show me the empty mat".
- **Four printed markers** (ArUco/AprilTag style) placed at the corners of the sorting area. The app generates a printable A4 page with the markers and setup instructions. An optional second set marks the assembly board.
- **Pieces face up and not touching.** The app shows clumps it cannot separate with an orange dashed outline and says "spread these apart".
- **Even lighting.** Optional phone torch. Warn when glare or hard shadows are detected.
- **Phone held flat above the table, or on an overhead stand.** The app tells me the ideal height for my puzzle's piece size and shows a tilt/distance indicator.

---

## 5. Data model (summary; refine as needed)

- **Puzzle project:** name, nominal piece count, grid rows × cols, rectified box image, per-cell descriptors, colour calibration, zone layout, markers config, created/updated dates.
- **Piece:** id, thumbnails (top-down rectified, masked), contour in mm, 4 corner points, 4 side descriptors, side types (flat/tab/blank with confidence), piece type (corner/edge/interior), interior shape class, colour descriptors, image embedding, box placement candidates (top-5 with probabilities), partner candidates per side, groups/zone, status (on table / in tray / placed / missing), last table position (table coordinates, mm), last seen time, batch id, my confirmations or rejections.
- **Session/batch:** which pieces are currently on the table, scan history.
- **Feedback log:** every "Fits / Doesn't fit" answer I give, used for accuracy stats and tuning.

---

## 6. The detection and matching pipeline (my decisions; research the details, benchmark alternatives, change a decision only with a written reason)

### 6.1 Camera and capture: two modes
- **Live video** for finding, tracking and overlay. Request the highest stable resolution (try 4K, fall back to 1080p) and measure what iOS actually delivers.
- **Snap (full-resolution still)** for *reading* pieces (shape and print detail). Use `ImageCapture.takePhoto()` if available, otherwise `<input type="file" accept="image/*" capture="environment">`. Process large photos in tiles.
- Rule of thumb to verify: shape reading needs roughly ≥120 px across a piece. Live video of 300 pieces will usually be below that, so cataloguing comes from Snaps or close-up live frames, and the live view is mainly for pointing.

### 6.2 Table tracking: markers first, markerless fallback
- Detect the 4 printed markers every frame → homography from the camera image to **table coordinates in millimetres**. Every piece's position is stored in table coordinates, so its highlight stays pinned to it while the phone moves.
- Between marker detections, use optical flow (pyramidal Lucas–Kanade) for smooth 30 fps tracking.
- Markerless fallback when markers are hidden: estimate the homography from already-catalogued piece centroids and features (RANSAC).
- A visible tracking-state indicator (good / weak / lost). When lost, recover automatically, never by creating new pieces.
- Use the homography to rectify every piece to a true top-down view before measuring its shape (removes perspective).

### 6.3 Piece detection (segmentation)
- A background model of the empty mat (Lab colour plus texture, with spatial variation), learned in calibration and adapted slowly over time. Pieces = "not mat", whatever their print colour.
- Shadow flattening, morphology, contours. Reject blobs cut by the frame edge. Filter by expected piece area, learned from the median of confident pieces.
- Split touching pieces with distance transform + watershed. Flag what can't be split.
- Per-pixel work in OpenCV.js (WASM) inside a Web Worker. Consider WebGPU for the heaviest steps.
- An ML segmentation fallback (e.g. a small Segment-Anything-style model on WebGPU) is optional. Benchmark it in research and only add it if classical segmentation fails on my real photos.

### 6.4 Shape reading
- Find the 4 true corners of each piece (research robust methods: polygon fitting, curvature peaks, best rectangle fit). Split the outline into 4 sides.
- Classify each side as **flat / tab / blank** with confidence. Make sure a printed line is never mistaken for a flat edge: use only the mask outline, never the print.
- Side descriptor: the side curve resampled to a fixed number of points, normalised to its corner-to-corner chord, plus chord length, tab height/width and neck position.
- Piece type: corner (2 adjacent flat sides), edge (1 flat side), interior. Interior shape class = the tab/blank pattern (e.g. "2 tabs opposite", "3 tabs + 1 blank").

### 6.5 Piece fingerprint and re-identification (critical for 1000+ pieces)
- Every piece gets a rotation-invariant fingerprint: its 4 side descriptors in cyclic order, plus colour descriptors, plus the image embedding.
- When a piece is detected, first check the catalog. If it matches an existing piece above a threshold, it is **the same piece**: update its position and don't create a new entry. Ambiguous → keep it "pending" until it's seen more clearly.
- Misses only count on steady frames. A piece that isn't seen keeps its last known position until the space is clearly empty.
- Tests must prove no duplicates when a 300-piece table is scanned repeatedly from different angles, and when pieces are moved, removed and returned.

### 6.6 Where does each piece go on the box picture? (hybrid scoring)
- **Box setup:** photograph the box. Auto-detect the picture's corners (I can drag to adjust) and rectify. Grid rows × cols: suggest from the piece count and picture aspect ratio (1000 pieces is commonly 40×25 or 38×27) and let me confirm. Later, cross-check with the edge count, since edge + corner pieces = 2 × (rows + cols) − 4.
- **Orientation:** a piece's 4 corners give its square frame, so only 4 rotations need testing.
- **Scores to combine:**
  1. Masked colour/pattern correlation of the piece against the box at grid scale, coarse to fine, 4 rotations (WebGPU compute, CPU fallback).
  2. Image-embedding similarity (e.g. DINOv2-small or similar via transformers.js / ONNX Runtime Web on WebGPU) between the piece crop and each cell's crop with margin. Benchmark whether it improves top-1/top-5 accuracy on synthetic and real photos, and keep it only if it does. Load it lazily and cache it offline.
  3. Constraints: corners only in the 4 corner cells, edges only in border cells with the flat side facing out, and tab/blank pattern consistent with already-placed neighbours.
  4. Colour calibration between box print and camera: start with automatic white balance and histogram matching, then learn a colour transform from my confirmed placements.
- **Output:** top-5 cells per piece with calibrated probabilities. Then a global "one piece per cell" assignment (Hungarian or greedy on high-confidence pairs) that updates as pieces are added.
- Low-detail areas must report low confidence honestly.

### 6.7 Which piece joins which? (piece-to-piece matching)
- Candidate pairs: only tab ↔ blank with compatible side lengths. Use box-placement neighbours as a strong prior to prune.
- Shape fit: align the complementary curves (Procrustes/ICP) and measure the gap.
- Colour continuity across the seam: compare colours sampled along both sides just inside the edge.
- Combine everything into a probability per pair, including a "partner not scanned yet" option.
- **2×2 loop confirmation:** if four pieces form a closed 2×2 block where every pair fits, mark those matches "confirmed ✓".
- Compute incrementally in a worker as pieces are added. Budget for 1000 pieces × 4 sides. Prefilter by side length, type and box prior so it stays fast.

### 6.8 Live overlay
- Each piece gets an outline or dot coloured by state: grey = detected, blue = shape read, green = placed on box, red/hollow = tracking uncertain.
- Tap a piece → a panel shows its thumbnail, its spot on the box (zoomed), its best partner for each side with %, and the "Fits / Doesn't fit" buttons.
- Targets pulse. When a target is off-screen, an arrow at the screen edge points to it.
- Lines connect pieces on the table that join each other.
- Overlay at ≥30 fps. Heavy analysis runs in the worker at a lower rate and never blocks the overlay.

---

## 7. Groups and sorting (Puzzle Helper-style, extended)

- **Border:** one tap highlights corners (orange) and edges (teal). Once box placement is known, also label which side of the frame (top/bottom/left/right). Show counts: "Corners 3/4 found, Edges 112/122 found".
- **Zones:** split the box picture into zones (default 6, A–F; adjustable 2–12). Ring every piece in its zone's colour. "Sort into trays" mode with printable tray labels.
- **Colour families:** automatic clustering by dominant colours, shown as swatches. Tap a swatch → those pieces light up.
- **Shape types:** for plain areas (sky, water), group by tab/blank pattern so I can sort look-alike pieces by shape.
- **Area search:** enlarge the box picture, drag across a region → every piece from that region lights up on the table.
- **Fill this spot:** tap one cell on the box → its best candidates light up with %.
- **What next:** suggest the most confident pieces that join the area I've already assembled.
- **Catalog screen:** a grid of thumbnails, filterable by group, zone, status and confidence.

---

## 8. Batch workflow (200–300 pieces at a time, 1000+ total)

1. New puzzle wizard: piece count → box photo → grid confirm → print markers → mat calibration.
2. Spread 200–300 pieces → Scan (sweep plus Snaps) → catalog fills; progress shows "pieces read / shapes read / placed on box".
3. Work with groups, live highlights and matches.
4. Mark placed pieces: tap "Placed", or (later milestone) scan the assembly board so the app reads which cells are filled by comparing them with the box picture.
5. Remove the placed pieces, add new ones, scan again. Known pieces are recognised, only new ones are added, and matches recalculate in the background.
6. Progress dashboard: totals per status and group, accuracy so far, pieces never seen yet.

Screens: Home (projects), New puzzle wizard, **Live** (main screen), Box view, Catalog, Matches, Groups, Settings (scan detail vs battery, thresholds, units), Device check, Report.

UI: big touch targets, usable one-handed, plain-English labels, dark-mode friendly. Keep the screen awake during sessions (Wake Lock).

---

## 9. Tech stack and hosting (decided; change only with a written reason)

- **Vite + TypeScript.** Keep the UI framework light (Preact or vanilla).
- **OpenCV.js (WASM) in a Web Worker.** Use a custom build if it reduces download size or adds modules we need (imgproc, video/optical flow, calib3d/homography, features2d, aruco or an equivalent marker library).
- **WebGPU compute** for heavy matching, with a WASM/CPU fallback.
- **transformers.js or ONNX Runtime Web (WebGPU)** for the embedding model, loaded lazily and cached by the service worker.
- **IndexedDB** via Dexie or idb. **PWA:** manifest, icons, service worker, offline.
- **Hosting:** GitHub Pages, deployed automatically by GitHub Actions on every push to `main`. Walk me through creating the GitHub account and repo step by step. Also give me a way to test on my iPhone while developing (HTTPS on my home network or a tunnel), with exact steps.

---

## 10. Milestones

- **M0 — Research and plan.** Research everything in section 6 (approaches, libraries, iOS 27 Safari capabilities, the reference projects' lessons). Deliver `docs/RESEARCH.md` and `docs/PLAN.md` with your final choices, risks and how you'll measure accuracy. **Stop and wait for my OK.**
- **M1 — Skeleton on my phone.** Deployed PWA, live camera, Snap, Device check screen, performance HUD (fps, ms per stage, memory), report export. Give me the setup steps.
- **M2 — Detection and catalog.** Mat calibration, segmentation, catalog from Snaps, clump warnings, distance/tilt guidance, plus the synthetic puzzle generator (section 11).
- **M3 — Shape reading and Border groups.** Corners/edges/interior, shape classes, catalog screen. (I can already use this to build the frame.)
- **M4 — Box placement.** Box photo, grid, placement candidates, Zones, area search, Fill this spot, colour families.
- **M5 — Markers, live tracking and re-identification.** Printable markers, pinned overlay, markerless fallback, no duplicates across scans and batches.
- **M6 — Piece-to-piece matching.** Partner candidates, match lines, 2×2 confirmation, What next.
- **M7 — Batch workflow.** Placed tracking (tap first, then optional assembly-board reading), progress dashboard, backup export/import.
- **M8 — Tuning on my real puzzle.** Use my photos and my Fits/Doesn't-fit feedback to tune thresholds and weights. Optimise speed, battery and memory.

**A milestone is done only when:** the automated tests pass, it's deployed, I have a plain-English test checklist, known issues are listed in `docs/PLAN.md`, and `CHANGELOG.md` is updated. Don't call anything "done" or "works" until it has been checked on my actual iPhone.

---

## 11. Testing

- **Synthetic puzzle generator:** cut any image into a realistic jigsaw (classic tab/blank grid with random variation, any size up to 1000+). Render pieces scattered on a mat with markers, random rotation, camera tilt, perspective, lighting gradients, shadows, blur, noise and JPEG compression. Keep full ground truth.
- **Automated tests at 48, 300 and 1000 pieces**, each with a measured score and a minimum threshold:
  - segmentation recall/precision
  - edge-type accuracy and corner/edge/interior accuracy
  - box placement top-1 and top-5 accuracy, reported separately for detailed and plain regions
  - pair-match precision at top-1, and precision of 2×2-confirmed matches
  - re-identification: zero duplicates across repeated scans, moves and batches
  - tracking error under simulated camera motion
  - memory-leak test and per-stage timing budgets
- **Real-photo tests:** every photo I send goes into `test/fixtures/real/` with hand-labelled ground truth where possible.
- **UI flow tests** with Playwright (WebKit).
- **In-app accuracy tracking:** the Fits/Doesn't-fit answers produce a running accuracy number under Settings → Accuracy.
- **Send report:** one tap packages recent camera frames, the box picture, catalog stats, timings, device capabilities and errors into a file I can share to you (Web Share API → Files/AirDrop/email).

---

## Start now

Begin with **M0**: do the research, write `docs/RESEARCH.md` and `docs/PLAN.md`, then summarise your plan for me in plain English and wait for my approval.
