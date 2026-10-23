// Tools: Schengen 90/180, days in each country per year, a year's summary, an image to share.
import { useState, useEffect, useMemo } from 'preact/hooks';
import { C, GROUPS } from '../../core/data.js';
import { state } from '../../core/store.js';
import { R, isDark } from '../app-state.js';
import { t, num, unit, count, cname, cityName, fmtDate, fmtMonthName, isAr, dig, fmtKm } from '../../core/i18n.js';
import { dayStart, dayToISO, todayISO, todayDay, exactDay } from '../../core/util.js';
import { schengenStatus, schengenDays, daysByYear, yearsWithDays, SCHENGEN } from '../../core/derive.js';
import { deliverFile } from '../../core/native.js';
import { Flag, TopBar, Bar, Seg, Empty, toast, Spinner } from '../kit.jsx';
import { Icon } from '../icons.jsx';
import { go } from '../router.js';
import { tripTitle, tripDays } from './Trips.jsx';
import { shareCard, yearCard } from '../../export/cards.js';
import { safely } from './Backup.jsx';

const sep = () => (isAr.value ? '، ' : ', ');

export function SchengenScreen() {
  const s = state.value;
  const [ref, setRef] = useState(todayISO());
  const [pin, setPin] = useState('');
  const [pout, setPout] = useState('');
  const refDay = dayStart(ref) ?? todayDay();
  const plan = exactDay(pin) && exactDay(pout) && dayStart(pout) >= dayStart(pin) ? [dayStart(pin), dayStart(pout)] : null;
  const st = useMemo(() => schengenStatus(s, refDay, null), [s, refDay]);
  const pl = useMemo(() => (plan ? schengenStatus(s, plan[0], plan) : null), [s, pin, pout]);
  const visitedS = [...SCHENGEN].filter(cc => R.value && R.value.countedSet.has(cc));
  return (
    <div class="screen">
      <TopBar title={t('sch_title')} back="stats" sub />
      <div class="wrap">
        <p class="lead" style="margin-top:6px">{t('sch_intro')}</p>
        <div class="card pad" style="margin-top:14px">
          <label class="field" style="margin-top:0"><span class="lab">{t('sch_on')}</span><input class="input" type="date" value={ref} onInput={e => setRef(e.currentTarget.value || todayISO())} /></label>
          <div class="gauge" style="margin-top:16px">
            <b class="num" style={{ color: st.used > 90 ? 'var(--carmine)' : st.used > 75 ? 'var(--saffron)' : 'var(--visa)' }}>{num(st.used)}</b>
            <span class="muted">{t('sch_used_of')}</span>
          </div>
          <div style="margin-top:10px"><Bar value={Math.min(90, st.used)} max={90} color={st.used > 90 ? 'var(--carmine)' : st.used > 75 ? 'var(--saffron)' : 'var(--visa)'} /></div>
          <p style="margin:12px 0 0;font-weight:600">{st.used > 90 ? t('sch_over_now', { n: num(st.used - 90) }) : t('sch_left', { n: count(st.left, 'day') })}</p>
          {st.stayUntil != null && st.used <= 90 && <p class="muted" style="margin:4px 0 0">{t('sch_stay', { date: fmtDate(dayToISO(st.stayUntil), { noHijri: true }) })}</p>}
          <h3 class="lab" style="margin-top:16px">{t('sch_window')}</h3>
          <div class="window" role="img" aria-label={t('sch_window')}>{st.window.map((v, i) => <i key={i} class={v ? 'on' : ''} />)}</div>
          <div class="small faint" style="display:flex;justify-content:space-between;direction:ltr;margin-top:4px"><span>{fmtDate(dayToISO(refDay - 179), { short: true, noHijri: true })}</span><span>{fmtDate(dayToISO(refDay), { short: true, noHijri: true })}</span></div>
        </div>
        {st.unsure > 0 && <p class="banner"><Icon name="warn" />{t('sch_unsure')}</p>}
        {st.skipped > 0 && <p class="banner"><Icon name="warn" />{t('sch_skipped', { n: num(st.skipped) })}</p>}

        <section class="section">
          <h2>{t('sch_plan')}</h2>
          <div class="card pad" style="padding-top:2px">
            <div class="two">
              <label class="field"><span class="lab">{t('sch_plan_in')}</span><input class="input" type="date" value={pin} onInput={e => setPin(e.currentTarget.value)} /></label>
              <label class="field"><span class="lab">{t('sch_plan_out')}</span><input class="input" type="date" value={pout} onInput={e => setPout(e.currentTarget.value)} /></label>
            </div>
            {pl && (pl.over != null
              ? <p class="banner bad"><Icon name="warn" />{t('sch_over', { date: fmtDate(dayToISO(pl.over), { noHijri: true }) })}</p>
              : <p class="banner" style="background:var(--emerald-soft)"><Icon name="check" />{t('sch_ok', { n: num(pl.maxUsed) })}</p>)}
            {!pl && <p class="hint">{t('sch_plan_hint')}</p>}
          </div>
        </section>
        <section class="section">
          <h2>{t('sch_countries')}</h2>
          <div class="chips" style="flex-wrap:wrap">{[...GROUPS.schengen].sort((a, b) => cname(C.get(a)).localeCompare(cname(C.get(b)), isAr.value ? 'ar' : 'en')).map(cc => <span class="chip" key={cc} style={visitedS.includes(cc) ? 'box-shadow:inset 0 0 0 2px var(--visa)' : ''}><Flag cc={cc} size="sm" />{cname(C.get(cc))}</span>)}</div>
          <p class="hint">{t('sch_note')}</p>
        </section>
      </div>
    </div>
  );
}

export function ResidencyScreen() {
  const r = R.value, s = state.value;
  const years = r ? yearsWithDays(r) : [];
  const [y, setY] = useState(years[0] || +todayISO().slice(0, 4));
  if (!r) return null;
  const list = daysByYear(r, y);
  const total = [...r.abroad].filter(d => new Date(d * 864e5).getUTCFullYear() === y).length;
  const home = C.get(s.profile.home);
  const max = Math.max(183, ...list.map(x => x.days));
  return (
    <div class="screen">
      <TopBar title={t('res_title')} back="stats" sub />
      <div class="wrap">
        <p class="lead" style="margin-top:6px">{t('res_intro')}</p>
        {years.length > 0 && <div class="chips" style="margin-top:12px">{years.map(v => <button class="chip" key={v} aria-pressed={v === y ? 'true' : 'false'} onClick={() => setY(v)}>{dig(v)}</button>)}</div>}
        {!list.length ? <Empty icon="calendar" title={t('res_none')} text={t('res_none_d')} /> : (
          <>
            <div class="bigstats" style="margin-top:12px;grid-template-columns:1fr"><div><b class="num">{num(total)}</b><span>{t('res_total', { home: home ? cname(home) : t('home_word') })}</span></div></div>
            <div class="list" style="margin-top:12px">
              {list.map(x => (
                <div class="cont-row" key={x.cc}>
                  <div class="top"><Flag cc={x.cc} size="sm" /><b>{cname(C.get(x.cc))}</b><span class="num">{count(x.days, 'day')}</span></div>
                  <Bar value={x.days} max={max} color={x.days >= 183 ? 'var(--carmine)' : 'var(--visa)'} />
                </div>
              ))}
            </div>
            <p class="hint">{t('res_note')}</p>
          </>
        )}
      </div>
    </div>
  );
}

export function WrappedScreen({ year }) {
  const r = R.value, s = state.value;
  const years = r ? r.years.filter(v => v.trips > 0).map(v => v.y).sort((a, b) => b - a) : [];
  const [y, setY] = useState(+year || years[0] || +todayISO().slice(0, 4));
  const [busy, setBusy] = useState(false);
  if (!r) return null;
  const Y = r.years.find(v => v.y === y);
  const trips = r.started.filter(x => x.s != null && new Date(x.s * 864e5).getUTCFullYear() === y);
  const longest = trips.reduce((b, x) => (tripDays(x.t) > (b ? tripDays(b.t) : 0) ? x : b), null);
  const months = Array(12).fill(0); for (const x of trips) { const m = +((x.t.start || '').slice(5, 7)); if (m) months[m - 1]++; }
  const topMonth = months.indexOf(Math.max(...months));
  const cc = new Map(); for (const x of trips) for (const st of x.t.stops) if (st.cc !== s.profile.home) cc.set(st.cc, (cc.get(st.cc) || 0) + 1);
  const top = [...cc.entries()].sort((a, b) => b[1] - a[1])[0];
  const share = async () => {
    setBusy(true);
    try { const blob = await yearCard(r, s, y, { dark: true }); await deliverFile(blob, `asfari-${y}.png`, { title: t('wr_title', { year: dig(y) }) }); }
    catch (e) { console.error(e); toast(t('e_generic')); }
    finally { setBusy(false); }
  };
  return (
    <div class="screen">
      <TopBar title={t('wr_title', { year: dig(y) })} back="me" sub />
      <div class="wrap">
        {years.length > 1 && <div class="chips">{years.map(v => <button class="chip" key={v} aria-pressed={v === y ? 'true' : 'false'} onClick={() => setY(v)}>{dig(v)}</button>)}</div>}
        {!Y || !trips.length ? <Empty icon="sparkle" title={t('wr_empty')} text={t('wr_empty_d')} /> : (
          <>
            <div class="story" style="margin-top:12px">
              <h3>{dig(y)}</h3>
              <p style="margin:0;opacity:.8">{s.profile.name ? t('wr_of', { name: s.profile.name }) : t('wr_sub')}</p>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:22px">
                <div><div class="big num">{num(trips.length)}</div><div>{unit(trips.length, 'trip')}</div></div>
                <div><div class="big num">{num(Y.countries.size)}</div><div>{unit(Y.countries.size, 'country')}</div></div>
                <div><div class="big num">{num(Y.newCountries.length)}</div><div>{t('wr_new')}</div></div>
                <div><div class="big num">{num(Y.days)}</div><div>{t('card_days')}</div></div>
              </div>
            </div>
            <div class="list" style="margin-top:14px">
              {top && <button class="row" onClick={() => go('country/' + top[0])}><Flag cc={top[0]} /><span class="grow"><span class="meta">{t('wr_top')}</span><span class="title">{cname(C.get(top[0]))}</span></span><span class="end">{count(top[1], 'time')}</span></button>}
              {Y.newCountries.length > 0 && <div class="row"><Icon name="stamp" /><span class="grow"><span class="meta">{t('wr_new')}</span><span class="title" style="white-space:normal">{Y.newCountries.map(x => cname(C.get(x))).join(sep())}</span></span></div>}
              {longest && tripDays(longest.t) > 0 && <button class="row" onClick={() => go('trip/' + longest.id)}><Icon name="clock" /><span class="grow"><span class="meta">{t('wr_longest')}</span><span class="title">{tripTitle(s, longest.t)}</span></span><span class="end">{count(tripDays(longest.t), 'day')}</span></button>}
              {months[topMonth] > 0 && <div class="row"><Icon name="calendar" /><span class="grow"><span class="meta">{t('wr_month')}</span><span class="title">{fmtMonthName(topMonth + 1)}</span></span></div>}
              {Y.km > 0 && <div class="row"><Icon name="route" /><span class="grow"><span class="meta">{t('wr_km')}</span><span class="title num">{fmtKm(Math.round(Y.km))}</span></span></div>}
              <button class="row" onClick={() => go('trips')}><Icon name="suitcase" /><span class="grow"><span class="meta">{t('wr_first')}</span><span class="title">{tripTitle(s, trips[0].t)}</span></span><span class="end">{fmtDate(trips[0].t.start, { short: true, noHijri: true })}</span></button>
            </div>
            <button class="btn wide" style="margin-top:16px" onClick={share} disabled={busy}>{busy ? <Spinner /> : <Icon name="share" />}{t('wr_share')}</button>
          </>
        )}
      </div>
    </div>
  );
}

export function ShareScreen() {
  const r = R.value, s = state.value;
  const [format, setFormat] = useState('story');
  const [dark, setDark] = useState(isDark.value);
  const [url, setUrl] = useState('');
  const [blob, setBlob] = useState(null);
  useEffect(() => {
    let alive = true, u = '';
    setUrl('');
    shareCard(r, s, { format, dark }).then(b => { if (!alive) return; setBlob(b); u = URL.createObjectURL(b); setUrl(u); }).catch(e => console.error(e));
    return () => { alive = false; if (u) URL.revokeObjectURL(u); };
  }, [format, dark, r]);
  return (
    <div class="screen">
      <TopBar title={t('me_share')} back="me" sub />
      <div class="wrap">
        <div class="two" style="margin-top:6px">
          <Seg value={format} onChange={setFormat} options={[['story', t('sc_story')], ['square', t('sc_square')]]} />
          <Seg value={dark ? 'dark' : 'light'} onChange={v => setDark(v === 'dark')} options={[['light', t('theme_light')], ['dark', t('theme_dark')]]} />
        </div>
        <div style={`margin:14px auto 0;max-width:${format === 'story' ? 300 : 420}px`}>
          {url ? <img class="preview-img" src={url} alt={t('me_share')} /> : <div class="card" style={`aspect-ratio:${format === 'story' ? '9/16' : '1'};display:grid;place-items:center`}><Spinner /></div>}
        </div>
        <button class="btn wide" style="margin-top:16px" disabled={!blob} onClick={() => safely(() => deliverFile(blob, `asfari-${format}.png`, { title: t('app_name') }))}><Icon name="share" />{t('sc_share')}</button>
      </div>
    </div>
  );
}
