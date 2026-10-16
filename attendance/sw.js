// Roll Call offline cache: app shell is cached on first visit, then served offline.
const CACHE = "rollcall-v3";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "vendor/qrcode.js", "vendor/html5-qrcode.min.js",
  "vendor/xlsx.full.min.js", "vendor/jszip.min.js", "vendor/pdf.min.js", "vendor/pdf.worker.min.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n !== CACHE).map(n => caches.delete(n))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin === location.origin) {
    // network first so updates arrive; cache when offline. "?j=" student links reuse the cached page.
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("index.html"))));
  } else if (url.hostname.endsWith("gstatic.com") || url.hostname.endsWith("googleapis.com")) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { const c = res.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return res; })));
  }
});
