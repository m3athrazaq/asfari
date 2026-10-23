// Everything the app shows that is computed from the data: each country's status, counts, days,
// distances, records, yearly figures, badges, the Schengen 90/180 count.
import { C, COUNTRIES, CONTINENTS, GROUPS } from './data.js';
import { dayStart, dayEnd, exactDay, todayDay, haversine, parseDate, yearOf, monthOf, EARTH_KM, MOON_KM, uniq } from './util.js';
import { tripStartDay, tripEndDay, tripPhase } from './store.js';

export const RANK = { '': 0, wish: 1, planned: 2, transit: 3, visited: 4, lived: 5 };
const DAY_YEAR = d => new Date(d * 864e5).getUTCFullYear();

/** the point used for a stop: its city, else the country's capital, else the country's centre */
export function stopPoint(s, stop) {
  const city = stop.city ? s.cities.find(c => c.id === stop.city) : null;
  if (city) return { lat: city.lat, lon: city.lon };
  return countryPoint(stop.cc);
}
export function countryPoint(cc) {
  const c = C.get(cc);
  if (!c) return null;
  const cap = c.cap && c.cap[0];
  if (cap && cap.lat != null) return { lat: cap.lat, lon: cap.lon };
  return { lat: c.ll[0], lon: c.ll[1] };
}
export function homePoint(s) {
  if (s.profile.homeCity) return { lat: s.profile.homeCity.lat, lon: s.profile.homeCity.lon };
  return s.profile.home ? countryPoint(s.profile.home) : null;
}

/** the days of a trip given to each of its stops (exact-date trips only) */
function stopDays(t, home) {
  const s = dayStart(t.start), e = dayEnd(t.end || t.start);
  const tripExact = exactDay(t.start) && exactDay(t.end || t.start);
  const out = new Map(); // stop index -> [from, to]
  const stops = t.stops.map((x, i) => ({ x, i })).filter(o => o.x.cc !== home);
  if (!stops.length) return { out, exact: tripExact };
  const today = todayDay();
  const lastDay = e != null ? Math.min(e, today) : null;
  const dated = [], undated = [];
  for (const o of stops) {
    if (exactDay(o.x.from) && exactDay(o.x.to || o.x.from)) {
      let a = dayStart(o.x.from), b = dayEnd(o.x.to || o.x.from);
      if (b < a) [a, b] = [b, a];
      if (lastDay != null) b = Math.min(b, Math.max(a, lastDay));
      if (a <= today) out.set(o.i, [a, Math.min(b, today)]);
    } else if (!o.x.transit) undated.push(o);
  }
  if (undated.length && tripExact && s <= today) {
    // undated stops share the trip's days that dated stops do not cover, in order
    const covered = new Set();
    for (const [a, b] of out.values()) for (let d = a; d <= b; d++) covered.add(d);
    const free = [];
    for (let d = s; d <= lastDay; d++) if (!covered.has(d)) free.push(d);
    const pool = free.length ? free : [];
    const n = undated.length;
    for (let k = 0; k < n; k++) {
      const part = pool.slice(Math.floor(k * pool.length / n), Math.floor((k + 1) * pool.length / n));
      if (part.length) out.set(undated[k].i, [part[0], part[part.length - 1]]);
      else if (pool.length) out.set(undated[k].i, [pool[pool.length - 1], pool[pool.length - 1]]);
    }
  }
  return { out, exact: tripExact || undated.length === 0 };
}

export function derive(s) {
  const today = todayDay();
  const home = s.profile.home;
  const set = s.settings;
  const countable = st => st === 'visited' || st === 'lived' || (set.transitCounts && st === 'transit');
  const citiesById = new Map(s.cities.map(c => [c.id, c]));

  /* ---- trips in order ---- */
  const trips = s.trips.map(t => ({ t, id: t.id, s: tripStartDay(t), e: tripEndDay(t), phase: tripPhase(t) }))
    .sort((a, b) => (a.s ?? -1e9) - (b.s ?? -1e9) || a.t.at - b.t.at);
  const started = trips.filter(x => x.phase !== 'upcoming');
  const upcoming = trips.filter(x => x.phase === 'upcoming');

  /* ---- each country ---- */
  const cs = new Map();
  const get = cc => {
    let e = cs.get(cc);
    if (!e) cs.set(cc, e = { cc, manual: '', derived: '', status: '', first: null, last: null, trips: [], cities: [], days: new Set(), visits: 0, home: cc === home });
    return e;
  };
  const up = (e, st) => { if (RANK[st] > RANK[e.derived]) e.derived = st; };
  const firstAt = (e, d, str) => { if (d != null && (e.first == null || d < e.first)) { e.first = d; e.firstStr = str || new Date(d * 864e5).toISOString().slice(0, 10); } };
  const lastAt = (e, d) => { if (d != null && (e.last == null || d > e.last)) e.last = d; };
  for (const [cc, v] of Object.entries(s.countries)) {
    const e = get(cc); e.manual = v.s; e.manualFirst = v.first; e.fav = v.fav; e.rate = v.rate; e.note = v.note;
    if (v.first && v.s !== 'wish') firstAt(e, dayStart(v.first), v.first);
  }
  if (home) { const e = get(home); up(e, 'lived'); }
  for (const c of s.cities) {
    const e = get(c.cc);
    e.cities.push(c.id);
    if (c.s === 'visited' || c.s === 'lived' || c.s === 'transit') { up(e, c.s); if (c.first) firstAt(e, dayStart(c.first), c.first); }
  }
  for (const x of started) {
    const t = x.t;
    const seen = new Set();
    for (const st of t.stops) {
      const e = get(st.cc);
      const transit = st.transit || t.purpose === 'transit';
      up(e, transit ? 'transit' : 'visited');
      if (st.from) firstAt(e, dayStart(st.from), st.from); else if (x.s != null) firstAt(e, x.s, t.start || t.end);
      lastAt(e, dayEnd(st.to || st.from) ?? x.e ?? x.s);
      if (!seen.has(st.cc)) { e.trips.push(t.id); if (!transit) e.visits++; seen.add(st.cc); }
    }
  }
  for (const x of upcoming) for (const st of x.t.stops) { const e = get(st.cc); up(e, 'planned'); if (!e.upcoming) e.upcoming = x.t.id; }

  /* ---- each city's first visit (its own date, else the trips through it) ---- */
  const cityFirst = new Map();
  for (const c of s.cities) if (c.first) cityFirst.set(c.id, c.first);
  for (const x of started) for (const st of x.t.stops) {
    if (!st.city) continue;
    const d = st.from || x.t.start;
    if (!d) continue;
    const cur = cityFirst.get(st.city);
    if (!cur || dayStart(d) < dayStart(cur)) cityFirst.set(st.city, d);
  }

  /* ---- days ---- */
  const abroad = new Set();
  let undatedTrips = 0;
  for (const x of started) {
    const { out, exact } = stopDays(x.t, home);
    if (!exact || (!out.size && x.t.stops.some(st => st.cc !== home))) undatedTrips++;
    for (const [i, [a, b]] of out) {
      const e = get(x.t.stops[i].cc);
      for (let d = a; d <= b; d++) { e.days.add(d); abroad.add(d); }
    }
  }
  for (const e of cs.values()) {
    e.status = RANK[e.manual] >= RANK[e.derived] ? e.manual : e.derived;
    if (e.home) e.status = 'lived';
    e.counted = countable(e.status) && (!e.home || set.homeCounts);
    e.dayCount = e.days.size;
  }

  /* ---- counts ---- */
  const inDenom = c => (set.denominator === 'un' ? c.un : set.denominator === 'sov' ? c.sov : 1);
  const denomList = COUNTRIES.filter(inDenom);
  const counted = [...cs.values()].filter(e => e.counted).map(e => C.get(e.cc)).filter(Boolean);
  const countedSet = new Set(counted.map(c => c.c));
  const main = counted.filter(inDenom);
  const extra = counted.filter(c => !inDenom(c));
  const worldPop = COUNTRIES.reduce((a, c) => a + c.pop, 0);
  const worldArea = COUNTRIES.filter(c => c.c !== 'AQ').reduce((a, c) => a + c.area, 0);
  const continents = CONTINENTS.map(k => {
    const all = denomList.filter(c => c.cont === k);
    const got = main.filter(c => c.cont === k);
    // Antarctica has no states: it counts as visited when its territory is marked
    const v = k === 'an' ? (countedSet.has('AQ') ? 1 : 0) : got.length;
    return { k, total: k === 'an' ? 1 : all.length, visited: v, list: got };
  });
  const contVisited = continents.filter(c => c.visited > 0).length;

  /* ---- cities ---- */
  const visitedCities = s.cities.filter(c => c.s === 'visited' || c.s === 'lived' || (set.transitCounts && c.s === 'transit'));
  const isCapital = c => { const k = C.get(c.cc); return !!(k && k.cap && k.cap.some(p => p.lat != null && haversine(p.lat, p.lon, c.lat, c.lon) < 30)); };
  const capitals = visitedCities.filter(isCapital);
  const hp = homePoint(s);

  /* ---- distance & flights ---- */
  let km = 0, flightKm = 0, flights = 0, approxKm = false;
  const airports = new Map(), airlines = new Map(), modes = new Map();
  const legKm = l => haversine(l.a.lat, l.a.lon, l.b.lat, l.b.lon);
  const tripKm = new Map();
  for (const x of started) {
    const t = x.t;
    let k = 0;
    if (t.legs.length) {
      for (const l of t.legs) {
        const d = legKm(l); k += d;
        modes.set(l.mode, (modes.get(l.mode) || 0) + d);
        if (l.mode === 'flight') {
          flights++; flightKm += d;
          for (const end of [l.a, l.b]) if (end.code) airports.set(end.code, (airports.get(end.code) || 0) + 1);
          if (l.carrier) airlines.set(l.carrier, (airlines.get(l.carrier) || 0) + 1);
        }
      }
    } else if (t.stops.length) {
      const pts = t.stops.map(st => stopPoint(s, st)).filter(Boolean);
      const route = hp ? [hp, ...pts, hp] : pts;
      for (let i = 1; i < route.length; i++) k += haversine(route[i - 1].lat, route[i - 1].lon, route[i].lat, route[i].lon);
      if (k) approxKm = true;
    }
    tripKm.set(t.id, k);
    km += k;
  }

  /* ---- extremes ---- */
  const pts = visitedCities.map(c => ({ lat: c.lat, lon: c.lon, cc: c.cc, name: c.name || c.nameEn, nameEn: c.nameEn, id: c.id }));
  for (const e of cs.values()) if (e.counted && !e.cities.some(id => { const c = citiesById.get(id); return c && (c.s === 'visited' || c.s === 'lived'); })) {
    const p = countryPoint(e.cc); if (p) pts.push({ ...p, cc: e.cc, country: true });
  }
  const pick = f => pts.reduce((best, p) => (best == null || f(p) > f(best) ? p : best), null);
  const extremes = pts.length ? {
    north: pick(p => p.lat), south: pick(p => -p.lat), east: pick(p => p.lon), west: pick(p => -p.lon),
    far: hp ? pick(p => haversine(hp.lat, hp.lon, p.lat, p.lon)) : null
  } : null;
  if (extremes && extremes.far) extremes.farKm = haversine(hp.lat, hp.lon, extremes.far.lat, extremes.far.lon);
  const hemi = { n: pts.some(p => p.lat > 0), s: pts.some(p => p.lat < 0), e: pts.some(p => p.lon > 0), w: pts.some(p => p.lon < 0) };

  /* ---- years, months, purposes, companions ---- */
  const years = new Map();
  const Y = y => { let v = years.get(y); if (!v) years.set(y, v = { y, trips: 0, newCountries: [], days: 0, km: 0, countries: new Set(), cities: new Set() }); return v; };
  for (const x of started) {
    const y = x.s != null ? DAY_YEAR(x.s) : null;
    if (y == null) continue;
    const v = Y(y); v.trips++; v.km += tripKm.get(x.id) || 0;
    for (const st of x.t.stops) { if (st.cc !== home) v.countries.add(st.cc); if (st.city) v.cities.add(st.city); }
  }
  for (const d of abroad) Y(DAY_YEAR(d)).days++;
  for (const e of cs.values()) if (e.counted && !e.home && e.first != null) Y(DAY_YEAR(e.first)).newCountries.push(e.cc);
  const yearList = [...years.values()].sort((a, b) => a.y - b.y);
  const months = Array(12).fill(0);
  for (const x of started) { const m = monthOf(x.t.start); if (m) months[m - 1]++; }
  const purposes = new Map();
  for (const x of started) purposes.set(x.t.purpose, (purposes.get(x.t.purpose) || 0) + 1);
  const people = new Map();
  for (const x of started) for (const w of x.t.with) people.set(w, (people.get(w) || 0) + 1);
  const solo = started.filter(x => !x.t.with.length).length;

  /* ---- records ---- */
  const tripDays = x => (x.s != null && x.e != null && exactDay(x.t.start) ? Math.min(x.e, today) - x.s + 1 : 0);
  const longest = started.reduce((b, x) => (tripDays(x) > (b ? tripDays(b) : 0) ? x : b), null);
  const mostVisited = [...cs.values()].filter(e => !e.home && e.visits > 0).sort((a, b) => b.visits - a.visits || b.dayCount - a.dayCount)[0] || null;
  const mostDays = [...cs.values()].filter(e => !e.home && e.dayCount > 0).sort((a, b) => b.dayCount - a.dayCount)[0] || null;
  const firstTrip = started.find(x => x.s != null) || null;
  const lastTrip = [...started].reverse().find(x => x.s != null) || null;
  const avgTrip = (() => { const ds = started.map(tripDays).filter(Boolean); return ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : 0; })();

  /* ---- memories: on this day, and the next trip ---- */
  const md = iso => (iso && exactDay(iso) ? iso.slice(5) : null);
  const todayIso = new Date(today * 864e5).toISOString().slice(0, 10);
  const onThisDay = started.filter(x => {
    if (x.s == null || x.e == null || !exactDay(x.t.start)) return false;
    if (DAY_YEAR(x.s) >= DAY_YEAR(today)) return false;
    // the trip covered this calendar day in its year
    const y = DAY_YEAR(x.s);
    const d = dayStart(y + '-' + todayIso.slice(5));
    return d != null && d >= x.s && d <= x.e;
  });
  const next = upcoming[0] || null;
  const now = trips.filter(x => x.phase === 'now');

  /* ---- result ---- */
  const r = {
    cs, trips, started, upcoming, next, now, onThisDay, cityFirst,
    counted, countedSet, main, extra, denomTotal: denomList.length,
    worldShare: main.length / denomList.length,
    popShare: worldPop ? counted.reduce((a, c) => a + c.pop, 0) / worldPop : 0,
    areaShare: worldArea ? counted.filter(c => c.c !== 'AQ').reduce((a, c) => a + c.area, 0) / worldArea : 0,
    continents, contVisited,
    visitedCities, capitals, cityCount: visitedCities.length,
    wishCountries: [...cs.values()].filter(e => e.status === 'wish').map(e => e.cc),
    wishCities: s.cities.filter(c => c.s === 'wish'),
    km, approxKm, flightKm, flights, airports, airlines, modes, tripKm,
    daysAbroad: abroad.size, undatedTrips, abroad,
    extremes, hemi, years: yearList, months, purposes, people, solo,
    longest, longestDays: longest ? tripDays(longest) : 0, mostVisited, mostDays, firstTrip, lastTrip, avgTrip,
    homePoint: hp
  };
  r.badges = badges(s, r);
  return r;
}

/* ---------------- badges ---------------- */
const groupBadge = (id, icon, key, codes, tiers) => ({ id, icon, key, kind: 'group', codes, tiers });
export const BADGE_DEFS = [
  { id: 'first', icon: 'stamp', key: 'b_first', need: 1, val: r => r.main.filter(c => !r.cs.get(c.c).home).length + r.extra.filter(c => !r.cs.get(c.c).home).length },
  { id: 'c5', icon: 'globe', key: 'b_c5', need: 5, val: r => r.counted.length },
  { id: 'c10', icon: 'globe', key: 'b_c10', need: 10, val: r => r.counted.length },
  { id: 'c25', icon: 'globe', key: 'b_c25', need: 25, val: r => r.counted.length },
  { id: 'c50', icon: 'globe', key: 'b_c50', need: 50, val: r => r.counted.length },
  { id: 'c100', icon: 'globe', key: 'b_c100', need: 100, val: r => r.counted.length },
  { id: 'cont3', icon: 'compass', key: 'b_cont3', need: 3, val: r => r.contVisited },
  { id: 'cont5', icon: 'compass', key: 'b_cont5', need: 5, val: r => r.contVisited },
  { id: 'cont7', icon: 'compass', key: 'b_cont7', need: 7, val: r => r.contVisited },
  groupBadge('gcc', 'palm', 'b_gcc', GROUPS.gcc),
  groupBadge('arab', 'crescent', 'b_arab', GROUPS.arab),
  groupBadge('levant', 'olive', 'b_levant', GROUPS.levant),
  groupBadge('maghreb', 'arch', 'b_maghreb', GROUPS.maghreb),
  groupBadge('oic', 'crescent', 'b_oic', GROUPS.oic, [10, 25, 57]),
  groupBadge('schengen', 'stars', 'b_schengen', GROUPS.schengen, [10, 29]),
  groupBadge('eu', 'stars', 'b_eu', GROUPS.eu),
  groupBadge('caucasus', 'mountain', 'b_caucasus', GROUPS.caucasus),
  groupBadge('balkans', 'mountain', 'b_balkans', GROUPS.balkans),
  groupBadge('centralAsia', 'caravan', 'b_centralAsia', GROUPS.centralAsia),
  groupBadge('asean', 'lotus', 'b_asean', GROUPS.asean),
  groupBadge('nordic', 'snow', 'b_nordic', GROUPS.nordic),
  groupBadge('g20', 'columns', 'b_g20', GROUPS.g20),
  groupBadge('micro', 'castle', 'b_micro', GROUPS.micro, [3, 6]),
  groupBadge('ibnBattuta', 'dhow', 'b_ibnBattuta', GROUPS.ibnBattuta, [10, 20, 36]),
  groupBadge('wonders', 'pyramid', 'b_wonders', GROUPS.wonders, [7]),
  { id: 'neighbors', icon: 'border', key: 'b_neighbors', val: (r, s) => { const h = C.get(s.profile.home); return h ? h.b.filter(cc => r.countedSet.has(cc)).length : 0; }, needFn: s => { const h = C.get(s.profile.home); return h && h.b.length ? h.b.length : 0; } },
  { id: 'islands', icon: 'island', key: 'b_islands', need: 5, val: r => r.counted.filter(c => c.b.length === 0 && !c.lk && c.c !== 'AQ').length },
  { id: 'equator', icon: 'equator', key: 'b_equator', need: 1, val: r => (r.hemi.n && r.hemi.s ? 1 : 0) },
  { id: 'quarters', icon: 'quarters', key: 'b_quarters', need: 4, val: r => [r.hemi.n && r.hemi.e, r.hemi.n && r.hemi.w, r.hemi.s && r.hemi.e, r.hemi.s && r.hemi.w].filter(Boolean).length },
  { id: 'arctic', icon: 'snow', key: 'b_arctic', need: 1, val: r => (r.visitedCities.some(c => c.lat >= 66.56) ? 1 : 0) },
  { id: 'south', icon: 'penguin', key: 'b_south', need: 1, val: r => (r.visitedCities.some(c => c.lat <= -40) || r.countedSet.has('AQ') ? 1 : 0) },
  { id: 'cities25', icon: 'city', key: 'b_cities25', need: 25, val: r => r.cityCount },
  { id: 'cities100', icon: 'city', key: 'b_cities100', need: 100, val: r => r.cityCount },
  { id: 'caps10', icon: 'dome', key: 'b_caps10', need: 10, val: r => r.capitals.length },
  { id: 'caps25', icon: 'dome', key: 'b_caps25', need: 25, val: r => r.capitals.length },
  { id: 'caps50', icon: 'dome', key: 'b_caps50', need: 50, val: r => r.capitals.length },
  { id: 'trips10', icon: 'suitcase', key: 'b_trips10', need: 10, val: r => r.started.length },
  { id: 'trips50', icon: 'suitcase', key: 'b_trips50', need: 50, val: r => r.started.length },
  { id: 'flights10', icon: 'plane', key: 'b_flights10', need: 10, val: r => r.flights },
  { id: 'flights50', icon: 'plane', key: 'b_flights50', need: 50, val: r => r.flights },
  { id: 'earth', icon: 'orbit', key: 'b_earth', need: EARTH_KM, val: r => Math.round(r.km) },
  { id: 'moon', icon: 'moon', key: 'b_moon', need: MOON_KM, val: r => Math.round(r.km) },
  { id: 'long', icon: 'hourglass', key: 'b_long', need: 30, val: r => r.longestDays },
  { id: 'days365', icon: 'calendar', key: 'b_days365', need: 365, val: r => r.daysAbroad },
  { id: 'multi3', icon: 'route', key: 'b_multi3', need: 3, val: (r, s) => Math.max(0, ...r.started.map(x => uniq(x.t.stops.filter(st => st.cc !== s.profile.home).map(st => st.cc)).length)) },
  { id: 'multi5', icon: 'route', key: 'b_multi5', need: 5, val: (r, s) => Math.max(0, ...r.started.map(x => uniq(x.t.stops.filter(st => st.cc !== s.profile.home).map(st => st.cc)).length)) },
  { id: 'months12', icon: 'calendar', key: 'b_months12', need: 12, val: r => r.months.filter(Boolean).length },
  { id: 'decade', icon: 'hourglass', key: 'b_decade', need: 10, val: r => r.years.filter(y => y.trips > 0).length },
  { id: 'pilgrim', icon: 'kaaba', key: 'b_pilgrim', need: 1, val: r => r.started.filter(x => x.t.purpose === 'umrah' || x.t.purpose === 'hajj').length },
  { id: 'business', icon: 'briefcase', key: 'b_business', need: 10, val: r => r.purposes.get('business') || 0 },
  { id: 'solo', icon: 'person', key: 'b_solo', need: 1, val: r => r.solo },
  { id: 'company', icon: 'people', key: 'b_company', need: 10, val: r => r.started.length - r.solo },
  { id: 'billion', icon: 'people', key: 'b_billion', need: 1e9, val: r => Math.round(r.counted.reduce((a, c) => a + c.pop, 0)) },
  { id: 'half', icon: 'globe', key: 'b_half', need: 50, val: r => Math.floor(r.popShare * 100) }
];
function badges(s, r) {
  const out = [];
  for (const d of BADGE_DEFS) {
    if (d.kind === 'group') {
      const total = d.codes.length;
      const ok = cc => r.countedSet.has(cc) || cc === s.profile.home;
      const got = d.codes.filter(ok);
      const tiers = d.tiers || [total];
      const tier = tiers.filter(n => got.length >= n).length;
      const need = tiers[Math.min(tier, tiers.length - 1)];
      out.push({ ...d, total, got: got.length, gotList: got, missing: d.codes.filter(cc => !ok(cc)), need, val: got.length, done: tier > 0, tier, tiers });
      continue;
    }
    const need = d.needFn ? d.needFn(s) : d.need;
    if (!need) continue;
    const val = d.val(r, s);
    out.push({ ...d, need, val, done: val >= need });
  }
  return out;
}

/* ---------------- Schengen 90/180 ---------------- */
export const SCHENGEN = new Set([...GROUPS.schengen, ...GROUPS.schengenLinked]);
/**
 * Days in the Schengen area (day numbers) from every trip, planned ones included.
 * - a trip only inside Schengen: every day of it, arrival and departure days included;
 * - stops with dates: their days (passing through, e.g. an airport transfer, does not count);
 * - stops without dates in a trip with dates: every day of the trip not spent at a dated stop
 *   outside Schengen (counted in full, to be safe) → listed in `unsure`;
 * - trips without exact dates cannot be counted → listed in `skipped`.
 * unsure / skipped hold the trips' day ranges, so the screen can mention only the ones that matter.
 */
export function schengenDays(s, extra = []) {
  const days = new Set();
  const unsure = [], skipped = [];
  const home = SCHENGEN.has(s.profile.home) ? '' : s.profile.home;
  const add = (a, b) => { b = Math.min(b, a + 3650); for (let d = a; d <= b; d++) days.add(d); };
  for (const t of s.trips) {
    const away = t.stops.filter(x => x.cc !== home);
    const inS = away.filter(x => SCHENGEN.has(x.cc));
    if (!inS.length) continue;
    const exactTrip = exactDay(t.start) && exactDay(t.end || t.start);
    const range = [dayStart(t.start || t.end), dayEnd(t.end || t.start)];
    const passing = x => x.transit || t.purpose === 'transit';
    if (exactTrip && away.every(x => SCHENGEN.has(x.cc)) && !inS.every(passing)) { add(dayStart(t.start), dayEnd(t.end || t.start)); continue; }
    const dated = [];
    for (const x of away) if (exactDay(x.from)) {
      let a = dayStart(x.from), b = dayEnd(exactDay(x.to) ? x.to : x.from);
      if (b < a) [a, b] = [b, a];
      dated.push([a, b, x]);
      if (SCHENGEN.has(x.cc) && !passing(x)) add(a, b);
    }
    const undated = inS.filter(x => !exactDay(x.from) && !passing(x));
    if (!undated.length) continue;
    if (!exactTrip) { if (range[0] != null) skipped.push(range); continue; }
    const outside = new Set();
    for (const [a, b, x] of dated) if (!SCHENGEN.has(x.cc)) for (let d = a; d <= b; d++) outside.add(d);
    const a = dayStart(t.start), b = Math.min(dayEnd(t.end || t.start), a + 3650);
    for (let d = a; d <= b; d++) if (!outside.has(d)) days.add(d);
    unsure.push(range);
  }
  for (const [a, b] of extra) add(a, b);
  return { days, unsure, skipped };
}
/** days used in the 180-day window ending on day d */
export function usedOn(days, d) {
  let n = 0;
  for (let x = d - 179; x <= d; x++) if (days.has(x)) n++;
  return n;
}
/** the whole picture for the 90/180 screen */
export function schengenStatus(s, ref, plan) {
  const extra = plan && plan[0] != null && plan[1] != null ? [plan] : [];
  const { days, unsure: u, skipped: k } = schengenDays(s, extra);
  // only the trips that touch the 180 days before ref, or the planned stay
  const lo = ref - 179, hi = Math.max(ref, extra.length ? plan[1] : ref);
  const touches = ([a, b]) => a != null && b != null && b >= lo && a <= hi;
  const unsure = u.filter(touches).length, skipped = k.filter(touches).length;
  const used = usedOn(days, ref);
  const left = Math.max(0, 90 - used);
  // when the plan breaks the rule, the first day over 90
  let over = null, maxUsed = 0;
  if (extra.length) for (let d = plan[0]; d <= plan[1]; d++) { const u = usedOn(days, d); if (u > maxUsed) maxUsed = u; if (u > 90 && over == null) over = d; }
  // the latest exit if entering on ref and staying as long as allowed
  let stayUntil = null;
  if (!days.has(ref) || true) {
    const test = new Set(days);
    let d = ref;
    while (d < ref + 200) { test.add(d); if (usedOn(test, d) > 90) break; stayUntil = d; d++; }
  }
  // next day a day frees up (when used is high)
  const window = [];
  for (let x = ref - 179; x <= ref; x++) window.push(days.has(x) ? 1 : 0);
  return { used, left, over, maxUsed, stayUntil, window, unsure, skipped, total: days.size };
}

/* ---------------- days in each country, per year (residency) ---------------- */
export function daysByYear(r, year) {
  const out = [];
  for (const e of r.cs.values()) {
    let n = 0;
    for (const d of e.days) if (DAY_YEAR(d) === year) n++;
    if (n) out.push({ cc: e.cc, days: n });
  }
  return out.sort((a, b) => b.days - a.days);
}
export const yearsWithDays = r => uniq([...r.abroad].map(DAY_YEAR)).sort((a, b) => b - a);
export { parseDate, yearOf };
