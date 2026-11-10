import { useEffect, useState } from 'preact/hooks';
import { TopBar } from '../components/TopBar';
import { settings, type LiveFormat, type Units } from '../settings';
import { APP_VERSION, isStandalone, requestPersistence } from '../env';
import { eraseAllData } from '../../db/db';

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  testId,
}: {
  value: T;
  options: Array<[T, string]>;
  onChange: (v: T) => void;
  label?: string;
  testId?: string;
}) {
  return (
    <div class="segmented" role="group" aria-label={label}>
      {options.map(([v, label]) => (
        <button key={String(v)} aria-pressed={value === v} data-testid={testId ? `${testId}-${String(v)}` : undefined} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function SettingsScreen() {
  const [storage, setStorage] = useState<{ usage?: number; quota?: number; persisted?: boolean } | null>(null);
  const [confirmErase, setConfirmErase] = useState(false);

  const refreshStorage = async () => {
    try {
      const est = await navigator.storage?.estimate?.();
      const persisted = await navigator.storage?.persisted?.();
      setStorage({ usage: est?.usage, quota: est?.quota, persisted });
    } catch {
      setStorage({});
    }
  };
  useEffect(() => {
    void refreshStorage();
  }, []);

  const tester = settings.testerMode.value;
  return (
    <main class="screen">
      <TopBar title="Settings" />

      <h2>Tester mode</h2>
      <Segmented<'on' | 'off'>
        label="Tester mode"
        testId="tester"
        value={tester ? 'on' : 'off'}
        options={[
          ['on', 'On'],
          ['off', 'Off'],
        ]}
        onChange={(v) => (settings.testerMode.value = v === 'on')}
      />
      <p class="muted small" data-testid="tester-explained">
        {tester
          ? 'On while you test the app: the 🧪 test steps, Device check, Send report, the Activity log, the Live camera and extra numbers (tracking speed, phone height and tilt) are shown.'
          : 'Off: the testing tools and extra numbers are hidden for a cleaner look. Your puzzles and settings stay as they are. Turn it on again here at any time.'}
      </p>

      <h2>Accuracy</h2>
      <a class="btn btn-block" href="#/accuracy" data-testid="settings-accuracy">
        📊 How often is the app right?
      </a>
      <p class="muted small">From your ✓ Fits / ✗ Doesn't fit answers.</p>

      <h2>Units</h2>
      <Segmented<Units>
        value={settings.units.value}
        options={[
          ['mm', 'mm'],
          ['cm', 'cm'],
          ['in', 'inches'],
        ]}
        onChange={(v) => (settings.units.value = v)}
      />
      <p class="muted small">Only changes how sizes are shown.</p>

      <h2>Live camera format</h2>
      <Segmented<LiveFormat>
        value={settings.liveFormat.value}
        options={[
          ['auto-4x3', 'Full sensor 4:3'],
          ['4k', '4K'],
          ['1080p', '1080p'],
        ]}
        onChange={(v) => (settings.liveFormat.value = v)}
      />
      <p class="muted small">"Full sensor 4:3" is recommended: photos are then taken without pausing the camera. Applies the next time the camera starts.</p>

      <h2>Camera lens</h2>
      <div class="row">
        <span>{settings.cameraDeviceId.value ? 'A lens you picked on the Live screen' : 'Automatic (recommended)'}</span>
        {settings.cameraDeviceId.value && (
          <button class="btn btn-small" data-testid="lens-automatic" onClick={() => (settings.cameraDeviceId.value = '')}>
            Use automatic
          </button>
        )}
      </div>
      <p class="muted small">Automatic uses the main back camera, which keeps sizes steady. Applies the next time the camera starts.</p>

      <h2>Scan mode</h2>
      <Segmented<'full' | 'quick'>
        value={settings.scanMode.value}
        options={[
          ['full', 'Full (overview + close-ups)'],
          ['quick', 'Quick (one overview photo)'],
        ]}
        onChange={(v) => (settings.scanMode.value = v)}
      />
      <p class="muted small">
        Quick finds, colours and places the pieces from one photo; their shapes (corner, edge) are read less surely. Full adds close-ups (2×) for the shapes.
        You can always switch to close-ups on the scan screen.
      </p>

      <h2>Live tracking speed</h2>
      <Segmented<30 | 15>
        value={settings.trackingFps.value}
        options={[
          [30, 'Smooth (30/s)'],
          [15, 'Battery saver (15/s)'],
        ]}
        onChange={(v) => (settings.trackingFps.value = v)}
      />

      {tester && (
        <>
          <h2>Performance display</h2>
          <Segmented<'on' | 'off'>
            value={settings.showHud.value ? 'on' : 'off'}
            options={[
              ['on', 'Show'],
              ['off', 'Hide'],
            ]}
            onChange={(v) => (settings.showHud.value = v === 'on')}
          />
          <p class="muted small">On the Live camera screen (also its HUD button).</p>
        </>
      )}

      <h2>Storage</h2>
      <div class="card">
        <dl class="kv">
          <dt>Running as</dt>
          <dd>{isStandalone.value ? 'Home Screen app ✓' : 'Safari tab (install recommended)'}</dd>
          <dt>Used</dt>
          <dd>{storage?.usage != null ? `${(storage.usage / 1048576).toFixed(1)} MB` : '—'}</dd>
          <dt>Available</dt>
          <dd>{storage?.quota != null ? `${(storage.quota / 1073741824).toFixed(1)} GB` : '—'}</dd>
          <dt>Protected from clean-up</dt>
          <dd>{storage?.persisted == null ? '—' : storage.persisted ? 'Yes ✓' : 'Not yet'}</dd>
        </dl>
        {!storage?.persisted && (
          <button
            class="btn btn-small"
            style={{ marginTop: '10px' }}
            onClick={async () => {
              await requestPersistence();
              await refreshStorage();
            }}
          >
            Ask iPhone to protect my data
          </button>
        )}
      </div>

      <h2>Erase</h2>
      {!confirmErase ? (
        <button class="btn btn-danger btn-small" onClick={() => setConfirmErase(true)}>
          Erase all Puzzle Lens data…
        </button>
      ) : (
        <div class="notice notice-bad">
          <p>This deletes settings, logs, device checks and saved photos on this iPhone. It can't be undone.</p>
          <div class="row">
            <button
              class="btn btn-danger btn-small"
              onClick={async () => {
                await eraseAllData();
                location.reload();
              }}
            >
              Yes, erase everything
            </button>
            <button class="btn btn-small" onClick={() => setConfirmErase(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <p class="muted small" style={{ marginTop: '28px' }}>
        Puzzle Lens {APP_VERSION}
      </p>
    </main>
  );
}
