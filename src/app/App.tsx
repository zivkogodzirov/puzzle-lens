import { route } from './router';
import { UpdateBanner } from './components/UpdateBanner';
import { HomeScreen } from './screens/Home';
import { LiveScreen } from './screens/Live';
import { DeviceCheckScreen } from './screens/DeviceCheck';
import { SettingsScreen } from './screens/Settings';
import { ReportScreen } from './screens/Report';
import { HelpScreen } from './screens/Help';
import { LogScreen } from './screens/Log';

export function App() {
  const r = route.value;
  return (
    <div class={`app route-${r}`}>
      <UpdateBanner />
      {r === 'home' && <HomeScreen />}
      {r === 'live' && <LiveScreen />}
      {r === 'device' && <DeviceCheckScreen />}
      {r === 'settings' && <SettingsScreen />}
      {r === 'report' && <ReportScreen />}
      {r === 'help' && <HelpScreen />}
      {r === 'log' && <LogScreen />}
    </div>
  );
}
