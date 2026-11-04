import { useState } from 'preact/hooks';
import { TopBar } from '../components/TopBar';
import { recentLogs } from '../../log/logger';

/** Recent activity and errors (also included in reports). */
export function LogScreen() {
  const [, setTick] = useState(0);
  const rows = recentLogs().slice(-200).reverse();
  return (
    <main class="screen">
      <TopBar title="Activity log">
        <button class="btn btn-small" onClick={() => setTick((t) => t + 1)}>
          Refresh
        </button>
      </TopBar>
      <pre class="logbox">
        {rows.length === 0
          ? 'Nothing yet.'
          : rows
              .map((r) => `${new Date(r.ts).toLocaleTimeString()} ${r.level.toUpperCase().padEnd(5)} [${r.source}] ${r.message}`)
              .join('\n')}
      </pre>
    </main>
  );
}
