// Tests of the app's data logic in Node (run by .github/workflows/web.yml, or locally after `npm ci`):
//   node tests/core.test.cjs
// The core modules (store, derive, Excel import/export) are bundled with esbuild and run with a few
// browser stand-ins. Prints one PASS/FAIL line per check. Runs in a time zone west of UTC on purpose,
// so dates typed into Excel must not move by a day.
process.env.TZ = 'America/New_York';
const fs = require('fs');
const os = require('os');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failures++; };
const clone = x => JSON.parse(JSON.stringify(x));

/* ---------- browser stand-ins ---------- */
globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
const mem = new Map();
globalThis.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
globalThis.document = { addEventListener() {}, documentElement: { dataset: {} }, querySelectorAll: () => [], createElement: () => ({ style: {} }), head: { appendChild() {} }, body: { appendChild() {} }, visibilityState: 'visible' };
Object.defineProperty(globalThis, 'navigator', { value: { platform: 'Linux', maxTouchPoints: 0, language: 'ar-KW' }, configurable: true });
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.location = { hash: '', origin: 'http://localhost' };
globalThis.history = { state: null, pushState() {}, replaceState() {}, back() {} };
globalThis.fetch = async url => {
  const f = path.join(ROOT, String(url).replace(/^\.?\//, '').split('?')[0]);
  if (!fs.existsSync(f)) return { ok: false, status: 404 };
  const buf = fs.readFileSync(f);
  return { ok: true, status: 200, json: async () => JSON.parse(buf.toString('utf8')), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};
const stores = { kv: new Map(), photos: new Map() };
const later = f => { const r = {}; setTimeout(() => { r.result = f(); r.onsuccess && r.onsuccess(); }, 0); return r; };
globalThis.indexedDB = {
  open() {
    return later(() => ({
      objectStoreNames: { contains: () => true }, createObjectStore() {},
      transaction(name) {
        const t = {}, st = stores[name], done = () => setTimeout(() => t.oncomplete && t.oncomplete(), 0);
        t.objectStore = () => ({
          put: (v, k) => { st.set(k, v); done(); return {}; }, delete: k => { st.delete(k); done(); return {}; }, clear: () => { st.clear(); done(); return {}; },
          get: k => later(() => st.get(k)), getAllKeys: () => later(() => [...st.keys()])
        });
        return t;
      }
    }));
  }
};
globalThis.ExcelJS = require('exceljs');

(async () => {
  /* ---------- the core modules ---------- */
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'asfari-core-')), 'core.cjs');
  await esbuild.build({
    stdin: {
      contents: ["store", "derive", "util", "data"].map(m => `export * as ${m} from './src/core/${m}.js';`).join('\n') + "\nexport * as excel from './src/export/excel.js';",
      resolveDir: ROOT, loader: 'js'
    },
    bundle: true, format: 'cjs', platform: 'node', outfile: out, logLevel: 'error', jsx: 'automatic', jsxImportSource: 'preact',
    define: { __APP_VERSION__: '"test"', __ALLOW_FRAME__: 'false', __EXCELJS_SRI__: '""', __PDF_SRI__: '""', 'process.env.NODE_ENV': '"production"' }
  });
  const { store, derive, util, data, excel } = require(out);
  const { sampleState } = require('./sample-state.cjs');
  const { AR } = await import('../src/core/strings.js');
  await data.loadCountries();
  const fresh = () => { store.state.value = store.sanitizeState(clone(sampleState)); };
  const toBuf = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

  /* ---------- merge: an older backup never undoes newer changes here ---------- */
  {
    fresh();
    store.state.value = { ...store.state.value, photos: { phaaaa0001: { trip: 'ttr2019', city: '', cap: '', date: '', w: 10, h: 10, bytes: 100 } },
      trips: store.state.value.trips.map(t => (t.id === 'ttr2019' ? { ...t, photos: ['phaaaa0001'], cover: 'phaaaa0001' } : t)) };
    const { blob } = await excel.exportExcel(store.state.value, { photos: false });
    const file = await blob.arrayBuffer();
    const tr = store.state.value.trips.find(t => t.id === 'ttr2019');
    store.saveTrip({ ...tr, note: 'changed after the backup', stops: [...tr.stops, { id: 'snew0001', cc: 'GR', city: '', from: '', to: '', transit: false, note: '' }] });
    store.updateCity('cist01', { first: '2019-08-12' });
    const res = await excel.readExcel(file);
    store.mergeState(res.state);
    const after = store.state.value.trips.find(t => t.id === 'ttr2019');
    check(after.note === 'changed after the backup' && after.stops.length === 3, 'merging an older backup keeps a trip changed since then');
    check(after.photos.includes('phaaaa0001'), 'merging a backup made without photos keeps the trip photos on the phone');
    check(store.state.value.cities.find(c => c.id === 'cist01').first === '2019-08-12', 'merging keeps a city date set since the backup');

    // a trip changed in Excel itself counts as newer, so a merge takes it
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(file));
    const ws = wb.getWorksheet(AR.xs_trips);
    let idCol = 0, noteCol = 0;
    ws.getRow(1).eachCell((c, i) => { if (String(c.value).trim() === AR.x_id) idCol = i; if (String(c.value).trim() === AR.x_note) noteCol = i; });
    ws.eachRow((row, n) => { if (n > 1 && String(row.getCell(idCol).value) === 'tsa2024') row.getCell(noteCol).value = 'edited in Excel'; });
    const res2 = await excel.readExcel(toBuf(Buffer.from(await wb.xlsx.writeBuffer())));
    store.mergeState(res2.state);
    check(store.state.value.trips.find(t => t.id === 'tsa2024').note === 'edited in Excel', 'a trip edited in Excel replaces the copy on the phone when merged');
  }

  /* ---------- undo after deleting a city ---------- */
  {
    fresh();
    const removed = store.deleteCity('cist01');
    store.restoreCity(removed);
    const t = store.state.value.trips.find(x => x.id === 'ttr2019');
    check(t.stops.some(x => x.city === 'cist01'), 'Undo after deleting a city links its trips to it again');
  }

  /* ---------- rows added or changed by hand in Excel ---------- */
  {
    fresh();
    const { blob } = await excel.exportExcel(store.state.value, { photos: false });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await blob.arrayBuffer()));
    const col = (ws, label) => { let c = 0; ws.getRow(1).eachCell((cell, i) => { if (String(cell.value).trim() === label) c = i; }); return c; };
    const addRow = (ws, vals) => { const r = ws.addRow([]); for (const [label, v] of Object.entries(vals)) r.getCell(col(ws, label)).value = v; };
    const xd = s => new Date(s + 'T00:00:00Z'); // a date typed into Excel
    addRow(wb.getWorksheet(AR.xs_cities), { [AR.x_id]: 'Nice', [AR.x_city]: 'نيس', [AR.x_name_en]: 'Nice', [AR.x_code]: 'FR' });
    addRow(wb.getWorksheet(AR.xs_trips), { [AR.x_id]: 't1', [AR.x_title]: 'By hand', [AR.x_start]: xd('2020-02-01'), [AR.x_end]: xd('2020-02-05') });
    addRow(wb.getWorksheet(AR.xs_stops), { [AR.x_trip_id]: 't1', [AR.x_order]: 1, [AR.x_code]: 'FR', [AR.x_city_id]: 'Nice' });
    addRow(wb.getWorksheet(AR.xs_stops), { [AR.x_trip_id]: 't1', [AR.x_order]: 2, [AR.x_code]: 'FR', [AR.x_city]: 'Lyon' });
    const stops = wb.getWorksheet(AR.xs_stops);
    const copy = stops.addRow(stops.getRow(2).values.slice(1));
    copy.getCell(col(stops, AR.x_code)).value = 'GR';
    copy.getCell(col(stops, AR.x_order)).value = 9;
    addRow(wb.getWorksheet(AR.xs_legs), { [AR.x_trip_id]: 't1', [AR.x_order]: 1, [AR.x_mode]: 'Flight', [AR.x_from_code]: 'KWI', [AR.x_to_code]: 'NCE' });
    const res = await excel.readExcel(toBuf(Buffer.from(await wb.xlsx.writeBuffer())));
    const s = res.state;
    const nice = s.cities.find(c => c.nameEn === 'Nice');
    check(nice && Math.abs(nice.lat - 43.7) < 0.2 && Math.abs(nice.lon - 7.26) < 0.2, 'a city typed without coordinates is found by its name');
    const t1 = s.trips.find(t => t.title === 'By hand');
    check(t1 && t1.start === '2020-02-01' && t1.end === '2020-02-05', `dates typed into Excel keep their day west of UTC (${t1 && t1.start})`);
    check(t1 && t1.stops[0].city === (nice && nice.id), 'a stop pointing to a city by a hand-typed id keeps the city');
    const lyon = t1 && s.cities.find(c => c.id === t1.stops[1].city);
    check(lyon && lyon.nameEn === 'Lyon' && Math.abs(lyon.lat - 45.76) < 0.2, 'a stop typed with a city name only adds that city, found on the map');
    const leg = t1 && t1.legs[0];
    check(leg && leg.a.code === 'KWI' && Math.abs(leg.a.lat - 29.2) < 0.2 && Math.abs(leg.b.lat - 43.66) < 0.2, 'a flight typed with airport codes only gets the airports');
    const ids = s.trips.find(t => t.id === 'tmy2018').stops.map(x => x.id);
    check(new Set(ids).size === ids.length && ids.length === 4, 'a copied stop row gets its own id');
    check(!s.cities.some(c => c.lat === 0 && c.lon === 0), 'no place ends up at 0°, 0°');
  }

  /* ---------- Schengen 90/180 and days per country ---------- */
  {
    const today = util.todayDay();
    const iso = d => util.dayToISO(d);
    const base = { profile: { home: 'KW' }, settings: { onboarded: true } };
    const run = trips => {
      store.state.value = store.sanitizeState({ ...base, trips });
      return { st: derive.schengenStatus(store.state.value, today, null), r: derive.derive(store.state.value) };
    };
    const trip = (stops, a = today - 45, b = today - 6) => ({ id: 'trip0001', start: iso(a), end: iso(b), stops });
    let { st, r } = run([trip([{ id: 's001', cc: 'FR' }, { id: 's002', cc: 'AE', transit: true }])]);
    check(st.used === 40 && r.cs.get('FR').days.size === 40 && !(r.cs.get('AE').days.size), `a transit stop takes no days from France (Schengen ${st.used}, France ${r.cs.get('FR').days.size}, UAE ${r.cs.get('AE').days.size})`);
    ({ st } = run([{ id: 'trip0002', start: iso(today).slice(0, 7), stops: [{ id: 's001', cc: 'FR' }] }]));
    check(st.skipped === 1, 'a Schengen trip dated by month only is reported as not counted');
    ({ st } = run([trip([{ id: 's001', cc: 'FR' }, { id: 's002', cc: 'GB' }], today + 10, today + 39)]));
    const plan = derive.schengenStatus(store.state.value, today + 39, null);
    check(plan.used === 30 && plan.unsure === 1, `a planned France + UK trip with undated stops counts in full (${plan.used})`);
  }

  /* ---------- a planned trip's cities after the trip ---------- */
  {
    store.state.value = store.sanitizeState({ profile: { home: 'KW' }, settings: { onboarded: true } });
    const cid = store.addCity({ name: 'إسطنبول', nameEn: 'Istanbul', cc: 'TR', lat: 41.0082, lon: 28.9784, ref: 'TR:Istanbul@41.01,28.98' }, { s: 'wish' });
    // a trip planned then, that has happened by now
    store.state.value = { ...store.state.value, trips: [store.sanitizeState({ trips: [{ id: 'plan0001', start: util.dayToISO(util.todayDay() - 10), end: util.dayToISO(util.todayDay() - 5), stops: [{ id: 'st000001', cc: 'TR', city: cid }] }], cities: store.state.value.cities }).trips[0]] };
    store.promoteStartedTrips();
    const c = store.state.value.cities.find(x => x.id === cid);
    check(c.s === 'visited' && c.first === util.dayToISO(util.todayDay() - 10), 'a city saved for a planned trip becomes visited once the trip has happened');
  }

  /* ---------- badges ---------- */
  {
    fresh();
    const gcc = ['SA', 'AE', 'QA', 'BH', 'OM'];
    store.state.value = { ...store.state.value, settings: { ...store.state.value.settings, homeCounts: false }, countries: Object.fromEntries(gcc.map(cc => [cc, { s: 'visited', first: '', note: '', fav: false, rate: 0 }])) };
    const b = derive.derive(store.state.value).badges.find(x => x.id === 'gcc');
    check(b && b.done && b.got === 6, 'the Gulf badge is complete with every other Gulf country, even when home is not counted');
  }

  /* ---------- stored data from outside the app ---------- */
  {
    const s = store.sanitizeState({ cities: [{ id: 'abcd1234', name: 'A', cc: 'FR', lat: 1, lon: 1 }, { id: 'abcd1234', name: 'B', cc: 'FR', lat: 2, lon: 2 }], trips: [{ id: 'tttt1111', stops: [] }, { id: 'tttt1111', stops: [] }] });
    check(s.cities.length === 2 && s.cities[0].id !== s.cities[1].id && s.trips.length === 2 && s.trips[0].id !== s.trips[1].id, 'repeated ids are given new ones instead of dropping rows');
  }
})()
  .catch(e => { console.log('ERROR ' + ((e && e.stack) || e)); failures++; })
  .finally(() => { process.exitCode = failures ? 1 : 0; });
