// The app's data: shape, validation (everything read from storage or from an Excel file is untrusted),
// saving on the device, and the actions the screens use.
import { signal, batch } from '@preact/signals';
import { C } from './data.js';
import { uid, parseDate, finite, has, todayISO, dayStart, dayEnd, todayDay, haversine } from './util.js';
import { idbGet, idbPut } from './idb.js';
import { isNative, readNativeState, writeNativeState } from './native.js';

export const STATE_VERSION = 1;
export const STATUSES = ['visited', 'lived', 'transit', 'wish'];
export const PURPOSES = ['leisure', 'business', 'family', 'umrah', 'hajj', 'study', 'medical', 'event', 'transit', 'other'];
export const MODES = ['flight', 'car', 'train', 'bus', 'ship', 'other'];
export const LIMITS = { trips: 5000, cities: 20000, stops: 200, legs: 200, photos: 5000, with: 30, text: 120, note: 4000 };
const LS_KEY = 'asfari.state.v1';

/* ---------------- validation ---------------- */
const str = (v, max = LIMITS.text) => (v == null ? '' : String(v)).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
const note = v => str(v, LIMITS.note);
const date = v => { const s = str(v, 10); return parseDate(s) ? s : ''; };
const bool = v => v === true || v === 1 || v === 'true';
const oneOf = (v, list, d = '') => (list.includes(v) ? v : d);
const rate = v => Math.round(Math.min(5, Math.max(0, finite(+v, 0))));
const num = (v, min, max, d = 0) => { if (v == null || (typeof v === 'string' && !v.trim())) return d; const n = +v; return isFinite(n) && n >= min && n <= max ? n : d; };
const ID_RE = /^[a-z0-9]{4,32}$/;
export const validCC = cc => typeof cc === 'string' && C.has(cc);
const cur = v => (typeof v === 'string' && /^[A-Z]{3}$/.test(v) ? v : '');

export function defaultState() {
  return {
    v: STATE_VERSION, rev: 0, created: Date.now(), updated: Date.now(),
    profile: { name: '', home: '', homeCity: null },
    settings: {
      lang: 'ar', theme: 'auto', digits: 'latn', hijri: false,
      homeCounts: true, transitCounts: false, denominator: 'un', currency: 'KWD', mapMode: 'flat', onboarded: false
    },
    countries: {}, cities: [], trips: [], photos: {}, seen: {}, lastBackup: 0, lastBackupRev: 0
  };
}

function sPlace(p) {
  if (!p || typeof p !== 'object') return null;
  let lat = num(p.lat, -90, 90, NaN), lon = num(p.lon, -180, 180, NaN);
  const cc = validCC(p.cc) ? p.cc : '';
  if (!isFinite(lat) || !isFinite(lon)) {
    // no coordinates (a row typed by hand): the country's capital, else its centre
    const k = cc && C.get(cc);
    const cap = k && k.cap && k.cap.find(x => x.lat != null);
    if (cap) { lat = cap.lat; lon = cap.lon; } else if (k && k.ll) { lat = k.ll[0]; lon = k.ll[1]; } else return null;
  }
  return { name: str(p.name), nameEn: str(p.nameEn), cc, lat: +lat.toFixed(5), lon: +lon.toFixed(5), ref: str(p.ref, 160) };
}
function sCity(c) {
  if (!c || typeof c !== 'object') return null;
  const p = sPlace(c);
  if (!p || !p.cc || !(p.name || p.nameEn)) return null;
  return {
    id: c.id, ...p,
    s: oneOf(c.s, STATUSES, 'visited'), first: date(c.first), note: note(c.note), fav: bool(c.fav), rate: rate(c.rate),
    at: finite(+c.at, Date.now())
  };
}
function sEnd(e) {
  // an end of a transport leg: an airport, a city, home, or just a country
  if (!e || typeof e !== 'object') return null;
  const p = sPlace(e);
  if (!p) return null;
  return { k: oneOf(e.k, ['apt', 'city', 'home', 'cc'], 'city'), code: /^[A-Z]{3}$/.test(e.code) ? e.code : '', ...p };
}
/** a fresh id for anything whose id is missing, malformed or already used */
const uniqueId = (v, used) => { const id = typeof v === 'string' && ID_RE.test(v) && !used.has(v) ? v : uid(); used.add(id); return id; };
/** cityIds: the valid city ids; cityAlias: city ids as written in the file → the id the city got */
function sTrip(t, cityIds, photoIds, cityAlias) {
  if (!t || typeof t !== 'object') return null;
  const usedStops = new Set(), usedLegs = new Set();
  const cityOf = v => { if (v == null || v === '') return ''; v = String(v).trim(); const id = cityAlias && cityAlias.has(v) ? cityAlias.get(v) : v; return cityIds.has(id) ? id : ''; };
  const stops = (Array.isArray(t.stops) ? t.stops : []).slice(0, LIMITS.stops).map(s => {
    if (!s || !validCC(s.cc)) return null;
    return {
      id: uniqueId(s.id, usedStops), cc: s.cc, city: cityOf(s.city),
      from: date(s.from), to: date(s.to), transit: bool(s.transit), note: note(s.note)
    };
  }).filter(Boolean);
  const legs = (Array.isArray(t.legs) ? t.legs : []).slice(0, LIMITS.legs).map(l => {
    if (!l || typeof l !== 'object') return null;
    const a = sEnd(l.a), b = sEnd(l.b);
    if (!a || !b) return null;
    return { id: uniqueId(l.id, usedLegs), mode: oneOf(l.mode, MODES, 'flight'), a, b, date: date(l.date), carrier: str(l.carrier, 60), no: str(l.no, 16), note: note(l.note) };
  }).filter(Boolean);
  const withList = (Array.isArray(t.with) ? t.with : []).map(x => str(x, 60)).filter(Boolean).slice(0, LIMITS.with);
  let start = date(t.start), end = date(t.end);
  if (start && end && dayEnd(end) < dayStart(start)) [start, end] = [end, start];
  const photos = (Array.isArray(t.photos) ? t.photos : []).filter(p => typeof p === 'string' && photoIds.has(p));
  return {
    id: t.id, title: str(t.title), start, end, purpose: oneOf(t.purpose, PURPOSES, 'leisure'),
    with: [...new Set(withList)], rate: rate(t.rate), cost: num(t.cost, 0, 1e10, 0), cur: cur(t.cur), note: note(t.note),
    stops, legs, photos, cover: photos.includes(t.cover) ? t.cover : (photos[0] || ''),
    at: finite(+t.at, Date.now()), upd: finite(+t.upd, Date.now())
  };
}
/** turns anything (stored data, an import) into a valid state; never throws */
export function sanitizeState(raw) {
  const d = defaultState();
  if (!raw || typeof raw !== 'object') return d;
  const p = raw.profile || {};
  d.profile = { name: str(p.name, 80), home: validCC(p.home) ? p.home : '', homeCity: sPlace(p.homeCity) };
  if (d.profile.homeCity && !d.profile.homeCity.cc) d.profile.homeCity.cc = d.profile.home;
  const s = raw.settings || {};
  d.settings = {
    lang: oneOf(s.lang, ['ar', 'en'], 'ar'), theme: oneOf(s.theme, ['auto', 'light', 'dark'], 'auto'), digits: oneOf(s.digits, ['latn', 'arab'], 'latn'),
    hijri: bool(s.hijri), homeCounts: s.homeCounts == null ? true : bool(s.homeCounts), transitCounts: bool(s.transitCounts),
    denominator: oneOf(s.denominator, ['un', 'sov', 'all'], 'un'), currency: cur(s.currency) || 'KWD',
    mapMode: oneOf(s.mapMode, ['flat', 'globe'], 'flat'), onboarded: bool(s.onboarded)
  };
  const cs = raw.countries && typeof raw.countries === 'object' ? raw.countries : {};
  for (const k of Object.keys(cs).slice(0, 400)) {
    if (!validCC(k)) continue;
    const v = cs[k] || {};
    const e = { s: oneOf(v.s, STATUSES, ''), first: date(v.first), note: note(v.note), fav: bool(v.fav), rate: rate(v.rate) };
    if (e.s || e.first || e.note || e.fav || e.rate) d.countries[k] = e;
  }
  const photos = raw.photos && typeof raw.photos === 'object' ? raw.photos : {};
  for (const k of Object.keys(photos).slice(0, LIMITS.photos)) {
    if (!ID_RE.test(k)) continue;
    const v = photos[k] || {};
    d.photos[k] = { trip: str(v.trip, 32), city: str(v.city, 32), cap: str(v.cap, 300), date: date(v.date), w: num(v.w, 1, 20000, 0), h: num(v.h, 1, 20000, 0), bytes: num(v.bytes, 0, 5e7, 0) };
  }
  const seenIds = new Set();
  const cityAlias = new Map(); // a city's id as written (e.g. typed in Excel) → its id here
  for (const c of (Array.isArray(raw.cities) ? raw.cities : []).slice(0, LIMITS.cities)) {
    const x = sCity(c);
    if (!x) continue;
    const given = c.id == null ? '' : String(c.id).trim();
    x.id = uniqueId(c.id, seenIds);
    // an id that is not in the app's format (e.g. "c1" or "Paris" typed in Excel): stops written with it follow the city
    if (given && !ID_RE.test(given) && !cityAlias.has(given)) cityAlias.set(given, x.id);
    d.cities.push(x);
  }
  const photoIds = new Set(Object.keys(d.photos));
  const tripIds = new Set();
  for (const t of (Array.isArray(raw.trips) ? raw.trips : []).slice(0, LIMITS.trips)) {
    const x = sTrip(t, seenIds, photoIds, cityAlias);
    if (!x) continue;
    x.id = uniqueId(t.id, tripIds);
    d.trips.push(x);
  }
  for (const [k, v] of Object.entries(d.photos)) {
    if (v.trip && !tripIds.has(v.trip)) v.trip = '';
    if (v.city && !seenIds.has(v.city)) v.city = '';
  }
  const seen = raw.seen && typeof raw.seen === 'object' ? raw.seen : {};
  for (const k of Object.keys(seen).slice(0, 300)) if (/^[a-z0-9_-]{1,40}$/i.test(k)) d.seen[k] = date(seen[k]) || todayISO();
  d.rev = finite(+raw.rev, 0); d.created = finite(+raw.created, Date.now()); d.updated = finite(+raw.updated, Date.now());
  d.lastBackup = finite(+raw.lastBackup, 0); d.lastBackupRev = finite(+raw.lastBackupRev, 0);
  return d;
}

/* ---------------- state + saving ---------------- */
export const state = signal(defaultState());
export const saveError = signal(false);
let writeTimer = 0, pending = null;

async function writeAll(s) {
  const json = JSON.stringify(s);
  let saved = 0;
  try { await idbPut('kv', 'state', json); saved++; } catch (e) { /* storage blocked */ }
  try { localStorage.setItem(LS_KEY, json); saved++; } catch (e) { /* full: IndexedDB still has it */ }
  if (isNative) { try { await writeNativeState(json); saved++; } catch (e) { /* IndexedDB still has it */ } }
  saveError.value = saved === 0;
}
function schedule(s) {
  pending = s;
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => { const x = pending; pending = null; writeAll(x); }, 250);
}
export function flushSave() {
  if (!pending) return Promise.resolve();
  clearTimeout(writeTimer); const x = pending; pending = null;
  return writeAll(x);
}
addEventListener('pagehide', () => { flushSave(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSave();
  else if (state.value.settings.onboarded) promoteStartedTrips();
});

/** apply a change: fn gets a shallow copy of the state and returns nothing (mutate the copy) */
export function update(fn) {
  const s = { ...state.value };
  fn(s);
  s.rev = (state.value.rev || 0) + 1;
  s.updated = Date.now();
  state.value = s;
  schedule(s);
  return s;
}

export async function loadState() {
  const copies = [];
  try { const j = await idbGet('kv', 'state'); if (j) copies.push(JSON.parse(j)); } catch (e) { /* none */ }
  try { const j = localStorage.getItem(LS_KEY); if (j) copies.push(JSON.parse(j)); } catch (e) { /* none */ }
  if (isNative) { const n = await readNativeState(); if (n) copies.push(n); }
  let best = null;
  for (const c of copies) if (c && typeof c === 'object' && (!best || finite(+c.rev) > finite(+best.rev))) best = c;
  const s = sanitizeState(best);
  state.value = s;
  if (best) promoteStartedTrips();
  return { state: state.value, fresh: !best };
}

/* ---------------- actions ---------------- */
export function setProfile(patch) { update(s => { s.profile = { ...s.profile, ...patch }; }); }
export function setSettings(patch) { update(s => { s.settings = { ...s.settings, ...patch }; }); }

export function setCountry(cc, patch) {
  if (!validCC(cc)) return;
  update(s => {
    const cur0 = s.countries[cc] || { s: '', first: '', note: '', fav: false, rate: 0 };
    const e = { ...cur0, ...patch };
    const countries = { ...s.countries };
    if (e.s || e.first || e.note || e.fav || e.rate) countries[cc] = e; else delete countries[cc];
    s.countries = countries;
  });
}
/** many countries at once (quick picker) */
export function setCountriesStatus(codes, status) {
  update(s => {
    const countries = { ...s.countries };
    for (const cc of codes) {
      if (!validCC(cc)) continue;
      const e = { ...(countries[cc] || { s: '', first: '', note: '', fav: false, rate: 0 }), s: status };
      if (e.s || e.first || e.note || e.fav || e.rate) countries[cc] = e; else delete countries[cc];
    }
    s.countries = countries;
  });
}

/** the user's own city that matches a place (same reference, or same name nearby) */
export function findCity(s, place) {
  return s.cities.find(c => (place.ref && c.ref === place.ref) ||
    (c.cc === place.cc && (c.nameEn && place.nameEn ? c.nameEn === place.nameEn : c.name === place.name) && haversine(c.lat, c.lon, place.lat, place.lon) < 15)) || null;
}
/** adds a city (or returns the one already there); returns its id */
export function addCity(place, patch = {}) {
  let id = null;
  update(s => {
    const found = findCity(s, place);
    if (found) {
      id = found.id;
      if (Object.keys(patch).length) s.cities = s.cities.map(c => (c.id === id ? { ...c, ...strongerCity(c, patch) } : c));
      return;
    }
    const c = sCity({ ...place, ...patch, id: uid(), at: Date.now() });
    if (!c) return;
    id = c.id;
    s.cities = [...s.cities, c];
  });
  return id;
}
// adding a city that is already there never weakens it (a visited city does not go back to the wishlist)
const RANK = { wish: 0, transit: 1, visited: 2, lived: 3 };
function strongerCity(c, patch) {
  const p = { ...patch };
  if (!p.s || RANK[p.s] < RANK[c.s]) delete p.s;
  if (!p.first || (c.first && dayStart(c.first) <= dayStart(p.first))) delete p.first;
  return p;
}
/**
 * cities of trips that have happened: a city still on the wishlist (saved while the trip was planned)
 * becomes visited (or passed through), with the trip's date as its first visit. Returns null if nothing changes.
 */
function promoteCities(cities, trips) {
  const up = new Map(); // city id → { s, first }
  for (const t of trips) {
    if (!tripStarted(t)) continue;
    for (const x of t.stops) {
      if (!x.city) continue;
      const s = x.transit || t.purpose === 'transit' ? 'transit' : 'visited';
      const first = x.from || t.start || '';
      const cur0 = up.get(x.city);
      if (!cur0 || RANK[s] > RANK[cur0.s]) up.set(x.city, { s, first: cur0 && cur0.first && (!first || dayStart(cur0.first) < dayStart(first)) ? cur0.first : first });
      else if (first && (!cur0.first || dayStart(first) < dayStart(cur0.first))) cur0.first = first;
    }
  }
  let changed = false;
  const out = cities.map(c => {
    const u = up.get(c.id);
    if (!u || RANK[u.s] <= RANK[c.s]) return c;
    changed = true;
    return { ...c, s: u.s, first: c.first || u.first };
  });
  return changed ? out : null;
}
/** run when the app opens or comes back: trips that started since then move their cities off the wishlist */
export function promoteStartedTrips() {
  const promoted = promoteCities(state.value.cities, state.value.trips);
  if (promoted) update(s => { s.cities = promoted; });
}
export function updateCity(id, patch) {
  update(s => { s.cities = s.cities.map(c => (c.id === id ? sCity({ ...c, ...patch }) || c : c)); });
}
export function deleteCity(id) {
  let removed = null;
  update(s => {
    const c = s.cities.find(x => x.id === id);
    if (!c) return;
    const links = [];
    for (const t of s.trips) for (const x of t.stops) if (x.city === id) links.push([t.id, x.id]);
    removed = { ...c, links };
    s.cities = s.cities.filter(x => x.id !== id);
    s.trips = s.trips.map(t => (t.stops.some(x => x.city === id) ? { ...t, stops: t.stops.map(x => (x.city === id ? { ...x, city: '' } : x)) } : t));
  });
  return removed;
}

/** saves a trip (new or edited). Cities of a trip that already happened become "visited". */
export function saveTrip(trip) {
  let saved = null;
  update(s => {
    const cityIds = new Set(s.cities.map(c => c.id));
    const t = sTrip({ ...trip, upd: Date.now(), at: trip.at || Date.now() }, cityIds, new Set(Object.keys(s.photos)));
    if (!t) return;
    t.id = typeof trip.id === 'string' && ID_RE.test(trip.id) ? trip.id : uid();
    saved = t;
    const i = s.trips.findIndex(x => x.id === t.id);
    s.trips = i >= 0 ? s.trips.map(x => (x.id === t.id ? t : x)) : [...s.trips, t];
    const promoted = promoteCities(s.cities, [t]);
    if (promoted) s.cities = promoted;
    // photos that were attached to this trip but removed from it lose the link
    const photos = { ...s.photos };
    for (const [pid, p] of Object.entries(photos)) {
      if (p.trip === t.id && !t.photos.includes(pid)) photos[pid] = { ...p, trip: '' };
      if (t.photos.includes(pid) && p.trip !== t.id) photos[pid] = { ...p, trip: t.id };
    }
    s.photos = photos;
  });
  return saved;
}
export function deleteTrip(id) {
  let removed = null;
  update(s => {
    removed = s.trips.find(t => t.id === id) || null;
    s.trips = s.trips.filter(t => t.id !== id);
  });
  return removed;
}
/** puts a deleted trip/city back (undo) */
export function restoreTrip(t) { if (t) update(s => { if (!s.trips.some(x => x.id === t.id)) s.trips = [...s.trips, t]; }); }
export function restoreCity(removed) {
  if (!removed) return;
  const { links = [], ...c } = removed;
  update(s => {
    if (!s.cities.some(x => x.id === c.id)) s.cities = [...s.cities, c];
    const back = new Set(links.map(([tid, sid]) => tid + '/' + sid));
    if (back.size) s.trips = s.trips.map(t => (t.stops.some(x => back.has(t.id + '/' + x.id) && !x.city)
      ? { ...t, stops: t.stops.map(x => (back.has(t.id + '/' + x.id) && !x.city ? { ...x, city: c.id } : x)) } : t));
  });
}

export function markSeen(ids) {
  if (!ids.length) return;
  update(s => { s.seen = { ...s.seen }; for (const id of ids) if (!s.seen[id]) s.seen[id] = todayISO(); });
}
export function backupDone() { update(s => { s.lastBackup = Date.now(); s.lastBackupRev = s.rev + 1; }); }

/** replaces everything with restored data (keeps this device's language/theme if the file has none) */
export function replaceState(next) {
  const s = sanitizeState(next);
  s.rev = (state.value.rev || 0) + 1;
  s.updated = Date.now();
  s.settings.onboarded = true;
  state.value = s;
  schedule(s);
  return s;
}

/** deletes everything (keeps only how the app looks) and starts again with the welcome screens */
export function resetAll() {
  const keep = state.value.settings;
  const d = defaultState();
  d.settings = { ...d.settings, lang: keep.lang, theme: keep.theme, digits: keep.digits, onboarded: false };
  d.rev = (state.value.rev || 0) + 1;
  state.value = d;
  schedule(d);
  return flushSave();
}

/** merges restored data into what is here: nothing already here is lost */
export function mergeState(incoming) {
  const inc = sanitizeState(incoming);
  return update(s => {
    const countries = { ...s.countries };
    for (const [k, v] of Object.entries(inc.countries)) {
      const cur0 = countries[k];
      if (!cur0) { countries[k] = v; continue; }
      const st = !cur0.s ? v.s : (v.s && RANK[v.s] > RANK[cur0.s] ? v.s : cur0.s);
      const first = cur0.first && v.first ? (dayStart(v.first) < dayStart(cur0.first) ? v.first : cur0.first) : (cur0.first || v.first);
      countries[k] = { s: st, first, note: cur0.note || v.note, fav: cur0.fav || v.fav, rate: cur0.rate || v.rate };
    }
    s.countries = countries;
    // cities: same id or same place → one city
    const cities = [...s.cities];
    const idMap = new Map();
    for (const c of inc.cities) {
      const same = cities.find(x => x.id === c.id) || findCity({ cities }, c);
      if (same) { idMap.set(c.id, same.id); const i = cities.indexOf(same); cities[i] = { ...same, ...strongerCity(same, { s: c.s, first: c.first }), note: same.note || c.note, fav: same.fav || c.fav, rate: same.rate || c.rate }; }
      else { idMap.set(c.id, c.id); cities.push(c); }
    }
    s.cities = cities;
    s.photos = { ...inc.photos, ...s.photos };
    const trips = [...s.trips];
    for (const t of inc.trips) {
      const fixed = { ...t, stops: t.stops.map(x => ({ ...x, city: x.city ? idMap.get(x.city) || '' : '' })) };
      const i = trips.findIndex(x => x.id === t.id);
      if (i < 0) { trips.push(fixed); continue; }
      const here = trips[i];
      if (!(t.upd > here.upd)) continue; // the copy here is as new or newer
      // the file's version wins, but photos on this phone stay with the trip (a file may be made without photos)
      const photos = [...new Set([...fixed.photos, ...here.photos])].filter(pid => s.photos[pid]);
      trips[i] = { ...fixed, photos, cover: photos.includes(fixed.cover) ? fixed.cover : (photos.includes(here.cover) ? here.cover : photos[0] || '') };
    }
    s.trips = trips;
    const promoted = promoteCities(s.cities, s.trips);
    if (promoted) s.cities = promoted;
    if (!s.profile.name && inc.profile.name) s.profile = { ...s.profile, name: inc.profile.name };
    if (!s.profile.home && inc.profile.home) s.profile = { ...s.profile, home: inc.profile.home, homeCity: s.profile.homeCity || inc.profile.homeCity };
    s.seen = { ...inc.seen, ...s.seen };
  });
}

/* ---------------- trip timing ---------------- */
export const tripStartDay = t => dayStart(t.start || t.end) ?? null;
export const tripEndDay = t => dayEnd(t.end || t.start) ?? null;
/** a trip without dates counts as one that happened */
export function tripStarted(t) {
  const s = tripStartDay(t);
  return s == null || s <= todayDay();
}
export function tripPhase(t) {
  const s = tripStartDay(t), e = tripEndDay(t), today = todayDay();
  if (s == null) return 'past';
  if (s > today) return 'upcoming';
  if (e != null && e >= today) return 'now';
  return 'past';
}
export { batch, has };
