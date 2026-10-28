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

// Every CSV writer carries the guard (consolidation P0, transplanted from the 1.11 line M14 and
// adapted to 2.0's writers). services/trackerLegacy.js is exempt: its CSV holds site codes and numbers only.
const WRITERS = ['routes/opmanager.js', 'services/reportPack.js', 'server.js', 'public/index.html',
  'public/executive-report.html', 'public/assets.html', 'public/itsm-roadmap.html', 'public/wan.html',
  'public/site-report.js', 'public/activity-tracker/App.jsx', 'public/activity-tracker/dist/app.js'];
test('every CSV writer carries the formula-injection guard', () => {
  for (const f of WRITERS) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
    assert.ok(src.includes('csvSafe') || src.includes('/^[=+\\-@\\t\\r]/'), `${f} lost the CSV guard`);
  }
});

test('Report Studio CSV neutralises an injected title end to end', () => {
  const { renderCsv } = require('../services/reportPack');
  const out = renderCsv({ figures: [{ metric: 'm', title: '=cmd|calc', value: -5, unit: '', rag: '', window: '', as_of: '' }] });
  assert.ok(out.includes("'=cmd|calc"), out);
  assert.ok(out.includes(',-5,'), 'negative number kept numeric: ' + out);
});
