// Cities: adding one (search, nearby places, current location), the quick sheet and the full page.
import { useState, useEffect, useMemo, useRef } from 'preact/hooks';
import { signal } from '@preact/signals';
import { C, loadCities, citiesIfLoaded, searchCities, nearestCities, countryAtPoint } from '../../core/data.js';
import { state, addCity, updateCity, deleteCity, restoreCity, findCity, STATUSES } from '../../core/store.js';
import { R, addCitySheet, citySheet, openCity } from '../app-state.js';
import { t, num, compact, cname, cityName, fmtDate, isAr, fmtKm } from '../../core/i18n.js';
import { debounce } from '../../core/util.js';
import { Flag, Sheet, TopBar, Stars, Toggle, DateField, Seg, toast, confirmDialog, Empty, Spinner } from '../kit.jsx';
import { Icon } from '../icons.jsx';
import { go, back } from '../router.js';
import { TripRow } from './Trips.jsx';
import { mapRef } from './MapScreen.jsx';

const CITY_ST = () => [['visited', t('cst_visited')], ['wish', t('cst_wish')], ['lived', t('cst_lived')], ['transit', t('cst_transit')]];
export const pendingCityZoom = signal(null);

function useCities() {
  const [D, setD] = useState(citiesIfLoaded());
  const [err, setErr] = useState(false);
  useEffect(() => { if (!D) loadCities().then(setD, () => setErr(true)); }, []);
  return [D, err];
}

/**
 * Add a city. opts: { cc, lat, lon, here, status, pick } — with pick(place), nothing is added: the
 * chosen place is handed back (the trip editor adds it when the trip is saved).
 */
export function AddCitySheet() {
  const opts = addCitySheet.value;
  if (!opts) return null;
  return <AddCity opts={opts} onClose={() => { addCitySheet.value = null; }} />;
}
function AddCity({ opts, onClose }) {
  const [D, err] = useCities();
  const [q, setQ] = useState('');
  const [onlyCC, setOnlyCC] = useState(opts.cc || '');
  const [status, setStatus] = useState(opts.status || 'visited');
  const [customName, setCustomName] = useState('');
  const inp = useRef();
  useEffect(() => { if (opts.lat == null) setTimeout(() => inp.current && inp.current.focus(), 200); }, []);
  const s = state.value;
  const [dq, setDq] = useState('');
  const upd = useMemo(() => debounce(setDq, 160), []);
  const results = useMemo(() => (D && dq.trim().length >= 2 ? searchCities(D, dq.trim(), { cc: onlyCC, limit: 40 }) : []), [D, dq, onlyCC]);
  const near = useMemo(() => (D && opts.lat != null ? nearestCities(D, opts.lat, opts.lon, { radius: opts.here ? 30 : 45, limit: 8 }) : []), [D]);
  const pointCC = useMemo(() => (opts.lat != null ? countryAtPoint(opts.lon, opts.lat) : null), []);
  const choose = place => {
    if (opts.pick) { opts.pick(place); onClose(); return; }
    const existing = findCity(state.value, place);
    const id = addCity(place, { s: status });
    onClose();
    if (!id) return;
    toast(existing ? t('city_exists_now', { name: cityName(place) }) : t('city_added', { name: cityName(place) }), { action: t('details'), onAction: () => openCity(id) });
  };
  const addCustom = () => {
    const name = customName.trim();
    if (!name || opts.lat == null) return;
    const cc = pointCC || (near[0] && near[0].cc) || opts.cc;
    if (!cc) return toast(t('city_no_country'));
    choose({ name, nameEn: isAr.value ? '' : name, cc, lat: +opts.lat.toFixed(5), lon: +opts.lon.toFixed(5), ref: '' });
  };
  const Row = ({ p }) => {
    const mine = findCity(s, p);
    const c = C.get(p.cc);
    return (
      <button class="row" onClick={() => choose(p)}>
        <Flag cc={p.cc} />
        <span class="grow">
          <span class="title">{isAr.value ? p.name : p.nameEn}{!isAr.value || p.name === p.nameEn ? '' : <span class="faint small"> — {p.nameEn}</span>}</span>
          <span class="meta">{[cname(c), p.kind === 2 ? t('city_capital') : '', p.km != null ? fmtKm(Math.round(p.km)) : '', p.pop > 1000 ? t('city_pop', { n: compact(p.pop) }) : ''].filter(Boolean).join(isAr.value ? '، ' : ', ')}</span>
        </span>
        {mine ? <span class="pill st-visited">{t('city_in_log')}</span> : <Icon name="plus" class="chev" />}
      </button>
    );
  };
  return (
    <Sheet onClose={onClose} title={opts.pick ? t('city_pick_title') : opts.here ? t('city_here_title') : t('city_add_title')}>
      {!opts.pick && <Seg value={status} onChange={setStatus} options={CITY_ST().slice(0, 3)} label={t('city_status')} />}
      <div class="search" style="margin-top:12px">
        <Icon name="search" />
        <input ref={inp} value={q} onInput={e => { setQ(e.currentTarget.value); upd(e.currentTarget.value); }} placeholder={t('city_search_ph')} aria-label={t('city_search_ph')} />
        {q && <button class="iconbtn" onClick={() => { setQ(''); setDq(''); }} aria-label={t('clear')}><Icon name="x" /></button>}
      </div>
      {opts.cc && (
        <div class="chips" style="margin-top:8px">
          <button class="chip" aria-pressed={onlyCC ? 'true' : 'false'} onClick={() => setOnlyCC(onlyCC ? '' : opts.cc)}><Flag cc={opts.cc} size="sm" />{t('city_only_in', { country: cname(C.get(opts.cc)) })}</button>
        </div>
      )}
      {err && <p class="err">{t('e_load_data')}</p>}
      {!D && !err && <p class="hint" style="display:flex;gap:8px;align-items:center"><Spinner size={18} />{t('loading')}</p>}
      {dq.trim().length >= 2 && D && (
        <div class="list" style="margin-top:10px">
          {results.map((p, i) => <Row key={p.ref + i} p={p} />)}
          {!results.length && <p class="hint" style="padding:14px 16px">{t('city_none')}</p>}
        </div>
      )}
      {!dq.trim() && near.length > 0 && (
        <>
          <h3 class="lab" style="margin-top:16px">{opts.here ? t('city_you_are_near') : t('city_nearby')}</h3>
          <div class="list">{near.map((p, i) => <Row key={p.ref + i} p={p} />)}</div>
        </>
      )}
      {!dq.trim() && opts.lat != null && !opts.pick && (
        <div class="card pad" style="margin-top:14px;box-shadow:none;background:var(--paper-2)">
          <span class="lab">{t('city_custom_here')}</span>
          <div style="display:flex;gap:8px">
            <input class="input" value={customName} onInput={e => setCustomName(e.currentTarget.value)} placeholder={t('city_custom_ph')} maxLength={120} />
            <button class="btn" disabled={!customName.trim()} onClick={addCustom}>{t('add')}</button>
          </div>
          {pointCC && <p class="hint"><Flag cc={pointCC} size="sm" /> {cname(C.get(pointCC))}</p>}
        </div>
      )}
      {opts.lat == null && <p class="hint" style="margin-top:14px">{t('city_custom_tip')}</p>}
    </Sheet>
  );
}

export function CitySheet() {
  const id = citySheet.value;
  const s = state.value;
  const close = () => { citySheet.value = null; };
  if (id === '__home') {
    const h = s.profile.homeCity;
    if (!h) return null;
    return (
      <Sheet onClose={close} head={<div class="ctry-head"><Flag cc={h.cc || s.profile.home} size="lg" /><div class="names"><b>{h.name || h.nameEn}</b><span>{t('city_home')}</span></div></div>}>
        <button class="btn ghost wide" onClick={() => { close(); go('settings'); }}>{t('city_change_home')}</button>
      </Sheet>
    );
  }
  const c = s.cities.find(x => x.id === id);
  if (!c) return null;
  const country = C.get(c.cc);
  return (
    <Sheet onClose={close} label={cityName(c)} head={
      <div class="ctry-head"><Flag cc={c.cc} size="lg" /><div class="names"><b>{cityName(c)}</b><span>{cname(country)}{c.first ? (isAr.value ? '، ' : ', ') + fmtDate(c.first, { noHijri: true }) : ''}</span></div></div>
    }>
      <Seg value={c.s} onChange={v => updateCity(c.id, { s: v })} options={CITY_ST()} label={t('city_status')} />
      <div class="btns" style="margin-top:16px">
        <button class="btn soft" onClick={() => { close(); go('city/' + c.id); }}>{t('c_details')}</button>
        <button class="btn ghost" onClick={() => { close(); go('country/' + c.cc); }}><Flag cc={c.cc} size="sm" />{cname(country)}</button>
      </div>
    </Sheet>
  );
}

export function CityPage({ id }) {
  const s = state.value, r = R.value;
  const c = s.cities.find(x => x.id === id);
  const [name, setName] = useState(c ? c.name : '');
  const [nameEn, setNameEn] = useState(c ? c.nameEn : '');
  const [note, setNote] = useState(c ? c.note : '');
  const saveNote = useMemo(() => debounce(v => updateCity(id, { note: v }), 500), [id]);
  const saveName = useMemo(() => debounce(v => v.trim() && updateCity(id, { name: v.trim() }), 500), [id]);
  const saveNameEn = useMemo(() => debounce(v => updateCity(id, { nameEn: v.trim() }), 500), [id]);
  if (!c || !r) return <div class="screen"><TopBar title="" back="places" /><Empty title={t('not_found')} /></div>;
  const country = C.get(c.cc);
  const trips = r.trips.filter(x => x.t.stops.some(st => st.city === c.id)).reverse();
  const remove = async () => {
    if (!(await confirmDialog({ title: t('city_delete_q', { name: cityName(c) }), text: trips.length ? t('city_delete_text') : '', ok: t('delete'), danger: true }))) return;
    const removed = deleteCity(c.id);
    back('places');
    toast(t('city_deleted', { name: cityName(c) }), { action: t('undo'), onAction: () => restoreCity(removed) });
  };
  const onMap = () => { pendingCityZoom.value = { lat: c.lat, lon: c.lon }; go('map'); };
  return (
    <div class="screen">
      <TopBar title={cityName(c)} back="places" sub actions={<>
        <button class="iconbtn" onClick={onMap} aria-label={t('c_on_map')}><Icon name="map" /></button>
        <button class="iconbtn" onClick={remove} aria-label={t('delete')}><Icon name="trash" /></button>
      </>} />
      <div class="wrap">
        <button class="row card" style="margin-top:6px;border-radius:16px" onClick={() => go('country/' + c.cc)}>
          <Flag cc={c.cc} /><span class="grow"><span class="title">{cname(country)}</span></span><Icon name="chev" class="chev flip" />
        </button>
        <section class="section">
          <Seg value={c.s} onChange={v => updateCity(c.id, { s: v })} options={CITY_ST()} label={t('city_status')} />
          <div class="card pad" style="margin-top:12px">
            <DateField label={c.s === 'wish' ? t('city_when_wish') : t('city_first')} value={c.first} onChange={v => updateCity(c.id, { first: v })} />
            <div style="margin-top:14px"><span class="lab">{t('c_rate')}</span><Stars value={c.rate} onChange={v => updateCity(c.id, { rate: v })} /></div>
            <label class="field"><span class="lab">{t('c_note')}</span>
              <textarea class="input" value={note} placeholder={t('c_note_ph', { name: cityName(c) })} onInput={e => { setNote(e.currentTarget.value); saveNote(e.currentTarget.value); }} onBlur={e => saveNote.flush(e.currentTarget.value)} />
            </label>
          </div>
          <div class="list" style="margin-top:12px"><Toggle checked={c.fav} onChange={v => updateCity(c.id, { fav: v })} label={t('c_fav')} /></div>
        </section>
        <section class="section">
          <h2>{t('city_trips')}</h2>
          {trips.length ? <div class="list">{trips.map(x => <TripRow key={x.id} x={x} />)}</div> : <p class="hint">{t('city_no_trips')}</p>}
        </section>
        <section class="section">
          <h2>{t('city_names')}</h2>
          <div class="card pad">
            <label class="field" style="margin-top:0"><span class="lab">{t('city_name')}</span>
              <input class="input" value={name} maxLength={120} onInput={e => { setName(e.currentTarget.value); saveName(e.currentTarget.value); }} onBlur={e => saveName.flush(e.currentTarget.value)} /></label>
            <label class="field"><span class="lab">{t('city_name_en')}</span>
              <input class="input" dir="ltr" value={nameEn} maxLength={120} onInput={e => { setNameEn(e.currentTarget.value); saveNameEn(e.currentTarget.value); }} onBlur={e => saveNameEn.flush(e.currentTarget.value)} /></label>
            <p class="hint" dir="ltr" style="text-align:start">{c.lat.toFixed(4)}, {c.lon.toFixed(4)}</p>
          </div>
        </section>
      </div>
    </div>
  );
}
