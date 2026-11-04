import { render } from 'preact';
import { App } from './app/App';
import { installGlobalErrorHandlers } from './log/logger';
import { loadSettings } from './app/settings';
import { recordLaunch, requestPersistence } from './app/env';
import './app/styles.css';

installGlobalErrorHandlers();

async function boot(): Promise<void> {
  await loadSettings();
  render(<App />, document.getElementById('app')!);
  void recordLaunch();
  void requestPersistence();
}

void boot();
