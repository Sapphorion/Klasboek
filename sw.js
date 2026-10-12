// Offline support: every app file is cached on install, so Klasboek opens with no internet.
// Bump VERSION whenever you change any file so teachers get the update.
const VERSION = 'klasboek-v19';
const FILES = [
  './',
  './fonts/atkinson-hyperlegible-latin-400-italic.woff2',
  './fonts/atkinson-hyperlegible-latin-400-normal.woff2',
  './fonts/atkinson-hyperlegible-latin-700-normal.woff2',
  './fonts/bricolage-grotesque-latin-600-normal.woff2',
  './fonts/bricolage-grotesque-latin-800-normal.woff2',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './index.html',
  './js/adjust.js',
  './js/ai.js',
  './js/aicheck.js',
  './js/app.js',
  './js/config.js',
  './js/create/export.js',
  './js/create/graph.js',
  './js/create/model.js',
  './js/create/render.js',
  './js/dates.js',
  './js/db.js',
  './js/events.js',
  './js/exporters.js',
  './js/generate.js',
  './js/github.js',
  './js/ics.js',
  './js/importers.js',
  './js/moderation-core.js',
  './js/moderation-export.js',
  './js/msauth.js',
  './js/siyavula-data.js',
  './js/siyavula.js',
  './js/state.js',
  './js/sync.js',
  './js/tell.js',
  './js/ttday.js',
  './js/ui.js',
  './js/views/account.js',
  './js/views/calendar.js',
  './js/views/checker.js',
  './js/views/create.js',
  './js/views/daymenu.js',
  './js/views/diary.js',
  './js/views/display.js',
  './js/views/extcal.js',
  './js/views/install.js',
  './js/views/lesson.js',
  './js/views/materials.js',
  './js/views/moderation.js',
  './js/views/notices.js',
  './js/views/planner.js',
  './js/views/settings.js',
  './js/views/subjects.js',
  './js/views/tellbox.js',
  './js/views/termplan.js',
  './js/views/tidy.js',
  './js/views/timetable.js',
  './js/views/ttchanges.js',
  './manifest.webmanifest',
  './styles.css',
  './vendor/docx.iife.js',
  './vendor/mammoth.browser.min.js',
  './vendor/pdf.min.mjs',
  './vendor/pdf.worker.min.mjs',
  './vendor/pptxgen.bundle.js',
  './vendor/xlsx.full.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // AI calls go straight to the network
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
  );
});
