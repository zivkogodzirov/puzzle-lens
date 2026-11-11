import { route } from './router';
import { ScanScreen } from './screens/Scan';
import { UpdateBanner } from './components/UpdateBanner';
import { HomeScreen } from './screens/Home';
import { LiveScreen } from './screens/Live';
import { DeviceCheckScreen } from './screens/DeviceCheck';
import { SettingsScreen } from './screens/Settings';
import { ReportScreen } from './screens/Report';
import { HelpScreen } from './screens/Help';
import { LogScreen } from './screens/Log';
import { MarkerSheetsScreen, NewPuzzleScreen } from './screens/NewPuzzle';
import { PuzzleScreen } from './screens/Puzzle';
import { TrayLabelsScreen } from './screens/TrayLabels';
import { TestSteps } from './components/TestSteps';
import { AccuracyScreen } from './screens/Accuracy';
import { ProgressScreen } from './screens/Progress';
import { useShell } from './shell';
import { UiGallery } from './screens/UiGallery';
import { UiHost } from './ui/Host';

export function App() {
  const r = route.value;
  useShell();
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
      {r === 'new' && <NewPuzzleScreen />}
      {r === 'puzzle' && <PuzzleScreen />}
      {r === 'markers' && <MarkerSheetsScreen />}
      {r === 'scan' && <ScanScreen />}
      {r === 'trays' && <TrayLabelsScreen />}
      {r === 'accuracy' && <AccuracyScreen />}
      {r === 'progress' && <ProgressScreen />}
      {r === 'ui' && <UiGallery />}
      <UiHost />
      <TestSteps />
    </div>
  );
}
