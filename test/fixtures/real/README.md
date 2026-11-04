# Your real puzzle photos

This folder holds **your own photos** (box picture, empty mat, mat with markers, pieces, Device check
shots…). They are the "Real set" in `docs/PLAN.md` §7.

## They stay on this Mac

- Everything in this folder **except this README** is ignored by git (see `.gitignore`), so your
  photos are never uploaded to GitHub or published with the app.
- The development server also refuses to serve this folder (`vite.config.ts`), so nobody can
  fetch your photos through a phone-testing tunnel.
- Because GitHub never has them, the online build simply skips the real-photo tests. They run here,
  on this Mac, before each release.

## Adding photos

1. Copy photos straight from AirDrop or Mail into this folder. JPEG, PNG and WebP work.
   (HEIC from the Photos app does not decode in the tests yet: export as JPEG, or send them with
   "Most Compatible" turned on.)
2. Optional: next to a photo, add a small label file with the same name plus `.json`, e.g.
   `mat-with-markers.jpg.json`:

   ```json
   { "markers": [0, 1, 2, 3], "note": "mat with 4 markers, phone on stand, 1x" }
   ```

   `markers` lists the printed marker numbers you can clearly see. The tests then check that the
   app finds at least those markers in that photo.

## How the tests use them

- `test/unit/core-real-photos.test.ts` runs on every photo here: it reads the photo the way a
  Snap is read (tile by tile: brightness, blown-out and crushed pixels), looks for markers, prints
  one line of results per photo, and checks the labels if there are any. It also checks that no
  OpenCV memory is left behind.
- The helper `test/helpers/realFixtures.ts` lists the photos and their labels. New tests should use
  it and wrap themselves in `describe.skipIf(photos.length === 0)` so they **skip when this folder
  is empty** (as on GitHub) instead of failing.
- Run them with `npm test` (add `-- --silent=false` to see the printed results).
