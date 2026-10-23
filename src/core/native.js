// The Android app (Capacitor) vs the web version: saving files, sharing, printing, reading Excel files.
import { bufToB64, safeFileName } from './util.js';

export const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
export const plug = n => (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[n]) || null;
const custom = {};
/** the app's own Android plugins (XlsxImport, PdfPrint, NavigationGuard) */
export function nativePlugin(name) {
  if (!isNative) return null;
  if (!custom[name]) custom[name] = plug(name) || (window.Capacitor.registerPlugin ? window.Capacitor.registerPlugin(name) : null);
  return custom[name];
}
export const isIOS = /iP(hone|ad|od)/.test(navigator.platform) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

/* ---------- the app's data as a file inside the Android app (also in Android's own Google backup) ---------- */
const STATE_FILE = 'asfari-state.json';
export async function readNativeState() {
  const fs = plug('Filesystem'); if (!fs) return null;
  try { const r = await fs.readFile({ path: STATE_FILE, directory: 'DATA', encoding: 'utf8' }); return JSON.parse(r.data); }
  catch (e) { return null; }
}
export async function writeNativeState(json) {
  const fs = plug('Filesystem'); if (!fs) return false;
  // (the same data is also in IndexedDB; on start the copy with the higher revision wins)
  await fs.writeFile({ path: STATE_FILE, data: json, directory: 'DATA', encoding: 'utf8', recursive: true });
  return true;
}

/* ---------- handing a file to the user ---------- */
/** the private preview runs in a frame that blocks downloads and sharing: say so instead (App shows a note) */
function previewBlocked() { window.dispatchEvent(new CustomEvent('asfari-preview-file')); return false; }
// Files go to the Android side in pieces of 3 MB (a multiple of 3, so each piece is whole base64):
// a large backup with photos never has to cross the bridge as one huge string.
const CHUNK = 3 * 1024 * 1024;
async function nativeCacheFile(blob, name) {
  const fs = plug('Filesystem');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const path = 'exports/' + name;
  const w = await fs.writeFile({ path, data: bufToB64(bytes.subarray(0, CHUNK)), directory: 'CACHE', recursive: true });
  for (let i = CHUNK; i < bytes.length; i += CHUNK) {
    await fs.appendFile({ path, data: bufToB64(bytes.subarray(i, i + CHUNK)), directory: 'CACHE' });
  }
  return w.uri;
}
/**
 * share = the system share sheet (Drive, Files, WhatsApp, Mail, Print…); download = save in the browser.
 * Returns false if the user cancelled.
 */
export async function deliverFile(blob, name, { mode = 'share', title = '' } = {}) {
  if (__ALLOW_FRAME__) return previewBlocked();
  name = safeFileName(name.replace(/\.(\w+)$/, '')) + (name.match(/\.\w+$/) || [''])[0];
  if (isNative) {
    const uri = await nativeCacheFile(blob, name);
    try { await plug('Share').share({ title: title || name, dialogTitle: title || name, files: [uri] }); }
    catch (e) { if (/cancel/i.test(String(e && e.message))) return false; throw e; }
    return true;
  }
  const file = new File([blob], name, { type: blob.type });
  if (mode !== 'download' && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: title || name }); return true; }
    catch (e) { if (e && e.name === 'AbortError') return false; /* fall back to download */ }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 8000);
  return true;
}
export const canShareFiles = () => isNative || !!(navigator.canShare && navigator.canShare({ files: [new File([''], 'x.pdf', { type: 'application/pdf' })] }));

/** print a PDF: Android's print dialog (printer or "Save as PDF"); on the web the share sheet / a new tab */
export async function printPdf(blob, name) {
  if (__ALLOW_FRAME__) return previewBlocked();
  if (isNative) {
    const fname = safeFileName(name.replace(/\.pdf$/i, '')) + '.pdf';
    await nativeCacheFile(blob, fname);
    await nativePlugin('PdfPrint').print({ path: 'exports/' + fname, name: fname });
    return true;
  }
  if (isIOS) return deliverFile(blob, name, { title: name });
  const url = URL.createObjectURL(blob);
  // (with 'noopener' the browser returns null even when the tab opened, so the page is cut loose here)
  const w = window.open(url, '_blank');
  if (!w) return deliverFile(blob, name, { mode: 'download' });
  try { w.opener = null; } catch (e) { /* already separate */ }
  setTimeout(() => URL.revokeObjectURL(url), 120000);
  return true;
}

/** old exported files are removed from the app's cache after a day */
export async function cleanOldExports() {
  const fs = plug('Filesystem'); if (!fs) return;
  try {
    const r = await fs.readdir({ path: 'exports', directory: 'CACHE' });
    for (const f of r.files || []) {
      const name = typeof f === 'string' ? f : f.name; const mtime = typeof f === 'string' ? 0 : Number(f.mtime) || 0;
      if (name && Date.now() - mtime > 864e5) await fs.deleteFile({ path: 'exports/' + name, directory: 'CACHE' }).catch(() => {});
    }
  } catch (e) { /* nothing exported yet */ }
}

/* ---------- picking files ---------- */
export const MAX_IMPORT_BYTES = 80 * 1024 * 1024;
/**
 * The Android side copies the chosen file into the app's cache and the page reads it from there
 * through the app's own local server (no huge base64 text over the bridge); the copy is then removed.
 */
async function readImported(r) {
  const cap = window.Capacitor;
  const src = cap && cap.convertFileSrc ? cap.convertFileSrc(r.uri) : r.uri.replace(/^file:\/\//, location.origin + '/_capacitor_file_');
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error('read failed ' + res.status);
    return { name: r.name || 'file.xlsx', buffer: await res.arrayBuffer() };
  } finally {
    const p = nativePlugin('XlsxImport');
    if (p && p.discard) p.discard().catch(() => {});
  }
}
/** choose an Excel file → { name, buffer } or null if cancelled */
export async function pickExcel() {
  const p = nativePlugin('XlsxImport');
  if (p) {
    const r = await p.pick();
    if (!r || r.cancelled) return null;
    return readImported(r);
  }
  const f = await pickFiles('.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', false);
  if (!f || !f.length) return null;
  if (f[0].size > MAX_IMPORT_BYTES) throw Object.assign(new Error('too large'), { code: 'TOO_LARGE' });
  return { name: f[0].name, buffer: await f[0].arrayBuffer() };
}
/** an <input type=file> picker as a promise (resolves [] if nothing chosen) */
export function pickFiles(accept, multiple = true) {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = multiple;
    inp.style.position = 'fixed'; inp.style.opacity = '0'; inp.style.pointerEvents = 'none';
    document.body.appendChild(inp);
    let done = false;
    const finish = v => { if (done) return; done = true; resolve(v); setTimeout(() => inp.remove(), 1000); };
    inp.onchange = () => finish([...(inp.files || [])]);
    inp.addEventListener('cancel', () => finish([]));
    inp.click();
  });
}
/** a file the Android app was opened with ("Open with" / "Share" an Excel file) */
export async function takeOpenedFile() {
  const p = nativePlugin('XlsxImport');
  if (!p) return null;
  try {
    const r = await p.takeOpenedFile();
    if (!r || r.none) return null;
    return await readImported(r);
  } catch (e) { return { error: e }; }
}
export function onFileOpened(cb) {
  const p = nativePlugin('XlsxImport');
  if (p && p.addListener) p.addListener('fileOpened', cb);
}
export function onBackButton(cb) {
  const app = plug('App');
  if (app && app.addListener) app.addListener('backButton', cb);
}
export function exitApp() {
  const app = plug('App'); if (!app) return;
  const f = app.minimizeApp || app.exitApp;
  try { const r = f.call(app); if (r && r.catch) r.catch(() => {}); } catch (e) { /* ignore */ }
}
