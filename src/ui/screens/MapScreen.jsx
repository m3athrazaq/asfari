// The home screen: the world map with your countries, cities and a running count.
import { useEffect, useRef, useState } from 'preact/hooks';
import { signal, effect } from '@preact/signals';
import { WorldMap } from '../../map/worldmap.js';
import { loadWorld, COUNTRIES, C } from '../../core/data.js';
import { state, setSettings } from '../../core/store.js';
import { R, isDark, openCountry, openCity, openAddCity, countrySheet } from '../app-state.js';
import { mapColors, statusFill, statusDot } from '../mapcolors.js';
import { t, num, pct, unit, cname, cityName, fmtRelDays, lang } from '../../core/i18n.js';
import { Icon } from '../icons.jsx';
import { toast } from '../kit.jsx';
import { go } from '../router.js';
import { todayDay } from '../../core/util.js';

export const mapRef = { current: null };
/** set by the country sheet when a status changes, so the map can "stamp" the country */
export const stampEvent = signal(null);
let lastTap = { x: 0, y: 0 };
const memoryHidden = signal(false);
// markers for countries too small to tap on the map
const SMALL = () => COUNTRIES.filter(c => !c.g || c.area < 2600 || ['BH', 'SG', 'MT', 'LU', 'AD', 'LI', 'MC', 'SM', 'VA', 'QA', 'LB', 'PS', 'CY', 'BN', 'TT', 'KM', 'MV', 'SC', 'MU', 'CV', 'ST', 'GM', 'XK', 'ME', 'SI'].includes(c.c));

export function MapScreen() {
  const canvas = useRef();
  const [err, setErr] = useState(false);
  const [mode, setMode] = useState(state.value.settings.mapMode);
  useEffect(() => {
    let map = null, disposeFx = null, alive = true;
    (async () => {
      try {
        const [hi, lo] = await Promise.all([loadWorld('hi'), loadWorld('lo')]);
        if (!alive || !canvas.current) return;
        map = new WorldMap(canvas.current, {
          features: hi, featuresLo: lo,
          onTap: (hit, at) => {
            lastTap = at;
            if (hit.pin) return openCity(hit.pin);
            if (hit.cc) { map.setStyle({ highlight: hit.cc }); openCountry(hit.cc); }
          },
          onLongPress: ({ lon, lat }) => openAddCity({ lat, lon })
        });
        mapRef.current = map;
        const small = SMALL();
        disposeFx = effect(() => {
          const r = R.value; const s = state.value; isDark.value; lang.value;
          if (!r) return;
          const col = mapColors(map.ctx);
          const fills = new Map();
          for (const e of r.cs.values()) fills.set(e.cc, statusFill(col, e.status, e.home));
          const pins = [];
          for (const c of s.cities) pins.push({ id: c.id, lat: c.lat, lon: c.lon, kind: c.s === 'wish' ? 'wish' : c.s === 'lived' ? 'lived' : 'visited', label: cityName(c) });
          const hc = s.profile.homeCity;
          if (hc) pins.push({ id: '__home', lat: hc.lat, lon: hc.lon, kind: 'home', label: hc.name || hc.nameEn });
          map.setStyle({
            colors: col,
            fill: cc => fills.get(cc) || col.land,
            markers: small.map(c => { const e = r.cs.get(c.c); const on = e && (e.status || e.home); return { cc: c.c, lat: c.lp[0], lon: c.lp[1], color: statusDot(col, e && e.status, e && e.home), r: on ? 4.6 : 2.6, faint: !on }; }),
            pins,
            labels: true,
            labelFor: cc => { const c = C.get(cc); return c ? cname(c) : ''; },
            labelPoint: cc => { const c = C.get(cc); return c ? c.lp : null; }
          });
        });
        map.setMode(state.value.settings.mapMode);
        // start centred on home
        const home = C.get(state.value.profile.home);
        const hp = state.value.profile.homeCity || (home && { lat: home.lp[0], lon: home.lp[1] });
        if (state.value.settings.mapMode === 'flat') map.centerOn(hp ? hp.lon : 30, hp ? Math.max(-30, Math.min(55, hp.lat)) : 25, 1, false);
        else map.spinTo(hp ? hp.lon : 30, hp ? hp.lat : 25, 1);
      } catch (e) { console.error(e); setErr(true); }
    })();
    return () => { alive = false; if (disposeFx) disposeFx(); if (map) map.destroy(); mapRef.current = null; };
  }, []);
  // the stamp when a status changes
  useEffect(() => effect(() => {
    const ev = stampEvent.value;
    if (!ev || !mapRef.current) return;
    stampEvent.value = null;
    mapRef.current.stamp(ev.cc, ev.from, lastTap.x || mapRef.current.w / 2, lastTap.y || mapRef.current.h / 2);
  }), []);
  // the highlight goes away when the sheet closes
  useEffect(() => effect(() => { if (mapRef.current && !countrySheet.value) mapRef.current.setStyle({ highlight: null }); }), []);

  const r = R.value;
  const s = state.value;
  const switchMode = () => {
    const m = mode === 'flat' ? 'globe' : 'flat';
    setMode(m); setSettings({ mapMode: m });
    if (mapRef.current) mapRef.current.setMode(m);
  };
  const locate = () => {
    if (!navigator.geolocation) return toast(t('loc_unavailable'));
    toast(t('loc_finding'), { ms: 2500 });
    navigator.geolocation.getCurrentPosition(p => {
      const { latitude: lat, longitude: lon } = p.coords;
      if (mapRef.current) mapRef.current.centerOn(lon, lat, mode === 'flat' ? 14 : 4);
      openAddCity({ lat, lon, here: true });
    }, e => toast(e && e.code === 1 ? t('loc_denied') : t('loc_unavailable'), { ms: 5000 }), { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
  };
  const memory = r && !memoryHidden.value ? pickMemory(r, s) : null;
  return (
    <div class="mapscreen">
      <canvas ref={canvas} aria-label={t('map_aria')} role="img" />
      {err && <div class="memory" style="top:40%"><div class="card pad">{t('e_load_data')}</div></div>}
      {r && (
        <button class="ledger" onClick={() => go('stats')} aria-label={t('open_stats')}>
          <div><b class="num">{num(r.main.length)}</b><span>{unit(r.main.length, 'country')}{r.extra.length ? ' + ' + num(r.extra.length) : ''}</span></div>
          <div><b class="num">{pct(r.worldShare)}</b><span>{t('of_world')}</span></div>
          <div><b class="num">{num(r.contVisited)}</b><span>{unit(r.contVisited, 'continent')}</span></div>
          <div><b class="num">{num(r.cityCount)}</b><span>{unit(r.cityCount, 'city')}</span></div>
        </button>
      )}
      {memory && (
        <div class="memory">
          <button class="card" onClick={memory.go}>
            <Icon name={memory.icon} />
            <span>{memory.text}</span>
            <span class="x" role="button" aria-label={t('close')} onClick={e => { e.stopPropagation(); memoryHidden.value = true; }}><Icon name="x" size={18} /></span>
          </button>
        </div>
      )}
      <div class="legend" aria-hidden="true">
        <span class="st-visited"><i class="sw" />{t('st_visited')}</span>
        <span class="st-lived"><i class="sw" />{t('st_lived')}</span>
        <span class="st-transit"><i class="sw" />{t('lg_transit')}</span>
        <span class="st-wish"><i class="sw hatch" />{t('lg_wish')}</span>
      </div>
      <div class="mapctl">
        <button onClick={switchMode} aria-label={mode === 'flat' ? t('map_globe') : t('map_flat')} title={mode === 'flat' ? t('map_globe') : t('map_flat')}><Icon name={mode === 'flat' ? 'globe' : 'flat'} /></button>
        <button onClick={locate} aria-label={t('map_locate')} title={t('map_locate')}><Icon name="locate" /></button>
        <button onClick={() => mapRef.current && mapRef.current.zoomBy(2)} aria-label={t('zoom_in')}><Icon name="zin" /></button>
        <button onClick={() => mapRef.current && mapRef.current.zoomBy(0.5)} aria-label={t('zoom_out')}><Icon name="zout" /></button>
      </div>
    </div>
  );
}

/** one line worth showing on the map: a trip now, the next trip, or this day in an earlier year */
function pickMemory(r, s) {
  const place = x => {
    const st = x.t.stops.find(y => y.cc !== s.profile.home) || x.t.stops[0];
    if (!st) return x.t.title || t('trip_untitled');
    const city = st.city && s.cities.find(c => c.id === st.city);
    return city ? cityName(city) : cname(C.get(st.cc));
  };
  if (r.now.length) { const x = r.now[0]; return { icon: 'plane', text: t('mem_now', { place: place(x) }), go: () => go('trip/' + x.id) }; }
  if (r.onThisDay.length) { const x = r.onThisDay[r.onThisDay.length - 1]; return { icon: 'clock', text: t('mem_otd', { ago: fmtRelDays(x.s - todayDay() + 0), place: place(x) }).replace(/\s+/g, ' '), go: () => go('trip/' + x.id) }; }
  if (r.next) { const x = r.next; const d = x.s - todayDay(); if (d <= 120) return { icon: 'calendar', text: t('mem_next', { place: place(x), when: fmtRelDays(d) }), go: () => go('trip/' + x.id) }; }
  return null;
}
