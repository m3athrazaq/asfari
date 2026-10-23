// Excel backup (export / restore) and the PDF report.
import { useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { state, replaceState, mergeState, backupDone, flushSave } from '../../core/store.js';
import { R } from '../app-state.js';
import { t, num, count, fmtRelDays, isAr } from '../../core/i18n.js';
import { todayISO } from '../../core/util.js';
import { deliverFile, pickExcel, isNative, printPdf, MAX_IMPORT_BYTES } from '../../core/native.js';
import { TopBar, Toggle, Seg, Sheet, toast, Spinner } from '../kit.jsx';
import { Icon } from '../icons.jsx';
import { go } from '../router.js';
import { exportExcel, readExcel, storePhotos, ImportError } from '../../export/excel.js';
import { makeReport } from '../../export/pdf.js';

const fmtBytes = b => (b > 1e6 ? num(b / 1e6, 1) + (isAr.value ? ' ميجابايت' : ' MB') : num(Math.max(1, Math.ceil(b / 1e3))) + (isAr.value ? ' كيلوبايت' : ' KB'));

/* ---------- restore: the same flow from the backup screen, the first start, or "Open with" ---------- */
export const restoreOffer = signal(null); // { result, name }
export async function restoreFromFile(file) {
  try {
    if (!file) return;
    if (file.error) throw file.error;
    if (file.buffer.byteLength > MAX_IMPORT_BYTES) throw new ImportError('large');
    toast(t('bk_reading'), { ms: 2000 });
    const result = await readExcel(file.buffer);
    restoreOffer.value = { result, name: file.name };
  } catch (e) {
    console.error(e);
    const kind = e && (e.kind || e.code);
    toast(kind === 'newer' ? t('bk_newer') : kind === 'large' || kind === 'TOO_LARGE' ? t('bk_too_big', { n: num(MAX_IMPORT_BYTES / 1048576) }) : kind === 'TIMEOUT' ? t('bk_timeout') : t('bk_bad_file'), { ms: 6000 });
  }
}
export async function pickAndRestore() {
  try { const f = await pickExcel(); if (f) await restoreFromFile(f); }
  catch (e) { await restoreFromFile({ error: e }); }
}
export function RestoreButton({ label, ...rest }) {
  return <button {...rest} onClick={pickAndRestore}><Icon name="upload" />{label || t('bk_import')}</button>;
}
export function RestoreSheet() {
  const offer = restoreOffer.value;
  const [busy, setBusy] = useState(false);
  if (!offer) return null;
  const { result } = offer;
  const s = state.value;
  const hasData = s.trips.length + s.cities.length + Object.keys(s.countries).length > 0;
  const close = () => { restoreOffer.value = null; };
  const apply = async mode => {
    setBusy(true);
    try {
      if (mode === 'replace') replaceState({ ...result.state, settings: { ...result.state.settings, onboarded: true } });
      else mergeState(result.state);
      await flushSave();
      await storePhotos(result.photoData, new Set(Object.keys(state.value.photos)));
      close();
      toast(t('bk_restored'));
      go('map', true);
    } catch (e) { console.error(e); toast(t('e_generic')); }
    finally { setBusy(false); }
  };
  const c = result.counts;
  return (
    <Sheet onClose={close} title={t('bk_found')}>
      <div class="kv">
        <div><b class="num">{num(c.countries)}</b><span>{t('bk_c_countries')}</span></div>
        <div><b class="num">{num(c.cities)}</b><span>{t('bk_c_cities')}</span></div>
        <div><b class="num">{num(c.trips)}</b><span>{t('bk_c_trips')}</span></div>
        {c.photos > 0 && <div><b class="num">{num(c.photos)}</b><span>{t('bk_c_photos')}</span></div>}
      </div>
      {result.edited && <p class="hint">{t('bk_from_sheet')}</p>}
      <div style="margin-top:18px;display:grid;gap:10px">
        {hasData && <button class="btn" disabled={busy} onClick={() => apply('merge')}>{busy ? <Spinner /> : <Icon name="layers" />}{t('bk_merge')}</button>}
        <button class={'btn' + (hasData ? ' danger' : '')} disabled={busy} onClick={() => apply('replace')}>{busy ? <Spinner /> : <Icon name="download" />}{hasData ? t('bk_replace') : t('bk_restore_now')}</button>
        <button class="btn ghost" disabled={busy} onClick={close}>{t('cancel')}</button>
      </div>
      {hasData && <p class="hint">{t('bk_merge_hint')}</p>}
    </Sheet>
  );
}

export function BackupScreen() {
  const s = state.value;
  const photos = Object.values(s.photos);
  const photoBytes = photos.reduce((a, p) => a + (p.bytes || 0), 0);
  // a file with photos is about the size of the photos; above the restore limit it could not be read back
  const tooBig = photoBytes * 1.03 + 2e6 > MAX_IMPORT_BYTES;
  const [withPhotos, setWithPhotos] = useState(photos.length > 0 && !tooBig);
  const [busy, setBusy] = useState('');
  const days = s.lastBackup ? Math.floor((Date.now() - s.lastBackup) / 864e5) : null;
  const run = async mode => {
    if (withPhotos && tooBig) { toast(t('bk_photos_too_big', { n: num(MAX_IMPORT_BYTES / 1048576) }), { ms: 7000 }); return; }
    setBusy(mode);
    try {
      const { blob } = await exportExcel(state.value, { photos: withPhotos, onProgress: (i, n) => setBusy(`${mode}:${i}/${n}`) });
      const ok = await deliverFile(blob, `asfari-${todayISO()}.xlsx`, { mode, title: t('bk_file_title') });
      if (ok) { backupDone(); toast(t('bk_done')); }
    } catch (e) { console.error(e); toast(t('bk_failed', { e: (e && e.message) || '' }), { ms: 6000 }); }
    finally { setBusy(''); }
  };
  return (
    <div class="screen">
      <TopBar title={t('me_backup')} back="me" />
      <div class="wrap">
        <section class="section" style="margin-top:8px">
          <h2>{t('bk_export')}</h2>
          <div class="card pad">
            <p style="margin:0">{t('bk_export_text')}</p>
            <p class="hint">{s.lastBackup ? t('bk_last', { when: fmtRelDays(-days) }) : t('bk_never')}</p>
          </div>
          {photos.length > 0 && <div class="list" style="margin-top:12px"><Toggle checked={withPhotos} onChange={setWithPhotos} label={t('bk_with_photos', { n: count(photos.length, 'photo') })} sub={fmtBytes(photoBytes)} /></div>}
          {photos.length > 0 && tooBig && <p class="hint" style="color:var(--carmine)">{t('bk_photos_too_big', { n: num(MAX_IMPORT_BYTES / 1048576) })}</p>}
          <button class="btn wide" style="margin-top:12px" disabled={!!busy} onClick={() => run('share')}>{busy.startsWith('share') ? <Spinner /> : <Icon name="share" />}{isNative ? t('bk_share_native') : t('bk_share')}{busy.includes(':') && busy.startsWith('share') ? ' ' + busy.split(':')[1] : ''}</button>
          {!isNative && <button class="btn ghost wide" style="margin-top:10px" disabled={!!busy} onClick={() => run('download')}>{busy.startsWith('download') ? <Spinner /> : <Icon name="download" />}{t('bk_download')}</button>}
        </section>
        <section class="section">
          <h2>{t('bk_import')}</h2>
          <div class="card pad">
            <p style="margin:0">{t('bk_import_text')}</p>
            <p class="hint">{t('bk_edit_hint')}{isNative ? ' ' + t('bk_open_with') : ''}</p>
          </div>
          <RestoreButton class="btn ghost wide" style="margin-top:12px" />
        </section>
      </div>
    </div>
  );
}

/** runs a file action; a failure shows a message instead of nothing */
export async function safely(f) {
  try { await f(); } catch (e) { console.error(e); toast(t('e_generic') + (e && e.message ? ' ' + e.message : ''), { ms: 6000 }); }
}

export function ReportScreen() {
  const s = state.value, r = R.value;
  const [opts, setOpts] = useState({ trips: true, cities: true, notes: true, wish: true, badges: true, paper: 'A4' });
  const [busy, setBusy] = useState(false);
  const [blob, setBlob] = useState(null);
  const set = p => { setOpts(o => ({ ...o, ...p })); setBlob(null); };
  const name = `asfari-${todayISO()}.pdf`;
  const make = async () => {
    setBusy(true); setBlob(null);
    try { const b = await makeReport(state.value, R.value, opts); setBlob(b); toast(t('rp_ready')); }
    catch (e) { console.error(e); toast(t('rp_failed', { e: (e && e.message) || '' }), { ms: 6000 }); }
    finally { setBusy(false); }
  };
  return (
    <div class="screen">
      <TopBar title={t('me_report')} back="me" />
      <div class="wrap">
        <div class="card pad" style="margin-top:8px"><p style="margin:0">{t('rp_text')}</p></div>
        <section class="section">
          <h2>{t('rp_include')}</h2>
          <div class="list">
            <Toggle checked={opts.trips} onChange={v => set({ trips: v })} label={t('rp_trips')} sub={count(r ? r.started.length : 0, 'trip')} />
            <Toggle checked={opts.notes} onChange={v => set({ notes: v })} label={t('rp_notes')} />
            <Toggle checked={opts.cities} onChange={v => set({ cities: v })} label={t('rp_cities')} sub={count(r ? r.cityCount : 0, 'city')} />
            <Toggle checked={opts.wish} onChange={v => set({ wish: v })} label={t('rp_wish')} />
            <Toggle checked={opts.badges} onChange={v => set({ badges: v })} label={t('rp_badges')} />
          </div>
          <div class="card pad" style="margin-top:12px">
            <span class="lab">{t('rp_paper')}</span>
            <Seg value={opts.paper} onChange={v => set({ paper: v })} options={[['A4', 'A4'], ['Letter', 'Letter']]} />
          </div>
        </section>
        <section class="section">
          {!blob ? (
            <button class="btn wide" disabled={busy} onClick={make}>{busy ? <Spinner /> : <Icon name="pdf" />}{busy ? t('rp_working') : t('rp_make')}</button>
          ) : (
            <div style="display:grid;gap:10px">
              <button class="btn wide" onClick={() => safely(() => printPdf(blob, name))}><Icon name="print" />{t('rp_print')}</button>
              <button class="btn ghost wide" onClick={() => safely(() => deliverFile(blob, name, { title: t('me_report') }))}><Icon name="share" />{t('rp_share')}</button>
              {!isNative && <button class="btn ghost wide" onClick={() => safely(() => deliverFile(blob, name, { mode: 'download' }))}><Icon name="download" />{t('bk_download')}</button>}
              <p class="hint" style="text-align:center">{fmtBytes(blob.size)}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
