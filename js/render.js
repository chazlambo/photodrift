import { LOGW, LOGH } from './config.js';
import { Simulation } from './sim.js';

// Single-thread core: no SharedArrayBuffer / cross-origin-isolation needed,
// so this works on plain static hosting (GitHub Pages). Swap to core-mt + a
// COOP/COEP service worker for ~2-4x faster encodes (see README).
// Single-thread core: no SharedArrayBuffer / cross-origin-isolation needed,
// so this works on plain static hosting (GitHub Pages). The ~30 MB core stays on
// a CDN (jsdelivr → unpkg fallback). The worker that imports it is vendored
// locally (see below), so it's same-origin and can importScripts these CDN URLs
// over CORS (jsdelivr/unpkg both send Access-Control-Allow-Origin: *).
const CORE_BASES = [
  'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd',
  'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd',
];

let ffmpeg = null;
let cancelFlag = false;

export function cancelRender(){ cancelFlag = true; }

// vendor/ffmpeg/ffmpeg.js (loaded by index.html) sets window.FFmpegWASM.
// We host @ffmpeg/ffmpeg's tiny shim + worker chunk ourselves on purpose:
//  - the FFmpeg class spawns its worker (814.ffmpeg.js) relative to where ffmpeg.js
//    loaded from; from a CDN that's a cross-origin Worker, which browsers forbid.
//    Vendored, the worker is same-origin and Just Works — no blob/classWorkerURL.
//  - we also avoid @ffmpeg/util entirely: its UMD bundle is mis-built (runs a
//    CommonJS require()/exports factory in the browser branch and throws), so it
//    never sets window.FFmpegUtil.
async function waitForGlobals(timeoutMs = 8000){
  const start = performance.now();
  while (!window.FFmpegWASM){
    if (performance.now() - start > timeoutMs){
      throw new Error('ffmpeg.wasm didn\'t load: window.FFmpegWASM missing (vendor/ffmpeg/ffmpeg.js failed to load).');
    }
    await new Promise(r => setTimeout(r, 100));
  }
}

function canvasToJpeg(canvas, quality){
  return new Promise((resolve,reject)=>{
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', quality);
  });
}

async function loadFFmpeg(onLog){
  if (ffmpeg && ffmpeg.loaded) return ffmpeg;
  await waitForGlobals();
  const { FFmpeg } = window.FFmpegWASM;

  // Try each CDN base in turn. A fresh FFmpeg instance per attempt so a failed
  // load doesn't leave a half-dead worker behind.
  let lastErr;
  for (const base of CORE_BASES){
    const inst = new FFmpeg();
    if (onLog) inst.on('log', ({ message }) => onLog(message));
    try {
      await inst.load({
        coreURL: `${base}/ffmpeg-core.js`,
        wasmURL: `${base}/ffmpeg-core.wasm`,
      });
      ffmpeg = inst;
      return ffmpeg;
    } catch (e){
      lastErr = e;
      try { inst.terminate?.(); } catch { /* ignore */ }
    }
  }
  throw new Error(`Couldn't load the ffmpeg core from any CDN: ${lastErr?.message || lastErr}`);
}

/**
 * Render an MP4 entirely in-browser.
 * @param {object} params  snapshot of the look settings
 * @param {function} getSet  returns the current image set
 * @param {function} onProgress  (0..1, phaseLabel)
 * @returns {Promise<Blob>} an MP4 blob
 */
export async function renderMP4(params, getSet, onProgress){
  cancelFlag = false;
  const fps = params.fps || 30;
  const P = { ...params };

  // estimate length the same way the UI does, plus a safety tail
  const n = getSet().length;
  const estimate = (n / Math.max(1,P.density)) * P.timeOn + P.timeOn;
  // +timeOn covers the staggered black-screen lead-in (photos drop in over
  // ~timeOn at the start). The frame loop still breaks early on allDone(), so
  // this larger cap only matters as a safety net — it never wastes frames.
  const maxFrames = Math.ceil((estimate + P.timeOn) * 1.5 * fps);

  const ff = await loadFFmpeg();
  onProgress(0.02, 'Preparing…');

  const canvas = document.createElement('canvas');
  canvas.width = LOGW; canvas.height = LOGH;
  const ctx = canvas.getContext('2d');

  const sim = new Simulation({ params: P, getSet, finite: true, seed: (Date.now() & 0xffffff) || 1 });

  // ---- phase 1: draw frames into ffmpeg's virtual filesystem ----
  let f = 0;
  for (; f < maxFrames; f++){
    if (cancelFlag) throw new Error('cancelled');
    sim.draw(ctx);
    const blob = await canvasToJpeg(canvas, 0.92);
    const buf = new Uint8Array(await blob.arrayBuffer());
    await ff.writeFile(`f${String(f).padStart(5,'0')}.jpg`, buf);
    sim.step(1/fps);
    if (f % 3 === 0){
      onProgress(0.02 + (f/maxFrames) * 0.58, 'Drawing frames…');
      await new Promise(r => setTimeout(r)); // yield to keep UI responsive
    }
    if (sim.allDone() && f > fps) { f++; break; }
  }
  const frameCount = f;

  // ---- phase 2: encode with ffmpeg ----
  ff.on('progress', ({ progress }) => {
    if (progress >= 0 && progress <= 1) onProgress(0.6 + progress*0.38, 'Encoding MP4…');
  });

  await ff.exec([
    '-framerate', String(fps),
    '-i', 'f%05d.jpg',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'veryfast',
    '-crf', '18',
    '-movflags', '+faststart',
    'out.mp4',
  ]);

  onProgress(0.99, 'Finishing…');
  const data = await ff.readFile('out.mp4');
  const mp4 = new Blob([data.buffer], { type: 'video/mp4' });

  // cleanup so a second render starts fresh / frees memory
  try {
    for (let i=0;i<frameCount;i++) await ff.deleteFile(`f${String(i).padStart(5,'0')}.jpg`);
    await ff.deleteFile('out.mp4');
  } catch (e) { /* non-fatal */ }

  onProgress(1, 'Done');
  return mp4;
}
