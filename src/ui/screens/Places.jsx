// The "Countries" tab: every country with your status, and your cities.
import { useState, useMemo } from 'preact/hooks';
import { COUNTRIES, C, CONTINENTS, searchCountries } from '../../core/data.js';
import { state } from '../../core/store.js';
import { R, openAddCity, openCity } from '../app-state.js';
import { t, num, cname, cityName, fmtDate, unit, count, isAr, lang } from '../../core/i18n.js';
import { byName } from '../../core/i18n.js';
import { normText, searchKey } from '../../core/util.js';
import { Flag, TopBar, Seg, Empty, Stars } from '../kit.jsx';
import { Icon } from '../icons.jsx';
import { go, route } from '../router.js';
import { contName } from './Country.jsx';

const FILTERS = ['all', 'visited', 'lived', 'transit', 'wish', 'none'];

export function PlacesScreen() {
  const tab = route.value.query.get('v') === 'cities' ? 'cities' : 'countries';
  const setTab = v => go('places' + (v === 'cities' ? '?v=cities' : ''), true);
  return (
    <div class="screen">
      <TopBar title={t('places_title')} />
      <div class="wrap">
        <Seg value={tab} onChange={setTab} options={[['countries', t('list_countries')], ['cities', t('list_cities')]]} />
        {tab === 'countries' ? <CountryList /> : <CityList />}
      </div>
      {tab === 'cities' && <button class="fab" onClick={() => openAddCity({})}><Icon name="plus" />{t('add_city')}</button>}
    </div>
  );
}

function CountryList() {
  const r = R.value, s = state.value;
  const [q, setQ] = useState('');
  const [f, setF] = useState('all');
  const [sort, setSort] = useState('cont');
  if (!r) return null;
  const st = c => { const e = r.cs.get(c.c); return e ? (e.home ? 'home' : e.status) : ''; };
  const pass = c => {
    const x = st(c);
    if (f === 'all') return true;
    if (f === 'none') return !x || x === 'planned';
    if (f === 'visited') return x === 'visited';
    if (f === 'lived') return x === 'lived' || x === 'home';
    if (f === 'wish') return x === 'wish' || x === 'planned';
    return x === f;
  };
  const base = q.trim() ? searchCountries(q.trim(), lang.value) : COUNTRIES;
  const list = base.filter(pass);
  const nameSort = (a, b) => byName(isAr.value ? a.ar : a.en, isAr.value ? b.ar : b.en);
  const counts = {};
  for (const k of FILTERS) counts[k] = 0;
  for (const c of COUNTRIES) { const x = st(c); counts.all++; if (!x || x === 'planned') counts.none++; else if (x === 'home') counts.lived++; else counts[x === 'planned' ? 'wish' : x]++; }
  const row = c => {
    const e = r.cs.get(c.c);
    const x = st(c);
    const meta = [];
    if (e && e.firstStr && x !== 'wish' && x !== 'home') meta.push(fmtDate(e.firstStr, { short: true, noHijri: true }));
    if (e && e.visits) meta.push(count(e.visits, 'trip'));
    if (e && e.dayCount) meta.push(count(e.dayCount, 'day'));
    return (
      <button class="row" key={c.c} onClick={() => go('country/' + c.c)}>
        <Flag cc={c.c} />
        <span class="grow"><span class="title">{cname(c)}</span>{meta.length > 0 && <span class="meta">{meta.join(isAr.value ? '، ' : ', ')}</span>}</span>
        {x && <span class={'pill st-' + x}>{t('st_' + x)}</span>}
      </button>
    );
  };
  let body;
  if (q.trim() || sort === 'name') body = <div class="list">{(q.trim() ? list : [...list].sort(nameSort)).map(row)}</div>;
  else if (sort === 'first') {
    const withDate = list.filter(c => r.cs.get(c.c) && r.cs.get(c.c).first != null).sort((a, b) => r.cs.get(a.c).first - r.cs.get(b.c).first);
    const rest = list.filter(c => !(r.cs.get(c.c) && r.cs.get(c.c).first != null)).sort(nameSort);
    body = <>{withDate.length > 0 && <div class="list">{withDate.map(row)}</div>}{rest.length > 0 && <div class="list" style="margin-top:12px">{rest.map(row)}</div>}</>;
  } else {
    body = CONTINENTS.map(k => {
      const items = list.filter(c => c.cont === k).sort(nameSort);
      if (!items.length) return null;
      const cont = r.continents.find(x => x.k === k);
      return (
        <div key={k}>
          <div class="group-h">{contName(k)}<span class="aside">{num(cont.visited)} / {num(cont.total)}</span></div>
          <div class="list">{items.map(row)}</div>
        </div>
      );
    });
  }
  return (
    <>
      <div class="search" style="margin-top:12px"><Icon name="search" /><input value={q} onInput={e => setQ(e.currentTarget.value)} placeholder={t('search_countries')} aria-label={t('search_countries')} />{q && <button class="iconbtn" onClick={() => setQ('')} aria-label={t('clear')}><Icon name="x" /></button>}</div>
      <div class="chips" style="margin-top:10px">
        {FILTERS.map(k => <button class="chip" key={k} aria-pressed={f === k ? 'true' : 'false'} onClick={() => setF(k)}>{k !== 'all' && k !== 'none' && <i class={'dot st-' + (k === 'lived' ? 'lived' : k)} />}{t('f_' + k)} <span class="faint num">{num(counts[k])}</span></button>)}
      </div>
      {!q.trim() && (
        <div class="chips">
          {[['cont', t('sort_cont')], ['name', t('sort_name')], ['first', t('sort_first')]].map(([k, l]) => <button class="chip" key={k} aria-pressed={sort === k ? 'true' : 'false'} onClick={() => setSort(k)}>{k === 'cont' ? <Icon name="globe" class="x" /> : k === 'name' ? <Icon name="sort" class="x" /> : <Icon name="calendar" class="x" />}{l}</button>)}
        </div>
      )}
      <div style="margin-top:4px">{body}</div>
      {!list.length && <p class="hint" style="margin-top:16px">{t('no_results')}</p>}
    </>
  );
}

function CityList() {
  const s = state.value, r = R.value;
  const [q, setQ] = useState('');
  const [f, setF] = useState('all');
  if (!r) return null;
  const nq = searchKey(q);
  const list = s.cities.filter(c => (f === 'all' ? true : f === 'wish' ? c.s === 'wish' : f === 'visited' ? c.s !== 'wish' : true))
    .filter(c => !nq || searchKey(c.name).includes(nq) || searchKey(c.nameEn).includes(nq) || searchKey(cname(C.get(c.cc))).includes(nq));
  if (!s.cities.length) return (
    <Empty icon="building" title={t('cities_empty_title')} text={t('cities_empty_text')}>
      <button class="btn" onClick={() => openAddCity({})}><Icon name="plus" />{t('add_city')}</button>
    </Empty>
  );
  // grouped by country, most cities first
  const byCC = new Map();
  for (const c of list) { if (!byCC.has(c.cc)) byCC.set(c.cc, []); byCC.get(c.cc).push(c); }
  const groups = [...byCC.entries()].sort((a, b) => b[1].length - a[1].length || byName(cname(C.get(a[0])), cname(C.get(b[0]))));
  return (
    <>
      <div class="search" style="margin-top:12px"><Icon name="search" /><input value={q} onInput={e => setQ(e.currentTarget.value)} placeholder={t('search_cities_mine')} aria-label={t('search_cities_mine')} /></div>
      <div class="chips" style="margin-top:10px">
        {[['all', t('f_all')], ['visited', t('f_visited_cities')], ['wish', t('f_wish')]].map(([k, l]) => <button class="chip" key={k} aria-pressed={f === k ? 'true' : 'false'} onClick={() => setF(k)}>{l}</button>)}
      </div>
      {groups.map(([cc, cs]) => (
        <div key={cc}>
          <div class="group-h"><Flag cc={cc} size="sm" />{cname(C.get(cc))}<span class="aside">{count(cs.length, 'city')}</span></div>
          <div class="list">
            {cs.sort((a, b) => byName(cityName(a), cityName(b))).map(c => (
              <button class="row" key={c.id} onClick={() => go('city/' + c.id)}>
                <i class={'dot st-' + c.s} />
                <span class="grow"><span class="title">{cityName(c)}</span>{(r.cityFirst.get(c.id) || c.s !== 'visited') && <span class="meta">{[c.s !== 'visited' ? t('cst_' + c.s) : '', r.cityFirst.get(c.id) && c.s !== 'wish' ? fmtDate(r.cityFirst.get(c.id), { short: true, noHijri: true }) : ''].filter(Boolean).join(isAr.value ? '، ' : ', ')}</span>}</span>
                <Stars value={c.rate} readOnly />
                <Icon name="chev" class="chev flip" />
              </button>
            ))}
          </div>
        </div>
      ))}
      {!groups.length && <p class="hint" style="margin-top:16px">{t('no_results')}</p>}
    </>
  );
}
