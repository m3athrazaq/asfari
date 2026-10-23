// Numbers: counts, continents, years, months, records — and the badges.
import { useState, useRef, useEffect } from 'preact/hooks';
import { C, CONTINENTS } from '../../core/data.js';
import { state, setSettings } from '../../core/store.js';
import { R } from '../app-state.js';
import { t, num, pct, unit, count, cname, cityName, fmtDate, fmtKm, fmtMonthShort, fmtMonthName, isAr, dig, compact } from '../../core/i18n.js';
import { EARTH_KM } from '../../core/util.js';
import { Flag, TopBar, Bar, Sheet, Empty } from '../kit.jsx';
import { Icon, Glyph } from '../icons.jsx';
import { go } from '../router.js';
import { contName } from './Country.jsx';
import { tripTitle } from './Trips.jsx';

const sep = () => (isAr.value ? '، ' : ', ');

/** an embossed seal with a scalloped edge */
export function Seal({ glyph, on, size = 58, tier = 0, tiers = 1 }) {
  const n = 22, R0 = 27, r1 = 24.5;
  let d = '';
  for (let i = 0; i <= n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2;
    const rr = i % 2 ? r1 : R0;
    d += (i ? 'L' : 'M') + (30 + rr * Math.cos(a)).toFixed(2) + ' ' + (30 + rr * Math.sin(a)).toFixed(2);
  }
  const ink = on ? 'var(--saffron)' : 'var(--ink-3)';
  return (
    <svg class="seal" width={size} height={size} viewBox="0 0 60 60" aria-hidden="true">
      <path d={d + 'Z'} fill={on ? 'var(--saffron-soft)' : 'var(--paper-2)'} stroke={ink} stroke-width="1.4" />
      <circle cx="30" cy="30" r="19.5" fill="none" stroke={ink} stroke-width="1" stroke-dasharray="1.6 2.2" />
      <g transform="translate(18 18)"><Glyph name={glyph} size={24} color={on ? 'var(--ink)' : 'var(--ink-3)'} width={1.7} /></g>
      {tiers > 1 && Array.from({ length: tiers }, (_, i) => <circle key={i} cx={30 + (i - (tiers - 1) / 2) * 6} cy={53} r="2.2" fill={i < tier ? 'var(--saffron)' : 'var(--rule)'} />)}
    </svg>
  );
}
export const badgeTitle = b => t(b.key);
export const badgeDesc = b => t(b.key + '_d', { n: num(b.need) });

function YearBars({ years, max }) {
  const ref = useRef();
  // the latest years are at the end: start there
  useEffect(() => { const el = ref.current; if (el) el.scrollLeft = el.scrollWidth; }, [years.length]);
  const full = years.length <= 7;
  return (
    <div class="yearbars" ref={ref} role="img" aria-label={t('s_by_year')}>
      {years.map(y => (
        <div class="yb" key={y.y} title={String(y.y)}>
          <div class="bars">
            <i style={{ height: (y.newCountries.length / max) * 100 + '%' }}>{y.newCountries.length > 0 && <b class="num">{num(y.newCountries.length)}</b>}</i>
            <i class="alt" style={{ height: (y.trips / max) * 100 + '%' }} />
          </div>
          <span class="num">{dig(full ? y.y : String(y.y).slice(2))}</span>
        </div>
      ))}
    </div>
  );
}

export function StatsScreen() {
  const r = R.value, s = state.value;
  if (!r) return null;
  const home = C.get(s.profile.home);
  const denomLabel = { un: t('den_un'), sov: t('den_sov'), all: t('den_all') }[s.settings.denominator];
  const nextDen = { un: 'sov', sov: 'all', all: 'un' }[s.settings.denominator];
  const maxYear = Math.max(1, ...r.years.map(y => Math.max(y.newCountries.length, y.trips)));
  const maxMonth = Math.max(1, ...r.months);
  const unlocked = r.badges.filter(b => b.done);
  const purposes = [...r.purposes.entries()].sort((a, b) => b[1] - a[1]);
  const people = [...r.people.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const airports = [...r.airports.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const airlines = [...r.airlines.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const ex = r.extremes;
  const placeName = p => (p ? (p.country ? cname(C.get(p.cc)) : (isAr.value ? p.name : p.nameEn || p.name) + sep() + cname(C.get(p.cc))) : '');
  const records = [
    r.longest && [t('s_longest'), tripTitle(s, r.longest.t), count(r.longestDays, 'day'), () => go('trip/' + r.longest.id)],
    r.mostVisited && r.mostVisited.visits > 1 && [t('s_most_visited'), cname(C.get(r.mostVisited.cc)), count(r.mostVisited.visits, 'time'), () => go('country/' + r.mostVisited.cc)],
    r.mostDays && [t('s_most_days'), cname(C.get(r.mostDays.cc)), count(r.mostDays.dayCount, 'day'), () => go('country/' + r.mostDays.cc)],
    ex && ex.far && [t('s_farthest', { home: home ? cname(home) : t('home_word') }), placeName(ex.far), fmtKm(Math.round(ex.farKm))],
    ex && [t('s_north'), placeName(ex.north), dig(Math.abs(ex.north.lat).toFixed(1)) + '°' + (ex.north.lat >= 0 ? t('lat_n') : t('lat_s'))],
    ex && [t('s_south'), placeName(ex.south), dig(Math.abs(ex.south.lat).toFixed(1)) + '°' + (ex.south.lat >= 0 ? t('lat_n') : t('lat_s'))],
    ex && [t('s_east'), placeName(ex.east), dig(Math.abs(ex.east.lon).toFixed(1)) + '°' + (ex.east.lon >= 0 ? t('lon_e') : t('lon_w'))],
    ex && [t('s_west'), placeName(ex.west), dig(Math.abs(ex.west.lon).toFixed(1)) + '°' + (ex.west.lon >= 0 ? t('lon_e') : t('lon_w'))],
    r.firstTrip && [t('s_first_trip'), tripTitle(s, r.firstTrip.t), fmtDate(r.firstTrip.t.start, { short: true, noHijri: true }), () => go('trip/' + r.firstTrip.id)],
    r.avgTrip > 0 && [t('s_avg'), count(Math.round(r.avgTrip), 'day'), '']
  ].filter(Boolean);
  return (
    <div class="screen">
      <TopBar title={t('stats_title')} />
      <div class="wrap">
        <div class="bigstats" style="margin-top:8px">
          <div><b class="num">{num(r.main.length)} <span class="of">/ {num(r.denomTotal)}</span></b><span>{unit(r.main.length, 'country')}{r.extra.length ? ' ' + t('s_plus_terr', { n: count(r.extra.length, 'territory') }) : ''}</span></div>
          <div><b class="num">{pct(r.worldShare)}</b><span>{t('s_world')}</span></div>
          <div><b class="num">{num(r.contVisited)} <span class="of">/ 7</span></b><span>{unit(r.contVisited, 'continent')}</span></div>
          <div><b class="num">{num(r.cityCount)}</b><span>{unit(r.cityCount, 'city')}{r.capitals.length ? ' ' + t('s_incl_caps', { n: count(r.capitals.length, 'capital') }) : ''}</span></div>
          <div><b class="num">{num(r.started.length)}</b><span>{unit(r.started.length, 'trip')}{r.upcoming.length ? ' ' + t('s_plus_upcoming', { n: num(r.upcoming.length) }) : ''}</span></div>
          <div><b class="num">{num(r.daysAbroad)}</b><span>{t('s_days_abroad', { unit: unit(r.daysAbroad, 'day') })}</span></div>
          <div><b class="num">{compact(Math.round(r.km))}</b><span>{t('s_km')}{r.km >= 1000 ? ' — ' + t('s_around', { n: num(r.km / EARTH_KM, r.km / EARTH_KM < 10 ? 1 : 0) }) : ''}</span></div>
          <div><b class="num">{num(r.flights)}</b><span>{unit(r.flights, 'flight')}{r.flightKm ? ' — ' + fmtKm(Math.round(r.flightKm)) : ''}</span></div>
          <div><b class="num">{pct(r.popShare)}</b><span>{t('s_pop')}</span></div>
          <div><b class="num">{pct(r.areaShare)}</b><span>{t('s_area')}</span></div>
        </div>
        <p class="hint"><button class="linkbtn" style="padding:0;font-weight:500" onClick={() => setSettings({ denominator: nextDen })}>{t('s_counting', { what: denomLabel })}</button></p>
        {r.undatedTrips > 0 && <p class="hint">{t('s_undated', { n: count(r.undatedTrips, 'trip') })}</p>}
        {r.approxKm && <p class="hint">{t('s_approx_km')}</p>}

        <section class="section">
          <h2>{t('s_by_cont')}</h2>
          <div class="list">
            {r.continents.map(c => (
              <div class="cont-row" key={c.k}>
                <div class="top"><b>{contName(c.k)}</b><span class="num">{num(c.visited)} / {num(c.total)}</span></div>
                <Bar value={c.visited} max={c.total} />
                {c.list.length > 0 && <div class="flags" style="display:flex;gap:4px;flex-wrap:wrap;margin-top:8px">{c.list.slice(0, 24).map(x => <Flag key={x.c} cc={x.c} size="sm" alt={cname(x)} />)}{c.list.length > 24 && <span class="small faint">+{num(c.list.length - 24)}</span>}</div>}
              </div>
            ))}
          </div>
        </section>

        {r.years.length > 0 && (
          <section class="section">
            <h2>{t('s_by_year')}</h2>
            <div class="card">
              <YearBars years={r.years} max={maxYear} />
              <p class="hint" style="padding:6px 14px 12px;display:flex;gap:14px"><span><i class="dot st-visited" /> {t('s_new_countries')}</span><span><i class="dot st-wish" /> {t('s_trips_year')}</span></p>
            </div>
          </section>
        )}

        {r.months.some(Boolean) && (
          <section class="section">
            <h2>{t('s_months')}</h2>
            <div class="card pad">
              <div class="months" style="direction:ltr" role="img" aria-label={t('s_months')}>
                {r.months.map((m, i) => <i key={i} class={m === maxMonth ? 'top' : ''} style={{ height: Math.max(4, (m / maxMonth) * 90) + 'px' }} title={fmtMonthName(i + 1)} />)}
              </div>
              <div class="mlabels" style="direction:ltr">{r.months.map((m, i) => <span key={i}>{fmtMonthShort(i + 1).slice(0, isAr.value ? 3 : 3)}</span>)}</div>
              <p class="hint">{t('s_top_month', { m: fmtMonthName(r.months.indexOf(maxMonth) + 1) })}</p>
            </div>
          </section>
        )}

        {purposes.length > 0 && (
          <section class="section">
            <h2>{t('s_purposes')}</h2>
            <div class="list">
              {purposes.map(([p, n]) => (
                <div class="cont-row" key={p}><div class="top"><b>{t('p_' + p)}</b><span class="num">{count(n, 'trip')}</span></div><Bar value={n} max={purposes[0][1]} color="var(--emerald)" /></div>
              ))}
            </div>
          </section>
        )}

        {(people.length > 0 || r.solo > 0) && (
          <section class="section">
            <h2>{t('s_people')}</h2>
            <div class="list">
              {people.map(([w, n]) => <div class="row" key={w}><Icon name="person" /><span class="grow"><span class="title">{w}</span></span><span class="end num">{count(n, 'trip')}</span></div>)}
              {r.solo > 0 && <div class="row"><Icon name="suitcase" /><span class="grow"><span class="title">{t('s_solo')}</span></span><span class="end num">{count(r.solo, 'trip')}</span></div>}
            </div>
          </section>
        )}

        {records.length > 0 && (
          <section class="section records">
            <h2>{t('s_records')}</h2>
            <div class="list">
              {records.map(([k, v, x, onClick], i) => {
                const Tag = onClick ? 'button' : 'div';
                return (
                  <Tag class="row" key={i} onClick={onClick}>
                    <span class="grow"><span class="meta">{k}</span><span class="title">{v}</span></span>
                    {x && <span class="end num">{x}</span>}
                  </Tag>
                );
              })}
            </div>
          </section>
        )}

        {(airports.length > 0 || airlines.length > 0) && (
          <section class="section">
            <h2>{t('s_air')}</h2>
            <div class="list">
              {airports.map(([code, n]) => <div class="row" key={code}><b dir="ltr" style="font-family:var(--kufi);min-width:44px">{code}</b><span class="grow" /><span class="end num">{count(n, 'time')}</span></div>)}
              {airlines.map(([a, n]) => <div class="row" key={a}><Icon name="plane" /><span class="grow"><span class="title">{a}</span></span><span class="end num">{count(n, 'flight')}</span></div>)}
            </div>
          </section>
        )}

        <section class="section">
          <h2>{t('s_badges')}<button class="aside" onClick={() => go('badges')}>{t('see_all')} ({num(unlocked.length)}/{num(r.badges.length)})</button></h2>
          <div class="badges">
            {(unlocked.length ? unlocked.slice(-6).reverse() : r.badges.slice(0, 6)).map(b => (
              <button class={'badge' + (b.done ? '' : ' locked')} key={b.id} onClick={() => go('badges?b=' + b.id)}>
                <Seal glyph={b.icon} on={b.done} tier={b.tier || 0} tiers={b.tiers ? b.tiers.length : 1} />
                <b>{badgeTitle(b)}</b>
              </button>
            ))}
          </div>
        </section>

        <section class="section">
          <h2>{t('s_tools')}</h2>
          <div class="list menu">
            <button class="row" onClick={() => go('schengen')}><Icon name="calendar" class="ic" /><span class="grow"><span class="title">{t('me_schengen')}</span><span class="meta">{t('me_schengen_d')}</span></span><Icon name="chev" class="chev flip" /></button>
            <button class="row" onClick={() => go('residency')}><Icon name="clock" class="ic" /><span class="grow"><span class="title">{t('me_residency')}</span><span class="meta">{t('me_residency_d')}</span></span><Icon name="chev" class="chev flip" /></button>
            <button class="row" onClick={() => go('wrapped')}><Icon name="sparkle" class="ic" /><span class="grow"><span class="title">{t('me_wrapped')}</span><span class="meta">{t('me_wrapped_d')}</span></span><Icon name="chev" class="chev flip" /></button>
          </div>
        </section>
      </div>
    </div>
  );
}

export function BadgesScreen() {
  const r = R.value;
  const [open, setOpen] = useState(() => new URLSearchParams(location.hash.split('?')[1] || '').get('b'));
  if (!r) return null;
  const done = r.badges.filter(b => b.done), todo = r.badges.filter(b => !b.done).sort((a, b) => b.val / b.need - a.val / a.need);
  const b = open && r.badges.find(x => x.id === open);
  const Card = ({ b }) => (
    <button class={'badge' + (b.done ? '' : ' locked')} onClick={() => setOpen(b.id)}>
      <Seal glyph={b.icon} on={b.done} tier={b.tier || 0} tiers={b.tiers ? b.tiers.length : 1} />
      <b>{badgeTitle(b)}</b>
      {!b.done && <Bar value={b.val} max={b.need} color="var(--saffron)" />}
    </button>
  );
  return (
    <div class="screen">
      <TopBar title={t('s_badges')} back="stats" />
      <div class="wrap">
        <p class="lead">{t('badges_lead', { a: num(done.length), b: num(r.badges.length) })}</p>
        {done.length > 0 && <section class="section"><h2>{t('badges_won')}</h2><div class="badges">{done.map(x => <Card key={x.id} b={x} />)}</div></section>}
        <section class="section"><h2>{t('badges_next')}</h2><div class="badges">{todo.map(x => <Card key={x.id} b={x} />)}</div></section>
      </div>
      {b && (
        <Sheet onClose={() => setOpen(null)} head={<div class="ctry-head"><Seal glyph={b.icon} on={b.done} size={64} tier={b.tier || 0} tiers={b.tiers ? b.tiers.length : 1} /><div class="names"><b>{badgeTitle(b)}</b><span>{badgeDesc(b)}</span></div></div>}>
          <div class="kv"><div><b class="num">{num(Math.min(b.val, b.kind === 'group' ? b.total : b.val))}</b><span>{t('badge_progress', { b: num(b.kind === 'group' ? b.total : b.need) })}</span></div></div>
          <div style="margin-top:12px"><Bar value={b.val} max={b.kind === 'group' ? b.total : b.need} color="var(--saffron)" /></div>
          {b.kind === 'group' && b.tiers.length > 1 && <p class="hint">{t('badge_tiers', { list: b.tiers.map(x => num(x)).join(isAr.value ? '، ' : ', ') })}</p>}
          {state.value.seen[b.id] && <p class="hint">{t('badge_since', { date: fmtDate(state.value.seen[b.id], { noHijri: true }) })}</p>}
          {b.kind === 'group' && (
            <>
              {b.gotList.length > 0 && <><h3 class="lab" style="margin-top:16px">{t('badge_got')}</h3><div class="chips" style="flex-wrap:wrap">{b.gotList.map(cc => <button class="chip" key={cc} onClick={() => go('country/' + cc)}><Flag cc={cc} size="sm" />{cname(C.get(cc))}</button>)}</div></>}
              {b.missing.length > 0 && <><h3 class="lab" style="margin-top:12px">{t('badge_missing')}</h3><div class="chips" style="flex-wrap:wrap">{b.missing.map(cc => <button class="chip" key={cc} onClick={() => go('country/' + cc)}><Flag cc={cc} size="sm" />{cname(C.get(cc))}</button>)}</div></>}
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}
