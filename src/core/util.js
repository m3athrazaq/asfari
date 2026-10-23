// Small helpers shared by the whole app: ids, dates (full or partial), text search, distances.

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const has = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
export const finite = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
export const sum = arr => arr.reduce((a, b) => a + b, 0);
export const uniq = arr => [...new Set(arr)];
export const by = (f, dir = 1) => (a, b) => { const x = f(a), y = f(b); return x < y ? -dir : x > y ? dir : 0; };

/* ---------------- dates ----------------
   Dates are stored as text with the precision the user knows: 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD'. */
export const DATE_RE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;
export function parseDate(s) {
  const m = DATE_RE.exec(String(s || ''));
  if (!m) return null;
  const y = +m[1], mo = m[2] ? +m[2] : 0, d = m[3] ? +m[3] : 0;
  if (y < 1900 || y > 2200 || mo > 12 || d > 31 || (m[2] && mo < 1) || (m[3] && d < 1)) return null;
  if (d && d > daysInMonth(y, mo)) return null;
  return { y, m: mo, d, prec: d ? 'day' : mo ? 'month' : 'year' };
}
export const validDate = s => !!parseDate(s);
export function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
const DAY = 864e5;
/** day number (days since 1970-01-01, UTC) of the first day covered by a (partial) date */
export function dayStart(s) {
  const p = parseDate(s); if (!p) return null;
  return Date.UTC(p.y, (p.m || 1) - 1, p.d || 1) / DAY;
}
/** day number of the last day covered by a (partial) date */
export function dayEnd(s) {
  const p = parseDate(s); if (!p) return null;
  if (p.d) return Date.UTC(p.y, p.m - 1, p.d) / DAY;
  if (p.m) return Date.UTC(p.y, p.m - 1, daysInMonth(p.y, p.m)) / DAY;
  return Date.UTC(p.y, 11, 31) / DAY;
}
export const dayToISO = n => new Date(n * DAY).toISOString().slice(0, 10);
export function todayISO() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); }
export const todayDay = () => dayStart(todayISO());
export const yearOf = s => { const p = parseDate(s); return p ? p.y : null; };
export const monthOf = s => { const p = parseDate(s); return p && p.m ? p.m : null; };
/** a JS Date / Excel serial / text → ISO date text (or '') */
export function anyToISO(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return isNaN(v) ? '' : new Date(v.getTime() - v.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  if (typeof v === 'number') {
    if (v >= 1900 && v <= 2200 && Number.isInteger(v)) return String(v);
    if (v > 1 && v < 200000) return dayToISO(Math.round(v - 25569)); // Excel serial
    return '';
  }
  let s = String(v).trim().slice(0, 40).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  if (DATE_RE.test(s)) return validDate(s) ? s : '';
  let m = /^(\d{4})[/.](\d{1,2})(?:[/.](\d{1,2}))?$/.exec(s);
  if (m) { const r = m[1] + '-' + m[2].padStart(2, '0') + (m[3] ? '-' + m[3].padStart(2, '0') : ''); return validDate(r) ? r : ''; }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s); // day/month/year
  if (m) { const r = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; return validDate(r) ? r : ''; }
  m = /^(\d{1,2})[/.-](\d{4})$/.exec(s); // month/year
  if (m) { const r = `${m[2]}-${m[1].padStart(2, '0')}`; return validDate(r) ? r : ''; }
  const d = new Date(s);
  return isNaN(d) ? '' : anyToISO(d);
}
/** inclusive number of days between two (partial) dates */
export function spanDays(a, b) {
  const s = dayStart(a), e = dayEnd(b || a);
  if (s == null || e == null || e < s) return 0;
  return e - s + 1;
}
export const exactDay = s => { const p = parseDate(s); return !!(p && p.d); };

/* ---------------- text search ---------------- */
const AR_MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
export function normAr(s) {
  return String(s || '').replace(AR_MARKS, '')
    .replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/گ/g, 'ك').replace(/پ/g, 'ب').replace(/چ/g, 'ج').replace(/ڤ/g, 'ف').replace(/ی/g, 'ي').replace(/ک/g, 'ك');
}
const LAT_MAP = { 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'ł': 'l', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ı': 'i' };
export function normText(s) {
  return normAr(String(s || '').toLowerCase())
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[ßæœøłđðþı]/g, c => LAT_MAP[c])
    .replace(/['’`ʻʼ‘"]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
/** the same text without spaces and without a leading Arabic "ال" or Latin "al-/el-" on each word */
export function searchKey(s) {
  return normText(s).split(' ').map(w => w.replace(/^ال(?=..)/, '').replace(/^(al|el)(?=[a-z]{3})/, '')).join('');
}
/** how well the query matches a text: 0 none, higher is better */
export function matchScore(qKey, qNorm, text) {
  if (!text) return 0;
  const n = normText(text);
  if (n === qNorm) return 100;
  const k = searchKey(text);
  if (k === qKey) return 95;
  if (n.startsWith(qNorm)) return 80;
  if (k.startsWith(qKey)) return 75;
  if (n.split(' ').some(w => w.startsWith(qNorm))) return 60;
  if (qKey.length >= 3 && k.includes(qKey)) return 40;
  return 0;
}

/* ---------------- geography ---------------- */
const R = 6371.0088;
const rad = d => d * Math.PI / 180;
export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
export const EARTH_KM = 40075;
export const MOON_KM = 384400;

/* ---------------- misc ---------------- */
export function debounce(fn, ms) {
  let t = 0;
  const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  f.flush = (...a) => { clearTimeout(t); fn(...a); };
  return f;
}
export function bufToB64(buf) {
  let s = ''; const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64ToBuf(b64) {
  const s = atob(b64); const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u.buffer;
}
export const safeFileName = s => String(s).replace(/[\\/:*?"<>|\u0000-\u001F]+/g, '-').replace(/\s+/g, '-').replace(/^\.+/, '').slice(0, 60) || 'asfari';
/** stable small hash of a string (for seeded visuals) */
export function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}
export const sleep = ms => new Promise(r => setTimeout(r, ms));
