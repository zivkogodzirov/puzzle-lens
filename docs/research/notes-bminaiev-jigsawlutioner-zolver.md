# Piece Finder prior-art report: bminaiev, jigsawlutioner, Zolver

All three targets were read through `gh api` (source files, blog markdown, commit history). Nothing was cloned or run. I downloaded a few sample images into `(research scratch folder, not kept)/imgs/` to measure piece sizes in pixels. "(inferred)" marks anything I worked out rather than read. Where I give "px/side" it means the corner-to-corner side length of a piece.

---

## (a) bminaiev, "Solving Jigsaw Puzzle with bare Rust" (parts 1 and 2)

**Sources:** blog markdown at `bminaiev/bminaiev.github.io/_posts/2022-11-30-jigsaw-puzzle-solver.md` and `2022-12-25-jigsaw-puzzle-solver-2.md`. The live part-1 URL returned 404 to WebFetch. Code is in `bminaiev/jigsaw-puzzle-solver` (`src/figure.rs`, `border_matcher.rs`, `parsed_puzzles.rs`, `graph_solver.rs`).

**License:** the solver repo has no license (API returns `null`), so treat it as all rights reserved and take ideas only. The blog repo's MIT `LICENSE.md` is "Copyright (c) 2021 Paul Le", which is the Jekyll theme. It does not cover the posts or the solver.

### Imaging
- Phone photo (4032×3024, `img/prod/*.jpg`) of white pieces in a rough grid on a black table.
- Perspective is removed with a hand-written homography from 4 hand-clicked table corners. He first tried equal-step bilinear subdivision and says it was wrong: midpoints shift toward the camera, which broke physical fitting.
- For the 1000-piece puzzle he took 4 quadrant photos and stitched them. One frame of ~300 pieces is about **80 px/side** (inferred: I measured a full-resolution crop of `img/prod/1.jpg`).
- He blames the auto-solve failure partly on this: "with better picture quality it is definitely possible."

### Segmentation
- A pixel belongs to a piece if `R+G+B > localMean(R+G+B, radius 200) + 200`. An earlier global rule was `R+G+B ≥ 460/500`.
- Pieces are 4-connected components.
- Merged blobs larger than 1.5× the median area are split by greedy union-find in brightness order.
- Valid pieces need an area within [2/3, 4/3] of the median and a border of 50–3000 px.
- The border is ordered with greedy nearest-neighbour plus 2-opt reversals. The border is flagged bad if any consecutive gap² > 10.
- **Lesson:** OpenCV `findContours(CHAIN_APPROX_NONE)` gives this ordering for free.

### Corner detection (`figure.rs`)
1. **Candidates:** a border point is a candidate if its squared distance to the centroid is the maximum within a 10-point window (`CHECK_LEN=5`).
2. **Scoring:** try every 4-subset of candidates, in border order. Minimise:
   `score = Σ_{k=0..3} |π/2 − turn(p_k, p_{k+1}, p_{k+2})| × (max_k |p_k p_{k+1}|² / min_k |p_k p_{k+1}|²)`
   - `turn` is the change in direction between consecutive chords, folded to [0, π].
   - The ratio uses squared lengths, so a skinny or degenerate quad is penalised quadratically.
3. There is no sub-pixel refinement. Errors of a few pixels in a corner are absorbed later by pose optimisation during matching.

### Side descriptor and match metric (`border_matcher.rs`)
- **Descriptor:** the raw ordered border pixels between two corners. Every piece is first grown by 2 px, because the dark rim of the piece is missed by the threshold. Fitting with a signed offset failed because it could not tell a gap from an overlap.
- **Initial pose:** a frame built from the centroids of the two halves of the side (5 points skipped at each end).
- **Pose refinement:** coordinate descent over translation (step 10 px, ×0.3 decay down to 0.01) and direction (step 0.1). Skipped if the initial score is above 100.
- **Score = center + prev + next:**
  - **center:** symmetric and monotone. Each point is matched to the nearest of the next 3 points on the other side. Cost is `coef·max(0, d² − 0.2)`, with `coef = 6` on the straight shoulders and `1` on the tab/blank (a "socket" point is one more than 0.1·chord away from the chord). Averaged, and summed over both directions.
  - **prev/next (corner continuity):** take 10 points of each adjacent side near the shared corner, drop the first 2, join both pieces' points and fit a least-squares quadratic in the chord frame. Cost is `30·mean(max(0, |residual| − 0.25)²)`. The blog says straight lines failed and curves were needed.
- **Hard gates:**
  - A flat side never matches.
  - The flatness of neighbouring sides must agree (border consistency). A side counts as flat if no point is more than 0.1·chord from the chord.
- **Graph normalisation (`gen_relative_dists`):**
  `d'(a,b) = d(a,b) / (d(a, 2nd-best of a) · d(b, 2nd-best of b)) + 0.1·rank_a(b) + 0.1·rank_b(a)`
  This is a mutual ratio test.
- **Tuning:** constants were tuned by hand to minimise Σ log(rank of the true mate) over pairs already confirmed.

### Assembly and scale
| Attempt | Result |
|---|---|
| Greedy best-pair joining | Failed |
| Greedy with a threshold | Mostly wrong |
| 2×2 blocks, closing the 4th edge, joint pose re-optimisation | Better |
| Beam search (top 100 per size), seeded from border pieces | Better |

He then switched to **human-in-the-loop**:
- The tool proposes 3 new connected pieces next to the placed area.
- It checks the best 500 candidates per side, with a cost cap of 100 and limits of 250 and 50.
- The user marks each edge good or bad. A bad edge's cost becomes ∞; a confirmed edge removes all alternatives.
- Parallelised with rayon.

### Measured results (1000 all-white pieces, ~80 px/side)
- The correct 4th piece of a 2×2 corner was not in the top 24.
- In one case the true mate ranked 350th.
- He finished "almost the full picture by program suggestions" with interactive confirmation. Unparsed pieces were placed by hand.
- Earlier 500-piece puzzle: only the white half could be parsed. It was solved interactively.
- His key scaling insight: with ~10 plausible candidates per edge at 250 pieces, two-edge intersection is usually unique. At 1000 pieces it is ~40 per edge, and the search grows exponentially.

---

## (b) byWulf/jigsawlutioner (PHP)

**License:** MIT, "Copyright (c) 2017-2022 Michael Wolf" (`LICENSE`). `jigsawlutioner-cli` is also MIT. `jigsawlutioner-machine` (the LEGO conveyor scanner) has no license. I found no blog write-up; the README and commit messages are the documentation.

### Imaging
- One piece per image, about 1000 px wide, with backlight so the piece is a dark silhouette on white.
- A separate colour shot is used only to make a transparent cut-out.
- The fixture `tests/fixtures/piece2.jpg` is 909×1000 with the piece about **350 px/side** (inferred, measured).
- Segmentation:
  - Threshold: Rec.709 luminance ≤ 0.65·255 is piece.
  - Flood-fill the background from the 4 image corners.
  - Erode about 2 px (0.002·width).
  - Cut thin bridges.
  - Keep the largest blob.
  - Throw `CutOffPieceException` if the piece touches the image edge.

### Corner detection (`ByWulfSideFinder.php`), the strongest of the three
1. **Turn per border point:** the change in direction, in degrees, between the chord from the point 25 px of arc-length back and the chord to the point 25 px ahead (`derivationLookahead=25`, about 7% of a side; inferred ratio).
2. **Candidates:** local extrema with turn < −40° that are also the lowest within ±20 indices.
3. **Scoring:** every 4-subset sorted by index. Higher rating wins, with `R(v) = 1 − min(1, v)`:
   - **Opposite sides:** add `R(|d0−d2| / (0.4·min(d0,d2)))`. Reject if `|d0−d2| > 0.6·min`. Same for d1/d3.
   - **Aspect:** add `R(|min(d0,d2) − min(d1,d3)| / (0.5·min(d)))`. Reject if it exceeds `0.75·min(d)`.
   - **Straight shoulders:** resample each side to 100 points. For the first 10 and last 10 points, measure the distance to the corner-to-corner segment. Add `0.1·R(dist / (0.06·side))`. **Reject if any dist > 0.075·side.**
   - The maximum possible rating is 11.
   - Commit message on adding the shoulder test: "end parts should be straight… A few percent better quality."

### Side descriptor (`PieceAnalyzer.php` + `SideClassifier/*`)
**Normalisation:**
- Resample at 1 px, take a ±10-point moving average, resample to 100 points.
- Push each point **2 px outward** along its normal.
- **Drop 5 points at each end**, resample to 100.
- Rotate so the chord lies on the x-axis with the origin at the chord midpoint.
- Units stay in absolute pixels; there is no scale normalisation.

**Features:**
- Direction: flat if |depth| < 0.1·chord; otherwise in or out.
- Chord length.
- Depth.
- Widest point of the nub (width and centre).
- Narrowest point of the neck (width and centre).
- Shoulder "line distance": average, minimum and maximum y, skipping 20% at each end of each shoulder.

### Match metric (`WeightedMatcher.php`)
- **Hard gate:** one side must be in and the other out. Flat sides never match.
- **Pair features:** for example, `depth_in + depth_out` (≈0 when they fit), `−x_in − x_out` for the mirrored nub centre, width differences, `|chord_a − chord_b|`.
- Each feature group feeds a Rubix ML `RegressionTree(30, 6, 1e-4, 20, 10)`, saved in `resources/Model/*.model`.
- **Training data** (`jigsawlutioner-cli/AbstractModelCreatorCommand.php`): a 500-piece Ravensburger puzzle scanned in known order (`test_ordered`, 25×20). True neighbours are labelled 1. A same-direction side of another piece is labelled 0. Stratified 80/20 split; the score is 1 − MAE on the held-out 20%.
- **Final probability:** a weighted mean of the tree outputs, rounded to 3 decimals. Weights: BigWidth 0.948, CornerDistance 0.828, Depth 0.862, LineDistance 0.850, SmallWidth 0.957. The weights look like each model's test score (inferred).

### Measured accuracy (`tests/Service/SideMatcher/WeightedMatcherTest.php` history)
The metric is the mean 0-based rank of the true mate among all ~2000 sides of the 500-piece set (ties counted pessimistically).

| Change | Mean rank |
|---|---|
| Hand-tuned rules | 2.778 |
| ML trees | 1.75 |
| Further tuning | 0.977 → 0.702 |
| Add LineDistance feature | 0.482 |
| **Trim first/last 5% of each side** | **0.331** |
| **Shift points 2 px outward** | **0.313** |

- **Top-1 = 92.1%.**
- Caveat (inferred): this is evaluated on the same puzzle the trees were trained on, so it is optimistic.

### Assembly (`ByWulfSolver.php` + `Strategy/*`)
- **Greedy growth:** repeatedly take the side with the highest `(p1 − p2)·p1³` (best probability times its margin over the runner-up).
- Threshold passes (minimum p, minimum margin): (0.8, 0.5) → (0.6, 0.25) → (0.5, 0.1) → (0.01, 0.01).
- Group merging happens between passes.
- **Validators:**
  - Unique placement.
  - "Rectangle": no nubs beyond the border lines.
  - Realistic size: width and height within [0.8√N, 1.2√N].
- Weak pieces (p < 0.5, later 0.2) are removed, then blanks are filled.
- If the biggest group holds at least 90% of pieces, the solver makes 15 randomised fill retries.

### Timing (commits)
- Matching map, PHP with 10 workers: 500 pieces 30 s → 5 s; 2000 pieces 430 s → 164 s.
- "correctly solves test_ordered in 18 seconds and newyork in 32 seconds almost correctly."
- Sets in the CLI repo include 1008- and 1009-piece puzzles; I found no recorded results for them.

### Re-identification (`PieceRecognizer.php`)
- For each stored piece and each of the 4 cyclic side offsets, sum the per-side similarity on same-direction sides.
- Pixel tolerances: nub x 50, y 35, width 30; neck 45, 40, 45.
- Returns the argmax. **There is no reject threshold.**

### Failure modes (README)
- Only Ravensburger works: other makers "use too similar or even identical side forms."
- Colour is ignored.
- Needs one piece per image with backlight.

---

## (c) Kawaboongawa/Zolver (Python + OpenCV)

**License:** MIT, "Copyright (c) 2018 Kawaboongawa and co". `Img/peak_detect.py` looks like Marcos Duarte's `detect_peaks` without its header (inferred). It was an EPITA student project.

### Imaging
- Real puzzles are shot on a green cloth.
- Green keying in HSV: hue 100–185, value 70–255, and a saturation band set by mean saturation × `factor`. The factor starts at 0.41 and rises by 0.01 until extraction succeeds.
- Median blur 5; **resize to 640 px wide**; close/open with a 3×3 kernel; `findContours(RETR_EXTERNAL, CHAIN_APPROX_NONE)`.
- Contours shorter than 1/3 of the second-largest are dropped.
- The only real sample is `chien_rouge_20_1.jpg` (20 pieces), which gives about 40–75 px/side after the resize (inferred). The other samples (`craies_32`, `link_50`, `van-gogh`) are rendered synthetic pieces.

### Corner detection (`Img/filters.py: my_find_corner_signature`)
1. **Turning-angle signature:** unwrapped `atan2` of contour steps, differenced, then a 5-tap box filter, then a Gaussian with σ starting at 5.
2. **Peaks:** convex peaks above 0.3·max, plus concave peaks from the negated signal, using a roll trick for wrap-around.
3. **Candidate corners:** ordered 4-tuples of convex peaks where every arc gap is between N/8 and N/2 (N = contour length). Each side must contain 0, 2 or 3 convex peaks and 0, 2 or 3 concave peaks.
4. **Score:** per side, a flatness measure: the maximum distance of the (L2-normalised) turning-angle curve from the line joining its ends, after cutting out the longest negative run (the blank) or positive run (the tab). Sum over the 4 sides; argmin wins.
5. **Side type:**
   - No peaks: border.
   - 2 concave peaks inside a convex span: hole.
   - The reverse: head.
   - Otherwise undefined. On any undefined side, retry with σ+1, up to 15 (12 in green-screen mode).

### Match metric (`Puzzle/Distance.py`)
**Real pieces:**
- Gate: chord lengths must agree within 20%.
- Otherwise **colour only**: at each edge point, take the median colour in a 5-px disc inside the piece, convert to Lab **with L dropped** (a*b* only), and sum Euclidean distances over index-stretched resampling. Take the minimum over both directions.
- The only shape check is head↔hole compatibility.

**Synthetic pieces:**
- `colour × (1 + 0.3·√|Δlength|) × (1 + 0.001·shape)`, where shape is the fraction of points more than 5 px apart after aligning corners.
- Alignment is a rigid corner-to-corner snap (`Mover.stick_pieces`).

### Assembly (`Puzzle.py`)
- Start from a corner piece (2 flat sides) and greedily build the frame.
- Constraints: possible grid dimensions from N and the border-piece count, corner slots, border alignment.
- Interior: fill the empty cell with the most placed neighbours first (4 → 0), summing the diffs across all its neighbours.
- No backtracking.

### Accuracy and failure modes
- No numbers in the repo, only a video.
- Dropping L fails on grey and white puzzles.
- The threshold-factor loop is a hack.
- Greedy errors cascade.

---

## Synthesis

### Best known corner-finding method for real photographed pieces
**byWulf's exhaustive 4-subset search with the straight-shoulder test** is the strongest of the three.
- **Why it works:**
  - It tests what actually defines a corner: both sides leaving it are nearly straight and hug the chord for their first and last 10%.
  - Tab tips and neck inflections pass a "sharp turn" test but fail the shoulder test, and the hard rejects (0.6, 0.75, 0.075) remove bad quads before ranking.
  - It is the only method whose output was validated downstream, at 92% top-1 matching.
- **Resolution it needs:** about 350 px/side. Its constants (25 px lookahead, ±20-index suppression) are in absolute pixels. For Piece Finder (inferred), express them relative to √(piece area), e.g. lookahead ≈ 0.07·side.
- **Useful extras from the other two:**
  - bminaiev's rectangularity score (Σ|90° − angle| × max²/min² side ratio) is a cheap tiebreaker.
  - Centroid-distance maxima are a complementary candidate source when curvature is noisy at around 80 px/side.
  - Zolver's "raise σ until every side classifies" loop is a good retry policy.
  - Zolver's arc-length gate (each side between N/8 and N/2) is a cheap pre-filter.
- **Suggested composite (inferred):**
  - Candidates are the union of curvature minima and centroid-distance maxima, capped at about 12 (C(12,4) = 495 quads).
  - Apply byWulf's gates and rating, plus bminaiev's term.
  - Refine to sub-pixel by fitting lines to each shoulder and intersecting them. Neither repo does this; bminaiev compensated with pose search.

### Best known side-matching metric
- **Measured best:** byWulf's learned feature metric reached a mean rank of 0.313 and 92.1% top-1 among ~2000 sides, at about 350 px/side, with backlight, on Ravensburger only.
  - Its features amount to about 10 scalars, so it cannot separate near-identical cuts and depends on the manufacturer.
  - Its two biggest single gains apply to any metric: **trim 5% at each end of a side**, and **compensate rim under-segmentation by about 2 px**. bminaiev found the same 2 px fix on his own.
- **Most expressive design:** bminaiev's dense aligned-contour residual.
  - Pose-refined, with shoulders weighted 6× over the nub and a dead zone of 0.2 px², plus a corner-tangent continuity term from a quadratic fit across the joint.
  - Combined with **mutual second-best ratio normalisation**.
  - At about 80 px/side on all-white pieces it was still not discriminative enough (true mate ranked 350th once).
- **Colour (for Piece Finder's colour matching):** Zolver's edge-strip median colour is the only colour term among the three. Keep L rather than dropping it.
- **Recommendation for Piece Finder (inferred):**
  - Use byWulf-style scalars plus the direction gate as a fast pre-filter.
  - Use a bminaiev-style dense residual with ICP-like pose refinement, plus the corner-tangent term, as the main score.
  - Add a Lab colour-strip distance.
  - Calibrate with logistic regression on confirmed pairs, then apply a rank or ratio normalisation, such as byWulf's (p1 − p2)·p1³ or bminaiev's mutual second-best ratio.
  - All three found greedy assembly fragile. Use loop-closure checks (2×2), shape and size validators, and human confirmation; bminaiev's known-facts approach maps directly onto Piece Finder's highlight-and-confirm UX.

### Pixels per piece side
| Project | px/side | Pieces | Outcome |
|---|---|---|---|
| bminaiev | ~80 (inferred) | 1000, all white | Auto-solve failed; interactive worked |
| byWulf | ~350 (inferred) | 500 (1000+ sets exist) | 92% top-1; solved 500 |
| Zolver | ~40–75 (inferred) | 20 real | Colour-only; no metrics |

**Implication for Piece Finder (inferred):** 250 pieces in one iPhone frame at 12 MP gives roughly 90–110 px/side, which is bminaiev's regime. A 48 MP capture gives roughly 180–220 px/side. If shape matching matters, plan for 48 MP capture or fewer pieces per frame. Placing pieces on the box picture uses colour and texture and needs less resolution.

### Sources
- [bminaiev part 2](https://bminaiev.github.io/jigsaw-puzzle-solver-2)
- [bminaiev/jigsaw-puzzle-solver](https://github.com/bminaiev/jigsaw-puzzle-solver)
- [bminaiev blog source](https://github.com/bminaiev/bminaiev.github.io/tree/main/_posts)
- [byWulf/jigsawlutioner](https://github.com/byWulf/jigsawlutioner) (key commits `7c9985c`, `004fda4`, `b793cd1`, `6715e97`)
- [byWulf/jigsawlutioner-cli](https://github.com/byWulf/jigsawlutioner-cli)
- [Kawaboongawa/Zolver](https://github.com/Kawaboongawa/Zolver)