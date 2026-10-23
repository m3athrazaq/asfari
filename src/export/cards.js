// Images to share (story 1080×1920 or square 1080×1080): your map and numbers, or a year's summary.
import { loadWorld, C } from '../core/data.js';
import { drawFlatWorld, drawGlobe } from '../map/worldmap.js';
import { statusFill } from '../ui/mapcolors.js';
import { t, num, pct, unit, cname, lang, isAr, dig, count } from '../core/i18n.js';

const PALETTES = {
  light: { bg: '#EDF2F1', ink: '#1A2440', ink2: '#4C5873', accent: '#4B44C8', gold: '#C98A12', land: '#D3DCDB', sea: '#EDF2F1', border: 'rgba(255,255,255,0.95)', lived: '#13785A', home: '#C2362F', transit: '#7D8AA6', card: '#FFFFFF', rule: '#D2DCDB' },
  dark: { bg: '#0D1322', ink: '#E7ECF5', ink2: '#A7B1C8', accent: '#8D86FF', gold: '#F0BB49', land: '#2A3450', sea: '#0D1322', border: 'rgba(13,19,34,0.95)', lived: '#38C596', home: '#FF6B5E', transit: '#8794B3', card: '#161E33', rule: '#263049' }
};
async function fontsReady() {
  try {
    await Promise.all(['700 80px "Reem Kufi"', '500 40px "Reem Kufi"', '400 30px "Plex Arabic"', '700 30px "Plex Arabic"', '500 30px "Plex Arabic"'].map(f => document.fonts.load(f, 'أسفاري 123 abc')));
  } catch (e) { /* system fonts then */ }
}
const KUFI = (w, px) => `${w} ${px}px "Reem Kufi", "Plex Arabic", system-ui, sans-serif`;
const PLEX = (w, px) => `${w} ${px}px "Plex Arabic", system-ui, sans-serif`;

function textAt(ctx, s, x, y, { font, color, align = 'start', maxWidth } = {}) {
  ctx.font = font; ctx.fillStyle = color;
  ctx.direction = isAr.value ? 'rtl' : 'ltr';
  ctx.textAlign = align;
  ctx.fillText(s, x, y, maxWidth);
}
const toBlob = c => new Promise(r => c.toBlob(r, 'image/png'));

function mapFill(r, P) {
  const col = { visited: P.accent, lived: P.lived, home: P.home, transit: P.transit, land: P.land, planFill: P.land, wishFill: P.land };
  return cc => { const e = r.cs.get(cc); return e ? statusFill(col, e.status, e.home) : P.land; };
}

/** your map + numbers */
export async function shareCard(r, s, { format = 'story', dark = false } = {}) {
  await fontsReady();
  const P = dark ? PALETTES.dark : PALETTES.light;
  const W = 1080, H = format === 'story' ? 1920 : 1080;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = P.bg; ctx.fillRect(0, 0, W, H);
  const hi = await loadWorld('hi');
  const rtl = isAr.value;
  const sx = rtl ? W - 80 : 80;
  const name = s.profile.name;
  // title
  textAt(ctx, t('app_name'), sx, format === 'story' ? 190 : 130, { font: KUFI(700, 70), color: P.accent });
  textAt(ctx, name ? t('card_of', { name }) : t('card_title'), sx, format === 'story' ? 262 : 192, { font: PLEX(500, 40), color: P.ink2 });
  // map
  const mapTop = format === 'story' ? 360 : 240, mapH = format === 'story' ? 640 : 470;
  const mc = document.createElement('canvas'); mc.width = W; mc.height = mapH;
  drawFlatWorld(mc, { features: hi, width: W, height: mapH, pad: 20, colors: { land: P.land, border: P.border, sea: P.sea }, fill: mapFill(r, P),
    markers: r.counted.filter(x => x.area < 3000).map(x => ({ lon: x.lp[1], lat: x.lp[0], r: 6, color: P.accent })) });
  ctx.drawImage(mc, 0, mapTop);
  // numbers
  const stats = [
    [num(r.main.length), unit(r.main.length, 'country')],
    [pct(r.worldShare), t('of_world')],
    [num(r.contVisited) + '/7', unit(r.contVisited, 'continent')],
    [num(r.cityCount), unit(r.cityCount, 'city')]
  ];
  if (format === 'story') {
    stats.push([num(r.started.length), unit(r.started.length, 'trip')], [num(r.daysAbroad), t('card_days')]);
    const top = 1110, colW = (W - 160) / 2, rowH = 190;
    stats.forEach(([v, l], i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = rtl ? W - 80 - col * colW : 80 + col * colW;
      const y = top + row * rowH;
      ctx.fillStyle = P.rule; if (row) ctx.fillRect(rtl ? x - colW + 30 : x, y - 60, colW - 30, 2);
      textAt(ctx, v, x, y + 40, { font: KUFI(700, 96), color: i === 0 ? P.accent : P.ink });
      textAt(ctx, l, x, y + 92, { font: PLEX(500, 36), color: P.ink2 });
    });
  } else {
    const top = 820, colW = (W - 160) / 4;
    stats.forEach(([v, l], i) => {
      const x = rtl ? W - 80 - i * colW : 80 + i * colW;
      textAt(ctx, v, x, top + 30, { font: KUFI(700, 64), color: i === 0 ? P.accent : P.ink });
      textAt(ctx, l, x, top + 80, { font: PLEX(500, 28), color: P.ink2 });
    });
  }
  // flags strip
  const fw = 48, fh = 36, gap = 10;
  const perRow = Math.floor((W - 160 + gap) / (fw + gap));
  const rows = format === 'story' ? 3 : 1;
  const fy0 = format === 'story' ? 1660 : 960;
  const flags = r.counted.filter(x => !(r.cs.get(x.c) || {}).home).slice(0, perRow * rows);
  await Promise.all(flags.map((f, i) => new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const row = Math.floor(i / perRow), col = i % perRow;
      const x = rtl ? W - 80 - (col + 1) * (fw + gap) + gap : 80 + col * (fw + gap);
      const y = fy0 + row * (fh + gap);
      ctx.save(); ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, fw, fh, 5); else ctx.rect(x, y, fw, fh);
      ctx.clip(); ctx.drawImage(img, x, y, fw, fh); ctx.restore();
      res();
    };
    img.onerror = () => res();
    img.src = `flags/${f.c.toLowerCase()}.svg`;
  })));
  return toBlob(c);
}

/** a year in travel, as one tall image */
export async function yearCard(r, s, y, { dark = true } = {}) {
  await fontsReady();
  const P = dark ? PALETTES.dark : PALETTES.light;
  const W = 1080, H = 1920;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = P.bg; ctx.fillRect(0, 0, W, H);
  const rtl = isAr.value, sx = rtl ? W - 80 : 80;
  const Y = r.years.find(v => v.y === y);
  textAt(ctx, t('app_name'), sx, 150, { font: KUFI(700, 56), color: P.accent });
  textAt(ctx, dig(y), sx, 330, { font: KUFI(700, 210), color: P.ink });
  textAt(ctx, s.profile.name ? t('wr_of', { name: s.profile.name }) : t('wr_sub'), sx, 410, { font: PLEX(500, 40), color: P.ink2 });
  // globe of the year's countries
  const lo = await loadWorld('lo');
  const set = new Set(Y ? [...Y.countries] : []);
  const gc = document.createElement('canvas'); gc.width = 560; gc.height = 560;
  const pts = [...set].map(cc => C.get(cc)).filter(Boolean).map(x => x.lp);
  const center = pts.length ? [pts.reduce((a, p) => a + p[1], 0) / pts.length, Math.max(-35, Math.min(45, pts.reduce((a, p) => a + p[0], 0) / pts.length))] : [47, 29];
  drawGlobe(gc, { features: lo, width: 560, height: 560, center, scale: 0.48, colors: { sea: P.card, globeSea: P.card, land: P.land, border: P.border, graticule: dark ? 'rgba(255,255,255,0.06)' : 'rgba(26,36,64,0.08)', rim: P.rule }, fill: cc => (set.has(cc) ? P.accent : cc === s.profile.home ? P.home : P.land) });
  ctx.drawImage(gc, rtl ? 60 : W - 620, 160, 560, 560);
  const stats = Y ? [
    [num(Y.trips), unit(Y.trips, 'trip')],
    [num(Y.countries.size), unit(Y.countries.size, 'country')],
    [num(Y.newCountries.length), t('wr_new')],
    [num(Y.cities.size), unit(Y.cities.size, 'city')],
    [num(Y.days), t('card_days')],
    [num(Math.round(Y.km)), t('wr_km')]
  ] : [];
  const top = 860, colW = (W - 160) / 2, rowH = 220;
  stats.forEach(([v, l], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = rtl ? W - 80 - col * colW : 80 + col * colW;
    const yy = top + row * rowH;
    textAt(ctx, v, x, yy + 40, { font: KUFI(700, 110), color: i === 2 ? P.gold : P.ink });
    textAt(ctx, l, x, yy + 100, { font: PLEX(500, 38), color: P.ink2 });
  });
  const names = Y ? [...Y.countries].map(cc => cname(C.get(cc))).slice(0, 10).join(rtl ? '، ' : ', ') : '';
  textAt(ctx, names, sx, 1640, { font: PLEX(500, 36), color: P.ink2, maxWidth: W - 160 });
  textAt(ctx, t('wr_footer'), sx, 1820, { font: PLEX(400, 30), color: P.ink2 });
  return toBlob(c);
}
