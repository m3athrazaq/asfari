// A country: the quick sheet from the map, and its full page.
import { useState, useEffect, useMemo } from 'preact/hooks';
import { signal } from '@preact/signals';
import { C } from '../../core/data.js';
import { state, setCountry } from '../../core/store.js';
import { R, countrySheet, openCountry, openCity, openAddCity } from '../app-state.js';
import { t, num, compact, cname, cityName, fmtDate, fmtRange, unit, count, isAr, lang } from '../../core/i18n.js';
import { debounce } from '../../core/util.js';
import { Flag, Sheet, TopBar, Stars, Toggle, DateField, toast, Empty } from '../kit.jsx';
import { Icon } from '../icons.jsx';
import { go } from '../router.js';
import { stampEvent } from './MapScreen.jsx';
import { mapColors, statusFill } from '../mapcolors.js';
import { RANK } from '../../core/derive.js';
import { SUB_AR } from '../../core/strings.js';
import { TripRow } from './Trips.jsx';

export const pendingMapZoom = signal(null);
// names of currencies and languages in the app's language, from the browser (English from the data otherwise)
const dn = {};
const display = (type, code, fallback) => {
  try {
    const k = lang.value + type;
    if (!dn[k]) dn[k] = new Intl.DisplayNames([lang.value], { type });
    const v = dn[k].of(code);
    return v && v.toLowerCase() !== code.toLowerCase() ? v : fallback;
  } catch (e) { return fallback; }
};
const currencyName = x => display('currency', x[0], x[1]);
const languageName = x => (Array.isArray(x) ? display('language', x[0], x[1]) : x);
export function showOnMap(cc) { pendingMapZoom.value = cc; go('map'); }

export const subName = c => (isAr.value ? SUB_AR[c.sub] || c.sub : c.sub);
export const contName = k => t('cont_' + k);
const STATUS_OPTS = ['visited', 'lived', 'transit', 'wish'];

/** pick a status; returns the new effective status via onPicked */
export function StatusPicker({ cc, onPicked }) {
  const s = state.value, r = R.value;
  const e = r.cs.get(cc);
  const manual = (s.countries[cc] && s.countries[cc].s) || '';
  const eff = e ? e.status : '';
  const derived = e ? e.derived : '';
  const home = s.profile.home === cc;
  const pick = st => {
    const before = eff;
    const col = mapColors();
    const from = statusFill(col, before, home);
    const prevManual = manual;
    setCountry(cc, { s: st });
    const after = R.value.cs.get(cc);
    const now = after ? after.status : '';
    if (now !== before && (now === 'visited' || now === 'lived' || now === 'wish' || now === 'transit')) stampEvent.value = { cc, from };
    onPicked && onPicked(now, () => setCountry(cc, { s: prevManual }));
  };
  if (home) return <p class="banner" style="margin-top:14px"><Icon name="home" /><span>{t('c_is_home')}</span></p>;
  return (
    <>
      <div class="stamps-pick" role="group" aria-label={t('c_status')}>
        {STATUS_OPTS.map(st => (
          <button key={st} class={'st-' + st} aria-pressed={eff === st ? 'true' : 'false'} onClick={() => pick(st)}>
            <i class={'dot st-' + st} />{t('st_' + st)}
          </button>
        ))}
        {(manual || eff) && <button class="none" onClick={() => pick('')}>{t('st_clear')}</button>}
      </div>
      {derived && RANK[derived] > RANK[manual] && derived !== 'planned' && <p class="hint">{t('c_status_auto')}</p>}
      {eff === 'planned' && <p class="hint">{t('c_status_planned')}</p>}
    </>
  );
}

function Numbers({ cc }) {
  const r = R.value;
  const e = r.cs.get(cc);
  if (!e) return null;
  const visitedCities = e.cities.map(id => state.value.cities.find(c => c.id === id)).filter(c => c && c.s !== 'wish');
  const items = [];
  if (e.first != null && !e.home) items.push([fmtDate(e.firstStr, { short: true, noHijri: true }), t('c_first_visit')]);
  if (e.visits) items.push([num(e.visits), unit(e.visits, 'trip')]);
  if (e.dayCount) items.push([num(e.dayCount), unit(e.dayCount, 'day')]);
  if (visitedCities.length) items.push([num(visitedCities.length), unit(visitedCities.length, 'city')]);
  if (!items.length) return null;
  return <div class="kv">{items.map(([v, l], i) => <div key={i}><b class="num">{v}</b><span>{l}</span></div>)}</div>;
}

export function CountrySheet() {
  const cc = countrySheet.value;
  if (!cc || !C.has(cc) || !R.value) return null;
  const c = C.get(cc);
  const close = () => { countrySheet.value = null; };
  const picked = (st, undo) => {
    close();
    const label = st ? t('st_' + st) : t('st_cleared');
    toast(`${cname(c)}: ${label}`, { action: t('undo'), onAction: undo });
  };
  return (
    <Sheet onClose={close} label={cname(c)} head={
      <div class="ctry-head">
        <Flag cc={cc} size="lg" />
        <div class="names"><b>{cname(c)}</b><span>{isAr.value ? c.en : c.ar}{c.un ? '' : ' — ' + t('c_territory')}</span></div>
      </div>
    }>
      <StatusPicker cc={cc} onPicked={picked} />
      <Numbers cc={cc} />
      <div class="btns" style="margin-top:16px">
        <button class="btn soft" onClick={() => { close(); go('country/' + cc); }}>{t('c_details')}</button>
        <button class="btn ghost" onClick={() => { close(); go('trip-new?cc=' + cc); }}><Icon name="plus" />{t('c_trip')}</button>
        <button class="btn ghost" onClick={() => { close(); openAddCity({ cc }); }}><Icon name="plus" />{t('c_city')}</button>
      </div>
    </Sheet>
  );
}

export function CountryPage({ cc }) {
  const c = C.get(cc);
  const s = state.value, r = R.value;
  const mine = s.countries[cc] || { s: '', first: '', note: '', fav: false, rate: 0 };
  const [noteText, setNote] = useState(mine.note);
  const saveNote = useMemo(() => debounce(v => setCountry(cc, { note: v }), 500), [cc]);
  if (!c || !r) return <div class="screen"><TopBar title="" back="places" /><Empty title={t('not_found')} /></div>;
  const e = r.cs.get(cc);
  const cities = (e ? e.cities : []).map(id => s.cities.find(x => x.id === id)).filter(Boolean)
    .sort((a, b) => (a.s === 'wish') - (b.s === 'wish') || cityName(a).localeCompare(cityName(b), lang.value));
  const trips = r.trips.filter(x => x.t.stops.some(st => st.cc === cc)).reverse();
  const cap = c.cap && c.cap[0];
  const facts = [
    cap && [t('c_capital'), c.cap.map(k => (isAr.value ? k.ar || k.en : k.en)).join(isAr.value ? '، ' : ', ')],
    [t('c_region'), `${contName(c.cont)}${c.sub ? (isAr.value ? '، ' : ', ') + subName(c) : ''}`],
    c.pop > 0 && [t('c_population'), compact(c.pop)],
    c.area > 0 && [t('c_area'), num(c.area) + ' ' + t('km2')],
    c.cur.length && [t('c_currency'), c.cur.map(x => `${currencyName(x)} (${x[0]})`).join(isAr.value ? '، ' : ', ')],
    c.lang.length && [t('c_languages'), c.lang.slice(0, 4).map(languageName).join(isAr.value ? '، ' : ', ')],
    c.idd && [t('c_calling'), <span dir="ltr">{c.idd}</span>]
  ].filter(Boolean);
  return (
    <div class="screen">
      <TopBar title={cname(c)} back="places" sub actions={<button class="iconbtn" onClick={() => showOnMap(cc)} aria-label={t('c_on_map')}><Icon name="map" /></button>} />
      <div class="wrap">
        <div class="ctry-head" style="margin-top:8px">
          <Flag cc={cc} size="lg" />
          <div class="names"><b>{cname(c)}</b>{isAr.value ? <>{c.arf && c.arf !== c.ar && <span>{c.arf}</span>}<span>{c.en}</span></> : <>{c.enf !== c.en && <span>{c.enf}</span>}<span>{c.ar}</span></>}</div>
        </div>
        {!c.un && <p class="hint">{c.c === 'PS' || c.c === 'VA' ? t('c_observer') : t('c_territory_long')}</p>}
        <StatusPicker cc={cc} />
        <Numbers cc={cc} />

        <section class="section">
          <h2>{t('c_cities')}<button class="aside" onClick={() => openAddCity({ cc })}>{t('add_city')}</button></h2>
          {cities.length ? (
            <div class="list">
              {cities.map(x => (
                <button class="row" key={x.id} onClick={() => openCity(x.id)}>
                  <i class={'dot st-' + x.s} />
                  <span class="grow"><span class="title">{cityName(x)}</span>{r.cityFirst.get(x.id) && x.s !== 'wish' && <span class="meta">{fmtDate(r.cityFirst.get(x.id), { noHijri: true })}</span>}</span>
                  <Stars value={x.rate} readOnly />
                  <Icon name="chev" class="chev flip" />
                </button>
              ))}
            </div>
          ) : <p class="hint">{t('c_no_cities')}</p>}
        </section>

        <section class="section">
          <h2>{t('c_trips')}<button class="aside" onClick={() => go('trip-new?cc=' + cc)}>{t('trip_new')}</button></h2>
          {trips.length ? <div class="list">{trips.map(x => <TripRow key={x.id} x={x} />)}</div> : <p class="hint">{t('c_no_trips')}</p>}
        </section>

        <section class="section">
          <h2>{t('c_mine')}</h2>
          <div class="card pad">
            {e && e.status !== 'wish' && !e.home && (
              <DateField label={t('c_first_manual')} value={mine.first} onChange={v => setCountry(cc, { first: v })} hint={t('c_first_hint')} />
            )}
            <div style="margin-top:14px"><span class="lab">{t('c_rate')}</span><Stars value={mine.rate} onChange={v => setCountry(cc, { rate: v })} /></div>
            <label class="field"><span class="lab">{t('c_note')}</span>
              <textarea class="input" value={noteText} placeholder={t('c_note_ph', { name: cname(c) })}
                onInput={ev => { setNote(ev.currentTarget.value); saveNote(ev.currentTarget.value); }} onBlur={ev => saveNote.flush(ev.currentTarget.value)} />
            </label>
          </div>
          <div class="list" style="margin-top:12px"><Toggle checked={mine.fav} onChange={v => setCountry(cc, { fav: v })} label={t('c_fav')} /></div>
        </section>

        <section class="section">
          <h2>{t('c_facts')}</h2>
          <dl class="facts">{facts.map(([k, v], i) => <div key={i}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          {c.b.length > 0 && (
            <>
              <h3 class="lab" style="margin-top:16px">{t('c_neighbors')}</h3>
              <div class="chips" style="flex-wrap:wrap">
                {c.b.map(b => { const n = C.get(b); const be = r.cs.get(b); return n && (
                  <button class="chip" key={b} onClick={() => go('country/' + b)}>
                    <Flag cc={b} size="sm" />{cname(n)}{be && be.counted ? <Icon name="check" size={15} style="color:var(--visa)" /> : null}
                  </button>
                ); })}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
