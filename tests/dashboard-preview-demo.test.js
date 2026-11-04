'use strict';
// C-09 (F25) — the design preview runs on a mock dataset (data.js); it must say so on screen and in the tab title.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'public', 'dashboard-preview');

test('dashboard-preview: fixed DEMO banner + title prefix', () => {
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  assert.match(html, /<title>DEMO — fictitious data · /);
  const m = /<div class="demo-banner" role="note">([^<]+)<\/div>/.exec(html);
  assert.ok(m, 'banner present');
  assert.match(m[1], /^DEMO — fictitious data/);
  assert.ok(html.indexOf('demo-banner') < html.indexOf('id="root"'), 'banner precedes the app root (not replaced by React)');
  const css = fs.readFileSync(path.join(DIR, 'styles.css'), 'utf8');
  assert.match(css, /\.demo-banner\s*\{[^}]*position:\s*fixed/);
});
