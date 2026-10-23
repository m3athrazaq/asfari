// The printable report (PDF, vector, Arabic shaped correctly): cover with the world map and the
// main numbers, an overview, then the countries, trips, cities and wishlist.
import { C, COUNTRIES, CONTINENTS, loadWorld } from '../core/data.js';
import { geoPath } from 'd3-geo';
import { flatProjection } from '../map/worldmap.js';
import { t, num, pct, unit, count, cname, cityName, fmtDate, fmtRange, fmtKm, isAr, lang, dig, fmtMoney } from '../core/i18n.js';
import { loadScript } from './excel.js';
import { EARTH_KM, exactDay, spanDays, todayISO } from '../core/util.js';
import { tripTitle, tripPlaces } from '../ui/screens/Trips.jsx';
import { badgeTitle } from '../ui/screens/Stats.jsx';

let libP = null;
const loadLib = () => (libP = libP || loadScript('vendor/pdf.js', __PDF_SRI__, 'AsfariPDF').catch(e => { libP = null; throw e; }));
const fontBytes = {};
async function getFont(name) {
  if (!fontBytes[name]) {
    const r = await fetch('fonts/pdf/' + name, { cache: 'force-cache' });
    if (!r.ok) throw new Error('font ' + name);
    fontBytes[name] = new Uint8Array(await r.arrayBuffer());
  }
  return fontBytes[name];
}

const hex = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const COL = { ink: '#1A2440', ink2: '#4C5873', ink3: '#7C879E', rule: '#D2DCDB', paper: '#EDF2F1', visa: '#4B44C8', visaSoft: '#E4E2FA', carmine: '#C2362F', emerald: '#13785A', saffron: '#C98A12', saffronSoft: '#F7EBCF', slate: '#7D8AA6', land: '#DDE4E3', white: '#FFFFFF' };

const MARKS = /[ً-ٰٟۖ-ۭـ]/g;
const FALLBACK = { '٪': '%', '–': '-', '—': '-', '·': '-', '…': '...', '’': "'", '‘': "'", '“': '"', '”': '"', '←': '<', '→': '>', ' ': ' ', ' ': ' ', '‏': '', '‎': '', '؜': '' };

export async function makeReport(s, r, opts = {}) {
  const { PDFDocument, PDFHexString, rgb, fontkit, bidiFactory } = await loadLib();
  const bidi = bidiFactory();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [regB, boldB] = await Promise.all([getFont('IBMPlexSansArabic-Regular.ttf'), getFont('IBMPlexSansArabic-Bold.ttf')]);
  // the whole font is embedded: subsetting breaks Arabic letter forms in pdf-lib
  const F = { reg: await doc.embedFont(regB, { subset: false }), bold: await doc.embedFont(boldB, { subset: false }) };
  const fk = { reg: fontkit.create(regB), bold: fontkit.create(boldB) };
  // Each run of text is laid out in its own direction: right-to-left runs (Arabic) are handed over in
  // logical order and fontkit shapes and reverses them; left-to-right runs (numbers, Latin) never are.
  let runDir = 'ltr';
  for (const f of [F.reg, F.bold]) {
    f.embedder.encodeText = function (txt) {
      const glyphs = this.font.layout(txt, this.fontFeatures, runDir === 'rtl' ? 'arab' : 'latn', undefined, runDir).glyphs;
      return PDFHexString.of(glyphs.map(g => g.id.toString(16).padStart(4, '0')).join(''));
    };
  }
  const rtl = isAr.value;
  const color = h => rgb(...hex(h));
  const name = s.profile.name;
  doc.setTitle(name ? t('r_title', { name }) : t('r_title_anon'));
  doc.setAuthor(name || 'Asfari'); doc.setCreator('Asfari'); doc.setProducer('Asfari'); doc.setLanguage(rtl ? 'ar' : 'en');
  doc.setCreationDate(new Date());

  /* ---------- text ---------- */
  const fixText = (txt, key) => {
    const font = fk[key];
    let out = '';
    for (const ch of String(txt == null ? '' : txt).replace(MARKS, '').replace(/\r?\n/g, ' ')) {
      if (FALLBACK[ch] != null && !font.hasGlyphForCodePoint(ch.codePointAt(0))) { out += FALLBACK[ch]; continue; }
      if (font.hasGlyphForCodePoint(ch.codePointAt(0))) out += ch;
      else if (FALLBACK[ch] != null) out += FALLBACK[ch];
    }
    return out;
  };
  /** visual runs of one line (bidi reordering + mirroring), ready for pdf-lib/fontkit */
  const runs = (txt, key) => {
    const text = fixText(txt, key);
    if (!text) return [];
    const lv = bidi.getEmbeddingLevels(text, rtl ? 'rtl' : 'ltr');
    const mir = bidi.getMirroredCharactersMap(text, lv.levels);
    const chars = [...text];
    if (chars.length !== text.length) return [{ s: text, l: 0 }]; // astral characters: draw as is
    const order = Array.from({ length: text.length }, (_, i) => i);
    for (const [a, b] of bidi.getReorderSegments(text, lv)) { const part = order.slice(a, b + 1).reverse(); order.splice(a, b - a + 1, ...part); }
    const out = []; let cur = null;
    for (const i of order) {
      const l = lv.levels[i];
      if (!cur || cur.l !== l) { cur = { l, s: '' }; out.push(cur); }
      cur.s += mir.get(i) || text[i];
    }
    // right-to-left runs go back to logical order (fontkit reverses them while shaping)
    for (const o of out) if (o.l % 2) o.s = [...o.s].reverse().join('');
    return out;
  };
  const width = (txt, size, key = 'reg') => runs(txt, key).reduce((a, o) => a + F[key].widthOfTextAtSize(o.s, size), 0);
  /** draws one line; x is the start edge (right edge in Arabic) unless align is given */
  const text = (page, txt, x, y, { size = 10, key = 'reg', col = COL.ink, align = 'start', maxWidth } = {}) => {
    let rs = runs(txt, key);
    if (!rs.length) return 0;
    let w = rs.reduce((a, o) => a + F[key].widthOfTextAtSize(o.s, size), 0);
    if (maxWidth && w > maxWidth) {
      // shorten with an ellipsis
      let t0 = String(txt);
      while (t0.length > 1 && width(t0 + '...', size, key) > maxWidth) t0 = t0.slice(0, -1);
      rs = runs(t0.trim() + '...', key); w = rs.reduce((a, o) => a + F[key].widthOfTextAtSize(o.s, size), 0);
    }
    const a = align === 'start' ? (rtl ? 'right' : 'left') : align === 'end' ? (rtl ? 'left' : 'right') : align;
    let left = a === 'right' ? x - w : a === 'center' ? x - w / 2 : x;
    for (const o of rs) {
      runDir = o.l % 2 ? 'rtl' : 'ltr';
      page.drawText(o.s, { x: left, y: PH - y, size, font: F[key], color: color(col) });
      left += F[key].widthOfTextAtSize(o.s, size);
    }
    runDir = 'ltr';
    return w;
  };
  /** splits text into lines that fit */
  const wrap = (txt, size, maxWidth, key = 'reg') => {
    const words = String(txt || '').replace(MARKS, '').split(/\s+/).filter(Boolean);
    const lines = []; let line = '';
    for (const w of words) {
      const cand = line ? line + ' ' + w : w;
      if (width(cand, size, key) <= maxWidth || !line) line = cand;
      else { lines.push(line); line = w; }
    }
    if (line) lines.push(line);
    return lines;
  };

  /* ---------- pages ---------- */
  const [PW, PH] = opts.paper === 'Letter' ? [612, 792] : [595.28, 841.89];
  const M = 42;                       // margin
  const L = M, R0 = PW - M, CW = PW - 2 * M;
  const S = rtl ? R0 : L;             // start edge
  const X = d => (rtl ? R0 - d : L + d); // a position measured from the start edge
  const pages = [];
  let page = null, y = 0;
  const newPage = (title) => {
    page = doc.addPage([PW, PH]);
    pages.push(page);
    y = M + 6;
    if (title) {
      text(page, title, S, y + 16, { size: 20, key: 'bold', col: COL.ink });
      y += 30;
      page.drawLine({ start: { x: L, y: PH - y }, end: { x: R0, y: PH - y }, thickness: 1.2, color: color(COL.visa) });
      y += 16;
    }
    return page;
  };
  const need = (h, title) => { if (y + h > PH - M - 24) newPage(title ? title + ' ' + t('r_cont') : null); };
  const rect = (x, yTop, w, h, fill, border) => page.drawRectangle({ x, y: PH - yTop - h, width: w, height: h, color: fill ? color(fill) : undefined, borderColor: border ? color(border) : undefined, borderWidth: border ? 0.6 : 0 });

  /* flags as small images (drawn from the app's SVG flags) */
  const flagCache = new Map();
  async function flag(cc) {
    if (flagCache.has(cc)) return flagCache.get(cc);
    let img = null;
    try {
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = `flags/${cc.toLowerCase()}.svg`; });
      const cv = document.createElement('canvas'); cv.width = 64; cv.height = 48;
      const x = cv.getContext('2d'); x.drawImage(im, 0, 0, 64, 48);
      const blob = await new Promise(r0 => cv.toBlob(r0, 'image/png'));
      img = await doc.embedPng(new Uint8Array(await blob.arrayBuffer()));
    } catch (e) { img = null; }
    flagCache.set(cc, img);
    return img;
  }
  const drawFlag = async (cc, x, yTop, w = 16) => {
    const img = await flag(cc);
    const h = w * 0.75;
    if (img) page.drawImage(img, { x, y: PH - yTop - h, width: w, height: h });
    page.drawRectangle({ x, y: PH - yTop - h, width: w, height: h, borderColor: color(COL.rule), borderWidth: 0.4 });
  };

  const stColor = st => ({ visited: COL.visa, lived: COL.emerald, transit: COL.slate, home: COL.carmine, wish: COL.saffron, planned: COL.saffron }[st] || COL.land);

  /* ---------- cover ---------- */
  newPage();
  // guilloche band
  for (let i = 0; i < 9; i++) {
    let d = '';
    for (let x = 0; x <= PW; x += 6) { const yy = 18 + i * 9 + Math.sin(x / 22 + i * 0.8) * 6 + Math.sin(x / 7 + i) * 1.2; d += (x ? 'L' : 'M') + x.toFixed(1) + ' ' + yy.toFixed(1); }
    page.drawSvgPath(d, { x: 0, y: PH, borderColor: color(COL.visa), borderWidth: 0.4, borderOpacity: 0.25 });
  }
  y = 112;
  text(page, t('app_name'), S, y, { size: 13, key: 'bold', col: COL.visa });
  y += 36;
  text(page, name ? t('r_title', { name }) : t('r_title_anon'), S, y, { size: 30, key: 'bold', maxWidth: CW });
  y += 24;
  const years = r.years.filter(v => v.trips).map(v => v.y);
  const home = C.get(s.profile.home);
  const sub = [years.length ? (years[0] === years[years.length - 1] ? dig(years[0]) : dig(years[0]) + ' – ' + dig(years[years.length - 1])) : '', home ? t('r_from', { home: cname(home) }) : ''].filter(Boolean).join(rtl ? '، ' : ', ');
  text(page, sub, S, y, { size: 13, col: COL.ink2 });
  y += 18;
  // the map
  const hi = await loadWorld('hi');
  const proj = flatProjection();
  const mapW = CW, mapH = CW * 0.48;
  proj.fitExtent([[0, 0], [mapW, mapH]], { type: 'MultiPoint', coordinates: [[-180, -56], [180, 83]] });
  const gp = geoPath(proj).digits(1);
  const mapTop = y;
  rect(L, mapTop, mapW, mapH, COL.paper);
  for (const f of hi) {
    if (f.id === 'AQ') continue;
    const d = gp(f); if (!d) continue;
    const e = f.id && r.cs.get(f.id);
    const st = e ? (e.home ? 'home' : e.status) : '';
    page.drawSvgPath(d, { x: L, y: PH - mapTop, color: color(st && st !== 'wish' && st !== 'planned' ? stColor(st) : COL.land), borderColor: color(COL.white), borderWidth: 0.25 });
  }
  for (const c of r.counted) {
    if (c.area > 2600 && c.g) continue;
    const p = proj([c.lp[1], c.lp[0]]); if (!p) continue;
    const e = r.cs.get(c.c);
    page.drawCircle({ x: L + p[0], y: PH - mapTop - p[1], size: 2.2, color: color(stColor(e.home ? 'home' : e.status)), borderColor: color(COL.white), borderWidth: 0.4 });
  }
  y = mapTop + mapH + 12;
  // legend
  let lx = 0;
  for (const [st, lab] of [['visited', t('st_visited')], ['lived', t('st_lived')], ['transit', t('lg_transit')], ['home', t('st_home')]]) {
    const w = width(lab, 9) + 22;
    const x0 = rtl ? R0 - lx - 9 : L + lx;
    rect(x0, y - 7, 9, 9, stColor(st));
    text(page, lab, rtl ? x0 - 5 : x0 + 14, y + 1, { size: 9, col: COL.ink2, align: rtl ? 'right' : 'left' });
    lx += w + 8;
  }
  y += 22;
  // numbers
  const boxes = [
    [num(r.main.length) + ' / ' + num(r.denomTotal), unit(r.main.length, 'country') + (r.extra.length ? ' ' + t('s_plus_terr', { n: count(r.extra.length, 'territory') }) : '')],
    [pct(r.worldShare), t('s_world')],
    [num(r.contVisited) + ' / 7', unit(r.contVisited, 'continent')],
    [num(r.cityCount), unit(r.cityCount, 'city')],
    [num(r.started.length), unit(r.started.length, 'trip')],
    [num(r.daysAbroad), t('r_days_abroad')],
    [num(Math.round(r.km)), t('r_km') + (r.km >= 1000 ? ' (' + t('s_around', { n: num(r.km / EARTH_KM, 1) }) + ')' : '')],
    [num(r.flights), unit(r.flights, 'flight')]
  ];
  const bw = CW / 4, bh = 56;
  boxes.forEach(([v, l], i) => {
    const col = i % 4, row = Math.floor(i / 4);
    const x0 = rtl ? R0 - (col + 1) * bw : L + col * bw;
    const y0 = y + row * (bh + 8);
    rect(x0 + 3, y0, bw - 6, bh, i === 0 ? COL.visaSoft : COL.paper);
    const sx = rtl ? x0 + bw - 12 : x0 + 12;
    text(page, v, sx, y0 + 26, { size: 18, key: 'bold', col: i === 0 ? COL.visa : COL.ink, align: rtl ? 'right' : 'left', maxWidth: bw - 22 });
    text(page, l, sx, y0 + 43, { size: 8.5, col: COL.ink2, align: rtl ? 'right' : 'left', maxWidth: bw - 22 });
  });
  y += 2 * (bh + 8) + 12;
  // continents on the cover
  for (const c of r.continents) {
    need(16);
    text(page, t('cont_' + c.k), S, y + 9, { size: 10 });
    const barX = rtl ? L : L + 150, barW = CW - 230;
    const bx = rtl ? L + 70 : L + 150;
    rect(bx, y + 1, barW, 7, COL.paper);
    if (c.visited) { const w0 = barW * Math.min(1, c.visited / c.total); rect(rtl ? bx + barW - w0 : bx, y + 1, w0, 7, COL.visa); }
    text(page, num(c.visited) + ' / ' + num(c.total), rtl ? L : R0, y + 9, { size: 9.5, col: COL.ink2, align: rtl ? 'left' : 'right' });
    y += 16;
  }

  /* ---------- overview ---------- */
  const hasYears = r.years.length > 0;
  newPage(t('r_overview'));
  if (hasYears) {
    text(page, t('s_by_year'), S, y + 4, { size: 12, key: 'bold' }); y += 16;
    const ys = r.years.slice(-24);
    const maxV = Math.max(1, ...ys.map(v => Math.max(v.newCountries.length, v.trips)));
    const chartH = 120, colW = CW / ys.length;
    const base = y + chartH;
    ys.forEach((v, i) => {
      const x0 = L + i * colW; // years run left to right in both languages, like a timeline
      const h1 = (v.newCountries.length / maxV) * (chartH - 18);
      const h2 = (v.trips / maxV) * (chartH - 18);
      const bw0 = Math.min(14, colW * 0.32);
      if (h1) rect(x0 + colW / 2 - bw0 - 1, base - h1, bw0, h1, COL.visa);
      if (h2) rect(x0 + colW / 2 + 1, base - h2, bw0, h2, COL.saffron);
      if (v.newCountries.length) text(page, num(v.newCountries.length), x0 + colW / 2 - bw0 / 2 - 1, base - h1 - 3, { size: 7, col: COL.ink2, align: 'center' });
      text(page, dig(v.y), x0 + colW / 2, base + 11, { size: 7.5, col: COL.ink2, align: 'center' });
    });
    page.drawLine({ start: { x: L, y: PH - base }, end: { x: R0, y: PH - base }, thickness: 0.6, color: color(COL.rule) });
    y = base + 22;
    rect(rtl ? R0 - 8 : L, y - 7, 8, 8, COL.visa); text(page, t('s_new_countries'), rtl ? R0 - 13 : L + 13, y, { size: 8.5, col: COL.ink2, align: rtl ? 'right' : 'left' });
    const w1 = width(t('s_new_countries'), 8.5) + 30;
    rect(rtl ? R0 - w1 - 8 : L + w1, y - 7, 8, 8, COL.saffron); text(page, t('s_trips_year'), rtl ? R0 - w1 - 13 : L + w1 + 13, y, { size: 8.5, col: COL.ink2, align: rtl ? 'right' : 'left' });
    y += 22;
  }
  // records
  const ex = r.extremes;
  const place = p => (p ? (p.country ? cname(C.get(p.cc)) : (rtl ? p.name : p.nameEn || p.name) + (rtl ? '، ' : ', ') + cname(C.get(p.cc))) : '');
  const recs = [
    r.longest && [t('s_longest'), tripTitle(s, r.longest.t), count(r.longestDays, 'day')],
    r.mostVisited && r.mostVisited.visits > 1 && [t('s_most_visited'), cname(C.get(r.mostVisited.cc)), count(r.mostVisited.visits, 'time')],
    r.mostDays && [t('s_most_days'), cname(C.get(r.mostDays.cc)), count(r.mostDays.dayCount, 'day')],
    ex && ex.far && [t('s_farthest', { home: home ? cname(home) : t('home_word') }), place(ex.far), fmtKm(Math.round(ex.farKm))],
    ex && [t('s_north'), place(ex.north), ''], ex && [t('s_south'), place(ex.south), ''],
    ex && [t('s_east'), place(ex.east), ''], ex && [t('s_west'), place(ex.west), ''],
    r.firstTrip && [t('s_first_trip'), tripTitle(s, r.firstTrip.t), fmtDate(r.firstTrip.t.start, { noHijri: true })],
    r.avgTrip > 0 && [t('s_avg'), count(Math.round(r.avgTrip), 'day'), '']
  ].filter(Boolean);
  if (recs.length) {
    need(40); text(page, t('s_records'), S, y + 4, { size: 12, key: 'bold' }); y += 14;
    for (const [k, v, x0] of recs) {
      need(20);
      page.drawLine({ start: { x: L, y: PH - y }, end: { x: R0, y: PH - y }, thickness: 0.4, color: color(COL.rule) });
      text(page, k, S, y + 13, { size: 9, col: COL.ink2, maxWidth: 150 });
      text(page, v, X(160), y + 13, { size: 10, key: 'bold', maxWidth: CW - 260 });
      if (x0) text(page, x0, rtl ? L : R0, y + 13, { size: 9.5, col: COL.ink2, align: rtl ? 'left' : 'right' });
      y += 19;
    }
    y += 10;
  }
  // badges
  const won = r.badges.filter(b => b.done);
  if (won.length && opts.badges !== false) {
    need(50); text(page, t('s_badges') + ' (' + num(won.length) + ')', S, y + 4, { size: 12, key: 'bold' }); y += 16;
    const cols = 3, cw = CW / cols;
    won.forEach((b, i) => {
      const col = i % cols;
      if (col === 0 && i) y += 18;
      need(18);
      const x0 = rtl ? R0 - col * cw : L + col * cw;
      page.drawCircle({ x: rtl ? x0 - 5 : x0 + 5, y: PH - y - 6, size: 4, color: color(COL.saffronSoft), borderColor: color(COL.saffron), borderWidth: 0.8 });
      text(page, badgeTitle(b), rtl ? x0 - 14 : x0 + 14, y + 9, { size: 9.5, maxWidth: cw - 20, align: rtl ? 'right' : 'left' });
    });
    y += 30;
  }

  /* ---------- countries ---------- */
  const visited = r.counted.map(c => ({ c, e: r.cs.get(c.c) }));
  if (visited.length) {
    const title = t('r_countries');
    newPage(title);
    const colX = { flag: 0, name: 24, first: CW - 200, trips: CW - 120, days: CW - 75, cities: CW - 30 };
    const header = () => {
      for (const [k, lab] of [['first', t('x_first')], ['trips', t('x_trips_n')], ['days', t('x_days')], ['cities', t('x_cities_n')]]) text(page, lab, X(colX[k]), y + 8, { size: 7.5, col: COL.ink3, align: 'start' });
      y += 14;
    };
    for (const k of CONTINENTS) {
      const list = visited.filter(v => v.c.cont === k).sort((a, b) => (a.e.first ?? 1e9) - (b.e.first ?? 1e9));
      if (!list.length) continue;
      need(60, title);
      text(page, t('cont_' + k) + ' — ' + num(list.length), S, y + 12, { size: 12, key: 'bold', col: COL.visa });
      y += 20; header();
      for (const { c, e } of list) {
        need(20, title);
        await drawFlag(c.c, rtl ? R0 - 18 : L, y + 2, 18);
        text(page, cname(c), X(colX.name), y + 12, { size: 10.5, key: 'bold', maxWidth: colX.first - colX.name - 70 });
        const nw = Math.min(width(cname(c), 10.5, 'bold'), colX.first - colX.name - 70);
        text(page, rtl ? c.en : c.ar, X(colX.name + nw + 6), y + 12, { size: 8, col: COL.ink3, maxWidth: colX.first - colX.name - nw - 16 });
        text(page, e.home ? t('st_home') : e.firstStr ? fmtDate(e.firstStr, { short: true, noHijri: true }) : '', X(colX.first), y + 12, { size: 9, col: COL.ink2 });
        text(page, e.visits ? num(e.visits) : '', X(colX.trips), y + 12, { size: 9, col: COL.ink2 });
        text(page, e.dayCount ? num(e.dayCount) : '', X(colX.days), y + 12, { size: 9, col: COL.ink2 });
        const nc = e.cities.filter(id => { const ci = s.cities.find(x => x.id === id); return ci && ci.s !== 'wish'; }).length;
        text(page, nc ? num(nc) : '', X(colX.cities), y + 12, { size: 9, col: COL.ink2 });
        y += 19;
        page.drawLine({ start: { x: L, y: PH - y + 2 }, end: { x: R0, y: PH - y + 2 }, thickness: 0.3, color: color(COL.rule) });
      }
      y += 10;
    }
  }

  /* ---------- trips ---------- */
  const trips = r.trips.filter(x => x.phase !== 'upcoming');
  if (trips.length && opts.trips !== false) {
    const title = t('r_trips');
    newPage(title);
    let lastYear = null;
    for (const x of trips) {
      const tr = x.t;
      const yr = tr.start ? tr.start.slice(0, 4) : '';
      const places = tripPlaces(s, tr).map(p => p.name).join(rtl ? ' ← ' : ' → ');
      const meta = [t('p_' + tr.purpose), tr.with.length ? t('r_with', { names: tr.with.join(rtl ? '، ' : ', ') }) : '', tr.rate ? t('rating_of', { n: num(tr.rate) }) : '', tr.cost ? fmtMoney(tr.cost, tr.cur || s.settings.currency) : ''].filter(Boolean).join('  |  ');
      const noteLines = opts.notes !== false && tr.note ? wrap(tr.note, 9, CW - 70).slice(0, 8) : [];
      const h = 50 + noteLines.length * 12 + (yr !== lastYear ? 26 : 0);
      need(h, title);
      if (yr !== lastYear) { text(page, yr ? dig(yr) : t('trip_no_dates'), S, y + 14, { size: 14, key: 'bold', col: COL.visa }); y += 24; lastYear = yr; }
      const days = exactDay(tr.start) ? spanDays(tr.start, tr.end || tr.start) : 0;
      rect(rtl ? R0 - 3 : L, y, 3, 34 + noteLines.length * 12, COL.visa);
      text(page, tripTitle(s, tr), X(12), y + 12, { size: 11, key: 'bold', maxWidth: CW - 150 });
      text(page, [fmtRange(tr.start, tr.end, { noHijri: true }), days ? count(days, 'day') : ''].filter(Boolean).join(rtl ? '، ' : ', '), rtl ? L : R0, y + 12, { size: 9, col: COL.ink2, align: rtl ? 'left' : 'right' });
      text(page, places, X(12), y + 26, { size: 9.5, col: COL.ink, maxWidth: CW - 20 });
      text(page, meta, X(12), y + 39, { size: 8.5, col: COL.ink3, maxWidth: CW - 20 });
      let ny = y + 52;
      for (const ln of noteLines) { text(page, ln, X(12), ny, { size: 9, col: COL.ink2 }); ny += 12; }
      y = ny + 6;
    }
  }

  /* ---------- cities ---------- */
  const cities = s.cities.filter(c => c.s !== 'wish');
  if (cities.length && opts.cities !== false) {
    const title = t('r_cities');
    newPage(title);
    const by = new Map();
    for (const c of cities) { if (!by.has(c.cc)) by.set(c.cc, []); by.get(c.cc).push(c); }
    const groups = [...by.entries()].sort((a, b) => b[1].length - a[1].length);
    const cols = 3, cw = CW / cols;
    for (const [cc, list] of groups) {
      list.sort((a, b) => cityName(a).localeCompare(cityName(b), lang.value));
      const rows = Math.ceil(list.length / cols);
      need(30 + Math.min(rows, 3) * 14, title);
      await drawFlag(cc, rtl ? R0 - 18 : L, y + 2, 18);
      text(page, cname(C.get(cc)) + ' — ' + num(list.length), X(24), y + 12, { size: 11, key: 'bold' });
      y += 20;
      for (let i = 0; i < list.length; i += cols) {
        need(14, title);
        for (let k = 0; k < cols && i + k < list.length; k++) {
          const c = list[i + k];
          const x0 = rtl ? R0 - k * cw : L + k * cw;
          const label = cityName(c) + (c.first ? ' (' + dig(c.first.slice(0, 4)) + ')' : '');
          text(page, label, x0, y + 10, { size: 9, col: COL.ink2, maxWidth: cw - 8, align: rtl ? 'right' : 'left' });
        }
        y += 14;
      }
      y += 8;
    }
  }

  /* ---------- wishlist ---------- */
  const wishC = [...r.cs.values()].filter(e => e.status === 'wish' || e.status === 'planned').map(e => C.get(e.cc)).filter(Boolean);
  if ((wishC.length || r.wishCities.length) && opts.wish !== false) {
    const title = t('r_wish');
    if (y + 90 > PH - M - 24) newPage(title);
    else { y += 14; text(page, title, S, y + 16, { size: 18, key: 'bold' }); y += 30; }
    const cols = 3, cw = CW / cols;
    for (let i = 0; i < wishC.length; i += cols) {
      need(22, title);
      for (let k = 0; k < cols && i + k < wishC.length; k++) {
        const c = wishC[i + k];
        const x0 = rtl ? R0 - k * cw : L + k * cw;
        await drawFlag(c.c, rtl ? x0 - 16 : x0, y + 3, 16);
        text(page, cname(c), rtl ? x0 - 22 : x0 + 22, y + 13, { size: 10, maxWidth: cw - 30, align: rtl ? 'right' : 'left' });
      }
      y += 22;
    }
    if (r.wishCities.length) {
      y += 6;
      text(page, r.wishCities.map(c => cityName(c) + ' (' + cname(C.get(c.cc)) + ')').join(rtl ? '، ' : ', '), S, y + 10, { size: 9.5, col: COL.ink2, maxWidth: CW });
      y += 20;
    }
  }

  /* ---------- page numbers ---------- */
  const total = pages.length;
  const stamp = t('r_footer', { date: fmtDate(todayISO(), { noHijri: true }) });
  pages.forEach((p, i) => {
    page = p;
    page.drawLine({ start: { x: L, y: M - 2 }, end: { x: R0, y: M - 2 }, thickness: 0.4, color: color(COL.rule) });
    text(page, stamp, S, PH - M + 14, { size: 7.5, col: COL.ink3 });
    text(page, t('r_page', { a: num(i + 1), b: num(total) }), rtl ? L : R0, PH - M + 14, { size: 7.5, col: COL.ink3, align: rtl ? 'left' : 'right' });
  });
  const bytes = await doc.save();
  return new Blob([bytes], { type: 'application/pdf' });
}
