// Builds the offline data files in data/ from the original sources.
// Run once (or when updating the sources):
//   node tools/build-data.mjs <dir with Natural Earth geojson> <dir with OurAirports airports.csv>
// Sources (all free to reuse — see README / credits screen):
//   - Natural Earth 1:50m admin-0 countries + 1:10m populated places (public domain)
//   - world-countries (npm, ODbL) — ISO codes, names, capitals, currencies, borders
//   - GeoNames cities with 1000+ people, via all-the-cities (npm; data CC BY 4.0)
//   - OurAirports airports (public domain)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { geoCentroid, geoDistance, geoArea, geoContains } from 'd3-geo';
import { topology } from 'topojson-server';
import { presimplify, simplify, quantile, sphericalTriangleArea } from 'topojson-simplify';
import { quantize } from 'topojson-client';

const require = createRequire(import.meta.url);
const [, , NE_DIR, AIR_DIR] = process.argv;
if (!NE_DIR || !AIR_DIR) {
  console.error('usage: node tools/build-data.mjs <natural-earth-dir> <ourairports-dir>');
  process.exit(1);
}
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'data');
fs.mkdirSync(OUT, { recursive: true });
const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const write = (name, obj) => {
  const s = JSON.stringify(obj);
  fs.writeFileSync(path.join(OUT, name), s);
  console.log(`  ${name}: ${(s.length / 1024).toFixed(0)} KB`);
};

const wc = require('world-countries');
const ne50 = readJSON(path.join(NE_DIR, 'ne_50m_admin_0_countries.geojson'));
const places = readJSON(path.join(NE_DIR, 'ne_10m_populated_places.geojson')).features.map(f => f.properties);

/* ---------------- countries ---------------- */
const byA3 = new Map(wc.map(c => [c.cca3, c.cca2]));
const CONT = c => {
  // continent keys are lower-case so they never clash with country codes (AS is American Samoa)
  if (c.region === 'Africa') return 'af';
  if (c.region === 'Asia') return 'as';
  if (c.region === 'Europe') return 'eu';
  if (c.region === 'Oceania') return 'oc';
  if (c.region === 'Antarctic') return 'an';
  if (c.region === 'Americas') return c.subregion === 'South America' ? 'sa' : 'na';
  throw new Error('no continent for ' + c.cca2);
};

// Arabic names: world-countries' Arabic translation, with the forms used in the Gulf where they differ.
const AR_FIX = {
  US: 'الولايات المتحدة', GB: 'المملكة المتحدة', CZ: 'التشيك', KR: 'كوريا الجنوبية', KP: 'كوريا الشمالية',
  CD: 'الكونغو الديمقراطية', CG: 'الكونغو', AE: 'الإمارات', SA: 'السعودية', VA: 'الفاتيكان',
  BA: 'البوسنة والهرسك', MK: 'مقدونيا الشمالية', NL: 'هولندا', RU: 'روسيا', SY: 'سوريا', IR: 'إيران',
  TZ: 'تنزانيا', LA: 'لاوس', MD: 'مولدوفا', VN: 'فيتنام', BO: 'بوليفيا', VE: 'فنزويلا', TW: 'تايوان',
  PS: 'فلسطين', CI: 'ساحل العاج', CV: 'الرأس الأخضر', SZ: 'إسواتيني', TL: 'تيمور الشرقية', MM: 'ميانمار',
  FM: 'ميكرونيسيا', KN: 'سانت كيتس ونيفيس', VC: 'سانت فنسنت والغرينادين', ST: 'ساو تومي وبرينسيب',
  DO: 'الدومينيكان', CF: 'أفريقيا الوسطى', GQ: 'غينيا الاستوائية', GW: 'غينيا بيساو', BN: 'بروناي',
  HK: 'هونغ كونغ', MO: 'ماكاو', XK: 'كوسوفو', TR: 'تركيا', GE: 'جورجيا', CY: 'قبرص', BH: 'البحرين',
  QA: 'قطر', OM: 'عُمان', KW: 'الكويت', JO: 'الأردن', LB: 'لبنان', IQ: 'العراق', EG: 'مصر', MA: 'المغرب',
  DZ: 'الجزائر', TN: 'تونس', LY: 'ليبيا', SD: 'السودان', SS: 'جنوب السودان', YE: 'اليمن', MR: 'موريتانيا',
  DJ: 'جيبوتي', SO: 'الصومال', KM: 'جزر القمر', AZ: 'أذربيجان', AM: 'أرمينيا', BY: 'بيلاروسيا',
  UA: 'أوكرانيا', AT: 'النمسا', CH: 'سويسرا', DE: 'ألمانيا', FR: 'فرنسا', IT: 'إيطاليا', ES: 'إسبانيا',
  PT: 'البرتغال', GR: 'اليونان', IN: 'الهند', PK: 'باكستان', CN: 'الصين', JP: 'اليابان', TH: 'تايلاند',
  MY: 'ماليزيا', ID: 'إندونيسيا', PH: 'الفلبين', SG: 'سنغافورة', LK: 'سريلانكا', MV: 'جزر المالديف',
  NP: 'نيبال', BD: 'بنغلاديش', AF: 'أفغانستان', UZ: 'أوزبكستان', KZ: 'كازاخستان', KG: 'قيرغيزستان',
  TJ: 'طاجيكستان', TM: 'تركمانستان', MN: 'منغوليا', AU: 'أستراليا', NZ: 'نيوزيلندا', CA: 'كندا',
  MX: 'المكسيك', BR: 'البرازيل', AR: 'الأرجنتين', CL: 'تشيلي', UY: 'الأوروغواي', PY: 'باراغواي',
  PE: 'بيرو', CO: 'كولومبيا', EC: 'الإكوادور', ZA: 'جنوب أفريقيا', NG: 'نيجيريا', KE: 'كينيا',
  ET: 'إثيوبيا', ER: 'إريتريا', SN: 'السنغال', GH: 'غانا', BE: 'بلجيكا', LU: 'لوكسمبورغ', IE: 'أيرلندا',
  IS: 'آيسلندا', NO: 'النرويج', SE: 'السويد', FI: 'فنلندا', DK: 'الدنمارك', PL: 'بولندا', HU: 'المجر',
  RO: 'رومانيا', BG: 'بلغاريا', RS: 'صربيا', HR: 'كرواتيا', SI: 'سلوفينيا', SK: 'سلوفاكيا', ME: 'الجبل الأسود',
  AL: 'ألبانيا', MT: 'مالطا', MC: 'موناكو', SM: 'سان مارينو', AD: 'أندورا', LI: 'ليختنشتاين', EE: 'إستونيا',
  LV: 'لاتفيا', LT: 'ليتوانيا', GL: 'غرينلاند', AQ: 'القارة القطبية الجنوبية', SC: 'سيشل', MU: 'موريشيوس',
  MG: 'مدغشقر', CU: 'كوبا', JM: 'جامايكا', PR: 'بورتوريكو', PA: 'بنما', CR: 'كوستاريكا', GT: 'غواتيمالا',
  HN: 'هندوراس', SV: 'السلفادور', NI: 'نيكاراغوا', BZ: 'بليز', HT: 'هايتي', BS: 'جزر البهاما',
  BB: 'باربادوس', TT: 'ترينيداد وتوباغو', FJ: 'فيجي', PG: 'بابوا غينيا الجديدة', KH: 'كمبوديا', BT: 'بوتان',
  RE: 'ريونيون', GF: 'غويانا الفرنسية', GP: 'غوادلوب', MQ: 'مارتينيك', YT: 'مايوت', NC: 'كاليدونيا الجديدة',
  PF: 'بولينيزيا الفرنسية', BQ: 'الجزر الكاريبية الهولندية', CW: 'كوراساو', AW: 'أروبا', SX: 'سينت مارتن',
  GI: 'جبل طارق', SJ: 'سفالبارد ويان ماين', BV: 'جزيرة بوفيه', CX: 'جزيرة عيد الميلاد', CC: 'جزر كوكوس',
  TK: 'توكيلاو', UM: 'جزر الولايات المتحدة الصغيرة النائية', FO: 'جزر فارو', IM: 'جزيرة مان', JE: 'جيرسي',
  GG: 'غيرنزي', BM: 'برمودا', KY: 'جزر كايمان', VG: 'جزر العذراء البريطانية', VI: 'جزر العذراء الأمريكية',
  AX: 'جزر أولاند', EH: 'الصحراء الغربية', GS: 'جورجيا الجنوبية وجزر ساندويتش الجنوبية', HM: 'جزيرة هيرد وجزر ماكدونالد',
  TF: 'أقاليم فرنسا الجنوبية', IO: 'إقليم المحيط الهندي البريطاني', FK: 'جزر فوكلاند', SH: 'سانت هيلينا',
  PM: 'سان بيير وميكلون', BL: 'سان بارتيلمي', MF: 'سانت مارتن الفرنسية', WF: 'واليس وفوتونا', NF: 'جزيرة نورفولك',
  CK: 'جزر كوك', NU: 'نييوي', PN: 'جزر بيتكيرن', AS: 'ساموا الأمريكية', GU: 'غوام', MP: 'جزر ماريانا الشمالية',
  MH: 'جزر مارشال', PW: 'بالاو', NR: 'ناورو', TV: 'توفالو', KI: 'كيريباتي', SB: 'جزر سليمان', VU: 'فانواتو',
  WS: 'ساموا', TO: 'تونغا', LC: 'سانت لوسيا', GD: 'غرينادا', DM: 'دومينيكا', AG: 'أنتيغوا وباربودا',
  AI: 'أنغويلا', MS: 'مونتسرات', TC: 'جزر توركس وكايكوس', SR: 'سورينام', GY: 'غيانا', GN: 'غينيا',
  SL: 'سيراليون', LR: 'ليبيريا', ML: 'مالي', NE: 'النيجر', BF: 'بوركينا فاسو', TD: 'تشاد', CM: 'الكاميرون',
  GA: 'الغابون', AO: 'أنغولا', ZM: 'زامبيا', ZW: 'زيمبابوي', MZ: 'موزمبيق', MW: 'مالاوي', NA: 'ناميبيا',
  BW: 'بوتسوانا', LS: 'ليسوتو', UG: 'أوغندا', RW: 'رواندا', BI: 'بوروندي', BJ: 'بنين', TG: 'توغو', GM: 'غامبيا'
};

// territories that Natural Earth draws as part of another country: their islands are split off by
// distance from the territory's own position (parent → max distance in km)
const SPLIT_FROM = {
  GF: ['FR', 450], GP: ['FR', 120], MQ: ['FR', 80], RE: ['FR', 120], YT: ['FR', 60],
  SJ: ['NO', 650], BQ: ['NL', 120], CX: ['AU', 120], CC: ['AU', 120]
};
// unrecognised entities in Natural Earth: drawn as part of the ISO country
const MERGE_INTO = { SOL: 'SO', CYN: 'CY', ATC: 'AU' };

const polys = []; // { cc, coords, from }
for (const f of ne50.features) {
  const p = f.properties;
  let cc = MERGE_INTO[p.ADM0_A3] || (p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : '');
  if (p.ADM0_A3 === 'IOA') cc = 'AU';
  const g = f.geometry;
  const parts = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const coords of parts) polys.push({ cc, coords, from: p.ADM0_A3 });
}
const wcBy = new Map(wc.map(c => [c.cca2, c]));
for (const [cc, [parent, maxKm]] of Object.entries(SPLIT_FROM)) {
  const c = wcBy.get(cc);
  const at = [c.latlng[1], c.latlng[0]];
  let n = 0;
  for (const p of polys) {
    if (p.cc !== parent) continue;
    const poly = { type: 'Polygon', coordinates: p.coords };
    const km = geoDistance(geoCentroid(poly), at) * 6371;
    if (km <= maxKm || geoContains(poly, at)) { p.cc = cc; n++; }
  }
  if (!n) console.warn('  no polygon found for', cc);
}
// one MultiPolygon per country
const geoms = new Map();
for (const p of polys) {
  const k = p.cc || '__';
  if (!geoms.has(k)) geoms.set(k, []);
  geoms.get(k).push(p.coords);
}
const features = [];
for (const [cc, parts] of geoms) {
  if (cc !== '__' && !wcBy.has(cc)) { console.warn('  dropping unknown', cc); continue; }
  features.push({ type: 'Feature', id: cc === '__' ? '' : cc, properties: {}, geometry: { type: 'MultiPolygon', coordinates: parts } });
}

function makeTopo(minWeightQuantile, q) {
  let t = topology({ countries: { type: 'FeatureCollection', features } });
  t = presimplify(t, sphericalTriangleArea);
  t = simplify(t, quantile(t, minWeightQuantile));
  t.arcs = t.arcs.map(a => a.map(pt => [pt[0], pt[1]]));
  t = quantize(t, q);
  for (const g of t.objects.countries.geometries) delete g.properties;
  return t;
}
console.log('map:');
// quantile = share of the points kept
write('world-hi.json', makeTopo(0.5, 1e5));
write('world-lo.json', makeTopo(0.1, 1e4));

// population from Natural Earth (whole country); the split-off territories get their own share
const pop = new Map();
for (const f of ne50.features) {
  const p = f.properties;
  const cc = MERGE_INTO[p.ADM0_A3] || (p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : '');
  if (cc && p.POP_EST > 0 && p.ADM0_A3 !== 'IOA' && p.ADM0_A3 !== 'ATC') pop.set(cc, (pop.get(cc) || 0) + p.POP_EST);
}
// rough populations for territories Natural Earth counts inside another country (2020s estimates)
const TERR_POP = { GF: 295000, GP: 384000, MQ: 350000, RE: 885000, YT: 320000, SJ: 2900, BQ: 30000, CX: 1700, CC: 600, GI: 33000, TK: 1600, UM: 300, BV: 0 };
for (const [cc, n] of Object.entries(TERR_POP)) {
  pop.set(cc, n);
  const parent = SPLIT_FROM[cc] && SPLIT_FROM[cc][0];
  if (parent && pop.has(parent)) pop.set(parent, pop.get(parent) - n);
}

// label positions (Natural Earth's own, chosen to sit well inside each country)
const labelAt = new Map();
for (const f of ne50.features) {
  const p = f.properties;
  const cc = MERGE_INTO[p.ADM0_A3] ? '' : (p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : '');
  if (cc && p.ADM0_A3 !== 'IOA' && p.ADM0_A3 !== 'ATC' && p.LABEL_Y != null) labelAt.set(cc, [+p.LABEL_Y.toFixed(2), +p.LABEL_X.toFixed(2)]);
}

// capitals (Arabic names from Natural Earth places)
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const placesByCC = new Map();
for (const p of places) {
  const cc = p.ISO_A2;
  if (!placesByCC.has(cc)) placesByCC.set(cc, []);
  placesByCC.get(cc).push(p);
}
function capitalOf(c) {
  const list = placesByCC.get(c.cca2) || [];
  return (c.capital || []).map(name => {
    const n = norm(name);
    let hit = list.find(p => norm(p.NAME_EN) === n || norm(p.NAME) === n || norm(p.NAMEASCII) === n || norm(p.NAMEALT) === n);
    if (!hit) hit = list.find(p => p.ADM0CAP === 1 && (norm(p.NAME).includes(n) || n.includes(norm(p.NAME))));
    if (!hit && c.capital.length === 1) { const caps = list.filter(p => p.ADM0CAP === 1); if (caps.length === 1) hit = caps[0]; }
    return hit ? { en: name, ar: hit.NAME_AR || '', lat: +hit.LATITUDE.toFixed(4), lon: +hit.LONGITUDE.toFixed(4) } : { en: name, ar: '' };
  });
}
const CAP_AR_FIX = {
  KW: 'مدينة الكويت', VA: 'الفاتيكان', SG: 'سنغافورة', MC: 'موناكو', BH: 'المنامة', QA: 'الدوحة', AE: 'أبوظبي',
  XK: 'بريشتينا', MN: 'أولان باتور', HK: 'هونغ كونغ', MO: 'ماكاو', EH: 'العيون', GI: 'جبل طارق', BQ: 'كرالنديك',
  YT: 'مامودزو', VI: 'شارلوت أمالي', VG: 'رود تاون', JE: 'سانت هيلير', GG: 'سانت بيتر بورت', PW: 'نجيرولمود', NR: 'يارين'
};

const countries = wc.map(c => {
  const cap = capitalOf(c);
  if (CAP_AR_FIX[c.cca2] && cap[0]) cap[0].ar = CAP_AR_FIX[c.cca2];
  for (const k of cap) if (k.lat == null) { k.lat = +c.latlng[0].toFixed(3); k.lon = +c.latlng[1].toFixed(3); }
  return {
    c: c.cca2, a3: c.cca3, n3: c.ccn3 || '',
    ar: AR_FIX[c.cca2] || (c.translations.ara && c.translations.ara.common) || c.name.common,
    arf: (c.translations.ara && c.translations.ara.official) || '',
    en: c.name.common, enf: c.name.official,
    cont: CONT(c), sub: c.subregion || '',
    cap,
    ll: [+c.latlng[0].toFixed(3), +c.latlng[1].toFixed(3)],
    area: Math.max(0, Math.round(c.area)),
    pop: pop.get(c.cca2) || 0,
    un: c.unMember && c.cca2 !== 'VA' ? 1 : 0, // world-countries lists the Vatican; it is an observer, like Palestine ind: c.independent ? 1 : 0,
    cur: Object.entries(c.currencies || {}).map(([k, v]) => [k, v.name, v.symbol || '']),
    lang: Object.entries(c.languages || {}), // [ISO 639-3, English name]
    b: (c.borders || []).map(a3 => byA3.get(a3)).filter(Boolean),
    lk: c.landlocked ? 1 : 0,
    idd: c.idd && c.idd.root ? c.idd.root + (c.idd.suffixes && c.idd.suffixes.length === 1 ? c.idd.suffixes[0] : '') : '',
    g: geoms.has(c.cca2) ? 1 : 0,
    lp: labelAt.get(c.cca2) || [+c.latlng[0].toFixed(2), +c.latlng[1].toFixed(2)]
  };
}).sort((a, b) => a.en.localeCompare(b.en));
const unList = countries.filter(c => c.un).map(c => c.c);
console.log('countries:', countries.length, 'UN members:', unList.length, 'with shape:', countries.filter(c => c.g).length);
write('countries.json', countries);

/* ---------------- cities ---------------- */
const cities = require('all-the-cities');
const ccSet = new Set(countries.map(c => c.c));
const CC = [...ccSet].sort();
const ccIdx = new Map(CC.map((c, i) => [c, i]));
const rows = new Map(); // key -> row
// Natural Earth places first (they carry Arabic names)
const neByGeo = new Map();
for (const p of places) {
  let cc = p.ISO_A2;
  if (!ccSet.has(cc)) {
    const a = byA3.get(p.ADM0_A3) || byA3.get(p.SOV_A3);
    if (a) cc = a; else continue;
  }
  const kind = p.ADM0CAP === 1 || /Admin-0 capital/.test(p.FEATURECLA) ? 2 : (/Admin-1 capital/.test(p.FEATURECLA) ? 1 : 0);
  const r = {
    en: p.NAME_EN || p.NAME, ar: p.NAME_AR || '', cc, lat: p.LATITUDE, lon: p.LONGITUDE,
    pop: Math.max(p.POP_MAX || 0, p.POP_MIN || 0), kind, alt: p.NAMEASCII && p.NAMEASCII !== (p.NAME_EN || p.NAME) ? p.NAMEASCII : ''
  };
  const key = 'n' + p.NE_ID;
  rows.set(key, r);
  if (p.GEONAMESID > 0) neByGeo.set(String(p.GEONAMESID), key);
}
// GeoNames: merge with the matching Natural Earth place, or add
const neGrid = new Map();
const cell = (lat, lon) => Math.floor(lat) + ':' + Math.floor(lon);
for (const [k, r] of rows) {
  const key = cell(r.lat, r.lon);
  if (!neGrid.has(key)) neGrid.set(key, []);
  neGrid.get(key).push(k);
}
const nearNE = (cc, lat, lon, name) => {
  const n = norm(name);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    for (const k of neGrid.get(cell(lat + a, lon + b)) || []) {
      const r = rows.get(k);
      if (r.cc !== cc) continue;
      const d = geoDistance([lon, lat], [r.lon, r.lat]) * 6371;
      if (d < 25 && (norm(r.en) === n || norm(r.alt) === n || d < 4)) return k;
    }
  }
  return null;
};
let merged = 0, added = 0;
for (const c of cities) {
  if (!ccSet.has(c.country)) continue;
  const [lon, lat] = c.loc.coordinates;
  const kind = c.featureCode === 'PPLC' ? 2 : (c.featureCode === 'PPLA' ? 1 : 0);
  const nk = neByGeo.get(String(c.cityId)) || nearNE(c.country, lat, lon, c.name);
  if (nk) {
    const r = rows.get(nk);
    r.pop = Math.max(r.pop, c.population || 0);
    if (!r.alt && c.name !== r.en) r.alt = c.name;
    merged++;
    continue;
  }
  rows.set('g' + c.cityId, { en: c.name, ar: '', cc: c.country, lat, lon, pop: c.population || 0, kind, alt: '' });
  added++;
}
console.log('cities: Natural Earth', places.length, '— GeoNames merged', merged, 'added', added);
const list = [...rows.values()].sort((a, b) => b.pop - a.pop);
// columns, so the file stays small: names one per line, country index, lat/lon in 1/1000 degree,
// population in hundreds, kind (2 national capital, 1 province capital, 0 other)
const out = { v: 1, cc: CC, en: '', ar: '', alt: '', c: [], lat: [], lon: [], pop: [], k: [] };
const clean = s => String(s || '').replace(/[\r\n]+/g, ' ').trim();
out.en = list.map(r => clean(r.en)).join('\n');
out.ar = list.map(r => clean(r.ar)).join('\n');
out.alt = list.map(r => clean(r.alt)).join('\n');
for (const r of list) {
  out.c.push(ccIdx.get(r.cc)); out.lat.push(Math.round(r.lat * 1000)); out.lon.push(Math.round(r.lon * 1000));
  out.pop.push(Math.round(r.pop / 100)); out.k.push(r.kind);
}
write('cities.json', out);

/* ---------------- airports ---------------- */
function parseCSV(text) {
  const out = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n') { row.push(f); out.push(row); row = []; f = ''; }
    else if (ch !== '\r') f += ch;
  }
  if (f || row.length) { row.push(f); out.push(row); }
  return out;
}
const csv = parseCSV(fs.readFileSync(path.join(AIR_DIR, 'airports.csv'), 'utf8'));
const H = csv.shift();
const col = n => H.indexOf(n);
const I = { type: col('type'), name: col('name'), lat: col('latitude_deg'), lon: col('longitude_deg'), cc: col('iso_country'), muni: col('municipality'), sched: col('scheduled_service'), iata: col('iata_code') };
const airports = { v: 1, cc: CC, iata: [], name: [], city: [], cityAr: [], c: [], lat: [], lon: [], big: [] };
const seen = new Set();
const arCities = [...rows.values()].filter(r => r.ar);
const arGrid = new Map();
for (const r of arCities) { const k = cell(r.lat, r.lon); if (!arGrid.has(k)) arGrid.set(k, []); arGrid.get(k).push(r); }
for (const r of csv) {
  const type = r[I.type];
  if (!(type === 'large_airport' || type === 'medium_airport')) continue;
  const iata = (r[I.iata] || '').trim();
  if (!/^[A-Z]{3}$/.test(iata) || r[I.sched] !== 'yes' || seen.has(iata)) continue;
  let cc = r[I.cc];
  if (cc === 'XK') cc = 'XK';
  if (!ccIdx.has(cc)) continue;
  const lat = +r[I.lat], lon = +r[I.lon];
  let best = null, bd = 60;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const x of arGrid.get(cell(lat + a, lon + b)) || []) {
    if (x.cc !== cc) continue;
    const d = geoDistance([lon, lat], [x.lon, x.lat]) * 6371;
    const muni = norm(r[I.muni]);
    const score = d - (muni && (norm(x.en) === muni || norm(x.alt) === muni) ? 40 : 0) - Math.log10(x.pop + 10) * 3;
    if (score < bd) { bd = score; best = x; }
  }
  seen.add(iata);
  airports.iata.push(iata); airports.name.push(r[I.name]); airports.city.push(r[I.muni] || '');
  airports.cityAr.push(best ? best.ar : ''); airports.c.push(ccIdx.get(cc));
  airports.lat.push(Math.round(lat * 1000)); airports.lon.push(Math.round(lon * 1000)); airports.big.push(type === 'large_airport' ? 1 : 0);
}
console.log('airports:', airports.iata.length);
write('airports.json', airports);
