// The Excel backup: a formatted workbook with every country, city, trip, stop and leg (and, if
// chosen, the photos). The same file restores everything — and can be edited in Excel first.
import { C, COUNTRIES, loadCities, searchCities, loadAirports } from '../core/data.js';
import { STATUSES, PURPOSES, MODES, sanitizeState, STATE_VERSION } from '../core/store.js';
import { derive } from '../core/derive.js';
import { t, lang, cname } from '../core/i18n.js';
import { AR, EN } from '../core/strings.js';
import { anyToISO, uid, bufToB64, b64ToBuf, spanDays, exactDay, haversine, hash } from '../core/util.js';
import { photoBlob, putPhotoBlob } from '../core/photos.js';

const FORMAT = 'asfari-backup';
const CHUNK = 30000;
let loading = null;
export function loadScript(src, integrity, global) {
  if (window[global]) return Promise.resolve(window[global]);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.integrity = integrity; s.crossOrigin = 'anonymous';
    s.onload = () => (window[global] ? resolve(window[global]) : reject(new Error(global + ' missing')));
    s.onerror = () => reject(new Error('could not load ' + src));
    document.head.appendChild(s);
  });
}
const loadExcel = () => (loading = loading || loadScript('vendor/exceljs.min.js', __EXCELJS_SRI__, 'ExcelJS').catch(e => { loading = null; throw e; }));

/* labels in both languages, so a file made in Arabic restores in English and back */
const both = key => [AR[key], EN[key]].filter(Boolean);
const labelMap = (codes, prefix) => {
  const m = new Map();
  for (const c of codes) for (const l of both(prefix + c)) m.set(String(l).trim().toLowerCase(), c);
  for (const c of codes) m.set(c.toLowerCase(), c);
  return m;
};
const STATUS_IN = () => { const m = labelMap(STATUSES, 'st_'); for (const c of STATUSES) for (const l of both('cst_' + c)) m.set(l.toLowerCase(), c); return m; };
const YES = new Set(['نعم', 'yes', 'y', 'true', '1', '✓', 'x']);

/* column layouts: key, header label key, width, kind ('in' = read back on restore, 'info' = computed) */
const COLS = {
  countries: [['code', 'x_code', 9, 'in'], ['name', 'x_country', 22, 'info'], ['nameEn', 'x_name_en', 22, 'info'], ['cont', 'x_continent', 16, 'info'],
    ['s', 'x_status', 15, 'in'], ['first', 'x_first_manual', 14, 'in'], ['rate', 'x_rating', 9, 'in'], ['fav', 'x_fav', 9, 'in'], ['note', 'x_note', 40, 'in'],
    ['eff', 'x_status_eff', 15, 'info'], ['firstEff', 'x_first', 14, 'info'], ['trips', 'x_trips_n', 10, 'info'], ['days', 'x_days', 9, 'info'], ['cities', 'x_cities_n', 9, 'info']],
  cities: [['id', 'x_id', 14, 'in'], ['name', 'x_city', 22, 'in'], ['nameEn', 'x_name_en', 22, 'in'], ['cc', 'x_code', 9, 'in'], ['country', 'x_country', 20, 'info'],
    ['s', 'x_status', 14, 'in'], ['first', 'x_first', 14, 'in'], ['rate', 'x_rating', 9, 'in'], ['fav', 'x_fav', 9, 'in'], ['note', 'x_note', 36, 'in'],
    ['lat', 'x_lat', 11, 'in'], ['lon', 'x_lon', 11, 'in'], ['ref', 'x_ref', 20, 'in']],
  trips: [['id', 'x_id', 14, 'in'], ['title', 'x_title', 26, 'in'], ['start', 'x_start', 13, 'in'], ['end', 'x_end', 13, 'in'], ['days', 'x_days', 8, 'info'],
    ['purpose', 'x_purpose', 14, 'in'], ['with', 'x_with', 24, 'in'], ['rate', 'x_rating', 9, 'in'], ['cost', 'x_cost', 11, 'in'], ['cur', 'x_currency', 9, 'in'],
    ['note', 'x_note', 40, 'in'], ['countries', 'x_countries', 26, 'info'], ['km', 'x_km', 10, 'info'], ['photos', 'x_photos', 10, 'info']],
  stops: [['trip', 'x_trip_id', 14, 'in'], ['tripTitle', 'x_title', 24, 'info'], ['order', 'x_order', 8, 'in'], ['cc', 'x_code', 9, 'in'], ['country', 'x_country', 18, 'info'],
    ['city', 'x_city_id', 14, 'in'], ['cityName', 'x_city', 18, 'info'], ['from', 'x_arrive', 13, 'in'], ['to', 'x_leave', 13, 'in'], ['transit', 'x_transit', 9, 'in'], ['note', 'x_note', 30, 'in'], ['id', 'x_id', 14, 'in']],
  legs: [['trip', 'x_trip_id', 14, 'in'], ['order', 'x_order', 8, 'in'], ['mode', 'x_mode', 12, 'in'],
    ['aK', 'x_from_kind', 9, 'in'], ['aCode', 'x_from_code', 9, 'in'], ['aName', 'x_from', 18, 'in'], ['aNameEn', 'x_from_en', 18, 'in'], ['aCC', 'x_from_cc', 8, 'in'], ['aLat', 'x_from_lat', 10, 'in'], ['aLon', 'x_from_lon', 10, 'in'],
    ['bK', 'x_to_kind', 9, 'in'], ['bCode', 'x_to_code', 9, 'in'], ['bName', 'x_to', 18, 'in'], ['bNameEn', 'x_to_en', 18, 'in'], ['bCC', 'x_to_cc', 8, 'in'], ['bLat', 'x_to_lat', 10, 'in'], ['bLon', 'x_to_lon', 10, 'in'],
    ['date', 'x_date', 13, 'in'], ['carrier', 'x_carrier', 16, 'in'], ['no', 'x_no', 10, 'in'], ['km', 'x_km', 10, 'info'], ['note', 'x_note', 24, 'in'], ['id', 'x_id', 14, 'in']]
};
const SHEETS = ['countries', 'cities', 'trips', 'stops', 'legs'];
/** a trip's content (not its ids, photos or times), to tell on import whether its rows were changed in Excel */
const endPrint = e => [e.k, e.code, e.name, e.nameEn, e.cc, e.lat, e.lon];
export const tripPrint = tr => hash(JSON.stringify([tr.title, tr.start, tr.end, tr.purpose, tr.with, tr.rate, tr.cost, tr.cur, tr.note,
  tr.stops.map(x => [x.cc, x.city, x.from, x.to, x.transit, x.note]), tr.legs.map(l => [l.mode, endPrint(l.a), endPrint(l.b), l.date, l.carrier, l.no, l.note])]));
const sheetName = (role, L) => (L === 'ar' ? AR : EN)['xs_' + role];

/* ---------------- export ---------------- */
const INK = 'FF1A2440', VISA = 'FF4B44C8', VISA_SOFT = 'FFE4E2FA', GREY = 'FFEEF1F1', RULE = 'FFD2DCDB';
const FONT = 'Arial';
export async function exportExcel(s, { photos = true, onProgress } = {}) {
  const ExcelJS = await loadExcel();
  const L = lang.value, rtl = L === 'ar';
  const T = k => (L === 'ar' ? AR : EN)[k] || EN[k] || k;
  const r = derive(s);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Asfari'; wb.created = new Date(); wb.modified = new Date();
  const view = { rightToLeft: rtl, state: 'frozen', ySplit: 1, showGridLines: true };
  const yesno = v => (v ? T('yes') : '');
  const cityById = new Map(s.cities.map(c => [c.id, c]));

  /* summary */
  const sum = wb.addWorksheet(T('xs_summary'), { views: [{ rightToLeft: rtl, showGridLines: false }], properties: { tabColor: { argb: VISA } } });
  sum.columns = [{ width: 34 }, { width: 22 }, { width: 18 }, { width: 18 }];
  sum.mergeCells('A1:D1');
  const title = sum.getCell('A1');
  title.value = T('x_title_sheet') + (s.profile.name ? ' — ' + s.profile.name : '');
  title.font = { name: FONT, size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VISA } };
  title.alignment = { vertical: 'middle', horizontal: rtl ? 'right' : 'left', indent: 1 };
  sum.getRow(1).height = 34;
  const home = C.get(s.profile.home);
  const info = [
    [T('x_name'), s.profile.name || ''],
    [T('x_home'), home ? cname(home) : ''],
    [T('x_exported'), new Date().toISOString().slice(0, 16).replace('T', ' ')]
  ];
  let row = 3;
  for (const [k, v] of info) { sum.getCell(row, 1).value = k; sum.getCell(row, 2).value = v; sum.getCell(row, 1).font = { name: FONT, color: { argb: 'FF4C5873' } }; sum.getCell(row, 2).font = { name: FONT, bold: true }; row++; }
  row++;
  const head = (rr, labels) => {
    labels.forEach((l, i) => {
      const c = sum.getCell(rr, i + 1); c.value = l;
      c.font = { name: FONT, bold: true, color: { argb: INK } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VISA_SOFT } };
      c.border = { bottom: { style: 'thin', color: { argb: VISA } } };
    });
  };
  const cS = sheetName('countries', L), tS = sheetName('trips', L), ciS = sheetName('cities', L);
  head(row, [T('x_figure'), T('x_value')]); row++;
  const visitedLabels = [T('st_visited'), T('st_lived')];
  const figures = [
    // formulas keep the summary right if the sheets are edited; the value is what the app counted
    [T('x_f_countries'), { formula: visitedLabels.concat(s.settings.transitCounts ? [T('st_transit')] : []).map(l => `COUNTIF('${cS}'!J:J,"${l}")`).join('+') + (s.settings.homeCounts ? '' : '-1'), result: r.counted.length }],
    [T('x_f_world'), r.main.length / r.denomTotal, '0.0%'],
    [T('x_f_continents'), r.contVisited],
    [T('x_f_cities'), { formula: `COUNTA('${ciS}'!A:A)-1`, result: s.cities.length }],
    [T('x_f_trips'), { formula: `COUNTA('${tS}'!A:A)-1`, result: s.trips.length }],
    [T('x_f_days'), r.daysAbroad],
    [T('x_f_km'), Math.round(r.km), '#,##0'],
    [T('x_f_flights'), r.flights]
  ];
  for (const [k, v, fmt] of figures) {
    sum.getCell(row, 1).value = k; sum.getCell(row, 1).font = { name: FONT };
    const c = sum.getCell(row, 2); c.value = v; c.font = { name: FONT, bold: true }; if (fmt) c.numFmt = fmt;
    c.alignment = { horizontal: rtl ? 'right' : 'left' };
    row++;
  }
  row++;
  head(row, [T('x_continent'), T('x_visited'), T('x_total')]); row++;
  for (let i = 2; i <= 4; i++) sum.getCell(row - 1, i).alignment = { horizontal: 'center' };
  const centre = { horizontal: 'center' };
  for (const c of r.continents) { sum.getCell(row, 1).value = T('cont_' + c.k); sum.getCell(row, 2).value = c.visited; sum.getCell(row, 3).value = c.total; for (let i = 1; i <= 3; i++) { sum.getCell(row, i).font = { name: FONT }; if (i > 1) sum.getCell(row, i).alignment = centre; } row++; }
  if (r.years.length) {
    row++;
    head(row, [T('x_year'), T('x_trips_n'), T('x_new_countries'), T('x_days')]); row++;
    for (const y of r.years) { sum.getCell(row, 1).value = String(y.y); sum.getCell(row, 2).value = y.trips; sum.getCell(row, 3).value = y.newCountries.length; sum.getCell(row, 4).value = y.days; for (let i = 1; i <= 4; i++) { sum.getCell(row, i).font = { name: FONT }; sum.getCell(row, i).alignment = centre; } row++; }
  }
  row++;
  sum.mergeCells(row, 1, row + 3, 4);
  const legend = sum.getCell(row, 1);
  legend.value = T('x_legend');
  legend.alignment = { wrapText: true, vertical: 'top', horizontal: rtl ? 'right' : 'left' };
  legend.font = { name: FONT, color: { argb: 'FF4C5873' }, size: 10 };
  for (let i = row; i <= row + 3; i++) sum.getRow(i).height = 22;

  /* data sheets */
  const addSheet = (role, rows) => {
    const ws = wb.addWorksheet(sheetName(role, L), { views: [view] });
    const cols = COLS[role];
    ws.columns = cols.map(([key, lab, w]) => ({ key, width: w }));
    const hr = ws.getRow(1);
    cols.forEach(([key, lab, w, kind], i) => {
      const c = hr.getCell(i + 1);
      c.value = T(lab);
      c.font = { name: FONT, bold: true, color: { argb: kind === 'in' ? 'FFFFFFFF' : 'FF4C5873' }, italic: kind !== 'in' };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: kind === 'in' ? INK : GREY } };
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      c.border = { bottom: { style: 'thin', color: { argb: RULE } } };
    });
    hr.height = 30;
    for (const data of rows) {
      const rr = ws.addRow(cols.map(([key]) => (data[key] == null ? '' : data[key])));
      rr.font = { name: FONT };
      cols.forEach(([key, , , kind], i) => {
        const c = rr.getCell(i + 1);
        if (kind !== 'in') c.font = { name: FONT, color: { argb: 'FF4C5873' } };
        if (key === 'note') c.alignment = { wrapText: true, vertical: 'top' };
        // text stays text: never turned into a formula, dates stay as typed (2024, 2024-03, 2024-03-12)
        if (typeof c.value === 'string') c.numFmt = '@';
      });
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    return ws;
  };
  const effLabel = st => (st ? T('st_' + st) : '');
  const cRows = [];
  for (const c of COUNTRIES) {
    const e = r.cs.get(c.c);
    const m = s.countries[c.c];
    if (!e && !m) continue;
    if (e && !e.status && !m && !e.cities.length) continue;
    cRows.push({
      code: c.c, name: cname(c), nameEn: c.en, cont: T('cont_' + c.cont),
      s: m && m.s ? T('st_' + m.s) : '', first: m ? m.first : '', rate: m && m.rate ? m.rate : '', fav: yesno(m && m.fav), note: m ? m.note : '',
      eff: e ? (e.home ? T('st_lived') : effLabel(e.status)) : '', firstEff: e && e.firstStr ? e.firstStr : '', trips: e ? e.visits || '' : '', days: e ? e.dayCount || '' : '', cities: e ? e.cities.length || '' : ''
    });
  }
  addSheet('countries', cRows);
  addSheet('cities', s.cities.map(c => ({ id: c.id, name: c.name, nameEn: c.nameEn, cc: c.cc, country: cname(C.get(c.cc)), s: T('cst_' + c.s), first: c.first, rate: c.rate || '', fav: yesno(c.fav), note: c.note, lat: c.lat, lon: c.lon, ref: c.ref })));
  const sortedTrips = [...s.trips].sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999'));
  addSheet('trips', sortedTrips.map(tr => ({
    id: tr.id, title: tr.title, start: tr.start, end: tr.end, days: exactDay(tr.start) ? spanDays(tr.start, tr.end || tr.start) : '',
    purpose: T('p_' + tr.purpose), with: tr.with.join(L === 'ar' ? '، ' : ', '), rate: tr.rate || '', cost: tr.cost || '', cur: tr.cur, note: tr.note,
    countries: [...new Set(tr.stops.map(x => cname(C.get(x.cc))))].join(L === 'ar' ? '، ' : ', '), km: Math.round(r.tripKm.get(tr.id) || 0) || '', photos: tr.photos.length || ''
  })));
  const stopRows = [], legRows = [];
  for (const tr of sortedTrips) {
    tr.stops.forEach((x, i) => {
      const city = x.city ? cityById.get(x.city) : null;
      stopRows.push({ trip: tr.id, tripTitle: tr.title, order: i + 1, cc: x.cc, country: cname(C.get(x.cc)), city: x.city, cityName: city ? (L === 'ar' ? city.name : city.nameEn || city.name) : '', from: x.from, to: x.to, transit: yesno(x.transit), note: x.note, id: x.id });
    });
    tr.legs.forEach((l, i) => {
      legRows.push({
        trip: tr.id, order: i + 1, mode: T('m_' + l.mode),
        aK: l.a.k, aCode: l.a.code, aName: l.a.name, aNameEn: l.a.nameEn, aCC: l.a.cc, aLat: l.a.lat, aLon: l.a.lon,
        bK: l.b.k, bCode: l.b.code, bName: l.b.name, bNameEn: l.b.nameEn, bCC: l.b.cc, bLat: l.b.lat, bLon: l.b.lon,
        date: l.date, carrier: l.carrier, no: l.no, km: Math.round(haversine(l.a.lat, l.a.lon, l.b.lat, l.b.lon)), note: l.note, id: l.id
      });
    });
  }
  addSheet('stops', stopRows);
  addSheet('legs', legRows);

  /* photos (hidden sheet) */
  let photoCount = 0;
  if (photos && Object.keys(s.photos).length) {
    const ws = wb.addWorksheet('_photos', { state: 'hidden' });
    ws.addRow(['id', 'trip', 'city', 'cap', 'date', 'w', 'h', 'type', 'data…']);
    const ids = Object.keys(s.photos);
    let i = 0;
    for (const id of ids) {
      i++;
      const blob = await photoBlob(id).catch(() => null);
      onProgress && onProgress(i, ids.length);
      if (!blob) continue;
      const m = s.photos[id];
      const b64 = bufToB64(await blob.arrayBuffer());
      const chunks = [];
      for (let k = 0; k < b64.length; k += CHUNK) chunks.push(b64.slice(k, k + CHUNK));
      ws.addRow([id, m.trip, m.city, m.cap, m.date, m.w, m.h, blob.type || 'image/jpeg', ...chunks]);
      photoCount++;
    }
  }

  /* each trip's last change, content fingerprint and cover photo (hidden) — a merge keeps the newer copy */
  const tws = wb.addWorksheet('_trips', { state: 'hidden' });
  tws.addRow(['id', 'upd', 'print', 'cover']);
  for (const tr of s.trips) tws.addRow([tr.id, tr.upd, tripPrint(tr), tr.cover || '']);

  /* settings + check (hidden) */
  const meta = wb.addWorksheet('_asfari', { state: 'hidden' });
  const metaRows = [
    ['format', FORMAT], ['version', STATE_VERSION], ['app', __APP_VERSION__], ['exported', new Date().toISOString()], ['lang', L],
    ['sheets', JSON.stringify(Object.fromEntries(SHEETS.map(k => [k, sheetName(k, L)])))],
    ['profile', JSON.stringify(s.profile)], ['settings', JSON.stringify(s.settings)], ['seen', JSON.stringify(s.seen)],
    ['counts', JSON.stringify({ countries: Object.keys(s.countries).length, cities: s.cities.length, trips: s.trips.length, photos: photoCount })]
  ];
  for (const m of metaRows) meta.addRow(m);
  const buf = await wb.xlsx.writeBuffer();
  return { blob: new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), photoCount };
}

/* ---------------- import ---------------- */
export class ImportError extends Error { constructor(kind, detail) { super(kind); this.kind = kind; this.detail = detail || ''; } }
const cellText = v => {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v instanceof Date) return v;
    if (v.richText) return v.richText.map(x => x.text).join('');
    if (v.text != null) return String(v.text);
    if (v.result != null) return v.result;
    if (v.hyperlink) return String(v.text || v.hyperlink);
    return '';
  }
  return v;
};
const utcDay = d => (isNaN(d) ? '' : d.toISOString().slice(0, 10));
const str = v => { const x = cellText(v); return x instanceof Date ? utcDay(x) : String(x).trim(); };
const cellDate = v => { const x = cellText(v); return x instanceof Date ? utcDay(x) : anyToISO(x); };
const numv = v => { const x = cellText(v); const n = typeof x === 'number' ? x : parseFloat(String(x).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(',', '.')); return isFinite(n) ? n : null; };

/** reads an Excel file → { raw, counts, photos } (nothing is changed yet) */
export async function readExcel(buffer) {
  if (!buffer || buffer.byteLength < 100) throw new ImportError('bad');
  const head = new Uint8Array(buffer, 0, 4);
  if (!(head[0] === 0x50 && head[1] === 0x4b)) throw new ImportError('bad'); // not a zip → not .xlsx
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch (e) { throw new ImportError('bad'); }
  const metaWs = wb.getWorksheet('_asfari');
  const meta = {};
  if (metaWs) metaWs.eachRow(row => { const k = str(row.getCell(1).value); if (k) meta[k] = cellText(row.getCell(2).value); });
  if (meta.format && meta.format !== FORMAT) throw new ImportError('bad');
  if (meta.version && +meta.version > STATE_VERSION) throw new ImportError('newer');
  const parseJSON = s => { try { return JSON.parse(String(s || '')); } catch (e) { return null; } };
  const names = parseJSON(meta.sheets) || {};
  const find = role => wb.getWorksheet(names[role]) || wb.getWorksheet(AR['xs_' + role]) || wb.getWorksheet(EN['xs_' + role]);
  const sheets = Object.fromEntries(SHEETS.map(k => [k, find(k)]));
  if (!sheets.countries && !sheets.trips && !sheets.cities) throw new ImportError('bad');

  // header text (either language) → column key
  const headerIndex = (ws, role) => {
    const map = {};
    const aliases = new Map();
    for (const [key, lab] of COLS[role]) for (const l of both(lab)) aliases.set(String(l).trim().toLowerCase(), key);
    ws.getRow(1).eachCell((c, i) => { const k = aliases.get(str(c.value).toLowerCase()); if (k && map[k] == null) map[k] = i; });
    return map;
  };
  const rowsOf = (role, max) => {
    const ws = sheets[role];
    if (!ws) return [];
    const H = headerIndex(ws, role);
    const out = [];
    ws.eachRow((row, n) => {
      if (n === 1 || out.length >= max) return;
      const o = {};
      for (const [key, i] of Object.entries(H)) o[key] = row.getCell(i).value;
      if (Object.values(o).some(v => str(v) !== '')) out.push(o);
    });
    return out;
  };
  const stIn = STATUS_IN(), pIn = labelMap(PURPOSES, 'p_'), mIn = labelMap(MODES, 'm_');
  const yes = v => YES.has(str(v).toLowerCase());
  const raw = { profile: parseJSON(meta.profile) || {}, settings: parseJSON(meta.settings) || {}, seen: parseJSON(meta.seen) || {}, countries: {}, cities: [], trips: [], photos: {} };

  for (const o of rowsOf('countries', 400)) {
    const code = str(o.code).toUpperCase();
    if (!C.has(code)) continue;
    raw.countries[code] = { s: stIn.get(str(o.s).toLowerCase()) || '', first: cellDate(o.first), rate: numv(o.rate) || 0, fav: yes(o.fav), note: str(o.note) };
  }
  for (const o of rowsOf('cities', 20000)) {
    const cc = str(o.cc).toUpperCase();
    raw.cities.push({ id: str(o.id) || uid(), name: str(o.name), nameEn: str(o.nameEn), cc, s: stIn.get(str(o.s).toLowerCase()) || 'visited', first: cellDate(o.first), rate: numv(o.rate) || 0, fav: yes(o.fav), note: str(o.note), lat: numv(o.lat), lon: numv(o.lon), ref: str(o.ref) });
  }
  const trips = new Map();
  for (const o of rowsOf('trips', 5000)) {
    const id = str(o.id) || uid();
    trips.set(id, { id, title: str(o.title), start: cellDate(o.start), end: cellDate(o.end), purpose: pIn.get(str(o.purpose).toLowerCase()) || 'other', with: str(o.with).split(/[،,;]+/).map(x => x.trim()).filter(Boolean), rate: numv(o.rate) || 0, cost: numv(o.cost) || 0, cur: str(o.cur).toUpperCase(), note: str(o.note), stops: [], legs: [], photos: [] });
  }
  const order = o => numv(o.order) ?? 1e6;
  for (const o of rowsOf('stops', 200000).sort((a, b) => order(a) - order(b))) {
    const tr = trips.get(str(o.trip));
    const cc = str(o.cc).toUpperCase();
    if (!tr || !C.has(cc)) continue;
    let city = str(o.city);
    const cityName = str(o.cityName);
    if (!city && cityName) {
      // a stop typed by hand with the city's name only: that city in the file, else a new one
      const k = cityName.toLowerCase();
      let c = raw.cities.find(x => x.cc === cc && (x.name.toLowerCase() === k || x.nameEn.toLowerCase() === k));
      if (!c) { const latin = /[a-z]/i.test(cityName); c = { id: uid(), name: latin ? '' : cityName, nameEn: latin ? cityName : '', cc, s: 'visited', first: '', rate: 0, fav: false, note: '', lat: null, lon: null, ref: '' }; raw.cities.push(c); }
      city = c.id;
    }
    tr.stops.push({ id: str(o.id) || uid(), cc, city, from: cellDate(o.from), to: cellDate(o.to), transit: yes(o.transit), note: str(o.note) });
  }
  for (const o of rowsOf('legs', 200000).sort((a, b) => order(a) - order(b))) {
    const tr = trips.get(str(o.trip));
    if (!tr) continue;
    const end = p => ({ k: str(o[p + 'K']) || 'city', code: str(o[p + 'Code']).toUpperCase(), name: str(o[p + 'Name']), nameEn: str(o[p + 'NameEn']), cc: str(o[p + 'CC']).toUpperCase(), lat: numv(o[p + 'Lat']), lon: numv(o[p + 'Lon']) });
    tr.legs.push({ id: str(o.id) || uid(), mode: mIn.get(str(o.mode).toLowerCase()) || 'other', a: end('a'), b: end('b'), date: cellDate(o.date), carrier: str(o.carrier), no: str(o.no), note: str(o.note) });
  }
  // photos
  const photoData = new Map();
  const pws = wb.getWorksheet('_photos');
  if (pws) {
    pws.eachRow((row, n) => {
      if (n === 1) return;
      const id = str(row.getCell(1).value);
      if (!/^[a-z0-9]{4,32}$/.test(id)) return;
      let b64 = '';
      for (let i = 9; i <= row.cellCount; i++) b64 += str(row.getCell(i).value);
      if (!b64) return;
      const type = str(row.getCell(8).value);
      raw.photos[id] = { trip: str(row.getCell(2).value), city: str(row.getCell(3).value), cap: str(row.getCell(4).value), date: cellDate(row.getCell(5).value), w: numv(row.getCell(6).value) || 0, h: numv(row.getCell(7).value) || 0 };
      photoData.set(id, { b64, type: /^image\/(jpeg|png|webp)$/.test(type) ? type : 'image/jpeg' });
    });
    for (const [pid, p] of Object.entries(raw.photos)) { const tr = trips.get(p.trip); if (tr) tr.photos.push(pid); }
  }
  raw.trips = [...trips.values()];
  await fillPlaces(raw);
  // validate everything the same way stored data is validated
  const clean = sanitizeState(raw);
  // a trip whose rows were not changed keeps its last-change time (so a merge keeps a newer copy on the phone);
  // a changed or new one counts as just changed
  const tws = wb.getWorksheet('_trips');
  const tmeta = new Map();
  if (tws) tws.eachRow((row, n) => { if (n > 1) tmeta.set(str(row.getCell(1).value), { upd: numv(row.getCell(2).value), print: numv(row.getCell(3).value), cover: str(row.getCell(4).value) }); });
  const now = Date.now();
  for (const tr of clean.trips) {
    const m = tmeta.get(tr.id);
    tr.upd = m && m.upd && m.print === tripPrint(tr) ? m.upd : now;
    if (m && m.cover && tr.photos.includes(m.cover)) tr.cover = m.cover;
  }
  for (const pid of Object.keys(clean.photos)) { const d = photoData.get(pid); if (d) clean.photos[pid].bytes = Math.round(d.b64.length * 0.75); }
  // keep this device's look when the file has none
  return {
    state: clean, photoData,
    counts: { countries: Object.values(clean.countries).filter(v => v.s).length, cities: clean.cities.length, trips: clean.trips.length, photos: photoData.size },
    edited: !metaWs
  };
}
/**
 * Rows typed by hand may have no coordinates: a city is looked up by its name in its country, a leg's
 * end by its airport code (else its city). Whatever is still missing gets the country's point later.
 */
async function fillPlaces(raw) {
  const missing = p => p.lat == null || p.lon == null;
  const cities = raw.cities.filter(c => missing(c) && C.has(c.cc) && (c.name || c.nameEn));
  const ends = [];
  for (const tr of raw.trips) for (const l of tr.legs) for (const e of [l.a, l.b]) if (missing(e)) ends.push(e);
  if (!cities.length && !ends.length) return;
  let D = null, A = null;
  try { D = await loadCities(); } catch (e) { /* the country's point is used */ }
  try { if (ends.some(e => e.code)) A = await loadAirports(); } catch (e) { /* idem */ }
  const findCity = (name, nameEn, cc) => {
    if (!D || !C.has(cc)) return null;
    for (const q of [nameEn, name]) if (q) { const hit = searchCities(D, q, { cc, limit: 1 })[0]; if (hit) return hit; }
    return null;
  };
  for (const c of cities) {
    const hit = findCity(c.name, c.nameEn, c.cc);
    if (hit) Object.assign(c, { lat: hit.lat, lon: hit.lon, ref: c.ref || hit.ref, name: c.name || hit.name, nameEn: c.nameEn || hit.nameEn });
  }
  for (const e of ends) {
    const ap = A && e.code ? A.byCode.get(e.code) : null;
    if (ap) { Object.assign(e, { k: 'apt', lat: ap.lat, lon: ap.lon, cc: e.cc || ap.cc, name: e.name || ap.cityAr || ap.city, nameEn: e.nameEn || ap.city }); continue; }
    const hit = findCity(e.name, e.nameEn, e.cc);
    if (hit) Object.assign(e, { lat: hit.lat, lon: hit.lon, name: e.name || hit.name, nameEn: e.nameEn || hit.nameEn });
  }
}

/** puts restored photos into the device's photo store */
export async function storePhotos(photoData, keep) {
  for (const [id, d] of photoData) {
    if (keep && !keep.has(id)) continue;
    try { await putPhotoBlob(id, new Blob([b64ToBuf(d.b64)], { type: d.type })); } catch (e) { /* skip a broken photo */ }
  }
}
