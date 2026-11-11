import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { TopBar } from '../components/TopBar';
import { settings, type LiveFormat, type Units } from '../settings';
import { APP_VERSION, isStandalone, requestPersistence } from '../env';
import { eraseAllData } from '../../db/db';
import { ListRow, ListSection } from '../ui/List';
import { Segmented } from '../ui/Segmented';
import { confirmAction } from '../ui/ActionSheet';
import { Icon } from '../ui/icons';

/**
 * One setting chosen with a segmented control, laid out like a grouped-list section: a header above
 * (a heading, so VoiceOver can jump to it) and a footer sentence below.
 */
function SegmentGroup({
  header,
  footer,
  footerTestId,
  children,
}: {
  header: string;
  footer?: ComponentChildren;
  footerTestId?: string;
  children: ComponentChildren;
}) {
  return (
    <section class="list-section settings-group">
      <h3 class="list-header">{header}</h3>
      <div class="settings-control">{children}</div>
      {footer && (
        <p class="list-footer" data-testid={footerTestId}>
          {footer}
        </p>
      )}
    </section>
  );
}

/** "Yes" with a check mark (the mark is decoration; the word says it). */
function Done({ children }: { children: ComponentChildren }) {
  return (
    <span class="settings-done">
      {children} <Icon name="check" size={16} class="icon-inline" />
    </span>
  );
}

export function SettingsScreen() {
  const [storage, setStorage] = useState<{ usage?: number; quota?: number; persisted?: boolean } | null>(null);

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

  const erase = async () => {
    const ok = await confirmAction({
      title: 'Erase all Puzzle Lens data?',
      message: "This deletes your puzzles, settings, logs, device checks and saved photos on this iPhone. It can't be undone.",
      confirmLabel: 'Erase everything',
    });
    if (!ok) return;
    await eraseAllData();
    location.reload();
  };

  const tester = settings.testerMode.value;
  return (
    <main class="screen">
      <TopBar title="Settings" />

      <SegmentGroup
        header="Tester mode"
        footerTestId="tester-explained"
        footer={
          tester ? (
            <>
              On while you test the app: the <Icon name="flask-conical" size={16} class="icon-inline" /> test steps, Device check, Send report, the Activity
              log, the Live camera and extra numbers (tracking speed, phone height and tilt) are shown.
            </>
          ) : (
            'Off: the testing tools and extra numbers are hidden for a cleaner look. Your puzzles and settings stay as they are. Turn it on again here at any time.'
          )
        }
      >
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
      </SegmentGroup>
      {tester && (
        <ListSection>
          <ListRow icon={<Icon name="eye" />} tone="accent" title="Components (for testing)" href="#/ui" testId="settings-components" />
        </ListSection>
      )}

      <ListSection header="Accuracy" footer="From your ✓ Fits / ✗ Doesn't fit answers.">
        <ListRow icon={<Icon name="bar-chart" />} tone="accent" title="How often is the app right?" href="#/accuracy" testId="settings-accuracy" />
      </ListSection>

      <SegmentGroup header="Units" footer="Only changes how sizes are shown.">
        <Segmented<Units>
          label="Units"
          testId="units"
          value={settings.units.value}
          options={[
            ['mm', 'mm'],
            ['cm', 'cm'],
            ['in', 'inches'],
          ]}
          onChange={(v) => (settings.units.value = v)}
        />
      </SegmentGroup>

      <SegmentGroup
        header="Live camera format"
        footer={'"Full sensor 4:3" is recommended: photos are then taken without pausing the camera. Applies the next time the camera starts.'}
      >
        <Segmented<LiveFormat>
          label="Live camera format"
          testId="live-format"
          value={settings.liveFormat.value}
          options={[
            ['auto-4x3', 'Full sensor 4:3'],
            ['4k', '4K'],
            ['1080p', '1080p'],
          ]}
          onChange={(v) => (settings.liveFormat.value = v)}
        />
      </SegmentGroup>

      <ListSection header="Camera lens" footer="Automatic uses the main back camera, which keeps sizes steady. Applies the next time the camera starts.">
        <ListRow title={settings.cameraDeviceId.value ? 'A lens you picked on the Live screen' : 'Automatic (recommended)'} />
        {settings.cameraDeviceId.value && <ListRow title="Use automatic" testId="lens-automatic" onClick={() => (settings.cameraDeviceId.value = '')} />}
      </ListSection>

      <SegmentGroup
        header="Scan mode"
        footer="Quick finds, colours and places the pieces from one photo; their shapes (corner, edge) are read less surely. Full adds close-ups (2×) for the shapes. You can always switch to close-ups on the scan screen."
      >
        <Segmented<'full' | 'quick'>
          label="Scan mode"
          testId="scan-mode"
          value={settings.scanMode.value}
          options={[
            ['full', 'Full (overview + close-ups)'],
            ['quick', 'Quick (one overview photo)'],
          ]}
          onChange={(v) => (settings.scanMode.value = v)}
        />
      </SegmentGroup>

      <SegmentGroup header="Live tracking speed">
        <Segmented<30 | 15>
          label="Live tracking speed"
          testId="tracking-fps"
          value={settings.trackingFps.value}
          options={[
            [30, 'Smooth (30/s)'],
            [15, 'Battery saver (15/s)'],
          ]}
          onChange={(v) => (settings.trackingFps.value = v)}
        />
      </SegmentGroup>

      {tester && (
        <SegmentGroup header="Performance display" footer="On the Live camera screen (also its button with a pulse line).">
          <Segmented<'on' | 'off'>
            label="Performance display"
            testId="hud"
            value={settings.showHud.value ? 'on' : 'off'}
            options={[
              ['on', 'Show'],
              ['off', 'Hide'],
            ]}
            onChange={(v) => (settings.showHud.value = v === 'on')}
          />
        </SegmentGroup>
      )}

      <ListSection header="Storage" testId="settings-storage">
        <ListRow title="Running as" value={isStandalone.value ? <Done>Home Screen app</Done> : 'Safari tab (install recommended)'} />
        <ListRow title="Used" value={storage?.usage != null ? `${(storage.usage / 1048576).toFixed(1)} MB` : '—'} />
        <ListRow title="Available" value={storage?.quota != null ? `${(storage.quota / 1073741824).toFixed(1)} GB` : '—'} />
        <ListRow title="Protected from clean-up" value={storage?.persisted == null ? '—' : storage.persisted ? <Done>Yes</Done> : 'Not yet'} />
        {!storage?.persisted && (
          <ListRow
            title={<span class="settings-action">Ask iPhone to protect my data</span>}
            testId="protect-data"
            onClick={async () => {
              await requestPersistence();
              await refreshStorage();
            }}
          />
        )}
      </ListSection>

      <ListSection header="Erase" footer="Deletes your puzzles, settings, logs, device checks and saved photos on this iPhone. You're asked first.">
        <ListRow title="Erase all Puzzle Lens data…" destructive testId="erase-all" onClick={() => void erase()} />
      </ListSection>

      <p class="muted small settings-version">Puzzle Lens {APP_VERSION}</p>
    </main>
  );
}
