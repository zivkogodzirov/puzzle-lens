# Synthetic puzzles (test/synth)

Makes jigsaw puzzles, lays the pieces on the owner's white glossy table with the 8 printed
markers, and "photographs" them like a hand-held iPhone. Every photo comes with exact ground
truth, so detection and shape reading can be scored automatically (docs/PLAN.md §7,
docs/RESEARCH.md §16).

```ts
import { generatePuzzle, renderScene, segmentationScore } from '../synth';
const puzzle = generatePuzzle({ cols: 8, rows: 6, cellMm: [17.8, 19.4], seed: 1 });
const scene = await renderScene({ puzzle, seed: 2, camera: { x: 405, y: 305, heightMm: 600, tiltDeg: 3, imageSize: [2016, 1512] } });
const score = segmentationScore(found /* [{ outlineImg }] */, scene.truth);
```

- `index.ts`: `generatePuzzle`, `renderScene`, `segmentationScore`, `positionErrorMm`, polygon helpers.
- `cut.ts`: Bézier knobs with jitter; `'uniform'` = little variation. Shared sides are computed once,
  so neighbours are exact complements.
- `art.ts`: procedural "kiss-like" art (dark/mid tones, pale blue satin dress with a near-white
  sheen patch, beige steps, a plain wall at the top), or your own RGBA picture.
- `layout.ts`: random non-overlapping layout, deliberate touching pairs, face-down pieces.
- `scene.ts`: table-space drawing with @napi-rs/canvas, then OpenCV `warpPerspective` into the photo.
  Light stays linear (16-bit) until the sensor step, so glare keeps its headroom. A simple
  auto-exposure puts the white table at about 200–225 (like an iPhone metering a white scene);
  `exposure` (EV) and `whiteBalanceShift` (normalised to max 1) are small offsets on top. Glare
  still clips. Also: faint darker die-cut line around each top face, fine and slow
  brightness/colour texture on the table, warm lamp glare and a cool window reflection.
- `score.ts`: recall / precision at IoU ≥ 0.85 against the true top face, centre error in mm.
- `sets.ts`: frozen dataset definitions (`val48`, `test48`, `val300`, `test300`, `val1000`,
  `test1000`); validation and test use different art. Overviews: hand-held 1× at 650–750 mm
  (≈ 3.7–4.3 px/mm), all 8 markers in view (`allMarkersInView`, checked by the self-test);
  close-ups 2× at 600–650 mm; ~30 % of scenes have a hand/phone shadow.

Table frame: mm, origin at marker 0's centre, x right, y towards the viewer. Image px: OpenCV
convention (pixel centres at integers).

**Camera note:** `src/geo/pose.ts homographyForCamera` produces a mirrored picture for this table
frame, so the generator uses `cameraHomography` (same camera, mirrored back). `poseFromHomography`
reads height, tilt and foot point back exactly.

Preview pictures: `node test/synth/run-preview.mjs [outDir]` (default `test/synth/out/`, git-ignored).
Self-checks: `npx vitest run --project unit test/unit/synth.test.ts`.
