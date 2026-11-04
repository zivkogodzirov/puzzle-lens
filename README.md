# Puzzle Lens

An iPhone web app that helps you assemble big (1000+ piece) jigsaw puzzles with your camera. You point the phone at pieces on your table, and the app catalogs them, works out where each one goes on the box picture and which pieces join, and highlights them live on the camera view.

**Status:** Milestone 1 (skeleton): camera, Snap (full-resolution photo), Device check, performance display, report export. See [`docs/PLAN.md`](docs/PLAN.md) for the plan and progress.

- **Use it:** open https://zivkogodzirov.github.io/puzzle-lens/ in Safari on an iPhone, then Share → **Add to Home Screen**.
- **Privacy:** everything runs on the phone. No accounts, no server. Photos never leave the phone unless you share a report yourself.

## For developers

```bash
npm install
npm run dev          # local dev server (HTTPS needed for the camera on a phone; see docs/RESEARCH.md §15)
npm run typecheck
npm test             # unit tests (Node, real OpenCV build)
npm run test:leak    # 10 simulated minutes of live camera: memory must stay flat
npm run test:e2e     # Playwright WebKit with a simulated camera
npm run build
```

- **Vision engine:** a custom OpenCV.js 4.14 build in `vendor/opencv/` (WebAssembly with SIMD, ES module, native exceptions). To rebuild it, see `scripts/build-opencv.sh` and `vendor/opencv/BUILD-INFO.txt`.
- **Deployment:** `.github/workflows/deploy.yml` tests every push to `main` and deploys it to GitHub Pages. Until that workflow is pushed (the GitHub login needs the `workflow` permission), the site is published from the `gh-pages` branch: `npm run build`, then push `dist/` (plus an empty `.nojekyll`) to `gh-pages`. When the workflow is in, switch Pages to "GitHub Actions": `gh api -X PUT repos/zivkogodzirov/puzzle-lens/pages -f build_type=workflow`.
- **Documents:** [`docs/BRIEF.md`](docs/BRIEF.md) (requirements), [`docs/RESEARCH.md`](docs/RESEARCH.md) (research and decisions), [`docs/PLAN.md`](docs/PLAN.md) (plan and status), [`CHANGELOG.md`](CHANGELOG.md).

## Licence

All rights reserved for now. OpenCV is Apache-2.0 (`vendor/opencv/`).
