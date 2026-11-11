/**
 * Segmented control (M9 part 2; part 1's page filter, made reusable): one choice out of 2–5, as buttons
 * with aria-pressed in a role=group. The selected one is raised: surface colour, a 1 px hairline (≥3:1,
 * decision 17), a soft shadow and semibold words. Each button is 44 px tall.
 *
 *   <Segmented label="Units" value={units} onChange={setUnits} testId="units"
 *              options={[['mm', 'mm'], ['cm', 'cm'], ['in', 'inches']]} />
 *   // With counts (shown in grey after the words): options={[['all', 'All', 22], ['border', 'Border', 5]]}
 *
 * Classes for plain markup: `.segmented` (track) and `.segmented-btn` (each choice, aria-pressed);
 * `.segmented-nowrap` keeps each choice on one line (cut off with "…") for short labels with counts.
 * The older `.page-filter` / `.page-filter-btn` and Settings' `.segmented > button` look the same.
 */
import type { ComponentChildren } from 'preact';

export type SegmentOption<T> = [value: T, label: ComponentChildren, count?: number];

export interface SegmentedProps<T extends string | number> {
  value: T;
  options: Array<SegmentOption<T>>;
  onChange: (v: T) => void;
  /** The group's name for VoiceOver, e.g. "Units". */
  label?: string;
  /** Each button gets data-testid `${testId}-${value}`; the group `${testId}`. */
  testId?: string;
  /** One line per choice (short labels with counts). */
  nowrap?: boolean;
}

export function Segmented<T extends string | number>({ value, options, onChange, label, testId, nowrap }: SegmentedProps<T>) {
  return (
    <div class={`segmented${nowrap ? ' segmented-nowrap' : ''}`} role="group" aria-label={label} data-testid={testId}>
      {options.map(([v, text, count]) => (
        <button
          key={String(v)}
          type="button"
          class="segmented-btn"
          aria-pressed={value === v}
          data-testid={testId ? `${testId}-${String(v)}` : undefined}
          onClick={() => onChange(v)}
        >
          {text}
          {count != null && <span class="segmented-count"> {count}</span>}
        </button>
      ))}
    </div>
  );
}
