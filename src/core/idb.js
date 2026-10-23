// Minimal IndexedDB: 'kv' keeps the app data, 'photos' keeps the trip photos (as Blobs).
let dbp = null;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (!('indexedDB' in self)) return reject(new Error('no IndexedDB'));
    const r = indexedDB.open('asfari', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos');
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => { db.close(); dbp = null; };
      resolve(db);
    };
    r.onerror = () => { dbp = null; reject(r.error); };
    r.onblocked = () => { dbp = null; reject(new Error('blocked')); };
  });
  return dbp;
}
function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    fn(t.objectStore(store));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('aborted'));
  }));
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const idbGet = (store, key) => open().then(db => req(db.transaction(store).objectStore(store).get(key)));
export const idbPut = (store, key, val) => tx(store, 'readwrite', s => { s.put(val, key); });
export const idbDel = (store, key) => tx(store, 'readwrite', s => { s.delete(key); });
export const idbKeys = store => open().then(db => req(db.transaction(store).objectStore(store).getAllKeys()));
export const idbClear = store => tx(store, 'readwrite', s => { s.clear(); });
export const idbAvailable = () => open().then(() => true, () => false);
