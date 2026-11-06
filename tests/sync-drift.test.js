'use strict';
// E-D04 — sync content drift (shadow): pure core on fixtures + the alert stays silent at '0'.
const { test } = require('node:test');
const assert = require('node:assert');
const D = require('../services/sync/drift');
const { createAlerter } = require('../services/sync/alerts');

const runs = (...rows) => rows.map((r) => (typeof r === 'object' ? r : { rows: r, duplicates: 0 }));   // newest first

test('fewer than 5 successful runs = unknown, never ok', () => {
  for (const r of [[], runs(100), runs(100, 100, 100, 100)]) {
    const d = D.computeDrift(r); assert.equal(d.status, 'unknown'); assert.deepStrictEqual(d.flags, []);
  }
});

test('a steady job is ok; a drop below 50 % of the median is flagged', () => {
  assert.equal(D.computeDrift(runs(98, 100, 102, 99, 101)).status, 'ok');
  const d = D.computeDrift(runs(10, 100, 102, 99, 101, 100));
  assert.equal(d.status, 'drift'); assert.deepStrictEqual(d.flags, ['drop']); assert.equal(d.last_rows, 10); assert.equal(d.median_rows, 100);
});

test('spike, zero after history and duplicates rate are flagged', () => {
  assert.deepStrictEqual(D.computeDrift(runs(500, 100, 100, 100, 100)).flags, ['spike']);
  assert.deepStrictEqual(D.computeDrift(runs(0, 100, 100, 100, 100)).flags, ['zero_after_history']);
  const d = D.computeDrift(runs({ rows: 100, duplicates: 25 }, 100, 100, 100, 100));
  assert.deepStrictEqual(d.flags, ['duplicates_rate']); assert.equal(d.duplicates_pct, 25);
});

test('a job that always writes 0 rows is not "zero after history"; missing row counts = unknown', () => {
  assert.equal(D.computeDrift(runs(0, 0, 0, 0, 0)).status, 'ok');
  assert.equal(D.computeDrift([{ rows: null }, { rows: 1 }, { rows: 1 }, { rows: 1 }, { rows: 1 }]).status, 'unknown');
});

test('thresholds come from report_config, falling back to the proposed defaults', () => {
  assert.deepStrictEqual(D.thresholds({}), { drop_pct: 50, spike_pct: 300, duplicates_pct: 10 });
  const t = D.thresholds({ sync_drift_drop_pct: '90', sync_drift_spike_pct: 'x', sync_drift_duplicates_pct: '' });
  assert.deepStrictEqual(t, { drop_pct: 90, spike_pct: 300, duplicates_pct: 10 });
  assert.deepStrictEqual(D.computeDrift(runs(80, 100, 100, 100, 100), t).flags, ['drop']);
});

test('the reportConfig defaults keep today: alerts off', () => {
  const C = require('../services/reportConfig');
  assert.equal(C.DEFAULTS.sync_drift_alerts, '0');
  assert.equal(D.enabled(C.DEFAULTS), false); assert.equal(D.enabled({ sync_drift_alerts: '1' }), true);
});

function alerterWith() {
  const sent = []; const wm = new Map();
  const a = createAlerter({ store: { recentRuns: async () => [], getWatermark: async (k) => wm.get(k) || null, setWatermark: async (k, v) => wm.set(k, v) }, senders: [async (m) => sent.push(m)] });
  return { a, sent };
}

test("alert not sent at '0'; at '1' sent once per 24 h through the sync alert path", async () => {
  const drift = { 'zoho.requests': D.computeDrift(runs(10, 100, 100, 100, 100)), 'assets.sync': D.computeDrift(runs(1)) };
  const { a, sent } = alerterWith();
  assert.deepStrictEqual(await a.checkDrift(drift, { enabled: false }), []); assert.equal(sent.length, 0);
  assert.equal((await a.checkDrift(drift, { enabled: true })).length, 1);
  assert.equal(sent[0].kind, 'drift'); assert.equal(sent[0].job, 'zoho.requests'); assert.match(sent[0].text, /drop/);
  assert.equal((await a.checkDrift(drift, { enabled: true })).length, 0, 'deduplicated');
});

test('driftForJobs reads the store; an unreadable job is unknown', async () => {
  const store = { recentOkRuns: async (j) => { if (j === 'bad') throw new Error('x'); return runs(100, 100, 100, 100, 100); } };
  const out = await D.driftForJobs(store, ['good', 'bad'], {});
  assert.equal(out.good.status, 'ok'); assert.equal(out.bad.status, 'unknown');
});
