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
import { Icon, type IconName } from './icons';

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
  /** role="status" for news that arrives (a result), "alert" for an error that needs attention now. */
  role?: 'status' | 'alert';
  testId?: string;
  children?: ComponentChildren;
}

export function Callout({ kind = 'info', icon, title, action, role, testId, children }: CalloutProps) {
  return (
    <div class={`callout callout-${kind}`} role={role} data-testid={testId}>
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
