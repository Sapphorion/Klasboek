// Keep Klasboek the same on every device: a shared copy lives in a private GitHub repository
// (or OneDrive's app folder, for a registered Microsoft account). Changes upload a few seconds after you make them; other devices pick them up
// when they open or come back into view. If two devices changed things at the same time, you choose.
import { state, onChange, emit, loadState } from './state.js';
import { exportBackup, importBackup } from './db.js';
import { graph, signedIn, needsSignIn, NeedSignIn } from './msauth.js';
import { gh } from './github.js';
import { h, modal } from './ui.js';

const FILE = '/me/drive/special/approot:/klasboek-sync.json';
const LS = 'klasboek.sync';
const ALL = ['settings', 'timetable', 'subjects', 'atp', 'lessons', 'materials', 'moderations', 'events', 'notices', 'creations', 'diary'];

// Microsoft (OneDrive app folder), for school/work accounts with Klasboek registered.
const ms = {
  name: 'OneDrive',
  ready: signedIn,
  async version() { const it = await graph(FILE); return it ? it.lastModifiedDateTime : null; },
  async download() { const it = await graph(FILE); const res = await fetch(it['@microsoft.graph.downloadUrl']); if (!res.ok) throw new Error('Couldn’t download your data from OneDrive.'); return res.blob(); },
  async upload(blob) { const it = await graph(FILE + ':/content', { method: 'PUT', body: blob, headers: { 'Content-Type': 'application/json' } }); return it.lastModifiedDateTime; },
};
export const provider = () => gh.ready() ? gh : ms.ready() ? ms : null;
export const connected = () => !!provider();

const meta = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } };
const setMeta = p => { const m = { ...meta(), ...p }; localStorage.setItem(LS, JSON.stringify(m)); listeners.forEach(f => f(m)); return m; };
export const resetSyncState = () => { localStorage.removeItem(LS); listeners.forEach(f => f({})); };
const listeners = new Set();
export const onSync = f => (listeners.add(f), () => listeners.delete(f));
export const syncInfo = () => ({ ...meta(), connected: connected(), via: provider()?.name || '', needsSignIn: !gh.ready() && needsSignIn() });
export const autoSync = () => meta().auto !== false;
export const setAutoSync = on => setMeta({ auto: !!on });

let busy = null, applying = false, timer = null;

async function push(P, prev) {
  const blob = await exportBackup();
  if (blob.size > 240 * 1024 * 1024) throw new Error('Your data is too big to sync in one go. Remove some large files in Materials.');
  const v = await P.upload(blob, prev);
  setMeta({ seen: v, dirty: false, lastSync: new Date().toISOString(), error: '' });
}

async function pull(P, v) {
  const blob = await P.download();
  applying = true;
  try {
    await importBackup(blob);
    await loadState();
    ALL.forEach(emit);
    window.dispatchEvent(new HashChangeEvent('hashchange')); // redraw the page you're on
  } finally { applying = false; }
  setMeta({ seen: v, dirty: false, lastSync: new Date().toISOString(), error: '' });
}

function askConflict(via) {
  return new Promise(res => {
    const m = modal('Changes on two devices', [
      h('p', {}, `This device has changes that aren’t synced yet, and another device saved changes to ${via} too. Which one do you want to keep?`),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn primary', onclick: () => { m.close(); res('mine'); } }, 'Keep this device’s version'),
        h('button', { class: 'btn', onclick: () => { m.close(); res('cloud'); } }, 'Use the other device’s version'),
        h('button', { class: 'btn ghost', onclick: () => { m.close(); res('later'); } }, 'Decide later')),
      h('p', { class: 'muted small' }, 'Tip: download a backup in Settings first if you’re unsure. The version you don’t keep is replaced.'),
    ]);
  });
}

// Bring this device and the shared copy in line. Safe to call often.
export function syncNow({ quiet = true } = {}) {
  if (busy) return busy;
  busy = (async () => {
    const P = provider();
    if (!P || !navigator.onLine) return 'skipped';
    setMeta({ syncing: true });
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const v = await P.version();
          const m = meta();
          if (!v) { await push(P, null); return 'pushed'; }
          if (v === m.seen) { if (m.dirty) { await push(P, v); return 'pushed'; } setMeta({ lastSync: new Date().toISOString(), error: '' }); return 'same'; }
          if (!m.seen && !m.dirty && !hasData()) { await pull(P, v); return 'pulled'; }
          if (!m.dirty && m.seen) { await pull(P, v); return 'pulled'; }
          const pick = await askConflict(P.name);
          if (pick === 'mine') { await push(P, v); return 'pushed'; }
          if (pick === 'cloud') { await pull(P, v); return 'pulled'; }
          return 'later';
        } catch (e) { if (e.message === 'conflict' && attempt === 0) continue; throw e; } // someone saved in between: look again
      }
      return 'later';
    } catch (e) {
      setMeta({ error: e instanceof NeedSignIn ? 'Sign in again to keep syncing.' : e.message });
      if (!quiet) throw e;
      return 'error';
    } finally { setMeta({ syncing: false }); busy = null; }
  })();
  return busy;
}
const hasData = () => state.subjects.length + state.lessons.length + state.events.length + state.diary.length > 0;

// Watch for changes and keep things in step.
let started = false;
export function startSync() {
  if (started) { syncNow(); return; }
  started = true;
  onChange(() => {
    if (applying || !connected()) return;
    setMeta({ dirty: true });
    if (!autoSync()) return;
    clearTimeout(timer); timer = setTimeout(() => syncNow(), 8000);
  });
  let last = 0;
  const check = () => { if (connected() && autoSync() && Date.now() - last > 30000) { last = Date.now(); syncNow(); } };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); else if (meta().dirty && autoSync()) syncNow(); });
  window.addEventListener('online', check);
  window.addEventListener('focus', check);
  setInterval(() => { if (document.visibilityState === 'visible') check(); }, 5 * 60 * 1000);
  if (autoSync()) syncNow();
}
