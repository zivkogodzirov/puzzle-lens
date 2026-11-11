import type { ComponentChildren } from 'preact';
import { NavBar, type NavBack } from '../ui/NavBar';

/** Home, every screen's parent until round 2 sets each screen's own. */
const HOME: NavBack = { label: 'Home', route: 'home', ariaLabel: 'Back to home' };

/**
 * A screen's top bar, now the kit's NavBar (M9 part 2): back to the parent screen (Home unless `back` says
 * otherwise), the title, the screen's own buttons, then 🧪 (Tester mode). `large`: a Large Title under the bar.
 */
export function TopBar({ title, back = HOME, large, children }: { title: string; back?: NavBack | false; large?: boolean; children?: ComponentChildren }) {
  return (
    <NavBar title={title} back={back} large={large}>
      {children}
    </NavBar>
  );
}
