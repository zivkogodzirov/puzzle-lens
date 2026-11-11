import { useEffect, useRef, useState } from 'preact/hooks';
import { TopBar } from '../components/TopBar';
import { isStandalone } from '../env';
import {
  abortCameraTests,
  cancelMemory,
  deviceCheck,
  dismissNotice,
  fileCameraChosen,
  startPhotoProbe,
  loadSaved,
  openFileCamera,
  startAutomatic,
  startCameraTests,
  startMemory,
} from '../../device/session';
import {
  formatMs,
  groupBySection,
  isFromOlderVersion,
  modeLabel,
  PART_NAMES,
  partDone,
  REQUIRED_PARTS,
  statusClass,
  statusSymbol,
  statusWord,
  summaryLine,
  verdictLine,
} from '../../device/format';
import type { CheckEntry, DeviceCheckResults, DisplayMode, RunPart } from '../../device/types';
import type { CvBenchResult } from '../../shared/types';
import { Callout } from '../ui/Callout';
import { Icon } from '../ui/icons';

function when(ts: number | undefined): string {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function isBench(x: unknown): x is CvBenchResult {
  return Boolean(x && typeof x === 'object' && Array.isArray((x as CvBenchResult).stages));
}

function CheckRow({ c, older }: { c: CheckEntry; older: boolean }) {
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((o) => !o);
  return (
    <>
      {/* M9 part 6 help: a real button (it was a div with role=button). */}
      <button
        type="button"
        class="check-row check-row-btn"
        aria-expanded={open}
        data-testid={`check-${c.id}`}
        data-status={c.status}
        style={{ cursor: 'pointer', alignItems: 'baseline' }}
        onClick={toggle}
      >
        <span class="check-name">{c.label}</span>
        <span
          class={statusClass(c.status)}
          aria-label={statusWord(c.status)}
          title={statusWord(c.status)}
          style={{ width: '1.4em', textAlign: 'center', fontWeight: 700, flex: 'none' }}
        >
          {statusSymbol(c.status)}
        </span>
        <span class="check-value" style={{ flex: '0 0 48%' }}>
          {c.value}
          {older && <span class="muted small"> (older version)</span>}
        </span>
      </button>
      {open && (
        <div data-testid={`check-details-${c.id}`}>
          {c.status === 'info' && (
            <p class="small muted" style={{ margin: '4px 0' }}>
              Normal on iPhone — nothing to do.
            </p>
          )}
          {older && (
            <p class="small muted" style={{ margin: '4px 0' }} data-testid={`check-older-${c.id}`}>
              Measured with an older version of the app ({c.appVersion}). Run this step again to refresh it.
            </p>
          )}
          <pre class="logbox" style={{ fontSize: 'calc(11 * var(--pt))', maxHeight: '45vh', margin: '4px 0 8px' }}>
            {c.details === undefined ? 'No details.' : JSON.stringify(c.details, null, 2)}
          </pre>
        </div>
      )}
    </>
  );
}

function BenchTable({ bench }: { bench: CvBenchResult }) {
  return (
    <div style={{ marginTop: '10px' }}>
      <p class="small muted" style={{ margin: '0 0 4px' }}>
        Image engine speed, per step (one-off load {formatMs(bench.loadMs)}):
      </p>
      <table class="small" style={{ width: '100%', borderCollapse: 'collapse' }} data-testid="opencv-bench-table">
        <tbody>
          {bench.stages.map((s) => (
            <tr key={s.name}>
              <td style={{ padding: '2px 6px 2px 0' }}>{s.name}</td>
              <td class="muted" style={{ padding: '2px 6px', whiteSpace: 'nowrap' }}>
                {s.size}
              </td>
              <td style={{ padding: '2px 0', textAlign: 'right', whiteSpace: 'nowrap' }}>{formatMs(s.ms)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Results({ results, running }: { results: DeviceCheckResults; running: boolean }) {
  const sections = groupBySection(results.checks);
  const benchDetails = results.checks.find((c) => c.id === 'opencv-bench')?.details;
  const env = results.environment;
  const verdict = verdictLine(results.checks);
  const anyOlder = results.checks.some((c) => isFromOlderVersion(c, results));
  return (
    <div data-testid="device-check-results" data-running={running ? 'true' : 'false'} data-mode={results.mode}>
      <p class="small muted" style={{ margin: '0 0 4px' }}>
        {running ? 'Checking now' : `Checked ${when(results.ts)}`} in the <strong>{modeLabel(results.mode)}</strong> · version {results.appVersion}
      </p>
      {!running && results.checks.length > 0 && (
        <div data-testid="device-check-verdict" data-tone={verdict.tone}>
          <Callout kind={verdict.tone}>{verdict.text}</Callout>
        </div>
      )}
      {results.checks.length > 0 && (
        <p class="small" data-testid="device-check-summary">
          {summaryLine(results.checks)}. Tap a row for details.
        </p>
      )}
      {anyOlder && !running && (
        <p class="small muted" data-testid="device-check-older">
          The app was updated since some of these were measured (marked "older version"). They're still included in reports; run those steps again to refresh
          them.
        </p>
      )}
      {sections.map((s) => (
        <section key={s.id} data-testid={`device-section-${s.id}`}>
          <h3 style={{ fontSize: 'calc(16 * var(--pt))', margin: '16px 0 4px' }}>{s.title}</h3>
          <div class="card" style={{ padding: '4px 14px' }}>
            {s.checks.map((c) => (
              <CheckRow key={c.id} c={c} older={isFromOlderVersion(c, results)} />
            ))}
            {s.id === 'graphics' && isBench(benchDetails) && <BenchTable bench={benchDetails} />}
          </div>
        </section>
      ))}
      {env && (
        <details class="card small" style={{ marginTop: '16px' }}>
          <summary>About this iPhone</summary>
          <dl class="kv" style={{ marginTop: '8px' }}>
            <dt>Screen</dt>
            <dd>
              {env.screen.width}×{env.screen.height} points, {env.devicePixelRatio}× pixels
            </dd>
            <dt>Processor cores</dt>
            <dd>{env.hardwareConcurrency ?? '—'}</dd>
            <dt>Safari</dt>
            <dd>{env.safariVersion ?? '—'}</dd>
            <dt>Browser ID</dt>
            <dd style={{ fontSize: 'calc(13 * var(--pt))' }}>{env.userAgent}</dd>
          </dl>
        </details>
      )}
    </div>
  );
}

const ALL_PARTS: readonly RunPart[] = [...REQUIRED_PARTS, 'memory'];

/**
 * Which steps are done in THIS mode (Safari tab or Home Screen app). The other mode keeps separate
 * storage on an iPhone, so its run can't be shown here; the text says so instead of a status.
 */
function StepsCard({ mode, results, busy }: { mode: DisplayMode; results: DeviceCheckResults | null; busy: boolean }) {
  const doneCount = REQUIRED_PARTS.filter((p) => partDone(results, p)).length;
  const allDone = doneCount === REQUIRED_PARTS.length;
  const other: DisplayMode = mode === 'standalone' ? 'browser' : 'standalone';
  const headline = allDone
    ? 'All done — now send a report'
    : doneCount === 0
      ? `Not checked yet in the ${modeLabel(mode)}`
      : `${doneCount} of ${REQUIRED_PARTS.length} steps done in the ${modeLabel(mode)}`;
  return (
    <Callout kind={allDone ? 'good' : 'warn'} title={<span data-testid={`device-checked-${mode}`}>{headline}</span>} testId="device-check-reminder">
      <ul class="part-list small">
        {ALL_PARTS.map((p, i) => {
          const done = partDone(results, p);
          return (
            <li key={p} data-testid={`device-part-${p}`} data-done={done ? 'true' : 'false'}>
              <Icon name={done ? 'check' : 'circle'} size={18} class={`part-mark${done ? ' is-done' : ''}`} label={done ? 'Done' : 'Not done yet'} /> {i + 1}.{' '}
              {PART_NAMES[p]}
              {done && results?.parts[p] ? <span class="muted"> · {when(results.parts[p])}</span> : null}
            </li>
          );
        })}
      </ul>
      {allDone && !busy && (
        <a class="btn btn-small callout-action callout-link" href="#/report" data-testid="device-all-done">
          Send report
        </a>
      )}
      <p class="small" style={{ marginBottom: 0 }}>
        Also run this in the <strong>{modeLabel(other)}</strong> and send a report from there too. The two keep separate data, so this screen can't see that
        run.
      </p>
    </Callout>
  );
}

export function DeviceCheckScreen() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const probeVideoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmMemory, setConfirmMemory] = useState(false);

  useEffect(() => {
    void loadSaved();
    return () => {
      abortCameraTests();
      cancelMemory();
    };
  }, []);

  const running = deviceCheck.running.value;
  const busy = running !== null;
  const progress = deviceCheck.progress.value;
  const results = deviceCheck.results.value;
  const mode: DisplayMode = isStandalone.value ? 'standalone' : 'browser';
  const progressLine = (part: typeof running) =>
    running === part && (
      <Callout kind="info" icon={<Icon name="hourglass" />} role="status" testId="device-check-progress">
        {progress || 'Working…'}
      </Callout>
    );

  return (
    <main class="screen">
      <TopBar title="Device check" />
      <p class="muted">This finds out what your iPhone can do for Puzzle Lens. Nothing leaves your phone unless you send a report.</p>

      {deviceCheck.notice.value && (
        <Callout kind="good" role="status" action={{ label: 'OK', onClick: dismissNotice }}>
          {deviceCheck.notice.value}
        </Callout>
      )}

      <StepsCard mode={mode} results={results && results.mode === mode ? results : null} busy={busy} />

      {deviceCheck.lastError.value && <Callout kind="bad">{deviceCheck.lastError.value}</Callout>}

      <h2>1. Automatic checks</h2>
      <p class="small muted">About half a minute. No camera needed.</p>
      <button class="btn btn-primary btn-block" data-testid="run-checks" disabled={busy} onClick={startAutomatic}>
        {running === 'automatic' ? 'Checking…' : 'Run checks'}
      </button>
      {progressLine('automatic')}

      <h2>2. Camera tests</h2>
      <p class="small">
        Hold the phone about <strong>40 cm</strong> above something with fine detail — a page of printed text or the puzzle box is ideal — and{' '}
        <strong>keep it still</strong> until it says it's done. It takes about a minute, and the torch may flash.
      </p>
      <button
        class="btn btn-block"
        data-testid="start-camera-tests"
        disabled={busy}
        onClick={() => {
          const v = videoRef.current;
          if (v) startCameraTests(v);
        }}
      >
        {running === 'camera' ? 'Testing the camera…' : 'Start camera tests'}
      </button>
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        data-testid="device-camera-preview"
        style={{
          display: running === 'camera' ? 'block' : 'none',
          width: '100%',
          maxHeight: '240px',
          objectFit: 'contain',
          background: 'var(--black)',
          borderRadius: '12px',
          marginTop: '10px',
        }}
      />
      {progressLine('camera')}

      <h2>3. iPhone camera screen</h2>
      <p class="small">Opens the iPhone's own camera (the backup way of taking photos). Take any photo; it's only measured, not kept.</p>
      <button
        class="btn btn-block"
        data-testid="file-camera-test"
        disabled={busy}
        onClick={() => {
          const input = fileRef.current;
          if (input) openFileCamera(input);
        }}
      >
        Test the iPhone camera screen
      </button>
      <input
        ref={fileRef}
        class="hidden-input"
        // M9 part 6 help: opened by the button above; VoiceOver skips the hidden field.
        tabIndex={-1}
        aria-hidden="true"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(ev) => {
          const input = ev.currentTarget as HTMLInputElement;
          const file = input.files?.[0] ?? null;
          input.value = '';
          fileCameraChosen(file);
        }}
        onCancel={() => fileCameraChosen(null)}
      />
      {progressLine('fileCamera')}

      <h2>4. Photo test</h2>
      <p class="small">
        Finds the way your iPhone lets the app take full-size photos, and sets up <strong>Snap</strong> to use it. Hold the phone over the puzzle box again and{' '}
        <strong>keep it still</strong> — about a minute, around 10 photos.
      </p>
      <button
        class="btn btn-block"
        data-testid="photo-probe"
        disabled={busy}
        onClick={() => {
          const v = probeVideoRef.current;
          if (v) startPhotoProbe(v);
        }}
      >
        {running === 'photoProbe' ? 'Testing photos…' : 'Start photo test'}
      </button>
      <video
        ref={probeVideoRef}
        playsInline
        muted
        autoPlay
        data-testid="photo-probe-preview"
        style={{
          display: running === 'photoProbe' ? 'block' : 'none',
          width: '100%',
          maxHeight: '240px',
          objectFit: 'contain',
          background: 'var(--black)',
          borderRadius: '12px',
          marginTop: '10px',
        }}
      />
      {progressLine('photoProbe')}

      <h2>5. Memory test (optional)</h2>
      <Callout kind="warn">
        This fills up memory on purpose until the iPhone says stop. <strong>Puzzle Lens may close or reload by itself</strong> — that's expected, and it's how
        the test measures. If it happens, open Puzzle Lens again and come back to Device check: the result will be waiting.
      </Callout>
      {!confirmMemory ? (
        <button class="btn btn-block" data-testid="memory-test" disabled={busy} onClick={() => setConfirmMemory(true)}>
          Run memory test…
        </button>
      ) : (
        <div class="row">
          <button
            class="btn btn-danger"
            data-testid="memory-test-confirm"
            disabled={busy}
            onClick={() => {
              setConfirmMemory(false);
              startMemory();
            }}
          >
            Yes, start the memory test
          </button>
          <button class="btn" data-testid="memory-test-cancel" onClick={() => setConfirmMemory(false)}>
            Cancel
          </button>
        </div>
      )}
      {progressLine('memory')}

      <h2>Results</h2>
      {results ? (
        <Results results={results} running={busy} />
      ) : (
        <p class="muted" data-testid="device-check-empty">
          {deviceCheck.loaded.value ? 'No results yet. Tap "Run checks" to start.' : 'Loading…'}
        </p>
      )}

      <a class="btn btn-block" href="#/report" data-testid="send-report" style={{ marginTop: '20px' }}>
        Send report
      </a>
    </main>
  );
}
