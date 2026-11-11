/**
 * New puzzle wizard (PLAN §5), steps 0–4, plus the printable marker sheets page.
 *
 *   0. Home Screen check (Safari tab only)   3. Grid (suggested from count + picture shape)
 *   1. Name and piece count                  4. Ready to scan (no printing), or with printed markers:
 *   2. Box picture: photo → corners →           Print markers + ruler check (print scale)
 *      straightened picture                  5. (markers only) Lay out markers and photograph the empty table
 *
 * Every answer is saved the moment it is given; `Project.setupStep` is the next step to show, so
 * leaving and coming back (or iOS reloading the app) resumes where the owner was.
 * Address: `#/new` before the puzzle exists, `#/new/<id>` after.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { StepNavBar } from '../components/StepNavBar';
import { Callout } from '../ui/Callout';
import { Icon } from '../ui/icons';
import { plural } from '../words';
import { go, replaceRoute, routeArg } from '../router';
import { isStandalone } from '../env';
import { readerWorker } from '../workers';
import { CornerEditor, type Corner } from '../components/CornerEditor';
import {
  createProject,
  deleteBlob,
  getBlobRow,
  getPrintScale,
  getProject,
  nextProjectName,
  projectBlobId,
  putBlob,
  setCurrentProjectId,
  setPrintScale,
  updateProject,
  type ProjectPatch,
} from '../../project/store';
import { checkManualGrid, describeGrid, topGrids } from '../../project/grid';
import type { Project } from '../../project/types';
import { checkQuad, defaultCorners } from '../../cv/rectify';
import { MARKER_SHEET_PRINT_CSS, markerSheetSvg, markerSheetsHtml, SHEET_COUNT } from '../../markers/sheet';
import { CHECK_BAR_MM, MARKER_COUNT } from '../../markers/layout';
import { shareOrDownload } from '../../report/share';
import { logError, logInfo, logWarn } from '../../log/logger';
import { errorWords, setupSteps, UNREADABLE_PHOTO, useBlobUrl } from './puzzle/shared';
import { StepTable } from './StepTable';
import { PAPER } from '../tokens';

const COMMON_COUNTS = [500, 1000, 1500, 2000];
const MAX_COUNT = 40000;
/** The last wizard step (lay out the markers, photograph the empty table). */
const PLACEHOLDER_STEP = 5;
const BOX_PHOTO = 'box-photo';
const BOX_RECTIFIED = 'box-rectified';
/**
 * The corners being placed live in their own small row (an empty blob + meta), never in the photo's
 * row: in WebKit, rewriting a database row that holds a photo Blob lost the photo after a reload.
 */
const BOX_CORNERS = 'box-corners';
const READER_TIMEOUT_MS = 90_000;

/**
 * A copy of a Blob read from the database, held in memory, so a problem reading the database
 * shows up here (with a clear message) rather than inside the reader worker.
 */
async function ownCopy(blob: Blob): Promise<Blob> {
  return new Blob([await blob.arrayBuffer()], { type: blob.type });
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} took longer than ${Math.round(ms / 1000)} seconds. Please try again.`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

/** An error about a photo, for the screen: "That photo couldn't be used: …", or only the plain words for a photo that can't be read. */
function photoError(lead: string, err: unknown, tail = ''): string {
  const words = errorWords(err);
  return words === UNREADABLE_PHOTO ? words : `${lead}: ${words}${tail}`;
}

// ---------------------------------------------------------------------------------------------
// Wizard shell
// ---------------------------------------------------------------------------------------------

export function NewPuzzleScreen() {
  const id = routeArg.value;
  const [project, setProject] = useState<Project | null | undefined>(id ? undefined : null);
  const [step, setStep] = useState<number>(id ? -1 : isStandalone.value ? 1 : 0);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Saves run one after another, so a quick sequence of changes can't arrive out of order.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const creating = useRef<Promise<Project> | null>(null);

  useEffect(() => {
    if (!id) return;
    if (project && project.id === id) return;
    let live = true;
    getProject(id)
      .then((p) => {
        if (!live) return;
        setProject(p ?? null);
        if (p) {
          // The last step of the way it is set up (step 4 without printing).
          setStep(Math.min(setupSteps(p).length - 1, Math.max(1, p.setupStep)));
          void setCurrentProjectId(p.id).catch(() => {});
        }
      })
      .catch((err) => {
        logError('wizard', 'The puzzle could not be loaded', err);
        if (live) {
          setLoadError(errorWords(err));
          setProject(null);
        }
      });
    return () => {
      live = false;
    };
  }, [id]);

  /** Creates the puzzle on the first answer (once). */
  const ensureProject = async (init: { name: string; pieceCount: number }): Promise<Project> => {
    if (project) return project;
    creating.current ??= createProject({ ...init, setupStep: 1 }).then((p) => {
      logInfo('wizard', `New puzzle started: ${p.name}`);
      setProject(p);
      replaceRoute('new', p.id);
      void setCurrentProjectId(p.id).catch(() => {});
      return p;
    });
    // A failed attempt (e.g. storage full) must not block the next one.
    creating.current.catch(() => {
      creating.current = null;
    });
    return creating.current;
  };

  /** Saves some fields now (queued); the screen shows the saved result. */
  const save = (patch: ProjectPatch, base?: Project): Promise<Project> => {
    const run = queue.current.then(async () => {
      const target = base ?? project;
      if (!target) throw new Error('The puzzle has not been created yet.');
      const next = await updateProject(target.id, patch);
      setProject(next);
      return next;
    });
    queue.current = run.catch(() => {});
    return run;
  };

  /** Moves to `to`, recording progress (setupStep only ever grows here). */
  const advance = async (to: number, base?: Project) => {
    const p = base ?? project;
    if (p && p.setupStep < to) await save({ setupStep: to }, p);
    setStep(to);
    scrollTo?.(0, 0);
  };

  if (id && project === undefined) {
    return (
      <main class="screen">
        <WizardTop title="New puzzle" backLabel="Home" onBack={() => go('home')} />
        <p class="muted">Loading…</p>
      </main>
    );
  }
  if (id && project === null) {
    return (
      <main class="screen" data-testid="wizard-missing">
        <WizardTop title="New puzzle" backLabel="Home" onBack={() => go('home')} />
        <Callout kind="bad">{loadError ?? 'This puzzle is not on this iPhone (it may have been deleted).'}</Callout>
        <button class="btn btn-primary btn-block" onClick={() => go('home')}>
          Back to my puzzles
        </button>
      </main>
    );
  }

  const back = () => {
    if (step > 1) return setStep(step - 1);
    if (step === 1 && !project && !isStandalone.value) return setStep(0);
    if (project) return go('puzzle', project.id);
    go('home');
  };
  // What back goes to, said next to its chevron: the step before, the install advice, the puzzle, or Home.
  const backLabel = step > 1 ? `Step ${step - 1}` : step === 1 && !project && !isStandalone.value ? 'Install' : project ? project.name : 'Home';

  return (
    <main class="screen wizard" data-testid="wizard" data-step={step}>
      <WizardTop title={project?.name ?? 'New puzzle'} backLabel={backLabel} onBack={back} onClose={() => (project ? go('puzzle', project.id) : go('home'))} />
      {step >= 1 && <StepDots step={step} reached={project?.setupStep ?? 1} steps={setupSteps(project ?? { tracking: 'pieces' })} />}
      {step === 0 && <StepInstall onContinue={() => setStep(1)} />}
      {step === 1 && <StepNameCount project={project ?? null} ensureProject={ensureProject} save={save} onNext={async (p) => advance(2, p)} />}
      {step === 2 && project && <StepBox project={project} save={save} onNext={() => advance(3)} />}
      {step === 3 && project && <StepGrid project={project} save={save} onNext={() => advance(4)} />}
      {step === 4 && project && project.tracking !== 'markers' && (
        <StepTracking
          onPieces={() => void save({ tracking: 'pieces', setupStep: 6 }).then((p) => go('puzzle', p.id))}
          onMarkers={() => void save({ tracking: 'markers' })}
        />
      )}
      {step === 4 && project && project.tracking === 'markers' && <StepMarkers project={project} onNext={() => advance(PLACEHOLDER_STEP)} />}
      {step === PLACEHOLDER_STEP && project && <StepTable project={project} save={save} />}
    </main>
  );
}

/** The wizard's NavBar: back goes one step back (or to where the wizard was opened from); Close leaves it. */
function WizardTop({ title, backLabel, onBack, onClose }: { title: string; backLabel: string; onBack: () => void; onClose?: () => void }) {
  return (
    <StepNavBar title={title} backLabel={backLabel} onBack={onBack} backTestId="wizard-back">
      {onClose && (
        <button class="navbar-btn" data-testid="wizard-close" onClick={onClose}>
          Close
        </button>
      )}
    </StepNavBar>
  );
}

/** "Step 4 of 4 · Ready to scan": the steps of the way the puzzle is set up (4 without printing, 5 with printed markers). */
function StepDots({ step, reached, steps }: { step: number; reached: number; steps: readonly string[] }) {
  const last = steps.length - 1;
  return (
    <div class="step-dots" aria-label={`Step ${step} of ${last}`}>
      <span class="step-count" data-testid="step-count">
        Step {step} of {last} · {steps[step]}
      </span>
      <span class="dots">
        {steps.slice(1).map((_, i) => (
          <span key={i + 1} class={`dot${i + 1 === step ? ' is-current' : i + 1 < reached ? ' is-done' : ''}`} />
        ))}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Step 0: Home Screen check
// ---------------------------------------------------------------------------------------------

function StepInstall({ onContinue }: { onContinue: () => void }) {
  return (
    <section data-testid="step-install">
      <h2>First: install Puzzle Lens on your Home Screen</h2>
      <Callout kind="warn">
        <p>
          You're in a <strong>Safari tab</strong>. Safari and the Home Screen app keep <strong>separate</strong> puzzles: a puzzle you start here will{' '}
          <strong>not</strong> appear in the Home Screen app. Safari may also delete it after 7 days without a visit.
        </p>
        <p>So it's best to install first and start your puzzle in the Home Screen app.</p>
      </Callout>
      <ol class="steps">
        <li>
          Tap <strong>Share</strong> (square with an arrow). If you don't see it, tap{' '}
          <Icon name="more-horizontal" size={18} class="icon-inline" label="⋯ (More)" /> first.
        </li>
        <li>
          Tap <strong>Add to Home Screen</strong> (under <strong>View More</strong> if needed), then <strong>Add</strong>.
        </li>
        <li>
          Open <strong>Puzzle Lens</strong> from your Home Screen and tap <strong>New puzzle</strong> there.
        </li>
      </ol>
      <a class="btn btn-block" href="#/help">
        Full setup guide
      </a>
      <button class="btn btn-block wizard-secondary" data-testid="continue-anyway" onClick={onContinue}>
        Continue in Safari anyway (for a test)
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Step 1: name and piece count
// ---------------------------------------------------------------------------------------------

function StepNameCount({
  project,
  ensureProject,
  save,
  onNext,
}: {
  project: Project | null;
  ensureProject: (init: { name: string; pieceCount: number }) => Promise<Project>;
  save: (patch: ProjectPatch, base?: Project) => Promise<Project>;
  onNext: (p: Project) => Promise<void>;
}) {
  const [name, setName] = useState(project?.name ?? '');
  const [count, setCount] = useState(project?.pieceCount ? String(project.pieceCount) : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!project && !name)
      void nextProjectName()
        .then((n) => setName((cur) => cur || n))
        .catch(() => setName((cur) => cur || 'Puzzle 1'));
  }, []);

  const parsed = Number(count);
  const countOk = /^\d+$/.test(count) && parsed >= 2 && parsed <= MAX_COUNT;

  /** Saves name and count now (creating the puzzle on the first answer). */
  const persist = async (nextName: string, nextCount: string): Promise<Project | null> => {
    try {
      const n = Number(nextCount);
      const validCount = /^\d+$/.test(nextCount) && n >= 2 && n <= MAX_COUNT ? n : null;
      const cleanName = nextName.trim();
      const p = await ensureProject({ name: cleanName, pieceCount: validCount ?? 0 });
      const patch: ProjectPatch = {};
      if (cleanName && cleanName !== p.name) patch.name = cleanName;
      if (validCount !== null && validCount !== p.pieceCount) {
        patch.pieceCount = validCount;
        // A different count makes a chosen grid out of date.
        if (p.grid) {
          patch.grid = null;
          if (p.setupStep > 3) patch.setupStep = 3;
        }
      }
      setError(null);
      return Object.keys(patch).length ? await save(patch, p) : p;
    } catch (err) {
      logError('wizard', 'Name or piece count could not be saved', err);
      setError(`Couldn't save: ${errorWords(err)}`);
      return null;
    }
  };

  const next = async () => {
    if (!countOk) {
      setError('Please type the number of pieces printed on the box (for example 1000).');
      return;
    }
    setBusy(true);
    const p = await persist(name, count);
    setBusy(false);
    if (p) await onNext(p).catch((err) => setError(errorWords(err)));
  };

  return (
    <section data-testid="step-name">
      <h2>Your puzzle</h2>
      <label class="field">
        <span>Name</span>
        <input
          class="text-input"
          type="text"
          value={name}
          maxLength={60}
          autocomplete="off"
          data-testid="puzzle-name-input"
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          onBlur={() => (project || countOk) && void persist(name, count)}
        />
      </label>
      <label class="field">
        <span>Number of pieces (printed on the box)</span>
        <input
          class="text-input big-number"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="e.g. 1000"
          value={count}
          data-testid="piece-count-input"
          onInput={(e) => {
            const v = (e.target as HTMLInputElement).value.replace(/[^\d]/g, '').slice(0, 5);
            setCount(v);
          }}
          // Saved when the field is left (or on Next), not on every key: typing "1000" must not
          // save "10" on the way and reset a chosen grid.
          onBlur={() => {
            if (/^\d+$/.test(count) && Number(count) >= 2) void persist(name, count);
          }}
        />
      </label>
      <div class="choice-row" role="group" aria-label="Common piece counts">
        {COMMON_COUNTS.map((n) => (
          <button
            key={n}
            class="choice-chip"
            aria-pressed={count === String(n)}
            data-testid={`count-${n}`}
            onClick={() => {
              setCount(String(n));
              void persist(name, String(n));
            }}
          >
            {n}
          </button>
        ))}
      </div>
      {error && (
        <Callout kind="bad" role="alert" testId="step-error">
          {error}
        </Callout>
      )}
      <button class="btn btn-primary btn-block wizard-next" data-testid="wizard-next" disabled={busy} onClick={() => void next()}>
        Next
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Step 2: box picture
// ---------------------------------------------------------------------------------------------

interface BoxPhotoMeta {
  corners: Corner[] | null;
}

type BoxPhase =
  | { kind: 'choose' }
  | { kind: 'working'; label: string }
  | { kind: 'corners'; photoUrl: string; corners: Corner[]; size: { w: number; h: number } | null }
  | { kind: 'done' };

function StepBox({ project, save, onNext }: { project: Project; save: (patch: ProjectPatch) => Promise<Project>; onNext: () => Promise<void> }) {
  const photoId = projectBlobId(project.id, BOX_PHOTO);
  const rectId = projectBlobId(project.id, BOX_RECTIFIED);
  const cornersId = projectBlobId(project.id, BOX_CORNERS);
  const saveCorners = (corners: Corner[] | null) => putBlob(cornersId, 'box-corners', new Blob([]), { corners } satisfies BoxPhotoMeta);
  const loadCorners = async (): Promise<Corner[] | null> => ((await getBlobRow(cornersId))?.meta as BoxPhotoMeta | undefined)?.corners ?? null;
  const [phase, setPhase] = useState<BoxPhase>(project.box ? { kind: 'done' } : { kind: 'working', label: 'Loading…' });
  const [error, setError] = useState<string | null>(null);
  const rectUrl = useBlobUrl(project.box ? rectId : null, project.box);
  const urls = useRef<string[]>([]);
  const metaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const photosInput = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      for (const u of urls.current) URL.revokeObjectURL(u);
      if (metaTimer.current) clearTimeout(metaTimer.current);
    },
    [],
  );

  const keepUrl = (blob: Blob) => {
    const u = URL.createObjectURL(blob);
    urls.current.push(u);
    return u;
  };

  /** Shows the corner editor for the stored photo, with saved corners or a first guess. */
  const openCorners = async (photo: Blob, saved: Corner[] | null) => {
    setPhase({ kind: 'working', label: 'Getting your photo ready…' });
    const reader = readerWorker().api;
    const preview = await withTimeout(reader.preview(photo, 1600), READER_TIMEOUT_MS, 'Preparing the photo');
    let corners = saved;
    if (!corners) {
      setPhase({ kind: 'working', label: 'Looking for the picture’s corners…' });
      try {
        corners = (await withTimeout(reader.suggestBoxCorners(preview), READER_TIMEOUT_MS, 'Finding the corners')) as Corner[] | null;
      } catch (err) {
        logWarn('wizard', 'Automatic corner guess failed; starting from the default outline', err);
      }
      corners ??= defaultCorners() as Corner[];
      await saveCorners(corners);
    }
    setPhase({ kind: 'corners', photoUrl: keepUrl(preview), corners, size: null });
  };

  // Resume: a photo taken before the app closed, but not straightened yet.
  useEffect(() => {
    if (project.box) return;
    let live = true;
    getBlobRow(photoId)
      .then(async (row) => {
        if (!live) return;
        if (!row) return setPhase({ kind: 'choose' });
        await openCorners(await ownCopy(row.blob), await loadCorners());
      })
      .catch((err) => {
        logError('wizard', 'The saved box photo could not be opened', err);
        if (live) {
          setError(photoError("The saved photo couldn't be opened", err, '. Please take it again.'));
          setPhase({ kind: 'choose' });
        }
      });
    return () => {
      live = false;
    };
  }, []);

  const onFile = async (input: HTMLInputElement | null) => {
    const file = input?.files?.[0];
    if (input) input.value = '';
    if (!file) return;
    setError(null);
    try {
      if (!file.type.startsWith('image/') && file.type !== '') throw new Error('That file is not a photo. Please choose a photo of the box.');
      setPhase({ kind: 'working', label: 'Saving your photo…' });
      // Store a copy of the bytes, not the picked File: WebKit can keep a File in the database as a
      // link to a temporary file that is gone after a reload ("WebKitBlobResource error 1").
      const photo = new Blob([await file.arrayBuffer()], { type: file.type || 'image/jpeg' });
      await putBlob(photoId, 'box-photo', photo, { name: file.name });
      await saveCorners(null);
      if (project.box) await save({ box: null });
      logInfo('wizard', `Box photo saved (${file.type || 'unknown type'}, ${file.size} bytes)`);
      await openCorners(photo, null);
    } catch (err) {
      logError('wizard', 'The box photo could not be used', err);
      setError(photoError("That photo couldn't be used", err));
      setPhase({ kind: 'choose' });
    }
  };

  const onCornersChange = (corners: Corner[]) => {
    setPhase((ph) => (ph.kind === 'corners' ? { ...ph, corners } : ph));
    if (metaTimer.current) clearTimeout(metaTimer.current);
    metaTimer.current = setTimeout(() => void saveCorners(corners).catch((err) => logWarn('wizard', 'Corner positions could not be saved', err)), 300);
  };

  const straighten = async (corners: Corner[]) => {
    setError(null);
    const problem = checkQuad(corners, 0.01);
    if (problem) {
      setError(problem);
      return;
    }
    const keep = phase;
    try {
      setPhase({ kind: 'working', label: 'Straightening the picture…' });
      if (metaTimer.current) clearTimeout(metaTimer.current);
      await saveCorners(corners);
      const row = await getBlobRow(photoId);
      if (!row) throw new Error('The photo is no longer saved. Please take it again.');
      const r = await withTimeout(readerWorker().api.rectifyBox(await ownCopy(row.blob), corners), READER_TIMEOUT_MS, 'Straightening the picture');
      await putBlob(rectId, 'box-rectified', r.jpeg, { aspect: r.aspect, ms: Math.round(r.ms) });
      await save({
        box: {
          photoBlobId: photoId,
          rectifiedBlobId: rectId,
          corners: r.cornersPx,
          photoWidth: r.photoWidth,
          photoHeight: r.photoHeight,
          width: r.width,
          height: r.height,
          // Re-straightening (new corners, a turn) keeps the answer about a frame.
          ...(project.box?.border ? { border: project.box.border } : {}),
        },
      });
      // The corners are in project.box now; the working copy is no longer needed.
      await deleteBlob(cornersId).catch(() => {});
      logInfo('wizard', `Box picture straightened: ${r.width}×${r.height} (shape ${r.aspect.toFixed(3)}) in ${Math.round(r.ms)} ms`);
      setPhase({ kind: 'done' });
    } catch (err) {
      logError('wizard', 'The box picture could not be straightened', err);
      setError(photoError("The picture couldn't be straightened", err));
      setPhase(keep.kind === 'corners' ? keep : { kind: 'choose' });
    }
  };

  const adjust = async () => {
    setError(null);
    try {
      const row = await getBlobRow(photoId);
      if (!row) throw new Error('The photo is no longer saved. Please take it again.');
      const b = project.box;
      const saved = b ? (b.corners.map(([x, y]) => [x / b.photoWidth, y / b.photoHeight]) as Corner[]) : await loadCorners();
      await openCorners(await ownCopy(row.blob), saved);
    } catch (err) {
      logError('wizard', 'The corners could not be opened again', err);
      setError(errorWords(err));
    }
  };

  /** Turns the result a quarter turn clockwise (the old bottom-left corner becomes the top-left). */
  const turn = async () => {
    const b = project.box;
    if (!b) return;
    const c = b.corners.map(([x, y]) => [x / b.photoWidth, y / b.photoHeight]) as Corner[];
    await straighten([c[3]!, c[0]!, c[1]!, c[2]!]);
  };

  const pickers = (
    <div class="stack">
      <label class="btn btn-primary btn-block file-btn" data-testid="box-take-photo">
        <Icon name="camera" size={20} /> Take a photo of the box
        <input
          ref={cameraInput}
          class="hidden-input"
          type="file"
          accept="image/*"
          capture="environment"
          data-testid="box-file-camera"
          onChange={() => void onFile(cameraInput.current)}
        />
      </label>
      <label class="btn btn-block file-btn" data-testid="box-choose-photo">
        <Icon name="image" size={20} /> Choose from Photos
        <input
          ref={photosInput}
          class="hidden-input"
          type="file"
          accept="image/*"
          data-testid="box-file-photos"
          onChange={() => void onFile(photosInput.current)}
        />
      </label>
    </div>
  );

  return (
    <section data-testid="step-box">
      <h2>Photo of the box picture</h2>
      {error && (
        <Callout kind="bad" role="alert" testId="step-error">
          {error}
        </Callout>
      )}

      {phase.kind === 'choose' && (
        <>
          <p>Put the box lid flat on the table, picture up. Hold the phone above it so the whole picture fills most of the screen, then take the photo.</p>
          <ul class="small muted tips">
            <li>Avoid reflections of lamps or windows on the lid.</li>
            <li>The whole picture must be in the photo, all four corners.</li>
          </ul>
          {pickers}
        </>
      )}

      {phase.kind === 'working' && (
        <div class="card working" data-testid="box-working" aria-live="polite">
          <span class="spinner" aria-hidden="true" /> {phase.label}
        </div>
      )}

      {phase.kind === 'corners' && (
        <>
          <p>
            Drag the 4 dots onto the <strong>corners of the picture</strong>. Touch near a dot and slide; the magnifier shows where it is. The{' '}
            <strong>thick line</strong> is the top of the picture.
          </p>
          <CornerEditor src={phase.photoUrl} corners={phase.corners} onChange={onCornersChange} />
          <button class="btn btn-primary btn-block wizard-next" data-testid="box-straighten" onClick={() => void straighten(phase.corners)}>
            Straighten the picture
          </button>
          <button class="btn btn-block wizard-secondary" data-testid="box-retake" onClick={() => setPhase({ kind: 'choose' })}>
            Use a different photo
          </button>
        </>
      )}

      {phase.kind === 'done' && project.box && (
        <>
          <div class="rectified">
            {rectUrl ? (
              <img src={rectUrl} alt="Your box picture, straightened" data-testid="box-rectified" />
            ) : (
              <div class="box-thumb-empty muted">Loading picture…</div>
            )}
          </div>
          <p class="small muted" data-testid="box-shape">
            The picture is {project.box.width >= project.box.height ? 'wider than tall' : 'taller than wide'}.
          </p>
          <p>Is the whole picture there, the right way up, with no table showing at the edges?</p>
          <BorderQuestion
            answer={project.box.border ?? null}
            onAnswer={(border) => {
              void save({ box: { ...project.box!, border } }).catch((err) => setError(errorWords(err)));
              logInfo('wizard', `Box picture border answer: ${border}`);
            }}
            onAdjust={() => void adjust()}
          />
          <button
            class="btn btn-primary btn-block wizard-next"
            data-testid="wizard-next"
            onClick={() => void onNext().catch((err) => setError(errorWords(err)))}
          >
            Yes, looks right · Next
          </button>
          <div class="row two-up">
            <button class="btn" data-testid="box-turn" onClick={() => void turn()}>
              <Icon name="rotate" size={20} /> Turn picture
            </button>
            <button class="btn" data-testid="box-adjust" onClick={() => void adjust()}>
              Adjust corners
            </button>
          </div>
          <button class="btn btn-block wizard-secondary" data-testid="box-retake" onClick={() => setPhase({ kind: 'choose' })}>
            Take a different photo
          </button>
        </>
      )}
    </section>
  );
}

/**
 * "Does the box picture show exactly the puzzle?" (M4 box setup, RESEARCH §9): box art often has a
 * frame, or shows a little more or less of the scene than the puzzle. A frame is fixed by putting
 * the corners inside it; a small difference is measured and corrected later from the pieces.
 */
export function BorderQuestion({
  answer,
  onAnswer,
  onAdjust,
}: {
  answer: NonNullable<Project['box']>['border'] | null;
  onAnswer: (a: NonNullable<NonNullable<Project['box']>['border']>) => void;
  onAdjust: () => void;
}) {
  const options: Array<[NonNullable<NonNullable<Project['box']>['border']>, string]> = [
    ['exact', 'Yes, exactly the puzzle'],
    ['frame', 'It has a frame or white border'],
    ['differs', 'The box shows a bit more or less'],
    ['unsure', 'Not sure'],
  ];
  return (
    <div class="card border-question" data-testid="border-question">
      <p>
        <strong>Does this picture show exactly the puzzle?</strong>{' '}
        <span class="small muted">(compare with the picture on the side of the box, if it has one)</span>
      </p>
      <div class="chips">
        {options.map(([k, label]) => (
          <button key={k} class="chip border-chip" aria-pressed={answer === k} data-testid={`border-${k}`} onClick={() => onAnswer(k)}>
            {label}
          </button>
        ))}
      </div>
      {answer === 'frame' && (
        <p class="small" data-testid="border-advice">
          Put the 4 dots on the corners of the <strong>picture inside the frame</strong>, not on the frame.{' '}
          <button class="btn btn-small" data-testid="border-adjust" onClick={onAdjust}>
            Adjust corners
          </button>
        </p>
      )}
      {(answer === 'differs' || answer === 'unsure') && (
        <p class="small" data-testid="border-advice">
          No problem: once your first pieces are scanned, the app measures how the box picture lines up with the real pieces and offers a correction.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Step 3: grid
// ---------------------------------------------------------------------------------------------

function StepGrid({ project, save, onNext }: { project: Project; save: (patch: ProjectPatch) => Promise<Project>; onNext: () => Promise<void> }) {
  const aspect = project.box ? project.box.width / project.box.height : null;
  const options = topGrids(project.pieceCount, aspect, 3);
  const top = options[0];
  const chosen = project.grid ?? (top ? { cols: top.cols, rows: top.rows, source: 'suggested' as const } : null);
  const [manual, setManual] = useState(project.grid?.source === 'manual');
  const [cols, setCols] = useState(project.grid?.source === 'manual' ? String(project.grid.cols) : '');
  const [rows, setRows] = useState(project.grid?.source === 'manual' ? String(project.grid.rows) : '');
  const [error, setError] = useState<string | null>(null);

  const choose = async (g: { cols: number; rows: number; source: 'suggested' | 'manual' }) => {
    setError(null);
    try {
      await save({ grid: g });
    } catch (err) {
      logError('wizard', 'The grid could not be saved', err);
      setError(`Couldn't save: ${errorWords(err)}`);
    }
  };

  const useManual = async () => {
    const c = Number(cols);
    const r = Number(rows);
    const problem = checkManualGrid(c, r, project.pieceCount);
    if (problem) return setError(problem);
    await choose({ cols: c, rows: r, source: 'manual' });
  };

  const next = async () => {
    if (!chosen) return setError('Please choose a grid, or type one in.');
    try {
      if (!project.grid) await save({ grid: chosen });
      await onNext();
    } catch (err) {
      logError('wizard', 'The grid could not be saved', err);
      setError(`Couldn't save: ${errorWords(err)}`);
    }
  };

  return (
    <section data-testid="step-grid">
      <h2>How the pieces are laid out</h2>
      <p class="muted small">
        From the {project.pieceCount} pieces on the box and the picture's shape. Makers often cut a few more or fewer pieces than the box says: Ravensburger's
        1000-piece puzzles are really 36 × 28 = 1008.
      </p>
      {chosen ? (
        <div class="grid-choice card" data-testid="grid-chosen">
          <div class="grid-big">
            {chosen.cols} <span class="muted">across</span> × {chosen.rows} <span class="muted">down</span>
          </div>
          <div class="grid-sub">= {plural(chosen.cols * chosen.rows, 'piece')}</div>
          <div class="small muted">{project.grid ? (project.grid.source === 'manual' ? 'Typed in by you' : 'Chosen') : 'Best match'}</div>
        </div>
      ) : (
        <Callout kind="warn">No grid fits {project.pieceCount} pieces well. Please type one in below.</Callout>
      )}
      {options.length > 1 && (
        <>
          <p class="small muted">Other close matches:</p>
          <div class="choice-row" role="group" aria-label="Grid choices">
            {options.map((g) => (
              <button
                key={`${g.cols}x${g.rows}`}
                class="choice-chip"
                aria-pressed={!!chosen && chosen.cols === g.cols && chosen.rows === g.rows && chosen.source !== 'manual'}
                data-testid={`grid-option-${g.cols}x${g.rows}`}
                title={describeGrid(g)}
                onClick={() => void choose({ cols: g.cols, rows: g.rows, source: 'suggested' })}
              >
                {g.cols} × {g.rows} = {g.count}
              </button>
            ))}
          </div>
        </>
      )}
      {!manual ? (
        <button class="btn btn-small" data-testid="grid-manual-open" onClick={() => setManual(true)}>
          Type it in myself
        </button>
      ) : (
        <div class="card" data-testid="grid-manual">
          <div class="row two-up">
            <label class="field">
              <span>Across (along the width)</span>
              <input
                class="text-input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={cols}
                data-testid="grid-cols"
                onInput={(e) => setCols((e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 3))}
              />
            </label>
            <label class="field">
              <span>Down (along the height)</span>
              <input
                class="text-input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={rows}
                data-testid="grid-rows"
                onInput={(e) => setRows((e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 3))}
              />
            </label>
          </div>
          <button class="btn btn-block" data-testid="grid-manual-use" onClick={() => void useManual()}>
            Use these numbers
          </button>
        </div>
      )}
      {error && (
        <Callout kind="bad" role="alert" testId="step-error">
          {error}
        </Callout>
      )}
      <p class="small muted">The app checks the grid again later, as it finds edge pieces, and tells you if it looks wrong.</p>
      <button class="btn btn-primary btn-block wizard-next" data-testid="wizard-next" disabled={!chosen} onClick={() => void next()}>
        Next
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Step 4: print markers + ruler check
// ---------------------------------------------------------------------------------------------
// Step 4: printed markers or not (decision 2026-11-07: no printing is the default)
// ---------------------------------------------------------------------------------------------

function StepTracking({ onPieces, onMarkers }: { onPieces: () => void; onMarkers: () => void }) {
  return (
    <section data-testid="step-tracking">
      <h2>Ready to scan</h2>
      <p>
        No printing needed: the app uses <strong>the pieces themselves</strong> to know where each photo was taken. Spread your pieces face up on any table and
        scan them.
      </p>
      <button class="btn btn-primary btn-block" data-testid="finish-no-markers" onClick={onPieces}>
        Finish set-up
      </button>
      <details class="small" style={{ marginTop: '16px' }}>
        <summary>I have a printer and want extra precision</summary>
        <p class="muted">
          With 8 printed marker cards around the pieces, positions are a little more exact and the outlines can follow the pieces live. You can switch any time
          by starting a new puzzle.
        </p>
        <button class="btn btn-block" data-testid="use-markers" onClick={onMarkers}>
          Use printed markers instead
        </button>
      </details>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

function StepMarkers({ project, onNext }: { project: Project; onNext: () => Promise<void> }) {
  const [scale, setScale] = useState<number | null | undefined>(undefined);
  const [typing, setTyping] = useState(false);
  const [mm, setMm] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPrintScale(project.id)
      .then((s) => setScale(s))
      .catch((err) => {
        logError('wizard', 'The ruler check could not be read', err);
        setScale(null);
      });
  }, [project.id]);

  const store = async (value: number) => {
    setError(null);
    try {
      await setPrintScale(project.id, value);
      setScale(value);
      setTyping(false);
      logInfo('wizard', `Ruler check: bar measured ${(value * CHECK_BAR_MM).toFixed(1)} mm (print scale ${value.toFixed(3)})`);
    } catch (err) {
      logError('wizard', 'The ruler check could not be saved', err);
      setError(`Couldn't save: ${errorWords(err)}`);
    }
  };

  const saveTyped = () => {
    const v = Number(mm.replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0) return setError('Please type what the bar measures, in millimetres (for example 97).');
    if (v < 80 || v > 120) return setError(`${v} mm is far from 100 mm. Please measure the black bar again from the 0 to the 10 mark, in millimetres.`);
    void store(v / CHECK_BAR_MM);
  };

  const pct = scale ? Math.round(scale * 1000) / 10 : null;
  const off = scale ? Math.abs(scale - 1) > 0.01 : false;

  return (
    <section data-testid="step-markers">
      <h2>Print the markers</h2>
      <p>
        The app finds its way on your table with {MARKER_COUNT} printed markers on {SHEET_COUNT} A4 sheets. Print them on plain white paper.
      </p>
      <button class="btn btn-primary btn-block" data-testid="open-marker-sheets" onClick={() => go('markers', project.id)}>
        <Icon name="printer" size={20} /> Print marker sheets
      </button>
      <ul class="small muted tips">
        <li>
          On the next page tap <strong>Print</strong> and choose your printer. Set the size to <strong>100 %</strong> or <strong>Actual size</strong>, not "Fit
          to page".
        </li>
        <li>
          Printer not on the iPhone? Tap <strong>Send to my Mac</strong> there, choose AirDrop, and print the file from the Mac.
        </li>
      </ul>

      <h2>Check the size</h2>
      <p>
        Measure the black <strong>check bar</strong> on a printed sheet with a ruler. Does it measure exactly <strong>{CHECK_BAR_MM} mm</strong> (10 cm)?
      </p>
      {scale === undefined ? (
        <p class="muted">Loading…</p>
      ) : (
        <>
          {scale !== null && !typing && (
            <Callout kind={off ? 'warn' : 'good'} testId="print-scale-saved">
              {off ? (
                <>
                  <strong>Saved: the bar measures {(scale * CHECK_BAR_MM).toFixed(1).replace(/\.0$/, '')} mm</strong> (printed at {pct} %).
                  <p>
                    Best: print again with <strong>Actual size / 100 %</strong>. If you keep these sheets, the app corrects for it.
                  </p>
                </>
              ) : (
                <strong>Saved: printed at the right size</strong>
              )}
            </Callout>
          )}
          {!typing ? (
            <div class="row two-up">
              <button class="btn" data-testid="ruler-yes" aria-pressed={scale === 1} onClick={() => void store(1)}>
                Yes, {CHECK_BAR_MM} mm
              </button>
              <button class="btn" data-testid="ruler-no" onClick={() => setTyping(true)}>
                No, it measures…
              </button>
            </div>
          ) : (
            <div class="card">
              <label class="field">
                <span>The bar measures (mm)</span>
                <input
                  class="text-input big-number"
                  type="text"
                  inputMode="decimal"
                  placeholder="e.g. 97"
                  value={mm}
                  data-testid="ruler-mm"
                  onInput={(e) => setMm((e.target as HTMLInputElement).value.replace(/[^\d.,]/g, '').slice(0, 6))}
                />
              </label>
              <div class="row two-up">
                <button class="btn btn-primary" data-testid="ruler-save" onClick={saveTyped}>
                  Save
                </button>
                <button class="btn" onClick={() => setTyping(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {error && (
        <Callout kind="bad" role="alert" testId="step-error">
          {error}
        </Callout>
      )}
      <button
        class="btn btn-primary btn-block wizard-next"
        data-testid="wizard-next"
        disabled={!scale}
        onClick={() => void onNext().catch((err) => setError(errorWords(err)))}
      >
        Next
      </button>
      {!scale && scale !== undefined && <p class="small muted center">Measure the bar first, then tap Next.</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Printable marker sheets (#/markers/<projectId>)
// ---------------------------------------------------------------------------------------------

const PAGE_PRINT_CSS = `
${MARKER_SHEET_PRINT_CSS}
@media print {
  .app, .screen, .marker-sheets { padding: 0 !important; margin: 0 !important; max-width: none !important; background: ${PAPER.bg} !important; }
  .no-print, .banner { display: none !important; }
}
`;

export function MarkerSheetsScreen() {
  const projectId = routeArg.value;
  const [shareNote, setShareNote] = useState<{ url: string; name: string } | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const file = useRef<File | null>(null);

  const back = () => (projectId ? go('new', projectId) : go('home'));

  const print = () => {
    try {
      logInfo('markers', 'Print dialog opened for the marker sheets');
      window.print();
    } catch (err) {
      logError('markers', 'Printing could not start', err);
      setPrintError('Printing could not start here. Tap "Send to my Mac" and print from there.');
    }
  };

  const send = () => {
    file.current ??= new File([markerSheetsHtml()], 'Puzzle Lens marker sheets.html', { type: 'text/html' });
    const f = file.current;
    // FIRST thing in the tap (iOS ~5 s rule).
    void shareOrDownload(f, 'Puzzle Lens marker sheets').then((outcome) => {
      if (outcome.kind === 'download') {
        logWarn('markers', `Share menu not available, download offered instead (${outcome.reason})`);
        setShareNote({ url: outcome.url, name: f.name });
      } else if (outcome.kind === 'shared') logInfo('markers', 'Marker sheets shared');
    });
  };

  return (
    <main class="screen marker-sheets" data-testid="marker-sheets">
      <style>{PAGE_PRINT_CSS}</style>
      {/* The bar has the no-print class too: on paper only the sheets show, as before. */}
      <StepNavBar title="Marker sheets" backLabel={projectId ? 'Set-up' : 'Home'} onBack={back} backTestId="sheets-back" noPrint />
      <div class="no-print">
        <div class="row two-up">
          <button class="btn btn-primary" data-testid="print-sheets" onClick={print}>
            <Icon name="printer" size={20} /> Print
          </button>
          <button class="btn" data-testid="send-sheets" onClick={send}>
            Send to my Mac
          </button>
        </div>
        <p class="small muted">
          Print both pages at <strong>100 %</strong> ("Actual size"), on A4. If Print doesn't open, tap <strong>Send to my Mac</strong>, choose AirDrop (or
          Mail), and print from there. In Safari you can also use <strong>Share › Print</strong>.
        </p>
        {printError && (
          <Callout kind="bad" role="alert">
            {printError}
          </Callout>
        )}
        {shareNote && (
          <Callout kind="warn" role="alert">
            The Share menu didn't open.{' '}
            <a href={shareNote.url} download={shareNote.name} data-testid="download-sheets">
              Download the sheets
            </a>{' '}
            instead: the file goes to the Files app, in Downloads.
          </Callout>
        )}
      </div>
      {Array.from({ length: SHEET_COUNT }, (_, i) => (
        <div key={i} class="sheet-page" data-testid={`sheet-${i}`} dangerouslySetInnerHTML={{ __html: markerSheetSvg(i) }} />
      ))}
    </main>
  );
}
