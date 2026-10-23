// A sample travel log (made-up traveller) for the browser test and screenshots.
const city = (id, name, nameEn, cc, lat, lon, s = 'visited', first = '') => ({ id, name, nameEn, cc, lat, lon, s, first, note: '', fav: false, rate: 0, ref: cc + ':' + nameEn, at: 1 });
const cities = [
  city('cist01', 'إسطنبول', 'Istanbul', 'TR', 41.0082, 28.9784),
  city('ctrb01', 'طرابزون', 'Trabzon', 'TR', 41.0027, 39.7168),
  city('ctbs01', 'تبليسي', 'Tbilisi', 'GE', 41.7151, 44.8271),
  city('cbat01', 'باطومي', 'Batumi', 'GE', 41.6168, 41.6367),
  city('clon01', 'لندن', 'London', 'GB', 51.5072, -0.1276),
  city('czel01', 'زيلامسي', 'Zell am See', 'AT', 47.3238, 12.7966),
  city('cint01', 'إنترلاكن', 'Interlaken', 'CH', 46.6863, 7.8632),
  city('cmak01', 'مكة المكرمة', 'Mecca', 'SA', 21.3891, 39.8579),
  city('cmed01', 'المدينة المنورة', 'Medina', 'SA', 24.4672, 39.6111),
  city('ccai01', 'القاهرة', 'Cairo', 'EG', 30.0444, 31.2357),
  city('ckul01', 'كوالالمبور', 'Kuala Lumpur', 'MY', 3.139, 101.6869),
  city('cbkk01', 'بانكوك', 'Bangkok', 'TH', 13.7563, 100.5018),
  city('cpkt01', 'بوكيت', 'Phuket', 'TH', 7.8804, 98.3923),
  city('csjj01', 'سراييفو', 'Sarajevo', 'BA', 43.8563, 18.4131),
  city('cdxb01', 'دبي', 'Dubai', 'AE', 25.2048, 55.2708),
  city('cbak01', 'باكو', 'Baku', 'AZ', 40.4093, 49.8671),
  city('cpar01', 'باريس', 'Paris', 'FR', 48.8566, 2.3522),
  city('crom01', 'روما', 'Rome', 'IT', 41.9028, 12.4964),
  city('ctok01', 'طوكيو', 'Tokyo', 'JP', 35.6762, 139.6503, 'wish'),
  city('cmar01', 'مراكش', 'Marrakesh', 'MA', 31.6295, -7.9811)
];
const apt = (code, name, nameEn, cc, lat, lon) => ({ k: 'apt', code, name, nameEn, cc, lat, lon, ref: '' });
const KWI = apt('KWI', 'الكويت', 'Kuwait', 'KW', 29.2266, 47.9689);
const stop = (id, cc, city, from = '', to = '', transit = false) => ({ id, cc, city, from, to, transit, note: '' });
const leg = (id, a, b, date, carrier = '', no = '') => ({ id, mode: 'flight', a, b, date, carrier, no, note: '' });
const trips = [
  { id: 'tmy2018', title: '', start: '2018-07-02', end: '2018-07-14', purpose: 'family', with: ['سارة', 'خالد'], rate: 5, cost: 1450, cur: 'KWD', note: 'أول رحلة طويلة مع العائلة. الجزر في بوكيت كانت أجمل ما في الرحلة.',
    stops: [stop('s1', 'MY', 'ckul01', '2018-07-02', '2018-07-07'), stop('s2', 'TH', 'cbkk01', '2018-07-07', '2018-07-10'), stop('s3', 'TH', 'cpkt01', '2018-07-10', '2018-07-14')],
    legs: [leg('l1', KWI, apt('KUL', 'كوالالمبور', 'Kuala Lumpur', 'MY', 2.7456, 101.7099), '2018-07-02', 'Kuwait Airways', 'KU417'), leg('l2', apt('KUL', 'كوالالمبور', 'Kuala Lumpur', 'MY', 2.7456, 101.7099), apt('BKK', 'بانكوك', 'Bangkok', 'TH', 13.69, 100.7501), '2018-07-07', 'AirAsia', 'AK880'), leg('l3', apt('HKT', 'بوكيت', 'Phuket', 'TH', 8.1132, 98.3169), KWI, '2018-07-14', 'Qatar Airways', 'QR841')],
    photos: [], cover: '', at: 1, upd: 1 },
  { id: 'ttr2019', title: 'صيف تركيا', start: '2019-08-05', end: '2019-08-18', purpose: 'leisure', with: ['سارة'], rate: 4, cost: 900, cur: 'KWD', note: 'طرابزون وأوزنجول، ثم إسطنبول.',
    stops: [stop('s1', 'TR', 'ctrb01', '2019-08-05', '2019-08-12'), stop('s2', 'TR', 'cist01', '2019-08-12', '2019-08-18')], legs: [], photos: [], cover: '', at: 2, upd: 2 },
  { id: 'tge2021', title: '', start: '2021-07-20', end: '2021-08-01', purpose: 'leisure', with: [], rate: 4, cost: 0, cur: '', note: '',
    stops: [stop('s1', 'GE', 'ctbs01'), stop('s2', 'GE', 'cbat01'), stop('s3', 'AZ', 'cbak01')], legs: [], photos: [], cover: '', at: 3, upd: 3 },
  { id: 'tgb2022', title: 'معرض لندن', start: '2022-03-14', end: '2022-03-18', purpose: 'business', with: [], rate: 3, cost: 0, cur: '', note: 'زيارة موردين.',
    stops: [stop('s1', 'GB', 'clon01')], legs: [leg('l1', KWI, apt('LHR', 'لندن', 'London', 'GB', 51.47, -0.4543), '2022-03-14', 'British Airways', 'BA156'), leg('l2', apt('LHR', 'لندن', 'London', 'GB', 51.47, -0.4543), KWI, '2022-03-18', 'British Airways', 'BA157')], photos: [], cover: '', at: 4, upd: 4 },
  { id: 'teu2023', title: 'جبال الألب', start: '2023-07-01', end: '2023-07-21', purpose: 'family', with: ['سارة', 'خالد'], rate: 5, cost: 3200, cur: 'KWD', note: '',
    stops: [stop('s1', 'AT', 'czel01', '2023-07-01', '2023-07-09'), stop('s2', 'CH', 'cint01', '2023-07-09', '2023-07-16'), stop('s3', 'FR', 'cpar01', '2023-07-16', '2023-07-21')], legs: [], photos: [], cover: '', at: 5, upd: 5 },
  { id: 'tba2023', title: '', start: '2023-12-20', end: '2023-12-26', purpose: 'leisure', with: [], rate: 4, cost: 0, cur: '', note: '',
    stops: [stop('s1', 'BA', 'csjj01')], legs: [], photos: [], cover: '', at: 6, upd: 6 },
  { id: 'tsa2024', title: 'عمرة رمضان', start: '2024-03-28', end: '2024-04-04', purpose: 'umrah', with: ['سارة'], rate: 5, cost: 0, cur: '', note: '',
    stops: [stop('s1', 'SA', 'cmak01', '2024-03-28', '2024-04-01'), stop('s2', 'SA', 'cmed01', '2024-04-01', '2024-04-04')], legs: [], photos: [], cover: '', at: 7, upd: 7 },
  { id: 'teg2024', title: '', start: '2024-10-10', end: '2024-10-15', purpose: 'business', with: [], rate: 3, cost: 0, cur: '', note: '',
    stops: [stop('s1', 'EG', 'ccai01')], legs: [], photos: [], cover: '', at: 8, upd: 8 },
  { id: 'tit2025', title: '', start: '2025-06-10', end: '2025-06-17', purpose: 'leisure', with: [], rate: 4, cost: 0, cur: '', note: '',
    stops: [stop('s1', 'IT', 'crom01')], legs: [], photos: [], cover: '', at: 9, upd: 9 },
  { id: 'tae2025', title: '', start: '2025-10-20', end: '2025-10-23', purpose: 'business', with: [], rate: 0, cost: 0, cur: '', note: '',
    stops: [stop('s1', 'AE', 'cdxb01')], legs: [], photos: [], cover: '', at: 10, upd: 10 },
  { id: 'tma2026', title: 'المغرب', start: '2026-12-15', end: '2026-12-24', purpose: 'leisure', with: ['سارة'], rate: 0, cost: 0, cur: '', note: '',
    stops: [stop('s1', 'MA', 'cmar01')], legs: [], photos: [], cover: '', at: 11, upd: 11 }
];
const state = {
  v: 1, rev: 10, created: 1, updated: 1,
  profile: { name: 'مسافر تجريبي', home: 'KW', homeCity: { name: 'مدينة الكويت', nameEn: 'Kuwait City', cc: 'KW', lat: 29.3759, lon: 47.9774, ref: '' } },
  settings: { lang: 'ar', theme: 'auto', digits: 'latn', hijri: false, homeCounts: true, transitCounts: false, denominator: 'un', currency: 'KWD', mapMode: 'flat', onboarded: true },
  countries: { BH: { s: 'visited', first: '2015', note: '', fav: false, rate: 4 }, QA: { s: 'visited', first: '2016-05', note: '', fav: false, rate: 0 }, OM: { s: 'visited', first: '2017', note: '', fav: false, rate: 0 }, JO: { s: 'visited', first: '2012', note: '', fav: false, rate: 0 }, LB: { s: 'visited', first: '2010', note: '', fav: true, rate: 5 }, JP: { s: 'wish', first: '', note: '', fav: false, rate: 0 }, IS: { s: 'wish', first: '', note: '', fav: false, rate: 0 }, NZ: { s: 'wish', first: '', note: '', fav: false, rate: 0 }, },
  cities, trips, photos: {}, seen: {}, lastBackup: 0, lastBackupRev: 0
};
module.exports = { sampleState: state };
