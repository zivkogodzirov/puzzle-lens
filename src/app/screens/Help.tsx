/**
 * Setup guide for M1 (PLAN §6 "Your setup guide"): plain-English numbered steps for installing,
 * trying the camera, the test marker, Device check, sending reports, and what to send.
 */
import { useEffect, useState } from 'preact/hooks';
import { TopBar } from '../components/TopBar';
import { isStandalone } from '../env';
import { logInfo } from '../../log/logger';
import { Callout } from '../ui/Callout';
import { ListRow, ListSection } from '../ui/List';
import { Icon } from '../ui/icons';

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

/** The guide's steps, for the index at the top (each scrolls to its card further down). */
const STEPS: ReadonlyArray<[testId: string, title: string]> = [
  ['help-install', 'Install Puzzle Lens on your Home Screen'],
  ['help-camera', 'Try the camera'],
  ['help-marker', 'Test marker'],
  ['help-device', 'Run the Device check, twice'],
  ['help-report', 'Send me a report'],
  ['help-send-list', 'What to send me for this milestone'],
];

function scrollToStep(testId: string): void {
  const el = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!el) return;
  let smooth = true;
  try {
    smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    /* no matchMedia */
  }
  el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  // VoiceOver and keyboards carry on from the step's heading.
  el.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
}

/** "https://example.com/app/" → "example.com/app", easier to read and type. */
function short(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export function HelpScreen() {
  const [showMarker, setShowMarker] = useState(false);
  const [shareNote, setShareNote] = useState('');
  const standalone = isStandalone.value;
  const here = appAddress();
  const guideUrl = `${here}#/help`;

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
      <TopBar title="Setup guide" />

      <p>
        Do these steps in order. Each one takes a few minutes. The app's address is{' '}
        <strong data-testid="public-address">{short(PUBLIC_ADDRESS)}</strong>.
      </p>

      <ListSection header="Steps" testId="help-index">
        {STEPS.map(([tid, title], i) => (
          <ListRow key={tid} title={`${i + 1}. ${title}`} chevron onClick={() => scrollToStep(tid)} testId={`${tid}-link`} />
        ))}
      </ListSection>

      {/* ---------- 1. Install ---------- */}
      <section class="card help-step" data-testid="help-install">
        <h2 style={{ marginTop: '4px' }} tabIndex={-1}>1. Install Puzzle Lens on your Home Screen</h2>
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
            Go to your Home Screen and open <strong>Puzzle Lens</strong> (a magnifying glass over a puzzle piece). From now on, always open it
            from there.
          </li>
        </ol>
        <p class="small">
          <strong>Why?</strong>
        </p>
        <ul class="small">
          <li>The Home Screen app keeps its own storage, separate from Safari. Things saved in a Safari tab don't show up in the app.</li>
          <li>Safari may delete a website's data after 7 days without a visit. The Home Screen app's data is protected from that.</li>
          <li>
            Your iPhone may ask for camera permission <strong>every time</strong> you open the app. That's a known Apple bug, not something you did
            wrong. Just tap <strong>Allow</strong>.
          </li>
        </ul>
      </section>

      {/* ---------- 2. Camera ---------- */}
      <section class="card help-step" data-testid="help-camera">
        <h2 style={{ marginTop: '4px' }} tabIndex={-1}>2. Try the camera</h2>
        <ol class="steps">
          <li>
            On the Home page, tap <strong>Live camera</strong>.
          </li>
          <li>
            Tap <strong>Start camera</strong>, then <strong>Allow</strong> when your iPhone asks.
          </li>
          <li>Point the camera at your table and tap the performance display button at the top (the one with a pulse line): the small box at the top left shows the numbers (the same button hides it):</li>
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
            Milliseconds each analysis step takes. Smaller is faster. "gpu-shrink" only appears when big pictures are first made smaller by the
            graphics chip.
          </dd>
          <dt>markers</dt>
          <dd>How many printed test markers the app sees right now.</dd>
          <dt>sharpness · gap</dt>
          <dd>
            Higher sharpness means a sharper picture. Gap is the longest pause between two analysis updates in the last second: lower is smoother
            (about 33 ms at 30 per second).
          </dd>
          <dt>memory</dt>
          <dd>Memory used by the analysis. These numbers should stay steady; if they keep growing, tell me.</dd>
          <dt>screen awake</dt>
          <dd>Whether the app is keeping your screen from going to sleep.</dd>
        </dl>
        <ol class="steps" start={4}>
          <li>
            The <strong>1×</strong> and <strong>2×</strong> buttons switch the zoom (2× only shows if your camera has it). The{' '}
            <Icon name="flashlight" size={18} class="icon-inline" label="light" /> button turns the light on and off. If there's a lens menu at the top, leave it
            as it is unless I ask.
          </li>
          <li>
            The big <strong>white round button</strong> is <strong>Snap</strong>. It takes a full-resolution photo, then shows a check of it: size,
            how long it took, brightness and sharpness. Tap <strong>Close</strong> to go back. If your iPhone's normal camera screen opens instead,
            take the photo there and tap <strong>Use Photo</strong>.
          </li>
        </ol>
        <a class="btn btn-small" href="#/live" data-testid="help-open-live">
          Open Live camera
        </a>
      </section>

      {/* ---------- 3. Test marker ---------- */}
      <section class="card help-step" data-testid="help-marker">
        <h2 style={{ marginTop: '4px' }} tabIndex={-1}>3. Test marker</h2>
        <p class="small">
          Later, the app finds its way around your table with printed square codes ("markers"). For now you can try one on a screen.
        </p>
        <ol class="steps">
          <li>
            On another screen (your Mac, or a second phone), open <strong data-testid="guide-address">{short(here)}</strong> in the browser and
            click <strong>Setup guide</strong>. Or tap <strong>Send this page to my Mac</strong> below and choose <strong>AirDrop</strong>: this
            page opens on the Mac by itself.
          </li>
          <li>
            On that screen, click <strong>Show test marker</strong> (it's in step 3). Turn the screen's brightness up.
          </li>
          <li>
            On your iPhone, open <strong>Live camera</strong>, tap <strong>Start camera</strong>, and point it at the marker from about 30 to 60 cm
            away.
          </li>
          <li>
            A <strong class="ok">green square labelled #0</strong> should appear on the marker, and <strong>markers</strong> in the performance
            display should show 1.
          </li>
          <li>Tap the marker to close it.</li>
        </ol>
        <p class="small muted">
          No green square? Move a little closer or further away, tilt to avoid reflections, and hold still for a second. If it still doesn't
          appear, send me a report (step 5).
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
        <p class="small muted">
          Prefer paper? On your Mac, open {short(here)}/test-markers.html and print it at 100% ("Actual Size"), not "Fit to page".
        </p>
      </section>

      {/* ---------- 4. Device check ---------- */}
      <section class="card help-step" data-testid="help-device">
        <h2 style={{ marginTop: '4px' }} tabIndex={-1}>4. Run the Device check, twice</h2>
        <p class="small">
          The camera and storage can behave differently in Safari and in the Home Screen app, so I need both.
        </p>
        <ol class="steps">
          <li>
            <strong>In Safari:</strong> open {short(PUBLIC_ADDRESS)} in a normal Safari tab, tap <strong>Device check</strong>, and do steps 1 to 4
            on that screen until it says <strong>All done ✓</strong>. Keep the phone still during the camera tests and the photo test. The memory
            test (step 5) is optional.
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
        <h2 style={{ marginTop: '4px' }} tabIndex={-1}>5. Send me a report</h2>
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
          AirDrop puts the file in the Downloads folder on your Mac. Just tell me when it's there. If the Share menu doesn't open, tap Share report
          again, or use "Download instead".
        </p>
        <a class="btn btn-small" href="#/report" data-testid="help-open-report">
          Open Send report
        </a>
      </section>

      {/* ---------- 6. What to send ---------- */}
      <section class="card help-step" data-testid="help-send-list">
        <h2 style={{ marginTop: '4px' }} tabIndex={-1}>6. What to send me for this milestone</h2>
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
          Take the photos with the normal Camera app. To send them, select them in Photos, tap Share, then AirDrop to your Mac. If you use Mail
          and it asks about size, choose <strong>Actual Size</strong>.
        </p>
      </section>

      {showMarker && <TestMarkerOverlay onClose={closeMarker} />}
    </main>
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
      <p style={{ color: 'var(--paper-muted)', fontSize: '15px', margin: 0 }}>Tap anywhere to close</p>
    </div>
  );
}

/** Opens the share sheet with `url`; falls back to copying it. Returns a note to show. */
async function shareOrCopy(url: string): Promise<string> {
  try {
    if (typeof navigator.share === 'function') {
      await navigator.share({ title: 'Puzzle Lens setup guide', url });
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
