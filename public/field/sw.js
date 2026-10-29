/* Step 10 — field app service worker. App shell = cache-first (versioned cache, old caches dropped on
   activate); API = network-first with a cache fallback for GET only; writes NEVER go through the
   service worker (the app's IndexedDB outbox owns retries). Bump CACHE_VERSION on every deploy of
   the field app. */
'use strict';
const CACHE_VERSION = 'field-v2';
const SHELL = ['/field/index.html', '/field/app.js', '/field/styles.css', '/field/manifest.webmanifest', '/field/icon.svg', '/field/i18n.js', '/lib/i18nText.js', '/_tokens.css'];

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
    // network-first; a cached answer is served ONLY when the network fails, flagged by header
    e.respondWith(fetch(req).then((res) => { if (res.ok) caches.open(CACHE_VERSION).then((c) => c.put(req, res.clone())); return res; })
      .catch(() => caches.match(req).then((hit) => hit ? new Response(hit.body, { status: hit.status, headers: Object.assign({ 'x-field-cache': 'stale' }, Object.fromEntries(hit.headers)) }) : new Response(JSON.stringify({ ok: false, error: 'offline', offline: true }), { status: 503, headers: { 'content-type': 'application/json' } }))));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok && (url.pathname.startsWith('/field/') || url.pathname === '/lib/i18nText.js')) caches.open(CACHE_VERSION).then((c) => c.put(req, res.clone())); return res; })));
});
