// Keep Klasboek the same on every device through your Microsoft account.
// A copy of your data lives in OneDrive, in Klasboek's own app folder (Apps/Klasboek), which Klasboek can
// see and nothing else. Changes upload a few seconds after you make them; other devices pick them up
// when they open or come back into view. If two devices changed things at the same time, you choose.
import { state, onChange, emit, loadState } from './state.js';
import { exportBackup, importBackup } from './db.js';
import { graph, signedIn, needsSignIn, NeedSignIn } from './msauth.js';
import { h, modal } from './ui.js';

const FILE = '/me/drive/special/approot:/klasboek-sync.json';
const LS = 'klasboek.sync';
const ALL = ['settings', 'timetable', 'subjects', 'atp', 'lessons', 'materials', 'moderations', 'events', 'notices', 'creations', 'diary'];

const meta = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } };
const setMeta = p => { const m = { ...meta(), ...p }; localStorage.setItem(LS, JSON.stringify(m)); listeners.forEach(f => f(m)); return m; };
const listeners = new Set();
export const onSync = f => (listeners.add(f), () => listeners.delete(f));
export const syncInfo = () => ({ ...meta(), signedIn: signedIn(), needsSignIn: needsSignIn() });
export const autoSync = () => meta().auto !== false;
export const setAutoSync = on => setMeta({ auto: !!on });

let busy = null, applying = false, timer = null;

async function push() {
  const blob = await exportBackup();
  if (blob.size > 240 * 1024 * 1024) throw new Error('Your data is too big to sync in one go (over 240 MB). Remove some large files in Materials.');
  const item = await graph(FILE + ':/content', { method: 'PUT', body: blob, headers: { 'Content-Type': 'application/json' } });
  setMeta({ seen: item.lastModifiedDateTime, dirty: false, lastSync: new Date().toISOString(), error: '' });
}

async function pull(item) {
  const res = await fetch(item['@microsoft.graph.downloadUrl']);
  if (!res.ok) throw new Error('Couldn’t download your data from OneDrive.');
  applying = true;
  try {
    await importBackup(await res.blob());
    await loadState();
    ALL.forEach(emit);
    window.dispatchEvent(new HashChangeEvent('hashchange')); // redraw the page you're on
  } finally { applying = false; }
  setMeta({ seen: item.lastModifiedDateTime, dirty: false, lastSync: new Date().toISOString(), error: '' });
}

function askConflict(item) {
  return new Promise(res => {
    const when = s => s ? new Date(s).toLocaleString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'unknown';
    const m = modal('Changes on two devices', [
      h('p', {}, 'This device has changes that aren’t in OneDrive yet, and another device saved changes too. Which one do you want to keep?'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn primary', onclick: () => { m.close(); res('mine'); } }, 'Keep this device’s version'),
        h('button', { class: 'btn', onclick: () => { m.close(); res('cloud'); } }, `Use the OneDrive version (${when(item.lastModifiedDateTime)})`),
        h('button', { class: 'btn ghost', onclick: () => { m.close(); res('later'); } }, 'Decide later')),
      h('p', { class: 'muted small' }, 'Tip: download a backup in Settings first if you’re unsure. The version you don’t keep is replaced.'),
    ]);
  });
}

// Bring this device and OneDrive in line. Safe to call often.
export function syncNow({ quiet = true } = {}) {
  if (busy) return busy;
  busy = (async () => {
    if (!signedIn() || !navigator.onLine) return 'skipped';
    setMeta({ syncing: true });
    try {
      const item = await graph(FILE);
      const m = meta();
      if (!item) { await push(); return 'pushed'; }
      if (item.lastModifiedDateTime === m.seen) { if (m.dirty) { await push(); return 'pushed'; } setMeta({ lastSync: new Date().toISOString(), error: '' }); return 'same'; }
      if (!m.seen && !m.dirty && !hasData()) { await pull(item); return 'pulled'; }
      if (!m.dirty && m.seen) { await pull(item); return 'pulled'; }
      const pick = await askConflict(item);
      if (pick === 'mine') { await push(); return 'pushed'; }
      if (pick === 'cloud') { await pull(item); return 'pulled'; }
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
export function startSync() {
  onChange(() => {
    if (applying || !signedIn()) return;
    setMeta({ dirty: true });
    if (!autoSync()) return;
    clearTimeout(timer); timer = setTimeout(() => syncNow(), 8000);
  });
  let last = 0;
  const check = () => { if (autoSync() && Date.now() - last > 30000) { last = Date.now(); syncNow(); } };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); else if (meta().dirty && autoSync()) syncNow(); });
  window.addEventListener('online', check);
  window.addEventListener('focus', check);
  setInterval(() => { if (document.visibilityState === 'visible') check(); }, 5 * 60 * 1000);
  if (autoSync()) syncNow();
}
