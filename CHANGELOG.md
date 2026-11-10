# Changelog

All notable changes to Puzzle Lens (working title in M0: "Piece Finder") are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow the milestones.

## [Unreleased]

### M9 (part 1): easier to read and use (2026-11-10; tested on the Mac, not yet on your iPhone)
- **The first of 6 design stages** from the app review ("readable now"). Built by 4 builders working in parallel, each on its own part, then merged and tested together.
- **Colours that read in light mode.** 31 text styles were too faint. Every colour is now a named colour with a light and a dark value, and a test measures every pair (text at least 4.5:1, lines and dots at least 3:1). For example: links 2.1 → 5.7, "likely" 1.4 → 6.4, the selected piece's outline 1.1 → 16.5. Dark mode looks as before, except "shape read", which is now violet instead of blue in both.
- **Bigger buttons.** ✓ Fits / ✗ Doesn't fit (and ✓ They fit, ✗ No) are 56 points tall and side by side; small buttons at least 44. In Fill a spot the offered pieces show 2 across instead of 3, so the two answers fit.
- **Outlines you can see on your cream table.** Every piece outline on a photo or in the live view has a dark edge under it. On your table the outlines stood out at only 1.0–2.9 before; the edge now stands out at about 5, and each line against the edge at 3.3–5.4. Drawing costs a little more: about +10–20 % for 40 pieces, about +2 ms a frame with 300 or more (Mac).
- **Undo in the live view** for 10 seconds after ✓ Fits or ✗ Doesn't fit.
- **A bar at the bottom of the puzzle page:** Scan · Live view · Fill a spot · Joins, always in reach. Fill a spot and Joins open with a Close button.
- **The app reopens your last puzzle** when you start it (Home is one tap back). The set-up list folds to "✓ Set-up finished". The screen stays on while a puzzle page or Progress is open.
- **The piece filters** (All, Border, Inside…) look like one control with the chosen one raised.
- **Pinch-zoom works** on normal screens (not on the camera screens). The Home Screen app stays upright. The status bar follows light and dark mode.
- **🧪 is a round button in the top bar**, on every screen including the camera ones.
- **Tester mode** (Settings, on for now): switched off, it hides Live camera, Device check, Send report, the Activity log, the 🧪 button and the developer numbers (the "/s" speed, "cm high · tilt"). The speed display (HUD) on the Live camera screen now starts hidden.
- **Words:** "1 piece found" instead of "1 pieces found" (and about 20 more); plain sentences instead of computer error text; "This puzzle is not on this iPhone." everywhere.
- **Reduce Motion** turns off animations; the live view's pulsing ring stands still.
- Screen titles in the app switcher show the puzzle's name.

### M8 (part 4): fixes from the app review, bugs and speed (2026-11-10; tested on the Mac with your photos, not yet on your iPhone)
- **Checked twice.** Every change was checked by a second, independent check against the version before it. Then a separate review asked one question: did any of it make the app worse? Over 40 checks looked at the Scan screen, the puzzle page, memory, speed, your photos and data safety. They confirmed 7 small-to-medium problems and the final check found nothing new. 5 are fixed below. The other 2 were about extra scan work on photos that can't be used anyway: every way I tried to cut it also stopped some of your photos from being read, so it stays (a test with your photos now guards it).
- **Your 41 photos, through the whole app:** the same pieces as before, apart from 2 photos of the half-finished puzzle (IMG_9226, IMG_9227) that now read right after a photo taken at another height. All 22 end results (a catalog per batch) are the same.
- **Scan screen, the note after a photo:**
  - It no longer covers the gauge's words at the top. It sits in the panel at the bottom, gets the room first, and a long one shows **More ▾**, which opens all of it.
  - A note that doesn't fit makes room for itself. The coin choice hides while it shows, and while no photo takes itself the gauge gets smaller. A short note keeps everything as before.
  - Sideways, it sits in its own column on the left and is never cut off.
  - The review found the first version showed only 2–3 lines on a small screen, with no sign of the rest. Now, in the Home Screen app on your iPhone 17 Pro, the finished-puzzle note shows whole.
- **A photo of the finished or nearly finished puzzle:**
  - It now says **"About N loose pieces lie next to the puzzle"** (on IMG_9280, 8, and I count 8; it's a rough count). They used to be left out without a word.
  - The saved empty spots and the loose pieces now come first, before the long list of gaps.
  - The review found the loose line could go missing after a photo taken at another height. Fixed: they are counted at the puzzle's own size.
- **Fixed (found in the review, there since M7):** a puzzle part done, misread as "finished" with a different grid, replaced your saved empty spots. Your IMG_9244 reads as 28 × 37 instead of 28 × 36: the app saved 92 "empty spots" it then couldn't use, and said "Saved". Now nothing is saved from a count that doesn't match your grid, and the note says so. Your photos of the finished and nearly finished puzzle (IMG_9272, IMG_9280, IMG_9281) all read 28 × 36 and save as before.
- **The scale guess** comes only from the newest photo of the same kind (overview or close-up), so an overview after a close-up (or the other way round) is no longer read at the wrong size.
- **The puzzle page:**
  - A tapped piece's panel comes into view in one move. The review found that the first version moved it again a moment later, so a quick ✓ Fits could be lost or land on "Remove it". Fixed: it is placed before the screen shows it.
  - Quick ✓ Fits answers are counted once.
  - Set-up shows **4 steps** when you don't print markers ("Step 4 of 4 · Ready to scan").
  - Clearer words when a photo can't be read; "White outlines: the 21 empty spots."
  - The Bin card's size is kept in a small row of its own, and it checks itself against the bin.
- **Faster (on the Mac):**
  - Scan photos take about a fifth less time in all (timed twice, old and new back to back on a quiet Mac: 609 → 485 s for all 41 photos in every kind of scan). The first photo of a scan takes 0.57–0.96× its old time (median 0.83×). Photos of the puzzle gain most (IMG_9280 6.2 → 4.1 s, IMG_9272 5.5 → 3.7 s), photos of loose pieces least (IMG_9127 and IMG_9276 5.7 → 5.3 s). The finder's colour step is about 30 % faster, and the scale is checked once instead of twice. A finished puzzle skips its second try.
  - The first photo after **Start a new batch**: a 1.8–2.6 s freeze → under 1 ms.
  - Working out where pieces go: 11.2 → 3.4 ms a piece (3.3× faster; 5.7–6.3× in Safari's engine), with the same results.
  - **Sort into trays**: about 0.5 s → 50–74 ms, never frozen for more than 0.08 s.
  - The puzzle page reads your pieces once when it opens (was 5 times) and once per ✓ Fits (was 4), and its pictures load in 0.31 s instead of 0.48 s. A scan photo reads them once (was 3 times).
  - The photo helper now starts when the Scan screen opens. That saves only **0.1–0.6 s** on the first photo, not the 2.5–3 s the review guessed. A warm-up photo was tried and dropped, because it made the first photo slower.
- **Small things:** the 🧪 Test tab is a thin strip that stays off buttons and text; Device check no longer scrolls sideways; Progress's **Details** is a small button; a refused camera's notice is readable in light mode, with one **Start camera** button.
- **A tip taken back:** in M8 part 3 (and in the table-contrast check, M4) I suggested a darker cloth under pale pieces. I never tested it, and on computer-made photos darker cloths did worse (white 95 %, mid grey 85 %, dark green 77 %, dark grey 44 % of pale pieces found). A close-up is the fix; the app no longer suggests the cloth.
- **Still to check on your iPhone:** Safari tabs (shorter screen), the camera stopping while the photo picker is open, warmth and memory with both photo helpers running from the start, and the photo and file buttons.

### M8 (part 3, follow-up): why your photo IMG_9127 showed 44 pieces (2026-11-10; tested on your photos, not yet on your iPhone)
- **A correction first:** I wrote that IMG_9127 had about 95 loose pieces. Counted carefully on close-ups, it has **about 60**.
- **Every one of them was found.** The 44 outlines cover about 60 pieces:
  - **27** pieces on their own.
  - **15** outlines around **2–4 pieces that touch** (about 29 pieces). The app asks you to spread these apart (orange dashes). This was the main reason for the low count, not the angle as I said before.
  - **1** pale piece outlined only in part.
  - **2** things cut off at the photo's edge.
- **Pale pieces on your cream table** (the white dress) sometimes get only part of their outline: the table looks like the white print. A wrong, too-small outline gave a wrong shape (for example a "flat side" where the outline cut across the piece).
- **New:** a piece outlined much smaller than the photo's other pieces (under 60 % of a typical one) is now marked **yellow, "only partly outlined"**. The app doesn't use its shape (no corner/edge guess, no knob fit), only its picture. The scan note says how many, and that a close-up or a darker cloth under pale pieces helps. *(The darker cloth was withdrawn in M8 part 4: never tested.)*
- **Checked on all 20 of your photos:** no whole piece was marked. Marked: the clearly cut-short pale piece in IMG_9127, two piece backs in the brown lid (IMG_9245), and some false "pieces" inside the finished part of the puzzle. On computer-made photos: 12 of 2639 pieces marked, none of them whole.
- **Not solved:** pale pieces outlined at 70–80 % of their size can't be told from whole pieces by size, so they aren't marked. Spreading pieces so they don't touch, and a darker cloth under pale pieces, help most. *(The darker cloth was withdrawn in M8 part 4.)*

### M8 (part 3): faster scans, a lighter live view (2026-11-10; measured on the Mac with your photos, not yet on your iPhone)
- **Scans are faster.** Your 18-megapixel photos were read in 7.4–11.5 s on the Mac; now **4.4–7.2 s** for the first photo of a scan, and **1.6–2.0 s** for the next ones taken at about the same height (the app starts from the previous photo's scale instead of guessing and searching twice). The pieces found are the same.
  - Most of the time went into one small step: sorting every pixel around each piece to find two numbers; it now finds them directly (the same numbers).
- **The live view saves battery while you hold the phone still**: after a second without movement it looks at about 7 frames a second instead of 25, and goes back to full speed as soon as you move. The small number after "Tracking ✓" shows it (e.g. **7/s**).
- **Memory:** reading your 18 MP photos uses about 100 MB in the app's image helper, and doesn't grow from one photo to the next.
- **Your new photos:** IMG_9127 (the border done and loose pieces inside it) was used for the timing. Why it showed only 44 pieces: see the follow-up above (the angle wasn't the reason). IMG_9226 and IMG_9227 (the half-finished puzzle from a steep angle) are still too steep to be read as the puzzle.

### M8 (part 1): colours learned from your pieces (2026-11-10; tested on your photos, not yet on your iPhone)
- **The problem:** on the whole box picture (a fresh puzzle, no holes photo), your real pieces were rarely placed right: your photos' colours under the lamp differ from the box picture in ways the one-time colour match can't undo (light parts yellower, shadows different). Of your 19 pieces with known spots, only **1** came first.
- **New:** once **12 pieces are in the puzzle at known spots** (✓ Fits), the app learns how your photos' colours map to the box picture, from those pieces, and places every other piece again. It learns again after every 10 more. The puzzle page then says **"Colours learned from your N pieces in the puzzle"**. It only uses what it learned if that predicts the colours of pieces it didn't learn from clearly better; among the holes of a nearly finished puzzle it isn't needed (the colours come from the holes).
- **Measured on your 19 real pieces** (each placed with colours learned from the other 18, so none from its own answer): right spot first **1 → 6**, in the top 5 **3 → 9**.
- **On computer-made puzzles** it's about neutral (held-back test puzzles: 67.0 → 65.9 % and 85.4 → 84.8 %): their box pictures differ from the pieces only by an overall cast, which the one-time match already undoes. I tried several variants and kept the one that did best on your pieces without hurting the computer-made ones more than that.

### M7 (part 4): placed pieces without tapping each, and a full 1000-piece run (2026-11-10; tested with your photos and in the app, not yet on your iPhone)
- **A new photo of the puzzle counts the pieces that went in.** When you photograph the nearly finished puzzle again (Scan pieces), the holes filled since the last photo had their pieces put in: the piece the app had for each (Strong or Likely) is now counted as in the puzzle. A note says how many, with **Undo**. Holes whose piece wasn't sure are left alone.
- **A photo of the finished puzzle** (no holes left) counts every piece as in: 📈 Progress says 1008 of 1008.
- **Fixed: after scanning loose pieces, a photo of the puzzle couldn't be read at all** ("This photo could not be matched…"), so you couldn't update the holes. Found with your photos: holes (IMG_9280), pieces (IMG_9276), then your photo of the finished puzzle (IMG_9272). Now it reads: "All 21 empty spots are filled now. 17 of the pieces the app had for them are counted as in the puzzle", and Progress shows 1008 of 1008.
- **✓ It's in the puzzle** under a piece whose spot isn't sure: for a piece you put in somewhere the app didn't know. It counts as in, without a spot.
- **A full 1000-piece practice run, end to end** (a computer-made 28 × 36 puzzle, 4 batches of 300/300/300/108, each with an overview and 4 close-ups, through the app's own code, with a simulated you trying each piece in the spots shown, answering truthfully): all 20 photos placed, 5.3 s per photo on the Mac; 972 of 988 pieces read, 1 counted twice, none mixed up; **75 % went in on the first try**; 762 in after the four batches. Then the end game: a photo of the nearly finished puzzle and the 145 pieces left matched only to its 246 holes: 86 more in, **848 of 1008 (84 %)** in all. The rest were pieces never read properly (a close-up or another scan helps) or not found in 5 tries.

### M7 (part 3): full backup, with reminders (2026-11-09; tested in the app with your Kiss photos, not yet on your iPhone)
- **A reminder to back up** on the puzzle page: when there's no backup yet (once 20 or more pieces are read), or when things changed since the last one and it's 3 days old (or 100 things changed). **Back up now** prepares the file; **Not now** hides the reminder for a day. It counts once the backup has left the app (shared or downloaded).
- **"Last backup: …"** under Backup, with how many pieces there were then.
- **The backup now holds everything:** besides the puzzle, its pieces, photos and answers, also each piece's spots on the box picture (no waiting for them to be worked out again after restoring) and an earlier scan in the bin. Backups made before still import.
- **Timed on a full 1000-piece puzzle** (with 10 full-size scan photos): prepared in **1.9 s** (57 MB), imported back in **2.2 s**, on the Mac in Safari's engine. Expect a few times longer on the iPhone.
- **Tested with your Kiss puzzle in the app:** the reminder showed, the backup took 0.2 s (2.5 MB); I deleted the puzzle and restored it from the file: the same spots for every piece straight away, and the piece I'd said fits was still in the puzzle.

### M7 (part 2): progress page (2026-11-09; tested in the app with your Kiss photos, not yet on your iPhone)
- **New: 📈 Progress** on the puzzle page (next to 📊 How often is the app right?).
- **How many pieces are in the puzzle**, with a bar. With a photo of the nearly finished puzzle it counts everything but its empty spots (plus the pieces you said fit since); without one, the pieces you said fit.
- **The box picture, filled in:** bright where the puzzle is done, a **yellow dot** where the piece for an empty spot is on your table or in a tray, dark where it's still to find.
- **Pieces by where they are** (on the table, in trays with each tray's count, in the puzzle, set aside), **how many spots are still empty** and for how many the piece is known, **corners and edge pieces** among the pieces left, **how often the app was right**, and **which batch** you're on.
- Tested in the app with your photos (box picture, IMG_9280 holes, IMG_9276 pieces): **987 of 1008 in the puzzle (98 %)**, the 21 holes dark at the top right and by the faces, **17 of them with their piece on your table**, 4 still to find (in fact 2 holes have no loose piece among your 21).

### M7 (part 1): batches (2026-11-09; tested on the Mac with your photos, not yet on your iPhone)
- **The problem:** once you swept the pieces together (or put them back in the box) and spread out a new lot, no photo could be matched to the old table any more ("This photo could not be matched…"). The only way out was deleting the scanned pieces.
- **New: 🔄 Start a new batch** on the puzzle page. The pieces on the table are **set aside** (kept in the list); pieces in the puzzle and in trays stay where they are; the next photo starts a fresh table. "Pieces read" now says how many are on the table, in trays, in the puzzle and set aside, and which batch you're on.
- **Earlier batches' photos** are left out of the live view, the scan's coverage map and "Show my table" (they show another layout of the table).
- **Pieces you spread out again are read as new.** I tried recognising them by their picture and measured it before deciding. On computer-made 300-piece batches, any setting that recognised a fair share of the returning pieces also merged **3.5–8.7 % of brand-new pieces** into old ones (and with the M5 rules, 81 % of new pieces became "to check"). On your photos of the same 21 pieces it would have recognised 126–202 of 252 sightings, but those photos have no new pieces to mix up. A wrong merge silently mixes two pieces up, while a piece read twice only counts twice, so it's off.
- **The easier way, when there's room:** leave the leftovers where they are, spread the new pieces around them and scan as usual. Every piece is then recognised by where it lies (as since M5), and you don't need a new batch. The app says so when you tap Start a new batch.

### M6: which pieces join (2026-11-09; tested on the Mac with your photos and in the app with your Kiss puzzle, not yet on your iPhone)
- **The go/no-go first, on your own pieces.** Your 21 loose pieces (IMG_9276), whose holes are known, give 24 true joins. Can their **shapes** tell which pieces join? No: the true partner came first for **none of 48 sides** (on average it ranked 19th of about 36). The **colours along the edge** did little better (4 of 48). Your phone photos are too coarse for the small differences between Ravensburger's knobs. So, as the plan said for this case, M6 is **box-led**: two pieces whose spots on the box picture are next to each other probably join, and the shapes only rule out pairs that can't fit.
- **🧩 Which pieces join** on the puzzle page: pairs that probably join, most likely first, each with both pieces as photographed, their two spots on the box picture and a percentage. Four pieces whose pairs all agree make a **square of 4 ✓**. The first card, **What next**, is the best thing to try now. **📷 Point them out** opens the camera with those pieces pulsing and a line between the ones that join; **✓ They fit** / **✗ Don't fit** (with Undo) remember your answer: a joined pair isn't suggested again, nor is a pair that doesn't fit. **✓ N pairs joined** lists what you joined, with **Take back**.
- **A piece's panel** says which pieces join its sides ("on its right · 95 %"), and which sides are next to the done part, on the edge, or have a partner not scanned yet.
- **The live view** draws a line between the 6 likeliest pairs (green ✓ for a square of 4).
- **📊 How often is the app right?** has a new part, **Which pieces join**, from your answers.
- **Your 21 real pieces** (among your 21 holes): the true partner first for **36 of 48 sides** (75 %); every pair at 50 % or more was right (**15 of 15**); **3 squares of 4**, all right. In the app with your Kiss puzzle, the first suggestion was a square of 4 at columns 18–19, rows 7–8 (98 %), which is right.
- **Computer-made puzzles** (held back from tuning; whole picture / among empty spots): the true partner first for **88.5 % / 95.3 %** of sides on 48-piece puzzles and **83.3 % / 86.0 %** on 300-piece batches (targets 85 % and 75 %). Pairs at 50 % or more right **98–100 %**; squares of 4 right **99.5–100 %** (target 98 %). Not measured on 1000-piece puzzles yet.
- **The percentages are shown as computed.** On computer-made puzzles they are too modest (pairs shown at 70–80 % joined 99 % of the time), but on your real pieces they're about right, so I didn't raise them: a correction learned on computer-made puzzles would have made your real pairs look surer than they are. Your "They fit" answers will tune them in M8.
- Not built: the colours along the edge as a score (too weak on your pieces), and the extra-sharp close-ups retry for shapes (it needs your puzzle).

### M5 (part 4): a smoother live view that notices moved pieces; Quick scans (2026-11-09; tested on the Mac with your photos, not yet on your iPhone)
- **The live view keeps up when you move the phone.** The outlines used to be drawn where the table was in the last analysed frame, so they trailed behind while you moved. They're now put where the table is predicted to be in the picture being shown (from the last two positions), and calmed when you hold still. Measured with a simulated camera panning steadily: over a computer-made table, 1.0 → 0.1 screen px behind (median); over your photo IMG_9275, 2.5 → 0.5 px (about 1.4 → 0.3 mm on the table).
- **It notices pieces that are no longer at their spot.** Every few frames each known piece in view is compared with the table right around it, against how much it stood out in your scan photo. A piece that looks gone in 3 of 4 checks gets a **red dashed** outline ("moved?"), and the top line says how many and to scan again. Your IMG_9276 with three pieces moved: exactly those three; your other photos: none. Pale pieces that hardly stand out on your table are never called gone.
- **Unsure tracking** (few points recognised) shows dashed, hollow outlines.
- **Settings → Scan mode: Full or Quick.** Quick takes one overview photo and stays on overviews (shapes read less surely); Full adds close-ups as before.
- Fixed while testing: in a browser that stamps every camera frame with the same time, the new prediction would have frozen the outlines; frames are now told apart by their number. The tracker also skips camera frames while the live view prepares your scan photos.

### M5 (part 3): rescans that don't count pieces twice (2026-11-09; tested on the Mac with your photos, not yet on your iPhone)
- **Scanning again no longer adds a piece twice when nothing moved.** The duplicates came from a piece found only partly in one photo (a pale edge or a shadow), two touching pieces counted as a new one, and **your coin**: after it had measured the size, later scans counted it as a piece. All three fixed. Your four photos of the same 21 pieces, rescanned in three orders: nothing added twice, nothing marked moved or missing.
- **Moved pieces are recognised by their printed picture.** Each piece now keeps a small "fingerprint" of its picture. A piece you moved, even turned round or moved out of the photo and back in, is matched to the known piece. Your IMG_9276 with three pieces moved digitally (one upside down, one a quarter turn): all three recognised.
- **When the app isn't sure, it asks instead of guessing.** Such a piece gets a yellow **?**, and the puzzle page shows **"Pieces to check"**: the piece as seen now next to the pieces it may be, with **This one** and **A different piece**. A later scan settles most of them by itself.
- **Measured honestly on a hard test** (computer-made puzzles, 5 rescans, each time 20 % of the pieces moved and turned, 10 % taken away and put back, the camera moved and tilted, the light changed): on 48-piece puzzles, pieces counted twice dropped from 55 to 28 (plus 25 left "to check"), wrong merges from 1.15 % to 0.98 %; on 300-piece puzzles, from 108 to 30 (plus 110 to check), wrong merges from 4.71 % to 2.70 %. Without moving pieces, the same puzzles now get none counted twice (before: 6 and 13). **Not yet the targets** (none counted twice, at most 0.5 % wrong): many pieces look too much alike for the fingerprint, so with a lot of moving around some still get counted twice.

### M5 (part 2b): tested by me on your photos, with fixes (2026-11-09; tested on the Mac with your photos, not yet on your iPhone)
- **Live view, your new photos** (IMG_9274–9277, the same 21 pieces from four places): each photo as the scan, the other three as the live picture, 12 combinations: the table found every time; outlines within 0.1–0.5 mm typically, worst 1.8 mm. In the app itself (Safari's engine, with your photos as the camera): scan of IMG_9276, then the live view over IMG_9274, 9275 and 9277: "Tracking ✓ · 20 pieces in view" each time.
- **Fixed: a photo taken much closer than usual couldn't be scanned properly.** IMG_9277 (about 3× closer than the app expects) came out at 3.7 px/mm instead of 11.5 (your coin says 11.2): whole pieces looked like "objects", and the photo couldn't be matched to your other photos of the same pieces. Now 21 clean pieces, scale within 3 % of the coin, and it matches the others. Your other photos scan exactly as before.
- **Fits / Doesn't fit, simulated on your real 21 pieces and 21 holes** (answering truthfully from the known right holes): 18 of the 19 real pieces went in on the first try. The 19th (an edge piece whose flat side isn't read) was never offered its hole: **now, once you've said "doesn't fit" to every spot a piece was offered, the other empty holes are offered too**, and it goes in after a few tries (all 19 placed).
- **New: "Not a puzzle piece? Remove it"** under a piece's spot (two taps). Your scan counts a bottle label and a patch of table as pieces; they got suggested spots (5–25 wasted tries in the simulation) and spoilt the Accuracy page. Removed things leave the list and the Accuracy page.
- **New: "✓ N in the puzzle" opens a list** of the pieces you said fit, each with **Take it out** (before, Undo was only offered right after the answer).
- **Fill this spot** shows filled holes in green.
- Checked in a browser on your *The Kiss* test puzzle (your box picture, holes and pieces): the piece panel asks about the right hole, ✓ Fits takes the piece and its hole, Fill this spot offers the next hole's piece, the 📊 page counts it, Take it out restores everything.

### M5 (part 2): Fits / Doesn't fit, and how often the app is right (2026-11-09; tested in the app on the Mac, not yet on your iPhone)
- **✓ Fits / ✗ Doesn't fit** wherever the app suggests a spot: under a piece's spot ("Tried it in column X, row Y?"), on each piece offered in 🎯 Fill this spot, and in the 📷 live view when you tap a piece.
- **Fits:** the piece goes into the puzzle in the app (status "in the puzzle"): it leaves the table list and the live view, its hole counts as filled (no other piece is offered there), and the line under the piece groups counts "✓ N in the puzzle". **Undo** puts it back on the table or into its tray.
- **Doesn't fit:** that spot is ruled out for the piece; its other spots move up, each chance divided by what is left (e.g. 35 % with 60 % ruled out becomes 87 %, Strong). **Ask again** takes those answers back.
- **Neighbours:** a piece that fits tells the spots next to it what they need: among your holes, the hole beside it must get a piece with the opposite knob there (knob out against knob in); on the whole picture, spots next to it are dropped for pieces whose clearly read knob can't meet it.
- **📊 How often is the app right?** (puzzle page, once you've answered, and Settings → Accuracy): how many of its first choices were right for Strong, Likely and "Several spots look alike", each with a 95 % range; what it said vs what happened (by its percentage); how many tries a piece took on average. Undone answers are left out.
- Answers are kept with the puzzle and in backups (a backup imported as a copy keeps them with its pieces).
- Fixed on the way: the puzzle page counted pieces in the puzzle as still on the table, and the box picture reloaded (closing Fill this spot) whenever anything about the puzzle changed.

### M5 (part 1b): live view tested on your real photos, matching improved (2026-11-09; tested on the Mac with your photos, not yet on your iPhone)
- **Tested on your photos** (you couldn't test on the phone yet): IMG_9263 → IMG_9264 (the same 26 pieces from another place): every outline within **0.3 mm**. A simulated moving phone over IMG_9276 (your 21 pieces; turning, tilting, blur, light changes, 3 pieces moved by hand): table found in every frame, pieces typically within **0.3 mm**, 95 % within 1.5 mm, a rare frame up to ~5–8 mm.
- **Better matching:** after the first fit, a second, guided pass compares each feature only with the ones the fit puts near it. It finds many more right matches: on the finished puzzle (IMG_9272 → IMG_9280) the grid now lands on the 21 holes within **5 mm** typically (worst 8 mm), instead of 21 mm (worst 46 mm); the steep shots IMG_9225 and IMG_9226 now match with 250 and 151 points instead of 88 and 39.
- **Honest limit:** over the finished or half-built puzzle, its repeating seams can still throw a frame off by a piece or more now and then (simulated over IMG_9280: about 1 mm typically, but some frames 3–6 cm). Loose pieces on the table (each with its own print) are the reliable case. Very steep angles (IMG_9227) aren't recognised: hold the phone fairly flat.

### M5 (part 1): live view of your table, without markers (2026-11-09; tested in the app on the Mac, not yet on your iPhone)
- **📷 Live view of my table** (puzzle page, under Pieces): the camera picture with every scanned piece outlined in its state colour, as in Show my table: green = spot known (labelled column·row, e.g. 26·1), blue = shape read, grey = found. The outlines stay on the pieces while you move the phone.
- **No markers needed:** the app recognises your table from the pieces in your newest scan photos (up to 3). A full match (about 50 ms on the Mac) every 6th frame; in between, the matched points are simply followed from frame to frame (about 5 ms).
- A line at the top says **Tracking ✓ · N pieces in view** (with how many times per second it finds the table), **hold steady** when it's unsure, or **Looking for your pieces** when the camera sees something else.
- **Tap a piece** to see what the app knows about it; **Point it out** makes it pulse, and an arrow at the screen's edge shows the way when it's out of view; **Show where it goes** opens its spot on the box picture.
- **🎯 Fill this spot → 📷 Find it live:** the possible pieces for the chosen hole pulse on the live picture (green = the best one, yellow = also possible).
- **How exact:** on computer-made tables seen from other places (moved 80 mm, turned up to 90°, tilted 18°, 30 % higher or lower) every piece was within 1 mm of the truth; during a slow pan, within 1.2 mm. On your photos IMG_9263 → IMG_9264 (the same 26 pieces from another place, phone turned 90°): within 0.4 mm. 10 minutes of live frames: memory doesn't grow.
- **Not yet:** pieces moved by hand keep their old outline until you scan again (re-identification comes in a later M5 part); while the phone moves fast the outlines may trail a little (smoothing comes later).
- **🧪 Test tab** (your request): a small tab on the right edge of every screen opens the same test steps I send you in the chat, with tick boxes that stay on the phone. A red dot means there are new steps you haven't opened yet.

### M4 (part 7): box setup checks, M4 finished (2026-11-09; tested in the app on the Mac and checked on your iPhone)
- **Border question** (new-puzzle wizard, after straightening the box picture): "Does this picture show exactly the puzzle?" Yes / It has a frame or white border (then: put the dots inside the frame, with an **Adjust corners** button) / The box shows a bit more or less / Not sure. The answer is kept.
- **Table-contrast check** (puzzle page, under the piece groups, once pieces are scanned): how much of the picture is close to your table's colour, so pieces from there stand out little and a scan may miss them; **Show where** marks those spots on the box picture. Your *The Kiss* on your white table: about 1 % (the white lace sleeve and the collar), shown as a calm ✓ line; from 2 % on, a warning suggests checking those pieces or sorting them on a darker cloth. *(The darker cloth was withdrawn in M8 part 4: never tested.)*
- **Box picture check (box-to-grid correction):** box art often shows a little more or less of the scene than the real puzzle, so its grid drifts off the real pieces toward the edges. On computer-made 300-piece puzzles, a box picture 1 % too big each side placed only 74 % of pieces right first (instead of 83 %); 2 % too big, 51 %. The app now measures this from the pieces it's sure about. When it's off by 0.1 of a piece or more, the puzzle page offers **Correct the box picture**, which straightens your box photo again with corrected corners and places the pieces again. With the correction: 82 % (1 %), 82 % (2 %), 80 % (1.5 % too small). On a box picture that fits, it never offers anything. Your box picture fits *The Kiss* within 0.15 of a piece, so you won't see it there.

### M4 (part 6): green outlines: your table at a glance (2026-11-09; tested in the app on the Mac and checked on your iPhone)
- **🗺 Show my table** (puzzle page, under Pieces): your scan photo with every piece outlined by what the app knows. **Green:** its spot on the box is known (Strong or Likely), labelled with the spot ("26·1" = column 26, row 1). **Blue:** its shape is read, but several spots look alike. **Grey:** found, but its shape couldn't be read yet.
- **Tap a piece** to zoom in on it and see, e.g., "Column 26, row 1 (Strong, 87 %), top edge". **Show where it goes** opens its spot on the box picture; **Whole photo** zooms back out. Several photos? **Next photo**.
- **Progress line** under the piece groups: "23 found · 21 shapes read · 18 placed on box".
- **Frame sides:** a piece whose known spot is on the picture's edge shows an arrow on its picture (↑ top, → right, ↓ bottom, ← left, ↗ etc. for corners), and its details say "top edge" etc. The Border view counts them: "Side of the frame known: ↑ 4 · ↗ 1 · → 1".
- **Tested in the app with your 21-piece photo:** 18 green (all labelled with their holes), 3 blue, 2 grey (the bottle's label and the table patch). The frame sides match your holes: 4 top-edge pieces, the top-right corner, and one right-edge piece. Readable on a phone-sized screen; zoomed in, the labels are large.

### M4 (part 5): Fill this spot (2026-11-09; tested in the app on the Mac and checked on your iPhone)
- **🎯 Fill this spot** (puzzle page, under Pieces): the other way round from tapping a piece. Tap a spot on the box picture and see the pieces that may go there, each with its chance.
- **With your holes photo** (empty spots): tap near a hole and the app picks that hole (the light squares). The piece chosen for it comes first, in a green frame with Strong / Likely and its %. Other possible pieces follow in yellow frames, each saying where its own best spot is. Pieces already in a tray say "in tray C".
- **On the whole picture:** tap roughly, then tap the exact spot in the close-up (9 pieces across, with a grid), or move with the arrows. Listed: the pieces that have this spot among their best few. On real pieces that's often none, which the app says plainly.
- **Show on my table photo** lights up those pieces on your scan photo: the chosen one in green, the others in yellow.
- **Tested in the app with your photos:** all 21 holes. 17 show a Strong piece (the same 17 as the piece list), 1 Likely, and 2 "several spots look alike". Column 25, row 2 has no clear piece, but lists 4 possible ones (the two look-alike wall pieces among them). The photo lights the right pieces.

### M4 (part 4b): colour groups no longer fooled by the lamp (2026-11-09; tested in the app on the Mac and checked on your iPhone)
- **What you saw** (your screenshot IMG_9299, 3 trays): the dark pieces split over trays A and B, and tray C mixed the wall pieces with copper and brown ones. **Why:** your lamp lights the table unevenly. A wall piece in the darker part of the photo read as a dark piece, and wall pieces near the lamp read lighter and greyer, so their measured colours spread out.
- **Fixed:** the app now measures the table right around each piece and evens out each piece's colours to the same light before grouping. Lightness also counts a little less than colour, because shine changes it most.
- **Your current pieces don't need scanning again:** the light is measured from the saved photo they were scanned from (if a piece's photo is no longer kept, the page says so; scanning again fixes it). New scans measure it straight away.
- **On your 21 pieces, in the app:** with 3 trays, all 7 dark pieces are in one tray, the wall pieces in another, and the bottle's label and table patch in the third (the one copper piece still goes with the wall: 3 trays aren't enough for it). With 4 trays: very dark, dark reddish, wall, and the two non-pieces. With 6, the copper piece gets its own tray. No group mixes dark and wall pieces any more.

### M4 (part 4): sort your pieces into trays by colour (2026-11-09; checked on your iPhone together with part 4b)
- **Why colour and not zones of the box picture:** before building zones I measured them on your real photos. The right zone (out of 6) came out only **60 %** of the time for spots cut from your finished-puzzle photo, and for about **8 of 19** of your loose pieces (computer-made puzzles: 91 %). That would put many pieces in the wrong tray. The small AI picture model I then tried was no help either: even on spots cut from the box picture itself it found the right spot only 22 % of the time, and on your real spots almost never. It isn't added to the app.
- **🎨 Sort into trays by colour** (puzzle page, under Pieces): your pieces grouped by their main colour, one group per tray (default 6; 2 to 12 with − and +). Each piece shows its group's letter; "+B" means it also has a lot of B's colour.
- **Tap a group:** only its pieces show, and **Show on my table photo** lights them up on your scan photo (everything else darkened).
- **These went into tray A:** those pieces leave the table list ("18 on the table, 5 in trays"). A new scan of the table won't call them missing, and the groups' colours stay fixed while any tray holds pieces, so the letters never move. **Put tray A back on the table** undoes it.
- Pieces in trays still count for the empty spots of a nearly finished puzzle (without that, your 17 Strong dropped to 11 when the wall pieces went into a tray).
- **🖨 Print tray labels:** one label per tray, 6 on an A4 page, with the big letter on the group's colour and photos of up to 8 of its pieces. Print from the iPhone, or **Send to my Mac**.
- Not included: "where are these colours on the box picture". Your pieces' photo is much less yellow than your box photo, so it lit the right area for only 5–7 of 21 pieces' groups.
- **Tested in the app with your 21 pieces:** 6 groups that make sense (very dark, dark reddish, the grey-brown wall pieces together, mid brown, light grey, and the bottle's label with the table patch). Lit up on your photo, into a tray and back, labels: all as described. Not yet tried with a big pile of pieces.

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
