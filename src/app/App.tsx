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
import { PuzzleScreen } from './screens/puzzle/PuzzleScreen';
import { TrayLabelsScreen } from './screens/TrayLabels';
import { TestSteps } from './components/TestSteps';
import { AccuracyScreen } from './screens/Accuracy';
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
      {/* M9 part 4 pieces: the Pieces tab's pages (#/joins/<id>, #/sort/<id>) are drawn by the puzzle screen, which stays mounted (no reload). */}
      {(r === 'puzzle' || r === 'joins' || r === 'sort') && <PuzzleScreen />}
      {r === 'markers' && <MarkerSheetsScreen />}
      {r === 'scan' && <ScanScreen />}
      {r === 'trays' && <TrayLabelsScreen />}
      {r === 'accuracy' && <AccuracyScreen />}
      {r === 'ui' && <UiGallery />}
      <UiHost />
      <TestSteps />
    </div>
  );
}
