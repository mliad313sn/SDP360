/* Step 10 — service worker of the FIELD APP (field.html). It keeps the app's own files for offline use and nothing
 * else: a request is handled only when it is the field page itself, its manifest, or a file that page asked for
 * (same origin, `referrer` = field.html). Every other page of the dashboard, and every API call, goes to the network
 * untouched — the field data lives in IndexedDB (field-app.js), never in this cache.
 * Registered as /sw.js?v=<version of the deployed build>: a deploy changes the URL, so the new worker installs and
 * the old cache is dropped. */
'use strict';
var VERSION = new URL(self.location).searchParams.get('v') || 'dev';
var CACHE = 'sdp-field-' + VERSION;
var SHELL = ['/field.html', '/field.webmanifest', '/brand/field-icon.svg'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('sdp-field-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function isFieldRequest(req) {
  if (req.method !== 'GET') return false;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.indexOf('/api/') === 0) return false;
  if (SHELL.indexOf(url.pathname) >= 0) return true;
  try { return new URL(req.referrer).pathname === '/field.html'; } catch (_) { return false; }
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (!isFieldRequest(req)) return;   // not ours: the browser does as usual
  var url = new URL(req.url);
  if (url.pathname === '/field.html') {
    // The page: network first (fresh build), the cached copy when offline.
    e.respondWith(fetch(req).then(function (res) {
      var copy = res.clone();
      if (res.ok) caches.open(CACHE).then(function (c) { c.put('/field.html', copy); });
      return res;
    }).catch(function () { return caches.match('/field.html'); }));
    return;
  }
  // The page's files (versioned ?v=…): cache first, then the network (and keep it).
  e.respondWith(caches.match(req).then(function (hit) {
    return hit || fetch(req).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    });
  }));
});
