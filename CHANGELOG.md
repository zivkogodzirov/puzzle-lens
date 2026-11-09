# Changelog

All notable changes to Puzzle Lens (working title in M0: "Piece Finder") are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow the milestones.

## [Unreleased]

### M4 (part 3): knob shapes decide between look-alike pieces (2026-11-09; tested in the app on the Mac and checked on your iPhone)
- **Holes' knobs from your holes photo:** where a hole borders a piece still in place, the app reads whether the missing piece had a knob out (the hole reaches into the neighbour) or a knob in (the neighbour's knob reaches into the hole). On your photo, all 33 readable sides were right (checked by eye and against the seams of your complete-puzzle photo); 3 were left unread.
- **Pieces' knobs:** each scanned piece now keeps its four sides (knob out, knob in, flat).
- **Fitting them together:** a piece's knobs must match the hole's outline, and two pieces in neighbouring holes must lock together (knob out against knob in). This sorts out the plain wall pieces that look the same.
- **On your 21-piece photo, in the app** (your holes photo and pieces photo chosen again): **17 Strong, all right**; 1 Likely (right); 2 "several spots" (two wall pieces with the same knob pattern, which only differ by a faint line on the wall); 3 "fit none" (the bottle's label, a patch of table, and one shadowed wall piece whose colour read too dark). Before: 8 Strong. The corner group now has every wall piece in its true hole except those noted.
- **Computer-made puzzles, two groups of holes like yours:** 300-piece puzzles: right spot **89 % → 98 %**, Strong 19 % → 54 % of pieces (all right); 48-piece: 94 %, Strong 79 % → 91 % (99 % right).
- **To switch it on with your existing scan:** choose your holes photo again, then scan your leftover pieces again (Delete scanned pieces → Delete and scan again). The puzzle page says so until it's done.

### M4 (part 2b): your holes photo is now recognised after the first photo (2026-11-09; tested in the app on the Mac and checked on your iPhone)
- **Why your test showed the same wrong "Strong":** the app never switched to empty-spots mode. After the first photo, the scan screen moves to close-ups, and close-ups were never checked for a finished puzzle. Your holes photo was read as a close-up of loose pieces: its holes weren't looked for, and 11 of its spots were even added as "pieces". **Fixed:** every photo is checked for a finished puzzle, close-up or not (a close-up of part of the puzzle can't count up to 1,008 pieces).
- **A tip on the puzzle page** when no empty spots are saved: "Most of the puzzle done? … pick one photo of the whole puzzle with its holes."
- **Tested in the app itself** (the same build, run on the Mac with your photos, so they never go online): new puzzle with your box picture → your 21-piece photo → your holes photo while on close-ups → "21 possible gaps … Saved". On the puzzle page: 8 Strong, 5 Likely, 8 "Several spots look alike", and 2 "fit none" (the bottle's label and a patch of table). Checked against your finished-puzzle photo with the pieces in place: **all 8 Strong are right**, and the Likely ones look right too. Column 28, row 28 can no longer come up: it isn't an empty spot.
- Without the holes photo (whole picture), about 1 "Strong" in 25 is still wrong on real pieces. Use the holes photo whenever most of the puzzle is done.

### M4 (part 2): leftover pieces go only into the empty spots (2026-11-09; checked on your iPhone together with part 2b)
- **Why:** your two screenshots showed "Strong" on wrong spots (column 28, row 28 by the steps; column 13, row 10 at the man's elbow). Neither is one of your 21 holes. With 987 pieces already in, searching the whole picture made no sense.
- **Empty spots are saved:** a photo of the puzzle with its holes (the finished-puzzle check) now keeps those spots. It works even if the photo shows the puzzle sideways or upside down: the app turns it to match the box picture. A photo with no holes clears them.
- **Leftover pieces go only there, one per spot:** each piece is compared only with the empty spots, its colours are matched to those spots' colours, and two pieces can't take the same spot. How sure ("Strong", "Likely") now also counts the other pieces competing for a spot. Something matching none of the spots (a label, a patch of table) says **"Fits none of the empty spots"**.
- **On the puzzle page:** a green box says the pieces are matched to the N empty spots, with **Use the whole picture instead**. Tapping a piece shows all the empty spots as light squares, its spot in green.
- **On your 21 pieces** (with your box picture taken from your screenshot): right spot for about **14 of 19 real pieces** (was 5 of 21); **9 Strong, all right**; 2 Likely, both right; no wrong Strong. Around the faces: 9 of 10 right. The mistakes are plain wall pieces swapped between top-right holes. Checked against your finished-puzzle photo (IMG_9272) with the pieces still in place.
- On computer-made puzzles (every piece's spot plus 20 % more empty spots): right spot for **95 %** (48 pieces) and **87 %** (300 pieces, nearly every spot open); "Strong" right 99.7–100 %.
- Chances are now shown as at most 99 %.

### M4 (part 1b): fixes from your real test with the 21 pieces (2026-11-08; not yet checked on your iPhone)
- **What your test showed.** Your holes photo (IMG_9280) gives the true spots of your 21 pieces (IMG_9276): 10 from the top-right corner (columns 24–28, rows 1–2) and 11 around the faces (columns 17–20, rows 7–9). Your box picture lines up with the real puzzle to within about a tenth of a piece, so the box picture was fine. Three things went wrong on the piece side:
  1. **Pale pieces were outlined wrongly.** On your white table, the beige wall pieces are close to the table's colour, so their outline cut into the piece (9 of 21). Every straightened piece was then crooked. **Fixed:** where colour can't tell, the app now uses the print's fine linen texture (the table is smooth). All 21 pieces are now outlined along their real edge.
  2. **The app was far too sure of itself.** It called 14 of your 21 pieces "Strong", and 9 of those were wrong. **Fixed:** the confidence is now fitted on your real photos. "Strong" is now rare on real pieces but right (25 of 25 spots cut from your finished-puzzle photo; 3 of 4 of your loose pieces), and most real pieces honestly say **Several spots look alike**, with the possible spots shown.
  3. **Matching real pieces is hard.** Even with clean outlines, your 21 pieces put a right spot first for only **5 of 21**, and in their top 5 for **7 of 21**. The 10 plain wall pieces are close to impossible by colour and pattern alone (the wall is a large part of the picture). Shiny dark pieces under a lamp look grey-blue, and a batch from only two areas skews the colour match.
- **Finished-puzzle check with pieces out.** On your holes photo, the check now finds the puzzle's corners (pieces were missing at a corner) and lists **exactly the 21 empty spots**, with no false ones. Your complete-puzzle photo still shows none.
- Known, not fixed yet: other things on the table can be taken for pieces (the bottle's label, a patch of table).

### M4 (part 1): where each piece goes on the box picture (2026-11-08; not yet checked on your iPhone)
- Every scanned piece now gets its **best spot on the box picture** (column and row from the top-left), how sure (**Strong**, **Likely**, **Several spots look alike**) and up to 4 other possible spots. On the puzzle screen: "On the box picture: N strong · N likely · …"; tap a piece to see its spot marked in green on the box picture. Thumbnails get a green (Strong) or yellow (Likely) dot.
- How: each piece is straightened by the 4 corners its shape reading found, then its colours and pattern are compared with every spot of the box picture in all 4 turns (coarse to fine); edge and corner pieces only go to matching border spots.
- Measured on computer-made puzzles: right spot first for 92 % (48 pieces) / 84 % (300 pieces), top 5 for 99 % / 92 %; "Strong" right 95–97 %. On your real pieces: not measured yet (see `docs/M4-CHECKLIST.md`, Part D).
- Pieces scanned before this version have no spot until scanned again.

### M3 (part 2): fewer "Not sure" pieces (2026-11-08; not yet checked on your iPhone)
- A single piece with long knobs at both ends was taken for two touching pieces (on your photo IMG_9276: 4 pieces). When its outline reads as one clean piece, it now counts as one.
- Shape reading no longer marks pieces down for being ~10 % smaller than their grid cell (the traced top face always is), and it trusts a read when every side is clearly flat or clearly not flat.
- On your photos: the 26 brown pieces (IMG_9263/9264) are all read as inside pieces, none as border, none not sure; IMG_9276: 1 corner, 4 edges, 3 not sure (pale, shiny pieces whose outline is only partly traced). On computer-made photos 97 % of reads are now trusted (was 87–95 %), still 97 % right.
- The **Not sure** button only shows when at least one piece is not sure.
- Still not sure: pale or shiny pieces whose outline is cut by glare. A 2× close-up, or less direct lamp light, helps.

### Scan a photo from your library (2026-11-08; not yet checked on your iPhone)
- On the scan screen, **🖼 Choose a photo** picks a photo you already took. It is read exactly like a camera photo: as an overview, or as a 2× close-up when **Close-ups 2×** is selected. A finished puzzle's photo gets the finished-puzzle check. Use the original photos, not screenshots (a screenshot is smaller and includes the app's buttons).

### M3 first part: shapes, Border mode, finished-puzzle check (2026-11-08; not yet checked on your iPhone)
- **Shape reading:** each piece's 4 corners and each side as flat, tab or blank, from its outline (works the same face down). On computer-made test photos the piece type is right for ~96 % of clean pieces.
- **Border mode:** on the puzzle screen, buttons **All / Border / Inside / Not sure**; corners framed orange, edges teal, with "Corners n of 4 · Edges n of 120" for your 28 × 36 grid, and a warning if there are more than the grid allows.
- **Finished-puzzle check:** an overview of a finished puzzle now says "28 across × 36 down = 1,008 pieces" (counted from the seams), whether that matches your puzzle, and any gaps (red squares on the photo). It isn't added to your pieces. On your photo: 28 × 36, no gaps; with one piece removed digitally, exactly that gap.
- **Shape-only solving (your idea):** a first test on computer-made pieces: from close-ups, shape alone puts the true neighbour first for ~37 % of sides in a 1000-piece puzzle (top 5: 63 %); from overviews only 7 %. Real pieces may differ: the 7 × 7 test in `docs/M3-CHECKLIST.md` will tell.

### Your finished puzzle photo (2026-11-08)
- Added as a test photo (kept on the Mac only). The app's own tools confirm your grid, **28 × 36**, and the picture's true **50 × 70 cm** shape (within 0.5 %).
- Found and fixed: the scan recognised only about 70 % of the finished puzzle as one assembled area (where the puzzle nearly touches the photo's edge, that part was taken as "off the table") and listed 3 bits of it as loose pieces. Now the whole puzzle is one assembled area with no pieces on it. Your other photos give the same results as before.

### Photos taken very close now work (2026-11-08; not yet checked on your iPhone)
- With the phone about 3× closer than usual, the app guessed the piece size wrong: real pieces were treated as "objects", the coin wasn't found, and shadows and bits of pieces were saved as pieces. It now tries closer size guesses when the first finds almost nothing. On your photo: about 20 of 23 pieces found cleanly and the coin found.

### Moved pieces recognised (2026-11-08; not yet checked on your iPhone)
- Before, a piece moved more than about 6 mm was counted as a new piece (your 23 pieces showed as 30). Now, when a known piece's spot is empty in a new photo, the app compares the "new" piece with the pieces that left by shape, size and colour, and a clear match is the same piece, moved. The scan says "N pieces were moved: recognised, not counted again."
- A piece taken away (e.g. into the puzzle) is marked "no longer seen at its spot" and no longer counted on the table; it comes back if photographed at that spot again. Only a clear piece in a photo at least about as sharp as its best one can be marked so, never a pale one.
- Limits: when two pieces that left look alike, the app doesn't guess (the moved one is added as new). Pieces moved before this version stay doubled: use **Delete and scan again**.
- On computer-made test sets where nothing moves: no false "moved", 3 false "missing" in 1,193 pieces.

### Delete, restore and scan again (2026-11-08; not yet checked on your iPhone)
- On the puzzle screen, under Pieces: **Delete scanned pieces…** → **Delete and scan again** (starts a fresh overview) or **Delete pieces**. The box picture and grid stay.
- Deleted pieces go to a **bin** with their photos and the measured size; **Restore** brings them back exactly. The bin holds one scan: deleting again replaces it. Restoring while you have a newer scan swaps the two (two scans can't be mixed, because each one measures the table its own way).
- The bin is not included in backups.

### Shiny pieces (2026-11-07; checked on your photos, not yet on your iPhone)
- Under a lamp, the side of a glossy piece facing the light looks lighter and was cut off the outline (pieces looked bitten, some were called "objects", sizes came out 15 % small). Lighter areas that keep the piece's own colour, right next to it (up to 3 mm), now count as part of the piece; shadows keep the table's colour and are left out.
- Pieces with long knobs at both ends are no longer mistaken for objects.
- Your 26-piece photos with the 2-denar coin: 26 found in each, sizes within 1.5 % of what the coin measures (before: 21 found, 15 % small, in the portrait photo).
- On the old tilted photo of the big puzzle (no coin), the size estimate moved from 3.46 to 3.15 px/mm; its true value is only known as a range (3.1–4.0). Use the coin when you want sizes you can trust.

### Shiny coins (2026-11-07; checked on your screenshot, not yet on your iPhone)
- Your 2-denar coin was missed: shiny brass is about as bright as the cream table, and a damp mark touched it. The coin is now also found by its yellow colour, judged round by its overall shape (embossing no longer spoils it), and measured at its outer rim. No false coins on any of your 6 earlier table and tray photos.

### Box lids and trays (2026-11-07; checked on 3 of your photos, not yet on your iPhone)
- Pieces in the puzzle box's grey tray or a cardboard box lid are now found, not only on the white table. The app measures how grainy the surface is and judges pieces by colour and darkness against that surface.
- Holding the phone closer than usual (over a tray) no longer confuses the piece size: when most pieces look "too big", the app tries the size they suggest and keeps it if more single pieces come out.
- Single pieces with long knobs are no longer marked "touching" by mistake (also on the white table).
- On your photos: grey tray with ~120 pieces → 43 found in the tray, 22 of them as clean single pieces; most misses are in the dense pile (touching pieces). Brown pieces in the brown box lid → about 13 of ~25 found (the hardest case). White-table photos unchanged.

### Real table photos (2026-11-07)
- Checked on your own photo of the table: the half-built puzzle and objects like headphones are now recognised and ignored (shown in green and red on "See the last photo"), and loose pieces inside the puzzle's frame are found. Faster: about 2.3 s on the Mac per photo.
- A close-up is placed even when the camera reports the wrong zoom.

### A coin for true size (2026-11-07)
- Optional: put one Macedonian coin (1, 2, 5, 10 or 50 denari) next to the pieces and pick it before the overview. The app finds it, measures it (to about 1 % in tests), and turns the estimated sizes into measured ones. The coin is never counted as a piece.
- Coin sizes: 1 denar 23.8 mm and 5 denari 27.5 mm (National Bank decisions); 2 denari 23.5 mm, 10 denari 24.5 mm and 50 denari 26.5 mm (coin catalogues).

### No printer needed (2026-11-07; not yet checked on your iPhone)
- New puzzles need **no printed markers**: the pieces themselves tell the app where each photo was taken. Printed markers remain an option for extra precision.
- The gauge uses the phone's tilt sensor (one tap to allow) and how big the pieces look ("Move the phone lower", "no piece cut off").
- Close-ups are matched to the overview's pieces; a small map shows what is covered and where to aim next. "See the last photo" shows the pieces found, outlined.
- On computer-made photos: every test photo was placed correctly; position error about 0.6 mm (300-piece tests) to 1.2 mm (48-piece tests); about 1 % of pieces counted twice.

### M2: set-up, markers, finding pieces, catalog (2026-11-06; not yet checked on your iPhone)
- **Your puzzles** on Home: new puzzle, open, export a backup, import a backup, delete.
- **New puzzle wizard:** name and piece count → box photo (drag the corners with a magnifier; the picture is straightened) → grid suggestion (28 across × 36 down for a portrait Ravensburger 1000) → print 2 marker sheets with a 100 mm ruler check → lay out the 8 cards and take one photo of the empty table, which measures where every card lies and learns your table.
- **Scan pieces:** a hand-held overview that takes itself when the phone is flat, high enough and still; then 2× close-ups with an arrow showing where to aim. Each photo is checked (blur, tilt, glare, markers), placed on the table, and its pieces are added to the catalog. A piece seen again is updated, never added twice.
- **Live outlines:** grey for pieces found, orange dashes for touching pieces, yellow for pale pieces to check. They stay on the pieces as you move the phone.
- **Puzzle screen:** piece thumbnails, the measured piece size and a rough finished size.
- **Accuracy on computer-made test photos:** about 94–95 % of pieces found (target 98 %, not met yet); near-white pieces only about a third; positions within about 0.15 mm.
- Under the hood: database version 2 (your M1 data upgrades), marker map and camera-pose maths, a level-and-height gauge, a tilt-sensor fallback, a close-up planner, a synthetic puzzle generator with frozen test sets.

### Seventh report (2026-11-06, Safari tab): M1 checked on your iPhone
- Everything in the M1 checklist has now worked on your phone, in the Safari tab and the Home Screen app: sharp 3024×4032 Snap with live tracking, tracking at 22–28 per second, memory headroom 1,792 MB, the marker outline right in all three positions.
- **The 2× lens test now gives a verdict:** your phone measured 1.83 and 2.40, so it shows "True 2× lens". A low ratio says "not confirmed" and never ✗.

### Plan changed for your setup (2026-11-06)
- **No stand:** the phone is held by hand. The app will show a level-and-height gauge from the markers and take each photo by itself when the phone is level and still (M2).
- **No mat:** pieces lie on your white glossy table. The app learns the empty table from one photo, finds pale pieces from their edges and side shadows, and detects glare and fills it in from a second photo (M2). Advice: light from the side, not straight above.
- **Finished size is measured, not asked:** you type only the piece count; the grid comes from the count and the box picture's shape, the size from the first overview photo. The box photo moves into the M2 wizard.
- Close-ups at 2× from the same height as the overview, because your 2× lens is a true optical 2×.
- Printed markers stay (you can print A4).

### Fixed after your first iPhone report (2026-11-06)
- On your iPhone, every in-app photo failed with an internal camera error (all sizes, all formats).
- **Snap** now falls back by itself to the **full-size live picture** (12 MP), and only offers the iPhone camera screen if that fails too.
- New **Photo test** (Device check step 4): it tries each possible cause separately and remembers what works:
  - with and without live tracking;
  - with no size, the upright size, the sideways size, the largest size, the camera's own setting, or a copy of the camera;
  - with the full-size live picture.
- The 2× lens test now runs inside the Photo test, using whichever way works.
- Second report (Home Screen app) found the cause: the tracker's shrunk copy of the camera makes photos small (540×960) or fail. With tracking off, photos are full 12 MP.
  - The Photo test now never picks a way that gives a small picture. The first version would have chosen 0.5 MP photos.
  - It also tries tracking with a full-size copy of the camera.
  - The camera tests take their photos with tracking paused.
- Third report: the Photo test chose correctly (photo with tracking paused), but Snap still gave 540×960.
  - The pause didn't wait for the tracker's copy of the camera to close. It does now.
  - Every Snap checks its size. A photo that comes out small is retried once, then replaced by the full-size live picture.
  - The photo panel has a "Send report" button.
- Fourth report: Snap gave a full 3024×4032 picture through the live-picture backup, but that picture is soft. Once the tracker's shrunk copy has run, photos stay small until the camera restarts.
  - The Photo test now starts every stage with a freshly started camera.
  - It also tries "pause tracking and restart the camera" before the photo.
- Fifth report: **Snap takes real, sharp 12 MP photos** while tracking keeps running, by giving the tracker a full-size copy of the camera. The 2× lens measured 1.83 (a true 2×). Tracking dropped to 17 fps, because shrinking the big frames on the GPU took about 47 ms.
  - New way to read big frames: copy the grey picture and shrink it by an exact factor of 4 in OpenCV (Mac: 18.7 ms per 12 MP frame, the shrink itself 4 ms).
  - The tracker times both ways on the phone and keeps the faster one. The HUD shows the choice under "big frames".
- Sixth report: tracking is back to 27.8 fps (22.9 ms per frame; the direct copy took 20 ms, the GPU 52 ms), and Snap still gives sharp 3024×4032 photos.
- Full-size tracking is now the starting setting everywhere, including the Safari tab before any Photo test.

### Added: M1, skeleton on your phone (2026-11-04; not yet checked on an iPhone)
- **App:**
  - A Home Screen web app (PWA) that works offline, with an "update available" banner. Published at https://zivkogodzirov.github.io/puzzle-lens/.
  - Screens: Home, Live camera, Device check, Send report, Setup guide, Settings, Activity log.
- **Camera:**
  - Live camera with the "camera contract" (PLAN §3.1): 4:3 full-sensor format, lens picker (Automatic by default), 1×/2×, torch.
  - Automatic recovery after interruptions (including after a Snap and after the iPhone camera screen), and the screen kept awake.
  - A lens that stops working is reset to Automatic.
- **Tracker:**
  - A background helper finds the printed markers in live frames, with sub-pixel corners (about 0.2 px).
  - Frames go to it directly (iOS 18+), or are copied when that isn't possible. It switches to copied frames automatically if direct frames stop.
  - It restarts itself after repeated errors.
- **Snap:**
  - A full-resolution photo, checked tile by tile (size, brightness, blown-out share, sharpness) with a preview.
  - Every step has a time limit.
  - "Use the iPhone camera instead" appears when the in-app photo fails, and is used automatically after two failures.
  - A photo that can't be kept for reports (Private Browsing) only gets a gentle note.
- **Performance display (HUD):** frame rates, time per stage, the longest gap between updates, memory per helper, OpenCV objects and open frames.
- **Device check:**
  - Steps 1–3 with ticks: automatic checks, camera tests, iPhone camera screen. A memory test is optional.
  - It covers BRIEF §2 and RESEARCH §19: photo size per format, camera pause and frame gap during a Snap, a 2× measurement (number only for now), canvas-noise probe, WebGPU self-test, storage, Wake Lock, sharing, OpenCV speed, and how live frames are delivered.
  - Plain-English verdict at the top. Known iPhone limits are marked "Normal on iPhone".
  - Results are kept per mode (Safari tab / Home Screen app) and across app updates.
- **Send report:** prepared first in a background helper, then shared (AirDrop/Mail), with a download fallback. Contains `report.json`, recent frames, the last photo preview, and optionally the full photo.
- **Setup guide:** numbered steps for installing to the Home Screen (including the iOS 26/27 "⋯" and "View More" menus), plus a test marker to show on another screen.
- **Icons:** app icons (including maskable) and a test marker (`public/test-marker.svg`, ArUco id 0).
- **Vision engine:** a custom OpenCV.js 4.14 build (SIMD, ES module, native exceptions). It is 5.8 MB, 1.3 MB with brotli, and its memory starts at 32 MiB.
- **Database:** versioned, with a frozen schema history and a test that guards it.
- **Tests:**
  - 197 unit tests on the real OpenCV build.
  - A 10-minute live-loop leak test that runs the tracker's own code (18,000 frames: memory flat, every frame and bitmap closed exactly once).
  - 17 WebKit browser tests with a simulated camera, including offline, leaving the camera screen by the Back gesture, and a failing camera.
  - A GitHub Actions workflow that tests and deploys every push to `main`.

### Fixed (found by the independent M1 review: 53 confirmed findings, and by the tests)
- **Camera and tracker:**
  - Leaving the Live screen on the copied-frames path left the camera on (`cancelVideoFrameCallback` was called without its `this`).
  - Overlapping camera starts or tracker attaches could leak a camera or silently kill tracking.
  - The tracker reported success before its frame reader existed.
- **OpenCV errors:** a caught error leaked WebAssembly stack and memory, so about 65 errors killed the module. Every catch now goes through `cvGuard`.
- **Memory:** the OpenCV memory started at 128 MiB instead of 32 MiB (OpenCV's own build file overrode ours).
- **2× lens test:** it would have called a real 2× lens "digital zoom". There is a new detail measure, and no verdict is shown until it is checked on the phone.
- **Accuracy and robustness:**
  - Marker corners were up to 2.5 px off.
  - 10-bit camera formats would have been read as garbage.
  - Report zip names inside dotted folders were renamed wrongly.
- **False alarms:**
  - The crash notice appeared after ordinary app switching.
  - The memory test could save an interruption as a measurement.
  - Device check results disappeared after an app update.
- **Small fixes:**
  - The wake lock could stay on after the camera stopped.
  - The last log lines before a crash could be lost.
  - The "lag" readout measured the wrong thing.
  - Photos were decoded twice just to read their size.
  - The speed test used a slow per-pixel loop.
- Full list: PLAN §10 (what is still open) and §11 (decisions).

### Earlier
- **M0, research and plan** (2026-11-04):
  - `docs/BRIEF.md`: the original requirements, kept verbatim.
  - `docs/RESEARCH.md`: research on the reference projects, iOS 27 Safari capabilities, capture and resolution, markers, segmentation, shape reading, re-identification, box placement, grid inference, piece-to-piece matching, on-device ML, GPU compute, storage, hosting and testing. Each choice is explained.
  - `docs/PLAN.md`: architecture (including the camera contract), data model, screens, milestones with acceptance thresholds, speed and memory budgets, risks, decisions and open questions.
  - `docs/research/`: detailed notes on Harstil/piece-finder, puzzle-bot, bminaiev / jigsawlutioner / Zolver, plus a skeptic's fact-check.
- **Independent review of the plan:**
  - Four lenses (platform, vision, brief coverage, fact-check), each finding challenged by a second skeptic.
  - 49 findings confirmed and fixed. The main ones: the piece-wall (parallax) model, `takePhoto()` behaviour with the live stream, accuracy-test definitions, the 5-second share rule, database versioning, and milestone placement of several brief requirements.
- M0 was approved on 2026-11-04.
