'use strict';
// M14 — CSV formula-injection guard (public/lib/csvSafe.js) + every CSV writer carries it.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const { neutralize } = require('../public/lib/csvSafe');

test('formula-leading text is neutralised', () => {
  for (const s of ['=1+1', '=HYPERLINK("http://x","y")', '+cmd', '-2+3', '@SUM(A1)', '\tx', '\rx'])
    assert.equal(neutralize(s), "'" + s, s);
});
test('numbers and ordinary text are untouched', () => {
  for (const s of ['-5', '+3.2', '42', 'Hounde', 'a=b', '', 'x-1']) assert.equal(neutralize(s), s, s);
  assert.equal(neutralize(null), ''); assert.equal(neutralize(-7), '-7');
});

// Every CSV writer patched in run 8 keeps the guard (shared helper or the inline one-line rule).
const WRITERS = ['routes/opmanager.js', 'routes/reports.js', 'services/reportgen/render.js', 'public/index.html',
  'public/executive-report.html', 'public/assets.html', 'public/itsm-roadmap.html', 'public/wan.html',
  'public/site-report.js', 'public/activity-tracker/App.jsx', 'public/activity-tracker/App.js'];
test('every CSV writer carries the formula-injection guard', () => {
  for (const f of WRITERS) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
    assert.ok(src.includes('csvSafe') || src.includes('/^[=+\\-@\\t\\r]/'), `${f} lost the CSV guard`);
  }
});

test('report-studio CSV neutralises an injected label end to end', () => {
  const { csv } = require('../services/reportgen/render');
  const out = csv({ sections: [{ id: 's1', type: 'kpi', title: '=cmd|calc' }] },
    { widgets: { s1: { items: [{ label: '@SUM(A1)', value: -5, prev: '', unit: '', rag: '' }] } } });
  assert.ok(out.includes("'=cmd|calc"), out);
  assert.ok(out.includes("'@SUM(A1)"), out);
  assert.ok(out.includes(';-5;'), 'negative number kept numeric: ' + out);
});
