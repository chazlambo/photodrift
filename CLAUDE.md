# Photodrift — project context for Claude Code

Photodrift turns a folder of photos into a slow, parallax "drifting" video backdrop
(think end-credits / ambient screen) and exports a clean MP4. **It runs 100% in the
browser** — no server, no uploads. MP4 encoding happens locally via ffmpeg.wasm.

## How it works
- Live preview and the MP4 export share the SAME canvas draw code (`js/sim.js`), so
  the preview is exactly what gets encoded (WYSIWYG). Internal resolution is 1920×1080;
  the canvas is CSS-scaled to fit.
- Export draws every frame offline to an offscreen canvas, writes JPEGs into
  ffmpeg.wasm's virtual FS, then encodes H.264 — frame-perfect, not a real-time capture.
- Uses the SINGLE-THREADED ffmpeg core (`@ffmpeg/core`, UMD from CDN) on purpose: no
  SharedArrayBuffer, so no COOP/COEP headers needed → works on plain GitHub Pages.

## File map
- `index.html` — shell; loads ffmpeg.wasm UMD globals (`FFmpegWASM`, `FFmpegUtil`) from CDN
- `css/styles.css` — styling (dark cinematic; Instrument Serif + DM Mono + Bricolage Grotesque)
- `js/config.js` — `LOGW/LOGH`, `DEFAULTS`, `CONTROLS` schema, `placeholderSet()`
- `js/sim.js` — `Simulation` class: deterministic particle system + all canvas drawing
- `js/render.js` — `renderMP4()` ffmpeg.wasm export + `cancelRender()`
- `js/app.js` — preview loop, control generation, drag-reorder thumbnails, export wiring
- `.github/workflows/deploy.yml` — GitHub Pages auto-deploy on push to `main`

## Conventions
- Vanilla ES modules, no build step, no framework. Keep it that way unless asked.
- Panel controls are generated from the `CONTROLS` array in `config.js` — add/change a
  control there, not in HTML.
- Params live on the single `P` object in `app.js`. Draw-time params (radius, shadow,
  bg, vignette, fade, opacity) apply instantly; spawn-geometry params (size, time, depth,
  spread, tilt) call `sim.refresh()`; density calls `sim.ensureCount()`.
- No localStorage/sessionStorage anywhere.

## Run / deploy
- Local: `npx serve .` or `python3 -m http.server 8080` (needs http://, not file://).
- Deploy: push to `main`; in GitHub repo Settings → Pages set Source = "GitHub Actions".

## Known caveats
- First export downloads the ~25 MB ffmpeg engine (cached after).
- All frames sit in memory during encode, so very long clips can hit WASM's memory
  ceiling. Mitigate with lower `fps` in `config.js` or shorter clips.

## Likely next tasks
- Initialize git, push to a new GitHub repo, enable Pages (Actions source).
- Optional: hero/landing section above the tool, favicon + social share image, demo GIF.
- Optional speed-up: switch `render.js` to `@ffmpeg/core-mt` + add `coi-serviceworker`
  for cross-origin isolation (see README "faster exports").
