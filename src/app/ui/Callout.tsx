/**
 * Callout (M9 part 2, design plan §3.5): a message on a light tint of its colour (14 % over the surface), with
 * a 34 px icon tile, 15 px words and at most one button. No coloured border. It replaces the bordered
 * `.notice` boxes screen by screen (round 2); `.notice` keeps working until then.
 *
 *   kind    colour   use
 *   info    accent   tips, "Add to Home Screen"
 *   good    green    done, saved
 *   warn    amber    have a look
 *   bad     red      something failed (say what to do next)
 *
 *   <Callout kind="warn" title="The light is low" action={{ label: 'How', onClick: openHelp }}>
 *     Turn on a lamp over the table for clearer pieces.
 *   </Callout>
 *
 * Classes for plain markup: `.callout .callout-<kind>` > `.callout-icon` + `.callout-body`
 * (`.callout-title`, text) + one `.btn btn-small callout-action`.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { Icon, type IconName } from './icons';
// M9 part 6 help: a "status" callout is read from the screen's one status region (design plan §3.8 rule 7).
import { announce } from './announce';

export type CalloutKind = 'info' | 'good' | 'warn' | 'bad';

/** The icon for each kind (from the app's icon set); pass `icon` to override. */
const KIND_ICON: Record<CalloutKind, IconName> = { info: 'info', good: 'check', warn: 'alert-triangle', bad: 'x' };

export interface CalloutProps {
  kind?: CalloutKind;
  /** Icon content for the tile (e.g. <Icon name="share" />); default a glyph for the kind. */
  icon?: ComponentChildren;
  /** A bold first line. */
  title?: ComponentChildren;
  /** The one button. */
  action?: { label: string; onClick: () => void; testId?: string };
  /**
   * "status" for news that arrives (a result): its words are read out through the screen's one permanent status
   * region (announce.ts; M9 part 6), each time they change. "alert" for an error that needs attention now.
   */
  role?: 'status' | 'alert';
  testId?: string;
  children?: ComponentChildren;
}

export function Callout({ kind = 'info', icon, title, action, role, testId, children }: CalloutProps) {
  // M9 part 6 help: "status" news goes to the one status region; the callout itself is no live region.
  const box = useRef<HTMLDivElement>(null);
  const said = useRef<string | null>(null);
  useEffect(() => {
    if (role !== 'status') return;
    const words = box.current?.querySelector('.callout-body')?.textContent ?? '';
    if (words !== said.current) announce((said.current = words));
  });
  return (
    <div ref={box} class={`callout callout-${kind}`} role={role === 'alert' ? 'alert' : undefined} data-testid={testId}>
      <span class="callout-icon" aria-hidden="true">
        {icon ?? <Icon name={KIND_ICON[kind]} size={20} />}
      </span>
      <div class="callout-body">
        {title && <strong class="callout-title">{title}</strong>}
        {children && <div class="callout-text">{children}</div>}
      </div>
      {action && (
        <button type="button" class="btn btn-small callout-action" data-testid={action.testId} onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
