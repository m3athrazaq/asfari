// First start: your name and home, then a quick pick of the countries you have visited.
import { useState, useMemo } from 'preact/hooks';
import { COUNTRIES, C, CONTINENTS, searchCountries } from '../../core/data.js';
import { state, setProfile, setSettings, setCountriesStatus } from '../../core/store.js';
import { t, num, cname, isAr, lang } from '../../core/i18n.js';
import { byName } from '../../core/i18n.js';
import { Flag, Field, CountryPicker, Seg } from '../kit.jsx';
import { Icon } from '../icons.jsx';
import { go } from '../router.js';
import { contName } from './Country.jsx';
import { RestoreButton } from './Backup.jsx';

// a home country guess from the time zone, so most people only confirm it
const TZ = { 'Asia/Kuwait': 'KW', 'Asia/Riyadh': 'SA', 'Asia/Dubai': 'AE', 'Asia/Qatar': 'QA', 'Asia/Bahrain': 'BH', 'Asia/Muscat': 'OM', 'Asia/Baghdad': 'IQ', 'Asia/Amman': 'JO', 'Africa/Cairo': 'EG', 'Asia/Beirut': 'LB', 'Asia/Damascus': 'SY', 'Europe/London': 'GB', 'America/New_York': 'US', 'Europe/Istanbul': 'TR', 'Asia/Karachi': 'PK', 'Asia/Kolkata': 'IN', 'Africa/Casablanca': 'MA', 'Africa/Tunis': 'TN', 'Africa/Algiers': 'DZ' };
function guessHome() {
  try { const z = Intl.DateTimeFormat().resolvedOptions().timeZone; if (TZ[z]) return TZ[z]; } catch (e) { /* none */ }
  const m = /-([A-Z]{2})$/.exec(navigator.language || '');
  return m && C.has(m[1]) ? m[1] : '';
}

export function Onboarding() {
  const s = state.value;
  const [step, setStep] = useState(1);
  const [name, setName] = useState(s.profile.name);
  const [home, setHome] = useState(s.profile.home || guessHome());
  const [picking, setPicking] = useState(false);
  const [sel, setSel] = useState(() => new Set(Object.entries(s.countries).filter(([, v]) => v.s === 'visited').map(([k]) => k)));
  const [q, setQ] = useState('');
  const [cont, setCont] = useState('as');
  const finish = () => {
    setCountriesStatus([...sel].filter(cc => cc !== home), 'visited');
    setSettings({ onboarded: true });
    go('map', true);
  };
  if (step === 1) return (
    <div class="onb">
      <div class="wrap" style="display:flex;flex-direction:column;flex:1;width:100%">
        <div class="hero">{t('app_name')}</div>
        <p class="pitch">{t('ob_pitch')}</p>
        <div class="card pad" style="padding-top:2px">
          <Field label={t('ob_name')}><input class="input" value={name} maxLength={80} placeholder={t('ob_name_ph')} onInput={e => setName(e.currentTarget.value)} /></Field>
          <span class="lab" style="margin-top:14px">{t('ob_home')}</span>
          <button class="row card" style="border-radius:12px;box-shadow:inset 0 0 0 1.5px var(--rule)" onClick={() => setPicking(true)}>
            {home ? <Flag cc={home} /> : <Icon name="home" />}
            <span class="grow"><span class="title">{home ? cname(C.get(home)) : t('set_choose')}</span></span>
            <Icon name="chev" class="chev flip" />
          </button>
          <span class="lab" style="margin-top:14px">{t('set_lang')}</span>
          <Seg value={s.settings.lang} onChange={v => setSettings({ lang: v })} options={[['ar', 'العربية'], ['en', 'English']]} />
        </div>
        <div class="foot">
          <button class="btn wide" onClick={() => { setProfile({ name: name.trim(), home }); setStep(2); }}>{t('ob_next')}</button>
          <RestoreButton label={t('ob_restore')} class="btn ghost wide" style="margin-top:10px" />
        </div>
      </div>
      {picking && <CountryPicker title={t('ob_home')} onClose={() => setPicking(false)} onPick={cc => { setHome(cc); setPicking(false); }} />}
    </div>
  );
  const list = q.trim() ? searchCountries(q.trim(), lang.value) : COUNTRIES.filter(c => c.cont === cont).sort((a, b) => byName(isAr.value ? a.ar : a.en, isAr.value ? b.ar : b.en));
  const toggle = cc => setSel(v => { const n = new Set(v); if (n.has(cc)) n.delete(cc); else n.add(cc); return n; });
  return (
    <div class="onb" style="padding-top:calc(var(--safe-t) + 10px)">
      <div class="wrap" style="width:100%">
        <h1 style="font-family:var(--kufi);font-size:30px;margin:6px 0 4px">{t('ob_pick_title')}</h1>
        <p class="lead" style="margin-bottom:12px">{t('ob_pick_text')}</p>
        <div class="search"><Icon name="search" /><input value={q} onInput={e => setQ(e.currentTarget.value)} placeholder={t('search_countries')} aria-label={t('search_countries')} /></div>
        {!q.trim() && <div class="chips" style="margin-top:10px">{CONTINENTS.filter(k => k !== 'an').map(k => <button class="chip" key={k} aria-pressed={cont === k ? 'true' : 'false'} onClick={() => setCont(k)}>{contName(k)}{[...sel].some(cc => C.get(cc).cont === k) && <span class="num faint"> {num([...sel].filter(cc => C.get(cc).cont === k).length)}</span>}</button>)}</div>}
        <div class="flaggrid" style="margin-top:10px">
          {list.filter(c => c.c !== home).map(c => (
            <button key={c.c} aria-pressed={sel.has(c.c) ? 'true' : 'false'} onClick={() => toggle(c.c)}>
              <Flag cc={c.c} /><span>{cname(c)}</span>
            </button>
          ))}
        </div>
      </div>
      <div class="foot" style="padding:14px 16px 0">
        <div class="wrap" style="padding:0;display:flex;gap:10px">
          <button class="btn ghost" onClick={() => { setSettings({ onboarded: true }); go('map', true); }}>{t('ob_skip')}</button>
          <button class="btn" style="flex:1" onClick={finish}>{sel.size ? t('ob_done_n', { n: num(sel.size) }) : t('ob_done')}</button>
        </div>
      </div>
    </div>
  );
}
