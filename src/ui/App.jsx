// The app shell: screens by route, the tab bar, sheets, toasts, the Android back button.
import { useEffect } from 'preact/hooks';
import { effect } from '@preact/signals';
import { state, markSeen, saveError } from '../core/store.js';
import { R, ready } from './app-state.js';
import { route, go, back, canGoBack, isTab, closeTopOverlay } from './router.js';
import { t, num, count } from '../core/i18n.js';
import { Icon } from './icons.jsx';
import { Toasts, DialogHost, toast } from './kit.jsx';
import { onBackButton, exitApp, takeOpenedFile, onFileOpened, isNative } from '../core/native.js';
import { MapScreen, mapRef } from './screens/MapScreen.jsx';
import { CountrySheet, CountryPage, pendingMapZoom } from './screens/Country.jsx';
import { AddCitySheet, CitySheet, CityPage, pendingCityZoom } from './screens/City.jsx';
import { PlacesScreen } from './screens/Places.jsx';
import { TripsScreen, TripPage, TripEditor } from './screens/Trips.jsx';
import { StatsScreen, BadgesScreen, badgeTitle } from './screens/Stats.jsx';
import { MeScreen, StampsScreen, WishScreen } from './screens/Me.jsx';
import { SettingsScreen, AboutScreen } from './screens/Settings.jsx';
import { Onboarding } from './screens/Onboarding.jsx';
import { SchengenScreen, ResidencyScreen, WrappedScreen, ShareScreen } from './screens/Tools.jsx';
import { BackupScreen, ReportScreen, RestoreSheet, restoreFromFile } from './screens/Backup.jsx';

const TAB_ITEMS = [['map', 'map', 'tab_map'], ['places', 'list', 'tab_places'], ['trips', 'suitcase', 'tab_trips'], ['stats', 'chart', 'tab_stats'], ['me', 'passport', 'tab_me']];
// detail screens belong to a tab (for the highlighted tab)
const PARENT = { country: 'places', city: 'places', trip: 'trips', 'trip-new': 'trips', 'trip-edit': 'trips', badges: 'stats', schengen: 'stats', residency: 'stats', wrapped: 'me', share: 'me', stamps: 'me', wish: 'me', backup: 'me', report: 'me', settings: 'me', about: 'me' };

function Tabs({ current }) {
  return (
    <nav class="tabs" aria-label={t('nav_aria')}>
      <div class="in">
        {TAB_ITEMS.map(([name, icon, label]) => (
          <button key={name} aria-current={current === name ? 'page' : undefined} onClick={() => (current === name && route.value.name === name ? window.scrollTo({ top: 0, behavior: 'smooth' }) : go(name, isTab(route.value.name)))}>
            <Icon name={icon} /><span>{t(label)}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

function Screen({ rt }) {
  const a = rt.args;
  switch (rt.name) {
    case 'map': return null; // the map stays mounted below
    case 'places': return <PlacesScreen />;
    case 'country': return <CountryPage cc={a[0]} key={a[0]} />;
    case 'city': return <CityPage id={a[0]} key={a[0]} />;
    case 'trips': return <TripsScreen />;
    case 'trip': return <TripPage id={a[0]} key={a[0]} />;
    case 'trip-new': return <TripEditor key={'new' + rt.query.toString()} />;
    case 'trip-edit': return <TripEditor id={a[0]} key={'e' + a[0]} />;
    case 'stats': return <StatsScreen />;
    case 'badges': return <BadgesScreen />;
    case 'me': return <MeScreen />;
    case 'stamps': return <StampsScreen />;
    case 'wish': return <WishScreen />;
    case 'settings': return <SettingsScreen />;
    case 'about': return <AboutScreen />;
    case 'schengen': return <SchengenScreen />;
    case 'residency': return <ResidencyScreen />;
    case 'wrapped': return <WrappedScreen year={a[0]} key={a[0] || 'y'} />;
    case 'share': return <ShareScreen />;
    case 'backup': return <BackupScreen />;
    case 'report': return <ReportScreen />;
    default: return null;
  }
}

export function App() {
  useEffect(() => {
    if (!__ALLOW_FRAME__) return;
    setTimeout(() => toast(t('preview_note'), { ms: 8000 }), 900);
    const f = () => toast(t('preview_files'), { ms: 6000 });
    addEventListener('asfari-preview-file', f);
    return () => removeEventListener('asfari-preview-file', f);
  }, []);
  useEffect(() => {
    onBackButton(() => {
      if (closeTopOverlay()) return;
      if (canGoBack()) back();
      else if (route.value.name !== 'map') go('map', true);
      else exitApp();
    });
    if (isNative) {
      takeOpenedFile().then(f => f && restoreFromFile(f));
      onFileOpened(() => takeOpenedFile().then(f => f && restoreFromFile(f)));
    }
    // a new badge: remembered (with its date) and announced
    let pending = false;
    const stop = effect(() => {
      const r = R.value;
      if (!r || !state.value.settings.onboarded || pending) return;
      const seen = state.value.seen;
      const fresh = r.badges.filter(b => b.done && !seen[b.id]).map(b => b.id);
      if (!fresh.length) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        markSeen(fresh);
        const b = r.badges.find(x => x.id === fresh[fresh.length - 1]);
        toast(fresh.length > 1 ? t('badge_new_n', { n: num(fresh.length) }) : t('badge_new', { name: badgeTitle(b) }), { action: t('show'), onAction: () => go('badges?b=' + b.id), ms: 5000 });
      }, 900);
    });
    const stopErr = effect(() => { if (saveError.value) toast(t('e_save'), { ms: 7000 }); });
    return () => { stop(); stopErr(); };
  }, []);
  // "show on map" from a country or city page
  useEffect(() => effect(() => {
    const cc = pendingMapZoom.value, p = pendingCityZoom.value;
    if (route.value.name !== 'map' || !mapRef.current) return;
    if (cc) { pendingMapZoom.value = null; setTimeout(() => mapRef.current && mapRef.current.zoomToCountry(cc), 60); }
    if (p) { pendingCityZoom.value = null; setTimeout(() => mapRef.current && mapRef.current.centerOn(p.lon, p.lat, mapRef.current.mode === 'flat' ? 24 : 5), 60); }
  }), []);

  const s = state.value;
  if (!ready.value) return null;
  if (!s.settings.onboarded) return <><Onboarding /><AddCitySheet /><RestoreSheet /><Toasts /><DialogHost /></>;
  const rt = route.value;
  const tab = isTab(rt.name) ? rt.name : PARENT[rt.name] || 'map';
  const onMap = rt.name === 'map';
  return (
    <>
      <div style={onMap ? '' : 'display:none'} aria-hidden={onMap ? undefined : 'true'}><MapScreen /></div>
      {!onMap && <Screen rt={rt} />}
      <Tabs current={tab} />
      <CountrySheet />
      <CitySheet />
      <AddCitySheet />
      <RestoreSheet />
      <Toasts />
      <DialogHost />
    </>
  );
}
