// Runs test/synth/preview.ts through Vite's module runner (TypeScript, no extra tools).
//   node test/synth/run-preview.mjs [outDir]
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

if (process.argv[2]) process.env.SYNTH_PREVIEW_DIR = process.argv[2];
await runnerImport(fileURLToPath(new URL('./preview.ts', import.meta.url)), { configFile: false, logLevel: 'warn' });
