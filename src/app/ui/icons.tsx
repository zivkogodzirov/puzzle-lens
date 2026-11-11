/**
 * The app's one icon set (M9 part 2, design plan §3.6): line icons from Lucide, inlined so the app works
 * offline. Only the icons the app uses are here.
 *
 *   <Icon name="camera" />                     24 px, aria-hidden (next to a word that says what it is)
 *   <Icon name="x" size={20} label="Close" />  a button with no word: role="img" and aria-label
 *
 * Stroke 2, round caps, `currentColor` (the icon takes the text colour around it, so it follows light and
 * dark mode and needs no colour of its own). The <svg> has class "icon" (plus `class`) and data-icon={name}.
 *
 * Source: lucide-static 1.60.0 (npm), icons/<lucide name>.svg, path data copied unchanged; the Lucide name
 * is the comment above each entry where it differs. To add one: copy the child elements of that version's
 * SVG into ICONS under a short name, and add the name to the list in test/unit/app-icons.test.ts.
 * Licence: ISC (Lucide; some glyphs derive from Feather, MIT), full text in LICENSES/lucide.txt:
 *   ISC License. Copyright (c) 2026 Lucide Icons and Contributors. Permission to use, copy, modify, and/or
 *   distribute this software for any purpose with or without fee is hereby granted, provided that the above
 *   copyright notice and this permission notice appear in all copies. THE SOFTWARE IS PROVIDED "AS IS" AND
 *   THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 *   MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT,
 *   OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER
 *   IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE
 *   USE OR PERFORMANCE OF THIS SOFTWARE.
 *
 * ---------------------------------------------------------------------------------------------------------
 * Emoji and symbols in the app today → the icon that replaces them (for the screen-by-screen switch in
 * M9 part 2 round 2). Places are src/app/<file>:<line> as of this commit. One glyph per concept:
 * camera = Scan, scan-eye = Live view, image = a picture from Photos, puzzle = pieces, target = Fill a spot,
 * link = Joins (pairs), inbox = Trays, flask-conical = Tester (🧪).
 *
 *   📷 camera        Scan / take a photo / Live camera: components/FillSpot.tsx:201, components/Matches.tsx:123,
 *                    components/Matches.tsx:186, screens/Home.tsx:170, screens/NewPuzzle.tsx:585,
 *                    screens/Puzzle.tsx:1682 (action bar "Scan"), screens/Puzzle.tsx:1739 (in a sentence)
 *   📸 camera        new photo of the puzzle: screens/Puzzle.tsx:1359
 *   👁 scan-eye      Live view (action bar): screens/Puzzle.tsx:1227
 *   🗺 map           Show my table: screens/Puzzle.tsx:1049
 *   🖼 image         Choose a photo / from Photos: screens/NewPuzzle.tsx:597, screens/Scan.tsx:850,
 *                    screens/Puzzle.tsx:1739 (in a sentence)
 *   🧩 puzzle        a puzzle without a picture: screens/Home.tsx:18
 *   🧩 link          Joins / Which pieces join: screens/Puzzle.tsx:1160 (panel head), screens/Puzzle.tsx:1255 (action bar)
 *   🎯 target        Fill a spot: screens/Puzzle.tsx:1137 (panel head), screens/Puzzle.tsx:1241 (action bar)
 *   🎨 inbox         Sort into trays by colour: screens/Puzzle.tsx:1204
 *   🧪 flask-conical Tester / What to test: components/TestSteps.tsx:105, components/TestSteps.tsx:150,
 *                    components/TestSteps.tsx:158, screens/Settings.tsx:66 (in a sentence)
 *   🖨 printer       Print: components/Trays.tsx:216, screens/NewPuzzle.tsx:955, screens/NewPuzzle.tsx:1097,
 *                    screens/TrayLabels.tsx:164
 *   📊 bar-chart     How often is the app right?: screens/Puzzle.tsx:1414, screens/Settings.tsx:72
 *   📈 trending-up   Progress: screens/Puzzle.tsx:1409
 *   💾 save          Backup: screens/Puzzle.tsx:509
 *   🔄 refresh       Start a new batch: screens/Puzzle.tsx:620
 *   🔦 flashlight    the camera light: screens/Live.tsx:198 (button; needs label="Light"), screens/Help.tsx:153 (in a sentence)
 *   🩺 stethoscope   Device check: screens/Home.tsx:179
 *   📦 send          Send report: screens/Home.tsx:188
 *   🧭 compass       Setup guide: screens/Home.tsx:199
 *   ⚙️ settings      Settings: screens/Home.tsx:208
 *   ⏳ hourglass     working: screens/DeviceCheck.tsx:239
 *   🎉 party-popper  puzzle finished: screens/Progress.tsx:199
 *   ⚠ alert-triangle error line: components/Hud.tsx:58
 *   HUD activity     the performance display button (a word today): screens/Live.tsx (button; label="Performance display")
 *   ↻ rotate         Turn picture: screens/NewPuzzle.tsx:682
 *   ‹ chevron-left   Back / Home buttons: components/LiveTable.tsx:497, components/TableCamera.tsx:268,
 *                    components/TopBar.tsx:10, screens/Accuracy.tsx:80, screens/Live.tsx:106, screens/NewPuzzle.tsx:210,
 *                    screens/NewPuzzle.tsx:1090, screens/Progress.tsx:85, screens/TrayLabels.tsx:157
 *   › chevron-right  a row that opens: screens/Home.tsx:28 (the other › are menu paths in sentences, "Share › Print": keep as text)
 *   ▾ chevron-down   More: screens/Scan.tsx:787
 *   ⋯ more-horizontal Safari's ⋯ button, named in sentences: screens/Help.tsx:88, screens/Home.tsx:129, screens/NewPuzzle.tsx:257
 *   ○ circle         a step not done yet: screens/DeviceCheck.tsx:196 (✓ for done on the same line)
 *   ✕ x              close: components/LiveTable.tsx:597 (button; needs label="Close")
 *   ✗ x              Doesn't fit / No: components/FillSpot.tsx:278, components/LiveTable.tsx:581, components/Matches.tsx:129,
 *                    components/Matches.tsx:225, screens/Puzzle.tsx:1871; in sentences: screens/Accuracy.tsx:100,
 *                    screens/Progress.tsx:234, screens/Settings.tsx:74
 *   ✓ check          Fits / done. Buttons and badges: components/FillSpot.tsx:275, components/LiveTable.tsx:571,
 *                    components/Matches.tsx:109, components/Matches.tsx:126, components/Matches.tsx:189,
 *                    screens/DeviceCheck.tsx:196, screens/Puzzle.tsx:557, screens/Puzzle.tsx:571, screens/Puzzle.tsx:1327,
 *                    screens/Puzzle.tsx:1392, screens/Puzzle.tsx:1868, screens/Puzzle.tsx:1942, screens/Report.tsx:149.
 *                    Notes and status words ("Sent ✓"): components/FillSpot.tsx:159, components/LiveTable.tsx:481,
 *                    components/LiveTable.tsx:568, components/Matches.tsx:177, components/Matches.tsx:225,
 *                    components/Matches.tsx:322, components/TableContrast.tsx:82, components/TableContrast.tsx:89,
 *                    components/Trays.tsx:110, components/UpdateBanner.tsx:49, screens/DeviceCheck.tsx:183,
 *                    screens/Help.tsx:76, screens/NewPuzzle.tsx:985, screens/Puzzle.tsx:744, screens/Puzzle.tsx:753,
 *                    screens/Scan.tsx:501, screens/Scan.tsx:502, screens/Scan.tsx:875, screens/Settings.tsx:154,
 *                    screens/Settings.tsx:160, screens/StepTable.tsx:134, screens/StepTable.tsx:162.
 *                    Inside plain-text strings (a note built as a string, a canvas label, a sentence that quotes a
 *                    button): keep the ✓ text or split the string: components/LiveTable.tsx:568 (note),
 *                    screens/Puzzle.tsx:956 (live-view line label, drawn on canvas: stays text),
 *                    screens/Puzzle.tsx:1080, screens/Puzzle.tsx:1183, screens/Puzzle.tsx:1334, screens/Accuracy.tsx:100,
 *                    screens/Accuracy.tsx:101, screens/Accuracy.tsx:155, screens/Help.tsx:223, screens/Progress.tsx:129,
 *                    screens/Progress.tsx:130, screens/Progress.tsx:174, screens/Progress.tsx:234, screens/Scan.tsx:435,
 *                    screens/Settings.tsx:74
 *   Not in the app yet, ready for the new components: undo, trash, help-circle, home, plus, download, share,
 *   info, eye, box (the box picture), lock.
 *   Stays text: ⌘ (screens/TrayLabels.tsx:133), ✓ ✗ ⚠ in the device report (src/device/format.ts: plain text),
 *   the arrows ↑ → ↓ ← ↖ ↗ ↘ ↙ of SIDE_ARROW (src/project/progress.ts: inside sentences).
 * ---------------------------------------------------------------------------------------------------------
 */
import { createElement, type JSX } from 'preact';

type Shape = 'path' | 'circle' | 'rect' | 'polyline' | 'polygon' | 'line' | 'ellipse';
type Node = [Shape, Record<string, string>];

const ICONS = {
  camera: [
    [
      'path',
      {
        d: 'M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z',
      },
    ],
    ['circle', { cx: '12', cy: '13', r: '3' }],
  ],
  'scan-eye': [
    ['path', { d: 'M3 7V5a2 2 0 0 1 2-2h2' }],
    ['path', { d: 'M17 3h2a2 2 0 0 1 2 2v2' }],
    ['path', { d: 'M21 17v2a2 2 0 0 1-2 2h-2' }],
    ['path', { d: 'M7 21H5a2 2 0 0 1-2-2v-2' }],
    ['circle', { cx: '12', cy: '12', r: '1' }],
    ['path', { d: 'M18.944 12.33a1 1 0 0 0 0-.66 7.5 7.5 0 0 0-13.888 0 1 1 0 0 0 0 .66 7.5 7.5 0 0 0 13.888 0' }],
  ],
  image: [
    ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2', ry: '2' }],
    ['circle', { cx: '9', cy: '9', r: '2' }],
    ['path', { d: 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21' }],
  ],
  puzzle: [
    [
      'path',
      {
        d: 'M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z',
      },
    ],
  ],
  target: [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['circle', { cx: '12', cy: '12', r: '6' }],
    ['circle', { cx: '12', cy: '12', r: '2' }],
  ],
  link: [
    ['path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }],
    ['path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }],
  ],
  inbox: [
    ['polyline', { points: '22 12 16 12 14 15 10 15 8 12 2 12' }],
    ['path', { d: 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z' }],
  ],
  'flask-conical': [
    ['path', { d: 'M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2' }],
    ['path', { d: 'M6.453 15h11.094' }],
    ['path', { d: 'M8.5 2h7' }],
  ],
  check: [['path', { d: 'M20 6 9 17l-5-5' }]],
  x: [
    ['path', { d: 'M18 6 6 18' }],
    ['path', { d: 'm6 6 12 12' }],
  ],
  'chevron-left': [['path', { d: 'm15 18-6-6 6-6' }]],
  'chevron-right': [['path', { d: 'm9 18 6-6-6-6' }]],
  'chevron-down': [['path', { d: 'm6 9 6 6 6-6' }]],
  // ellipsis
  'more-horizontal': [
    ['circle', { cx: '12', cy: '12', r: '1' }],
    ['circle', { cx: '19', cy: '12', r: '1' }],
    ['circle', { cx: '5', cy: '12', r: '1' }],
  ],
  // undo-2
  undo: [
    ['path', { d: 'M9 14 4 9l5-5' }],
    ['path', { d: 'M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11' }],
  ],
  // trash-2
  trash: [
    ['path', { d: 'M10 11v6' }],
    ['path', { d: 'M14 11v6' }],
    ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }],
    ['path', { d: 'M3 6h18' }],
    ['path', { d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }],
  ],
  settings: [
    [
      'path',
      {
        d: 'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915',
      },
    ],
    ['circle', { cx: '12', cy: '12', r: '3' }],
  ],
  // circle-help
  'help-circle': [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['path', { d: 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3' }],
    ['path', { d: 'M12 17h.01' }],
  ],
  // house
  home: [
    ['path', { d: 'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8' }],
    ['path', { d: 'M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }],
  ],
  plus: [
    ['path', { d: 'M5 12h14' }],
    ['path', { d: 'M12 5v14' }],
  ],
  download: [
    ['path', { d: 'M12 15V3' }],
    ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
    ['path', { d: 'm7 10 5 5 5-5' }],
  ],
  share: [
    ['path', { d: 'M12 2v13' }],
    ['path', { d: 'm16 6-4-4-4 4' }],
    ['path', { d: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8' }],
  ],
  // refresh-cw
  refresh: [
    ['path', { d: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' }],
    ['path', { d: 'M21 3v5h-5' }],
    ['path', { d: 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' }],
    ['path', { d: 'M8 16H3v5' }],
  ],
  // rotate-cw
  rotate: [
    ['path', { d: 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8' }],
    ['path', { d: 'M21 3v5h-5' }],
  ],
  // triangle-alert
  'alert-triangle': [
    ['path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3' }],
    ['path', { d: 'M12 9v4' }],
    ['path', { d: 'M12 17h.01' }],
  ],
  info: [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['path', { d: 'M12 16v-4' }],
    ['path', { d: 'M12 8h.01' }],
  ],
  eye: [
    ['path', { d: 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0' }],
    ['circle', { cx: '12', cy: '12', r: '3' }],
  ],
  map: [
    [
      'path',
      {
        d: 'M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z',
      },
    ],
    ['path', { d: 'M15 5.764v15' }],
    ['path', { d: 'M9 3.236v15' }],
  ],
  'trending-up': [
    ['path', { d: 'M16 7h6v6' }],
    ['path', { d: 'm22 7-8.5 8.5-5-5L2 17' }],
  ],
  // chart-column
  'bar-chart': [
    ['path', { d: 'M3 3v16a2 2 0 0 0 2 2h16' }],
    ['path', { d: 'M18 17V9' }],
    ['path', { d: 'M13 17V5' }],
    ['path', { d: 'M8 17v-3' }],
  ],
  printer: [
    ['path', { d: 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2' }],
    ['path', { d: 'M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6' }],
    ['rect', { x: '6', y: '14', width: '12', height: '8', rx: '1' }],
  ],
  box: [
    ['path', { d: 'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z' }],
    ['path', { d: 'm3.3 7 8.7 5 8.7-5' }],
    ['path', { d: 'M12 22V12' }],
  ],
  lock: [
    ['rect', { width: '18', height: '11', x: '3', y: '11', rx: '2', ry: '2' }],
    ['path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' }],
  ],
  stethoscope: [
    ['path', { d: 'M11 2v2' }],
    ['path', { d: 'M5 2v2' }],
    ['path', { d: 'M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1' }],
    ['path', { d: 'M8 15a6 6 0 0 0 12 0v-3' }],
    ['circle', { cx: '20', cy: '10', r: '2' }],
  ],
  send: [
    ['path', { d: 'M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z' }],
    ['path', { d: 'm21.854 2.147-10.94 10.939' }],
  ],
  compass: [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['path', { d: 'm16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z' }],
  ],
  flashlight: [
    ['path', { d: 'M12 13v1' }],
    [
      'path',
      {
        d: 'M17 2a1 1 0 0 1 1 1v4a3 3 0 0 1-.6 1.8l-.6.8A4 4 0 0 0 16 12v8a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-8a4 4 0 0 0-.8-2.4l-.6-.8A3 3 0 0 1 6 7V3a1 1 0 0 1 1-1z',
      },
    ],
    ['path', { d: 'M6 6h12' }],
  ],
  hourglass: [
    ['path', { d: 'M5 22h14' }],
    ['path', { d: 'M5 2h14' }],
    ['path', { d: 'M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22' }],
    ['path', { d: 'M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2' }],
  ],
  save: [
    ['path', { d: 'M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z' }],
    ['path', { d: 'M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7' }],
    ['path', { d: 'M7 3v4a1 1 0 0 0 1 1h7' }],
  ],
  'party-popper': [
    ['path', { d: 'M5.8 11.3 2 22l10.7-3.79' }],
    ['path', { d: 'M4 3h.01' }],
    ['path', { d: 'M22 8h.01' }],
    ['path', { d: 'M15 2h.01' }],
    ['path', { d: 'M22 20h.01' }],
    ['path', { d: 'm22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10' }],
    ['path', { d: 'm22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17' }],
    ['path', { d: 'm11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7' }],
    ['path', { d: 'M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z' }],
  ],
  circle: [['circle', { cx: '12', cy: '12', r: '10' }]],
  // M9 part 2 round 2: the performance display (HUD) button on the Live camera screen.
  activity: [['path', { d: 'M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2' }]],
} satisfies Record<string, Node[]>;

export type IconName = keyof typeof ICONS;
/** Every icon's name, in the order above. */
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export interface IconProps {
  name: IconName;
  /** Width and height in px: 20–24 in the app (default 24). */
  size?: number;
  /** For an icon that stands alone (a button with no word): read out by VoiceOver. Without it the icon is hidden from VoiceOver. */
  label?: string;
  /** Extra class names (the <svg> always has "icon"). */
  class?: string;
}

/** One icon as inline SVG, in the colour of the text around it. */
export function Icon({ name, size = 24, label, class: cls }: IconProps): JSX.Element {
  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': 'true' as const };
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      focusable="false"
      class={cls ? `icon ${cls}` : 'icon'}
      data-icon={name}
      {...a11y}
    >
      {(ICONS[name] as Node[]).map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}
