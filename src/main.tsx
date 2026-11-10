import { render } from 'preact';
import { App } from './app/App';
import { installGlobalErrorHandlers } from './log/logger';
import { loadSettings } from './app/settings';
import { recordLaunch, requestPersistence } from './app/env';
import { reopenLastPuzzle } from './app/shell';
import './app/styles.css';

installGlobalErrorHandlers();

async function boot(): Promise<void> {
  await loadSettings();
  // Back to the puzzle open last time (M9 part 1), before the first screen is drawn.
  await reopenLastPuzzle();
  render(<App />, document.getElementById('app')!);
  void recordLaunch();
  void requestPersistence();
}

void boot();
