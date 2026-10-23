// Shared UI state: the computed figures, and the sheets any screen can open.
import { signal, computed, effect } from '@preact/signals';
import { state } from '../core/store.js';
import { derive } from '../core/derive.js';
import { lang, digits, hijri } from '../core/i18n.js';
import { plug } from '../core/native.js';

export const ready = signal(false);
export const R = computed(() => (ready.value ? derive(state.value) : null));

export const countrySheet = signal(null);   // country code
export const citySheet = signal(null);      // city id
export const addCitySheet = signal(null);   // { cc?, lat?, lon?, status? }
export const pickerSheet = signal(null);    // { title, onPick, exclude }

export const openCountry = cc => { countrySheet.value = cc; };
export const openCity = id => { citySheet.value = id; };
export const openAddCity = (opts = {}) => { addCitySheet.value = opts; };

/** settings → language, direction, digits, theme */
effect(() => {
  const s = state.value.settings;
  lang.value = s.lang; digits.value = s.digits; hijri.value = s.hijri;
  const el = document.documentElement;
  el.lang = s.lang; el.dir = s.lang === 'ar' ? 'rtl' : 'ltr';
  if (s.theme === 'auto') delete el.dataset.theme; else el.dataset.theme = s.theme;
  document.title = s.lang === 'ar' ? 'أسفاري' : 'Asfari';
});
export const isDark = signal(false);
const mq = matchMedia('(prefers-color-scheme: dark)');
const syncDark = () => { const th = state.value.settings.theme; isDark.value = th === 'dark' || (th === 'auto' && mq.matches); };
mq.addEventListener ? mq.addEventListener('change', syncDark) : mq.addListener(syncDark);
effect(syncDark);
/** the phone's status bar follows the app's theme, even when it differs from the phone's */
effect(() => {
  const dark = isDark.value;
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.content = dark ? '#0D1322' : '#EDF2F1';
  const bars = plug('SystemBars');
  if (bars && bars.setStyle) bars.setStyle({ style: dark ? 'DARK' : 'LIGHT' }).catch(() => {});
});
