// Settings and "about".
import { useState, useEffect, useMemo } from 'preact/hooks';
import { debounce } from '../../core/util.js';
import { C } from '../../core/data.js';
import { state, setProfile, setSettings, resetAll } from '../../core/store.js';
import { R, addCitySheet } from '../app-state.js';
import { t, num, cname, isAr } from '../../core/i18n.js';
import { idbClear } from '../../core/idb.js';
import { isNative } from '../../core/native.js';
import { Flag, TopBar, Seg, Toggle, Field, CountryPicker, confirmDialog, toast } from '../kit.jsx';
import { Icon } from '../icons.jsx';
import { go } from '../router.js';

const fmtBytes = b => (b > 1e6 ? num(b / 1e6, 1) + (isAr.value ? ' م.ب' : ' MB') : num(Math.ceil(b / 1e3)) + (isAr.value ? ' ك.ب' : ' KB'));

export function SettingsScreen() {
  const s = state.value;
  const [name, setName] = useState(s.profile.name);
  // saved while typing (leaving with the back button does not always end the typing first)
  const saveName = useMemo(() => debounce(v => setProfile({ name: v.trim() }), 500), []);
  const [pick, setPick] = useState(false);
  const [usage, setUsage] = useState(null);
  useEffect(() => { if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(u => setUsage(u.usage || 0), () => {}); }, []);
  const home = C.get(s.profile.home);
  const photos = Object.values(s.photos);
  const photoBytes = photos.reduce((a, p) => a + (p.bytes || 0), 0);
  const pickHomeCity = () => {
    addCitySheet.value = { cc: s.profile.home, pick: place => { setProfile({ homeCity: { name: place.name, nameEn: place.nameEn, cc: place.cc, lat: place.lat, lon: place.lon, ref: place.ref } }); toast(t('set_home_city_done')); } };
  };
  const reset = async () => {
    if (!(await confirmDialog({ title: t('set_reset_q'), text: t('set_reset_text'), ok: t('set_reset_ok'), danger: true }))) return;
    if (!(await confirmDialog({ title: t('set_reset_q2'), text: '', ok: t('set_reset_ok2'), danger: true }))) return;
    await resetAll();
    try { await idbClear('photos'); } catch (e) { /* none */ }
    toast(t('set_reset_done'));
    go('map', true);
  };
  return (
    <div class="screen">
      <TopBar title={t('me_settings')} back="me" />
      <div class="wrap">
        <section class="section" style="margin-top:8px">
          <h2>{t('set_profile')}</h2>
          <div class="card pad" style="padding-top:2px">
            <Field label={t('set_name')}><input class="input" value={name} maxLength={80} placeholder={t('ob_name_ph')} onInput={e => { setName(e.currentTarget.value); saveName(e.currentTarget.value); }} onBlur={e => saveName.flush(e.currentTarget.value)} /></Field>
          </div>
          <div class="list" style="margin-top:12px">
            <button class="row" onClick={() => setPick(true)}>
              {home ? <Flag cc={home.c} /> : <Icon name="home" />}
              <span class="grow"><span class="meta">{t('set_home')}</span><span class="title">{home ? cname(home) : t('set_choose')}</span></span>
              <Icon name="chev" class="chev flip" />
            </button>
            <button class="row" onClick={pickHomeCity} disabled={!home}>
              <Icon name="pin" />
              <span class="grow"><span class="meta">{t('set_home_city')}</span><span class="title">{s.profile.homeCity ? (isAr.value ? s.profile.homeCity.name : s.profile.homeCity.nameEn || s.profile.homeCity.name) : t('set_home_city_ph')}</span></span>
              <Icon name="chev" class="chev flip" />
            </button>
          </div>
          <p class="hint">{t('set_home_hint')}</p>
        </section>

        <section class="section">
          <h2>{t('set_display')}</h2>
          <div class="card pad">
            <span class="lab">{t('set_lang')}</span>
            <Seg value={s.settings.lang} onChange={v => setSettings({ lang: v })} options={[['ar', 'العربية'], ['en', 'English']]} />
            <span class="lab" style="margin-top:14px">{t('set_theme')}</span>
            <Seg value={s.settings.theme} onChange={v => setSettings({ theme: v })} options={[['auto', t('theme_auto')], ['light', t('theme_light')], ['dark', t('theme_dark')]]} />
            {s.settings.lang === 'ar' && <>
              <span class="lab" style="margin-top:14px">{t('set_digits')}</span>
              <Seg value={s.settings.digits} onChange={v => setSettings({ digits: v })} options={[['latn', '123'], ['arab', '١٢٣']]} />
            </>}
          </div>
          <div class="list" style="margin-top:12px">
            <Toggle checked={s.settings.hijri} onChange={v => setSettings({ hijri: v })} label={t('set_hijri')} sub={t('set_hijri_d')} />
          </div>
        </section>

        <section class="section">
          <h2>{t('set_counting')}</h2>
          <div class="list">
            <Toggle checked={s.settings.homeCounts} onChange={v => setSettings({ homeCounts: v })} label={t('set_home_counts')} />
            <Toggle checked={s.settings.transitCounts} onChange={v => setSettings({ transitCounts: v })} label={t('set_transit_counts')} sub={t('set_transit_counts_d')} />
          </div>
          <div class="card pad" style="margin-top:12px">
            <span class="lab">{t('set_denominator')}</span>
            <Seg value={s.settings.denominator} onChange={v => setSettings({ denominator: v })} options={[['un', num(193)], ['sov', num(195)], ['all', num(250)]]} />
            <p class="hint">{{ un: t('den_un'), sov: t('den_sov'), all: t('den_all') }[s.settings.denominator]}</p>
            <Field label={t('set_currency')}><input class="input" dir="ltr" value={s.settings.currency} maxLength={3} onInput={e => { const v = e.currentTarget.value.toUpperCase().replace(/[^A-Z]/g, ''); if (v.length === 3) setSettings({ currency: v }); }} /></Field>
          </div>
        </section>

        <section class="section">
          <h2>{t('set_data')}</h2>
          <div class="list">
            <button class="row" onClick={() => go('backup')}><Icon name="sheet" /><span class="grow"><span class="title">{t('me_backup')}</span></span><Icon name="chev" class="chev flip" /></button>
            <div class="row"><Icon name="photo" /><span class="grow"><span class="title">{t('set_photos', { n: num(photos.length) })}</span>{photoBytes > 0 && <span class="meta">{fmtBytes(photoBytes)}</span>}</span></div>
            {usage != null && <div class="row"><Icon name="layers" /><span class="grow"><span class="title">{t('set_storage')}</span><span class="meta">{fmtBytes(usage)}</span></span></div>}
          </div>
          <p class="hint"><Icon name="shield" size={15} /> {isNative ? t('privacy_native') : t('privacy_web')}</p>
          <button class="btn danger wide" style="margin-top:14px" onClick={reset}><Icon name="trash" />{t('set_reset')}</button>
        </section>
        <p class="hint" style="text-align:center;margin-top:24px">{t('app_name')} {__APP_VERSION__}</p>
      </div>
      {pick && <CountryPicker title={t('set_home')} onClose={() => setPick(false)} onPick={cc => { setProfile({ home: cc, homeCity: s.profile.homeCity && s.profile.homeCity.cc === cc ? s.profile.homeCity : null }); setPick(false); }} />}
    </div>
  );
}

export function AboutScreen() {
  return (
    <div class="screen">
      <TopBar title={t('me_about')} back="me" />
      <div class="wrap">
        <div class="card pad" style="margin-top:8px">
          <p style="margin-top:0">{t('about_text')}</p>
          <p class="muted" style="margin-bottom:0">{isNative ? t('privacy_native') : t('privacy_web')}</p>
        </div>
        <section class="section">
          <h2>{t('about_sources')}</h2>
          <div class="list">
            {[
              ['Natural Earth', t('src_ne')],
              ['GeoNames', t('src_geonames')],
              ['OurAirports', t('src_airports')],
              ['world-countries (mledoze)', t('src_wc')],
              ['flag-icons (Lipis)', t('src_flags')],
              ['IBM Plex Sans Arabic · Reem Kufi', t('src_fonts')],
              ['Preact · d3-geo · topojson', t('src_code')],
              ['ExcelJS · pdf-lib · fontkit · bidi-js', t('src_files')]
            ].map(([a, b]) => <div class="row" key={a}><span class="grow"><span class="title" dir="ltr" style="text-align:start">{a}</span><span class="meta" style="white-space:normal">{b}</span></span></div>)}
          </div>
        </section>
        <p class="hint" style="text-align:center;margin-top:24px">{t('app_name')} {__APP_VERSION__}</p>
      </div>
    </div>
  );
}
