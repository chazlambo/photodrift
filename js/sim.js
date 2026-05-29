import { LOGW, LOGH } from './config.js';

// Placement avoids letting any photo stay covered by more than this fraction of
// its area for much of its time on screen. Lower = stricter (photos kept clearer),
// but with big photos + high density there may be no fully-clear spot to find.
const COVER_HEAVY = 0.6;

// Small seedable RNG so an export is reproducible.
function mulberry32(a){
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function clamp(v,a,b){ return v < a ? a : v > b ? b : v; }

function roundRectPath(ctx,x,y,w,h,r){
  r = Math.min(r, w/2, h/2);
  if (ctx.roundRect){ ctx.beginPath(); ctx.roundRect(x,y,w,h,r); return; }
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}

// draw an image with object-fit: cover into (dx,dy,dw,dh)
function drawCover(ctx,img,dx,dy,dw,dh){
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const ir = iw/ih, dr = dw/dh;
  let sx,sy,sw,sh;
  if (ir > dr){ sh = ih; sw = ih*dr; sx = (iw-sw)/2; sy = 0; }
  else        { sw = iw; sh = iw/dr; sx = 0; sy = (ih-sh)/2; }
  ctx.drawImage(img, sx,sy,sw,sh, dx,dy,dw,dh);
}

export class Simulation {
  // params: live params object (preview) or a snapshot (export)
  // getSet: () => array of image descriptors {placeholder|imgEl,w,h,aspect,...}
  // finite: true for export (each photo shown once, then ends)
  constructor({ params, getSet, finite = false, seed = 1 }){
    this.P = params;
    this.getSet = getSet;
    this.finite = finite;
    this.rng = mulberry32(seed);
    this._grain = null;
    this.reset();
  }

  reset(){
    const set = this.getSet();
    const order = this.P.order === 'shuffle'
      ? this._shuffle(set.map((_,i)=>i))
      : set.map((_,i)=>i);
    this.order = order;
    this.queue = order.slice();   // finite: consumed; infinite: refilled
    this.seqPtr = 0;
    this.particles = [];
    const n = Math.max(1, Math.round(this.P.density));
    for (let i=0;i<n;i++){
      const p = {};
      this.particles.push(p);
      this._spawn(p, true);
    }
  }

  _shuffle(arr){
    const a = arr.slice();
    for (let i=a.length-1;i>0;i--){ const j = Math.floor(this.rng()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
    return a;
  }

  _nextIndex(){
    if (this.finite){
      if (this.queue.length === 0) return -1;
      return this.queue.shift();
    }
    if (this.order.length === 0) return 0;
    const idx = this.order[this.seqPtr % this.order.length];
    this.seqPtr++;
    if (this.seqPtr % this.order.length === 0 && this.P.order === 'shuffle'){
      this.order = this._shuffle(this.order);
    }
    return idx;
  }

  _rand(a,b){ return a + this.rng()*(b-a); }

  // How much would a candidate photo (at cx,cy, size w×h, moving at vNew) be
  // entangled with the photos already on screen, projected over its whole descent?
  // Returns a cost in ~[0,1.3]: 0 = stays clear, higher = heavily/persistently
  // overlapping some other photo. Because motion is deterministic (constant speed,
  // fixed x), we can just march time forward and measure the overlap.
  _overlapCost(self, cx, cy, w, h, vNew){
    const SAMPLES = 16;
    const HEAVY = COVER_HEAVY;                 // overlap fraction we call "covered"
    const T = (LOGH + h) / Math.max(1, vNew);  // seconds until this photo exits
    let worst = 0;
    for (const o of this.particles){
      if (o === self || o.dead || o.w === undefined) continue;
      // x never changes, so horizontal overlap is constant — if none, they can
      // never cover each other, no matter the timing.
      const ox = Math.min(cx + w, o.x + o.w) - Math.max(cx, o.x);
      if (ox <= 0) continue;
      const minArea = Math.min(w * h, o.w * o.h);
      let heavyHits = 0, sumFrac = 0;
      for (let s = 0; s < SAMPLES; s++){
        const t = T * s / (SAMPLES - 1);
        const ny = cy + vNew * t;
        const oy = o.y + o.speed * t;
        const oy2 = Math.min(ny + h, oy + o.h) - Math.max(ny, oy); // vertical overlap
        if (oy2 <= 0) continue;
        const frac = (ox * oy2) / minArea;     // fraction of the smaller photo hidden
        sumFrac += frac;
        if (frac > HEAVY) heavyHits++;
      }
      // mostly: time-fraction spent heavily covered; plus a nudge toward generally
      // clearer spots via the average overlap.
      const cost = heavyHits / SAMPLES + 0.3 * (sumFrac / SAMPLES);
      if (cost > worst) worst = cost;
    }
    return worst;
  }

  // best-candidate placement: try several spots, keep the one that stays clearest
  // of the other photos across its entire travel (not just at spawn time).
  _choosePos(self,w,h,randomY,vNew){
    const P = this.P;
    const margin = LOGW*(1 - P.spread/100)/2;
    const xlo = Math.min(margin, LOGW - w - margin);
    const xhi = Math.max(margin, LOGW - w - margin);
    let best = null, bestCost = Infinity;
    for (let i=0;i<28;i++){
      const cx = this._rand(xlo, xhi);
      const cy = randomY ? this._rand(-h*0.5, LOGH - h*0.3) : -h - this._rand(0, h*0.4);
      // small random tiebreak so equally-clear spots still vary naturally
      const cost = this._overlapCost(self, cx, cy, w, h, vNew) + this._rand(0, 0.02);
      if (cost < bestCost){ bestCost = cost; best = { x:cx, y:cy }; }
    }
    return best || { x:this._rand(xlo,xhi), y: randomY ? this._rand(0,LOGH) : -h };
  }

  _spawn(p, randomY){
    const set = this.getSet();
    const idx = this._nextIndex();
    if (idx < 0){ p.dead = true; return; }
    const item = set[idx];
    const aspect = item.placeholder ? item.aspect : (item.w/item.h);
    const P = this.P;
    const d = this.rng();                                   // 0 far .. 1 near
    const lo = Math.min(P.minSize, P.maxSize), hi = Math.max(P.minSize, P.maxSize);
    const h = LOGH * ((lo + (hi-lo)*d) / 100);
    const w = h * aspect;
    const travel = LOGH + h;
    const speed = (travel / P.timeOn) * (1 + (d-0.5)*1.6*P.depth);
    p.item = item; p.idx = idx; p.w = w; p.h = h; p.d = d; p.dead = false; p.speed = speed;
    const pos = this._choosePos(p, w, h, randomY, speed);   // needs speed to project travel
    p.x = pos.x; p.y = pos.y;
    p.opacityBase = P.imgOpacity / 100;
    p.tilt = P.tilt ? this._rand(-P.tilt, P.tilt) : 0;
  }

  step(dt){
    const P = this.P;
    const fadePx = LOGH * (P.fade/100);
    for (const p of this.particles){
      if (p.dead) continue;
      p.y += p.speed * dt;
      if (p.y > LOGH){
        if (this.finite && this.queue.length === 0){ p.dead = true; continue; }
        this._spawn(p, false);
        continue;
      }
      let op = this.P.imgOpacity / 100;
      if (fadePx > 0){
        if (p.y < 0) op *= clamp((p.y + p.h)/fadePx, 0, 1);
        const distBottom = LOGH - p.y;
        if (distBottom < fadePx) op *= clamp(distBottom/fadePx, 0, 1);
      }
      p.opacity = op;
    }
  }

  allDone(){
    return this.finite && this.queue.length === 0 && this.particles.every(p => p.dead);
  }

  // grow/shrink the live particle count to match density
  ensureCount(){
    const target = Math.max(1, Math.round(this.P.density));
    while (this.particles.length < target){ const p = {}; this.particles.push(p); this._spawn(p, true); }
    while (this.particles.length > target){ this.particles.pop(); }
  }

  // recompute geometry/speed of living particles from current params (keeps depth + position)
  refresh(){
    const P = this.P;
    for (const p of this.particles){
      if (p.dead || !p.item) continue;
      const aspect = p.item.placeholder ? p.item.aspect : (p.item.w/p.item.h);
      const lo = Math.min(P.minSize,P.maxSize), hi = Math.max(P.minSize,P.maxSize);
      p.h = LOGH * ((lo + (hi-lo)*p.d) / 100);
      p.w = p.h * aspect;
      p.speed = ((LOGH + p.h) / P.timeOn) * (1 + (p.d-0.5)*1.6*P.depth);
      const margin = LOGW*(1 - P.spread/100)/2;
      const xlo = Math.min(margin, LOGW - p.w - margin), xhi = Math.max(margin, LOGW - p.w - margin);
      p.x = clamp(p.x, xlo, xhi);
      if (P.tilt === 0) p.tilt = 0;
    }
  }

  // refresh the play order (e.g. after reordering or toggling shuffle)
  rebuildOrder(){
    const set = this.getSet();
    this.order = this.P.order === 'shuffle'
      ? this._shuffle(set.map((_,i)=>i))
      : set.map((_,i)=>i);
    this.seqPtr = 0;
  }

  onScreenCount(){
    let n = 0;
    for (const p of this.particles){
      if (!p.dead && p.y < LOGH && p.y + p.h > 0) n++;
    }
    return n;
  }

  _grainPattern(ctx){
    if (this._grain) return this._grain;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const img = g.createImageData(128,128);
    for (let i=0;i<img.data.length;i+=4){
      const v = (Math.random()*255)|0;
      img.data[i]=img.data[i+1]=img.data[i+2]=v; img.data[i+3]=255;
    }
    g.putImageData(img,0,0);
    this._grain = ctx.createPattern(c,'repeat');
    return this._grain;
  }

  draw(ctx){
    const P = this.P;
    ctx.fillStyle = P.bg;
    ctx.fillRect(0,0,LOGW,LOGH);

    for (const p of this.particles){
      if (p.dead || p.opacity <= 0) continue;
      ctx.save();
      ctx.globalAlpha = clamp(p.opacity, 0, 1);
      ctx.translate(p.x + p.w/2, p.y + p.h/2);
      if (p.tilt) ctx.rotate(p.tilt * Math.PI/180);

      if (P.shadow > 0){
        const sh = P.shadow/100;
        ctx.save();
        ctx.shadowColor = `rgba(0,0,0,${0.55*sh + 0.15})`;
        ctx.shadowBlur = 70*sh;
        ctx.shadowOffsetY = 28*sh;
        roundRectPath(ctx, -p.w/2, -p.h/2, p.w, p.h, P.radius);
        ctx.fillStyle = '#000';
        ctx.fill();
        ctx.restore();
      }

      roundRectPath(ctx, -p.w/2, -p.h/2, p.w, p.h, P.radius);
      ctx.clip();
      const item = p.item;
      if (item.placeholder){
        const grad = ctx.createLinearGradient(-p.w/2,-p.h/2,p.w/2,p.h/2);
        grad.addColorStop(0, item.c[0]); grad.addColorStop(1, item.c[1]);
        ctx.fillStyle = grad;
        ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);
        ctx.globalAlpha = clamp(p.opacity,0,1)*0.5;
        ctx.fillStyle = '#fff';
        ctx.font = `${Math.round(p.h*0.18)}px "DM Mono", monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(item.n).padStart(2,'0'), 0, 0);
      } else if (item.imgEl){
        drawCover(ctx, item.imgEl, -p.w/2, -p.h/2, p.w, p.h);
      }
      ctx.restore();
    }

    // subtle film grain
    ctx.save();
    ctx.globalAlpha = 0.04;
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = this._grainPattern(ctx);
    ctx.fillRect(0,0,LOGW,LOGH);
    ctx.restore();

    if (P.vignette){
      const g = ctx.createRadialGradient(LOGW/2,LOGH/2,LOGH*0.35, LOGW/2,LOGH/2,LOGH*0.95);
      g.addColorStop(0,'rgba(0,0,0,0)');
      g.addColorStop(1,'rgba(0,0,0,0.55)');
      ctx.fillStyle = g;
      ctx.fillRect(0,0,LOGW,LOGH);
    }
  }
}
