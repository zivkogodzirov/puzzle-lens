# Harstil/piece-finder: competitor teardown

**Repo:** https://github.com/Harstil/piece-finder, branch `main`, HEAD `8683065` (2026-09-27).
- It has 4 commits made over 4 days (2026-09-23 to 09-27), 0 stars, 0 issues, and one branch.
- Every commit carries a `Co-Authored-By: Claude Opus 5.5` trailer, so it was largely AI-written.
- Read-only clone: `(research scratch folder, not kept)/repos2/piece-finder`. Nothing from it was run.

## 7. License (first, since it decides what you can reuse)
- There is **no LICENSE file**. The GitHub API returns `license: null` and `/license` gives a 404.
- `package.json` has `"private": true` and no `license` field.
- So the default applies: **all rights reserved**. Do not copy code, comments or prose. Ideas, algorithms and parameter values are fine to re-implement independently.
- README §Deploy says "Push the repo to a **private** GitHub repository", so being public may be accidental (inferred).
- Name clash: it is also called "Piece Finder", and it cites a `johnb8005/puzzle-piece-finder` as prior art. Pick another name.

## 1. Architecture, stack, frames on iOS, worker, performance
**Stack** (`package.json`): Vite 8, React 19, Tailwind 4, zustand, Comlink, idb-keyval and vite-plugin-pwa.
- `onnxruntime-web` is installed but **unused**. It is meant for a future learned segmenter.
- No OpenCV. The engine is hand-written TypeScript (`src/engine/`), about a 45 KB worker bundle.
- Its image primitives are checked against OpenCV with Python-generated goldens (`src/engine/__golden__/make_goldens.py`).
- The same engine runs in the Web Worker and in Node for evaluation.

**Camera** (`src/camera/camera.ts`, `session.ts`, `framePump.ts`):
- `getUserMedia` with `facingMode: {ideal:'environment'}`, ideal 1920×1080 at 30 fps.
- The camera only opens from a tap. Tracks stop on `visibilitychange` and reopen when the page is visible again.
- A generation counter prevents leaked streams.
- Torch is set via `applyConstraints({advanced:[{torch}]})`.
- The chosen lens is remembered in localStorage. iPhone virtual devices ("Back Dual Wide/Triple") switch to macro up close.

**Frame pump:**
- `requestVideoFrameCallback` (falling back to rAF), then `createImageBitmap(video)`, then the bitmap is transferred to the worker via Comlink.
- Only **one frame is in flight**; frames that arrive meanwhile are skipped, not queued.
- The worker draws into a reused `OffscreenCanvas` with `willReadFrequently`, downscaled to a **1280 px long side** (GPU resize), then calls `getImageData` (`src/worker/engine.worker.ts`).
- Box photos are capped at 4096 px because of the iOS canvas limit of about 16.7 MP.

**Other setup:**
- COOP/COEP `require-corp` is set (`vercel.json`, `vite.config.ts`) for threaded WASM later; everything is self-hosted.
- A capability probe (`src/worker/probe.ts`) checks WASM SIMD with a validate-bytes test, WebGPU `requestAdapter` with a 3 s timeout, and OffscreenCanvas 2D.
- IndexedDB holds a single active puzzle (`src/store/puzzleStore.ts`): photo blob, corners, grid and placed cells. The reference is rebuilt each launch rather than stored.

**Performance — all numbers are desktop Node; there are no iPhone numbers anywhere:**

| Stage | Number | Source |
|---|---|---|
| Segmentation at 1280 px | ~150 ms; README says the phone is "a few times slower" | `engine.worker.ts` comment |
| canonicalize, per piece (p50) | 4.8–11.2 ms | `eval/reports/p2-test.md` |
| match, per piece | 12–14 ms p50, 18–21 ms p95 | `eval/reports/p2-test.md` |
| Match budget per frame | `MATCH_BUDGET_MS=120`, guessed "for ~3–6 fps on a phone" | `src/engine/pipeline.ts` |

## 2. Segmentation (`src/engine/segment.ts`)
**Coarse pass:**
1. Downscale to a 400 px long side and convert to Lab.
2. Run k-means with **K=6** for 8 iterations. Lightness is weighted ×0.5. Centres are warm-started from the previous frame.
3. Any cluster holding ≥10% of a **border band** (6% of the short side) counts as "table". If none qualifies, the largest border cluster is used.
4. Each cluster's std has a floor of 3 Lab units.
5. A pixel is foreground if it is more than **3σ** from every table cluster.

**Shadow tolerance:** when a pixel is darker than a table cluster, the cluster's a and b are scaled by `max(0.35, L/Lc)` and the remaining ΔL counts only ×0.25.

**Cleanup:**
- Close and open with a 3 px ellipse, then fill holes.
- Keep components between 0.08% and 20% of the frame area that do not touch the frame edge.

**Refine pass:**
- Re-segment a crop of the full-resolution frame (25% margin) with a kernel of `max(3, round(max(w,h)/80)*2+1)`.
- Take the largest contour and run `analyzeShape`. Drop the blob if shape confidence is below 0.02. This shape check is the only filter against fingers and merged blobs.

**Failure modes:**
- From the README: touching pieces merge and are dropped, and pieces coloured like the table are missed.
- Inferred:
  - The table model is unreliable when pieces fill the frame border.
  - Pieces cut by the frame edge are ignored.
- No segmentation accuracy numbers are committed. `eval/segment-eval.ts` exists, with a hit at IoU ≥ 0.7, but no results are reported.

## 3. Shape reading (`src/engine/shape.ts`)
Prior art cited in the code: Yao & Shao 2003 candidate quartets, and puzzle-bot's shoulder-line refinement.

**Steps:**
1. Resample the outline at **48 samples per core side** (96–640 samples total).
2. Compute the turning angle at a scale of **core/12**. Local maxima of at least **40°** become candidates, up to 16. True corners measure ≥55°; tab heads about 40°.
3. Search all clockwise 4-subsets. A pairwise side-cost table is precomputed, so each quad costs O(1).
4. Pick the quad with the lowest total cost. Each term is (excess/tol)²:

| Term | Value |
|---|---|
| Shoulder deviation over the first and last 20% of the chord (3% skipped at the corner) | tol 0.03 |
| \|local turn − quad exterior angle\| | tol 12° |
| Interior angle | free within 90°±25°, then tol 10° |
| Quad area ÷ outline area | free in [0.68, 1.4], tol 0.08 |
| Opposite / adjacent side ratio | free up to 1.45 / 1.75, tol 0.1 |
| Overhang | free up to 0.12 |
| Excursion | free up to 0.5, tol 0.05 |
| Area reward | 1.0 |
| Reject threshold | cost > 200 |

5. **Confidence** = `exp(−cost/8)`, multiplied by 0.25 when the two flat sides are opposite. Three or more flats means rejection.
6. **Corner refinement:** fit lines to both shoulders by IRLS with Cauchy weights, 3 iterations, scale 1% of the chord (minimum 0.75 px). The window is [4%, 22%] of the chord, or up to 45% on flat sides. Use the intersection only if the lines meet at more than 25° and the corner moves at most 0.15·core.
7. **Side kind:** the largest signed deviation divided by the chord. Below **0.1** the side is flat (measured: flats ≤0.03, tabs/blanks ≥0.17). Otherwise it is a tab if the outward deviation is larger than the inward one, else a blank.

**Side-wall pull-back:** the mask includes the cardboard wall on the side facing the camera's nadir. Each fitted line facing the nadir is shifted back by `d = (nadir−p)·T/f`, where T = 0.1·core (measured board thickness 0.085–0.12 of core) and f = 0.73 × the frame's long side.

**Gap:** `eval/shape-eval.ts` computes corner error (≤0.05 and ≤0.10 of core) and side accuracy, but no results are committed.

## 4. Canonical piece, placement scoring, probabilities, locking
**Levels** (`src/engine/levels.ts`): 8, 16 and 32 px per cell. The margin is 3/8 of a cell (3/6/12 px), so windows are 14/28/56 px. Each level is an exact 2:1 area downsample of the next.

**Reference** (`src/engine/reference.ts`):
- The user drags 4 corners with a loupe (`CornerEditor.tsx`: 4× magnification, relative drag).
- One homography straightens the picture to square cells: ≤64 px per cell, capped at 8 MP total. Cells are forced square even when real cells are not; Ravensburger's 1000 is 36×28 with 19.4×17.8 mm cells.
- Sobel gradients are computed before padding, so the motif's own border does not look like an edge.
- The app warns when the photo gives fewer than 48 photo px per cell.

**Canonical piece** (`src/engine/canonical.ts`):
- One homography maps the 4 core corners to a 64 px core with a 24 px margin.
- Large pieces are first area-downsampled by `floor(core/64)`.
- The mask is the outline warped into canonical space: tabs kept, blanks excluded, eroded 3 px.
- A level pixel counts as "piece" only if at least 90% of it is covered.

**Pre-computed views** (`src/engine/match/prepare.ts`): for each level and rotation, the masked pixels are stored as an offset list. L, a and b are zero-mean and unit-norm, so ZNCC becomes `dot / sqrt(ref variance)`. Gradients are computed after rotating, on the mask eroded by one more pixel, and normalised to unit energy.

**Hypothesis search** (`src/engine/match/index.ts`):
- Hypotheses are every cell × 4 rotations, minus cells already marked placed.
- Flat-side border logic is a **hard filter** when shape confidence ≥ 0.3. Otherwise each contradicting side costs 2.0.
- 8 px level: every hypothesis, no shift. Keep the **top 48**.
- 16 px level: shift search ±2 px. Keep the **top 12**.
- 32 px level: ±2 px around twice the mid-level shift.
- Results are de-duplicated to one entry per cell.

**Score** (`src/engine/match/fusion.ts`, weights fitted 2026-09-27):

| Cue | Formula | Weight |
|---|---|---|
| Luma texture | `wLuma·min(1, σL/7.1)·ZNCC(L)` | wLuma = 2.66 |
| Colour pattern | `wChroma·min(1, (σa+σb)/7.1)·σ-weighted ZNCC(a,b)` | wChroma = 1.77 |
| Mean colour penalty | `−wChromaMean·Δab_mean/10` | 0.084 |
| Gradient | `+wGradient·Σ(g_p·g_r)/‖g_r‖` (cosine, not zero-mean) | 2.13 |
| Luminance stats penalty | `−wStats·(\|ΔmeanL\|/20 + \|ΔσL\|/10)` | 0.11 |
| Shape prior | `−wShapeMismatch·#mismatched sides` | 2.0 |

**Probabilities:**
- `prob = 0.95 · softmax(score/T)` over at most 12 finalists, with **T = 0.13**. The coarse heatmap uses T = 0.25.
- The weights were fitted by coordinate search (factors ×0.5, ×0.75, ×1.33, ×2; 2 rounds) on the objective `top1 + 0.02·logLik`, using 563 val pieces. T was then chosen by log-likelihood from {0.02 … 0.2}.
- Lesson recorded in the code: pattern cues gained weight and absolute-colour penalties lost most of theirs, because box print and camera colour disagree.
- There is no per-piece calibration beyond that single temperature.

**Verdicts:**
- **Strong:** p1 ≥ 0.7 and p1 − p2 ≥ 0.4.
- **Likely:** p1 ≥ 0.4 and margin ≥ 0.15.
- Otherwise unsure. The UI shows amber at p ≥ 0.35 (`src/app/scan/trackLook.ts`).

**Locking** (`src/engine/tracker.ts`, `pipeline.ts`):
- Tracks are matched frame to frame greedily by bounding-box IoU ≥ 0.3. A track dies after 6 unseen frames.
- Evidence is the per-cell sum of each frame's top-5 probabilities, divided by the number of matches. Up to 24 cells are kept.
- **Lock** = at least 2 matches, averaged p1 ≥ 0.55 and margin ≥ 0.25. It is recomputed every frame, not latched, so it can flip back.
- Locked pieces are re-matched only every 8th frame they are seen. The match queue puts the least-matched pieces first.
- Rotation comes from the latest frame only and is not accumulated.

## 5. Synthetic generator and how accuracy is measured
`tools/synth/` is Python with numpy, opencv-python, scipy and pillow. Output is deterministic per-item RNG streams with bit-identical files.

**Frozen eval sets** (`tools/synth/make_eval_sets.py`):
- Piece counts: 100, 300, 500, 1000, 2000.
- **val: 3 puzzles per count; test: 4 puzzles per count.**
- Scenes per set: 60 / 45 / 40 / 40 / 40. Cut style is mixed grid and irregular.
- Artwork is held out per split by a SHA-1 hash of the file name (70/15/15).
- `tools/synth/README.md` says the CC0 art download was "not run yet". If so, the eval motifs are likely **all procedural** (landscape, city, illustration, still life, garden), despite the main README's "CC0 paintings" (unclear).

**Realism parameters:**

| Area | Settings |
|---|---|
| Frames | 75% portrait 1080×1920; focal 1250–1550 px; tilt \|N(0, 9°)\| capped at 25° |
| Piece size | core ≈ 2600/√N ± 30%, clamped to 60–280 px (1000 pieces gives 60–107 px) |
| Layout | **at most 25 pieces per frame**; 18% touching, 8% overlapping (3–25%), 12% cut by the frame edge; face-down distractors Poisson(0.5) |
| Lighting | glare 40%, phone shadow 20%, light elevation 35–80°, shadow strength 0.2–0.5 |
| Camera | JPEG quality 60–95; defocus σ 0–1.6 px (+0–1.4 px with tilt); motion blur on 25% of frames, 2–9 px; vignette 0–0.35; read noise 0.5–2.8 levels; shot noise 0.01–0.06; white balance ±10%; exposure 0.78–1.22 |
| Print | black 0.03–0.09, white 0.9–0.98, saturation 0.85–1.08, gamma 0.9–1.12, ink ±3.5%; linen emboss on 45%; gloss 0.2–1; edge rim 0.9–3 px; wall thickness 0.085–0.12 of core |
| Tables | plain 22%, wood 26%, cloth 17%, pattern 20%, clutter 15%; 25% borrow motif colours |
| Box reference | photo 60% (3000–4000 px, ≤30° tilt, lid walls, glare streak); digital 20%; 1920 px video grab 20%; art crop/extension ±2% per side; badges and logos may cover the corners |
| Cuts | bezier tabs (head radius 0.108–0.132, neck half-width 0.062–0.084, knob at 0.5 ± 0.045 along the edge); irregular lattice jitter ±12%; cell aspect ≤ 1.25 |

**Measurement** (`eval/run.ts`):
- The reference is built from the reference photo and its ground-truth corners.
- The headline numbers use `--shape outline`: `analyzeShape` runs on the **ground-truth printed-face outline**, so **segmentation is bypassed**.
- Frames are at **full 1080p**, while the app processes 1280 px.
- **Shape failures are dropped from the denominator.**
- Only face-up pieces at least 60% visible count. Rotation is counted correct within 45°, given a correct top-1.

**Test results** (`eval/reports/p2-test.md`):

| Set | n | Top-1 | Top-5 | Strong precision (share) | Likely precision (share) | Top-1: corner / edge / interior |
|---|---|---|---|---|---|---|
| test100 | 247 | 85.8% | 88.7% | 97.1% (84.6%) | 43.8% (6.5%) | 100 / 82.7 / 86.5 |
| test300 | 335 | 77.9% | 82.1% | 92.8% (79.1%) | 38.9% (10.7%) | **33.3 / 57.5** / 84.9 |
| test500 | 457 | 85.1% | 88.8% | 96.7% (79.2%) | 63.2% (8.3%) | 62.5 / 59.7 / 89.7 |

- The README's 92 / 82 / 89 / 68 / 65 % are on **val**, the same sets the weights were fitted on, so they are partly in-sample (inferred).
- There are **no test results for 1000 or 2000 pieces**.
- The jump from 300 to 500 pieces shows variation between puzzles dominates with only 3–4 puzzles per set (inferred).

## 6. Real-photo results
**None.** `DATASET.md` reserves `split: "real"` and `background: "real"`, but no real data or numbers exist. Nothing has been measured on an iPhone.

## 8a. Ten ideas worth adopting (re-implement, don't copy)
1. **Corner-homography canonicalisation.** Mapping the 4 core corners to a square removes scale, rotation and perspective in one step, leaving only cell × 4 rotations × a small shift to search. Keep the tabs in a 3/8-cell margin as extra evidence.
2. **Exact 8/16/32 pyramid with top-48 → top-12 pruning and ±2 px shift search.** In their timings this costs about 12 ms per piece on desktop CPU.
3. **Pre-normalised offset-list views.** Masked ZNCC reduces to one dot product per hypothesis. This maps directly onto a WebGPU compute kernel.
4. **Texture-gated cue fusion.** Luma ZNCC fades out on flat pieces (σL/7.1), and gradient cosine is computed after rotation on an eroded mask. Keep the measured lesson: pattern cues beat absolute colour, because box print and camera disagree.
5. **Border logic hard only when shape confidence is high** (≥ 0.3); otherwise a soft penalty of 2 per contradicting side.
6. **Shape quartet search** with a pairwise side-cost table, turn-match and shoulder-straightness costs, IRLS Cauchy refinement of the shoulder lines, and a flat threshold of 0.1 chord (flats ≤ 0.03, tabs ≥ 0.17).
7. **Side-wall parallax pull-back** with T ≈ 0.1·core. This matters more for your wide 12 MP still shots, where pieces near the edges show their walls.
8. **Calibration fitting.** Use the objective top-1 + 0.02·log-likelihood, fit the temperature by log-likelihood, refuse to fit on test sets, and report "verdict precision of share".
9. **Generator and eval discipline.**
   - Separate oracle, outline and mask shape modes so errors can be attributed.
   - When using oracle corners, randomise the starting corner so rotation can't leak.
   - Run a photometric contract check: warping ground truth must give ZNCC ≥ 0.5, and the true rotation must win for ≥ 90% of pieces.
   - Version frozen sets and hold out artwork by hash.
10. **UX patterns:**
    - A grid-suggestion enumerator: ≤ 5% count error, cell aspect ≤ 1.35, cost `4·countErr + |ln aspect|/4`.
    - A loupe corner editor.
    - "Mark as placed" to exclude cells.
    - A Region finder that sums each piece's probability inside a selected area (≥ 0.5 glows).
    - A one-in-flight frame pump.

## 8b. Five weaknesses you can beat
1. **The evaluation overstates accuracy.**
   - Not end-to-end: ground-truth outlines, and shape failures excluded.
   - Validation numbers are partly in-sample, with 3–4 puzzles per size and no test numbers at 1000 or 2000 pieces.
   - Possibly procedural art only, no real photos, no iPhone timings.
   - Beat it with a real-photo benchmark, registered by your ArUco mat, scored end-to-end.
2. **No catalog and no re-identification.**
   - Live video handles at most 25 pieces per frame at 1280 px, so 1000-piece cores shrink to about 40–70 px.
   - Tracks are IoU-only and die after 6 frames; there are no persistent piece IDs and only one stored puzzle.
   - Your 200–300-piece stills plus a stored catalog plus re-ID is a different class of product.
3. **Weak at scale, and probabilities aren't calibrated per piece.**
   - Top-1 falls to 68% at 1000 and 65% at 2000 pieces (val).
   - Top-5 is only 3–4 points above top-1, so the right cell is usually already pruned at the coarse 8 px stage (inferred).
   - Border pieces are poor: corners 33% and edges 57% at 300 pieces.
   - "Likely" answers are right only 39–63% of the time.
   - There is no global one-piece-per-cell assignment. Locks aren't latched and rotation isn't accumulated.
4. **Classical segmentation with no fiducials.**
   - Touching pieces and table-coloured pieces are lost.
   - There is no metric scale, so piece-size consistency can't be used to reject merged blobs or to fix the core size.
   - Your dark matte mat with ArUco markers gives a rectified, metric plane.
5. **No piece-to-piece matching at all.** Tab/blank geometry is used only as flat versus not-flat. Edge-profile and colour-strip compatibility between pieces, plus constraint propagation from placed neighbours, are wide open to you.