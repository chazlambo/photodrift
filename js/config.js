// Logical render resolution. The canvas is drawn at this size and scaled by CSS,
// so the on-screen preview and the exported MP4 are pixel-identical.
export const LOGW = 1920;
export const LOGH = 1080;

// Tuned defaults (matches the look dialed in during design).
export const DEFAULTS = {
  density: 3,        // photos drifting at once
  timeOn: 15,        // avg seconds a photo is on screen
  depth: 0.6,        // parallax strength (near = faster, far = slower)
  spread: 100,       // % of width used horizontally
  minSize: 50,       // smallest photo, % of frame height
  maxSize: 80,       // largest photo, % of frame height
  imgOpacity: 100,   // flat photo opacity %
  radius: 10,        // corner radius (px in logical space)
  shadow: 60,        // drop-shadow strength %
  fade: 12,          // edge fade-in/out zone, % of height
  tilt: 0,           // max random tilt in degrees
  bg: '#070708',     // background colour
  vignette: false,   // darkened edges
  order: 'ordered',  // 'ordered' | 'shuffle'
  fps: 30,           // export frame rate
};

// Control schema -> the panel sliders/toggles are generated from this.
export const CONTROLS = [
  { group: 'Motion' },
  { id: 'density',    key: 'density',    label: 'Photos on screen at once', min: 1,  max: 16,  step: 1,    fmt: v => v },
  { id: 'timeOn',     key: 'timeOn',     label: 'Avg time on screen',       min: 3,  max: 25,  step: 0.5,  fmt: v => v.toFixed(1) + 's' },
  { id: 'depth',      key: 'depth',      label: 'Parallax depth',           min: 0,  max: 1,   step: 0.05, fmt: v => v.toFixed(2) },
  { id: 'spread',     key: 'spread',     label: 'Horizontal spread',        min: 20, max: 100, step: 1,    fmt: v => Math.round(v) + '%' },

  { group: 'Size & Look' },
  { id: 'minSize',    key: 'minSize',    label: 'Min size',   min: 6, max: 100, step: 1, fmt: v => Math.round(v) + '%', pair: 'max' },
  { id: 'maxSize',    key: 'maxSize',    label: 'Max size',   min: 6, max: 100, step: 1, fmt: v => Math.round(v) + '%', pair: 'min' },
  { id: 'imgOpacity', key: 'imgOpacity', label: 'Photo opacity', min: 40, max: 100, step: 1, fmt: v => Math.round(v) + '%' },
  { id: 'radius',     key: 'radius',     label: 'Corner radius', min: 0, max: 48, step: 1, fmt: v => Math.round(v) + 'px' },
  { id: 'shadow',     key: 'shadow',     label: 'Shadow',        min: 0, max: 100, step: 1, fmt: v => Math.round(v) + '%' },
  { id: 'fade',       key: 'fade',       label: 'Edge fade',     min: 0, max: 35, step: 1, fmt: v => Math.round(v) + '%' },
  { id: 'tilt',       key: 'tilt',       label: 'Subtle tilt',   min: 0, max: 8,  step: 0.5, fmt: v => v + '°' },

  { group: 'Background' },
  { id: 'bg',       key: 'bg',       label: 'Background colour', type: 'color' },
  { id: 'vignette', key: 'vignette', label: 'Vignette',          type: 'toggle' },
];

// Placeholder tiles shown before any photos are loaded.
const PH_ASPECTS = [[4,3],[3,4],[16,9],[1,1],[3,2],[2,3],[5,4],[9,16]];
const PH_COLORS = [
  ['#c2703f','#7a2f1c'],['#3f6cc2','#1c2f7a'],['#4fa37a','#1c5a3f'],['#b24fa3','#5a1c4f'],
  ['#c2a63f','#7a5f1c'],['#5f4fc2','#2c1c7a'],['#4fc2b6','#1c5a55'],['#c24f6c','#7a1c33'],
];
export function placeholderSet(){
  return PH_ASPECTS.map((a,i) => ({
    placeholder: true,
    aspect: a[0]/a[1],
    c: PH_COLORS[i % PH_COLORS.length],
    n: i+1,
  }));
}
