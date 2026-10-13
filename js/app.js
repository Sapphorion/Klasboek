import { loadState, onChange, state } from './state.js';
import { h, icon, toast } from './ui.js';
import { renderPlanner } from './views/planner.js';
import { renderToday } from './views/today.js';
import { renderProgress } from './views/progress.js';
import { renderStock } from './views/stock.js';
import { renderCalendar } from './views/calendar.js';
import { renderDiary } from './views/diary.js';
import { renderCreate } from './views/create.js';
import { renderSubjects } from './views/subjects.js';
import { renderTimetable } from './views/timetable.js';
import { renderModeration } from './views/moderation.js';
import { renderMaterials } from './views/materials.js';
import { renderSettings } from './views/settings.js';
import { currentTheme, setLook } from './views/display.js';
import { openInstall, isInstalled, onInstallChange } from './views/install.js';
import { handleRedirect, renewIfNeeded, signedIn, account } from './msauth.js';
import { startSync, onSync, syncInfo, connected } from './sync.js';

const ROUTES = [
  { id: 'today', label: 'Today', short: 'Today', icon: 'home', render: renderToday },
  { id: 'planner', label: 'Planner', short: 'Planner', icon: 'calendar', render: renderPlanner },
  { id: 'calendar', label: 'School calendar', short: 'Calendar', icon: 'month', render: renderCalendar },
  { id: 'diary', label: 'Diary', short: 'Diary', icon: 'diary', render: renderDiary },
  { id: 'create', label: 'Create', short: 'Create', icon: 'pen', render: renderCreate },
  { id: 'subjects', label: 'Subjects & ATPs', short: 'Subjects', icon: 'book', render: renderSubjects },
  { id: 'timetable', label: 'Timetable', short: 'Timetable', icon: 'grid', render: renderTimetable },
  { id: 'moderation', label: 'Moderation', short: 'Moderate', icon: 'check', render: renderModeration },
  { id: 'stock', label: 'Lab stock', short: 'Stock', icon: 'flask', render: renderStock },
  { id: 'progress', label: 'Term progress', short: 'Progress', icon: 'chart', render: renderProgress, hidden: true },
  { id: 'materials', label: 'Materials', short: 'Files', icon: 'folder', render: renderMaterials },
  { id: 'settings', label: 'Settings', short: 'Settings', icon: 'gear', render: renderSettings },
];

const main = document.getElementById('main');
let current = null, cleanup = null;

function route() {
  const [id, ...rest] = (location.hash.slice(1) || state.settings.home || 'today').split('/');
  const r = ROUTES.find(r => r.id === id) || ROUTES.find(r => r.id === 'planner');
  document.querySelectorAll('#nav a').forEach(a => a.setAttribute('aria-current', a.dataset.id === r.id ? 'page' : 'false'));
  document.querySelectorAll('dialog.modal[open] > header .icon-btn').forEach(b => b.click()); // leaving the page closes pop-ups
  if (cleanup) { cleanup(); cleanup = null; }
  main.innerHTML = '';
  current = r;
  cleanup = r.render(main, rest) || null;
  document.title = `${r.label} · Klasboek`;
}

setLook('theme', currentTheme()); // also sets the browser bar colour

function buildNav() {
  const ul = document.getElementById('nav');
  for (const r of ROUTES) {
    if (r.hidden) continue;
    ul.append(h('li', {}, h('a', { href: '#' + r.id, 'data-id': r.id, 'aria-label': r.label }, icon(r.icon, 20), h('span', { class: 'long' }, r.label), h('span', { class: 'short', 'aria-hidden': 'true' }, r.short))));
  }
}

function netStatus() {
  const el = document.getElementById('net');
  el.replaceChildren(navigator.onLine ? h('span', { class: 'dot on' }) : icon('offline', 14), navigator.onLine ? 'Online' : 'Offline: AI paused');
  el.classList.toggle('off', !navigator.onLine);
}

const installBtn = document.getElementById('install');
installBtn.textContent = 'Get the app';
installBtn.hidden = isInstalled();
installBtn.addEventListener('click', openInstall);
onInstallChange(() => { installBtn.hidden = isInstalled(); });

async function showVersion() {
  try {
    const v = (await caches.keys()).filter(k => k.startsWith('klasboek-v')).sort((a, b) => +b.slice(10) - +a.slice(10))[0];
    if (!v) return;
    const el = document.getElementById('app-version') || document.querySelector('.rail-foot')?.appendChild(h('span', { id: 'app-version', class: 'app-version' }));
    if (el) el.textContent = 'Version ' + v.slice(10);
  } catch {}
}

function syncBadge() {
  let el = document.getElementById('sync-badge');
  if (!el) { el = h('a', { id: 'sync-badge', class: 'sync-badge', href: '#settings' }); document.querySelector('.rail-foot')?.prepend(el); }
  const s = syncInfo();
  if (!s.connected) { el.hidden = true; return; }
  el.hidden = false;
  const ago = s.lastSync ? Math.round((Date.now() - new Date(s.lastSync)) / 60000) : null;
  const [cls, text] = s.needsSignIn ? ['warn', 'Sign in to sync'] : s.syncing ? ['', 'Syncing…'] : s.error ? ['warn', 'Sync problem'] : s.dirty ? ['', 'Changes to sync'] : ['ok', ago === null ? 'Synced' : ago < 1 ? 'Synced just now' : ago < 60 ? `Synced ${ago} min ago` : 'Synced'];
  el.className = 'sync-badge ' + cls; el.title = s.error || `Syncing through ${s.via}`;
  el.replaceChildren(icon(s.error || s.needsSignIn ? 'offline' : 'check', 13), text);
}
setInterval(syncBadge, 60000);

async function start() {
  buildNav();
  try { await loadState(); }
  catch (e) { main.append(h('p', { class: 'error' }, 'Could not open local storage: ' + e.message)); return; }
  netStatus();
  window.addEventListener('online', () => { netStatus(); toast('Back online. AI is available again.'); });
  window.addEventListener('offline', () => { netStatus(); toast('Offline. Everything except AI still works.'); });
  window.addEventListener('hashchange', route);
  // Coming back from the Microsoft sign-in page?
  let justSignedIn = false;
  try { const r = await handleRedirect(); if (r === 'signed-in') { justSignedIn = true; toast(`Signed in as ${account()?.name || account()?.email}. Syncing…`); } }
  catch (e) { toast('Microsoft sign-in: ' + e.message, 'error'); }
  if (!justSignedIn && await renewIfNeeded().catch(() => false)) return; // off to Microsoft for a moment
  // Re-render the current view when shared data changes elsewhere (e.g. a modal saved).
  onChange(what => { if (current?.live?.includes(what)) route(); });
  route();
  syncBadge(); onSync(syncBadge); window.addEventListener('klasboek-sync', syncBadge);
  if (connected()) startSync(); else window.addEventListener('klasboek-connected', () => startSync());
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // When a new version takes over, reload once so the teacher sees it straight away.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
    navigator.serviceWorker.register('sw.js').then(reg => { reg.update().catch(() => {}); }).catch(() => {});
    showVersion();
  }
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
}
start();

export { state };
