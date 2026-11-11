/**
 * Help: "How it works" (M9 part 6, design plan §4 item 10): four illustrated steps in the app's own words —
 * scan your pieces, find where they go, say whether it fits, photograph the puzzle so far. Each picture is
 * drawn here from the app's icons and shapes (no photos), in the theme's colours.
 *
 * "For testing" (Tester mode only, or opened from Settings → Diagnostics at `#/help/testing`): the setup
 * guide for testers (PLAN §6), unchanged in substance — install, the camera, the test marker, Device check,
 * Send report, what to send, and the 🧪 test steps.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { TopBar } from '../components/TopBar';
import { openTestSteps } from '../components/TestSteps';
import { isStandalone } from '../env';
import { logInfo } from '../../log/logger';
import { routeArg } from '../router';
import { settings } from '../settings';
import { Callout } from '../ui/Callout';
import { ListRow, ListSection } from '../ui/List';
import { Icon, type IconName } from '../ui/icons';
import { ANSWER } from '../words';

/** Where the app is published (vite.config.ts BASE). */
const PUBLIC_ADDRESS = 'https://zivkogodzirov.github.io/puzzle-lens/';
const MARKER_SRC = `${import.meta.env.BASE_URL}test-marker.svg`;

/** The address this copy of the app is running from (the public address once deployed). */
function appAddress(): string {
  try {
    return new URL(import.meta.env.BASE_URL, location.href).href;
  } catch {
    return PUBLIC_ADDRESS;
  }
}

/** The tester guide's steps, for the index in "For testing" (each scrolls to its card further down). */
const STEPS: ReadonlyArray<[testId: string, title: string]> = [
  ['help-install', 'Install Puzzle Lens on your Home Screen'],
  ['help-camera', 'Try the camera'],
  ['help-marker', 'Test marker'],
  ['help-device', 'Run the Device check, twice'],
  ['help-report', 'Send me a report'],
  ['help-send-list', 'What to send me for this milestone'],
];

function smooth(): boolean {
  try {
    return !matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true; // no matchMedia
  }
}

function scrollToStep(testId: string): void {
  const el = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: smooth() ? 'smooth' : 'auto', block: 'start' });
  // VoiceOver and keyboards carry on from the step's heading.
  el.querySelector<HTMLElement>('h2, h3')?.focus({ preventScroll: true });
}

/** "https://example.com/app/" → "example.com/app", easier to read and type. */
function short(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/* ---------- The pictures: the app's icons and shapes, in the theme's colours (styles.css "help and access") ---------- */

/** One of the app's icons inside a picture, centred on (x, y). */
function Glyph({ name, x, y, size, class: cls }: { name: IconName; x: number; y: number; size: number; class?: string }) {
  return (
    <g transform={`translate(${x - size / 2} ${y - size / 2})`} class={cls}>
      <Icon name={name} size={size} />
    </g>
  );
}

/** A column·row label as the app draws it on the photo (a capsule). */
function Label({ x, y, text }: { x: number; y: number; text: string }) {
  const w = text.length * 7 + 12;
  return (
    <g class="how-label">
      <rect x={x - w / 2} y={y - 9} width={w} height={18} rx={9} />
      <text x={x} y={y + 4} text-anchor="middle">
        {text}
      </text>
    </g>
  );
}

/** A phone: its body, screen and the tab bar's four dots, at (x, y). */
function Phone({ x, y, children }: { x: number; y: number; children?: ComponentChildren }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect class="how-phone" x={0} y={0} width={86} height={128} rx={14} />
      <rect class="how-screen" x={5} y={5} width={76} height={118} rx={10} />
      {children}
    </g>
  );
}

function HowPicture({ step }: { step: 'scan' | 'find' | 'confirm' | 'picture' }) {
  return (
    <svg class="how-art" viewBox="0 0 280 140" aria-hidden="true" focusable="false" data-testid={`help-art-${step}`}>
      {step === 'scan' && (
        <>
          {/* The table with pieces spread out, the phone held flat over them; the shutter fills while it is still. */}
          <rect class="how-table" x={8} y={96} width={264} height={36} rx={8} />
          <Glyph name="puzzle" x={40} y={114} size={22} class="how-piece" />
          <Glyph name="puzzle" x={78} y={110} size={22} class="how-piece" />
          <Glyph name="puzzle" x={202} y={116} size={22} class="how-piece" />
          <Glyph name="puzzle" x={240} y={110} size={22} class="how-piece" />
          <Phone x={97} y={4}>
            <rect class="how-dash" x={16} y={18} width={54} height={50} rx={6} />
            <Glyph name="puzzle" x={33} y={36} size={16} class="how-piece" />
            <Glyph name="puzzle" x={53} y={52} size={16} class="how-piece" />
            <circle class="how-shutter" cx={43} cy={98} r={14} />
            <circle class="how-shutter-fill" cx={43} cy={98} r={9} />
          </Phone>
        </>
      )}
      {step === 'find' && (
        <>
          {/* The Table tab: each piece with its column·row label; the box picture with that spot ringed. */}
          <Phone x={14} y={6}>
            <Glyph name="puzzle" x={28} y={34} size={18} class="how-piece" />
            <Label x={28} y={54} text="3·2" />
            <Glyph name="puzzle" x={58} y={70} size={18} class="how-piece" />
            <Label x={58} y={90} text="5·1" />
            <rect class="how-tabbar" x={5} y={104} width={76} height={19} />
            <circle class="how-tab-on" cx={20} cy={113} r={3.5} />
            <circle class="how-tab" cx={36} cy={113} r={3} />
            <circle class="how-tab" cx={51} cy={113} r={3} />
            <circle class="how-tab" cx={66} cy={113} r={3} />
          </Phone>
          <Glyph name="chevron-right" x={124} y={70} size={28} class="how-arrow" />
          <g transform="translate(146 26)">
            {[0, 1, 2, 3, 4, 5].map((c) => [0, 1, 2, 3].map((r) => <rect key={`${c}${r}`} class="how-cell" x={c * 20} y={r * 22} width={20} height={22} />))}
            <rect class="how-ring" x={40} y={22} width={20} height={22} rx={3} />
          </g>
        </>
      )}
      {step === 'confirm' && (
        <>
          {/* The piece card: "Did it fit?", then Not there and It fits; Undo on the toast after. */}
          <rect class="how-card" x={30} y={8} width={220} height={92} rx={14} />
          <text class="how-text" x={140} y={32} text-anchor="middle">
            Did it fit?
          </text>
          <rect class="how-btn" x={44} y={46} width={92} height={36} rx={10} />
          <Glyph name="x" x={62} y={64} size={16} />
          <text class="how-text-small" x={100} y={68} text-anchor="middle">
            {ANSWER.not}
          </text>
          <rect class="how-btn-good" x={144} y={46} width={92} height={36} rx={10} />
          <Glyph name="check" x={162} y={64} size={16} class="how-on-good" />
          <text class="how-text-small how-on-good-text" x={200} y={68} text-anchor="middle">
            {ANSWER.fits}
          </text>
          <rect class="how-toast" x={70} y={108} width={140} height={26} rx={13} />
          <Glyph name="undo" x={96} y={121} size={14} class="how-on-toast" />
          <text class="how-text-small how-on-toast-text" x={150} y={125} text-anchor="middle">
            Undo
          </text>
        </>
      )}
      {step === 'picture' && (
        <>
          {/* The Picture tab: spots in the puzzle bright, the rest dim; a photo of the puzzle so far updates it. */}
          <g transform="translate(24 18)">
            {[0, 1, 2, 3, 4, 5].map((c) =>
              [0, 1, 2, 3].map((r) => (
                <rect key={`${c}${r}`} class={(c + r * 6) % 7 < 4 ? 'how-cell-done' : 'how-cell'} x={c * 22} y={r * 24} width={22} height={24} />
              )),
            )}
          </g>
          <circle class="how-cam-bg" cx={216} cy={66} r={34} />
          <Glyph name="camera" x={216} y={66} size={34} class="how-on-good" />
        </>
      )}
    </svg>
  );
}

/** The four steps, in the app's words today (tabs and buttons as they are named). */
const HOW: ReadonlyArray<{ id: 'scan' | 'find' | 'confirm' | 'picture'; title: string; body: ComponentChildren }> = [
  {
    id: 'scan',
    title: 'Scan your pieces',
    body: (
      <>
        <p>
          Spread the loose pieces on your table, picture side up and not touching. In your puzzle, tap{' '}
          <Icon name="camera" size={18} class="icon-inline" label="Scan pieces" /> at the top.
        </p>
        <p>
          Hold the phone flat over the pieces. The ring around the big button fills while you hold still, then the photo takes itself. Start with a{' '}
          <strong>Whole table</strong> photo, then take <strong>Close-ups</strong> so the app can read each piece’s shape.
        </p>
      </>
    ),
  },
  {
    id: 'find',
    title: 'Find where they go',
    body: (
      <>
        <p>
          The <strong>Table</strong> tab shows your table with a label on each piece: <strong>3·2</strong> means column 3, row 2 on the box picture. Tap{' '}
          <strong>Start live view</strong> to see the labels through the camera.
        </p>
        <p>
          Tap a piece (or choose it from <strong>Pieces in view</strong>) to open its card: the spot on the box picture, ringed, and how sure the app is.
        </p>
      </>
    ),
  },
  {
    id: 'confirm',
    title: 'Say whether it fits',
    body: (
      <>
        <p>
          Try the piece in that spot, then tap <strong>{ANSWER.fits}</strong> or <strong>{ANSWER.not}</strong>. Not there shows the next best spot.
        </p>
        <p>
          Tapped the wrong one? Tap <strong>Undo</strong> on the note at the bottom of the screen. Each answer helps the app with the pieces still on your
          table.
        </p>
      </>
    ),
  },
  {
    id: 'picture',
    title: 'Photograph the puzzle so far',
    body: (
      <>
        <p>
          The <strong>Picture</strong> tab shows how far you are: spots in the puzzle are bright, the rest dim. A ring marks a spot whose piece is waiting on
          your table; <strong>Fill a spot</strong> shows which piece goes there.
        </p>
        <p>
          When many pieces are in, tap <strong>Photograph the puzzle so far</strong>. The app counts what is in and marks the empty spots.
        </p>
      </>
    ),
  },
];

export function HelpScreen() {
  const [showMarker, setShowMarker] = useState(false);
  const [shareNote, setShareNote] = useState('');
  const standalone = isStandalone.value;
  const here = appAddress();
  const guideUrl = `${here}#/help/testing`;
  // "For testing": in Tester mode, or opened straight from Settings → Diagnostics (#/help/testing).
  const forTesting = routeArg.value === 'testing';
  const testing = settings.testerMode.value || forTesting;

  useEffect(() => {
    if (!forTesting) return;
    // From Settings → Diagnostics: straight to "For testing" (after the screen has drawn).
    const t = setTimeout(() => scrollToStep('help-testing'), 50);
    return () => clearTimeout(t);
  }, [forTesting]);

  const openMarker = () => {
    // Big screens (e.g. a Mac): also ask for real full screen. Must happen inside the tap.
    // iPhone Safari has no element full screen; the white overlay covers the page anyway.
    try {
      const el = document.documentElement;
      if (typeof el.requestFullscreen === 'function' && !document.fullscreenElement) void el.requestFullscreen().catch(() => {});
    } catch {
      /* not available */
    }
    setShowMarker(true);
    logInfo('help', 'Test marker shown');
  };

  const closeMarker = () => {
    setShowMarker(false);
    try {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    } catch {
      /* not available */
    }
  };

  const sendAddress = () => {
    // navigator.share must be called straight from the tap (iOS gives it ~5 seconds).
    void shareOrCopy(guideUrl).then(setShareNote);
  };

  return (
    <main class="screen" data-testid="help-screen">
      <TopBar title="How it works" />

      <p class="help-intro">Puzzle Lens tells you where your loose pieces go. It works in four steps.</p>

      <ol class="how-steps" data-testid="help-how">
        {HOW.map((s, i) => (
          <li key={s.id} class="card how-step" data-testid={`help-step-${s.id}`}>
            <HowPicture step={s.id} />
            <h2 class="how-title">
              <span class="how-n" aria-hidden="true">
                {i + 1}
              </span>
              <span class="sr-only">Step {i + 1}: </span>
              {s.title}
            </h2>
            <div class="how-body">{s.body}</div>
          </li>
        ))}
      </ol>

      {/* Not installed yet: the install steps for everyone (in Tester mode they are the first card of "For testing"). */}
      {!testing && !standalone && <InstallCard standalone={standalone} alone />}

      {testing && (
        <section class="help-testing" data-testid="help-testing" aria-labelledby="help-testing-title">
          <h2 id="help-testing-title" class="help-testing-title" tabIndex={-1}>
            For testing
          </h2>
          <p class="small muted">
            {settings.testerMode.value ? 'Shown while Tester mode is on (Settings).' : 'Opened from Settings → Diagnostics.'} Do these steps in order. Each one
            takes a few minutes. The app's address is <strong data-testid="public-address">{short(PUBLIC_ADDRESS)}</strong>.
          </p>

          <ListSection header="Steps" testId="help-index">
            {STEPS.map(([tid, title], i) => (
              <ListRow key={tid} title={`${i + 1}. ${title}`} chevron onClick={() => scrollToStep(tid)} testId={`${tid}-link`} />
            ))}
          </ListSection>

          {settings.testerMode.value && (
            <ListSection footer="The steps to try for this version, with tick boxes. Also behind the flask button at the top of each screen.">
              <ListRow icon={<Icon name="flask-conical" />} tone="accent" title="What to test now" onClick={openTestSteps} testId="help-open-test-steps" />
            </ListSection>
          )}

          <InstallCard standalone={standalone} />

          {/* ---------- 2. Camera ---------- */}
          <section class="card help-step" data-testid="help-camera">
            <h3 class="help-test-title" tabIndex={-1}>
              2. Try the camera
            </h3>
            <ol class="steps">
              <li>
                On the Home page, tap <strong>Live camera</strong>.
              </li>
              <li>
                Tap <strong>Start camera</strong>, then <strong>Allow</strong> when your iPhone asks.
              </li>
              <li>
                Point the camera at your table and tap the performance display button at the top (the one with a pulse line): the small box at the top left
                shows the numbers (the same button hides it):
              </li>
            </ol>
            <dl class="kv" data-testid="hud-explained">
              <dt>camera</dt>
              <dd>The picture size and speed the camera really gives, e.g. 4032×3024 @30.</dd>
              <dt>video · tracker</dt>
              <dd>Pictures per second shown on screen, and pictures per second the app analyses. Higher is smoother.</dd>
              <dt>frames</dt>
              <dd>How the live pictures reach the app ("direct" is best), and their size.</dd>
              <dt>ms</dt>
              <dd>
                Milliseconds each analysis step takes. Smaller is faster. "gpu-shrink" only appears when big pictures are first made smaller by the graphics
                chip.
              </dd>
              <dt>markers</dt>
              <dd>How many printed test markers the app sees right now.</dd>
              <dt>sharpness · gap</dt>
              <dd>
                Higher sharpness means a sharper picture. Gap is the longest pause between two analysis updates in the last second: lower is smoother (about 33
                ms at 30 per second).
              </dd>
              <dt>memory</dt>
              <dd>Memory used by the analysis. These numbers should stay steady; if they keep growing, tell me.</dd>
              <dt>screen awake</dt>
              <dd>Whether the app is keeping your screen from going to sleep.</dd>
            </dl>
            <ol class="steps" start={4}>
              <li>
                The <strong>1×</strong> and <strong>2×</strong> buttons switch the zoom (2× only shows if your camera has it). The{' '}
                <Icon name="flashlight" size={18} class="icon-inline" label="light" /> button turns the light on and off. If there's a lens menu at the top,
                leave it as it is unless I ask.
              </li>
              <li>
                The big <strong>white round button</strong> is <strong>Snap</strong>. It takes a full-resolution photo, then shows a check of it: size, how long
                it took, brightness and sharpness. Tap <strong>Close</strong> to go back. If your iPhone's normal camera screen opens instead, take the photo
                there and tap <strong>Use Photo</strong>.
              </li>
            </ol>
            <a class="btn btn-small" href="#/live" data-testid="help-open-live">
              Open Live camera
            </a>
          </section>

          {/* ---------- 3. Test marker ---------- */}
          <section class="card help-step" data-testid="help-marker">
            <h3 class="help-test-title" tabIndex={-1}>
              3. Test marker
            </h3>
            <p class="small">Later, the app finds its way around your table with printed square codes ("markers"). For now you can try one on a screen.</p>
            <ol class="steps">
              <li>
                On another screen (your Mac, or a second phone), open <strong data-testid="guide-address">{short(guideUrl)}</strong> in the browser: it opens at{' '}
                <strong>For testing</strong>. Or tap <strong>Send this page to my Mac</strong> below and choose <strong>AirDrop</strong>: this page opens on the
                Mac by itself.
              </li>
              <li>
                On that screen, click <strong>Show test marker</strong> (it's in step 3). Turn the screen's brightness up.
              </li>
              <li>
                On your iPhone, open <strong>Live camera</strong>, tap <strong>Start camera</strong>, and point it at the marker from about 30 to 60 cm away.
              </li>
              <li>
                A <strong class="ok">green square labelled #0</strong> should appear on the marker, and <strong>markers</strong> in the performance display
                should show 1.
              </li>
              <li>Tap the marker to close it.</li>
            </ol>
            <p class="small muted">
              No green square? Move a little closer or further away, tilt to avoid reflections, and hold still for a second. If it still doesn't appear, send me
              a report (step 5).
            </p>
            <div class="row">
              <button class="btn btn-primary" data-testid="show-test-marker" onClick={openMarker}>
                Show test marker
              </button>
              <button class="btn" data-testid="share-address" onClick={sendAddress}>
                Send this page to my Mac
              </button>
            </div>
            {shareNote && (
              <p class="small" data-testid="share-note">
                {shareNote}
              </p>
            )}
            <p class="small muted">Prefer paper? On your Mac, open {short(here)}/test-markers.html and print it at 100% ("Actual Size"), not "Fit to page".</p>
          </section>

          {/* ---------- 4. Device check ---------- */}
          <section class="card help-step" data-testid="help-device">
            <h3 class="help-test-title" tabIndex={-1}>
              4. Run the Device check, twice
            </h3>
            <p class="small">The camera and storage can behave differently in Safari and in the Home Screen app, so I need both.</p>
            <ol class="steps">
              <li>
                <strong>In Safari:</strong> open {short(PUBLIC_ADDRESS)} in a normal Safari tab, tap <strong>Device check</strong>, and do steps 1 to 4 on that
                screen until it says <strong>All done ✓</strong>. Keep the phone still during the camera tests and the photo test. The memory test (step 5) is
                optional.
              </li>
              <li>Still in Safari, send me a report (step 5).</li>
              <li>
                <strong>In the Home Screen app:</strong> open Puzzle Lens from your Home Screen and do the same again: Device check, then send a report.
              </li>
            </ol>
            <p class="small muted" data-testid="mode-now">
              Right now you're in {standalone ? 'the Home Screen app' : 'a Safari tab'}. The two keep separate data, so send a report from each one.
            </p>
            <a class="btn btn-small" href="#/device" data-testid="help-open-device">
              Open Device check
            </a>
          </section>

          {/* ---------- 5. Report ---------- */}
          <section class="card help-step" data-testid="help-report">
            <h3 class="help-test-title" tabIndex={-1}>
              5. Send me a report
            </h3>
            <ol class="steps">
              <li>
                On the Home page, tap <strong>Send report</strong>.
              </li>
              <li>
                Tap <strong>Prepare report</strong> and wait until it says it's ready.
              </li>
              <li>
                Tap <strong>Share report</strong>.
              </li>
              <li>
                Choose <strong>AirDrop</strong> and pick your Mac. (Or choose <strong>Mail</strong> and email it to yourself.)
              </li>
            </ol>
            <p class="small muted">
              AirDrop puts the file in the Downloads folder on your Mac. Just tell me when it's there. If the Share menu doesn't open, tap Share report again,
              or use "Download instead".
            </p>
            <a class="btn btn-small" href="#/report" data-testid="help-open-report">
              Open Send report
            </a>
          </section>

          {/* ---------- 6. What to send ---------- */}
          <section class="card help-step" data-testid="help-send-list">
            <h3 class="help-test-title" tabIndex={-1}>
              6. What to send me for this milestone
            </h3>
            <ol class="steps">
              <li>
                <strong>A photo of the puzzle box:</strong> the front picture, taken straight on, the whole box in view, no glare.
              </li>
              <li>
                <strong>A photo of your mat</strong> (or the table you'll sort on), from above, with a few pieces on it, in your usual light.
              </li>
              <li>
                <strong>The Device check reports:</strong> one from Safari and one from the Home Screen app.
              </li>
              <li>
                <strong>A screenshot of anything odd.</strong> To take one, press the side button and the volume-up button at the same time.
              </li>
            </ol>
            <p class="small muted">
              Take the photos with the normal Camera app. To send them, select them in Photos, tap Share, then AirDrop to your Mac. If you use Mail and it asks
              about size, choose <strong>Actual Size</strong>.
            </p>
          </section>
        </section>
      )}

      {showMarker && <TestMarkerOverlay onClose={closeMarker} />}
    </main>
  );
}

/** Installing on the Home Screen: the first card of "For testing", or on its own in a Safari tab. */
function InstallCard({ standalone, alone = false }: { standalone: boolean; alone?: boolean }) {
  // On its own (after the four steps) it is a section of the page (h2); in "For testing", its first step (h3).
  const Title = alone ? 'h2' : 'h3';
  return (
    <>
      {/* ---------- 1. Install ---------- */}
      <section class="card help-step" data-testid="help-install">
        <Title class="help-test-title" tabIndex={-1}>
          {alone ? 'Install Puzzle Lens on your Home Screen' : '1. Install Puzzle Lens on your Home Screen'}
        </Title>
        {standalone ? (
          <Callout kind="good" testId="install-status">
            You're using the Home Screen app. This part is done.
          </Callout>
        ) : (
          <Callout kind="warn" testId="install-status">
            You're in a Safari tab right now. Please install the app with the steps below.
          </Callout>
        )}
        <ol class="steps">
          <li>
            Open <strong>Safari</strong> and go to <strong>{short(PUBLIC_ADDRESS)}</strong>.
          </li>
          <li>
            Tap the <strong>Share</strong> button (a square with an arrow pointing up). If you don't see it, tap the{' '}
            <Icon name="more-horizontal" size={18} class="icon-inline" label="⋯ (More)" /> button at the bottom right first, then <strong>Share</strong>.
          </li>
          <li>
            In the list that opens, scroll down (tap <strong>View More</strong> if you see it) and tap <strong>Add to Home Screen</strong>.
          </li>
          <li>
            If you see <strong>Open as Web App</strong>, leave it switched on. Then tap <strong>Add</strong> at the top right.
          </li>
          <li>
            Go to your Home Screen and open <strong>Puzzle Lens</strong> (a magnifying glass over a puzzle piece). From now on, always open it from there.
          </li>
        </ol>
        <p class="small">
          <strong>Why?</strong>
        </p>
        <ul class="small">
          <li>The Home Screen app keeps its own storage, separate from Safari. Things saved in a Safari tab don't show up in the app.</li>
          <li>Safari may delete a website's data after 7 days without a visit. The Home Screen app's data is protected from that.</li>
          <li>
            Your iPhone may ask for camera permission <strong>every time</strong> you open the app. That's a known Apple bug, not something you did wrong. Just
            tap <strong>Allow</strong>.
          </li>
        </ul>
      </section>
    </>
  );
}

/** The test marker on white, as large as the screen allows. Tap (or Esc) closes it. */
function TestMarkerOverlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Test marker. Tap to close."
      data-testid="test-marker-overlay"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'var(--paper)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        cursor: 'pointer',
      }}
    >
      <img
        src={MARKER_SRC}
        alt="Test marker number 0"
        data-testid="test-marker-img"
        draggable={false}
        style={{ width: 'min(92vw, 84vh)', height: 'min(92vw, 84vh)', display: 'block' }}
      />
      <p style={{ color: 'var(--paper-muted)', fontSize: 'calc(15 * var(--pt))', margin: 0 }}>Tap anywhere to close</p>
    </div>
  );
}

/** Opens the share sheet with `url`; falls back to copying it. Returns a note to show. */
async function shareOrCopy(url: string): Promise<string> {
  try {
    if (typeof navigator.share === 'function') {
      await navigator.share({ title: 'Puzzle Lens: for testing', url });
      return '';
    }
  } catch (e) {
    if ((e as { name?: string } | null)?.name === 'AbortError') return ''; // you closed the share sheet
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'Address copied. Paste it into the browser on the other screen.';
  } catch {
    return `Type this address into the browser on the other screen: ${short(url)}`;
  }
}
