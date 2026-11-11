/**
 * The kit's NavBar (ui/NavBar.tsx) for screens whose back is not simply "go to a route" (M9 part 2, round 2):
 * the set-up wizard (back one step), and the print pages (marker sheets, tray labels), which keep their
 * own back test id and must not print the bar. Same look and markup as NavBar: sticky on the material, an
 * accent chevron (NavBar's own) plus the parent's title, the hairline once the page scrolls, trailing buttons, then 🧪.
 *
 *   <StepNavBar title="New puzzle" backLabel="Step 1" onBack={() => setStep(1)} backTestId="wizard-back" />
 *
 * `noPrint` adds the `no-print` class, which the print pages hide in their own @media print rules.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { TestButton } from './TestSteps';

export interface StepNavBarProps {
  title: ComponentChildren;
  /** The parent's title next to the chevron ("Home", the puzzle's name, "Step 2"). */
  backLabel: string;
  onBack: () => void;
  /** VoiceOver name of back (default "Back to <backLabel>"). */
  backAriaLabel?: string;
  backTestId?: string;
  noPrint?: boolean;
  children?: ComponentChildren;
}

export function StepNavBar({ title, backLabel, onBack, backAriaLabel, backTestId, noPrint, children }: StepNavBarProps) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(scrollY > 0);
    update();
    addEventListener('scroll', update, { passive: true });
    return () => removeEventListener('scroll', update);
  }, []);
  return (
    <header class={`navbar topbar is-collapsed${scrolled ? ' is-scrolled' : ''}${noPrint ? ' no-print' : ''}`} data-testid="navbar">
      <div class="navbar-row">
        <div class="navbar-leading">
          <button class="navbar-back" aria-label={backAriaLabel ?? `Back to ${backLabel}`} data-testid={backTestId ?? 'navbar-back'} onClick={onBack}>
            <svg viewBox="0 0 12 20" aria-hidden="true" focusable="false">
              <path d="M10 2 2 10l8 8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span class="navbar-back-label">{backLabel}</span>
          </button>
        </div>
        <h1 class="navbar-title">{title}</h1>
        <div class="navbar-trailing">
          {children}
          <TestButton />
        </div>
      </div>
    </header>
  );
}
