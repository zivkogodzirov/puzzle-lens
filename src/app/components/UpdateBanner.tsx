/**
 * "Update available" banner (RESEARCH §14). The new version is only activated when you tap
 * Reload, so an update never interrupts a scan.
 */
import { useEffect } from 'preact/hooks';
import { useRegisterSW } from 'virtual:pwa-register/preact';
import { logInfo, logWarn } from '../../log/logger';
import { Icon } from '../ui/icons';

export function UpdateBanner() {
  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      // Check for a new version whenever the app comes back to the foreground.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void reg.update().catch(() => {});
      });
    },
    onRegisterError(err) {
      logWarn('sw', 'Offline support could not start', err);
    },
  });

  useEffect(() => {
    if (offlineReady) {
      logInfo('sw', 'Ready to work offline');
      const t = setTimeout(() => setOfflineReady(false), 4000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [offlineReady]);

  if (needRefresh) {
    return (
      <div class="banner banner-update" role="status">
        <span>A new version of Puzzle Lens is ready.</span>
        <button class="btn btn-small" onClick={() => void updateServiceWorker(true)}>
          Reload
        </button>
      </div>
    );
  }
  if (offlineReady) {
    return (
      <div class="banner" role="status">
        <span>
          Ready to work offline <Icon name="check" size={18} class="icon-inline" />
        </span>
      </div>
    );
  }
  return null;
}
