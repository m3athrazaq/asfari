// The offline reference data: countries, map shapes, cities, airports — all shipped with the app.
import { feature } from 'topojson-client';
import { geoBounds, geoContains } from 'd3-geo';
import { normText, searchKey, matchScore, haversine } from './util.js';

export const COUNTRIES = [];          // filled by loadCountries()
export const C = new Map();           // code -> country

export const CONTINENTS = ['as', 'eu', 'af', 'na', 'sa', 'oc', 'an'];

// groups used by stats and badges (ISO codes)
export const GROUPS = {
  gcc: ['KW', 'SA', 'AE', 'QA', 'BH', 'OM'],
  arab: ['DZ', 'BH', 'KM', 'DJ', 'EG', 'IQ', 'JO', 'KW', 'LB', 'LY', 'MR', 'MA', 'OM', 'PS', 'QA', 'SA', 'SO', 'SD', 'SY', 'TN', 'AE', 'YE'],
  oic: ['AF', 'AL', 'DZ', 'AZ', 'BH', 'BD', 'BJ', 'BN', 'BF', 'CM', 'TD', 'KM', 'CI', 'DJ', 'EG', 'GA', 'GM', 'GN', 'GW', 'GY', 'ID', 'IR', 'IQ', 'JO', 'KZ', 'KW', 'KG', 'LB', 'LY', 'MY', 'MV', 'ML', 'MR', 'MA', 'MZ', 'NE', 'NG', 'OM', 'PK', 'PS', 'QA', 'SA', 'SN', 'SL', 'SO', 'SD', 'SR', 'SY', 'TJ', 'TG', 'TN', 'TR', 'TM', 'UG', 'AE', 'UZ', 'YE'],
  // Schengen area (29 states, 2025–2026); Monaco, San Marino and the Vatican are reached only through it
  schengen: ['AT', 'BE', 'BG', 'HR', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IS', 'IT', 'LV', 'LI', 'LT', 'LU', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'CH'],
  schengenLinked: ['MC', 'SM', 'VA'],
  eu: ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'],
  g20: ['AR', 'AU', 'BR', 'CA', 'CN', 'FR', 'DE', 'IN', 'ID', 'IT', 'JP', 'KR', 'MX', 'RU', 'SA', 'ZA', 'TR', 'GB', 'US'],
  asean: ['BN', 'KH', 'ID', 'LA', 'MY', 'MM', 'PH', 'SG', 'TH', 'VN', 'TL'],
  levant: ['SY', 'LB', 'JO', 'PS'],
  maghreb: ['DZ', 'LY', 'MR', 'MA', 'TN'],
  caucasus: ['GE', 'AM', 'AZ'],
  balkans: ['AL', 'BA', 'BG', 'HR', 'XK', 'ME', 'MK', 'RS', 'SI'],
  centralAsia: ['KZ', 'KG', 'TJ', 'TM', 'UZ'],
  micro: ['AD', 'LI', 'MT', 'MC', 'SM', 'VA'],
  nordic: ['DK', 'FI', 'IS', 'NO', 'SE'],
  // countries of the places Ibn Battuta travelled through (1325–1354), in today's borders
  ibnBattuta: ['MA', 'DZ', 'TN', 'LY', 'EG', 'PS', 'LB', 'SY', 'SA', 'IQ', 'IR', 'YE', 'OM', 'BH', 'SO', 'KE', 'TZ', 'TR', 'UA', 'RU', 'KZ', 'UZ', 'TM', 'AF', 'PK', 'IN', 'MV', 'LK', 'BD', 'ID', 'MY', 'CN', 'ES', 'ML', 'NE', 'MR'],
  // countries of the New Seven Wonders of the World
  wonders: ['CN', 'JO', 'BR', 'PE', 'MX', 'IT', 'IN']
};

async function getJSON(url) {
  const r = await fetch(url, { cache: 'force-cache' });
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return r.json();
}

/* ---------------- countries ---------------- */
export async function loadCountries() {
  if (COUNTRIES.length) return COUNTRIES;
  const list = await getJSON('data/countries.json');
  for (const c of list) {
    c.sov = c.un || c.c === 'VA' || c.c === 'PS' ? 1 : 0; // the 195 commonly counted states
    c.capName = c.cap && c.cap[0] ? c.cap[0] : null;
    c.k1 = searchKey(c.ar); c.k2 = searchKey(c.en); c.k3 = searchKey(c.enf || '');
    COUNTRIES.push(c);
    C.set(c.c, c);
  }
  return COUNTRIES;
}
export function searchCountries(q, lang) {
  const n = normText(q), k = searchKey(q);
  if (!n) return [];
  const res = [];
  for (const c of COUNTRIES) {
    let s = Math.max(matchScore(k, n, c.ar), matchScore(k, n, c.en), matchScore(k, n, c.enf) * 0.8);
    if (q.length === 2 && q.toUpperCase() === c.c) s = Math.max(s, 90);
    if (q.length === 3 && q.toUpperCase() === c.a3) s = Math.max(s, 85);
    if (s) res.push([s + (c.sov ? 2 : 0), c]);
  }
  return res.sort((a, b) => b[0] - a[0] || (lang === 'ar' ? a[1].ar.localeCompare(b[1].ar, 'ar') : a[1].en.localeCompare(b[1].en))).map(r => r[1]);
}

/* ---------------- map shapes ---------------- */
const worlds = {};
export async function loadWorld(level = 'hi') {
  if (worlds[level]) return worlds[level];
  const topo = await getJSON(`data/world-${level}.json`);
  const fc = feature(topo, topo.objects.countries);
  for (const f of fc.features) {
    f.bbox2 = geoBounds(f);
  }
  worlds[level] = fc.features;
  return fc.features;
}
export const worldIfLoaded = level => worlds[level] || null;

/* ---------------- cities (≈133,000 places, lazy) ---------------- */
let CITIES = null, citiesPromise = null;
export function loadCities() {
  if (CITIES) return Promise.resolve(CITIES);
  if (!citiesPromise) citiesPromise = getJSON('data/cities.json').then(d => {
    const en = d.en.split('\n'), ar = d.ar.split('\n'), alt = d.alt.split('\n');
    const n = en.length;
    const out = { n, en, ar, alt, cc: d.c.map(i => d.cc[i]), lat: Float32Array.from(d.lat, v => v / 1000), lon: Float32Array.from(d.lon, v => v / 1000), pop: Uint32Array.from(d.pop, v => v * 100), k: Uint8Array.from(d.k), keys: null, grid: null };
    // search keys are built on first search
    CITIES = out;
    return out;
  }).catch(e => { citiesPromise = null; throw e; });
  return citiesPromise;
}
export const citiesIfLoaded = () => CITIES;
function ensureKeys(D) {
  if (D.keys) return;
  const kn = new Array(D.n), ka = new Array(D.n), kalt = new Array(D.n);
  for (let i = 0; i < D.n; i++) { kn[i] = searchKey(D.en[i]); ka[i] = D.ar[i] ? searchKey(D.ar[i]) : ''; kalt[i] = D.alt[i] ? searchKey(D.alt[i]) : ''; }
  D.keys = { kn, ka, kalt };
}
export const cityRef = (D, i) => ({
  ref: D.cc[i] + ':' + D.en[i] + '@' + D.lat[i].toFixed(2) + ',' + D.lon[i].toFixed(2),
  name: D.ar[i] || D.en[i], nameEn: D.en[i], cc: D.cc[i], lat: +D.lat[i].toFixed(4), lon: +D.lon[i].toFixed(4),
  pop: D.pop[i], kind: D.k[i]
});
/** cities matching a query (Arabic or English), optionally in one country; best first */
export function searchCities(D, q, { cc = '', limit = 40 } = {}) {
  ensureKeys(D);
  const k = searchKey(q), n = normText(q);
  if (!k) return [];
  const res = [];
  const { kn, ka, kalt } = D.keys;
  for (let i = 0; i < D.n; i++) {
    if (cc && D.cc[i] !== cc) continue;
    let s = 0;
    const a = kn[i], b = ka[i], c = kalt[i];
    if (a === k || b === k || c === k) s = 100;
    else if (a.startsWith(k) || (b && b.startsWith(k)) || (c && c.startsWith(k))) s = 70;
    else if (k.length >= 3 && (a.includes(k) || (b && b.includes(k)))) s = 35;
    if (!s) continue;
    // bigger places first; capitals a little higher
    s += Math.log10(D.pop[i] + 10) * 4 + D.k[i] * 3;
    res.push([s, i]);
  }
  res.sort((x, y) => y[0] - x[0]);
  return res.slice(0, limit).map(r => cityRef(D, r[1]));
}
function buildGrid(D) {
  if (D.grid) return;
  const g = new Map();
  for (let i = 0; i < D.n; i++) {
    const key = Math.floor(D.lat[i]) * 1000 + Math.floor(D.lon[i]);
    let a = g.get(key); if (!a) g.set(key, a = []); a.push(i);
  }
  D.grid = g;
}
/** places near a point (km), nearest and biggest first */
export function nearestCities(D, lat, lon, { radius = 40, limit = 8, cc = '' } = {}) {
  buildGrid(D);
  const res = [];
  const dl = Math.ceil(radius / 111) + 1;
  const dlo = Math.ceil(radius / (111 * Math.max(0.15, Math.cos(lat * Math.PI / 180)))) + 1;
  for (let a = -dl; a <= dl; a++) for (let b = -dlo; b <= dlo; b++) {
    const key = (Math.floor(lat) + a) * 1000 + (((Math.floor(lon) + b + 180) % 360 + 360) % 360 - 180);
    for (const i of D.grid.get(key) || []) {
      if (cc && D.cc[i] !== cc) continue;
      const d = haversine(lat, lon, D.lat[i], D.lon[i]);
      if (d <= radius) res.push([d - Math.log10(D.pop[i] + 10) * 1.5, d, i]);
    }
  }
  res.sort((x, y) => x[0] - y[0]);
  return res.slice(0, limit).map(r => ({ ...cityRef(D, r[2]), km: r[1] }));
}

/* ---------------- airports (≈3,200 with scheduled flights, lazy) ---------------- */
let AIRPORTS = null, airportsPromise = null;
export function loadAirports() {
  if (AIRPORTS) return Promise.resolve(AIRPORTS);
  if (!airportsPromise) airportsPromise = getJSON('data/airports.json').then(d => {
    const list = d.iata.map((code, i) => ({
      code, name: d.name[i], city: d.city[i], cityAr: d.cityAr[i], cc: d.cc[d.c[i]],
      lat: d.lat[i] / 1000, lon: d.lon[i] / 1000, big: d.big[i]
    }));
    for (const a of list) { a.k = searchKey(a.name); a.kc = searchKey(a.city); a.ka = a.cityAr ? searchKey(a.cityAr) : ''; }
    AIRPORTS = { list, byCode: new Map(list.map(a => [a.code, a])) };
    return AIRPORTS;
  }).catch(e => { airportsPromise = null; throw e; });
  return airportsPromise;
}
export const airportsIfLoaded = () => AIRPORTS;
export function searchAirports(A, q, limit = 30) {
  const up = q.trim().toUpperCase();
  const k = searchKey(q);
  if (!k) return [];
  const res = [];
  for (const a of A.list) {
    let s = 0;
    if (a.code === up) s = 200;
    else if (up.length <= 3 && a.code.startsWith(up)) s = 90;
    if (a.kc === k || a.ka === k) s = Math.max(s, 120);
    else if (a.kc.startsWith(k) || (a.ka && a.ka.startsWith(k))) s = Math.max(s, 80);
    if (a.k.includes(k)) s = Math.max(s, 60);
    const c = C.get(a.cc);
    if (!s && c && (c.k1 === k || c.k2 === k)) s = 50;
    if (s) res.push([s + a.big * 15, a]);
  }
  return res.sort((x, y) => y[0] - x[0]).slice(0, limit).map(r => r[1]);
}
export function nearestAirport(A, lat, lon, maxKm = 150) {
  let best = null, bd = maxKm;
  for (const a of A.list) {
    const d = haversine(lat, lon, a.lat, a.lon) - a.big * 25;
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}

/** the country under a point (needs the map shapes loaded) */
export function countryAtPoint(lon, lat) {
  const fs = worlds.hi || worlds.lo;
  if (!fs) return null;
  for (const f of fs) {
    if (!f.id) continue;
    const b = f.bbox2;
    const inLat = lat >= b[0][1] - 0.01 && lat <= b[1][1] + 0.01;
    const inLon = b[0][0] <= b[1][0] ? lon >= b[0][0] - 0.01 && lon <= b[1][0] + 0.01 : lon >= b[0][0] || lon <= b[1][0];
    if (inLat && inLon && geoContains(f, [lon, lat])) return f.id;
  }
  return null;
}
