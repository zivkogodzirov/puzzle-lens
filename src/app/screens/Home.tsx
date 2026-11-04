import { APP_VERSION, isStandalone, previousEndedUnexpectedly } from '../env';
import { hasPendingMemoryResult } from '../../device/memoryRunner';

export function HomeScreen() {
  // A memory test that never finished means iOS closed the app on purpose (that's how the test
  // measures): point to the result instead of showing the "ended unexpectedly" warning.
  const memoryResultWaiting = hasPendingMemoryResult();
  return (
    <main class="screen">
      <div class="topbar">
        <h1>Puzzle Lens</h1>
      </div>

      {!isStandalone.value && (
        <div class="notice notice-warn" data-testid="install-banner">
          <strong>Install first, then start your puzzle there.</strong>
          <p class="small">
            You're in a Safari tab. Puzzle data saved here is <em>not</em> shared with the Home Screen app, and Safari may delete it after 7 days
            without a visit.
          </p>
          <ol class="steps small">
            <li>
              Tap the <strong>Share</strong> button (square with an arrow). If you don't see it, tap <strong>⋯</strong> first.
            </li>
            <li>
              Scroll down (tap <strong>View More</strong> if you see it) and tap <strong>Add to Home Screen</strong>. If there's an{' '}
              <strong>Open as Web App</strong> switch, leave it on. Then tap <strong>Add</strong>.
            </li>
            <li>
              Open <strong>Puzzle Lens</strong> from your Home Screen.
            </li>
          </ol>
          <a class="btn btn-small" href="#/help">
            Full setup guide
          </a>
        </div>
      )}

      {memoryResultWaiting ? (
        <div class="notice notice-good" data-testid="memory-result-waiting">
          <p style={{ marginTop: 0 }}>The memory test finished — open Device check to see the result.</p>
          <a class="btn btn-small" href="#/device">
            Open Device check
          </a>
        </div>
      ) : (
        previousEndedUnexpectedly.value && (
          <div class="notice notice-bad" data-testid="crash-notice">
            The last visit may have ended unexpectedly: iOS may have closed the app, for example if it used too much memory. This is noted in the
            log and goes into the next report automatically.
          </div>
        )
      )}

      <div class="tiles">
        <a class="tile tile-wide" href="#/live">
          <span class="tile-icon">📷</span>
          <span>
            Live camera
            <div class="tile-sub">Camera, Snap and the speed display</div>
          </span>
        </a>
        <a class="tile" href="#/device">
          <span class="tile-icon">🩺</span>
          <span>
            Device check
            <div class="tile-sub">What your iPhone can do</div>
          </span>
        </a>
        <a class="tile" href="#/report">
          <span class="tile-icon">📦</span>
          <span>
            Send report
            <div class="tile-sub">For when something goes wrong</div>
          </span>
        </a>
        <a class="tile" href="#/help">
          <span class="tile-icon">🧭</span>
          <span>
            Setup guide
            <div class="tile-sub">Step by step</div>
          </span>
        </a>
        <a class="tile" href="#/settings">
          <span class="tile-icon">⚙️</span>
          <span>
            Settings
            <div class="tile-sub">Units, camera, data</div>
          </span>
        </a>
      </div>

      <h2>Your puzzles</h2>
      <div class="card muted">Your puzzles will appear here from the next milestone (M2).</div>

      <p class="muted small" style={{ marginTop: '24px' }}>
        Version {APP_VERSION} · <a href="#/log" style={{ color: 'inherit' }}>Activity log</a>
      </p>
    </main>
  );
}
