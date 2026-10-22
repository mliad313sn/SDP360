'use strict';
// SDP-DASH-2.0 step 5 — no JSX compilation in the browser.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const build = require('../tools/build/build-frontend');

const ROOT = path.join(__dirname, '..');
// Pages still allowed to compile JSX in the browser, and why. Remove an entry when its
// page moves to tools/build/build-frontend.js — this list can only shrink.
const BABEL_ALLOWED = {};   // empty since 2026-10-22: no page compiles JSX in the browser

test('every compiled file is up to date with its .jsx source (npm run build)', () => {
  for (const src of build.ENTRIES) {
    const out = path.join(ROOT, build.outPath(src));
    assert.ok(fs.existsSync(out), `${build.outPath(src)} missing — run npm run build`);
    const onDisk = fs.readFileSync(out, 'utf8').replace(/\r\n/g, '\n');
    assert.strictEqual(onDisk, build.compile(src), `${build.outPath(src)} is stale — run npm run build`);
  }
});

test('no page loads Babel or a text/babel script, except the allow-listed ones', () => {
  const pages = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.html')) pages.push(path.relative(ROOT, p).replace(/\\/g, '/'));
    }
  })(path.join(ROOT, 'public'));
  for (const rel of pages) {
    if (BABEL_ALLOWED[rel]) continue;
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(!/@babel\/standalone|type="text\/babel"/.test(html), `${rel} still compiles JSX in the browser`);
  }
});

test('a compiled page references the .js output, never the .jsx source', () => {
  const pages = {
    'public/dashboard-preview/index.html': 'public/dashboard-preview/',
    'public/activity-tracker.html': 'public/',
  };
  for (const [page, base] of Object.entries(pages)) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    for (const src of build.ENTRIES.filter(s => s.startsWith(base) && (base !== 'public/' || s.startsWith('public/activity-tracker/')))) {
      const rel = src.slice(base.length).replace(/\.jsx$/, '');
      assert.ok(html.includes(`src="${rel}.js"`), `${page}: ${rel}.js not loaded`);
      assert.ok(!html.includes(`${rel}.jsx`), `${page}: ${rel}.jsx still referenced`);
    }
  }
});

test('the tracker loads the PRODUCTION React build with subresource integrity', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/activity-tracker.html'), 'utf8');
  assert.ok(!/react(-dom)?\.development\.js/.test(html), 'development React build still loaded');
  for (const m of html.match(/<script src="https:[^>]*>/g) || []) {
    if (/unpkg\.com\/react/.test(m)) assert.ok(/integrity="sha384-/.test(m), 'missing SRI: ' + m);
  }
});
