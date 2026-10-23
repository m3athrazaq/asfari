// Browser test of the web app (run by .github/workflows/web.yml, or locally):
//   python3 -m http.server 8765 --bind 127.0.0.1 &
//   NODE_PATH=<folder with playwright> node tests/web.test.cjs
// Prints one PASS/FAIL line per check, and "PASS no JS errors" when no page had a script error.
// Covers: first start, saving across reloads, every screen, Excel backup + restore on a "new phone",
// the PDF report, broken and crafted backup files, offline use, and refusing to run inside a frame.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium, devices } = require('playwright');
const { sampleState } = require('./sample-state.cjs');

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:8765/').replace(/\/?$/, '/');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'asfari-test-'));
const KEY = 'asfari.state.v1';
let failures = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failures++; };
const jsErrors = [];
let browser;

(async () => {
  const { AR } = await import('../src/core/strings.js');
  browser = await chromium.launch();
  const open = async ({ state, sw = false, lang } = {}) => {
    const ctx = await browser.newContext({
      ...devices['Pixel 7'], locale: 'ar-KW', timezoneId: 'Asia/Kuwait', acceptDownloads: true, serviceWorkers: sw ? 'allow' : 'block'
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => { if (!/framed/.test(e.message)) jsErrors.push(e.message); });
    page.on('console', m => { if (/Content Security Policy|Refused to/i.test(m.text())) jsErrors.push('CSP: ' + m.text()); });
    if (state) {
      const st = JSON.parse(JSON.stringify(state));
      if (lang) st.settings.lang = lang;
      await page.addInitScript(([k, s]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, s); }, [KEY, JSON.stringify(st)]);
    }
    return { ctx, page };
  };
  const stored = page => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
  const settle = page => page.waitForTimeout(700); // the app saves 250 ms after a change
  // the same data, whatever the order of keys and rows
  const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
  const norm = s => JSON.stringify(canon({
    countries: s.countries,
    cities: s.cities.map(c => ({ ...c, at: 0 })).sort((a, b) => a.id.localeCompare(b.id)),
    trips: s.trips.map(t => ({ ...t, at: 0, upd: 0 })).sort((a, b) => a.id.localeCompare(b.id)),
    profile: s.profile
  }));

  /* ---------- 1. first start ---------- */
  {
    const { ctx, page } = await open();
    await page.goto(BASE);
    await page.getByText(AR.ob_next, { exact: true }).waitFor({ timeout: 15000 });
    check(true, 'first start shows the welcome screen');
    await page.getByPlaceholder(AR.ob_name_ph).fill('تجربة');
    await page.getByText(AR.ob_next, { exact: true }).click();
    await page.locator('.flaggrid button').first().click();
    await page.locator('.onb .foot .btn:not(.ghost)').click();
    await page.locator('nav.tabs').waitFor({ timeout: 15000 });
    await settle(page);
    let s = await stored(page);
    const visited = s ? Object.values(s.countries).filter(c => c.s === 'visited').length : 0;
    check(s && s.profile.name === 'تجربة' && s.profile.home === 'KW' && s.settings.onboarded && visited === 1,
      `welcome: name, home country (guessed KW) and one visited country saved (${s && s.profile.home}, ${visited})`);
    await page.reload();
    await page.locator('nav.tabs').waitFor({ timeout: 15000 });
    s = await stored(page);
    check(s && s.profile.name === 'تجربة' && s.settings.onboarded, 'everything is still there after closing and reopening');
    await ctx.close();
  }

  /* ---------- 2. every screen, Arabic and English ---------- */
  for (const lang of ['ar', 'en']) {
    const { ctx, page } = await open({ state: sampleState, lang });
    await page.goto(BASE + '#/map');
    await page.locator('nav.tabs').waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    const before = jsErrors.length;
    const routes = ['map', 'places', 'places?v=cities', 'country/TR', 'city/cist01', 'trips', 'trip/tmy2018', 'trip-edit/teu2023', 'trip-new',
      'stats', 'badges', 'schengen', 'residency', 'me', 'stamps', 'wish', 'wrapped/2023', 'share', 'backup', 'report', 'settings', 'about'];
    const empty = [];
    for (const r of routes) {
      await page.evaluate(h => { location.hash = h; }, '#/' + r);
      await page.waitForTimeout(r === 'share' ? 1500 : 350);
      const text = await page.evaluate(() => (document.querySelector('.screen') || document.querySelector('.mapscreen') || document.body).innerText.trim().length);
      if (text < 20) empty.push(r);
    }
    check(!empty.length && jsErrors.length === before, `${lang}: all ${routes.length} screens open without errors` + (empty.length ? ' (empty: ' + empty.join(', ') + ')' : ''));
    const dir = await page.evaluate(() => document.documentElement.dir);
    check(dir === (lang === 'ar' ? 'rtl' : 'ltr'), `${lang}: page direction ${dir}`);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(wide <= 1, `${lang}: nothing wider than the phone screen (${wide}px)`);
    await ctx.close();
  }

  /* ---------- 2b. everyday use: a new trip, a city, a country, delete and undo ---------- */
  {
    const { ctx, page } = await open({ state: sampleState });
    await page.goto(BASE + '#/trip-new');
    await page.getByText(AR.trip_add_first_stop, { exact: true }).waitFor({ timeout: 15000 });
    const dates = page.locator('input[type=date]');
    await dates.nth(0).fill('2026-03-01');
    await dates.nth(1).fill('2026-03-05');
    await page.getByText(AR.trip_add_first_stop, { exact: true }).click();
    await page.locator('.sheet .search input').fill('Jordan');
    await page.locator('.sheet .row', { hasText: 'الأردن' }).first().click();
    await page.getByText(AR.trip_pick_city, { exact: true }).click();
    await page.locator('.sheet .search input').fill('Amman');
    await page.locator('.sheet .list .row', { hasText: 'Amman' }).first().click({ timeout: 20000 });
    await page.locator('.topbar .btn', { hasText: AR.save }).click();
    await page.waitForFunction(() => /^#\/trip\//.test(location.hash), null, { timeout: 10000 });
    await settle(page);
    let s = await stored(page);
    const trip = s.trips.find(x => x.start === '2026-03-01');
    const city = trip && s.cities.find(c => c.id === trip.stops[0].city);
    check(!!(trip && trip.end === '2026-03-05' && trip.stops[0].cc === 'JO' && city && city.nameEn === 'Amman' && city.s === 'visited'),
      'a new trip with dates, country and city is saved, and the city is logged as visited');
    const jo = await page.evaluate(() => document.body.innerText.includes('الأردن'));
    check(jo, 'the new trip page shows the country');

    await page.evaluate(() => { location.hash = '#/country/NZ'; });
    await page.locator('.stamps-pick button.st-visited').click();
    await settle(page);
    s = await stored(page);
    check(s.countries.NZ && s.countries.NZ.s === 'visited', 'marking a country as visited is saved');

    await page.evaluate(() => { location.hash = '#/places?v=cities'; });
    await page.locator('.fab').click();
    await page.locator('.sheet .search input').fill('Aqaba');
    await page.locator('.sheet .list .row', { hasText: 'Aqaba' }).first().click({ timeout: 20000 });
    await settle(page);
    s = await stored(page);
    check(s.cities.some(c => c.nameEn === 'Aqaba' && c.cc === 'JO' && c.s === 'visited'), 'adding a city from the search is saved');

    await page.evaluate(() => { location.hash = '#/trip/tge2021'; });
    await page.getByText(AR.trip_delete, { exact: true }).click();
    await page.locator('.dialog .btn.danger').click();
    await settle(page);
    s = await stored(page);
    const gone = !s.trips.some(x => x.id === 'tge2021');
    await page.getByText(AR.undo, { exact: true }).click();
    await settle(page);
    s = await stored(page);
    check(gone && s.trips.some(x => x.id === 'tge2021'), 'deleting a trip asks first, and Undo brings it back');
    await ctx.close();
  }

  /* ---------- 3. Excel backup and PDF report ---------- */
  const xlsx = path.join(TMP, 'backup.xlsx');
  let original;
  {
    const { ctx, page } = await open({ state: sampleState });
    await page.goto(BASE + '#/backup');
    await page.getByText(AR.bk_download, { exact: true }).waitFor({ timeout: 15000 });
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByText(AR.bk_download, { exact: true }).click()]);
    await dl.saveAs(xlsx);
    const head = fs.readFileSync(xlsx).subarray(0, 2).toString('latin1');
    check(head === 'PK' && fs.statSync(xlsx).size > 8000, `Excel backup made (${fs.statSync(xlsx).size} bytes)`);
    await settle(page);
    original = await stored(page);
    check(original.lastBackup > 0, 'the backup date is remembered (for the backup reminder)');

    await page.evaluate(() => { location.hash = '#/report'; });
    await page.getByText(AR.rp_make, { exact: true }).click();
    await page.getByText(AR.rp_print, { exact: true }).waitFor({ timeout: 120000 });
    const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByText(AR.bk_download, { exact: true }).click()]);
    const pdf = path.join(TMP, 'report.pdf');
    await dl2.saveAs(pdf);
    const buf = fs.readFileSync(pdf);
    const { PDFDocument } = require('pdf-lib');
    const pages = await PDFDocument.load(buf).then(d => d.getPageCount()).catch(() => 0);
    check(buf.subarray(0, 5).toString('latin1') === '%PDF-' && pages >= 4, `PDF report made (${buf.length} bytes, ${pages} pages)`);
    await ctx.close();
  }

  /* ---------- 4. restore on a "new phone" ---------- */
  {
    const { ctx, page } = await open();
    await page.goto(BASE);
    await page.getByText(AR.ob_restore, { exact: true }).waitFor({ timeout: 15000 });
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByText(AR.ob_restore, { exact: true }).click()]);
    await fc.setFiles(xlsx);
    await page.getByText(AR.bk_found, { exact: true }).waitFor({ timeout: 60000 });
    await page.locator('.sheet').getByText(AR.bk_restore_now, { exact: true }).click();
    await page.locator('nav.tabs').waitFor({ timeout: 15000 });
    await settle(page);
    const s = await stored(page);
    check(s && norm(s) === norm(original), `restore: countries, cities, trips and profile come back exactly (${s && s.trips.length} trips, ${s && s.cities.length} cities)`);
    await ctx.close();
  }

  /* ---------- 5. broken and crafted files ---------- */
  {
    const { ctx, page } = await open({ state: sampleState });
    await page.goto(BASE + '#/backup');
    await page.getByText(AR.bk_import, { exact: true }).first().waitFor({ timeout: 15000 });
    // the app's own first save (new badges marked as seen) happens a moment after opening
    await page.waitForFunction(k => (JSON.parse(localStorage.getItem(k)) || {}).updated > 1, KEY, { timeout: 8000 }).catch(() => {});
    await settle(page);
    const before = await stored(page);
    const junk = path.join(TMP, 'not-a-backup.xlsx');
    fs.writeFileSync(junk, Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(4000, 7)]));
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByText(AR.bk_import, { exact: true }).last().click()]);
    await fc.setFiles(junk);
    await page.getByText(AR.bk_bad_file).waitFor({ timeout: 30000 });
    await settle(page);
    check(norm(await stored(page)) === norm(before), 'a broken file is refused with a clear message, and nothing changes');
    await ctx.close();
  }
  {
    // a backup edited to carry markup and a formula: imported as plain text, never run
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(xlsx);
    const ws = wb.getWorksheet(AR.xs_cities);
    let col = 0;
    ws.getRow(1).eachCell((c, i) => { if (String(c.value).trim() === AR.x_city) col = i; });
    const payload = '<img src=x onerror="window.__pwned=1">';
    ws.getRow(2).getCell(col).value = payload;
    ws.getRow(3).getCell(col).value = { formula: 'HYPERLINK("https://example.com","x")' };
    const crafted = path.join(TMP, 'crafted.xlsx');
    await wb.xlsx.writeFile(crafted);
    const { ctx, page } = await open();
    await page.goto(BASE);
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByText(AR.ob_restore, { exact: true }).click()]);
    await fc.setFiles(crafted);
    await page.getByText(AR.bk_found, { exact: true }).waitFor({ timeout: 60000 });
    await page.locator('.sheet').getByText(AR.bk_restore_now, { exact: true }).click();
    await page.locator('nav.tabs').waitFor({ timeout: 15000 });
    await page.evaluate(() => { location.hash = '#/places?v=cities'; });
    await page.waitForTimeout(1200);
    const pwned = await page.evaluate(() => window.__pwned === 1 || !!document.querySelector('img[src="x"]'));
    const shown = await page.evaluate(p => document.body.innerText.includes(p), payload);
    check(!pwned && shown, 'a backup edited to carry markup shows it as plain text and runs nothing');
    await ctx.close();
  }

  /* ---------- 6. offline (the iPhone web version) ---------- */
  {
    const { ctx, page } = await open({ state: sampleState, sw: true });
    await page.goto(BASE + '#/map');
    await page.locator('nav.tabs').waitFor({ timeout: 15000 });
    const cached = await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      for (let i = 0; i < 120; i++) {
        const keys = await caches.keys();
        if (keys.some(k => k.startsWith('asfari-v'))) {
          const c = await caches.open(keys.find(k => k.startsWith('asfari-v')));
          const n = (await c.keys()).length;
          if (n > 250) return n;
        }
        await new Promise(r => setTimeout(r, 500));
      }
      return 0;
    });
    check(cached > 250, `the web version keeps all its files for offline use (${cached} files)`);
    await ctx.setOffline(true);
    await page.reload();
    await page.locator('nav.tabs').waitFor({ timeout: 15000 });
    await page.evaluate(() => { location.hash = '#/country/TR'; });
    await page.waitForTimeout(800);
    const ok = await page.evaluate(async () => {
      if (!document.querySelector('.screen')) return false;
      const files = ['data/cities.json', 'data/airports.json', 'flags/tr.svg', 'vendor/exceljs.min.js', 'vendor/pdf.js', 'fonts/pdf/IBMPlexSansArabic-Regular.ttf'];
      const rs = await Promise.all(files.map(f => fetch(f).then(r => r.ok).catch(() => false)));
      return rs.every(Boolean);
    });
    check(ok, 'it opens and works with no connection (maps, cities, flags, Excel and PDF engines)');
    await ctx.close();
  }

  /* ---------- 7. not inside another site's frame ---------- */
  {
    const { ctx, page } = await open();
    await page.setContent(`<iframe src="${BASE}index.html" style="width:400px;height:600px"></iframe>`);
    await page.waitForTimeout(2500);
    const frame = page.frames().find(f => f !== page.mainFrame());
    const blank = frame ? await frame.evaluate(() => !document.getElementById('app') && document.body.innerText.trim() === '').catch(() => true) : false;
    check(blank, 'the app refuses to show inside another site (clickjacking)');
    await ctx.close();
  }

  check(jsErrors.length === 0, jsErrors.length ? 'JS errors: ' + jsErrors.slice(0, 3).join(' | ') : 'no JS errors');
})()
  .catch(e => { console.log('ERROR ' + ((e && e.stack) || e)); failures++; })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
    fs.rmSync(TMP, { recursive: true, force: true });
    process.exitCode = failures ? 1 : 0;
  });
