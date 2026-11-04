# Skeptical review of the three prior-art reports (Harstil, roksenhorn, bminaiev)

## 1. Doubtful or inconsistent claims

**Harstil report**
- **The "at most 25 pieces per frame … live video" weakness is a conflation.** `MAX_PIECES = 25` is the synthetic scene generator's cap (`tools/synth/scene.py:49`), not a limit in the app.
- **"Shape failures dropped from the denominator" is true in code but did not inflate the headline numbers.** `eval/run.ts:194,359` appends "(N shape fails)" to a row whenever N > 0. No row in `eval/reports/p2-test.md` has that suffix, so those runs had 0 shape failures, on ground-truth outlines.
- **"Corners 33% at 300 pieces" means nothing statistically.** A 300-piece grid gives about 4.5 expected corner instances out of n=335, and the same applies to "c:100%" at 100 pieces (inferred). Edge numbers rest on about 70 instances, so they are usable.
- **The n values are small and strongly subsampled.** The `--limit`/`perScene` cap at `run.ts:165` gives n = 247/335/457. The 95% interval on 77.9% at n=335 is ±4.4 points. With only 4 puzzles per set, the effective sample is smaller still, so the 300→500 "jump" is weak evidence either way (inferred).
- **"Top-5 is only 3–4 points above top-1, so the right cell is pruned at 8 px" is an unsupported causal guess.** A box-print vs camera mismatch would produce the same pattern. Only a measurement of coarse-stage recall can settle it.
- **The report header says `commit 472993d`, but HEAD is 8683065.** The numbers came from an uncommitted engine state, so they are not exactly reproducible.
- **"Val numbers partly in-sample (inferred)" is understated.** The README says it outright: "fitted weights, validation sets" (`README.md` ~L47).

**roksenhorn report**
- **"Consistent with the write-up's 26" is slightly off.** My recount of the example data finds 24 non-top-1 sides: 22 at rank 2, 1 at rank 3 and 1 at rank 4. The write-up (`puzzle-bot-doc/writeup.txt:289`) says 26 sides, all second guess.
- **The "phone app at 120–250 px per piece" framing conflicts with the bminaiev report's 90–110 px at 12 MP.**
  - My estimate (inferred): 250 Ravensburger pieces of about 19×18 mm, laid loosely at about 50% mat fill, give a core of roughly 100–130 px at 12 MP, 140–180 px at 24 MP and 200–260 px at 48 MP.
  - So 120–250 px only holds with 24–48 MP capture, which Safari may not provide (see §2).
- **"At 200 px the correct mate is 2.7 px vs 6.3 px wrong" assumes error scales linearly with resolution.** At low resolution, segmentation and quantization add a floor of roughly 0.5–1 px (inferred), so the separation will be worse than this.
- **The parallax figure of 0.9 mm uses r = 200 mm.** A 26 mm-equivalent lens framing a 600×450 mm mat sits at H ≈ 450 mm, where corners are at r ≈ 375 mm. That gives a wall shift of about 1.7 mm, roughly 9% of a piece side (inferred).
- **The 40×25 grid is not the Ravensburger standard.** Ravensburger 1000 is 36×28 = 1008 pieces, with 124 border pieces (verified, below).

**bminaiev report**
- **"byWulf's corner method is the strongest, validated at 92%" overstates the evidence.** The 92% figure is in-sample (spot-check C), was measured at about 350 px with backlight, and is an end-to-end matching number rather than a measure of corner accuracy.

## 2. Spot-checks

| # | Claim | Result | Evidence |
|---|---|---|---|
| A | Harstil test top-1 is 85.8 / 77.9 / 85.1%, and the README's 92/82/89/68/65% are val numbers | **Verified** | `repos2/piece-finder/eval/reports/p2-test.md`; `README.md` L47–55 |
| B | roksenhorn side-match top-1 is 99.38% | **Verified** by an independent recount: 3846/3870 sides, 40×25 grid, 1000 solved pieces out of 1001. The "26 second guesses" detail is **refuted** (24 sides, 2 of them below rank 2) | my script `(research scratch folder, not kept)/review_scripts/rank.py` on `repos2/puzzle-bot/example_data/{5_connectivity,6_solution}` |
| C | byWulf top-1 is 92.1%, mean rank 0.313, MIT license | **Verified.** The test file at commit `004fda4` records "last known 0.9214135021097" and "0.31329113924051", which implies about 1896 directed pairs (inferred). The in-sample caveat is **verified**: the model trainer (`jigsawlutioner-cli/src/Command/AbstractModelCreatorCommand.php`) loops over the same 25×20 grid as the test fixture `test_ordered` | `gh api …/tests/Service/SideMatcher/WeightedMatcherTest.php?ref=004fda4` |
| D | bminaiev: correct 4th piece not in the top 24, true mate ranked 350th, 4 quadrant photos | **Verified** (part-2 post, lines ~167–197; it also confirms piece walls are visible away from the photo centre). The "~80 px/side" figure is **unverifiable** (not measured here) | `bminaiev.github.io/_posts/2022-12-25-jigsaw-puzzle-solver-2.md` |
| E | Licenses | **Verified** via `gh api`: `license: null` for roksenhorn/puzzle-bot, markroberyoutube/puzzle_bot, bminaiev/jigsaw-puzzle-solver and Harstil/piece-finder. MIT for byWulf/jigsawlutioner and Kawaboongawa/Zolver | |
| + | Ravensburger 1000 = 36×28 | **Verified**: Ravensburger says a 1000-piece puzzle has 1008 pieces, 36×28 | [Ravensburger facts](https://Ravensburger.us/discover/jigsaw-puzzles/10-fun-ravensburger-puzzle-facts/index.html), [Ravensburger FAQ](https://ravensburger-en.mindtouch.us/Product_Information/Ravensburger/Puzzles/Puzzle_FAQ) |

## 3. Missing evidence and prior art

1. **Real-photo accuracy for placing pieces on the box picture at any size: none found.** Everything nearby is unquantified, so you will have to build your own real benchmark, registered against your ArUco mat.
   - WPI MQP (2022) combines SIFT, edges and colour. It reports only that accuracy "declined linearly" with piece count, has no numbers, and is copyrighted. https://digital.wpi.edu/concern/student_works/qf85nf844
   - Jigsaw Hints locates the piece on the box image with SIFT plus a ratio test and abstains when it is not confident. No numbers; it was tested on Blender-synthetic pieces. https://bdshrk.github.io/portfolio/jigsaw-hints
   - Stanford EE368 (2010), "Guided Jigsaw Puzzle Solver on Smartphone": not read. https://web.stanford.edu/class/ee368/Project_10/
2. **Shape matching on real Ravensburger pieces at phone resolution: only byWulf (about 350 px, backlit, in-sample).**
   - Chiș (2024) trained a Siamese network on real piece masks. It reaches 87.3% binary pair accuracy, yet the true mate is in the top 10 for only 8.98% of 167 queries.
   - Lesson: evaluate by retrieval rank, never by pairwise accuracy. https://studia.reviste.ubbcluj.ro/index.php/subbinformatica/article/download/7275/7054/13763
   - Also missing: statistics on how diverse Ravensburger's cut shapes are. byWulf's README only asserts that other makers' cuts are "too similar".
3. **What still resolution Safari can capture: unknown.**
   - caniuse/MDN list `ImageCapture.takePhoto` on iOS Safari from 18.4, but the main caniuse table disagrees.
   - Older iOS versions capped `getUserMedia` at 720p.
   - Whether you can get 24 or 48 MP needs an on-device test. The `<input capture>` path probably returns the native camera photo (inferred).
   - https://caniuse.com/mdn-api_imagecapture_takephoto, https://kiwix.lema.org/stackoverflow.com_en_all_2023-11/questions/51406654/how-to-access-full-camera-resolution-on-ios-safari
4. **[Corrected after review: wrong.** The official opencv.js whitelist has included `aruco_ArucoDetector` since 4.8; see RESEARCH §5/§18.] **ArUco in OpenCV.js is not in the stock build.** You need a custom whitelist build, or the pure-JS js-aruco2.
   - https://forum.opencv.org/t/using-aruco-from-opencv-js/13277
   - https://www.npmjs.com/package/js-aruco
5. **Learned piece segmentation:** there is a YOLOv11 puzzle-piece segmentation model; its license and accuracy are unchecked. https://huggingface.co/reeeemo/puzzle-segment-model
6. **Still missing entirely, with no measured prior art:**
   - Re-identification across rescans. byWulf's PieceRecognizer has no reject threshold, and roksenhorn's dedupe is position-only.
   - Calibrated placement probabilities on real photos.
   - Sub-pixel contour error on a dark matte mat.
   - Measured side-wall parallax under phone geometry.
   - iPhone timings for any pipeline.