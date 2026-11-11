/**
 * Navigation bar (M9 part 2, design plan §3.5): sticky at the top of a screen on a see-through material,
 * full width under the status bar. A hairline appears under it once the page scrolls.
 * - Back is an accent chevron plus the **parent** screen's title, and always goes to that parent
 *   (e.g. Progress → "‹ Harbour" → the puzzle page), not the browser's history;
 * - trailing: the screen's own 44 px buttons (children; use `.navbar-btn` for words, `.btn-icon` for an
 *   icon), then the 🧪 test-steps button (Tester mode);
 * - `large`: the title is a Large Title (34 px) under the bar, for root screens; once it has scrolled
 *   away, the small title shows in the bar.
 *
 *   <NavBar title="Progress" back={{ label: puzzle.name, route: 'puzzle', arg: puzzle.id }}>
 *     <button class="navbar-btn">Edit</button>
 *   </NavBar>
 *
 * The bar keeps the `topbar` class, so older selectors and tests still find it. Put it first inside
 * `<main class="screen">`: it reaches out over the screen's padding to the edges.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { TestButton } from '../components/TestSteps';
import { go, type Route } from '../router';

export interface NavBack {
  /** The parent screen's title, as its own heading says it (e.g. "Home", "Settings", the puzzle's name). */
  label: string;
  route: Route;
  /** The parent's argument, e.g. the puzzle id for `#/puzzle/<id>`. */
  arg?: string | null;
  /** The button's VoiceOver name (default "Back to <label>"). */
  ariaLabel?: string;
}

export interface NavBarProps {
  title: ComponentChildren;
  /** Where back goes; `false` for a root screen with no back. */
  back?: NavBack | false;
  /** A Large Title under the bar (root screens). Default false: the title sits in the bar. */
  large?: boolean;
  /** The 🧪 test-steps button at the end (Tester mode only). Default true. */
  testButton?: boolean;
  /** Trailing buttons, before 🧪. */
  children?: ComponentChildren;
  testId?: string;
}

/** The back chevron (stroke, currentColor), until the icon set (ui/icons.tsx) takes over. */
function Chevron() {
  return (
    <svg viewBox="0 0 12 20" aria-hidden="true" focusable="false">
      <path d="M10 2 2 10l8 8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

export function NavBar({ title, back = false, large = false, testButton = true, children, testId }: NavBarProps) {
  const [scrolled, setScrolled] = useState(false);
  const [collapsed, setCollapsed] = useState(!large);
  const big = useRef<HTMLHeadingElement>(null);
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    const update = () => {
      setScrolled(scrollY > 0);
      // The small title shows once the Large Title has gone under the bar.
      if (large && big.current && bar.current) setCollapsed(big.current.getBoundingClientRect().bottom <= bar.current.getBoundingClientRect().bottom + 4);
    };
    update();
    addEventListener('scroll', update, { passive: true });
    addEventListener('resize', update, { passive: true });
    return () => {
      removeEventListener('scroll', update);
      removeEventListener('resize', update);
    };
  }, [large]);
  return (
    <>
      <header ref={bar} class={`navbar topbar${scrolled ? ' is-scrolled' : ''}${collapsed ? ' is-collapsed' : ''}`} data-testid={testId ?? 'navbar'}>
        <div class="navbar-row">
          <div class="navbar-leading">
            {back && (
              <button
                class="navbar-back"
                aria-label={back.ariaLabel ?? `Back to ${back.label}`}
                data-testid="navbar-back"
                onClick={() => go(back.route, back.arg)}
              >
                <Chevron />
                <span class="navbar-back-label">{back.label}</span>
              </button>
            )}
          </div>
          {large ? (
            <div class="navbar-title navbar-title-small" aria-hidden="true">
              {title}
            </div>
          ) : (
            <h1 class="navbar-title">{title}</h1>
          )}
          <div class="navbar-trailing">
            {children}
            {testButton && <TestButton />}
          </div>
        </div>
      </header>
      {large && (
        <h1 ref={big} class="large-title">
          {title}
        </h1>
      )}
    </>
  );
}
