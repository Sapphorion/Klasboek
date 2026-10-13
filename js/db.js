// Local storage layer (IndexedDB). Everything lives on the device so the app works offline.
// Kept behind a small API so it can later be swapped for a synced backend (accounts, cloud).

const DB_NAME = 'klasboek';
const DB_VERSION = 7;
const STORES = ['kv', 'subjects', 'atp', 'lessons', 'materials', 'moderations', 'events', 'notices', 'creations', 'diary', 'years', 'stock'];

let dbp = null;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) {
          db.createObjectStore(s, s === 'kv' ? undefined : { keyPath: 'id' });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const wrap = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export const db = {
  get: (store, key) => tx(store, 'readonly', s => wrap(s.get(key))),
  all: (store) => tx(store, 'readonly', s => wrap(s.getAll())),
  put: (store, value, key) => tx(store, 'readwrite', s => wrap(key === undefined ? s.put(value) : s.put(value, key))),
  putMany: (store, values) => tx(store, 'readwrite', s => { values.forEach(v => s.put(v)); }),
  del: (store, key) => tx(store, 'readwrite', s => wrap(s.delete(key))),
  delMany: (store, keys) => tx(store, 'readwrite', s => { keys.forEach(k => s.delete(k)); }),
  clear: (store) => tx(store, 'readwrite', s => wrap(s.clear())),
};

export const uid = (p = '') => p + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

// ---------- Backup ----------
const blobToB64 = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
const b64ToBlob = async d => (await fetch(d)).blob();

export async function exportBackup() {
  const out = { app: 'klasboek', version: 1, exported: new Date().toISOString(), data: {} };
  for (const s of STORES) {
    if (s === 'kv') {
      const d = await open();
      out.data.kv = await new Promise((res, rej) => {
        const t = d.transaction('kv'); const st = t.objectStore('kv');
        const keys = wrap(st.getAllKeys()); const vals = wrap(st.getAll());
        Promise.all([keys, vals]).then(([k, v]) => res(k.map((key, i) => [key, v[i]]))).catch(rej);
      });
    } else {
      const rows = await db.all(s);
      if (s === 'materials') {
        for (const r of rows) if (r.blob instanceof Blob) { r.blob = await blobToB64(r.blob); r._b64 = true; }
      }
      out.data[s] = rows;
    }
  }
  // Never put the API key in a backup file that may be shared.
  out.data.kv = out.data.kv.map(([k, v]) => k === 'settings' && v ? [k, { ...v, apiKey: '' }] : [k, v]);
  return new Blob([JSON.stringify(out)], { type: 'application/json' });
}

export async function importBackup(file) {
  const json = JSON.parse(await file.text());
  if (json.app !== 'klasboek') throw new Error('This file is not a Klasboek backup.');
  const keepKey = (await db.get('kv', 'settings'))?.apiKey || '';
  for (const s of STORES) {
    await db.clear(s);
    const rows = json.data[s] || [];
    if (s === 'kv') {
      for (const [k, v] of rows) await db.put('kv', k === 'settings' ? { ...v, apiKey: v.apiKey || keepKey } : v, k);
    } else {
      for (const r of rows) if (r._b64) { r.blob = await b64ToBlob(r.blob); delete r._b64; }
      await db.putMany(s, rows);
    }
  }
}
