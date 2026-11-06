'use strict';
// E-D05 — metric lineage & contract sheet (generated, --check).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const ML = require('../tools/agent/metric-lineage');
const { SEED } = require('../services/metricRegistry');

test('the committed METRIC-LINEAGE.md is up to date', () => {
  assert.equal(fs.readFileSync(ML.OUT, 'utf8').replace(/\r\n/g, '\n'), ML.build().markdown, 'run: node tools/agent/metric-lineage.js');
});

test('--check detects a stale file', () => {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lineage-')), 'L.md');
  const log = console.log, err = console.error; console.log = () => {}; console.error = () => {};
  try {
    fs.writeFileSync(tmp, 'stale');
    assert.equal(ML.main(['--check'], { out: tmp }), 1);
    assert.equal(ML.main([], { out: tmp }), 0);
    assert.equal(ML.main(['--check'], { out: tmp }), 0);
  } finally { console.log = log; console.error = err; }
});

test('every SEED key has a sheet with source, formula, contract and freshness', () => {
  const md = ML.build().markdown;
  for (const m of SEED) {
    const i = md.indexOf('## `' + m.key + '`'); assert.ok(i >= 0, m.key);
    const sheet = md.slice(i, md.indexOf('\n## ', i + 1) > 0 ? md.indexOf('\n## ', i + 1) : undefined);
    for (const f of ['| Source |', '| Formula |', '| RAG policy |', '| Owner role |', '| Certification |', '| Versioned contract | kpi_policies', '| Freshness |', '| Consumers |']) assert.ok(sheet.includes(f), m.key + ' ' + f);
  }
  assert.match(md, /`helpdesk\.inbound`[\s\S]*?\| Freshness \| `zoho\.requests`/);
});

test('the metrics named by no code carry the pending decision block, with nothing filled', () => {
  const b = ML.build();
  assert.equal(b.unused.length, 10);
  assert.equal((b.markdown.match(/PENDING KPI committee/g) || []).length, 10);
  for (const k of b.unused) {
    const i = b.markdown.indexOf('## `' + k + '`'); const j = b.markdown.indexOf('\n## ', i + 1);
    assert.match(b.markdown.slice(i, j < 0 ? undefined : j), /PENDING KPI committee[\s\S]*Decision: _\(not taken\)_/);
  }
  assert.doesNotMatch(b.markdown, /certified by|approved by [A-Z]/i);
});
