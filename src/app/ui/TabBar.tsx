/**
 * Tab bar (M9 part 2, design plan §3.5; used from stage 4): up to 4 items, each a 24 px icon over a 13 px
 * label, the selected one in the accent colour (aria-current="page"), with an optional red badge (a count
 * or a dot). On a see-through material, above the Home bar (safe area).
 *
 *   <TabBar fixed label="Puzzle" selected={tab} onSelect={setTab} items={[
 *     { id: 'table', label: 'Table', icon: <Icon name="viewfinder" /> },
 *     { id: 'pieces', label: 'Pieces', icon: <Icon name="puzzle" />, badge: 3 },
 *   ]} />
 *
 * `fixed`: pinned to the bottom of the screen; the page then leaves room for it, and toasts sit above it
 * (it sets --action-bar-h, like the puzzle page's action bar, which it can replace). An item can also be an
 * action (Scan) rather than a place: leave `selected` unset for it.
 */
import type { ComponentChildren } from 'preact';

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon: ComponentChildren;
  /** A number (shown up to 99+), or true for a dot. */
  badge?: number | boolean;
  /** VoiceOver words for the badge (default: the number, e.g. "3"; "new" for a dot). */
  badgeLabel?: string;
  testId?: string;
}

export interface TabBarProps<T extends string> {
  items: Array<TabItem<T>>;
  selected?: T | null;
  onSelect: (id: T) => void;
  /** Pinned to the bottom of the screen (default false: drawn where it is placed, e.g. in the gallery). */
  fixed?: boolean;
  /** The bar's name for VoiceOver. */
  label?: string;
  testId?: string;
}

export function TabBar<T extends string>({ items, selected, onSelect, fixed, label = 'Tabs', testId }: TabBarProps<T>) {
  return (
    <nav class={`tabbar${fixed ? ' tabbar-fixed' : ''}`} aria-label={label} data-testid={testId}>
      {items.map((it) => {
        const on = selected === it.id;
        const hasBadge = it.badge != null && it.badge !== false && it.badge !== 0;
        const badgeText = typeof it.badge === 'number' ? (it.badge > 99 ? '99+' : String(it.badge)) : '';
        const badgeWords = hasBadge ? (it.badgeLabel ?? (badgeText || 'new')) : '';
        return (
          <button
            key={it.id}
            type="button"
            class="tabbar-item"
            aria-current={on ? 'page' : undefined}
            aria-label={hasBadge ? `${it.label}, ${badgeWords}` : undefined}
            data-testid={it.testId}
            onClick={() => onSelect(it.id)}
          >
            <span class="tabbar-icon" aria-hidden="true">
              {it.icon}
            </span>
            <span class="tabbar-label">{it.label}</span>
            {hasBadge && (
              <span class={`tabbar-badge${badgeText ? '' : ' is-dot'}`} aria-hidden="true">
                {badgeText}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
