import type { ComponentChildren } from 'preact';
import { go } from '../router';
import { TestButton } from './TestSteps';

/** A screen's top bar: back to Home, the title, the screen's own buttons, then 🧪 (Tester mode). */
export function TopBar({ title, children }: { title: string; children?: ComponentChildren }) {
  return (
    <div class="topbar">
      <button class="btn btn-back" aria-label="Back to home" onClick={() => go('home')}>
        ‹ Home
      </button>
      <h1>{title}</h1>
      {children}
      <TestButton />
    </div>
  );
}
