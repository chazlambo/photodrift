import { LOGW, LOGH, DEFAULTS, CONTROLS, placeholderSet } from './config.js';
import { Simulation } from './sim.js';
import { renderMP4, cancelRender } from './render.js';

const $ = id => document.getElementById(id);

const P = { ...DEFAULTS };
let images = [];                 // user photos: {src,w,h,imgEl}
let activeSet = placeholderSet();
const getSet = () => (images.length ? images : activeSet);

const canvas = $('stage');
const ctx = canvas.getContext('2d');
const sim = new Simulation({ params: P, getSet, finite: false, seed: (Math.random()*1e6)|0 });

let playing = true;
let lastT = 0;
let rendering = false;

/* ---------------- preview loop ---------------- */
function loop(t){
  if (!lastT) lastT = t;
  let dt = (t - lastT)/1000; lastT = t;
  if (dt > 0.1) dt = 0.1;
  if (playing && !rendering){
    sim.step(dt);
    sim.draw(ctx);
    $('liveCount').textContent = sim.onScreenCount();
  }
  requestAnimationFrame(loop);
}

/* ---------------- controls ---------------- */
function buildControls(){
  const host = $('controls');
  for (const c of CONTROLS){
    if (c.group){
      const h = document.createElement('div'); h.className = 'group';
      h.innerHTML = `<h2>${c.group}</h2>`;
      host.appendChild(h);
      continue;
    }
    if (c.type === 'color'){
      const row = document.createElement('div'); row.className = 'switch';
      row.innerHTML = `<span>${c.label}</span><input type="color" value="${P[c.key]}">`;
      row.querySelector('input').addEventListener('input', e => { P[c.key] = e.target.value; });
      host.appendChild(row);
    } else if (c.type === 'toggle'){
      const row = document.createElement('div'); row.className = 'switch';
      row.innerHTML = `<span>${c.label}</span><div class="toggle${P[c.key]?' on':''}"></div>`;
      const t = row.querySelector('.toggle');
      t.addEventListener('click', () => { P[c.key] = !P[c.key]; t.classList.toggle('on', P[c.key]); });
      host.appendChild(row);
    } else {
      const wrap = document.createElement('div'); wrap.className = 'ctrl';
      wrap.innerHTML =
        `<label>${c.label} <span class="val">${c.fmt(P[c.key])}</span></label>
         <input type="range" min="${c.min}" max="${c.max}" step="${c.step}" value="${P[c.key]}">`;
      const input = wrap.querySelector('input');
      const out = wrap.querySelector('.val');
      input.dataset.key = c.key;
      input.addEventListener('input', () => {
        let v = parseFloat(input.value);
        P[c.key] = v;
        // couple min/max size so they can't cross
        if (c.pair === 'max' && P.minSize > P.maxSize){ P.maxSize = P.minSize; syncSlider('maxSize'); }
        if (c.pair === 'min' && P.maxSize < P.minSize){ P.minSize = P.maxSize; syncSlider('minSize'); }
        out.textContent = c.fmt(P[c.key]);
        onParamChange(c.key);
      });
      host.appendChild(wrap);
    }
  }
}

function syncSlider(key){
  const el = document.querySelector(`input[data-key="${key}"]`);
  if (!el) return;
  el.value = P[key];
  const def = CONTROLS.find(c => c.id === key);
  const out = el.closest('.ctrl').querySelector('.val');
  if (def && out) out.textContent = def.fmt(P[key]);
}

// which params change spawn geometry vs. are read live at draw time
const GEOMETRY_KEYS = new Set(['timeOn','depth','spread','minSize','maxSize','tilt']);
function onParamChange(key){
  if (key === 'density') sim.ensureCount();
  else if (GEOMETRY_KEYS.has(key)) sim.refresh();
  updateDuration();
}

/* ---------------- duration estimate ---------------- */
function updateDuration(){
  const n = getSet().length;
  const secs = (n / Math.max(1,P.density)) * P.timeOn + P.timeOn;
  const mm = Math.floor(secs/60), ss = Math.round(secs%60);
  $('durBig').textContent = mm > 0 ? `${mm}:${String(ss).padStart(2,'0')}` : `${ss}s`;
  $('durSub').textContent = `${n} photo${n!==1?'s':''}, each shown once · ${Math.round(P.density)} at a time`;
  $('imgCount').textContent = n;
}

/* ---------------- file loading ---------------- */
function loadFiles(fileList){
  const files = [...fileList].filter(f => f.type.startsWith('image/'));
  if (!files.length) return;
  $('drop').querySelector('strong').textContent = `Loading ${files.length} photo${files.length!==1?'s':''}…`;
  let pending = files.length;
  const loaded = new Array(files.length);
  const done = () => { if (--pending === 0) applyImages(loaded.filter(Boolean)); };
  files.forEach((f,i) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const img = new Image();
      img.onload  = () => { loaded[i] = { src:dataUrl, w:img.naturalWidth||1200,  h:img.naturalHeight||800,  imgEl:img }; done(); };
      img.onerror = () => { loaded[i] = { src:dataUrl, w:1200, h:800, imgEl:img }; done(); };
      img.src = dataUrl;
    };
    reader.onerror = done;
    reader.readAsDataURL(f);
  });
}

function applyImages(loaded){
  images = loaded;
  activeSet = images.length ? images : placeholderSet();
  sim.rebuildOrder();
  sim.reset();
  renderThumbs();
  updateDuration();
  const d = $('drop');
  d.querySelector('strong').textContent = `${images.length} photo${images.length!==1?'s':''} loaded ✓`;
  d.querySelector('span').textContent = 'click to replace';
  $('thumbsWrap').hidden = images.length === 0;
}

/* ---------------- thumbnails + drag reorder ---------------- */
let dragIdx = null;
function renderThumbs(){
  const host = $('thumbs');
  host.innerHTML = '';
  images.forEach((im, i) => {
    const t = document.createElement('div');
    t.className = 'thumb'; t.draggable = true; t.dataset.i = i;
    t.innerHTML = `<img src="${im.src}" alt=""><span class="num">${i+1}</span>`;
    t.addEventListener('dragstart', () => { dragIdx = i; t.classList.add('dragging'); });
    t.addEventListener('dragend',   () => { dragIdx = null; t.classList.remove('dragging'); document.querySelectorAll('.thumb.over').forEach(e=>e.classList.remove('over')); });
    t.addEventListener('dragover', e => { e.preventDefault(); t.classList.add('over'); });
    t.addEventListener('dragleave', () => t.classList.remove('over'));
    t.addEventListener('drop', e => {
      e.preventDefault();
      const to = i;
      if (dragIdx === null || dragIdx === to) return;
      const [moved] = images.splice(dragIdx, 1);
      images.splice(to, 0, moved);
      activeSet = images;
      sim.rebuildOrder();
      renderThumbs();
    });
    host.appendChild(t);
  });
}

/* ---------------- order toggle ---------------- */
$('orderSeg').addEventListener('click', e => {
  const btn = e.target.closest('button'); if (!btn) return;
  P.order = btn.dataset.order;
  [...e.currentTarget.children].forEach(b => b.classList.toggle('active', b === btn));
  sim.rebuildOrder();
});

/* ---------------- transport ---------------- */
$('playBtn').addEventListener('click', () => {
  playing = !playing;
  $('playIcon').innerHTML = playing
    ? '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>'
    : '<path d="M8 5v14l11-7z"/>';
  if (playing) lastT = 0;
});
$('restartBtn').addEventListener('click', () => { sim.rebuildOrder(); sim.reset(); });
$('presentBtn').addEventListener('click', () => $('app').classList.toggle('present'));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') $('app').classList.remove('present');
  if (e.code === 'Space' && e.target.tagName !== 'INPUT'){ e.preventDefault(); $('playBtn').click(); }
});

/* ---------------- file inputs ---------------- */
const drop = $('drop'), fileInput = $('fileInput');
drop.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => loadFiles(e.target.files));
['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => { if (e.dataTransfer.files.length) loadFiles(e.dataTransfer.files); });

/* ---------------- export ---------------- */
const renderBtn = $('renderBtn'), overlay = $('renderOverlay');
const roFill = $('roFill'), roPct = $('roPct'), roLabel = $('roLabel'), dlLink = $('dlLink');

function setProgress(p, label){
  roFill.style.width = Math.round(p*100) + '%';
  roPct.textContent = Math.round(p*100) + '%';
  if (label) roLabel.textContent = label;
}

renderBtn.addEventListener('click', async () => {
  if (rendering) return;
  rendering = true;
  overlay.hidden = false;
  renderBtn.disabled = true;
  setProgress(0, 'Loading engine…');
  try {
    const blob = await renderMP4({ ...P }, getSet, setProgress);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'photodrift.mp4';
    document.body.appendChild(a); a.click(); a.remove();
    dlLink.href = url; dlLink.hidden = false;
  } catch (err){
    if (err && err.message === 'cancelled'){ /* user cancelled */ }
    else { roLabel.textContent = 'Export failed'; console.error(err); alert('Export failed: ' + (err?.message || err)); }
  } finally {
    rendering = false;
    renderBtn.disabled = false;
    overlay.hidden = true;
    lastT = 0;
  }
});
$('roCancel').addEventListener('click', () => cancelRender());

/* ---------------- init ---------------- */
buildControls();
updateDuration();
sim.draw(ctx);
requestAnimationFrame(loop);
