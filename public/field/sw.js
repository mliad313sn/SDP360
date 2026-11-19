/* Step 10 — field app service worker. App shell = cache-first (versioned cache, old caches dropped on
   activate); API answers are NEVER cached (P11 F-3: a cached /api/ answer outlived its session, so the next
   person on a shared phone kept the previous user's bootstrap/dashboard at rest) — offline, the app reads
   its own per-user IndexedDB copy; writes NEVER go through the service worker (the app's IndexedDB outbox
   owns retries). Bump CACHE_VERSION on every deploy of the field app: activating a new version also drops
   the caches of older versions, /api/ entries included. */
'use strict';
const CACHE_VERSION = 'field-v11';  // P11 r2: inspection action buttons, French refusals, dialog Cancel (F-3: /api/ never cached)
const SHELL = ['/field/index.html', '/field/app.js', '/field/styles.css', '/field/manifest.webmanifest', '/field/icon.svg', '/field/i18n.js', '/field/storage.js', '/lib/i18nText.js', '/_tokens.css'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // writes: let the page handle them (outbox)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    // network only, never stored: offline answers a 503 {offline:true} the app understands (it then falls back on
    // its own per-user copy of the bootstrap)
    e.respondWith(fetch(req).catch(() => new Response(JSON.stringify({ ok: false, error: 'offline', offline: true }), { status: 503, headers: { 'content-type': 'application/json' } })));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok && (url.pathname.startsWith('/field/') || url.pathname === '/lib/i18nText.js')) caches.open(CACHE_VERSION).then((c) => c.put(req, res.clone())); return res; })));
});
