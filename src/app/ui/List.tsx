/**
 * Inset grouped list (M9 part 2, design plan §3.5): rows on a rounded card, as in iPhone Settings.
 * Rows are 52 px; an optional 30 px icon tile on the left; a value in grey and a chevron on the right; a
 * section header (13 px capitals) above and a footer sentence (15 px, grey) below.
 *
 *   <ListSection header="Tools" footer="Only shown in Tester mode.">
 *     <ListRow icon="🗺" tone="accent" title="Show my table" href="#/…" chevron />
 *     <ListRow icon="🎯" tone="bad" title="Fill a spot" value="20" onClick={…} chevron />
 *     <ListRow title="Delete scanned pieces…" destructive onClick={…} />
 *   </ListSection>
 *
 * A row with `href` is a link, with `onClick` a button, with neither plain text. Classes for plain markup:
 * `.list-section`, `.list-header`, `.list-inset` (ul) > li > `.list-row` (with `.has-icon` when it has one),
 * `.list-icon` (+ `.list-icon-accent|good|warn|bad`), `.list-title`, `.list-subtitle`, `.list-value`,
 * `.list-chevron`, `.list-footer`.
 */
import type { ComponentChildren } from 'preact';

export type Tone = 'grey' | 'accent' | 'good' | 'warn' | 'bad';

export interface ListSectionProps {
  header?: ComponentChildren;
  footer?: ComponentChildren;
  testId?: string;
  children?: ComponentChildren;
}

export function ListSection({ header, footer, testId, children }: ListSectionProps) {
  return (
    <section class="list-section" data-testid={testId}>
      {/* M9 part 6 help: h2, the level under the screen's h1 (headings in order for VoiceOver). */}
      {header && <h2 class="list-header">{header}</h2>}
      <ul class="list-inset" role="list">
        {children}
      </ul>
      {footer && <p class="list-footer">{footer}</p>}
    </section>
  );
}

export interface ListRowProps {
  title: ComponentChildren;
  /** A second line in grey. */
  subtitle?: ComponentChildren;
  /** Icon content (e.g. <Icon name="map" /> or an emoji); drawn in a 30 px tile. */
  icon?: ComponentChildren;
  tone?: Tone;
  /** On the right, in grey (a count, the current setting). */
  value?: ComponentChildren;
  /** A › on the right (goes somewhere). Default: true for links. */
  chevron?: boolean;
  /** Red words (Delete…). */
  destructive?: boolean;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  testId?: string;
  /** VoiceOver name, when the words alone aren't clear. */
  ariaLabel?: string;
}

function ChevronRight() {
  return (
    <svg class="list-chevron" viewBox="0 0 8 14" aria-hidden="true" focusable="false">
      <path d="m1.5 1.5 5 5.5-5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

export function ListRow({ title, subtitle, icon, tone = 'grey', value, chevron, destructive, href, onClick, disabled, testId, ariaLabel }: ListRowProps) {
  const cls = `list-row${icon != null ? ' has-icon' : ''}${destructive ? ' list-row-destructive' : ''}${href || onClick ? ' is-action' : ''}`;
  const showChevron = chevron ?? Boolean(href);
  const inner = (
    <>
      {icon != null && (
        <span class={`list-icon list-icon-${tone}`} aria-hidden="true">
          {icon}
        </span>
      )}
      <span class="list-title">
        {title}
        {subtitle && <span class="list-subtitle">{subtitle}</span>}
      </span>
      {value != null && <span class="list-value">{value}</span>}
      {showChevron && <ChevronRight />}
    </>
  );
  return (
    <li>
      {href ? (
        <a class={cls} href={href} data-testid={testId} aria-label={ariaLabel}>
          {inner}
        </a>
      ) : onClick ? (
        <button type="button" class={cls} onClick={onClick} disabled={disabled} data-testid={testId} aria-label={ariaLabel}>
          {inner}
        </button>
      ) : (
        <div class={cls} data-testid={testId}>
          {inner}
        </div>
      )}
    </li>
  );
}
