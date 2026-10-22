import { inSkoolHuis, skoolHuisHome } from './embed.js';
import { loadState, onChange, state, saveSettings } from './state.js';
import { h, icon, toast } from './ui.js';
import { renderPlanner } from './views/planner.js';
import { renderToday } from './views/today.js';
import { renderProgress } from './views/progress.js';
import { renderStock } from './views/stock.js';
import { renderAttendance } from './views/attendance.js';
import { needsWelcome, openWelcome } from './views/welcome.js';
import { isUni, applyEdition } from './edition.js';
import { wasSignedIn, fbConfigured, initFirebase, fbUser, onAuth } from './fbauth.js';
import { afterSignIn } from './signin.js';
import { syncOwner } from './sync.js';
import { emit } from './state.js';
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
import { pullIfDue, linkToSkoolHuis, refreshSchoolAi } from './school.js';

const ROUTES = [
  { id: 'today', only: 'school', label: 'Today', short: 'Today', icon: 'home', render: renderToday },
  { id: 'planner', label: 'Planner', short: 'Planner', icon: 'calendar', render: renderPlanner },
  { id: 'calendar', label: 'School calendar', short: 'Calendar', icon: 'month', render: renderCalendar },
  { id: 'diary', label: 'Diary', short: 'Diary', icon: 'diary', render: renderDiary },
  { id: 'create', label: 'Create', short: 'Create', icon: 'pen', render: renderCreate },
  { id: 'subjects', label: 'Subjects & ATPs', short: 'Subjects', icon: 'book', render: renderSubjects },
  { id: 'timetable', label: 'Timetable', short: 'Timetable', icon: 'grid', render: renderTimetable },
  { id: 'moderation', only: 'school', label: 'Moderation', short: 'Moderate', icon: 'check', render: renderModeration },
  { id: 'stock', only: 'school', label: 'Lab stock', short: 'Stock', icon: 'flask', render: renderStock },
  { id: 'progress', only: 'school', label: 'Term progress', short: 'Progress', icon: 'chart', render: renderProgress, hidden: true },
  { id: 'materials', only: 'school', label: 'Materials', short: 'Files', icon: 'folder', render: renderMaterials },
  { id: 'attendance', label: 'Attendance', short: 'Attend', icon: 'people', render: renderAttendance, only: 'uni' },
  { id: 'settings', label: 'Settings', short: 'Settings', icon: 'gear', render: renderSettings },
];

const main = document.getElementById('main');
let current = null, cleanup = null;

function route() {
  const [id, ...rest] = (location.hash.slice(1) || state.settings.home || 'today').split('/');
  const r = ROUTES.find(r => r.id === id && (!r.only || r.only === edition())) || ROUTES.find(r => r.id === 'planner');
  document.querySelectorAll('#nav a').forEach(a => a.setAttribute('aria-current', a.dataset.id === r.id ? 'page' : 'false'));
  document.querySelectorAll('dialog.modal[open] > header .icon-btn').forEach(b => b.click()); // leaving the page closes pop-ups
  if (cleanup) { cleanup(); cleanup = null; }
  main.innerHTML = '';
  current = r;
  cleanup = r.render(main, rest) || null;
  document.title = `${r.label} · Klasboek`;
  if (isUni()) document.title = document.title.replace('School calendar', 'Academic calendar').replace('Subjects & ATPs', 'Modules');
}

setLook('theme', currentTheme()); // also sets the browser bar colour

const edition = () => isUni() ? 'uni' : 'school';
function buildNav() {
  const ul = document.getElementById('nav');
  ul.replaceChildren();
  for (const r of ROUTES) {
    if (r.hidden || (r.only && r.only !== edition())) continue;
    ul.append(h('li', {}, h('a', { href: '#' + r.id, 'data-id': r.id, 'aria-label': r.label }, icon(r.icon, 20), h('span', { class: 'long' }, r.label), h('span', { class: 'short', 'aria-hidden': 'true' }, r.short))));
  }
  // Inside Skool Huis: a way back to the school's app.
  if (inSkoolHuis) ul.append(h('li', { class: 'to-skoolhuis' }, h('a', { href: skoolHuisHome(), 'aria-label': 'Back to Skool Huis' }, icon('left', 20), h('span', { class: 'long' }, 'Skool Huis'), h('span', { class: 'short', 'aria-hidden': 'true' }, 'Skool Huis'))));
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

// Fetch the newest Klasboek straight away and reload (instead of waiting for the next start).
async function updateNow() {
  if (!navigator.onLine) { toast('You need internet to get the newest version.', 'warn'); return; }
  const el = document.getElementById('app-version'); if (el) el.textContent = 'Updating…';
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
    const keys = await caches.keys(); await Promise.all(keys.filter(k => k.startsWith('klasboek-v')).map(k => caches.delete(k)));
    await reg?.unregister();
  } catch {}
  location.reload();
}

async function showVersion() {
  try {
    const v = (await caches.keys()).filter(k => k.startsWith('klasboek-v')).sort((a, b) => +b.slice(10) - +a.slice(10))[0];
    if (!v) return;
    const el = document.getElementById('app-version') || document.querySelector('.rail-foot')?.appendChild(h('button', { id: 'app-version', class: 'app-version', title: 'Check for a newer version', onclick: updateNow }));
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
  applyEdition(); buildNav();
  window.addEventListener('klasboek-edition', () => { applyEdition(); buildNav(); route(); });
  window.addEventListener('storage', e => { if (e.key === 'rollcall.v1') emit('attendance'); }); // registers changed in Attendance
  route();
  // A link like …/Klasboek/?for=lecturer opens straight in the lecturer edition.
  const forWho = new URLSearchParams(location.search).get('for') || '';
  const preset = inSkoolHuis ? 'school' : /^(uni|lecturer|university)$/i.test(forWho) ? 'uni' : /^(school|teacher)$/i.test(forWho) ? 'school' : '';
  if (needsWelcome()) openWelcome(() => route(), { edition: preset });
  else if (!state.settings.edition) saveSettings({ edition: 'school' });
  // Signed in with Google before? Pick the session up again (needs internet the first time each visit).
  if (wasSignedIn() && fbConfigured()) {
    const go = () => initFirebase().then(() => { const u = fbUser(); if (!u) return; if (syncOwner() !== u.uid) afterSignIn(u); else window.dispatchEvent(new Event('klasboek-connected')); window.dispatchEvent(new Event('klasboek-sync')); }).catch(() => {});
    navigator.onLine ? go() : window.addEventListener('online', go, { once: true });
  }
  syncBadge(); onSync(syncBadge); onAuth(syncBadge); window.addEventListener('klasboek-sync', syncBadge);
  // Connected to the school's Skool Huis? Bring in the term dates and school calendar every few hours.
  const schoolPull = () => { if (!isUni()) linkToSkoolHuis().catch(() => null).then(() => { refreshSchoolAi(); return pullIfDue(); }).then(r => { if (r?.events || r?.terms) toast(`School calendar updated${r.terms ? ', with new term dates' : ''}.`); }); };
  schoolPull();
  window.addEventListener('online', schoolPull);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schoolPull(); });
  if (connected()) startSync(); else window.addEventListener('klasboek-connected', () => startSync());
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // When a new version takes over, reload once so the teacher sees it straight away.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    const started = Date.now();
    const reload = () => { if (!reloaded) { reloaded = true; location.reload(); } };
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      // Just opened, or not on screen: reload straight away. In the middle of work: offer it, and do it when Klasboek is next put away.
      if (document.hidden || Date.now() - started < 20000) return reload();
      toast('A new version of Klasboek is ready.', 'ok', { action: { label: 'Reload', run: reload } });
      document.addEventListener('visibilitychange', () => { if (document.hidden) reload(); });
    });
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.update().catch(() => {});
      // Klasboek often stays open for days on a tablet: look for a new version whenever it comes back on screen.
      let last = Date.now();
      document.addEventListener('visibilitychange', () => { if (!document.hidden && navigator.onLine && Date.now() - last > 60000) { last = Date.now(); reg.update().catch(() => {}); } });
      setInterval(() => { if (navigator.onLine) reg.update().catch(() => {}); }, 30 * 60000);
    }).catch(() => {});
    window.addEventListener('klasboek-update-now', updateNow);
    navigator.serviceWorker.ready.then(() => setTimeout(showVersion, 300)).catch(() => {});
    showVersion();
  }
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
}
start();

export { state };
