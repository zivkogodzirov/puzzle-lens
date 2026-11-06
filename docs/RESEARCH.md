# Puzzle Lens: research notes (Milestone 0; working title "Piece Finder")

_Last updated: 2026-11-04. Platform baseline: iOS 27.2 / Safari 27.2 (current release), 27.3 in beta._

This file records what I found, which options I compared, what I picked and why. Each section opens with a short **plain-English** summary; the technical detail follows. Longer notes on individual projects are in [`docs/research/`](research/).

**How much to trust each statement:**
- **(measured)**: I measured it on the Mac during research (Node 22, Apple M2 Max). It has **not** been measured on an iPhone.
- **(source)**: read in a primary source: official docs, WebKit source code or bug tracker, the project's own code, or a paper.
- **(unverified)**: a reasonable belief that I could not confirm. These get tested on your iPhone, mostly in the M1 "Device check".
- **(estimate)**: my own arithmetic or judgement.

---

## 0. The ten findings that shaped the plan

1. **Picture sharpness decides everything, and a single photo of 300 pieces isn't sharp enough to read shapes.**
   - Web apps most likely get photos of about 12 megapixels. Apple's code suggests the iPhone's 48 MP mode isn't available to them; I'll confirm this on your phone in M1.
   - One photo of 300 spread-out pieces, with the markers around them, gives each piece about 85–100 pixels across.
   - That's enough to find pieces, sort them by colour and roughly place them on the box picture. It isn't enough to tell which pieces lock together, which needs roughly 180–250 pixels per piece.
   - So the app uses **one overview photo plus about 4 closer "detail" photos** per batch (up to 9 for a wide spread or an extra-sharp mode). On a stand at ~60 cm this can be done from one height: the 1× lens for the overview and the 2× lens for the details.
2. **The box picture is the strongest clue; piece shapes are the second opinion.**
   - Every project that matched by shape alone needed very sharp images to succeed. Mark Rober's puzzle robot had about 600 pixels per piece, a calibrated camera and a blacked-out room.
   - At phone resolution, most pieces of a standard 1000-piece cut have a near-twin shape.
   - So the app first works out *where on the picture* a piece belongs, then uses shape and colour to confirm which pieces join.
3. **Four markers aren't enough. Use eight.**
   - A detail photo, and the live view held close, see only part of the table.
   - 8 markers (4 corners plus 4 mid-sides, placed just outside the sorting area) keep at least one in view most of the time.
   - Detail photos are also lined up using the pieces already found in the overview photo, so they still work when no marker is fully visible.
4. **The iPhone can now do what the reference app couldn't.**
   - Since iOS 18 the camera can feed frames straight to a background worker.
   - Since iOS 26 web apps can use the phone's graphics chip for heavy calculations (WebGPU).
   - Since iOS 18.4 the app can trigger the camera's still-photo mode itself.
5. **The hard ceiling is about 2 GB of memory per web page**, and iOS kills the page without warning above it. The app aims to use under 1 GB and measures itself constantly.
6. **Home Screen web apps currently forget camera permission every time they open.** This is an open Apple bug. The app will ask cleanly with a big "Start camera" button and recover by itself.
7. **Install the app to the Home Screen before you start your puzzle, and use it only from there.**
   - Data saved in the Home Screen app is protected from Safari's 7-day clean-up.
   - The Home Screen app and Safari don't share data, so start in one place and stay there.
   - The Backup file lets you move between them.
8. **The cardboard sides of pieces matter.**
   - Pieces are about 2 mm thick. Away from the middle of a photo the camera also sees the side of each piece, which blurs its outline by up to ~1.5 mm. That's more than the difference between a right and a wrong fit.
   - Moving the phone closer doesn't help. What helps:
     - a **narrower view** (the 2× lens);
     - using each piece's **most central view** (close-ups overlap);
     - having the app separate the printed top from the cardboard side.
   - The app removes most of this and relies less on shape near the edges of a photo.
9. **Nobody has published accuracy numbers for this problem on real phone photos.** I'll build our own measurement:
   - a synthetic puzzle generator;
   - your real photos;
   - your "Fits / Doesn't fit" answers.

   I'll report all of these honestly. The closest competitor's claims turned out to be measured on easier, partly self-graded data.
10. **Licences.**
    - The three projects named in your brief, and three others I studied, have no licence, so I use only their ideas and published numbers.
    - Two others (jigsawlutioner and Zolver) are MIT-licensed. They're written in PHP and Python, so I still write all code from scratch.

**Name clash (resolved: the app is now called Puzzle Lens):** an unrelated project called "Piece Finder" (github.com/Harstil/piece-finder) already exists. It is a small, 4-commit, AI-written placement-only app with no licence. The question for you is in `docs/PLAN.md` §12.

---

## 1. How the research was done

- **Reference projects:** read through the GitHub API. Nothing was executed.
  - jellojm/puzzle-helper
  - maksym-hrytsenko/puzzle-assistant
  - kellinwood/PuzzleSolver (fork of jzeimen/PuzzleSolver)
  - Harstil/piece-finder
  - roksenhorn/puzzle-bot, the code and write-up behind Mark Rober's 1000-piece robot
  - bminaiev/jigsaw-puzzle-solver
  - byWulf/jigsawlutioner
  - Kawaboongawa/Zolver
- **Platform:** WebKit release posts for Safari 17.0–27.2, Apple's 27.3 beta notes, MDN browser-compat-data v8.1.8, WebKit source on `main`, WebKit bugs, and Apple developer forums.
- **Vision and ML:** papers, OpenCV source and whitelists, Hugging Face model cards and file sizes, and transformers.js / onnxruntime-web issues.
- **Fact-check:** a separate skeptic pass re-checked the decision-relevant numbers ([`research/notes-skeptic-review.md`](research/notes-skeptic-review.md)).
  - **Confirmed:** puzzle-bot's 99.4% side-match top-1; jigsawlutioner's 92.1% top-1 and its MIT licence; Ravensburger's 1000 = 36×28 grid.
  - **Corrected:** some over-readings of Harstil's numbers.
- **Review of the drafts:** four independent reviewers read these documents with different lenses (iPhone platform, vision method, coverage of your brief, fact-check), and a second skeptic tried to refute each finding.
  - 49 findings survived, and all are addressed in this version.
  - The biggest corrections: the piece-wall (parallax) model (§4), how `takePhoto()` interacts with the live stream (§3), and the accuracy-test definitions (`PLAN.md` §7).

---

## 2. Reference projects: what to learn from each

| Project | What it is | Licence | Key numbers | What I take from it (ideas only) |
|---|---|---|---|---|
| **jellojm/puzzle-helper** | iPhone PWA, OpenCV.js 4.10 SIMD in a worker; closest to our brief | None (`private: true`), all rights reserved | Phone: 2–6 fps; segmentation 74–116 ms; 145–212 ms per frame at 640 px on an iPhone XR. Far reads (~80 px) gave wrong edge types on 8 of 49 pieces, and ~7 equally good wrong partners per edge at 1000 pieces. Close reads (~260 px) gave ~0.006 ties per edge. One-piece-per-cell auction raised synthetic placement top-1 from 84.2% to 87.0%. | All 7 lessons in the brief §3, plus: read pieces close or not at all; trim corners off shape signatures; sample seam colour ~3% inside the cut and *count agreeing points*; trust comes from mutual-best, 2×2 loops and box adjacency rather than a single score; delete every `roi()` and `MatVector.get()`; the WASM heap never shrinks (a 12 MP photo pushed it to 661 MB); move dots at display rate keyed to the last *analysed* frame. |
| **maksym-hrytsenko/puzzle-assistant** | Native iOS (Metal, Core ML, SAM 2.1) | None | Distinctive pieces placed at 45–100% probability; flat areas give no confident answer (their own statement, no top-1 figure) | Masked zero-mean NCC in Lab with lightness down-weighted; erode the mask ~1 px (edge pixels mix with table and shadow); rotation from the outline direction histogram; coarse 16 px/cell, then fine 40 px/cell; softmax with a "somewhere else" option. SAM separates touching pieces where classical CV fails, at seconds per photo. |
| **kellinwood/PuzzleSolver** | C++/OpenCV, flatbed scans of piece backs | None ("All rights reserved") | Works up to ~100 pieces; README admits small pieces often get wrong suggestions | Harris corners with a binary-searched quality level; flat test = arc/chord < 1.3. Counter-example to avoid: endpoint-pinned matching in raw pixels. |
| **Harstil/piece-finder** | iPhone TS PWA, placement only, no OpenCV, 4 commits | None | Test-set top-1: 85.8% (100 pc), 77.9% (300), 85.1% (500). README's 68% at 1000 is on the validation set used to fit weights. Measured on ground-truth outlines (segmentation bypassed), procedural art, no real photos, no iPhone timings. | Map the piece's 4 corners onto a square "canonical piece"; 8/16/32 px-per-cell pyramid (top-48 → top-12 → fine, ±2 px shift); fuse texture-gated luma ZNCC, chroma ZNCC and gradient cosine; fitted lesson that *pattern beats absolute colour*; border logic hard only when shape confidence is high; side-wall parallax pull-back (only a partial fix, see §4); strict separation of val (tuning) from test (reporting). Weaknesses to beat: no catalog, no re-identification, no piece-to-piece matching, no fiducials, no real-photo numbers. |
| **roksenhorn/puzzle-bot** (Mark Rober robot) | Python/C; solved 1000-piece all-white puzzles by shape | None | ~585–705 px per side; calibration RMS 0.09 px. Side match top-1 99.4% (3846/3870, independently recounted); median margin to the runner-up 2.3×. | Corner scorer: sharp, opens toward the centroid, straight legs, smooth-arc penalty; best-4 by diagonal + quadrant consistency; refine by intersecting fitted side lines. Flat test: mean deviation/chord ≤ 0.54% for flats vs ≥ 3.4% for interior sides (a 6× gap). Chord-length ±8% prefilter; mirrored, chord-aligned, length-normalised L1 distance. Enforce exactly 4 corners and 2(R+C)−4 edges. Keep the most central view of each piece (less parallax). |
| **bminaiev/jigsaw-puzzle-solver** | Rust; 1000 white pieces from 4 phone photos | None | ~80 px/side: auto-solve failed (true mate once ranked 350th); finished interactively | Proof that ~80 px is too low for shape. Grow the outline 2 px (threshold misses the dark rim); weight straight shoulders 6× over the knob; corner-tangent continuity term; mutual second-best ratio normalisation; human confirms suggestions in the loop. |
| **byWulf/jigsawlutioner** | PHP, backlit single-piece photos | **MIT** | ~350 px/side; 92.1% top-1 on 500 Ravensburger pieces (in-sample) | Best documented corner finder: exhaustive 4-subset search with the **straight-shoulder test** (reject if a shoulder strays > 7.5% of the side from the chord). Two biggest gains: trim 5% at each side end, shift outline 2 px outward. Only works on Ravensburger-style varied cuts. |
| **Kawaboongawa/Zolver** | Python/OpenCV student project | **MIT** | No numbers | Arc-length gate (each side between N/8 and N/2); "raise smoothing until every side classifies" retry; seam colour from median Lab in a small disc inside the edge (keep L, unlike them). |

**Consequences for our design** (detail in the sections below):
- Segment against the mat, not against the print.
- Read shapes only from close detail photos.
- Make the box picture the primary placement signal.
- Combine shape and colour evidence into *calibrated* probabilities, confirmed by loops and by you.
- Measure everything on real photos early.

---

## 3. iPhone Safari platform (iOS 27.2)

**Plain English:** the iPhone has caught up a lot. Camera frames can go straight to a background worker, the graphics chip can do heavy maths, and still photos can be triggered from the app. The main limits are memory (~2 GB, with a silent kill above it), ~12 MP photos, no multi-core WebAssembly on GitHub Pages, and the Home Screen camera-permission bug.

| Capability | Status on iOS | Since | Notes / what we do |
|---|---|---|---|
| getUserMedia (camera) | Yes | 11 | Default is 640×480, so always ask explicitly. Formats up to 4032×3024 and 1–60 fps were seen on an iPhone 13 Pro (source: WebKit bug 260327). 4K30 is likely; 4K60 is unverified. Read `getSettings()` for what was actually delivered. |
| Lens choice | Yes (deviceId per lens) | — | "Back Triple/Dual Camera" are virtual and **auto-switch to macro up close**. For stable geometry, use the physical "Back Camera" (or the "Back Telephoto Camera"). `zoom` works (since 17), 0.5–10. |
| torch, whiteBalanceMode | Yes | ~16.4 | Rear only. Exposure, ISO, focus mode and points-of-interest are **not** available. |
| MediaStreamTrackProcessor | Yes, **dedicated worker only** | 18.0 | Transfer the track to the worker and read `VideoFrame`s there. Keeps one frame and drops others when slow; `close()` frames promptly. `copyTo` can't convert formats (frames are likely NV12: copy the Y plane for grey work). |
| requestVideoFrameCallback | Yes (main thread) | 15.4 | Fallback frame pump. |
| ImageCapture.takePhoto | Yes (main thread) | 18.4; queueing fixed 27.0 | JPEG. **Photo size depends on the live camera format** (WebKit source): with no size requested you get the *smallest* photo size of that format; a size that needs a different format **mutes the camera for every consumer (including the worker's clone)** while it switches and switches back. `getPhotoCapabilities()` reports the video range, not the real photo sizes. 48 MP probably isn't reachable (WebKit takes the first, i.e. 12 MP, entry). Some anecdotal hangs, so a fallback is kept. See the capture contract in `PLAN.md` §3.1. |
| `<input type=file capture=environment>` | Yes | 10 | Re-encoded JPEG (q≈0.8), metadata stripped, probably 12 MP (unverified). Library picks may be HEIC since 26.4; Safari decodes HEIC. |
| WebGPU | Yes, including in workers | 26.0 | Off in Lockdown Mode. On recent iPhones `maxBufferSize` ≈ 256 MiB–1 GiB (one report: 683 MiB), workgroup storage 32 KiB, `shader-f16` exposed. **GPU memory counts against the ~2 GB page limit.** |
| WASM SIMD | Yes | 16.4 | Our OpenCV build uses it. |
| WASM threads (SharedArrayBuffer) | Only when cross-origin isolated | 15.2 | **GitHub Pages can't send the needed headers.** The `coi-serviceworker` workaround is unmaintained since 2023 and unproven on iOS Home Screen apps. Decision: **no threads**; parallelism comes from several workers instead. |
| WASM JSPI | Yes | 27.0 | Lets onnxruntime-web use its smaller-memory build. |
| OffscreenCanvas (2D, WebGL, WebGPU) | Yes | 16.4 / 17.0 / 26 | Drawing and image work inside workers. |
| Max canvas size | 8192×8192 | 18.0 (was 4096²) | Exceeding canvas memory now **kills** the tab instead of throwing. Big photos are processed in tiles. |
| Page memory limit (jetsam) | ~2048 MB on recent Pro iPhones (single report) | — | Silent page reload. Older or smaller iPhones are lower (~1.4 GB on a 13 Pro in 2023). All workers, WASM heaps and GPU buffers share this one limit. **Per-part budgets that add up to < 1 GB** (`PLAN.md` §8), checked against the headroom measured on your phone in M1. |
| Memory measurement API | **None** (no `performance.memory`) | — | We count our own bytes (WASM heap size, live Mats, frames, GPU buffers) and detect crash-reloads with a session marker. |
| IndexedDB / Cache / OPFS quota | Up to 60% of disk per origin | 17.0 | `persist()` is granted by heuristics (e.g. Home Screen app). Safari-tab data is wiped after 7 days of Safari use without visiting the site; **Home Screen apps are exempt and have separate storage**. |
| Screen Wake Lock | Yes | 16.4 (Home Screen fixed 18.4) | Re-request on `visibilitychange`. |
| Web Share with files | Yes | 14 | Needs a tap. This is how reports and backups go to Files/AirDrop/Mail. |
| DeviceOrientation / Motion | Yes, after `requestPermission()` from a tap | 13 (secure-context only since 26.4) | Powers the tilt indicator. |
| Service worker + Home Screen web app | Yes | SW 11.3; any site installable as a web app 26.0 | Explicit "update available" flow; no background sync. |
| Vibration, File System Access pickers | No | — | Use sounds/visual cues; downloads via share sheet. |

**Known iOS problems we design around:**
- Home Screen apps forget camera permission on every launch (WebKit bug 327237, open, reproduced on 26.6.2). Screen-off or backgrounding can also re-prompt or mute the track. → One-tap "Start camera", automatic recovery on `mute`/`ended`, and the Wake Lock re-requested.
- iOS runs some big per-pixel JavaScript loops in a slow tier unpredictably (puzzle-helper measured 2 ms vs 57–81 ms for the same loop). → All full-frame per-pixel work happens in WASM or WebGPU.
- `navigator.share()` must be called within **5 seconds** of the tap (WebKit's transient-activation window). Zipping a big backup after the tap would fail. → Backups and reports are prepared in a worker *before* the Share tap, with a download-link fallback.
- With Safari's "Advanced Tracking and Fingerprinting Protection" set to all browsing (or in Private Browsing), canvas `getImageData` results get **noise injected** (WebKit source). That would poison pixel analysis. → Camera frames are read with `VideoFrame.copyTo` instead of canvas. A Device check probe detects noise on canvas readback. Photos fall back to JPEG decoding inside WASM if needed.
- onnxruntime-web's default bundle uses 5–6 GB while WebKit compiles it (fixed upstream 2026-10-29, not yet released). There is also a GPU-process crash on large submissions (iOS 27.2, open) and a crash after ~500 WebGPU inferences (iOS 26.3, closed unfixed). → Use the JSPI/plain WASM builds, keep GPU submissions small, and soak-test 2,000+ inferences on your phone before relying on it.

Sources: webkit.org/blog/17333 (26.0), /17862 (26.4), /18325 (27.0), /18515 (27.2), /15865 (18.0), /16574 (18.4), /14403 (storage policy), /10218 (7-day rule); WebKit bugs 327237, 280394, 260327, 269777, 269937, 279637; transformers.js #1827/#1835; onnxruntime #33516, #33563, #33753, #27584, #33750; developer.apple.com/forums/thread/823061.

---

## 4. Capture strategy and resolution

**Plain English:**
- A piece has to be roughly **180–250 pixels across** for its shape to be read reliably. About **85–100 pixels** is enough to find it, colour-sort it and place it roughly on the box picture.
- Web apps most likely get **~12 MP photos**, so 300 pieces don't fit in one sharp-enough photo.
- The app takes one overview photo, then guides you through about 4 closer photos, showing a live map of which parts of the table still need one.

**The arithmetic** (estimate):
- Non-Pro iPhones have a 26 mm-equivalent 1× camera, ≈ 67° × 53° in 4:3, so the view width ≈ 1.33 × the height above the table.
- Pro iPhones since the 14 Pro have a 24 mm camera, so the view is ~8% wider (≈ 1.44 × the height).
- 12 MP = 4032 px wide. A 1000-piece Ravensburger cell is 19.4 × 17.8 mm (source).
- The app never relies on these nominal numbers. It measures the real pixels per mm from the markers in every photo, and computes its height guidance from that.

| Camera height | Lens | View width (26 mm phone) | px across a 19 mm piece | Use |
|---|---|---|---|---|
| ~60–66 cm | 1× | ~80–88 cm | ~87–95 | **Overview photo**: the 70 × 50 cm area *plus* the 8 markers around it. Finds pieces, colours, rough placement, provisional corner/edge marks |
| ~60–66 cm | 2× | ~40–44 cm | ~175–190 | **Detail photo** (2×2 tiles with ~10 cm overlap): shape reading and matching |
| ~30 cm | 1× | ~40 cm | ~190 | Detail photo if your phone has no true 2× |
| ~45 cm | 2× | ~30 cm | ~250 | "Extra-sharp" detail mode (3×3 tiles) |

**The 2× lens:**
- On iPhones with a 48 MP main camera (iPhone 15 and later; Pro since 14 Pro), "2×" is a crop of the sensor's centre, so it should keep full detail.
- On older phones it is digital zoom, which only enlarges the picture without adding detail.
- Photo *size* alone can't tell the two apart, so M1 includes a **2× test**: two photos from the same spot, 1× and 2×. The middle of the 1× photo is enlarged 2× and its fine detail is compared with the 2× photo.
  - *Measured in M1 (synthetic photo pairs, Mac):* the first detail measure (mean gradient after a σ 1 blur) could not separate them: a true 2× scored 0.91–1.06, digital zoom 0.84–0.99. The fix is a band-pass measure (difference of Gaussian blurs, σ 0.7 and 1.4). With it, a true 2× scores 1.03–1.36 and digital zoom 0.71–1.00, and ±8 noise barely changes either. Scenes without fine detail score about 1 either way, so the test needs a detailed print.
  - The Device check shows only the measured ratio for now. The thresholds will be set from the owner's iPhone, because the phone's own sharpening could lift a digital-zoom photo. The app recommends 2× only after that.

**One stand height for everything:** on an overhead stand at ~60 cm, the overview uses 1× and the details use 2× from the same position. Your hands stay out of the way, and 2× also halves the piece-wall problem (below).

**Evidence for the thresholds:**
- puzzle-helper: wrong edge types and ~7 ties per edge at ~80 px; ~0.006 ties per edge at ~260 px.
- bminaiev: failed at ~80 px.
- jigsawlutioner: 92% top-1 at ~350 px.
- puzzle-bot: 99.4% at ~600 px.
- Harstil and puzzle-helper both warn below 48 px per cell on the *box* photo.

**Batch layout:**
- 300 pieces spread with small gaps need about 60 × 45 cm to 70 × 50 cm.
- The markers sit in the mat margin just outside that area, so the mat should be about 16 cm larger on each axis (e.g. ~85 × 65 cm for a 70 × 50 cm area).
- One overview photo, plus 2×2 detail tiles (40–44 × 30–33 cm each, ~10 cm overlap). That's 4 detail photos, or 9 in extra-sharp mode.
- Pieces cut by a tile edge are read from the neighbouring tile, which is why the tiles overlap.

**Live video** is for pointing and overlays, not for reading shapes. At 1080p an 80 cm view gives ~45 px per piece; at 4K, ~90 px. The brief allowed cataloguing from "Snaps or close-up live frames"; I chose Snaps only, because live frames are lower resolution and can't be steadied.

**Piece walls (parallax): corrected after review** (sources: Harstil, puzzle-bot; my geometry, checked by a reviewer):
- Pieces are ~2.1 mm thick (Ravensburger FAQ). Seen at an angle, the printed top face appears shifted outward from the photo centre by δ ≈ t·r/H, and the cardboard wall facing the camera becomes visible.
- **δ depends only on the viewing angle (r/H).** Moving closer with the same lens doesn't reduce it. At the edge of a 1× photo it is ~1.3–1.7 mm. With 2× (half the angle) it is ~0.7–0.9 mm, and near the centre of any photo it is close to 0.
- The camera sees the outline as the bottom face, the top face and the wall in between, all merged. This fills the hollows beside tab knobs and narrows the mouths of blanks. Simply pulling back straight lines can't undo that.
- The printed top face is always fully visible from above. Its boundary is the true outline, up to a uniform shift and a < 1% scale (both harmless, since shapes are compared after normalising by the side length).
- **Fixes (all used):**
  1. 2× lens for detail photos, from a stand, shooting straight down.
  2. Overlapping tiles. Each piece is read from its **most central view**.
  3. **Print vs wall separation is mandatory for detail reads:**
     - The marker-derived camera position predicts where a wall band can appear (on the sides facing the photo centre, at most δ wide).
     - Inside that band, pixels are classified as printed top or cardboard wall.
     - Outline stretches where print and cardboard can't be told apart are given low weight in shape matching.
  4. Thumbnails, placement masks and seam-colour strips are taken from **inside the top-face boundary**, never from the raw silhouette, so they never sample cardboard.
  5. A per-photo **read-quality gate**: sharpness at the marker edges, share of clipped (blown-out) pixels, and tilt from the homography (≤ 5° for detail photos). It asks for a retake when the photo fails.
- How well this works is measured directly by an **outline-error test**: mm distance to the true outline, split by shoulder / knob / neck and by distance from the photo centre (`PLAN.md` §7).

**Decision:**
- Two capture modes:
  - **Overview Snap:** whole area, ~85–100 px per piece. Used for detection, colours, placement and *provisional* corner/edge marks.
  - **Detail Snaps:** guided tiles, ~175–250 px per piece. Used for shape reading and matching.
- Snaps use `ImageCapture.takePhoto()` under an explicit capture contract (`PLAN.md` §3.1), falling back to the file-input camera.
- Side types from the overview are used for the Border mode only (shown as provisional), never for matching. Piece-to-piece matching uses detail-quality reads only. Each piece carries a "read quality" score.

---

## 5. Markers and table tracking

**Plain English:**
- You print two A4 sheets of square black-and-white codes and put eight of them around your sorting area.
- Whenever the camera sees at least one (ideally two), the app knows exactly where it is relative to the table, in millimetres.
- That's what keeps highlights glued to pieces when you move the phone, and it lets the app measure pieces in real units.

**Options compared:**
- OpenCV.js `ArucoDetector`: properly exposed since 4.8; corner refinement modes include APRILTAG; already in our OpenCV build.
- js-aruco2: pure JS, MIT, last commit 2023.
- AprilTag C detector compiled to WASM: BSD-3, active, but a second WASM to ship.

Our markers will be hundreds of pixels across and static, so detector speed and robustness differences barely matter (estimate). Reliable 4×4 detection needs ~20–30 px per marker side (source: forum reports).

**Decision:**
- **Detector:** OpenCV `ArucoDetector`, dictionary **DICT_4X4_50**. Large 1 cm modules make it blur-tolerant.
- **Marker print:**
  - 50–60 mm black squares with a ≥ 12 mm white quiet zone (mandatory on a dark mat), 4 per A4 sheet, matte paper.
  - Each sheet also carries a **100 mm check bar**, because printers often rescale pages ("fit to page", A4/Letter), and a **mid-grey patch**. White paper can blow out on a dark mat; grey is a safer exposure and white-balance reference.
- **8 markers**, in the mat margin just outside the sorting area: 4 at the corners and 4 at the mid-sides.
  - This changes the brief's four. The live view held close, and the detail photos, see only part of the table, and more markers keep at least one in view most of the time.
  - No promise that every close-up sees two. Detail photos are registered from whatever marker corners are visible **plus** matches to pieces already found in the overview photo (RANSAC). The pieces haven't moved between the two, so this is reliable.
- **You don't have to measure anything.**
  - A one-time "marker map" step works out where each marker is: one overview photo showing all 8, using the printed marker size for scale.
  - The 100 mm bar on the sheet is checked in the same photo. If the printer rescaled the page, the app corrects for it or asks you to reprint.
- **Every frame:**
  - homography from all visible marker corners by RANSAC/USAC, with sub-pixel corners;
  - a reprojection-error check;
  - markers that disagree with the rest are flagged as "moved".
  - Lens distortion can hide in a single-photo marker map, so it is tested separately in M2 by comparing detail tiles against the overview. If the error is above ~1 px, a one-time lens calibration is added (`calibrateCameraExtended` is in the build).
- **Between detections (live view):** pyramidal Lucas–Kanade on marker corners and piece features, with a forward–backward check. Re-detect markers every few frames.
- **Markerless fallback:** RANSAC on already-catalogued piece centroids against the current detections. puzzle-helper's similarity-transform RANSAC works this way, but we upgrade it to a homography once there are ≥ 6 links.
- **Marker sheets are masked out** of piece detection (their positions are known). Pieces partly under a sheet are flagged.

---

## 6. Finding pieces (segmentation)

**Plain English:** the app learns what the empty mat looks like, then treats everything that isn't mat as a piece, whatever colours are printed on it. It evens out lamp shadows first, and flags touching pieces with an orange dashed outline.

**Options compared:**

| Approach | Verdict |
|---|---|
| Colour mask of the *print* | Rejected: traces only the colourful part of pale pieces and invents flat edges (puzzle-helper §3.2) |
| Fixed per-pixel mat model from a calibration photo | Fragile alone: your shadow and the phone move between shots (CV research) |
| **Mat colour model + per-photo lighting field** | **Chosen**: learn mat colour statistics once; in each photo fit a smooth lighting field on mat pixels, divide it out, then threshold |
| Shadow-aware distance (Horprasert 1999: brightness vs chromaticity distortion) | **Chosen**, combined with the above: a shadow is the same colour, just darker |
| k-means table colours per frame (Harstil) | Works on plain tables, but loses table-coloured pieces; we have a known mat |
| SAM-family ML segmenters (SlimSAM 9–12 MB, EdgeTAM 10–20 MB, Apache-2.0); a puzzle-specific YOLO segmentation model on Hugging Face (licence unchecked) | **Not in the main path; benchmark deferred to M2 with a trigger.** Whole-photo masks come out at 1024 px resolution, and 300 prompts per photo are slow. Per-piece crops would avoid the resolution problem. Trigger: if your real photos give per-piece recall < 98%, or > 5% of blobs flagged as clumps after spreading, I benchmark these on per-piece crops (and check the YOLO model's licence) |

**Pipeline:**
1. Downscale for detection, using tiles for 12 MP.
2. Convert to Lab and divide by the lighting field.
3. Compute the brightness and chroma distortion against the mat model.
4. Apply a hysteresis threshold (Otsu-seeded).
5. Do morphology, fill holes, and remove dust/hair.
6. Mask out the marker sheets (their position is known).
7. Reject blobs cut by the frame edge.
8. Gate by size relative to the running median *in mm²* (the markers give us real units).
9. For flagged blobs (> 1.5× median area, low solidity, or failed 4-corner fit), try distance transform + watershed, accepting a split only if every part is piece-sized and piece-shaped (puzzle-helper WP3). Otherwise show "spread these apart".
10. For shape reading (detail photos):
    - Refine the outline to sub-pixel by interpolating along the outline normals at full resolution (CV research, puzzle-bot lesson).
    - Separate the printed top face from the cardboard wall (§4).
    - Check the photo against the read-quality gate (§4).

**Adapting over time:**
- The mat model is refreshed slowly from mat pixels in each photo, so slow lighting changes are absorbed.
- The lighting field is re-fitted in every photo, so lamp shadows and gradients are flattened every time.
- Spatial variation of the mat (seams, wear) is stored in table coordinates, at ~1 cm resolution, from the calibration sweep.

**Mat colour:**
- A dark matte mat suits most puzzles.
- The setup wizard compares the mat with the box picture. If a large share of the picture is darker than the mat would separate cleanly, it recommends a mid-tone coloured mat (e.g. green or blue felt).
- puzzle-helper's measured lesson: pale pieces on a white board: 0/48 read correctly; on dark cloth: 48/48.

**Update 2026-11-06: your setup has no mat** (white glossy table, phone held by hand). What changes, and what is still uncertain:
- The "mat model" becomes a **table model**, learned from one photo of the empty sorting area. The pipeline above is otherwise the same.
- **Pale pieces are the main risk.** The colour difference between a near-white piece and a white table is small, and puzzle-helper's 0/48 result above was exactly this case. Two extra cues are added for them (an estimate, not yet measured):
  - **Edges:** the cut outline of a piece shows as a thin line of strong gradient even when its colour is close to the table's.
  - **Side shadow:** with light from one side (the setup advice), every piece throws a 1–2 mm shadow along one side. Shadow-aware distance (Horprasert) already separates shadow from piece; here the shadow's inner edge also marks the piece's outline.
  - Your box picture is mostly mid-tones and dark tones, so most pieces stand out well from white. The table-contrast check (M4) shows which parts are pale; the real per-piece recall on your palest pieces is measured in M2. If it stays below the 98% bar, the fallbacks are a one-tap "add missed piece" (M3), or, only if you want it, any dark cloth or paper under the sorting area.
- **Glare:** a glossy table reflects lamps straight into the camera when the lamp is behind or above the phone. Glare spots are bright, low in colour, and **move when the phone moves**, while pieces stay put. So they are found by comparing two photos in table coordinates (the markers align them), and pixels under glare are filled in from the other photo. Side light avoids most of it in the first place.
- **Handheld:** the markers give tilt and height every frame, so Snap waits until the phone is level (≤ 5°), at height and still, then fires by itself. The quality gate checks motion blur on the marker edges after every photo.
- **Markers on white:** the white quiet zone around each marker no longer contrasts with the table, but ArUco only needs the black border against the quiet zone, so detection is unaffected. The grey patch remains the colour reference; the white table can serve as a second one.

**Where it runs:** OpenCV.js (WASM SIMD) in a worker. Per-frame live segmentation is only for spotting changes (piece moved, added or removed), at 2–5 fps on downscaled frames.

---

## 7. Corners and side types

**Plain English:**
- For each piece the app finds the four true corners, then decides whether each side is **flat**, a **tab** (sticks out) or a **blank** (goes in).
- Flat sides are easy and very reliable.
- Corners are the tricky part, because the "shoulders" next to a tab look a bit like corners. The method below is the best-documented approach from real projects.

**Methods compared** (sources: CV survey, jigsawlutioner, puzzle-bot, bminaiev, Zolver, Harstil, kellinwood):
- polygon approximation: unstable, because tabs create vertices
- curvature peaks
- centroid-distance peaks
- Harris corners
- best-rectangle 4-subset search
- convexity defects

**Chosen (hybrid):**
1. **Candidates:** convex curvature peaks at two smoothing scales, plus centroid-distance maxima. Keep the best 12–16 (≤ 1820 quads).
2. **Score every 4-subset** (lower is better):
   - angles near 90°
   - opposite sides of similar length
   - **side lengths close to the expected cell size in mm**: only possible because of our markers, and new versus all the reference projects
   - quad area / piece area in a plausible range
   - **straight shoulders**: hard reject if a shoulder strays > ~7.5% of the side from the chord (jigsawlutioner)
   - corner opens toward the centroid, with a smooth-arc penalty (puzzle-bot)
   - each side between ⅛ and ½ of the outline (Zolver)
3. **Refine** each corner by robust line fits (Cauchy-weighted) on both shoulders and intersect them (puzzle-bot, Harstil). This fixes dinged and rounded corners.
4. **Work on the printed top-face outline** (print vs wall separation, §4), not the raw silhouette. Outline stretches that couldn't be separated get low weight.
5. **Confidence** from the cost margin between the best and second-best quad. Low-confidence pieces get re-read from another photo, or shown for a tap-to-fix.

**Side classification:**
- In the chord frame, take max signed deviation ÷ chord.
- **Flat** if < ~0.10, with an "uncertain" band around it. Measured gaps: flats ≤ 0.03 vs tabs/blanks ≥ 0.17 (Harstil); flats ≤ 0.54% mean deviation vs interior ≥ 3.4% (puzzle-bot).
- Otherwise the sign of the dominant lobe gives **tab** or **blank**.
- Require two agreeing reads, or one high-quality read (puzzle-helper: "94% of shapes came from a single view").
- **Overview reads (~90 px)** set side types only *provisionally*. They're used for the Border mode with a "provisional" mark, and never for piece-to-piece matching. A detail read replaces them.

**Piece type and shape class:**
- corner = 2 adjacent flats
- edge = 1 flat
- 2 opposite flats or 3+ flats = invalid (re-read)
- interior shape class = the cyclic tab/blank word, normalised to its smallest rotation (e.g. TTBB, TBTB, TTTB)

**Consistency checks across the whole puzzle:**
- exactly 4 corners
- 2(R+C)−4 edge pieces
- total tabs = total blanks = C(R−1)+R(C−1)

A tab/blank imbalance reveals classifier bias, for example shallow tabs read as flat.

---

## 8. Fingerprint and re-identification

**Plain English:** every piece gets a "fingerprint" made of its shape, its colours and a tiny picture of it. When the app sees a piece again (moved, rotated, or brought back in a later batch), it compares fingerprints and updates the existing record instead of creating a duplicate. If it isn't sure, it waits for a clearer view rather than guessing.

**There is little prior art here:**
- puzzle-bot dedupes by robot position only.
- jigsawlutioner's recogniser has no reject threshold.
- puzzle-helper's duplicates came from forgetting positions and missing pale pieces.

So I'm designing and testing this from scratch.

**Fingerprint** (all rotation-invariant by testing the 4 cyclic rotations):
1. **Canonical thumbnail:** the piece warped by its 4 corners to a 32×32 Lab square inside its mask; compared by zero-mean NCC at 4 rotations.
2. **Shape:**
   - cyclic side-type word (F/T/B)
   - per-side chord length in mm
   - compact per-side profile coefficients (DCT of the resampled curve)
   - tab depth, knob and neck widths
3. **Colour:** Lab histogram and moments, plus area and perimeter in mm².
4. **Embedding:** optional. If the model is kept after the M4 placement benchmark, M5 also tests whether adding it to the fingerprint lowers wrong merges and pending pieces. It stays in the fingerprint only if it does.
5. The best rotation must **agree** between shape and thumbnail.

**Decision rule:**
1. **Within a session:** position first (table mm) plus a fingerprint check.
2. **Across moves and batches:** build the shortlist as the **union** of the top candidates by thumbnail, by colour and by shape class and size. It must not be a hard filter on side types: one misread side would drop the true piece and create a duplicate. Then score the full fingerprint, with type and shape-class disagreements as soft penalties.
3. **Accept** if the best distance d₁ < τ and d₁/d₂ < ρ (ratio test). Otherwise mark the piece **pending**, show its candidates, and prompt "take a close-up of this spot" to settle it.
4. Assign one-to-one within each photo (Hungarian), so two detections can never claim the same catalog piece.
5. Each merge or update is one database transaction, so an interrupted app can never leave half a merge.

**Misses:**
- Only count when the frame is steady and the spot is clearly in view.
- A piece keeps its last position until that space is seen empty (puzzle-helper fix for the 566-entries bug).

**Tests:**
- Re-scan the same 300-piece table shuffled, rotated, moved, removed and returned.
- Vary the conditions: 2–3 lighting setups, and **different camera positions** (tilt 0–20°, off-centre, 1× and 2×).
- Report the false-merge rate, the duplicate count (target 0) and the pending rate (capped, so "pending" can't be used to dodge duplicates).

---

## 9. Placing a piece on the box picture

**Plain English:**
- The app straightens your box photo into a grid, one cell per piece.
- For each piece it makes a "straightened" version (using its 4 corners) and compares its colours and patterns with every cell in all 4 rotations, from coarse to fine.
- Plain areas like sky honestly come out as "could be any of these 5".
- A final step makes sure no two pieces claim the same cell.

**Options compared:**

| Approach | Evidence | Verdict |
|---|---|---|
| SIFT/ORB keypoints + homography | Jigsaw Hints, Cornell "Jigsolved": fails on plain or noisy pieces; small pieces have few keypoints | Rejected as the main method |
| Colour histograms only | puzzle-helper prefilter | Prefilter only |
| **Masked zero-mean NCC (ZNCC) at grid scale, 4 rotations, coarse to fine** | puzzle-assistant, Harstil (77.9–85.8% top-1 at 100–500 pieces on synthetic data), puzzle-helper (87% with assignment) | **Chosen** as the core score |
| Gradient-orientation cosine | Harstil fitted it as a strong cue | **Chosen** as an extra cue |
| Image embeddings (DINOv2/v3) | DINOv3 paper: on NAVI correspondence, DINOv3-S 56.3 vs DINOv2-S 53.4, but on SPair DINOv2-S is ahead (51.6 vs 50.4); CLIP/SigLIP much worse. No puzzle evidence either way | **Benchmark in M4; keep only if it raises top-1/top-5** (§12) |

**Chosen pipeline** (re-implemented ideas, no copied code):
1. **Box setup:**
   - Photograph the box, or import the picture from Photos (a sharp product image from the maker's website is often better than a photo of a glossy box).
   - Auto-detect the 4 corners (largest convex quad), then a magnifier loupe for dragging corners.
   - Rectify to ≤ 64 px per cell.
   - Warn below 48 px per cell.
   - Ask one question: "Does the picture on the box show exactly the puzzle, or does it have a border, or continue past the edges?"
   - **Box-to-grid correction:** box art is often cropped, extended or framed compared with the real puzzle. A 2% extension shifts edge cells by ~0.7 of a cell. After the first batch, the app fits a correction (per-axis scale and offset, or a homography) by RANSAC from confident placements and border pieces, and refits it as confirmations arrive. Until it settles, the shift search near the borders is widened.
2. **Canonical piece:** a homography from the 4 refined corners to a square core with a ⅜-cell margin. Tabs stay as extra evidence. The mask is taken from **inside the printed top-face boundary** (§4) and eroded ~1–3 px.
3. **Score levels:** 8, 16 and 32 px per cell.
   - **8 px:** every cell × 4 rotations → top-48.
   - **16 px:** ±2 px shift → top-12.
   - **32 px:** fine.
   - Cues: texture-gated luma ZNCC, chroma ZNCC, gradient cosine, and small mean-colour penalties.
   - Constraints:
     - border: hard when shape confidence is high, soft penalties otherwise;
     - **tab/blank pattern consistent with neighbours already placed or confirmed** (brief §6.6 item 3): from M5 for confirmed placements, from M7 for pieces marked "Placed".
4. **Probabilities:** softmax over finalists plus a "somewhere else" option.
   - The temperature **and** the verdict cut-offs are fitted on the *validation* sets only; the test sets are used only for reporting. Both are refitted from your feedback.
   - Verdicts: **Strong** / **Likely** / **Several spots look alike**. The Strong cut-off is set so that Strong is ≥ 95% right on validation. The test set then checks that this holds, and reports how many pieces get a Strong verdict.
   - Each cell is tagged "detailed" or "plain" by a **frozen, versioned rule**: gradient energy at 32 px per cell against a fixed cut-off chosen on validation artwork. Accuracy is reported separately for each, and the rule can't be moved to flatter the results.
5. **Colour calibration:**
   1. White-balance and expose each photo from the grey patch on the marker sheets (white paper can blow out).
   2. Match colour statistics between piece pixels and the box picture (Reinhard / histogram). This is done **once**, on the first unsorted batch, or later on the whole catalog. It is never redone per sorted batch: a batch of only sky pieces would otherwise be pulled toward the picture's average colour.
   3. Once ~30 placements are confirmed, fit a 3×3 + offset colour transform by RANSAC, and refit as more arrive.
6. **One piece per cell:**
   - Global assignment over −log p, using Hungarian/Jonker–Volgenant (plain JS O(n³) on 1000 × 1026 measured at 36–131 ms on the Mac (measured)) or a sparse auction (puzzle-helper: 2 ms).
   - Then Sinkhorn normalisation, so displayed top-5 probabilities respect one-piece-per-cell.
   - Re-solved after each batch, with not-yet-seen pieces as dummies.

**Cost:**
- One piece × 1000 cells × 4 rotations at 32×32×3 takes 14.6 ms in plain JS (measured), so adding pieces one at a time is fast on the CPU.
- Re-scoring all 1000 pieces after a colour-calibration change is ~15 s single-threaded (measured): fine as a background job, or ~0.1–0.4 s on WebGPU (estimate).

---

## 10. Grid size

**Plain English:** the app suggests the grid (e.g. 36 × 28) from the piece count, the picture's shape, the finished size printed on the box, and the measured size of your pieces. You confirm it. It double-checks later as edges and corners are found.

**Facts:**
- Ravensburger 1000 is **36 × 28 = 1008 pieces** with 19.42 × 17.75 mm cells (source: Ravensburger FAQ), *not* 40 × 25 or 38 × 27.
- Other common layouts: 40 × 25 (1000), 38 × 27 (1026), 39 × 26 (1014), 34 × 31 (1054); all four have 126 edge pieces. 36 × 28 and 37 × 27 have 124.
- So **edge count alone can't tell several layouts apart.**

**Method:**
1. Enumerate (C, R) with C·R within **−2% to +6%** of the nominal count (so 37 × 27 = 999 and 34 × 31 = 1054 are included) and cell aspect ≤ 1.35. Rank by:
   - count error
   - picture aspect
   - **measured piece size in mm vs the finished size on the box**
   - the scale-free **ratio of flat-side lengths** (cell width : height), which works even if the printer rescaled the markers
2. Offer the top 3, **plus manual rows × columns entry**.
3. The grid is confirmed in the wizard at the start (it doesn't need the box photo), so Border counts like "Edges 112/120" work from M3.
4. **Cross-checks during the puzzle,** shown as "Grid may be wrong — check?" if they disagree:
   - flat-side lengths form two clusters (cell width and height), whose counts converge to 2C and 2R
   - edge pieces = 2(R+C)−4
   - interior pieces = (C−2)(R−2)

---

## 11. Which pieces join (piece-to-piece matching)

**Plain English:**
- Two sides can only join if one is a tab and the other a blank of similar length.
- The app mainly checks pairs that the box picture says are neighbours, then compares the two side shapes and the colours along the seam.
- It shows a percentage and confirms a match with ✓ when four pieces close a 2×2 square.
- Expect shape alone to be unsure on many pieces. The box picture and your confirmations make it useful.

**Evidence:**
- Shape-only top-1 was 99.4% at ~600 px with lab-grade imaging (puzzle-bot), 92% at ~350 px with a backlight (jigsawlutioner), and a failure at ~80 px (bminaiev).
- puzzle-helper on real phone photos: only 0–7 of 27 true joins passed the display gate, at ~0.25 precision. Their conclusion: "discrimination is the problem, not the gate."
- No published per-edge accuracy exists for phone photos of standard grid cuts. My expectation is well under 90% top-1 from shape alone at ~200 px (estimate).
- Other makers' cuts are reportedly more uniform than Ravensburger's ("too similar or even identical side forms": jigsawlutioner).

**Chosen:**
1. **Candidates:**
   - tab ↔ blank only
   - chord length within ±8%
   - flat-side consistency on the neighbouring sides
   - **box prior**: sides of pieces whose top-k cells are adjacent get first priority
   - a cheap scalar prefilter (depth, knob and neck width and position)
2. **Shape score:**
   - mirror one side, align by Procrustes plus a few ICP iterations
   - dense residual with shoulders weighted more than the knob
   - corner-tangent continuity across the joint
   - trim ~5% at each end
   - compensate the ~1–2 px rim bias (bminaiev, jigsawlutioner)
3. **Colour score:**
   - sample a strip ~3% of the side length inside the **printed top-face** boundary (never the cardboard wall, §4), lighting-normalised
   - **count** points that agree, with tolerance learned from the box picture's own seams (puzzle-helper: 98% of true seams kept, 92.5% of wrong pairs rejected)
   - skip when the edge was in glare or overexposed
4. **Probability:**
   - logistic calibration combining shape residual, colour agreement, length difference, box-adjacency prior, rank and ratio to the runner-up, and mutual best
   - softmax per side with a "partner not scanned yet" option
   - trained on synthetic puzzles, then refit from your Fits/Doesn't-fit answers
5. **Confirmation:**
   - a closed 2×2 loop where all 4 pairs fit → "confirmed ✓"
   - near-ties shown as "2 possible fits"
6. **Health metric:** number of candidates within 2× of the best score (puzzle-bot's final model: ~2). Reported per scan.
7. **Evaluate by retrieval rank (top-1, mean rank), never by "pairwise accuracy".** A Siamese-network paper had 87% pairwise accuracy but the true mate was in the top 10 only 9% of the time.

**Go / no-go before M6 (on your real pieces, in M3):**
1. You assemble a ~7 × 7 block (49 pieces) and photograph it.
2. You break it up, scatter the pieces and Snap them. The assembled photo gives the true joins.
3. I measure, from detail photos, where each side's true partner ranks among all candidate sides, using **shape only**.

- **Go:** median rank ≤ 3 and top-1 ≥ 50%. M6 uses shape as a full partner in the score.
- **If not:** I first retry with extra-sharp 3×3 tiles (~250 px). If that still fails, M6 becomes **box-led**:
  - partners are suggested from box-picture neighbours;
  - shape only vetoes impossible pairs (tab/blank, length) and breaks ties;
  - the percentages say so.

I'll tell you the result in plain English before starting M6.

**Cost:** about 4M tab–blank side pairs at 1000 pieces before pruning; with length, type and box-prior pruning it is a few hundred per side. It runs incrementally in a worker as pieces arrive.

---

## 12. On-phone AI models

**Plain English:**
- A small AI image model *might* help match pieces to the box picture in tricky areas. The best candidate is a ~45 MB download that runs on the phone's graphics chip in a fraction of a second.
- It's an experiment: I'll only keep it if it measurably improves accuracy on test puzzles and your real photos.

**Embedding models compared** (file sizes from Hugging Face):

| Model | Licence | fp16 size | Notes |
|---|---|---|---|
| **DINOv3 ViT-S/16** | DINOv3 Licence (royalty-free, commercial use OK, must ship the licence, use restrictions, can be terminated) | 43 MB | Best dense correspondence at this size (NAVI 56.3); 255 ms per 224 px image on Mac CPU (measured) |
| **DINOv2-small** | Apache-2.0 | 44 MB | Control model; NAVI 53.4; 344 ms on Mac CPU (measured) |
| CLIP-B/32, SigLIP2-B/16 | MIT / Apache | 176–186 MB | Larger, and worse at dense correspondence |
| MobileCLIP-S0 | **research-only** | 23 MB | Can't ship |
| MobileNetV3/V4-small | Apache | 5–8 MB | Small, but no evidence of fine patch matching |

**Plan:**
- In M4, benchmark DINOv2-small (Apache, preferred if equal) against DINOv3-S (better on paper) against "no embedding".
- Cell descriptors come from dense patch features of the upsampled box picture. Piece descriptors come from the 4 rotated canonical crops, batched.
- Embeddings would act as a *shortlist/re-ranker* in front of ZNCC.
- Validate fp16 and q8 features against fp32 (cosine > 0.98).

The CV research cautions that these models are trained to ignore fine differences, so two "sky" cells may look identical to them. That's exactly why it's a benchmark, not a decision.

**Runtime:**
- onnxruntime-web ≥ 1.32 directly, or transformers.js 4.3+ for prototyping.
- On WebGPU: the JSPI build on Safari 27 (`"Suspending" in WebAssembly`).
- On CPU: the plain WASM build. Never the default `ort.min.js` on WebKit (5–6 GB compile blow-up).

**Expected cost:**
- On iPhone WebGPU: ~30–150 ms per piece, and ~1–5 s one-time setup per box (estimate, unverified).
- CPU fallback: ~1 s per piece.

**Hosting:**
- The model file is fetched by the GitHub Actions build and published with the app, so it's self-hosted on the same origin and cached for offline use. Nothing is sent anywhere.
- Meta's own DINOv3 repositories on Hugging Face are gated: you must accept the licence and be approved. That's one more reason to prefer DINOv2 if the two perform equally. The community ONNX export with an fp16 file (`-ONNX-MHA`) would be used if DINOv3 wins.

**Segmentation models** (SlimSAM, EdgeTAM, MobileSAM) aren't in the plan unless real photos defeat the classical method (§6).

**Vector search:** brute force is enough. One query against 5,000 vectors (384-d) takes 1.8 ms (measured).

---

## 13. GPU compute

**Plain English:** the phone's graphics chip can run the "compare every piece against every spot" maths about 30–100× faster than the main processor. I'll build the CPU version first, because it's needed as a fallback anyway and is fast enough when pieces are added one at a time. The GPU version gets added where the timing tests show it's needed.

- Masked ZNCC for all pairs reduces to three matrix multiplications ([4000 piece-rotations × 3072] × [3072 × 1000 cells]), about 74 GFLOP.
- Use a tiled kernel with workgroup memory and f16 storage, not one workgroup per pair (that would hit the 65,535 dispatch limit).
- Estimate: 0.1–0.4 s on an iPhone GPU vs ~15 s in single-threaded JS (estimate / measured).
- **Rules:** split work into small command buffers (an iOS 27.2 GPU-process crash on large submissions is open), reuse bind groups, watch `device.lost`, and keep a CPU path.
- **Decision:** WebGPU is an *accelerator* behind a feature check plus a timed self-test, with the result cached per device. No hard dependency.

---

## 14. Storage, offline and backup

- **IndexedDB via Dexie 4.4** (Apache-2.0): typed schema, compound indexes, bulk operations, live queries for the UI. I picked it over idb because the catalog needs indexed queries (status, zone, type, batch).
- Thumbnails and crops are stored as Blobs. Full-resolution photos are kept only while needed (and optionally for reports), since 12 MP photos are ~3–5 MB each.
- **Persistence:** `navigator.storage.persist()`, plus a nudge to install to the Home Screen (exempt from the 7-day wipe, more likely to be granted persistence). Storage use is shown on the Device check screen.
- **Backup:**
  - One `.pfbackup` file, a ZIP made with **fflate** (MIT) holding JSON plus images, streamed in a worker. Images are stored, not re-compressed.
  - iOS requires the share sheet to open within 5 s of the tap (§3). So the file is **prepared first** ("Preparing backup… ✓"), then "Share" opens instantly. If sharing is refused, a download link is offered.
  - Import restores a project completely and checks versions.
  - A minimal export arrives early (M2), because you'll start using the app on a real puzzle from M3. The full backup experience, with reminders, comes in M7.
- **Database upgrades:**
  - The database layout is **versioned** from day one (Dexie versions with upgrade functions).
  - Every change to it ships with an automated upgrade test that loads a database from the previous version.
  - A new app version can never wipe your catalog.
- **Interrupted work:** iOS freezes or discards web apps in the background. Long jobs (re-scoring, matching) record a "to do" marker in the database and resume when the app reopens. Merges are single transactions.
- **Offline:**
  - A service worker (vite-plugin-pwa 2.0 / Workbox) precaches the app, the OpenCV WASM and (once downloaded) the model.
  - Workbox skips files over 2 MiB by default, so the limit is raised explicitly (`maximumFileSizeToCacheInBytes`).
  - An explicit "Update available — reload" banner.

---

## 15. Hosting, deployment and testing on your iPhone

- **GitHub Pages + GitHub Actions** (`actions/deploy-pages` v5): still the standard.
  - Serves `.wasm` with the right type.
  - Limits: 1 GB site and 100 GB/month bandwidth; files over 100 MB need special handling (not an issue for us).
  - **Can't set custom headers**, hence no WASM threads (§3).
  - Free Pages needs a **public** repository.
- **This Mac is already signed in to GitHub** as `zivkogodzirov` (checked with `gh auth status`). If that's your account, no new account is needed. If not, M1 includes step-by-step account creation.
- **Testing on your phone:**
  - **Main path:** every push deploys to `https://zivkogodzirov.github.io/<repo>/` in ~1–2 minutes. You test that stable address, ideally installed to the Home Screen.
  - **For quick live-debugging sessions together:** a Cloudflare Quick Tunnel (`cloudflared tunnel --url http://localhost:5173`).
    - It needs no account and no phone setup.
    - It gives a new random address each time, which means new permissions and empty storage. Fine for a quick look, not for real puzzle data.
    - Vite blocks unknown host names by default, so the dev config allows `.trycloudflare.com`.
    - It also denies serving `test/fixtures/real/`, so your photos can't be fetched through the tunnel.
  - Exact numbered steps for you (open the address, Add to Home Screen, run Device check, send me photos and reports by AirDrop) are an M1 deliverable.
  - **Rejected:** a self-signed LAN certificate (service workers and Home Screen install unreliable). A mkcert root certificate installed on your phone works, but asks you to trust a custom certificate authority; not needed. Tailscale needs accounts and an app on your phone.
- **Automated browser tests:** Playwright 1.64 bundles WebKit 27.2.
  - Camera is simulated by replacing `getUserMedia` with a canvas stream playing our synthetic frames. Playwright ≥ 1.62 also grants mock capture streams.
  - A canvas stream can't take photos (`takePhoto()` rejects on it), so automated Snap tests feed photos through a stub.
  - It does **not** reproduce iOS memory limits, real lenses or Home Screen behaviour, so those are tested on your phone.
- **Routing:** GitHub Pages can't rewrite URLs for single-page apps, so screens use `#/…` addresses. The installed Home Screen app then always opens correctly.

---

## 16. Synthetic puzzles and test tooling

**Plain English:** to measure accuracy without endless real photos, I'll build a generator that cuts any picture into a realistic jigsaw, scatters the pieces on a virtual mat with markers, and photographs them with a virtual phone: tilt, blur, shadows, glare, noise, JPEG. Because it knows the right answer for every piece, every part of the app can be scored automatically.

**Generator** (TypeScript, so it also runs in the browser for a demo mode):
- **Cuts:**
  - classic grid with tabs made of cubic Béziers (own implementation; Draradech's CC0 generator is the reference idea)
  - jitter of head radius, neck width and knob position
  - a "uniform/ribbon cut" preset (low variation) to test the hard case
  - non-square cells, e.g. 36 × 28 with 19.4 × 17.8 mm cells
- **Scene:**
  - mat texture and colour
  - 8 markers
  - pieces with 2 mm walls (cardboard colour) and soft shadows
  - random rotation and spacing, a few touching or face-down pieces, and fingers/hands as distractors
- **Camera:**
  - pinhole model at 25–80 cm, tilt 0–25°, 1× / 2× focal lengths
  - lighting gradient, lamp shadow, glare spots
  - defocus and motion blur, Poisson-Gaussian noise, white-balance and exposure shifts
  - JPEG quality 60–95
- **Box picture:** a print-like colour transform (gamut, gamma, saturation), glare, slight crop, and the option of photographing it at an angle.
- **Ground truth:** per-piece outline, corners, side types, cell + rotation, neighbours, table position.
- **Artwork:**
  - public-domain / CC0 images with detailed and plain regions (sky, sea, foliage), with attribution kept in `test/fixtures/images/ATTRIBUTION.md`
  - procedural images
  - held-out by hash between tuning and reporting sets
- **Rendering:** OpenCV.js (in Node) for warps and filters, and `@napi-rs/canvas` (MIT) for anti-aliased drawing and JPEG encoding. No AGPL tools (Albumentations' successor is AGPL, so it's avoided).

**Discipline:**
- **Tune on validation sets** (val-48/300/1000) and **report only on frozen test sets** (test-48/300/1000). Harstil's weakness was exactly this.
- Score **end to end** (no ground-truth outlines) plus "oracle" modes to tell which stage failed.
- A photometric self-check confirms the generator itself is consistent: warping ground truth must give ZNCC ≥ 0.5, and the true rotation must win for ≥ 90% of pieces.

**Other tools:**
- Vitest 5 (unit and accuracy tests in Node)
- Playwright 1.64 WebKit (UI flows)
- a Mat-leak tracker wrapping every OpenCV allocation in debug builds
- a phone-paced "model clock" so timing tests are meaningful (puzzle-helper idea)

---

## 17. Changes to the brief, with reasons

| Brief said | I propose | Why |
|---|---|---|
| 4 printed markers | **8 markers** (corners + mid-sides, in the mat margin), 2 A4 sheets, each with a 100 mm check bar and a grey patch | The live view held close and the detail photos see only part of the table; more markers keep at least one in view. Detail photos are also registered from the pieces themselves (§5) |
| Snap at full resolution reads shapes | **Overview + guided detail Snaps** (about 4, up to 9) | Web apps most likely get ~12 MP. 300 pieces plus markers in one photo ≈ 85–100 px per piece, below the ~180–250 px needed for shape matching (§4) |
| Cataloguing from "Snaps or close-up live frames" | **Snaps only**; live video is for pointing and tracking | Live frames are lower resolution and can't be steadied (§4) |
| Markers in M5 | **Marker printing and per-photo registration move to M2**; simple per-frame marker tracking in M3; smooth tracking stays in M5 | Every measurement (mm sizes, distance guidance, rectification, piece-wall correction, detail-tile coverage) depends on markers, and highlights shouldn't slide off pieces in M3–M4 |
| Backup in M7 | **Minimal export in M2**, full backup experience in M7; versioned database from M1 | You'll use the app on a real puzzle from M3, so data must be protected earlier |
| Settings → Accuracy (with M8 tuning) | **Accuracy page in M5**, together with the Fits / Doesn't-fit buttons | So you can see how often the app is right as soon as you start answering |
| Grid confirm after the box photo (M4) | **Grid confirmed in the wizard from M2** (count + finished size + suggestions, manual entry) | Border counts in M3 need the grid; the grid doesn't need the box photo |
| WebGPU compute for heavy matching | **CPU first, WebGPU as an accelerator** when timing tests require it | Incremental per-piece scoring is ~15 ms on CPU. The CPU path is needed as a fallback anyway, and iOS WebGPU still has open crash bugs (§13) |
| Grid "commonly 40×25 or 38×27" | Grid suggestions include **36×28** (Ravensburger), use measured piece size and the flat-side ratio, and allow manual entry | Verified Ravensburger layout; edge count can't tell 126-edge layouts apart (§10) |
| (implicit) Photo of the box only | **Photo or import from Photos**, plus a box-to-grid correction | A maker's product image is often sharper and glare-free; box art is often cropped or extended (§9) |
| Benchmark ML segmentation "in research" | **Deferred to M2, with a trigger** based on your real photos | It only matters if classical segmentation fails on your photos; desk research found no reason to expect that on a matte mat (§6) |
| OpenCV.js | **Custom OpenCV.js 4.14 build: SIMD, separate .wasm, ES module, trimmed modules** | Official builds have no SIMD (measured: no v128 code), are 11–16 MB, and miss `cornerSubPix` (§18) |
| WASM threads | **No threads**; parallel workers instead | GitHub Pages can't send cross-origin-isolation headers; the workaround is unproven on iOS (§3) |
| "Walk me through creating the GitHub account" | **Use the account this Mac is already signed in to** (`zivkogodzirov`), if it's yours and you agree; otherwise the step-by-step walkthrough | Saves you a setup step (see `PLAN.md` §12 Q5) |

---

## 18. Tech stack versions (checked on npm today)

| Package | Version | Licence | Role |
|---|---|---|---|
| vite | 8.3.5 | MIT | build / dev server |
| typescript | 7.0.2 | Apache-2.0 | language (TS 7 native compiler) |
| preact | 11.1.1 | MIT | UI (light, ~4 KB) |
| @preact/signals | 2.11.4 | MIT | UI state (accepts preact 11) |
| dexie | 4.4.7 | Apache-2.0 | IndexedDB |
| vite-plugin-pwa | 2.0.0 | MIT | service worker / manifest (supports Vite 8) |
| vitest | 5.1.0 | MIT | unit and accuracy tests |
| @playwright/test | 1.64.1 | Apache-2.0 | WebKit UI tests (bundles WebKit 27.2) |
| OpenCV | 4.14.0 (custom build) | Apache-2.0 | vision in WASM |
| @techstark/opencv-js | 5.0.0-release.1 | Apache-2.0 | stock build (OpenCV 5.0, no SIMD, different module names) for early prototyping only |
| onnxruntime-web | 1.31.1 (use ≥ 1.32 when released) | MIT | embedding model (M4 experiment) |
| @huggingface/transformers | 4.3.2 | Apache-2.0 | prototyping alternative |
| comlink | 4.4.2 | Apache-2.0 | worker messaging |
| fflate | latest | MIT | backup ZIP files |

**OpenCV build details (as built in M1; `scripts/build-opencv.sh`, `vendor/opencv/BUILD-INFO.txt`):**
- OpenCV 4.14.0 with Emscripten 6.0.13. Run `build_js.py --build_wasm --simd --disable_single_file` with `--build_flags "-s EXPORT_ES6=1 -s ENVIRONMENT=web,worker,node -s INITIAL_MEMORY=32MB -s MAXIMUM_MEMORY=1GB -s ALLOW_MEMORY_GROWTH=1 -fwasm-exceptions -s EXPORTED_RUNTIME_METHODS=[getExceptionMessage,decrementExceptionRefcount,stackSave,stackRestore] -s EXPORT_EXCEPTION_HANDLING_HELPERS=1 -DHAVE_UNISTD_H"`, plus `-DCMAKE_CXX_STANDARD=17`. There is one build for all workers.
- *Found in M1:*
  - **Memory size.** OpenCV's `modules/js/CMakeLists.txt` appends `-s TOTAL_MEMORY=128MB` after our flags, and that silently wins. Every worker then started at 128 MiB, and the memory readouts could not show growth below that. The build script now patches the line, and `scripts/opencv/check-wasm.mjs` checks the result: the memory starts at 32 MiB.
  - **Errors.** With native WebAssembly exceptions, a C++ error caught in JavaScript neither rewinds the WebAssembly stack nor frees the error. About 1 KiB of stack is lost per error, so after about 65 caught `findHomography` errors the module dies. Each unfreed error also leaks about 0.8 KiB. Every catch now goes through `cvGuard` (`src/cv/loadCv.ts`), which restores the stack and frees the error. A test throws 2,000 errors in a row and the module is still fine.
  - **Other build fixes.**
    - `-DHAVE_UNISTD_H` is needed by OpenCV's bundled zlib with newer clang.
    - Newer Emscripten no longer exports `HEAPU8`, so memory is read through a Mat's buffer.
    - Python ≥ 3.10 is needed by emsdk.
- **Ship `bin/opencv_js.js` + `bin/opencv_js.wasm` (the unwrapped ES module), not `bin/opencv.js`.** OpenCV's build always wraps `opencv.js` in a UMD function, and an ES module inside that wrapper is a syntax error.
- Whitelist:
  - core
  - imgproc
  - video (LK flow)
  - calib3d (homography, calibration)
  - features2d (ORB)
  - objdetect (`aruco_ArucoDetector`)
  - `cornerSubPix`
  - optionally imgcodecs (JPEG decode), as the fallback if canvas readback is noisy (§3)
- The dnn and photo modules are **off**.
- Size (measured in M1): 5.8 MB WASM, 1.7 MB gzip, 1.3 MB brotli; JS glue 125 KB. On the Mac it loads in about 30–40 ms in Node.
- The built files are committed under `vendor/opencv/` with the build script, so CI doesn't need a 20-minute Emscripten build.
- **CI smoke test:** loads it in a module worker and checks that `aruco_ArucoDetector`, `cornerSubPix` and `calcOpticalFlowPyrLK` exist.

---

## 19. The M1 "Device check"

**What it reports.** Everything the brief §2 lists, recorded **separately for a Safari tab and for the Home Screen app**:
- getUserMedia maximum resolution and frame rate
- MediaStreamTrackProcessor
- ImageCapture / takePhoto
- torch
- focus and zoom constraints
- WebGPU
- OffscreenCanvas in workers
- Screen Wake Lock
- Web Share with files
- persistent storage

**What it also measures, because only your iPhone can answer:**
1. Real `getUserMedia` modes (4K30? 1080p60? 4:3 full-sensor at 30?), lenses and zoom range.
2. **Photo size per live format:**
   - `takePhoto()` with and without an explicit size, at 1× and 2×;
   - how long the camera mutes during a Snap;
   - the worker's frame gap meanwhile;
   - hangs and orientation.
3. **2× sharpness test:** marker-edge sharpness at 1× from height H vs 2× from 2H. Is 2× a true sensor crop?
4. File-input camera photo size and orientation.
5. MediaStreamTrackProcessor frame format (NV12?) and the cost of getting frames into WASM.
6. **Canvas readback noise probe** (fingerprinting protection).
7. WebGPU adapter limits, a timed compute self-test, f16.
8. Memory headroom: how large memory can safely grow before iOS kills the page (stepped test, with crash detection on reload).
9. Storage quota and whether `persist()` is granted.
10. Camera permission behaviour in the Home Screen app on your iOS version.
11. OpenCV SIMD speed for the core stages (segmentation, markers, LK flow) at 1080p and 12 MP. This sets the phone-to-Mac speed factor used by the automated timing tests.

---

## 20. Main sources

- **Reference projects:**
  - https://github.com/jellojm/puzzle-helper (`PLAN-hard-issues.md`, `PLAN-v0.20/22/23`, `js/vision/*`)
  - https://github.com/maksym-hrytsenko/puzzle-assistant (ADRs 0001–0004)
  - https://github.com/kellinwood/PuzzleSolver
  - https://github.com/Harstil/piece-finder
  - https://github.com/roksenhorn/puzzle-bot + write-up "Jigsaw Puzzle Robot, Or: How We Solved a Puzzle in 15 Months"
  - https://bminaiev.github.io/jigsaw-puzzle-solver-2
  - https://github.com/byWulf/jigsawlutioner
  - https://github.com/Kawaboongawa/Zolver
- **Papers:**
  - Hoff & Olver 2014 (https://www-users.cse.umn.edu/~olver/v_/puzzles.pdf)
  - Pomeranz et al. 2011 (best buddies)
  - Son et al. ECCV 2014 (loop constraints)
  - Gallagher CVPR 2012
  - Horprasert 1999 (shadow-aware background)
  - Mena et al. 2018 (Sinkhorn)
  - DINOv3 (arXiv 2508.10104)
  - Chiș 2024 (Siamese piece matching, retrieval vs pairwise)
- **Platform:**
  - WebKit blog posts listed in §3
  - https://developer.apple.com/documentation/safari-release-notes
  - MDN browser-compat-data 8.1.8
  - WebKit source (`AVVideoCaptureSource.mm`, `HardwareCapabilities.mm`, `WKFileUploadPanel.mm`)
- **OpenCV:**
  - https://github.com/opencv/opencv/blob/4.x/platforms/js/opencv_js.config.py
  - `build_js.py`
  - PR #23344 (separate wasm), PR #15371 (SIMD/threads)
  - JS tutorials on memory management
- **Ravensburger grid:** https://ravensburger-en.mindtouch.us/Product_Information/Ravensburger/Puzzles/Puzzle_FAQ
- **Detailed notes:**
  - [`research/notes-harstil-piece-finder.md`](research/notes-harstil-piece-finder.md)
  - [`research/notes-puzzle-bot.md`](research/notes-puzzle-bot.md)
  - [`research/notes-bminaiev-jigsawlutioner-zolver.md`](research/notes-bminaiev-jigsawlutioner-zolver.md)
  - [`research/notes-skeptic-review.md`](research/notes-skeptic-review.md)
