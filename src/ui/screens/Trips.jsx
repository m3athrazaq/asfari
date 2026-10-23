// Trips: the list (boarding passes), a trip's page, and the trip editor.
import { useState, useEffect, useMemo, useRef } from 'preact/hooks';
import { Fragment } from 'preact';
import { C, loadAirports, airportsIfLoaded, searchAirports, nearestAirport, loadWorld } from '../../core/data.js';
import { state, saveTrip, deleteTrip, restoreTrip, addCity, PURPOSES, MODES, tripPhase, update } from '../../core/store.js';
import { R, openAddCity, addCitySheet, isDark } from '../app-state.js';
import { t, num, cname, cityName, fmtDate, fmtRange, fmtKm, fmtMoney, unit, count, isAr, fmtRelDays, dig } from '../../core/i18n.js';
import { uid, spanDays, exactDay, dayStart, todayDay, haversine, yearOf, todayISO } from '../../core/util.js';
import { stopPoint, homePoint, countryPoint } from '../../core/derive.js';
import { addPhotos, photoURL, deletePhoto } from '../../core/photos.js';
import { pickFiles } from '../../core/native.js';
import { Flag, Sheet, TopBar, Stars, Toggle, DateField, DayInput, Seg, Field, toast, confirmDialog, Empty, CountryPicker, Spinner } from '../kit.jsx';
import { Icon } from '../icons.jsx';
import { go, back, route } from '../router.js';
import { drawRouteMap } from '../../map/worldmap.js';
import { mapColors, statusFill } from '../mapcolors.js';

const MODE_ICON = { flight: 'plane', car: 'car', train: 'train', bus: 'bus', ship: 'ship', other: 'route' };
const sep = () => (isAr.value ? '، ' : ', ');

/* ---------- names of a trip ---------- */
export function tripPlaces(s, tr) {
  const home = s.profile.home;
  const out = [];
  for (const st of tr.stops) {
    if (st.cc === home && tr.stops.length > 1) continue;
    const city = st.city ? s.cities.find(c => c.id === st.city) : null;
    out.push({ cc: st.cc, name: city ? cityName(city) : cname(C.get(st.cc)), city });
  }
  return out;
}
export function tripTitle(s, tr) {
  if (tr.title) return tr.title;
  const ccs = [...new Set(tr.stops.filter(x => x.cc !== s.profile.home || tr.stops.length === 1).map(x => x.cc))];
  const names = ccs.map(cc => cname(C.get(cc)));
  if (!names.length) return t('trip_untitled');
  if (names.length <= 3) return names.join(isAr.value ? ' و' : ' & ').replace(/ و/g, ' و');
  return names.slice(0, 2).join(sep()) + (isAr.value ? ' و' : ' + ') + count(names.length - 2, 'country');
}
/** the route as airport codes if the trip has flights, else as places */
function routeParts(s, tr) {
  const codes = [];
  for (const l of tr.legs) {
    if (l.a.code && codes[codes.length - 1] !== l.a.code) codes.push(l.a.code);
    if (l.b.code && codes[codes.length - 1] !== l.b.code) codes.push(l.b.code);
  }
  if (codes.length >= 2) return { codes: true, parts: codes.slice(0, 6) };
  const p = tripPlaces(s, tr).map(x => x.name);
  return { codes: false, parts: p.slice(0, 4) };
}
export function tripDays(tr) { return exactDay(tr.start) ? spanDays(tr.start, tr.end || tr.start) : 0; }

export function TripRow({ x }) {
  const s = state.value;
  const t0 = x.t;
  const places = tripPlaces(s, t0);
  return (
    <button class="row" onClick={() => go('trip/' + t0.id)}>
      <Flag cc={places[0] ? places[0].cc : t0.stops[0] && t0.stops[0].cc} />
      <span class="grow">
        <span class="title">{tripTitle(s, t0)}</span>
        <span class="meta">{fmtRange(t0.start, t0.end, { short: true, noHijri: true }) || t('trip_no_dates')}</span>
      </span>
      <Icon name="chev" class="chev flip" />
    </button>
  );
}

function Pass({ x }) {
  const s = state.value;
  const t0 = x.t;
  const rp = routeParts(s, t0);
  const days = tripDays(t0);
  const phase = x.phase;
  const ccs = [...new Set(t0.stops.map(y => y.cc).filter(cc => cc !== s.profile.home || t0.stops.length === 1))];
  const until = phase === 'upcoming' && x.s != null ? x.s - todayDay() : null;
  return (
    <button class={'pass ' + phase} onClick={() => go('trip/' + t0.id)}>
      <div class="main">
        {phase !== 'past' && <div class="tag">{phase === 'now' ? t('trip_now') : t('trip_upcoming')}</div>}
        <div class="route" dir={rp.codes ? 'ltr' : undefined} style={rp.codes ? '' : 'direction:inherit;justify-content:flex-start;font-size:19px'}>
          {rp.parts.map((p, i) => <Fragment key={i}>{i > 0 && <Icon name={rp.codes ? 'plane' : 'chev'} class={rp.codes ? '' : 'flip'} style={rp.codes ? 'transform:rotate(90deg)' : ''} />}<span>{p}</span></Fragment>)}
        </div>
        <div class="ttl">{tripTitle(s, t0)}</div>
        <div class="when">{fmtRange(t0.start, t0.end, { short: true, noHijri: true }) || t('trip_no_dates')}{t0.purpose !== 'leisure' ? sep() + t('p_' + t0.purpose) : ''}</div>
        <div class="flags">{ccs.slice(0, 8).map(cc => <Flag key={cc} cc={cc} size="sm" />)}</div>
      </div>
      <div class="stub">
        {until != null ? <><b class="num">{num(until)}</b><span>{until === 1 ? t('trip_tomorrow') : unit(until, 'day')}</span></>
          : days ? <><b class="num">{num(days)}</b><span>{unit(days, 'day')}</span></>
          : <><b class="num" style="font-size:20px">{x.s != null ? dig(yearOf(t0.start || t0.end)) : '—'}</b><span>{x.s != null ? '' : t('trip_no_dates')}</span></>}
        {t0.rate > 0 && <Stars value={t0.rate} readOnly />}
      </div>
    </button>
  );
}

/* ---------- list ---------- */
export function TripsScreen() {
  const r = R.value, s = state.value;
  const [q, setQ] = useState('');
  const [year, setYear] = useState('');
  if (!r) return null;
  const nq = q.trim().toLowerCase();
  const match = x => {
    if (year && String(yearOf(x.t.start || x.t.end)) !== year) return false;
    if (!nq) return true;
    const hay = [tripTitle(s, x.t), x.t.note, ...x.t.with, ...tripPlaces(s, x.t).map(p => p.name + ' ' + (C.get(p.cc) || {}).en)].join(' ').toLowerCase();
    return hay.includes(nq);
  };
  const now = r.trips.filter(x => x.phase === 'now' && match(x));
  const up = r.trips.filter(x => x.phase === 'upcoming' && match(x));
  const past = r.trips.filter(x => x.phase === 'past' && match(x)).reverse();
  const groups = [];
  for (const x of past) {
    const y = x.s != null ? new Date(x.s * 864e5).getUTCFullYear() : null;
    const g = groups[groups.length - 1];
    if (!g || g.y !== y) groups.push({ y, list: [x] }); else g.list.push(x);
  }
  const years = [...new Set(r.trips.map(x => yearOf(x.t.start || x.t.end)).filter(Boolean))].sort((a, b) => b - a);
  return (
    <div class="screen">
      <TopBar title={t('trips_title')} />
      <div class="wrap">
        {r.trips.length === 0 ? (
          <Empty icon="suitcase" title={t('trip_empty_title')} text={t('trip_empty_text')}>
            <button class="btn" onClick={() => go('trip-new')}><Icon name="plus" />{t('trip_new')}</button>
          </Empty>
        ) : (
          <>
            <div class="search"><Icon name="search" /><input value={q} onInput={e => setQ(e.currentTarget.value)} placeholder={t('trip_search')} aria-label={t('trip_search')} /></div>
            {years.length > 1 && (
              <div class="chips" style="margin-top:10px">
                <button class="chip" aria-pressed={!year ? 'true' : 'false'} onClick={() => setYear('')}>{t('all')}</button>
                {years.map(y => <button class="chip" key={y} aria-pressed={year === String(y) ? 'true' : 'false'} onClick={() => setYear(String(y))}>{dig(y)}</button>)}
              </div>
            )}
            {now.length > 0 && <section class="section"><h2>{t('trip_now')}</h2>{now.map(x => <Pass key={x.id} x={x} />)}</section>}
            {up.length > 0 && <section class="section"><h2>{t('trips_upcoming')}</h2>{up.map(x => <Pass key={x.id} x={x} />)}</section>}
            {groups.map(g => (
              <section class="section" key={g.y || 'none'}>
                <h2>{g.y ? dig(g.y) : t('trip_no_dates')}<span class="aside" style="color:var(--ink-2)">{count(g.list.length, 'trip')}</span></h2>
                {g.list.map(x => <Pass key={x.id} x={x} />)}
              </section>
            ))}
            {!now.length && !up.length && !groups.length && <p class="hint" style="margin-top:20px">{t('no_results')}</p>}
          </>
        )}
      </div>
      <button class="fab" onClick={() => go('trip-new')}><Icon name="plus" />{t('trip_new')}</button>
    </div>
  );
}

/* ---------- a trip ---------- */
function RouteMap({ s, t0 }) {
  const cv = useRef();
  useEffect(() => {
    let alive = true;
    loadWorld('lo').then(lo => loadWorld('hi').then(hi => {
      if (!alive || !cv.current) return;
      const w = cv.current.clientWidth, h = cv.current.clientHeight;
      const dpr = Math.min(3, devicePixelRatio || 1);
      cv.current.width = w * dpr; cv.current.height = h * dpr;
      const hp = homePoint(s);
      const pts = [];
      const isHome = e => e.k === 'home' || (hp && haversine(e.lat, e.lon, hp.lat, hp.lon) < 60);
      if (t0.legs.length) {
        for (const l of t0.legs) { if (!pts.length) pts.push({ lat: l.a.lat, lon: l.a.lon, home: isHome(l.a) }); pts.push({ lat: l.b.lat, lon: l.b.lon, home: isHome(l.b) }); }
      } else {
        if (hp) pts.push({ ...hp, home: true });
        for (const st of t0.stops) { const p = stopPoint(s, st); if (p) pts.push(p); }
        if (hp && pts.length > 1) pts.push({ ...hp, home: true });
      }
      const col = mapColors();
      const ccs = new Set(t0.stops.map(x => x.cc));
      drawRouteMap(cv.current, { features: hi, points: pts, width: w, height: h, colors: { ...col, route: col.carmine || col.home }, fill: cc => (ccs.has(cc) ? col.visited : col.land) });
    }));
    return () => { alive = false; };
  }, [t0, isDark.value]);
  return <canvas ref={cv} style="width:100%;height:200px;border-radius:18px;display:block;box-shadow:var(--shadow)" role="img" aria-label={t('trip_map')} />;
}

function Photo({ id, onClick, cover }) {
  const [u, setU] = useState('');
  useEffect(() => { photoURL(id).then(setU); }, [id]);
  return <button class="ph" onClick={onClick}>{u && <img src={u} alt="" loading="lazy" />}{cover && <span class="cover">{t('trip_cover')}</span>}</button>;
}
function Viewer({ ids, index, onClose, s }) {
  const [i, setI] = useState(index);
  const [u, setU] = useState('');
  useEffect(() => { photoURL(ids[i]).then(setU); }, [i]);
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowLeft') setI(v => Math.max(0, v - 1)); if (e.key === 'ArrowRight') setI(v => Math.min(ids.length - 1, v + 1)); };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, []);
  const meta = s.photos[ids[i]] || {};
  let x0 = null;
  return (
    <div class="viewer" role="dialog" aria-modal="true" onPointerDown={e => { x0 = e.clientX; }} onPointerUp={e => {
      if (x0 == null) return; const dx = e.clientX - x0; x0 = null;
      const next = isAr.value ? dx > 0 : dx < 0;
      if (Math.abs(dx) > 50) setI(v => Math.max(0, Math.min(ids.length - 1, v + (next ? 1 : -1))));
    }}>
      <div class="bar2"><button class="iconbtn" onClick={onClose} aria-label={t('close')}><Icon name="x" /></button><span class="num">{num(i + 1)} / {num(ids.length)}</span></div>
      {u && <img src={u} alt={meta.cap || ''} />}
      <div class="cap">{meta.cap || ''}</div>
    </div>
  );
}

export function TripPage({ id }) {
  const s = state.value, r = R.value;
  const [view, setView] = useState(null);
  const t0 = s.trips.find(x => x.id === id);
  if (!t0 || !r) return <div class="screen"><TopBar title="" back="trips" /><Empty title={t('not_found')} /></div>;
  const x = r.trips.find(y => y.id === id);
  const rp = routeParts(s, t0);
  const days = tripDays(t0);
  const km = r.tripKm.get(id) || 0;
  const remove = async () => {
    if (!(await confirmDialog({ title: t('trip_delete_q'), text: t('trip_delete_text'), ok: t('delete'), danger: true }))) return;
    const removed = deleteTrip(id);
    back('trips');
    // photos stay until the undo time is over
    toast(t('trip_deleted'), { action: t('undo'), onAction: () => restoreTrip(removed), ms: 6000 });
    setTimeout(() => {
      if (state.value.trips.some(y => y.id === id)) return;
      update(st => { const p = { ...st.photos }; for (const pid of removed.photos) delete p[pid]; st.photos = p; });
      for (const pid of removed.photos) deletePhoto(pid);
    }, 6500);
  };
  return (
    <div class="screen">
      <TopBar title={tripTitle(s, t0)} back="trips" sub actions={<>
        <button class="iconbtn" onClick={() => go('trip-edit/' + id)} aria-label={t('edit')}><Icon name="edit" /></button>
      </>} />
      <div class="wrap">
        <div class="trip-hero">
          <div class={'route' + (rp.codes && rp.parts.length >= 5 ? ' long' : '')} style={rp.codes ? '' : 'direction:inherit;justify-content:flex-start;font-size:24px'}>
            {rp.parts.map((p, i) => <Fragment key={i}>{i > 0 && <Icon name={rp.codes ? 'plane' : 'chev'} class={rp.codes ? '' : 'flip'} style={rp.codes ? 'transform:rotate(90deg)' : ''} />}<span>{p}</span></Fragment>)}
          </div>
          <p class="lead">{fmtRange(t0.start, t0.end) || t('trip_no_dates')}{x && x.phase === 'upcoming' && x.s != null ? sep() + fmtRelDays(x.s - todayDay()) : ''}</p>
          <div class="kv">
            {days > 0 && <div><b class="num">{num(days)}</b><span>{unit(days, 'day')}</span></div>}
            {km > 0 && <div><b class="num">{num(Math.round(km))}</b><span>{t('km_word')}{!t0.legs.length ? ' ' + t('approx') : ''}</span></div>}
            <div><b class="num">{num(new Set(t0.stops.map(y => y.cc)).size)}</b><span>{unit(new Set(t0.stops.map(y => y.cc)).size, 'country')}</span></div>
            {t0.legs.filter(l => l.mode === 'flight').length > 0 && <div><b class="num">{num(t0.legs.filter(l => l.mode === 'flight').length)}</b><span>{unit(t0.legs.filter(l => l.mode === 'flight').length, 'flight')}</span></div>}
          </div>
          <div class="chips" style="margin-top:12px;flex-wrap:wrap">
            <span class="pill st-visited">{t('p_' + t0.purpose)}</span>
            {t0.with.map(w => <span class="pill st-" key={w}><Icon name="person" size={13} />{w}</span>)}
            {t0.rate > 0 && <Stars value={t0.rate} readOnly />}
          </div>
        </div>
        <section class="section"><RouteMap s={s} t0={t0} /></section>
        <section class="section">
          <h2>{t('trip_stops')}</h2>
          <div class="list stopline">
            {t0.stops.map(st => {
              const city = st.city ? s.cities.find(c => c.id === st.city) : null;
              return (
                <button class="row" key={st.id} onClick={() => (city ? go('city/' + city.id) : go('country/' + st.cc))}>
                  <Flag cc={st.cc} />
                  <span class="grow">
                    <span class="title">{city ? cityName(city) + sep() + cname(C.get(st.cc)) : cname(C.get(st.cc))}</span>
                    <span class="meta">{[fmtRange(st.from, st.to, { short: true, noHijri: true }), st.transit ? t('trip_transit_short') : '', st.note].filter(Boolean).join(sep())}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
        {t0.legs.length > 0 && (
          <section class="section">
            <h2>{t('trip_legs')}</h2>
            <div class="list">
              {t0.legs.map(l => (
                <div class="row" key={l.id}>
                  <Icon name={MODE_ICON[l.mode]} />
                  <span class="grow">
                    <span class="title" dir="auto">{endLabel(l.a)} — {endLabel(l.b)}</span>
                    <span class="meta">{[fmtDate(l.date, { short: true, noHijri: true }), l.carrier, l.no].filter(Boolean).join(sep())}</span>
                  </span>
                  <span class="end num">{fmtKm(Math.round(haversine(l.a.lat, l.a.lon, l.b.lat, l.b.lon)))}</span>
                </div>
              ))}
            </div>
          </section>
        )}
        {t0.photos.length > 0 && (
          <section class="section">
            <h2>{t('trip_photos')}</h2>
            <div class="photos">{t0.photos.map((pid, i) => <Photo key={pid} id={pid} cover={pid === t0.cover} onClick={() => setView(i)} />)}</div>
          </section>
        )}
        {(t0.note || t0.cost > 0) && (
          <section class="section">
            <h2>{t('trip_note')}</h2>
            <div class="card pad">
              {t0.note && <p class="note-box" style="margin:0">{t0.note}</p>}
              {t0.cost > 0 && <p class="muted" style="margin:10px 0 0">{t('trip_cost')}: <b class="num">{fmtMoney(t0.cost, t0.cur || s.settings.currency)}</b></p>}
            </div>
          </section>
        )}
        <section class="section">
          <button class="btn danger wide" onClick={remove}><Icon name="trash" />{t('trip_delete')}</button>
        </section>
      </div>
      {view != null && <Viewer ids={t0.photos} index={view} s={s} onClose={() => setView(null)} />}
    </div>
  );
}
const endLabel = e => (e.code ? e.code + ' ' : '') + (isAr.value ? e.name || e.nameEn : e.nameEn || e.name);

/* ---------- editor ---------- */
function blankTrip(cc) {
  return { id: uid(), title: '', start: '', end: '', purpose: 'leisure', with: [], rate: 0, cost: 0, cur: '', note: '', stops: cc ? [{ id: uid(), cc, city: '', from: '', to: '', transit: false, note: '' }] : [], legs: [], photos: [], cover: '' };
}
export function TripEditor({ id }) {
  const s = state.value;
  const existing = id ? s.trips.find(x => x.id === id) : null;
  const preCC = route.value.query.get('cc');
  const [tr, setTr] = useState(() => (existing ? JSON.parse(JSON.stringify(existing)) : blankTrip(preCC && C.has(preCC) ? preCC : '')));
  const [places, setPlaces] = useState({}); // stop id -> place picked for a city not yet in the log
  const [newPhotos, setNewPhotos] = useState({}); // photo id -> meta (added in this editor)
  const [removedPhotos, setRemovedPhotos] = useState([]);
  const [picker, setPicker] = useState(null); // 'stop' | {leg, end}
  const [busy, setBusy] = useState('');
  const [withInput, setWithInput] = useState('');
  const [showLegs, setShowLegs] = useState(!!(existing && existing.legs.length));
  const [err, setErr] = useState('');
  const [photoAct, setPhotoAct] = useState(null);
  const saved = useRef(false);
  const newPhotosRef = useRef({}); newPhotosRef.current = newPhotos;
  // photos added but not saved are removed when leaving
  useEffect(() => () => { if (!saved.current) for (const pid of Object.keys(newPhotosRef.current)) deletePhoto(pid); }, []);
  const companions = useMemo(() => {
    const m = new Map();
    for (const x of s.trips) for (const w of x.with) m.set(w, (m.get(w) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  }, []);
  if (id && !existing) return <div class="screen"><TopBar title="" back="trips" /><Empty title={t('not_found')} /></div>;
  const set = patch => setTr(v => ({ ...v, ...patch }));
  const setStop = (sid, patch) => setTr(v => ({ ...v, stops: v.stops.map(x => (x.id === sid ? { ...x, ...patch } : x)) }));
  const moveStop = (i, d) => setTr(v => { const a = [...v.stops]; const j = i + d; if (j < 0 || j >= a.length) return v; [a[i], a[j]] = [a[j], a[i]]; return { ...v, stops: a }; });
  const stopCityName = st => { const p = places[st.id]; if (p) return isAr.value ? p.name : p.nameEn || p.name; const c = st.city && s.cities.find(x => x.id === st.city); return c ? cityName(c) : ''; };
  const pickCity = st => {
    addCitySheet.value = { cc: st.cc, pick: place => {
      const mine = s.cities.find(c => c.ref && c.ref === place.ref) || null;
      if (mine) { setStop(st.id, { city: mine.id }); setPlaces(p => { const n = { ...p }; delete n[st.id]; return n; }); }
      else { setStop(st.id, { city: '' }); setPlaces(p => ({ ...p, [st.id]: place })); }
    } };
  };
  const addWith = name => { const n = name.trim(); if (!n) return; if (!tr.with.includes(n)) set({ with: [...tr.with, n].slice(0, 30) }); setWithInput(''); };

  const pointOf = st => {
    const p = places[st.id];
    if (p) return { lat: p.lat, lon: p.lon, name: p.name, nameEn: p.nameEn, cc: p.cc };
    const c = st.city && s.cities.find(x => x.id === st.city);
    if (c) return { lat: c.lat, lon: c.lon, name: c.name, nameEn: c.nameEn, cc: c.cc };
    const k = C.get(st.cc); const cp = countryPoint(st.cc);
    const cap = k.cap && k.cap[0];
    return { ...cp, name: cap ? cap.ar || cap.en : k.ar, nameEn: cap ? cap.en : k.en, cc: st.cc };
  };
  const suggestLegs = async () => {
    setBusy('legs');
    try {
      const A = await loadAirports();
      const hp = s.profile.homeCity || (s.profile.home && { ...countryPoint(s.profile.home), name: cname(C.get(s.profile.home)), nameEn: C.get(s.profile.home).en, cc: s.profile.home });
      const pts = [];
      if (hp) pts.push({ ...hp, k: 'home' });
      for (const st of tr.stops) { if (st.cc === s.profile.home) continue; pts.push({ ...pointOf(st), k: st.city || places[st.id] ? 'city' : 'cc' }); }
      if (hp && pts.length > 1) pts.push({ ...hp, k: 'home' });
      const legs = [];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const d = haversine(a.lat, a.lon, b.lat, b.lon);
        const mode = d > 450 ? 'flight' : 'car';
        const end = p => {
          if (mode === 'flight') { const ap = nearestAirport(A, p.lat, p.lon, 160); if (ap) return { k: 'apt', code: ap.code, name: ap.cityAr || ap.city, nameEn: ap.city || ap.name, cc: ap.cc, lat: ap.lat, lon: ap.lon }; }
          return { k: p.k, code: '', name: p.name, nameEn: p.nameEn, cc: p.cc, lat: p.lat, lon: p.lon };
        };
        legs.push({ id: uid(), mode, a: end(a), b: end(b), date: i === 1 ? tr.start : (i === pts.length - 1 ? tr.end : (tr.stops[i - 1] && tr.stops[i - 1].from) || ''), carrier: '', no: '', note: '' });
      }
      set({ legs }); setShowLegs(true);
    } finally { setBusy(''); }
  };
  const addPics = async () => {
    const files = await pickFiles('image/*', true);
    if (!files.length) return;
    setBusy('photos');
    try {
      const added = await addPhotos(files, { trip: tr.id, date: tr.start }, (i, n) => setBusy(`photos:${i}/${n}`));
      if (!added.length) { toast(t('e_photos')); return; }
      setNewPhotos(p => { const n = { ...p }; for (const a of added) n[a.id] = a.meta; return n; });
      setTr(v => ({ ...v, photos: [...v.photos, ...added.map(a => a.id)], cover: v.cover || added[0].id }));
    } finally { setBusy(''); }
  };
  const removePhoto = pid => {
    setTr(v => ({ ...v, photos: v.photos.filter(x => x !== pid), cover: v.cover === pid ? (v.photos.find(x => x !== pid) || '') : v.cover }));
    if (newPhotos[pid]) { deletePhoto(pid); setNewPhotos(p => { const n = { ...p }; delete n[pid]; return n; }); }
    else setRemovedPhotos(v => [...v, pid]);
  };

  const save = () => {
    if (!tr.stops.length) { setErr(t('trip_need_stop')); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    const phase = tripPhase(tr);
    // new cities picked for stops are added to the log now
    const stops = tr.stops.map(st => {
      const p = places[st.id];
      if (!p) return st;
      const cid = addCity(p, { s: phase === 'upcoming' ? 'wish' : st.transit ? 'transit' : 'visited', first: phase === 'upcoming' ? '' : (st.from || tr.start) });
      return { ...st, city: cid || '' };
    });
    // photo details go with the trip
    if (Object.keys(newPhotos).length || removedPhotos.length) {
      update(st => {
        const ph = { ...st.photos };
        for (const [pid, m] of Object.entries(newPhotos)) if (tr.photos.includes(pid)) ph[pid] = { ...m, trip: tr.id };
        for (const pid of removedPhotos) delete ph[pid];
        st.photos = ph;
      });
      for (const pid of removedPhotos) deletePhoto(pid);
    }
    const out = saveTrip({ ...tr, stops, legs: showLegs ? tr.legs : tr.legs });
    saved.current = true;
    if (!out) { toast(t('e_generic')); return; }
    toast(t('trip_saved'));
    if (existing) back('trips'); else go('trip/' + out.id, true);
  };
  const days = tripDays(tr);
  const remove = async () => {
    if (!(await confirmDialog({ title: t('trip_delete_q'), text: t('trip_delete_text'), ok: t('delete'), danger: true }))) return;
    saved.current = true;
    const removed = deleteTrip(tr.id);
    for (const pid of removed ? removed.photos : []) deletePhoto(pid);
    update(st => { const p = { ...st.photos }; for (const pid of removed ? removed.photos : []) delete p[pid]; st.photos = p; });
    go('trips', true);
    toast(t('trip_deleted'));
  };
  return (
    <div class="screen">
      <TopBar title={existing ? t('trip_edit') : t('trip_new')} back="trips" sub actions={<button class="btn small" onClick={save}>{t('save')}</button>} />
      <div class="wrap">
        {err && <p class="banner bad"><Icon name="warn" />{err}</p>}
        <section class="section" style="margin-top:12px">
          <h2>{t('trip_dates')}{days > 0 && <span class="aside" style="color:var(--ink-2)">{count(days, 'day')}</span>}</h2>
          <div class="card pad" style="padding-top:2px">
            <DateField label={t('trip_start')} value={tr.start} onChange={v => set({ start: v, end: tr.end && v && dayStart(tr.end) < dayStart(v) ? '' : tr.end })} />
            <DateField label={t('trip_end')} value={tr.end} onChange={v => set({ end: v })} />
          </div>
        </section>

        <section class="section">
          <h2>{t('trip_stops')}</h2>
          {tr.stops.map((st, i) => (
            <div class="edit-stop" key={st.id}>
              <div class="top">
                <Flag cc={st.cc} />
                <span class="grow">{cname(C.get(st.cc))}</span>
                <span class="mini">
                  <button onClick={() => moveStop(i, -1)} disabled={i === 0} aria-label={t('move_up')}><Icon name="up" /></button>
                  <button onClick={() => moveStop(i, 1)} disabled={i === tr.stops.length - 1} aria-label={t('move_down')}><Icon name="down" /></button>
                  <button onClick={() => setTr(v => ({ ...v, stops: v.stops.filter(x => x.id !== st.id) }))} aria-label={t('delete')}><Icon name="trash" /></button>
                </span>
              </div>
              <button class="btn ghost wide small" style="margin-top:10px;justify-content:flex-start" onClick={() => pickCity(st)}>
                <Icon name="pin" />{stopCityName(st) || t('trip_pick_city')}
              </button>
              <details style="margin-top:6px" open={!!(st.from || st.to || st.note || st.transit)}>
                <summary class="small muted" style="padding:6px 2px;cursor:pointer">{t('trip_stop_more')}</summary>
                <div class="two">
                  <DayInput label={t('trip_arrive')} value={st.from} onChange={v => setStop(st.id, { from: v })} />
                  <DayInput label={t('trip_leave')} value={st.to} onChange={v => setStop(st.id, { to: v })} />
                </div>
                <div class="list" style="margin-top:10px;box-shadow:none"><Toggle checked={st.transit} onChange={v => setStop(st.id, { transit: v })} label={t('trip_stop_transit')} /></div>
                <label class="field"><span class="lab">{t('trip_stop_note')}</span><input class="input" value={st.note} maxLength={300} onInput={e => setStop(st.id, { note: e.currentTarget.value })} /></label>
              </details>
            </div>
          ))}
          <button class="btn soft wide" style="margin-top:10px" onClick={() => setPicker('stop')}><Icon name="plus" />{tr.stops.length ? t('trip_add_stop') : t('trip_add_first_stop')}</button>
        </section>

        <section class="section">
          <h2>{t('trip_about')}</h2>
          <div class="card pad" style="padding-top:2px">
            <Field label={t('trip_title')}><input class="input" value={tr.title} maxLength={120} placeholder={tripTitle(s, { ...tr, title: '' })} onInput={e => set({ title: e.currentTarget.value })} /></Field>
            <span class="lab" style="margin-top:14px">{t('trip_purpose')}</span>
            <div class="chips" style="flex-wrap:wrap">
              {PURPOSES.map(p => <button class="chip" key={p} aria-pressed={tr.purpose === p ? 'true' : 'false'} onClick={() => set({ purpose: p })}>{t('p_' + p)}</button>)}
            </div>
            <span class="lab" style="margin-top:14px">{t('trip_with')}</span>
            <div class="chips" style="flex-wrap:wrap">
              {tr.with.map(w => <button class="chip" key={w} aria-pressed="true" onClick={() => set({ with: tr.with.filter(x => x !== w) })}>{w}<Icon name="x" class="x" /></button>)}
            </div>
            <div style="display:flex;gap:8px;margin-top:6px">
              <input class="input" value={withInput} maxLength={60} placeholder={t('trip_with_ph')} onInput={e => setWithInput(e.currentTarget.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addWith(withInput); } }} />
              <button class="btn ghost" onClick={() => addWith(withInput)} disabled={!withInput.trim()}>{t('add')}</button>
            </div>
            {companions.filter(w => !tr.with.includes(w)).length > 0 && (
              <div class="chips" style="margin-top:8px">{companions.filter(w => !tr.with.includes(w)).slice(0, 12).map(w => <button class="chip" key={w} onClick={() => addWith(w)}><Icon name="plus" class="x" />{w}</button>)}</div>
            )}
            <div style="margin-top:14px"><span class="lab">{t('trip_rating')}</span><Stars value={tr.rate} onChange={v => set({ rate: v })} /></div>
            <div class="two">
              <Field label={t('trip_cost')}><input class="input" inputMode="decimal" value={tr.cost || ''} onInput={e => set({ cost: Math.max(0, parseFloat(e.currentTarget.value.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^\d.]/g, '')) || 0) })} /></Field>
              <Field label={t('trip_currency')}><input class="input" dir="ltr" value={tr.cur} maxLength={3} placeholder={s.settings.currency} onInput={e => set({ cur: e.currentTarget.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) })} /></Field>
            </div>
            <Field label={t('trip_note')}><textarea class="input" value={tr.note} maxLength={4000} placeholder={t('trip_note_ph')} onInput={e => set({ note: e.currentTarget.value })} /></Field>
          </div>
        </section>

        <section class="section">
          <h2>{t('trip_photos')}{busy.startsWith('photos') && <span class="aside" style="color:var(--ink-2)"><Spinner size={16} /> {busy.split(':')[1] || ''}</span>}</h2>
          <div class="photos">
            {tr.photos.map(pid => (
              <div key={pid} style="position:relative">
                <Photo id={pid} cover={pid === tr.cover} onClick={() => setPhotoAct(pid)} />
              </div>
            ))}
            <button class="ph add" onClick={addPics} aria-label={t('trip_add_photos')}><Icon name="photo" /></button>
          </div>
          <p class="hint">{t('trip_photos_hint')}</p>
        </section>

        <section class="section">
          <h2>{t('trip_legs')}<button class="aside" onClick={suggestLegs} disabled={!tr.stops.length || busy === 'legs'}>{busy === 'legs' ? <Spinner size={16} /> : t('trip_legs_suggest')}</button></h2>
          {tr.legs.map((l, i) => (
            <div class="edit-stop" key={l.id}>
              <div class="top">
                <Icon name={MODE_ICON[l.mode]} />
                <span class="grow" dir="auto">{endLabel(l.a)} — {endLabel(l.b)}</span>
                <span class="mini"><button onClick={() => set({ legs: tr.legs.filter(x => x.id !== l.id) })} aria-label={t('delete')}><Icon name="trash" /></button></span>
              </div>
              <div class="chips" style="margin-top:8px">
                {MODES.map(m => <button class="chip" key={m} aria-pressed={l.mode === m ? 'true' : 'false'} onClick={() => set({ legs: tr.legs.map(x => (x.id === l.id ? { ...x, mode: m } : x)) })}><Icon name={MODE_ICON[m]} class="x" />{t('m_' + m)}</button>)}
              </div>
              <div class="two" style="margin-top:6px">
                <button class="btn ghost small" onClick={() => setPicker({ leg: l.id, end: 'a' })}>{t('trip_leg_from')}: {l.a.code || (isAr.value ? l.a.name : l.a.nameEn) || '—'}</button>
                <button class="btn ghost small" onClick={() => setPicker({ leg: l.id, end: 'b' })}>{t('trip_leg_to')}: {l.b.code || (isAr.value ? l.b.name : l.b.nameEn) || '—'}</button>
              </div>
              {l.mode === 'flight' && (
                <div class="two">
                  <Field label={t('trip_leg_carrier')}><input class="input" value={l.carrier} maxLength={60} onInput={e => set({ legs: tr.legs.map(x => (x.id === l.id ? { ...x, carrier: e.currentTarget.value } : x)) })} /></Field>
                  <Field label={t('trip_leg_no')}><input class="input" dir="ltr" value={l.no} maxLength={16} onInput={e => set({ legs: tr.legs.map(x => (x.id === l.id ? { ...x, no: e.currentTarget.value.toUpperCase() } : x)) })} /></Field>
                </div>
              )}
              <DateField label={t('trip_leg_date')} value={l.date} onChange={v => set({ legs: tr.legs.map(x => (x.id === l.id ? { ...x, date: v } : x)) })} />
            </div>
          ))}
          {!tr.legs.length && <p class="hint">{t('trip_legs_hint')}</p>}
          <button class="btn ghost wide" style="margin-top:10px" disabled={!tr.stops.length} onClick={() => {
            const last = tr.legs[tr.legs.length - 1];
            const a = last ? last.b : (() => { const p = tr.stops[0] && pointOf(tr.stops[0]); return p ? { k: 'city', code: '', ...p } : null; })();
            if (!a) return;
            set({ legs: [...tr.legs, { id: uid(), mode: 'flight', a, b: { ...a }, date: '', carrier: '', no: '', note: '' }] });
          }}><Icon name="plus" />{t('trip_add_leg')}</button>
        </section>

        <section class="section">
          <button class="btn wide" onClick={save}><Icon name="check" />{t('trip_save')}</button>
          {existing && <button class="btn danger wide" style="margin-top:10px" onClick={remove}><Icon name="trash" />{t('trip_delete')}</button>}
        </section>
      </div>
      {photoAct && (
        <Sheet onClose={() => setPhotoAct(null)} title={t('trip_photo_q')}>
          <div style="display:grid;gap:10px">
            <button class="btn soft" disabled={photoAct === tr.cover} onClick={() => { set({ cover: photoAct }); setPhotoAct(null); }}><Icon name="photo" />{t('trip_set_cover')}</button>
            <button class="btn danger" onClick={() => { removePhoto(photoAct); setPhotoAct(null); }}><Icon name="trash" />{t('trip_photo_remove')}</button>
          </div>
        </Sheet>
      )}
      {picker === 'stop' && <CountryPicker title={t('trip_add_stop')} onClose={() => setPicker(null)} onPick={cc => { setTr(v => ({ ...v, stops: [...v.stops, { id: uid(), cc, city: '', from: '', to: '', transit: false, note: '' }] })); setErr(''); setPicker(null); }} />}
      {picker && picker.leg && (
        <EndPicker s={s} tr={tr} pointOf={pointOf} onClose={() => setPicker(null)} onPick={end => {
          set({ legs: tr.legs.map(x => (x.id === picker.leg ? { ...x, [picker.end]: end } : x)) });
          setPicker(null);
        }} />
      )}
    </div>
  );
}

/** the start or end of a leg: home, one of the trip's stops, or any airport */
function EndPicker({ s, tr, pointOf, onPick, onClose }) {
  const [A, setA] = useState(airportsIfLoaded());
  const [q, setQ] = useState('');
  useEffect(() => { if (!A) loadAirports().then(setA, () => {}); }, []);
  const quick = [];
  const hp = s.profile.homeCity;
  if (hp) quick.push({ k: 'home', code: '', name: hp.name, nameEn: hp.nameEn, cc: hp.cc || s.profile.home, lat: hp.lat, lon: hp.lon });
  for (const st of tr.stops) { const p = pointOf(st); if (p && isFinite(p.lat)) quick.push({ k: 'city', code: '', ...p }); }
  const near = A ? quick.map(p => nearestAirport(A, p.lat, p.lon, 160)).filter(Boolean) : [];
  const found = A && q.trim() ? searchAirports(A, q.trim(), 30) : [];
  const apt = a => ({ k: 'apt', code: a.code, name: a.cityAr || a.city, nameEn: a.city || a.name, cc: a.cc, lat: a.lat, lon: a.lon });
  const AptRow = ({ a }) => (
    <button class="row" onClick={() => onPick(apt(a))}>
      <b class="num" dir="ltr" style="font-family:var(--kufi);font-size:18px;min-width:46px">{a.code}</b>
      <span class="grow"><span class="title">{a.cityAr && isAr.value ? a.cityAr : a.city}</span><span class="meta" dir="auto">{a.name}</span></span>
      <Flag cc={a.cc} size="sm" />
    </button>
  );
  return (
    <Sheet onClose={onClose} title={t('trip_pick_end')}>
      <div class="search"><Icon name="search" /><input value={q} onInput={e => setQ(e.currentTarget.value)} placeholder={t('apt_search')} aria-label={t('apt_search')} /></div>
      {q.trim() ? (
        <div class="list" style="margin-top:10px">{found.map(a => <AptRow key={a.code} a={a} />)}{!found.length && <p class="hint" style="padding:14px 16px">{A ? t('no_results') : t('loading')}</p>}</div>
      ) : (
        <>
          <h3 class="lab" style="margin-top:14px">{t('trip_places')}</h3>
          <div class="list">
            {quick.map((p, i) => (
              <button class="row" key={i} onClick={() => onPick(p)}>
                <Icon name={p.k === 'home' ? 'home' : 'pin'} />
                <span class="grow"><span class="title">{isAr.value ? p.name || p.nameEn : p.nameEn || p.name}</span></span>
                <Flag cc={p.cc} size="sm" />
              </button>
            ))}
          </div>
          {near.length > 0 && (<><h3 class="lab" style="margin-top:14px">{t('trip_airports_near')}</h3><div class="list">{[...new Map(near.map(a => [a.code, a])).values()].map(a => <AptRow key={a.code} a={a} />)}</div></>)}
        </>
      )}
    </Sheet>
  );
}
