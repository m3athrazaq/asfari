// Trip photos: made smaller on the phone (longest side 1600 px, JPEG), kept in IndexedDB.
import { idbGet, idbPut, idbDel, idbKeys } from './idb.js';
import { uid } from './util.js';
import { state, update } from './store.js';

const MAX = 1600, Q = 0.8;
const urls = new Map();

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
    img.decoding = 'async';
    img.src = url;
  });
}
/** a picked image file → a smaller JPEG Blob (the browser applies the camera's rotation) */
export async function shrink(file, max = MAX, q = Q) {
  const { img, url } = await loadImage(file);
  try {
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    if (!w0 || !h0) throw new Error('image');
    const s = Math.min(1, max / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * s)), h = Math.max(1, Math.round(h0 * s));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', q));
    if (!blob) throw new Error('image');
    return { blob, w, h };
  } finally { URL.revokeObjectURL(url); }
}
/** saves picked files; returns [{id, meta}] */
export async function addPhotos(files, { trip = '', city = '', date = '' } = {}, onProgress) {
  const out = [];
  let i = 0;
  for (const f of files) {
    i++;
    if (!f.type || !f.type.startsWith('image/')) continue;
    try {
      const { blob, w, h } = await shrink(f);
      const id = uid();
      await idbPut('photos', id, blob);
      out.push({ id, meta: { trip, city, cap: '', date, w, h, bytes: blob.size } });
    } catch (e) { /* unreadable image: skipped */ }
    onProgress && onProgress(i, files.length);
  }
  return out;
}
export async function photoURL(id) {
  if (urls.has(id)) return urls.get(id);
  const b = await idbGet('photos', id);
  if (!b) return '';
  const u = URL.createObjectURL(b);
  urls.set(id, u);
  return u;
}
export const photoBlob = id => idbGet('photos', id);
export async function deletePhoto(id) {
  if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
  await idbDel('photos', id);
}
export async function putPhotoBlob(id, blob) {
  if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
  await idbPut('photos', id, blob);
}
export const allPhotoIds = () => idbKeys('photos').catch(() => []);
/** photos in the database that no trip or city uses any more */
export async function cleanOrphans(state) {
  const keep = new Set(Object.keys(state.photos));
  for (const id of await allPhotoIds()) if (!keep.has(id)) await deletePhoto(id);
}
/**
 * Run once when the app opens (before any trip editor can add new photos): removes photos left behind
 * by a deleted trip (if the app closed during the Undo time), by a replaced backup, or by an editor
 * that was left without saving.
 */
export async function tidyPhotos() {
  const s = state.value;
  const used = new Set();
  for (const t of s.trips) for (const id of t.photos) used.add(id);
  const gone = Object.keys(s.photos).filter(id => !used.has(id) && !s.photos[id].city);
  if (gone.length) update(x => { const p = { ...x.photos }; for (const id of gone) delete p[id]; x.photos = p; });
  await cleanOrphans(state.value);
}
