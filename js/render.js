import { LOGW, LOGH } from './config.js';
import { Simulation } from './sim.js';

// Single-thread core: no SharedArrayBuffer / cross-origin-isolation needed,
// so this works on plain static hosting (GitHub Pages). Swap to core-mt + a
// COOP/COEP service worker for ~2-4x faster encodes (see README).
const CORE_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';

let ffmpeg = null;
let cancelFlag = false;

export function cancelRender(){ cancelFlag = true; }

function canvasToJpeg(canvas, quality){
  return new Promise((resolve,reject)=>{
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', quality);
  });
}

async function loadFFmpeg(onLog){
  if (ffmpeg && ffmpeg.loaded) return ffmpeg;
  if (!window.FFmpegWASM || !window.FFmpegUtil){
    throw new Error('ffmpeg.wasm failed to load from CDN — check your connection.');
  }
  const { FFmpeg } = window.FFmpegWASM;
  const { toBlobURL } = window.FFmpegUtil;
  ffmpeg = new FFmpeg();
  if (onLog) ffmpeg.on('log', ({ message }) => onLog(message));
  await ffmpeg.load({
    coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  return ffmpeg;
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
  const maxFrames = Math.ceil(estimate * 1.5 * fps);

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
