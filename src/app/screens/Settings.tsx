import { useEffect, useState } from 'preact/hooks';
import { TopBar } from '../components/TopBar';
import { settings, type LiveFormat, type Units } from '../settings';
import { APP_VERSION, isStandalone, requestPersistence } from '../env';
import { eraseAllData } from '../../db/db';

function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div class="segmented" role="group">
      {options.map(([v, label]) => (
        <button key={String(v)} aria-pressed={value === v} onClick={() => onChange(v)}>
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

  return (
    <main class="screen">
      <TopBar title="Settings" />

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

      <h2>Live tracking speed</h2>
      <Segmented<30 | 15>
        value={settings.trackingFps.value}
        options={[
          [30, 'Smooth (30/s)'],
          [15, 'Battery saver (15/s)'],
        ]}
        onChange={(v) => (settings.trackingFps.value = v)}
      />

      <h2>Performance display</h2>
      <Segmented<'on' | 'off'>
        value={settings.showHud.value ? 'on' : 'off'}
        options={[
          ['on', 'Show'],
          ['off', 'Hide'],
        ]}
        onChange={(v) => (settings.showHud.value = v === 'on')}
      />

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
