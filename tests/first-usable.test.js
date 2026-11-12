'use strict';
// F-UX-05 — "first usable table": the pages set ONE performance mark when their primary table / figure shows data
// or an explicit state; the journeys read it; the baseline and the load report show it per page / per route with
// no budget (UNKNOWN — to be approved). null is "no sample", never 0.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('the listed pages emit the first-usable mark (data path, and an explicit-state path where there is one)', () => {
  const PAGES = { 'public/lib/home-page.js': 2, 'public/index.html': 2, 'public/site-actions.html': 2, 'public/dashboards.html': 2, 'public/wan.html': 1, 'public/reports.html': 3 };
  for (const [f, n] of Object.entries(PAGES)) assert.equal((read(f).match(/window\.__markFirstUsable\(/g) || []).length, n, f);
  assert.match(read('public/lib/pageStates.js'), /__markFirstUsable\('live-data'\)/, 'executive.html marks through the loadLiveData wrapper');
  assert.match(read('public/executive.html'), /src="lib\/pageStates\.js"/);
});

test('the shell mark fires once per document', () => {
  const marks = [];
  const performance = { mark: (n, o) => marks.push([n, o && o.detail && o.detail.label]), getEntriesByName: (n) => marks.filter((m) => m[0] === n) };
  const window = { EDV_ICONS: { html: () => '' } };
  const document = { readyState: 'loading', addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
  vm.runInNewContext(read('public/_shell.js'), { window, document, console, performance, localStorage: { getItem: () => null, setItem() {} }, navigator: { language: 'en' } });
  assert.equal(window.__markFirstUsable('home'), true);
  assert.equal(window.__markFirstUsable('again'), false);
  assert.deepStrictEqual(marks, [['sdp:first-usable', 'home']]);
});

test('perf baseline: first usable p50/p95 per page; a page without a mark reads — (null), never 0', () => {
  const pb = require('../tools/test/perf-baseline');
  const art = (fu) => ({ journey: 'J', __run: 1, status: 'passed', started_at: '2026-11-12T10:00:00Z', finished_at: '2026-11-12T10:00:01Z', pages: [{ path: '/a.html', dom_content_loaded_ms: 10, load_ms: 20, transfer_bytes: 1, first_usable_ms: fu }, { path: '/b.html', dom_content_loaded_ms: 5, load_ms: 6, transfer_bytes: 1, first_usable_ms: null }] });
  const agg = pb.aggregate([art(900), art(1500)]);
  assert.deepEqual(agg.pages['/a.html'].first_usable_ms, { n: 2, p50: 900, p95: 1500 });
  assert.deepEqual(agg.pages['/b.html'].first_usable_ms, { n: 0, p50: null, p95: null });
  const md = pb.renderMarkdown(agg, { commit: 'x' });
  assert.match(md, /First usable p50 \(ms\) \| First usable p95 \(ms\)/);
  assert.match(md, /`\/b.html` \| 2 \| 5 \| 5 \| 6 \| 6 \| — \| — \|/);
  assert.ok(!/< ?3 ?s\b.*approved by/i.test(md));
});

test('load report: p95 per route template, no threshold', () => {
  const L = require('../tools/test/load');
  const a = L.aggregate([{ step: 'reports.open', ms: 10, status: 200 }, { step: 'reports.open', ms: 30, status: 200 }, { step: 'custom', ms: 5, status: 500 }]);
  assert.equal(a.routes['GET /api/reports/:id'].p95, 30);
  assert.equal(a.routes.custom.five_xx, 1);
  const md = L.renderMarkdown(a, { target: 'http://127.0.0.1:1', sessions: 1, duration: 1, scenarios: ['reports'], at: 'X' });
  assert.match(md, /\| GET \/api\/reports\/:id \| 2 \| 10 \| 30 \| 30 \|/);
});
