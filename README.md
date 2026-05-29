# Photodrift

Turn a folder of photos into a slow, parallax **drifting backdrop** video — the kind of ambient, layered motion you'd want behind end credits or on an idle screen. Photos float down the frame at different sizes and speeds, then it exports to a clean MP4.

**Everything runs in your browser.** Your photos are never uploaded anywhere — there is no server, no account, and no storage. The MP4 is encoded locally with [ffmpeg.wasm](https://ffmpegwasm.netlify.app/).

## Features

- Live, WYSIWYG preview — the canvas you tune is the exact frame that gets exported
- Tunable drift: count on screen, average time on screen, parallax depth, size range, spread, corner radius, shadow, edge fade, tilt, background, vignette
- Drag-to-reorder thumbnails, plus an **In order / Shuffle** toggle
- One-click **MP4 export**, rendered frame-by-frame (no real-time screen recording, no dropped frames)
- Presentation mode for a clean full-frame view

## Run locally

It's plain static files — any static server works:

```bash
# pick one
npx serve .
python3 -m http.server 8080
```

Then open the printed URL. (Opening `index.html` via `file://` won't work because ES modules need `http`.)

## Deploy (auto)

This repo ships a GitHub Actions workflow that publishes the site on every push to `main`.

1. Push the repo to GitHub.
2. In **Settings → Pages**, set **Source: GitHub Actions**.
3. Push to `main` — the site builds and deploys automatically. The live URL appears in the Actions run summary.

No build step, no secrets, no server.

## How the MP4 export works

The app draws every frame to an offscreen 1920×1080 canvas, hands the frames to ffmpeg.wasm running in your browser, and encodes H.264. Because it's offline (not a real-time capture), the result is frame-perfect.

It uses the **single-threaded** ffmpeg core, which needs no `SharedArrayBuffer` and therefore no special COOP/COEP headers — that's why it works on GitHub Pages with zero configuration. The tradeoff is encoding speed.

### Optional: faster exports (multi-threaded core)

For roughly 2–4× faster encoding, switch to the multi-threaded core (`@ffmpeg/core-mt`). It requires cross-origin isolation, which GitHub Pages can't set via headers — so add a client-side service worker that injects them ([`coi-serviceworker`](https://github.com/gzuidhof/coi-serviceworker)):

1. Drop `coi-serviceworker.min.js` in the repo root and load it first in `index.html`.
2. In `js/render.js`, change `CORE_BASE` to the `core-mt` build and pass a `workerURL` to `ffmpeg.load(...)`.

Note that cross-origin isolation can affect loading of other cross-origin resources (e.g. fonts), so test before committing.

### Tips & limits

- The first export downloads the ~25 MB ffmpeg engine (cached afterward).
- Frames are held in memory during encoding, so very long videos (many minutes) can hit WebAssembly's memory ceiling. Keep clips reasonable, or lower the export FPS in `js/config.js`.

## Project layout

```
index.html              # shell + loads ffmpeg.wasm (UMD) from CDN
css/styles.css          # styling
js/config.js            # dimensions, defaults, control schema, placeholders
js/sim.js               # deterministic particle simulation + canvas drawing
js/render.js            # ffmpeg.wasm MP4 export
js/app.js               # preview loop, controls, thumbnails, export wiring
.github/workflows/      # GitHub Pages auto-deploy
```

## License

MIT — see [LICENSE](./LICENSE). ffmpeg.wasm and the FFmpeg core are distributed under their own licenses.
