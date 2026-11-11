/**
 * The components gallery (#/ui, M9 part 2): every building block of the new design (src/app/ui/) in every
 * state, for the owner and the reviewers. Reached from Settings in Tester mode ("Components (for testing)").
 * The icons are the app's icon set (ui/icons.tsx); the callouts keep their own default glyphs.
 */
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { ActionSheet, confirmAction } from '../ui/ActionSheet';
import { Button, IconButton } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { ListRow, ListSection } from '../ui/List';
import { NavBar } from '../ui/NavBar';
import { Segmented } from '../ui/Segmented';
import { Sheet, type Detent } from '../ui/Sheet';
import { TabBar } from '../ui/TabBar';
import { toast } from '../ui/toast';
import { Icon } from '../ui/icons';

type Bottom = 'none' | 'action' | 'tabs';
type Tab = 'table' | 'picture' | 'pieces' | 'more';

const TABS = [
  { id: 'table' as const, label: 'Table', icon: <Icon name="scan-eye" />, testId: 'g-tab-table' },
  { id: 'picture' as const, label: 'Picture', icon: <Icon name="image" />, testId: 'g-tab-picture' },
  { id: 'pieces' as const, label: 'Pieces', icon: <Icon name="puzzle" />, badge: 3, testId: 'g-tab-pieces' },
  { id: 'more' as const, label: 'More', icon: <Icon name="more-horizontal" />, badge: true, badgeLabel: 'backup due', testId: 'g-tab-more' },
];

function Section({ title, id, children }: { title: string; id: string; children: ComponentChildren }) {
  return (
    <section class="gallery-section" data-testid={`g-section-${id}`} aria-labelledby={`g-h-${id}`}>
      <h2 id={`g-h-${id}`}>{title}</h2>
      {children}
    </section>
  );
}

export function UiGallery() {
  const [units, setUnits] = useState<'mm' | 'cm' | 'in'>('cm');
  const [group, setGroup] = useState<'all' | 'border' | 'inside' | 'unsure'>('all');
  const [mode, setMode] = useState<'full' | 'quick'>('full');
  const [sheet, setSheet] = useState<{ detent: Detent; resizable: boolean } | null>(null);
  const [action, setAction] = useState(false);
  const [answer, setAnswer] = useState('');
  const [undos, setUndos] = useState(0);
  const [bottom, setBottom] = useState<Bottom>('none');
  const [tab, setTab] = useState<Tab>('table');
  const [fixedTab, setFixedTab] = useState<Tab>('table');

  return (
    <main class="screen" data-testid="ui-gallery">
      <NavBar title="Components" back={{ label: 'Settings', route: 'settings' }} large>
        <IconButton label="Show a toast" testId="g-nav-icon" onClick={() => toast({ text: 'The icon button in the bar works.' })}>
          <Icon name="info" />
        </IconButton>
      </NavBar>
      <Callout kind="info" title="For testing">
        The building blocks of the new design, each in every state. The screens switch over to them next.
      </Callout>

      <Section title="Buttons" id="buttons">
        <p class="gallery-caption">Full buttons: 52 px, rounded 14. Press one: it shrinks a little.</p>
        <div class="stack">
          <Button variant="filled" block testId="g-btn-filled">
            Filled · the main action
          </Button>
          <Button variant="tinted" block>
            Tinted
          </Button>
          <Button block>Grey</Button>
          <Button variant="plain" block>
            Plain
          </Button>
          <Button variant="destructive" block>
            Destructive
          </Button>
          <Button variant="destructive-filled" block>
            Destructive, filled
          </Button>
          <Button variant="good" block>
            ✓ It fits
          </Button>
          <Button variant="filled" block disabled>
            Filled, not available now
          </Button>
        </div>
        <p class="gallery-caption">Small text buttons: 44 px.</p>
        <div class="gallery-row" data-testid="g-small-buttons">
          <Button variant="filled" small>
            Filled
          </Button>
          <Button variant="tinted" small>
            Tinted
          </Button>
          <Button small>Grey</Button>
          <Button variant="plain" small>
            Plain
          </Button>
          <Button variant="destructive" small>
            Delete
          </Button>
          <Button small disabled>
            Off
          </Button>
        </div>
        <p class="gallery-caption">Icon only: a 36 px circle inside a 44 px place to tap.</p>
        <div class="gallery-row" data-testid="g-icon-buttons">
          <IconButton label="Close">
            <Icon name="x" />
          </IconButton>
          <IconButton label="More" tinted>
            <Icon name="more-horizontal" />
          </IconButton>
          <IconButton label="Help">
            <Icon name="help-circle" />
          </IconButton>
          <IconButton label="Not available" disabled>
            <Icon name="x" />
          </IconButton>
        </div>
        <p class="gallery-caption">Today's class names, now drawn the new way:</p>
        <div class="gallery-row">
          <button class="btn btn-primary btn-small">btn-primary</button>
          <button class="btn btn-danger btn-small">btn-danger</button>
          <button class="btn btn-fits btn-small">btn-fits</button>
          <button class="btn btn-on btn-small">btn-on</button>
          <button class="btn btn-back">‹ btn-back</button>
        </div>
      </Section>

      <Section title="Segmented control" id="segmented">
        <Segmented
          label="Units"
          testId="g-seg-units"
          value={units}
          onChange={setUnits}
          options={[
            ['mm', 'mm'],
            ['cm', 'cm'],
            ['in', 'inches'],
          ]}
        />
        <Segmented
          label="Show pieces"
          testId="g-seg-group"
          nowrap
          value={group}
          onChange={setGroup}
          options={[
            ['all', 'All', 22],
            ['border', 'Border', 5],
            ['inside', 'Inside', 15],
            ['unsure', 'Unsure', 2],
          ]}
        />
        <Segmented
          label="Scan mode"
          value={mode}
          onChange={setMode}
          options={[
            ['full', 'Full (overview + close-ups)'],
            ['quick', 'Quick (one overview photo)'],
          ]}
        />
      </Section>

      <Section title="Grouped list" id="list">
        <ListSection header="Tools" footer="A footer sentence explains the group. 15 px, grey." testId="g-list">
          <ListRow icon={<Icon name="map" />} tone="accent" title="Show my table" href="#/ui" testId="g-row-link" />
          <ListRow icon={<Icon name="target" />} tone="bad" title="Fill a spot" value="20" chevron onClick={() => toast({ text: 'Fill a spot' })} testId="g-row-button" />
          <ListRow icon={<Icon name="link" />} tone="good" title="Which pieces join" value="25" chevron onClick={() => toast({ text: 'Which pieces join' })} />
          <ListRow icon={<Icon name="alert-triangle" />} tone="warn" title="Pieces to check" subtitle="2 outlines look odd" chevron onClick={() => toast({ text: 'Pieces to check' })} />
          <ListRow icon={<Icon name="settings" />} title="Settings" value="cm" href="#/settings" />
          <ListRow icon={<Icon name="x" />} tone="grey" title="Not available now" onClick={() => {}} disabled />
        </ListSection>
        <ListSection header="Without icons">
          <ListRow title="Version" value="M9" />
          <ListRow title="Delete scanned pieces…" destructive onClick={() => setAction(true)} />
        </ListSection>
      </Section>

      <Section title="Callouts" id="callouts">
        <Callout
          kind="info"
          title="Add to Home Screen"
          action={{ label: 'How', onClick: () => toast({ text: 'How: the Share button, then Add to Home Screen.' }) }}
        >
          So your puzzles are kept safe.
        </Callout>
        <Callout kind="good" title="Saved">
          22 pieces are in this puzzle now.
        </Callout>
        <Callout kind="warn" title="The light is low">
          Turn on a lamp over the table for clearer pieces.
        </Callout>
        <Callout kind="bad" title="The photo could not be read" action={{ label: 'Try again', onClick: () => toast({ text: 'Trying again…' }) }}>
          Hold the phone flat over the table and take it again.
        </Callout>
        <Callout kind="info">Only words, no title: a short tip in one or two lines.</Callout>
      </Section>

      <Section title="Bottom sheet" id="sheet">
        <p class="gallery-caption">Swipe down on the grabber or title, tap the dimmed page, ✕ or Escape to close. Swipe up for large.</p>
        <div class="stack">
          <Button testId="g-open-sheet" onClick={() => setSheet({ detent: 'medium', resizable: true })}>
            Open a sheet (medium)
          </Button>
          <Button testId="g-open-sheet-large" onClick={() => setSheet({ detent: 'large', resizable: true })}>
            Open a sheet (large)
          </Button>
          <Button testId="g-open-sheet-fixed" onClick={() => setSheet({ detent: 'medium', resizable: false })}>
            Open a sheet (one height)
          </Button>
        </div>
      </Section>

      <Section title="Action sheet" id="action">
        <p class="gallery-caption">Only for big destructive actions. Cancel is separate, and first for VoiceOver.</p>
        <div class="stack">
          <Button variant="destructive" testId="g-open-action" onClick={() => setAction(true)}>
            Delete this puzzle…
          </Button>
          <Button
            testId="g-confirm"
            onClick={async () => {
              const ok = await confirmAction({
                title: 'Delete all scanned pieces?',
                message: 'Their photos go too. This can’t be undone.',
                confirmLabel: 'Delete pieces',
              });
              setAnswer(ok ? 'Deleted' : 'Kept');
            }}
          >
            Ask with confirmAction()
          </Button>
          <p class="gallery-caption" data-testid="g-answer">
            {answer ? `Answer: ${answer}` : 'No answer yet.'}
          </p>
        </div>
      </Section>

      <Section title="Toast" id="toast">
        <p class="gallery-caption">One at a time, 8 seconds, above the bottom bar. Undo puts things back.</p>
        <div class="stack">
          <Button testId="g-toast" onClick={() => toast({ text: 'Placed at column 4 · row 2', action: { label: 'Undo', run: () => setUndos((n) => n + 1) } })}>
            Show a toast with Undo
          </Button>
          <Button testId="g-toast-plain" onClick={() => toast({ text: 'Backup saved to Files.' })}>
            Show a toast without a button
          </Button>
          <Button testId="g-toast-short" onClick={() => toast({ text: 'A short one: 2 seconds.', ms: 2000 })}>
            Show a 2-second toast
          </Button>
          <p class="gallery-caption" data-testid="g-undos">
            Undo tapped {undos} {undos === 1 ? 'time' : 'times'}.
          </p>
        </div>
        <p class="gallery-caption">A bar at the bottom of the screen (the toast moves above it):</p>
        <Segmented
          label="Bottom bar"
          testId="g-bottom"
          value={bottom}
          onChange={setBottom}
          options={[
            ['none', 'None'],
            ['action', 'Action bar'],
            ['tabs', 'Tab bar'],
          ]}
        />
      </Section>

      <Section title="Tab bar" id="tabbar">
        <p class="gallery-caption">From stage 4. A 24 px icon over a 13 px label; the selected one in blue; a red badge.</p>
        <div class="gallery-frame">
          <TabBar label="Puzzle (example)" items={TABS} selected={tab} onSelect={setTab} testId="g-tabbar" />
        </div>
      </Section>

      <Section title="Navigation bar" id="navbar">
        <p class="gallery-caption">
          The bar at the top of this page: back to the parent screen (‹ Settings), a Large Title that moves into the bar when you scroll, and 44 px buttons on
          the right. Other screens (Settings) show the small title in the bar.
        </p>
      </Section>

      <Section title="Sizes, spacing, type" id="tokens">
        <p class="gallery-caption">Spacing 4 · 8 · 12 · 16 · 20 · 24 · 32</p>
        <div class="gallery-row" style={{ alignItems: 'flex-end' }}>
          {[1, 2, 3, 4, 5, 6, 8].map((n) => (
            <span key={n} class="gallery-swatch" style={{ flexDirection: 'column', gap: '4px' }}>
              <span class="gallery-space" style={{ width: `var(--s-${n})` }} />
              {n * 4}
            </span>
          ))}
        </div>
        <p class="gallery-caption">Corners 6 · 10 · 14 · 20 · 30 · pill</p>
        <div class="gallery-row">
          {['badge', 'thumb', 'control', 'card', 'sheet', 'pill'].map((r) => (
            <span key={r} class="gallery-swatch" style={{ height: '56px', borderRadius: `var(--r-${r})` }}>
              {r}
            </span>
          ))}
        </div>
        <p class="gallery-caption">Depth: e1 (cards) and e2 (sheets, toasts)</p>
        <div class="gallery-row">
          <span class="gallery-swatch" style={{ height: '56px', width: '96px' }}>
            e1
          </span>
          <span class="gallery-swatch" style={{ height: '56px', width: '96px', boxShadow: 'var(--e2)' }}>
            e2
          </span>
        </div>
        <div class="gallery-type">
          {(
            [
              ['large-title', 'Large Title 34'],
              ['title-1', 'Title 1 · 28'],
              ['title-2', 'Title 2 · 22'],
              ['title-3', 'Title 3 · 20'],
              ['headline', 'Headline · 17 semibold'],
              ['body', 'Body · 17'],
              ['callout', 'Callout · 16'],
              ['subhead', 'Subheadline · 15 (the smallest for sentences)'],
              ['footnote', 'FOOTNOTE · 13 (HEADERS, TAB LABELS)'],
              ['badge', 'Badge · 12 (numbers in badges)'],
            ] as const
          ).map(([k, words]) => (
            <span key={k} style={{ font: `var(--t-${k})` }}>
              {words}
            </span>
          ))}
        </div>
      </Section>

      <Sheet
        open={sheet != null}
        onClose={() => setSheet(null)}
        title="Column 18 · Row 7"
        detent={sheet?.detent ?? 'medium'}
        resizable={sheet?.resizable ?? true}
        testId="g-sheet"
      >
        <p>A bottom sheet. Its content scrolls inside it; the page behind stays put.</p>
        <div class="fill-answer">
          <Button
            testId="g-sheet-not"
            onClick={() => (setSheet(null), toast({ text: 'Not there', action: { label: 'Undo', run: () => setUndos((n) => n + 1) } }))}
          >
            ✗ Not there
          </Button>
          <Button
            variant="good"
            testId="g-sheet-fits"
            onClick={() => (setSheet(null), toast({ text: 'It fits', action: { label: 'Undo', run: () => setUndos((n) => n + 1) } }))}
          >
            ✓ It fits
          </Button>
        </div>
        <ListSection header="Also possible">
          {Array.from({ length: 12 }, (_, i) => (
            <ListRow key={i} title={`Column ${i + 3} · Row ${(i % 5) + 1}`} value={`${12 - i} %`} />
          ))}
        </ListSection>
      </Sheet>

      <ActionSheet
        open={action}
        onClose={() => setAction(false)}
        title="Delete “Harbour at dusk”?"
        message="Its photos and pieces go too. This can’t be undone."
        testId="g-action"
        actions={[{ label: 'Delete puzzle', destructive: true, run: () => setAnswer('Deleted (example)'), testId: 'g-action-delete' }]}
      />

      {bottom === 'action' && (
        <nav class="action-bar" aria-label="Example action bar" data-testid="g-action-bar">
          <div class="action-bar-inner">
            {['Scan', 'Live view', 'Fill a spot', 'Joins'].map((w, i) => (
              <button key={w} class={`action-bar-btn${i === 0 ? ' action-bar-primary' : ''}`} onClick={() => toast({ text: w })}>
                <span class="action-bar-label">{w}</span>
              </button>
            ))}
          </div>
        </nav>
      )}
      {bottom === 'tabs' && <TabBar fixed label="Example tab bar" items={TABS} selected={fixedTab} onSelect={setFixedTab} testId="g-tabbar-fixed" />}
    </main>
  );
}
