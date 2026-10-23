// Colours for the canvas map, read from the CSS theme; hatched fills for wishes and planned trips.
import { isDark } from './app-state.js';

function hatch(line, base, dark) {
  const c = document.createElement('canvas');
  const s = 7 * Math.min(2, window.devicePixelRatio || 1);
  c.width = c.height = s;
  const x = c.getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, s, s);
  x.strokeStyle = line; x.lineWidth = s * 0.28; x.lineCap = 'square';
  x.beginPath(); x.moveTo(-1, s + 1); x.lineTo(s + 1, -1); x.moveTo(-1, 1); x.lineTo(1, -1); x.moveTo(s - 1, s + 1); x.lineTo(s + 1, s - 1); x.stroke();
  return c;
}
let cache = null, cacheKey = '';
export function mapColors(ctx2d) {
  const key = isDark.value + document.documentElement.dataset.theme;
  if (cache && cacheKey === key) return cache;
  const cs = getComputedStyle(document.documentElement);
  const v = n => cs.getPropertyValue(n).trim();
  const dark = isDark.value;
  const land = v('--land');
  const ctx = ctx2d || document.createElement('canvas').getContext('2d');
  const wishPat = ctx.createPattern(hatch(v('--saffron'), land, dark), 'repeat');
  const planPat = ctx.createPattern(hatch(v('--visa'), land, dark), 'repeat');
  cache = {
    sea: v('--sea'), land, border: dark ? 'rgba(13,19,34,0.95)' : 'rgba(255,255,255,0.95)',
    visited: v('--visa'), lived: v('--emerald'), home: v('--carmine'), transit: v('--slate'), wish: v('--saffron'),
    wishFill: wishPat, planFill: planPat,
    highlight: dark ? '#FFFFFF' : '#1A2440', label: dark ? 'rgba(231,236,245,0.78)' : 'rgba(26,36,64,0.72)', labelHalo: dark ? 'rgba(13,19,34,0.8)' : 'rgba(237,242,241,0.85)',
    markerRing: dark ? '#0D1322' : '#FFFFFF', pin: dark ? '#E7ECF5' : '#1A2440', pinRing: dark ? '#0D1322' : '#FFFFFF', pinLabel: dark ? '#E7ECF5' : '#1A2440',
    graticule: dark ? 'rgba(255,255,255,0.07)' : 'rgba(26,36,64,0.08)', globeSea: dark ? '#111B31' : '#E2EAE9',
    glow: dark ? 'rgba(141,134,255,0.10)' : 'rgba(255,255,255,0.55)', rim: dark ? 'rgba(141,134,255,0.35)' : 'rgba(26,36,64,0.18)',
    dotNone: dark ? '#4A5675' : '#A8B4B3'
  };
  cacheKey = key;
  return cache;
}
/** the colour (or pattern) a status gets on the map */
export function statusFill(col, status, home) {
  if (home) return col.home;
  switch (status) {
    case 'visited': return col.visited;
    case 'lived': return col.lived;
    case 'transit': return col.transit;
    case 'planned': return col.planFill;
    case 'wish': return col.wishFill;
    default: return col.land;
  }
}
export function statusDot(col, status, home) {
  if (home) return col.home;
  return { visited: col.visited, lived: col.lived, transit: col.transit, planned: col.visited, wish: col.wish }[status] || col.dotNone;
}
