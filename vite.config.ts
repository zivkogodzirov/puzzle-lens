import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

// The app is published at https://zivkogodzirov.github.io/puzzle-lens/
const BASE = '/puzzle-lens/';

function appVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
  let sha = (process.env.GITHUB_SHA ?? '').slice(0, 7);
  if (!sha) {
    try {
      sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      sha = 'dev';
    }
  }
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return `${pkg.version}+${sha} (${stamp} UTC)`;
}

export default defineConfig({
  base: BASE,
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'prompt', // we show our own "Update available" banner
      injectRegister: false,
      includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon.svg'],
      manifest: {
        name: 'Puzzle Lens',
        short_name: 'Puzzle Lens',
        description: 'Helps you assemble big jigsaw puzzles with your iPhone camera.',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        orientation: 'any',
        background_color: '#101418',
        theme_color: '#101418',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,wasm,png,svg,ico,webmanifest}'],
        // Workbox skips files over 2 MiB by default; OpenCV's WASM is bigger (RESEARCH §14).
        maximumFileSizeToCacheInBytes: 64 * 1024 * 1024,
        navigateFallback: `${BASE}index.html`,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  worker: { format: 'es' },
  build: {
    target: 'safari18',
    sourcemap: true,
    chunkSizeWarningLimit: 2048,
  },
  server: {
    // Cloudflare Quick Tunnel for quick on-phone debugging (RESEARCH §15)
    allowedHosts: ['.trycloudflare.com'],
    fs: {
      // Never serve your own puzzle photos through the dev server or a tunnel.
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/test/fixtures/real/**'],
    },
  },
  preview: { allowedHosts: ['.trycloudflare.com'] },
});
