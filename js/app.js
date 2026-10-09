import { loadState, onChange, state } from './state.js';
import { h, icon, toast } from './ui.js';
import { renderPlanner } from './views/planner.js';
import { renderSubjects } from './views/subjects.js';
import { renderTimetable } from './views/timetable.js';
import { renderModeration } from './views/moderation.js';
import { renderMaterials } from './views/materials.js';
import { renderSettings } from './views/settings.js';

const ROUTES = [
  { id: 'planner', label: 'Planner', icon: 'calendar', render: renderPlanner },
  { id: 'subjects', label: 'Subjects & ATPs', icon: 'book', render: renderSubjects },
  { id: 'timetable', label: 'Timetable', icon: 'grid', render: renderTimetable },
  { id: 'moderation', label: 'Moderation', icon: 'check', render: renderModeration },
  { id: 'materials', label: 'Materials', icon: 'folder', render: renderMaterials },
  { id: 'settings', label: 'Settings', icon: 'gear', render: renderSettings },
];

const main = document.getElementById('main');
let current = null, cleanup = null;

function route() {
  const [id, ...rest] = (location.hash.slice(1) || 'planner').split('/');
  const r = ROUTES.find(r => r.id === id) || ROUTES[0];
  document.querySelectorAll('#nav a').forEach(a => a.setAttribute('aria-current', a.dataset.id === r.id ? 'page' : 'false'));
  if (cleanup) { cleanup(); cleanup = null; }
  main.innerHTML = '';
  current = r;
  cleanup = r.render(main, rest) || null;
  document.title = `${r.label} · Klasboek`;
}

function buildNav() {
  const ul = document.getElementById('nav');
  for (const r of ROUTES) {
    ul.append(h('li', {}, h('a', { href: '#' + r.id, 'data-id': r.id }, icon(r.icon, 20), h('span', {}, r.label))));
  }
}

function netStatus() {
  const el = document.getElementById('net');
  el.replaceChildren(navigator.onLine ? h('span', { class: 'dot on' }) : icon('offline', 14), navigator.onLine ? 'Online' : 'Offline: AI paused');
  el.classList.toggle('off', !navigator.onLine);
}

let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; document.getElementById('install').hidden = false; });
document.getElementById('install').addEventListener('click', async () => {
  if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null;
  document.getElementById('install').hidden = true;
});

async function start() {
  buildNav();
  try { await loadState(); }
  catch (e) { main.append(h('p', { class: 'error' }, 'Could not open local storage: ' + e.message)); return; }
  netStatus();
  window.addEventListener('online', () => { netStatus(); toast('Back online. AI is available again.'); });
  window.addEventListener('offline', () => { netStatus(); toast('Offline. Everything except AI still works.'); });
  window.addEventListener('hashchange', route);
  // Re-render the current view when shared data changes elsewhere (e.g. a modal saved).
  onChange(what => { if (current?.live?.includes(what)) route(); });
  route();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
}
start();

export { state };
