/**
 * "Send report" (BRIEF §11, PLAN §5): prepare one file first, then share it with one tap.
 * The file must be ready BEFORE the Share tap: iOS only opens the share sheet within ~5 s of a tap.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { TopBar } from '../components/TopBar';
import { errorText, formatBytes, lastSnapInfo, latestDeviceChecks, prepareReport, REPORT_STEPS, type PreparedReport } from '../../report/collect';
import { canShareFile, downloadUrl, revokeDownloadUrls, shareOrDownload } from '../../report/share';
import { logError, logInfo, logWarn } from '../../log/logger';
import { displayMode } from '../env';
import { isDeviceCheckResults, missingParts, modeLabel, PART_NAMES, REQUIRED_PARTS } from '../../device/format';
import type { DeviceCheckResults, DisplayMode, RunPart } from '../../device/types';
import { Callout } from '../ui/Callout';
import { Icon } from '../ui/icons';

type Phase =
  | { kind: 'idle' }
  | { kind: 'preparing'; label: string; step: number; total: number }
  | { kind: 'ready'; report: PreparedReport; url: string; shareable: boolean }
  | { kind: 'error'; message: string };

type ShareState = 'none' | 'sharing' | 'shared' | 'fallback';

interface Facts {
  /** This mode's newest Device check (the other mode's data isn't visible from here on an iPhone). */
  check: DeviceCheckResults | null;
  snap: { ts: number; bytes: number } | null;
}

function when(ts: number): string {
  return new Date(ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function ReportScreen() {
  const [includeFull, setIncludeFull] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [share, setShare] = useState<ShareState>('none');
  const [facts, setFacts] = useState<Facts | null>(null);
  const mounted = useRef(true);
  const busy = useRef(false);
  const mode: DisplayMode = displayMode();
  const otherMode: DisplayMode = mode === 'standalone' ? 'browser' : 'standalone';

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      const next: Facts = { check: null, snap: null };
      try {
        const checks = await latestDeviceChecks();
        const row = checks[mode];
        next.check = row && isDeviceCheckResults(row.results) ? row.results : null;
      } catch {
        /* shown as "not run yet" */
      }
      try {
        next.snap = await lastSnapInfo();
      } catch {
        /* shown as "none yet" */
      }
      if (mounted.current) setFacts(next);
    })();
    return () => {
      mounted.current = false;
      revokeDownloadUrls();
    };
  }, []);

  const prepare = async () => {
    if (busy.current) return;
    busy.current = true;
    revokeDownloadUrls();
    setShare('none');
    setPhase({ kind: 'preparing', label: 'Starting', step: 0, total: REPORT_STEPS.length });
    try {
      const report = await prepareReport({
        includeFullPhoto: includeFull,
        onProgress: (label, step, total) => {
          if (mounted.current) setPhase({ kind: 'preparing', label, step, total });
        },
      });
      if (!mounted.current) return;
      setPhase({ kind: 'ready', report, url: downloadUrl(report.file), shareable: canShareFile(report.file) });
    } catch (err) {
      logError('report', 'The report could not be prepared', err);
      if (mounted.current) setPhase({ kind: 'error', message: errorText(err) });
    } finally {
      busy.current = false;
    }
  };

  const onShare = () => {
    if (phase.kind !== 'ready' || share === 'sharing') return;
    // FIRST thing in the tap, with the file already made (iOS ~5 s rule). No await before this line.
    const pending = shareOrDownload(phase.report.file);
    setShare('sharing');
    void pending.then((outcome) => {
      if (!mounted.current) return;
      if (outcome.kind === 'shared') {
        setShare('shared');
        logInfo('report', 'Report shared');
      } else if (outcome.kind === 'cancelled') {
        setShare('none');
      } else {
        setShare('fallback');
        setPhase((p) => (p.kind === 'ready' ? { ...p, url: outcome.url } : p));
        logWarn('report', `Share menu not available, download offered instead (${outcome.reason})`);
      }
    });
  };

  const onToggleFull = (checked: boolean) => {
    setIncludeFull(checked);
    // A report made with the other choice is out of date.
    if (phase.kind === 'ready' || phase.kind === 'error') {
      revokeDownloadUrls();
      setShare('none');
      setPhase({ kind: 'idle' });
    }
  };

  const preparing = phase.kind === 'preparing';
  const missing: RunPart[] = facts ? missingParts(facts.check) : [];

  return (
    <main class="screen" data-testid="report-screen">
      <TopBar title="Send report" />

      <p>If something goes wrong or looks odd, send me a report. It's one file that shows me what happened on your iPhone.</p>

      <div class="card">
        <strong>What's in the report</strong>
        <ul class="small" style={{ paddingLeft: '20px', margin: '8px 0' }}>
          <li>The app version and your settings</li>
          <li>What your iPhone can do (your latest Device check)</li>
          <li>The activity and error log</li>
          <li>Speed and memory numbers, and camera details</li>
          <li>A few small pictures from the live camera, and a small copy of your last photo</li>
        </ul>
        <p class="muted small">Nothing is sent automatically. The file only leaves your iPhone when you share it.</p>
      </div>

      <div class="card" data-testid="report-facts">
        <dl class="kv" style={{ margin: 0 }}>
          <dt>Device check in the {modeLabel(mode)}</dt>
          <dd data-testid="report-check-status">
            {facts === null ? (
              '…'
            ) : facts.check === null ? (
              <span class="warn">Not run yet</span>
            ) : missing.length === 0 ? (
              <span class="ok">
                <Icon name="check" size={16} class="icon-inline" /> All steps done · {when(facts.check.ts)}
              </span>
            ) : (
              <span class="warn">
                {REQUIRED_PARTS.length - missing.length} of {REQUIRED_PARTS.length} steps done · {when(facts.check.ts)}
              </span>
            )}
          </dd>
          <dt>Last photo</dt>
          <dd>{facts === null ? '…' : facts.snap ? `${when(facts.snap.ts)} · ${formatBytes(facts.snap.bytes)}` : 'None yet'}</dd>
        </dl>
        {facts !== null && missing.length > 0 && (
          <p class="small" style={{ marginTop: '10px' }} data-testid="report-missing-steps">
            Still to do in Device check: {missing.map((p) => PART_NAMES[p]).join(', ')}. You can send a report now anyway, or{' '}
            <a href="#/device">finish the Device check</a> first.
          </p>
        )}
        <p class="muted small" style={{ marginTop: '10px', marginBottom: 0 }} data-testid="report-mode-note">
          This report only has the {modeLabel(mode)} results. Send another one from the {modeLabel(otherMode)}.
        </p>
      </div>

      <label class="check-row" style={{ alignItems: 'center', minHeight: 'var(--tap)', borderBottom: 0, cursor: 'pointer' }}>
        <input
          type="checkbox"
          data-testid="include-full-photo"
          style={{ width: '26px', height: '26px', flex: 'none', margin: 0, accentColor: 'var(--accent)' }}
          checked={includeFull}
          disabled={preparing || (facts !== null && facts.snap === null)}
          onChange={(e) => onToggleFull((e.currentTarget as HTMLInputElement).checked)}
        />
        <span class="check-name">
          Include the full-size last photo (bigger file)
          <br />
          <span class="muted small">
            {facts?.snap ? `Adds about ${formatBytes(facts.snap.bytes)}. Only needed if I ask for it.` : 'No photo has been taken yet.'}
          </span>
        </span>
      </label>

      {phase.kind !== 'ready' && (
        <button class="btn btn-primary btn-block" data-testid="prepare-report" disabled={preparing} onClick={() => void prepare()}>
          {preparing ? 'Preparing…' : 'Prepare report'}
        </button>
      )}

      {phase.kind === 'preparing' && (
        <div style={{ marginTop: '12px' }}>
          <p class="small" data-testid="report-progress" aria-live="polite">
            {phase.step > 0 ? `Step ${phase.step} of ${phase.total}: ${phase.label}…` : 'Starting…'}
          </p>
          <progress max={phase.total} value={phase.step} style={{ width: '100%' }} />
        </div>
      )}

      {phase.kind === 'error' && (
        <Callout kind="bad" role="alert" title="The report couldn't be prepared." testId="report-error">
          <p>{phase.message}</p>
          <p>Please tap "Prepare report" to try again.{includeFull ? ' If it keeps failing, untick the full-size photo.' : ''}</p>
        </Callout>
      )}

      {phase.kind === 'ready' && (
        <>
          <Callout kind="good" title="Your report is ready" testId="report-ready">
            <p>
              {phase.report.fileName} · <span data-testid="report-size">{formatBytes(phase.report.file.size)}</span>
            </p>
            {phase.report.summary.problems.length > 0 && <p>Some details couldn't be collected. That is noted inside the report, so it's fine to send.</p>}
          </Callout>

          <button class="btn btn-primary btn-block" data-testid="share-report" disabled={share === 'sharing'} onClick={onShare}>
            Share report
          </button>
          {!phase.shareable && share === 'none' && (
            <p class="muted small" data-testid="share-unsupported">
              This browser can't open the Share menu for files. Use "Download instead" below.
            </p>
          )}

          {share === 'shared' && (
            <Callout kind="good" testId="share-done">
              Sent. Thank you!
            </Callout>
          )}
          {share === 'fallback' && (
            <Callout kind="warn" role="alert" testId="share-fallback">
              The Share menu didn't open. Tap <strong>Download report</strong> below. The file then appears in the <strong>Files</strong> app, in{' '}
              <strong>Downloads</strong>, and you can share it from there.
            </Callout>
          )}

          <div class="row" style={{ marginTop: '12px' }}>
            <a
              class={share === 'fallback' ? 'btn btn-primary btn-block' : 'btn btn-small'}
              data-testid="download-report"
              href={phase.url}
              download={phase.report.fileName}
            >
              {share === 'fallback' ? 'Download report' : 'Download instead'}
            </a>
            <button class="btn btn-small" data-testid="prepare-again" onClick={() => void prepare()}>
              Make a new report
            </button>
          </div>
        </>
      )}

      <h2>How to send it</h2>
      <ol class="steps">
        <li>
          Tap <strong>Prepare report</strong> and wait a few seconds.
        </li>
        <li>
          Tap <strong>Share report</strong>.
        </li>
        <li>
          Choose <strong>AirDrop</strong> and pick your Mac, or choose <strong>Mail</strong> or <strong>Messages</strong> to send it to me.
        </li>
      </ol>
      <p class="muted small">If the Share menu doesn't open, tap "Download instead". The file goes to the Files app › Downloads, and you can share it from there.</p>
    </main>
  );
}
