// Arabic / English text, numbers and dates.
import { signal, computed } from '@preact/signals';
import { parseDate, dayStart } from './util.js';
import { AR, EN } from './strings.js';

export const lang = signal('ar');
export const digits = signal('latn');   // 'latn' 123 or 'arab' ١٢٣
export const hijri = signal(false);      // also show Hijri dates
export const isAr = computed(() => lang.value === 'ar');
export const dir = computed(() => (lang.value === 'ar' ? 'rtl' : 'ltr'));

export function t(key, vars) {
  const d = lang.value === 'ar' ? AR : EN;
  let s = d[key];
  if (s == null) s = EN[key];
  if (s == null) return key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : vars[k]));
  return s;
}

const locale = () => (lang.value === 'ar' ? (digits.value === 'arab' ? 'ar-KW-u-nu-arab' : 'ar-KW-u-nu-latn') : 'en-GB');
const nfCache = new Map();
function nfmt(opts) {
  const k = locale() + JSON.stringify(opts || {});
  if (!nfCache.has(k)) nfCache.set(k, new Intl.NumberFormat(locale(), opts));
  return nfCache.get(k);
}
export const num = (n, dec = 0) => nfmt({ minimumFractionDigits: dec, maximumFractionDigits: dec }).format(+n || 0);
export const compact = n => (Math.abs(n) >= 1e4 ? nfmt({ notation: 'compact', maximumFractionDigits: 1 }).format(n) : num(n));
export function pct(x, dec) {
  const v = (+x || 0) * 100;
  const d = dec != null ? dec : v > 0 && v < 1 ? 1 : 0;
  return nfmt({ minimumFractionDigits: d, maximumFractionDigits: d }).format(v) + (lang.value === 'ar' ? '٪' : '%');
}
/** digits only (keeps the user's digit preference) — for codes/years inside text */
export const dig = s => (digits.value === 'arab' && lang.value === 'ar' ? String(s).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]) : String(s));

/* plural nouns: the form that goes after a number. Arabic uses zero/one/two/few/many/other;
   [feminine?, zero, one, two, few, many, other] */
const PL = {
  ar: {
    country: [1, 'دولة', 'دولة', 'دولتان', 'دول', 'دولة', 'دولة'],
    territory: [0, 'إقليم', 'إقليم', 'إقليمان', 'أقاليم', 'إقليماً', 'إقليم'],
    city: [1, 'مدينة', 'مدينة', 'مدينتان', 'مدن', 'مدينة', 'مدينة'],
    trip: [1, 'رحلة', 'رحلة', 'رحلتان', 'رحلات', 'رحلة', 'رحلة'],
    day: [0, 'يوم', 'يوم', 'يومان', 'أيام', 'يوماً', 'يوم'],
    night: [1, 'ليلة', 'ليلة', 'ليلتان', 'ليالٍ', 'ليلة', 'ليلة'],
    year: [1, 'سنة', 'سنة', 'سنتان', 'سنوات', 'سنة', 'سنة'],
    month: [0, 'شهر', 'شهر', 'شهران', 'أشهر', 'شهراً', 'شهر'],
    flight: [1, 'رحلة طيران', 'رحلة طيران', 'رحلتا طيران', 'رحلات طيران', 'رحلة طيران', 'رحلة طيران'],
    continent: [1, 'قارة', 'قارة', 'قارتان', 'قارات', 'قارة', 'قارة'],
    capital: [1, 'عاصمة', 'عاصمة', 'عاصمتان', 'عواصم', 'عاصمة', 'عاصمة'],
    photo: [1, 'صورة', 'صورة', 'صورتان', 'صور', 'صورة', 'صورة'],
    badge: [0, 'وسام', 'وسام', 'وسامان', 'أوسمة', 'وساماً', 'وسام'],
    airport: [0, 'مطار', 'مطار', 'مطاران', 'مطارات', 'مطاراً', 'مطار'],
    stop: [1, 'محطة', 'محطة', 'محطتان', 'محطات', 'محطة', 'محطة'],
    person: [0, 'شخص', 'شخص', 'شخصان', 'أشخاص', 'شخصاً', 'شخص'],
    time: [1, 'مرة', 'مرة', 'مرتان', 'مرات', 'مرة', 'مرة']
  },
  en: {
    country: ['country', 'countries'], territory: ['territory', 'territories'], city: ['city', 'cities'], trip: ['trip', 'trips'],
    day: ['day', 'days'], night: ['night', 'nights'], year: ['year', 'years'], month: ['month', 'months'], flight: ['flight', 'flights'],
    continent: ['continent', 'continents'], capital: ['capital', 'capitals'], photo: ['photo', 'photos'], badge: ['badge', 'badges'],
    airport: ['airport', 'airports'], stop: ['stop', 'stops'], person: ['person', 'people'], time: ['time', 'times']
  }
};
const arRules = new Intl.PluralRules('ar');
const AR_IDX = { zero: 1, one: 2, two: 3, few: 4, many: 5, other: 6 };
/** the noun that goes after the number n (for a big number shown separately) */
export function unit(n, key) {
  if (lang.value === 'ar') return PL.ar[key][AR_IDX[arRules.select(Math.abs(Math.round(n)))]];
  return PL.en[key][Math.abs(n) === 1 ? 0 : 1];
}
/** a number with its noun, as one phrase: "38 دولة", "دولتان", "دولة واحدة" */
export function count(n, key) {
  if (lang.value === 'ar') {
    const r = arRules.select(Math.abs(Math.round(n)));
    const e = PL.ar[key];
    if (r === 'two') return e[3];
    if (r === 'one') return e[2] + (e[0] ? ' واحدة' : ' واحد');
  }
  return num(n) + ' ' + unit(n, key);
}

/* ---------------- dates ---------------- */
const dfCache = new Map();
function dfmt(opts, cal) {
  // e.g. ar-KW-u-nu-latn (Gulf month names, 123 digits) or ar-KW-u-nu-latn-ca-islamic-umalqura
  const loc = locale() + (cal ? (lang.value === 'ar' ? '-ca-' : '-u-ca-') + cal : '');
  const k = loc + JSON.stringify(opts);
  if (!dfCache.has(k)) dfCache.set(k, new Intl.DateTimeFormat(loc, { timeZone: 'UTC', ...opts }));
  return dfCache.get(k);
}
const asDate = p => new Date(Date.UTC(p.y, (p.m || 1) - 1, p.d || 1));
/** '2024' / '2024-03' / '2024-03-12' → readable text */
export function fmtDate(s, opts = {}) {
  const p = parseDate(s);
  if (!p) return '';
  const short = opts.short;
  if (p.prec === 'year') return dig(p.y);
  if (p.prec === 'month') return dfmt({ month: short ? 'short' : 'long', year: 'numeric' }).format(asDate(p));
  const main = dfmt({ day: 'numeric', month: short ? 'short' : 'long', year: opts.noYear ? undefined : 'numeric' }).format(asDate(p));
  if (hijri.value && !opts.noHijri) return main + ' (' + fmtHijri(s) + ')';
  return main;
}
export function fmtHijri(s) {
  const p = parseDate(s);
  if (!p || !p.d) return '';
  try { return dfmt({ day: 'numeric', month: 'long', year: 'numeric' }, 'islamic-umalqura').format(asDate(p)).replace(/\s?هـ$/, '') + (lang.value === 'ar' ? ' هـ' : ' AH'); } catch (e) { return ''; }
}
export const fmtMonthName = m => dfmt({ month: 'long' }).format(new Date(Date.UTC(2020, m - 1, 1)));
export const fmtMonthShort = m => dfmt({ month: 'short' }).format(new Date(Date.UTC(2020, m - 1, 1)));
/** a date range, written compactly: "12–18 مارس 2024" */
export function fmtRange(a, b, opts = {}) {
  const pa = parseDate(a), pb = parseDate(b);
  if (!pa) return pb ? fmtDate(b, opts) : '';
  if (!pb || a === b) return fmtDate(a, opts);
  const sep = lang.value === 'ar' ? ' – ' : ' – ';
  if (pa.prec === 'day' && pb.prec === 'day') {
    const h = hijri.value && !opts.noHijri;
    if (pa.y === pb.y && pa.m === pb.m && !h) return dfmt({ day: 'numeric' }).format(asDate(pa)) + '–' + fmtDate(b, { ...opts, noHijri: true });
    if (pa.y === pb.y && !h) return fmtDate(a, { ...opts, noYear: true, noHijri: true }) + sep + fmtDate(b, { ...opts, noHijri: true });
  }
  return fmtDate(a, { ...opts, noHijri: true }) + sep + fmtDate(b, { ...opts, noHijri: true });
}
/** "after 12 days" / "3 years ago" */
export function fmtRelDays(days) {
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  const a = Math.abs(days);
  if (a < 31) return rtf.format(days, 'day');
  if (a < 365) return rtf.format(Math.round(days / 30.44), 'month');
  return rtf.format(Math.round(days / 365.25), 'year');
}
export const fmtKm = km => (lang.value === 'ar' ? num(km) + ' كم' : num(km) + ' km');
export function fmtMoney(v, cur) {
  try { return new Intl.NumberFormat(locale(), { style: 'currency', currency: cur || 'KWD', maximumFractionDigits: cur === 'KWD' || cur === 'BHD' || cur === 'OMR' ? 3 : 2 }).format(+v || 0); }
  catch (e) { return num(v, 2) + ' ' + (cur || ''); }
}
export const dayNumToISO = n => new Date(n * 864e5).toISOString().slice(0, 10);
export { dayStart };

/* ---------------- names ---------------- */
const arKey = s => String(s || '').replace(/^ال/, '').replace(/^[أإآ]/, 'ا');
/** compares names the way an Arabic index does (ignoring a leading "ال") */
export const byName = (a, b) => (lang.value === 'ar' ? arKey(a).localeCompare(arKey(b), 'ar') : String(a).localeCompare(String(b), 'en'));
export const cname = c => (c ? (lang.value === 'ar' ? c.ar : c.en) : '');
export const cityName = c => (c ? (lang.value === 'ar' ? c.name || c.nameEn : c.nameEn || c.name) : '');
