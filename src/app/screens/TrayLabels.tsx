/**
 * Tray labels to print (#/trays/<projectId>, M4): one label per colour group (6 per A4 page): the
 * tray's letter on its colour and pictures of up to 8 of its pieces. Print from the iPhone, or send
 * the page to a Mac and print there.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { TestButton } from '../components/TestSteps';
import { plural } from '../words';
import { go, routeArg } from '../router';
import { db } from '../../db/db';
import { getBlob, getProject } from '../../project/store';
import type { PieceRow, Project } from '../../project/types';
import { shareOrDownload } from '../../report/share';
import { useColourGroups } from '../components/Trays';
import { logError, logInfo, logWarn } from '../../log/logger';

const PER_PAGE = 6;
const THUMBS = 8;

export const LABEL_CSS = `
.tl-pages { display: flex; flex-direction: column; gap: 16px; }
.tl-page { background: #fff; color: #000; display: grid; grid-template-columns: 1fr; gap: 0; box-sizing: border-box; border-radius: 8px; overflow: hidden; }
.tray-label { border: 1px dashed #999; padding: 4mm; box-sizing: border-box; display: flex; flex-direction: column; gap: 2.5mm; font-family: -apple-system, Helvetica, Arial, sans-serif; background: #fff; color: #000; }
.tl-head { display: flex; align-items: center; gap: 4mm; }
.tl-letter { width: 24mm; height: 24mm; flex: none; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16mm; font-weight: 800; line-height: 1; border: 0.4mm solid #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.tl-title { font-size: 7mm; font-weight: 800; }
.tl-sub { font-size: 3.2mm; color: #333; margin-top: 1mm; }
.tl-swatch { height: 4mm; border-radius: 1mm; margin-top: 1.5mm; border: 0.3mm solid #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.tl-thumbs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.5mm; }
.tl-thumbs img { width: 100%; aspect-ratio: 1; object-fit: contain; background: #eee; border-radius: 1mm; display: block; }
.tl-foot { font-size: 2.8mm; color: #444; }
@media print {
  @page { size: A4; margin: 8mm; }
  html, body { background: #fff !important; }
  .no-print, .banner { display: none !important; }
  .app, .screen { padding: 0 !important; margin: 0 !important; max-width: none !important; background: #fff !important; }
  .tl-pages { gap: 0; }
  .tl-page { width: 194mm; grid-template-columns: 1fr 1fr; grid-auto-rows: 93mm; border-radius: 0; break-after: page; }
  .tl-page:last-child { break-after: auto; }
}
`;

async function dataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

export function TrayLabelsScreen() {
  const id = routeArg.value;
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [pieces, setPieces] = useState<PieceRow[] | null>(null);
  useEffect(() => {
    if (!id) return setProject(null);
    void (async () => {
      const p = await getProject(id);
      setProject(p ?? null);
      if (p) setPieces(await db().pieces.where('projectId').equals(p.id).toArray());
    })().catch((err) => {
      logError('trays', 'The puzzle could not be loaded for the tray labels', err);
      setProject(null);
    });
  }, [id]);
  if (project === null)
    return (
      <main class="screen">
        <div class="notice notice-bad">This puzzle is not on this iPhone.</div>
        <button class="btn btn-primary btn-block" onClick={() => go('home')}>
          Back to my puzzles
        </button>
      </main>
    );
  if (!project || !pieces)
    return (
      <main class="screen">
        <p class="muted">Loading…</p>
      </main>
    );
  return <Labels project={project} pieces={pieces} />;
}

function Labels({ project, pieces }: { project: Project; pieces: PieceRow[] }) {
  // With the pieces in trays: each label shows those most of one colour.
  const { groups, colours } = useColourGroups(true, project, pieces, true);
  const [thumbs, setThumbs] = useState<Map<number, string[]> | null>(null);
  const [shareNote, setShareNote] = useState<{ url: string; name: string } | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const pagesRef = useRef<HTMLDivElement>(null);

  // A few pieces of each group (those most of one colour), as pictures inside the page.
  useEffect(() => {
    if (!groups || !colours) return;
    let live = true;
    void (async () => {
      const out = new Map<number, string[]>();
      for (const g of groups.groups) {
        const mine = pieces
          .filter((p) => p.thumbBlobId && groups.of.get(p.id)?.group === g.index)
          .sort((a, b) => (colours.get(b.id)?.mainShare ?? 0) - (colours.get(a.id)?.mainShare ?? 0))
          .slice(0, THUMBS);
        const urls: string[] = [];
        for (const p of mine) {
          const b = await getBlob(p.thumbBlobId!);
          if (b) urls.push(await dataUrl(b));
        }
        out.set(g.index, urls);
      }
      if (live) setThumbs(out);
    })().catch((err) => logWarn('trays', 'Piece pictures could not be added to the labels', err));
    return () => {
      live = false;
    };
  }, [groups, colours]);

  const print = () => {
    try {
      logInfo('trays', 'Print dialog opened for the tray labels');
      window.print();
    } catch (err) {
      logError('trays', 'Printing could not start', err);
      setPrintError('Printing could not start here. Tap "Send to my Mac" and print from there.');
    }
  };
  const send = () => {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${project.name}: tray labels</title><style>${LABEL_CSS}
body { margin: 0; padding: 12px; background: #ddd; }
.help { font: 14px -apple-system, Helvetica, Arial, sans-serif; margin: 0 0 12px; }
@media print { .help { display: none; } body { padding: 0; } }</style></head><body>
<p class="help"><strong>Puzzle Lens tray labels.</strong> Print this page (File › Print, or ⌘P) on A4. Cut along the dashed lines.</p>
${pagesRef.current?.outerHTML ?? ''}</body></html>`;
    const f = new File([html], `${project.name} tray labels.html`, { type: 'text/html' });
    // FIRST thing in the tap (iOS ~5 s rule): the page is already built.
    void shareOrDownload(f, 'Puzzle Lens tray labels').then((outcome) => {
      if (outcome.kind === 'download') {
        logWarn('trays', `Share menu not available, download offered instead (${outcome.reason})`);
        setShareNote({ url: outcome.url, name: f.name });
      } else if (outcome.kind === 'shared') logInfo('trays', 'Tray labels shared');
    });
  };

  const ready = Boolean(groups && thumbs);
  const counts = new Map<number, number>();
  if (groups) for (const v of groups.of.values()) counts.set(v.group, (counts.get(v.group) ?? 0) + 1);
  const pages = groups
    ? Array.from({ length: Math.ceil(groups.groups.length / PER_PAGE) }, (_, i) => groups.groups.slice(i * PER_PAGE, (i + 1) * PER_PAGE))
    : [];
  return (
    <main class="screen tray-labels" data-testid="tray-labels">
      <style>{LABEL_CSS}</style>
      <div class="no-print">
        <div class="topbar">
          <button class="btn btn-back" data-testid="labels-back" onClick={() => go('puzzle', project.id)}>
            ‹ Back
          </button>
          <h1>Tray labels</h1>
          <TestButton />
        </div>
        <div class="row two-up">
          <button class="btn btn-primary" data-testid="print-labels" disabled={!ready} onClick={print}>
            🖨️ Print
          </button>
          <button class="btn" data-testid="send-labels" disabled={!ready} onClick={send}>
            Send to my Mac
          </button>
        </div>
        <p class="small muted">
          One label per tray, 6 on an A4 page: cut along the dashed lines and put each on its tray. If Print doesn't open, tap <strong>Send to my Mac</strong>,
          choose AirDrop (or Mail), and print from there.
          {groups?.fixed ? '' : ' The groups can still change until you put pieces in a tray: print after the first tray is filled to be sure.'}
        </p>
        {printError && (
          <div class="notice notice-bad" role="alert">
            {printError}
          </div>
        )}
        {shareNote && (
          <div class="notice notice-warn" role="alert">
            The Share menu didn't open.{' '}
            <a href={shareNote.url} download={shareNote.name} data-testid="download-labels">
              Download the labels
            </a>{' '}
            instead: the file goes to the Files app, in Downloads.
          </div>
        )}
        {!ready && <p class="muted">Preparing the labels…</p>}
      </div>
      {ready && groups && (
        <div class="tl-pages" ref={pagesRef}>
          {pages.map((gs, i) => (
            <div key={i} class="tl-page">
              {gs.map((g) => (
                <div key={g.letter} class="tray-label" data-testid={`tray-label-${g.letter}`}>
                  <div class="tl-head">
                    <div class="tl-letter" style={{ background: g.hex, color: g.ink }}>
                      {g.letter}
                    </div>
                    <div>
                      <div class="tl-title">Tray {g.letter}</div>
                      <div class="tl-sub">
                        {project.name} · {plural(counts.get(g.index) ?? 0, 'piece')} when printed
                      </div>
                      <div class="tl-swatch" style={{ background: g.hex }} />
                    </div>
                  </div>
                  <div class="tl-thumbs">
                    {(thumbs?.get(g.index) ?? []).map((u, k) => (
                      <img key={k} src={u} alt="" />
                    ))}
                  </div>
                  <div class="tl-foot">Pieces of this tray, as photographed.</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
