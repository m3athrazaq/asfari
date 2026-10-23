// "My passport": the passport page, the stamps, the wishlist and the menu.
import { useEffect, useRef, useMemo, useState } from 'preact/hooks';
import { C, COUNTRIES, GROUPS, loadWorld } from '../../core/data.js';
import { state, setCountry } from '../../core/store.js';
import { R, isDark } from '../app-state.js';
import { t, num, unit, count, cname, cityName, fmtDate, isAr, dig, fmtRelDays } from '../../core/i18n.js';
import { hash, seeded, dayStart, todayDay } from '../../core/util.js';
import { Flag, TopBar, Empty, CountryPicker, toast } from '../kit.jsx';
import { Icon } from '../icons.jsx';
import { go } from '../router.js';
import { drawGlobe } from '../../map/worldmap.js';
import { mapColors, statusFill } from '../mapcolors.js';
import { badgeTitle } from './Stats.jsx';

/* ---------- MRZ: the machine-readable lines at the bottom of a passport ---------- */
const TR = { 'ا': 'A', 'أ': 'A', 'إ': 'I', 'آ': 'A', 'ب': 'B', 'ت': 'T', 'ث': 'TH', 'ج': 'J', 'ح': 'H', 'خ': 'KH', 'د': 'D', 'ذ': 'TH', 'ر': 'R', 'ز': 'Z', 'س': 'S', 'ش': 'SH', 'ص': 'S', 'ض': 'D', 'ط': 'T', 'ظ': 'Z', 'ع': 'A', 'غ': 'GH', 'ف': 'F', 'ق': 'Q', 'ك': 'K', 'ل': 'L', 'م': 'M', 'ن': 'N', 'ه': 'H', 'ة': 'A', 'و': 'W', 'ي': 'Y', 'ى': 'A', 'ء': '', 'ؤ': 'O', 'ئ': 'E', ' ': '<' };
function latin(name) {
  const s = String(name || '').trim();
  if (!s) return 'ASFARI';
  if (/[A-Za-z]/.test(s)) return s.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z ]/g, '').replace(/\s+/g, '<');
  return s.replace(/[ً-ْـ]/g, '').split('').map(ch => (TR[ch] != null ? TR[ch] : '')).join('').replace(/<+/g, '<') || 'ASFARI';
}
export function mrz(s, r) {
  const home = C.get(s.profile.home);
  const a3 = home ? home.a3 : 'XXX';
  const l1 = ('P<' + a3 + latin(s.profile.name).replace('<', '<<') + '<'.repeat(44)).slice(0, 44);
  const yr = r.firstTrip && r.firstTrip.t.start ? r.firstTrip.t.start.slice(2, 4) : '00';
  const l2 = (String(r.main.length).padStart(3, '0') + 'C' + r.contVisited + 'K' + String(r.cityCount).padStart(4, '0') + '<' + yr + '<' + String(r.started.length).padStart(3, '0') + 'T' + String(r.badges.filter(b => b.done).length).padStart(2, '0') + 'B' + '<'.repeat(44)).slice(0, 44);
  return [l1, l2];
}

function Guilloche() {
  // fine wave lines, like the security print on a passport page
  const lines = [];
  for (let i = 0; i < 14; i++) {
    let d = '';
    for (let x = 0; x <= 400; x += 8) {
      const y = 20 + i * 14 + Math.sin(x / 26 + i * 0.7) * 7 + Math.sin(x / 9 + i) * 1.6;
      d += (x ? 'L' : 'M') + x + ' ' + y.toFixed(1);
    }
    lines.push(<path key={i} d={d} fill="none" stroke="var(--visa)" stroke-opacity="0.13" stroke-width="0.8" />);
  }
  return <svg class="gl" viewBox="0 0 400 220" preserveAspectRatio="none" aria-hidden="true">{lines}</svg>;
}
function GlobePortrait() {
  const cv = useRef();
  const r = R.value;
  useEffect(() => {
    let alive = true;
    loadWorld('lo').then(lo => {
      if (!alive || !cv.current) return;
      const w = cv.current.clientWidth, h = cv.current.clientHeight;
      const dpr = Math.min(3, devicePixelRatio || 1);
      cv.current.width = w * dpr; cv.current.height = h * dpr;
      const col = mapColors();
      const pts = r.counted.map(c => c.lp);
      const center = pts.length ? [pts.reduce((a, p) => a + p[1], 0) / pts.length, Math.max(-35, Math.min(45, pts.reduce((a, p) => a + p[0], 0) / pts.length))] : [47, 29];
      drawGlobe(cv.current, { features: lo, colors: col, width: w, height: h, center, scale: 0.47, fill: cc => { const e = r.cs.get(cc); return e ? statusFill(col, e.status, e.home) : col.land; } });
    });
    return () => { alive = false; };
  }, [r, isDark.value]);
  return <canvas ref={cv} aria-hidden="true" />;
}

export function PassportCard({ onClick }) {
  const s = state.value, r = R.value;
  const home = C.get(s.profile.home);
  const lines = mrz(s, r);
  return (
    <button class="passport" style="width:100%;border:0;padding:0;text-align:start" onClick={onClick} aria-label={t('pp_edit')}>
      <Guilloche />
      <div class="pp-in">
        <div class="pp-top">
          <span class="kind">{t('pp_kind')}</span>
          {home && <Flag cc={home.c} size="sm" />}
          <span class="brand">{t('app_name')}</span>
        </div>
        <div class="pp-body">
          <div class="pp-photo"><GlobePortrait /></div>
          <dl>
            <dt style="grid-column:1/-1">{t('pp_name')}</dt>
            <dd class="name">{s.profile.name || t('pp_set_name')}</dd>
            <div><dt>{t('pp_home')}</dt><dd>{home ? cname(home) : '—'}</dd></div>
            <div><dt>{t('pp_since')}</dt><dd class="num">{r.firstTrip && r.firstTrip.t.start ? dig(r.firstTrip.t.start.slice(0, 4)) : '—'}</dd></div>
            <div><dt>{t('pp_countries')}</dt><dd class="num">{num(r.main.length)}{r.extra.length ? ' + ' + num(r.extra.length) : ''}</dd></div>
            <div><dt>{t('pp_continents')}</dt><dd class="num">{num(r.contVisited)} / {num(7)}</dd></div>
          </dl>
        </div>
        <div class="mrz" aria-hidden="true">{lines[0]}<br />{lines[1]}</div>
      </div>
    </button>
  );
}

export function MeScreen() {
  const s = state.value, r = R.value;
  if (!r) return null;
  const days = s.lastBackup ? Math.floor((Date.now() - s.lastBackup) / 864e5) : null;
  const needBackup = (s.rev - (s.lastBackupRev || 0)) > 5 && (days == null || days >= 30) && (s.trips.length + s.cities.length + Object.keys(s.countries).length) > 3;
  const stamps = r.counted.filter(c => !(r.cs.get(c.c) || {}).home).length;
  const wish = r.wishCountries.length + r.wishCities.length;
  const won = r.badges.filter(b => b.done).length;
  const Row = ({ icon, title, meta, to, dot }) => (
    <button class="row" onClick={() => go(to)}>
      <Icon name={icon} class="ic" />
      <span class="grow"><span class="title">{title}</span>{meta && <span class="meta">{meta}</span>}</span>
      {dot && <i class="dot st-home" aria-hidden="true" />}
      <Icon name="chev" class="chev flip" />
    </button>
  );
  return (
    <div class="screen">
      <TopBar title={t('me_title')} actions={<button class="iconbtn" onClick={() => go('settings')} aria-label={t('me_settings')}><Icon name="gear" /></button>} />
      <div class="wrap">
        <PassportCard onClick={() => go('settings')} />
        {needBackup && (
          <div class="banner"><Icon name="warn" /><span>{days == null ? t('bk_reminder_never') : t('bk_reminder', { n: count(days, 'day') })}</span><button class="btn small" onClick={() => go('backup')}>{t('bk_now')}</button></div>
        )}
        <section class="section">
          <div class="list menu">
            <Row icon="stamp" title={t('me_stamps')} meta={count(stamps, 'country')} to="stamps" />
            <Row icon="heart" title={t('me_wish')} meta={wish ? count(wish, r.wishCountries.length ? 'country' : 'city') : t('me_wish_d')} to="wish" />
            <Row icon="medal" title={t('s_badges')} meta={t('badges_count', { a: num(won), b: num(r.badges.length) })} to="badges" />
            <Row icon="sparkle" title={t('me_wrapped')} meta={t('me_wrapped_d')} to="wrapped" />
            <Row icon="share" title={t('me_share')} meta={t('me_share_d')} to="share" />
          </div>
        </section>
        <section class="section">
          <div class="list menu">
            <Row icon="sheet" title={t('me_backup')} meta={s.lastBackup ? t('bk_last', { when: fmtRelDays(-days) }) : t('bk_never')} to="backup" dot={needBackup} />
            <Row icon="print" title={t('me_report')} meta={t('me_report_d')} to="report" />
          </div>
        </section>
        <section class="section">
          <div class="list menu">
            <Row icon="calendar" title={t('me_schengen')} meta={t('me_schengen_d')} to="schengen" />
            <Row icon="clock" title={t('me_residency')} meta={t('me_residency_d')} to="residency" />
          </div>
        </section>
        <section class="section">
          <div class="list menu">
            <Row icon="gear" title={t('me_settings')} to="settings" />
            <Row icon="info" title={t('me_about')} to="about" />
          </div>
        </section>
      </div>
    </div>
  );
}

/* ---------- stamps ---------- */
const INKS = ['var(--visa)', 'var(--carmine)', 'var(--emerald)', '#2F6FB2', '#8A4FB5', 'var(--saffron)'];
const SHAPES = ['circle', 'rect', 'oval', 'oct'];
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export function Stamp({ cc, date, idx = 0, size = 120 }) {
  const c = C.get(cc);
  if (!c) return null;
  const rnd = seeded(hash(cc + 'stamp'));
  const ink = INKS[Math.floor(rnd() * INKS.length)];
  const shape = SHAPES[Math.floor(rnd() * SHAPES.length)];
  const rot = (rnd() - 0.5) * 22;
  const p = date ? date.split('-') : [];
  const dateText = p.length === 3 ? `${p[2]} ${MON[+p[1] - 1]} ${p[0]}` : p.length === 2 ? `${MON[+p[1] - 1]} ${p[0]}` : p[0] || '';
  const ar = c.ar, en = c.en.toUpperCase();
  const fid = 'ink' + idx;
  const arSize = ar.length > 14 ? 11 : ar.length > 9 ? 13 : 16;
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={`${cname(c)} ${dateText}`}>
      <defs>
        <filter id={fid} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={hash(cc) % 97} result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.1 1.42" result="m" />
          <feComposite in="SourceGraphic" in2="m" operator="in" />
        </filter>
        <path id={'arc' + idx} d="M 22 60 A 38 38 0 0 1 98 60" />
        <path id={'arcb' + idx} d="M 24 64 A 36 36 0 0 0 96 64" />
      </defs>
      <g transform={`translate(60 60) scale(0.88) rotate(${rot.toFixed(1)}) translate(-60 -60)`} filter={`url(#${fid})`} fill="none" stroke={ink} style={{ color: ink }}>
        {shape === 'circle' && <><circle cx="60" cy="60" r="50" stroke-width="3" /><circle cx="60" cy="60" r="44" stroke-width="1.2" /></>}
        {shape === 'rect' && <><rect x="10" y="22" width="100" height="76" rx="10" stroke-width="3" /><rect x="15" y="27" width="90" height="66" rx="7" stroke-width="1.2" /></>}
        {shape === 'oval' && <><ellipse cx="60" cy="60" rx="52" ry="40" stroke-width="3" /><ellipse cx="60" cy="60" rx="46" ry="34" stroke-width="1.2" /></>}
        {shape === 'oct' && <><path d="M38 10h44l28 28v44l-28 28H38L10 82V38z" stroke-width="3" /><path d="M41 17h38l24 24v38l-24 24H41L17 79V41z" stroke-width="1.2" /></>}
        <g fill={ink} stroke="none">
          {shape === 'circle' ? (
            <text font-size={en.length > 14 ? 6.6 : en.length > 10 ? 7.6 : 8.5} font-weight="700" letter-spacing={en.length > 14 ? 0.6 : 1.5} font-family="system-ui, sans-serif"><textPath href={'#arc' + idx} startOffset="50%" text-anchor="middle" {...(en.length > 13 ? { textLength: 100, lengthAdjust: 'spacingAndGlyphs' } : {})}>{en.length > 24 ? en.slice(0, 23) + '.' : en}</textPath></text>
          ) : (
            <text x="60" y={shape === 'rect' ? 40 : 36} text-anchor="middle" font-size={en.length > 14 ? 6.4 : 8} font-weight="700" letter-spacing={en.length > 14 ? 0.5 : 1.2} font-family="system-ui, sans-serif">{en.length > 22 ? en.slice(0, 21) + '.' : en}</text>
          )}
          <text x="60" y="66" text-anchor="middle" font-size={arSize} font-weight="700" font-family="Reem Kufi, Plex Arabic, sans-serif" direction="rtl">{ar}</text>
          <text x="60" y="83" text-anchor="middle" font-size="9" font-weight="600" letter-spacing="0.8" font-family="ui-monospace, Menlo, monospace" direction="ltr">{dateText}</text>
        </g>
        <path d="M54 92.5l6-3.5 6 3.5M60 89v7" stroke-width="1.6" stroke-linecap="round" />
      </g>
    </svg>
  );
}
export function StampsScreen() {
  const r = R.value, s = state.value;
  if (!r) return null;
  const list = r.counted.filter(c => !(r.cs.get(c.c) || {}).home).map(c => ({ c, e: r.cs.get(c.c) }))
    .sort((a, b) => (a.e.first ?? 1e9) - (b.e.first ?? 1e9));
  return (
    <div class="screen">
      <TopBar title={t('me_stamps')} back="me" />
      <div class="wrap">
        {!list.length ? <Empty icon="stamp" title={t('stamps_empty_title')} text={t('me_stamps_empty')}><button class="btn" onClick={() => go('map')}>{t('stamps_go_map')}</button></Empty> : (
          <>
            <p class="lead">{t('stamps_lead', { n: count(list.length, 'country') })}</p>
            <div class="stamp-page" style="margin-top:12px">
              <div class="stampgrid">
                {list.map(({ c, e }, i) => <button key={c.c} onClick={() => go('country/' + c.c)} aria-label={cname(c)}><Stamp cc={c.c} date={e.firstStr} idx={i} size="100%" /></button>)}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- wishlist ---------- */
export function WishScreen() {
  const r = R.value, s = state.value;
  const [pick, setPick] = useState(false);
  if (!r) return null;
  const wishC = [...r.cs.values()].filter(e => e.status === 'wish' || e.status === 'planned').map(e => C.get(e.cc)).filter(Boolean);
  const close = r.badges.filter(b => b.kind === 'group' && !b.done && b.missing.length > 0 && b.missing.length <= 3 && b.got > 0).slice(0, 4);
  return (
    <div class="screen">
      <TopBar title={t('me_wish')} back="me" />
      <div class="wrap">
        <section class="section" style="margin-top:8px">
          <h2>{t('wish_countries')}<button class="aside" onClick={() => setPick(true)}>{t('wish_add')}</button></h2>
          {wishC.length ? (
            <div class="list">
              {wishC.map(c => {
                const e = r.cs.get(c.c);
                return (
                  <button class="row" key={c.c} onClick={() => go(e.status === 'planned' && e.upcoming ? 'trip/' + e.upcoming : 'country/' + c.c)}>
                    <Flag cc={c.c} /><span class="grow"><span class="title">{cname(c)}</span></span>
                    {e.status === 'planned' && <span class="pill st-planned">{t('st_planned')}</span>}
                  </button>
                );
              })}
            </div>
          ) : <p class="hint">{t('wish_empty')}</p>}
        </section>
        {r.wishCities.length > 0 && (
          <section class="section">
            <h2>{t('wish_cities')}</h2>
            <div class="list">{r.wishCities.map(c => <button class="row" key={c.id} onClick={() => go('city/' + c.id)}><Flag cc={c.cc} /><span class="grow"><span class="title">{cityName(c)}</span><span class="meta">{cname(C.get(c.cc))}</span></span></button>)}</div>
          </section>
        )}
        {close.length > 0 && (
          <section class="section">
            <h2>{t('wish_close')}</h2>
            <div class="list">
              {close.map(b => (
                <button class="row" key={b.id} onClick={() => go('badges?b=' + b.id)}>
                  <Icon name="medal" />
                  <span class="grow"><span class="title">{badgeTitle(b)}</span><span class="meta">{t('wish_missing', { list: b.missing.map(cc => cname(C.get(cc))).join(isAr.value ? '، ' : ', ') })}</span></span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
      {pick && <CountryPicker title={t('wish_add')} onClose={() => setPick(false)} onPick={cc => { setCountry(cc, { s: 'wish' }); setPick(false); toast(t('wish_added', { name: cname(C.get(cc)) })); }} exclude={[...r.countedSet]} />}
    </div>
  );
}
