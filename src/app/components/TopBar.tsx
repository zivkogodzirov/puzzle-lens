import type { ComponentChildren } from 'preact';
import { go } from '../router';

export function TopBar({ title, children }: { title: string; children?: ComponentChildren }) {
  return (
    <div class="topbar">
      <button class="btn btn-back" aria-label="Back to home" onClick={() => go('home')}>
        ‹ Home
      </button>
      <h1>{title}</h1>
      {children}
    </div>
  );
}
