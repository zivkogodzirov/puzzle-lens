# Research report: roksenhorn/puzzle-bot, a 1000-piece all-white puzzle solved by shape alone

## Sources
- Repo: https://github.com/roksenhorn/puzzle-bot. Python and C, 338 stars, last pushed 2024-07-25. It has no LICENSE file.
- Write-up: "Jigsaw Puzzle Robot, Or: How We Solved a Puzzle in 15 Months" by Mark Rober, Ryan Oksenhorn and Ian Charnas, the "44 pages" linked from the README. https://docs.google.com/document/d/1BUCGdZCe8JevGYF3pJ4ZjPqpcSgA7LF0kV6sWbHrT1Q/ (I read it through the text export.)
- Companion repo with the robot GUI and calibration: https://github.com/markroberyoutube/puzzle_bot. It also has no license.
- I read the code from a copy under `(research scratch folder, not kept)/repos2/` (`puzzle-bot-src/`, plus a sparse clone `puzzle-bot/` of `example_data/4_deduped`, `5_connectivity` and `6_solution`). Nothing from the repo was executed.
- I ran my own statistics scripts on the repo's real 1000-piece example data. They are in `(research scratch folder, not kept)/analysis/` (`conn_stats.py`, `conn_stats2.py`, `side_stats.py`, `piece_dims.py`). Every number labelled "my measurement" comes from these.

---

## 1. Imaging setup

**From the write-up (§1.1–1.8):**
- **Camera:** Google Pixel 8 Pro on its 5x telephoto (113 mm equivalent). Focus, shutter, white balance and ISO were locked, and "fancy noise reduction" was turned off. The phone was triggered and photos pulled over `adb`.
  - The companion repo disagrees. Its `src/camera_driver.py` has a `GalaxyS24` class using Samsung PRO mode: ISO 100, 1/15 s, manual focus, white balance 5300 K, 12 MP.
  - Its `src/config.json` holds fx = fy = 13815.9 px, k1 = 0.275, k2 = −2.269 and a perspective rotation of 0.347°. My guess is the camera was swapped at some point, or the class name is left over (inferred).
- **Lighting:** windows blacked out, because daylight changes caused bloom in the day and noisy, NR-smeared images at night. One Aputure Nova P600c at 4700 K and 100% brightness, in a softbox 72 in (1.83 m) above the table, gave 1400 lux on the pieces.
- **Backdrop:** a table painted with Musou black. Pieces lie face up and must not touch; the README asks for a gap of at least one dark pixel.
- **Calibration**, compared by RMS reprojection error:
  - OpenCV `calibrateCamera`: 0.278 px
  - OpenCV `calibrateCameraRO`: 0.161 px
  - Calib.io: 0.091 px (the one they used)
  - After that came a perspective warp, because the camera was not parallel to the table, and a rotation correction between camera and robot axes using `findChessboardCornersSB` on a jog of the robot.
- **Error sources they list,** each worth 1–10 px: lens distortion, aggressive noise reduction, bloom, non-square pixels, and exposure and focus changing when fewer pieces were in frame.
- **Parallax:** they approximated a telecentric lens by moving the camera far away, using the longest lens and cropping hard to the image centre. That pushed capture time from 10 to 90 minutes.

**Resolution, from the code and data:**
- Undistorted photos are 3935×2938. They are cropped to the central 2215×1698 (`CROP_TOP_RIGHT_BOTTOM_LEFT = (620, 860, 620, 860)` in `src/common/config.py`), and no downscaling is applied (`SCALE_BMP_TO_WIDTH = None`).
- A sample piece mask (`example_data/2_segmented/20240603_172453_(1132,153).bmp`) is 975×921 px including tabs.
- My measurement over all 1001 pieces: corner-to-corner side length (chord) has a median of 585 px on the short side and 705 px on the long side. The aspect ratio is 1.19 and the median side arc length is 1034 px.
- That works out to roughly 34 px/mm, or about 0.03 mm/px (inferred, assuming a standard 27×20 in, 40×25 puzzle).
- The required snap accuracy is 0.13–0.38 mm (write-up, "What makes this hard"), which is about 4–13 px at their resolution.

**Resolution history (git log on `src/common/vector.py` and `bmp.py`):**
- The constant `SCALAR` ("1.0 is tuned for around 100 pixels wide") went 5 → 4 → 2.5 (Mar 2024, with `BMP_WIDTH = 1050`, roughly 250 px pieces).
- Then 5.0 ("Speedups and 2x resolution", `BMP_WIDTH = 2100`), then 9.45 (2024-05-21, "Experiment: stop scaling photos").
- The 1000-piece run on 2024-06-03 used full resolution. They raised resolution twice on the way to success. That they did it because low resolution failed is my inference; it is not stated.

## 2. Segmentation (`util.binary_pixel_data_for_photo`, `src/c/find_islands.c`)
- It is a single global grayscale threshold: pixels with luminance (PIL 'L') above `SEG_THRESH = 145` count as piece.
  - Git history shows the threshold was retuned constantly: 190 → 180 → 150 → 190 → 150 → 135 → 125 → 135 → 120 → 130 → 145. The comment says "raise this to cut tighter into the border".
  - This is a sign that threshold bias moves the outline (inferred).
- **Cleanup:** pixels with 2 or fewer of their 8 neighbours set are removed iteratively, with backtracking. Commits also remove "peninsulas" and "outie dust".
- **Pieces:** 4-connected flood-fill islands with `MIN_PIECE_AREA = 400*400` px. Islands touching the crop border are discarded, since another photo will contain the whole piece.
- **Touching pieces:** `MAX_PIECE_DIMENSIONS = (1420, 1420)`; a bigger island raises "are two pieces touching?". This limit was raised three times for "an unusually large piece".
- **Contour:** border pixels are those foreground pixels with a 4-neighbour in the background. An 8-neighbour clockwise trace produces a dense integer polyline (median 319 vertices per side). Douglas–Peucker simplification is switched off because corner refinement needs the density. Points closer than 2.25 px are merged.

## 3. Corner detection (`src/common/vector.py`, `Candidate` and `select_best_corners`)
The windows below are written in units of S = `SCALAR` = 9.45.

**Stage A: score every contour vertex.**
- Two "spokes" are taken from each vertex: the circular mean of directions to the points 3·S along the contour, skipping the nearest 2.
- `angle_hij` is the counter-clockwise angle between the two spokes.
- **Hard filters:**
  - The corner must open toward the centroid: |midangle − bearing to centroid| < angle/2. For corners under 90°, within 45° is enough.
  - The angle must be between 15° and 150°.
- **Score,** lower is better (all terms in radians):
  `0.7·max(0, angle−90°) + 0.4·offset_from_center + 11·(stdev_h+stdev_j)² + 0.8·curve_score`
  - `stdev` is the angular standard deviation of the spokes over 8·S points, so straight legs score well.
  - `curve_score` takes 4-gap turning angles over ±9·S points, measures their triangular-weighted deviation from the mean, and maps it to `clamp(3·(0.4−dev), 0, 1)`. A value of 1 means a smooth arc, such as a tab or blank shoulder; 0 means a sharp corner.
  - Candidates scoring above 3.0 are dropped. Candidates within 2·S indices of each other are merged, keeping the better one.

**Stage B: pick the best 4.**
- Keep the 12 best candidates and score all 66 pairs as diagonal opposites:
  `1.2·(s0+s1) + 0.5·|Δbearing−180°| + 0.2·|r0−r1|/max(r) + 0.005·|Δmidangle−180°|(deg)`
- Keep the best 30 pairs and score all 435 pairs of pairs:
  `s01 + s23 + Σ 0.3·|gap_i − 90°|`, where the gaps are the angular gaps of the 4 corners sorted around the centroid.
  - If the smallest gap is under 10°, add `1/(gap+0.01)`. This also removes pairs of pairs that reuse a candidate (inferred).
- The write-up says they spent "more hours than we'd like to admit" tuning these heuristics.

**Stage C: refine corners by intersecting side lines** (`enhance_corners`).
- For each corner, take the contour points on each adjacent side lying 1.5·S to 6·S from the corner (14–57 px, about 0.4–1.7 mm, inferred).
- Fit a direction to each side and intersect the two lines to get an "idealized" corner. Points within 1.5·S of the old corner are dropped and the new corner is inserted.
- The motivation is dented or rounded corners.
- Quirk: `util.trendline` computes a least-squares fit but returns the first-to-last-point angle instead.

**Sanity checks** (`extract_four_sides`):
- At most 2 edge sides, and never two parallel ones.
- The checks for parallel sides (32), right angles (50) and roughly square shape are effectively no-ops. The first two compare radians against degree thresholds; the squareness check compares d02 with itself. This is my reading of the code.
- So the robustness came from the scorer, not from validation.

## 4. Side splitting and flat/tab/blank classification
- Sides are the contour points between consecutive corners.
- **Flat (border) test:** the mean perpendicular distance of all side vertices from the corner-to-corner chord must be below 0.75·S (7.1 px, about 1.1% of the chord).
  - Earlier versions used arc/chord ratio thresholds of < 1.07, then 1.04, then 1.015, and were replaced.
  - A comment from the roughly 250 px era (SCALAR 2.5) reads: "worst edge I saw was 1.5, best non-edge I saw was 3.3" (px). That is directly relevant to your resolution.
- **My measurement:** the 130 border sides have a maximum mean deviation of 3.50 px (median 0.84). The 3874 interior sides have a minimum of 22.1 px (1st percentile 35.8, median 60.5). That is a 6x gap.
- **There is no tab/blank classification at all.** Tab versus blank is only implicit in the shape comparison.
- The solver checks border consistency hard: exactly 4 corners and exactly 2(W+H)−4 = 126 border pieces (`board.build`), otherwise it raises.

## 5. Side descriptor and similarity metric (`src/common/sides.py`, `util.error_between_polylines`, `src/common/connect.py`)
- **Descriptor:** each side is resampled to 27 points equally spaced along its length (`SIDE_RESAMPLE_VERTEX_COUNT = 26` segments).
  - It is rotated so the chord is horizontal, with the first corner at the origin.
  - The candidate mate is rotated to 180°, shifted to min-x = 0 and reversed, giving its mirror-image "negative".
- **Prefilter:** reject the pair if the chord lengths differ by more than 8% (`SIDE_MAX_LENGTH_DISCREPANCY = 0.08`).
- **Error:** the sum over points of |dx| + |dy| (L1).
  - It is recomputed after a mean-offset shift (y shift clamped to ±5 px) and the smaller value kept.
  - The result is divided by the other side's arc length, so the score has no units.
  - The shift estimate as written is not a true signed mean, and `min()` guards against it (my reading).
- **Thresholds:** keep the pair if error ≤ `SIDE_MAX_ERROR_TO_MATCH = 3.5`, then keep only candidates within 6x of the best (`WORST_MULTIPLIER`). Every interior side must have at least one match.
  - The 3.5 cap went 0.70 → 1.20 → 1.80 → 3.5 over the project.
- **Cost:** all-pairs, 8 processes. A comment says "Building the graph took 440.38 seconds".

## 6. Handling ambiguity at 1000 pieces (`src/common/board.py`)
- **Search:** best-first search with a heap (commit "Best-first search = 100x solving speedup", 2023-05-14). The README's "depth-first" description is outdated.
  - Each state is a full board copy.
  - The priority is only the error of the newest link, not a running total. Ties prefer boards with fewer pieces placed.
- **Order:** start from a corner and walk clockwise in a spiral, turning when the next cell is occupied or out of bounds. Only the newest piece's side facing the direction of travel is expanded.
- **Constraints** in `can_place`:
  - Border cells need edge sides facing outward, and interior cells must have no edge sides.
  - Every already-placed neighbour must appear in the matching side's candidate list. Only membership is checked; the error value and the side index are not.
- **Restarts:** corners are sorted by total candidate count so runs are repeatable. If the border (126 pieces) isn't completed within 1000 iterations, that corner is abandoned ("we chose the wrong corner"). The hard cap is 150M iterations.
- **Results (write-up §2.8–2.9):**
  - Early versions averaged 13 close matches per side (over 50,000 graph edges). The solver failed after 24 h and more than 100M paths.
  - The final version had 6 close matches per side. "For all but 26 sides, the correct match was the first guess, and those remaining 26 were the second guess."
  - The solve took 1026 steps (1000 is perfect) and under 1 s.
  - The final solve made zero errors. Assembly needed the physical "wiggle" routine with registration strips.

## 7. Measured numbers and failure modes

**My measurements on `example_data/5_connectivity/connectivity.json` against `6_solution`** (40×25 grid; 1001 pieces in the graph, one of which, id 168, is not in the solution and the reason is unknown):
- **Top-1 accuracy, by proxy:** for each side, I took the rank of the first candidate that sits in a neighbouring grid cell.
  - Rank 1: 3846 of 3870 sides (99.38%)
  - Rank 2: 22 sides; rank 3: 1; rank 4: 1
  - This is consistent with the write-up's "26".
- **Error ×1000:**

  | | p10 | median | p90 | max |
  |---|---|---|---|---|
  | Best match | 166 | 225 | 297 | |
  | Correct match | | 225 | | 606 |
  | 2nd-best | | 517 | | |

- **Margin** where top-1 is correct (best wrong ÷ correct): p1 1.12, p5 1.35, p10 1.54, median 2.31.
- **Candidates per side:**
  - Within 1.5x of best: mean 1.14
  - Within 2x: mean 1.99
  - Within 3x: mean 10.3, median 4
  - Whole stored list: mean 125
- **In physical units (inferred, about 34 px/mm):**
  - Correct mate: about 8.6 px L1 per sample point, roughly 0.18–0.25 mm.
  - Best wrong mate, median: about 20 px L1 per point, roughly 0.6 mm.
  - In the tightest 1–10% of cases, the wrong mate is only about 0.03–0.1 mm worse per point.

**Failure modes they named:** bloom, noise-reduction artefacts, exposure and focus drift with piece count, lens distortion, camera tilt, axis misalignment, parallax, dust and hairs, touching pieces, dinged corners, wrong start corner, and graph density blowing up the solver. On the physical side: assembly came out 2% too tight (fixed with `TIGHTEN_RELAX_PX_W/H = 5.70/9.12`) and pieces flipped over. End to end the run takes 5–6 h, against 25–40 h predicted for the human champion.

**Re-identification across photos** (`src/common/dedupe.py`):
- Done by position: robot-space centroids within 22 px are treated as the same piece. The copy nearest the photo centre is kept, to minimise parallax.
- Geometry is only a double-check: the summed error over 4 sides, with no mirroring, trying cyclic side orders with sides aligned within 12°, warns if above 2.2.
- They tried and abandoned a thumbnail approach (10x downsample, 120×120 pad, normalised SSD < 3.0), per `src/scripts/dedupe_test.py` and PRs #9/#10.

## 8. License
- Neither `roksenhorn/puzzle-bot` nor `markroberyoutube/puzzle_bot` has a LICENSE file; GitHub reports `license: null`. The README has no grant either, so default copyright applies. Do not copy code.
- The Google Doc is also copyrighted, so paraphrase it only.
- Algorithms, parameter values and measured numbers can be used as ideas (general understanding, not legal advice).
- Issue #12 ("Public dataset") is open. The example data (151 JPGs, masks, vectors, connectivity graph, solution) is usable for private benchmarking at most; ask the author before redistributing (inferred).

## 9. Lessons for a phone app at 120–250 px per piece
1. **You will have 2.5–5x less resolution than the evidence covers.** Their 99.4% top-1 came from about 585–705 px piece bodies, 0.09 px calibration error, locked exposure and a near-telecentric crop.
   - At 200 px (about 11 px/mm, inferred), a correct mate differs by about 2.7 px L1 per point and the median wrong one by about 6.3 px. The tight 10% of cases differ by under 1 px.
   - Threshold bias, homography error and parallax are systematic and do not average out over 27 points.
   - Expect shape-only top-1 to drop well below 99% (inferred). Use shape as a strong filter and verifier, and rely on box-image appearance plus colour for ranking.
2. **Get the contour right before anything else.** Replace the global threshold and integer border trace with sub-pixel edges, for example by interpolating along the normal on a lightly blurred grayscale image (inferred).
   - Set the threshold per frame from the mat's luminance near the ArUco markers or by Otsu per tile. They retuned a fixed threshold 11 times.
   - Average 2–3 frames (inferred).
3. **Scale every pixel constant with piece size** using a factor like their S (1.0 per 100 px).
   - Their windows were: angle 3·S, straightness 8·S, curve ±9·S, merge-nearby 2·S, corner-refit band 1.5–6·S, flat threshold 0.75·S.
   - Absolute constants that must also scale: merge 2.25 px, y-shift clamp ±5 px, minimum area 400², maximum 1420.
   - At S ≈ 2 the corner-refit band is only about 3–12 px, so use a robust total-least-squares or RANSAC line on sub-pixel points (inferred).
4. **Corner finder recipe worth reproducing as ideas:** score each vertex for sharpness, opening toward the centroid and straight legs. Penalise smooth arcs, since tab shoulders are the classic false corner. Then search the best 4 with diagonal (180°) and quadrant (90°) consistency, and refine by intersecting fitted side lines.
   - Add real validation they lacked: opposite sides parallel, right angles, squareness.
5. **Flat sides are easy and robust:** mean deviation ÷ chord was 0.54% at most for border sides versus 3.4% at least for interior sides. At about 250 px they saw at most 1.5 px versus at least 3.3 px.
   - Add tab/blank from the sign of the maximum deviation relative to the inward normal; the robot didn't need this (inferred).
   - Use flat-side count as a hard constraint (exactly 4 corners and 2(W+H)−4 border pieces) for consistency and error detection.
6. **Matching:** chord length ±8% as a cheap prefilter, then a mirrored, chord-aligned, arc-length-resampled distance normalised by length.
   - Anchoring at corners makes corner error the dominant noise, so add a small rigid alignment (Procrustes/ICP) instead of their one-shot shift (inferred).
   - Track **candidates within 2x of best** (theirs: about 2) as your main health metric; solve time and ambiguity depend on it.
7. **Calibrated probabilities:** their data suggests a ratio feature (best wrong ÷ best) is informative: p10 1.54, median 2.31. Feed the ratio plus absolute error into a logistic or isotonic calibrator trained on a solved puzzle (inferred).
   - Global one-to-one constraints (each cell or side used once, border rules) mirror their solver's pruning and should sharpen top-5 placement (inferred).
8. **Parallax from piece thickness:** they cropped to the centre and kept the copy nearest the centre. A phone held 40–50 cm above 200–300 pieces sees side walls on outer pieces, which may shift the outline by about t·r/H ≈ 2 mm × 200/450 ≈ 0.9 mm (inferred). That is larger than the 0.18–0.25 mm correct-mate error.
   - Take overlapping shots and keep each piece's most central view, or correct radially (inferred).
9. **Re-identification:** their position-based dedupe only works when pieces don't move. For rescans you need a rotation-invariant signature.
   - Their geometry check (4 sides, cyclic rotations, ±12° alignment, no mirroring) is a good verification step after a colour/shape shortlist.
10. **Light and exposure:** diffuse light around 1400 lux and expose for the highlights to avoid bloom on light pieces. Exposure and focus drifting with scene content was a named failure, so lock them where Safari allows and normalise from the markers otherwise (inferred).