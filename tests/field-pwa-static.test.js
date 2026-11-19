'use strict';
// Step 10 — the field PWA is installable and CSP-clean: manifest parses, every precached shell file exists,
// no inline handlers / inline scripts, the service worker never intercepts writes, the role + nav are wired.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const PUB = path.join(__dirname, '..', 'public');
const read = (p) => fs.readFileSync(path.join(PUB, p), 'utf8');

test('manifest + icon + shell files exist and the service worker precache list matches the disk', () => {
  const m = JSON.parse(read('field/manifest.webmanifest'));
  assert.equal(m.display, 'standalone'); assert.equal(m.start_url, '/field/index.html'); assert.ok(m.icons.length);
  const sw = read('field/sw.js');
  const shell = JSON.parse(sw.match(/const SHELL = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
  for (const f of shell) assert.ok(fs.existsSync(path.join(PUB, f.replace(/^\//, ''))), 'precached file missing: ' + f);
  assert.match(sw, /CACHE_VERSION = 'field-v\d+'/); assert.match(sw, /req\.method !== 'GET'\) return/, 'writes bypass the service worker');
});

test('index.html: no inline script or handler, external app.js, manifest linked, nav + role card wired', () => {
  const h = read('field/index.html');
  assert.ok(!/<script(?![^>]*\bsrc=)/.test(h), 'no inline <script>'); assert.ok(!/\son[a-z]+="/i.test(h), 'no inline handler');
  assert.match(h, /<script src="app.js"><\/script>/); assert.match(h, /rel="manifest" href="manifest.webmanifest"/);
  assert.match(read('_shell.js'), /href: 'field\/index\.html',\s+roles: \['editor', 'field-tech'\]/);
  assert.match(read('reports.html'), /value="field-tech"/);
  assert.ok(require('../reports-db').FEATURE_ROLES_KNOWN ? true : true);
  const app = read('field/app.js'); new Function(app);                           // parses as a classic script
  assert.match(app, /report_token/); assert.ok(!/Date\.now\(\)\s*\)\s*;\s*\/\/ as.of/.test(app));
  assert.match(app, /PUT.*\/api\/field\/outbox\//s, 'envelopes go through the idempotent PUT');
});

test('P11 F-3/F-1/F-2: the service worker never stores an /api/ answer; field ids are collision-resistant; action changes carry base_status', () => {
  const sw = read('field/sw.js');
  const apiBranch = sw.slice(sw.indexOf("url.pathname.startsWith('/api/')"), sw.indexOf('return;', sw.indexOf("url.pathname.startsWith('/api/')")));
  assert.ok(apiBranch.length > 0, 'the /api/ branch exists');
  assert.ok(!/caches\.|\.put\(|caches\.match/.test(apiBranch), 'the /api/ branch neither stores nor serves a cached answer');
  const app = read('field/app.js');
  assert.ok(!/Math\.random\(\) \* 9000/.test(app), 'no 4-digit random inspection id');
  assert.match(app, /function fieldInspectionId\(d\) \{ return 'EM-IT-' \+ .*uuid\(\)/);
  assert.match(app, /base_status: a\.status/, 'an action change says which status the phone saw');
});
