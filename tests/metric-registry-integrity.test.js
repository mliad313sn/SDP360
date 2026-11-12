'use strict';
// F-DATA-03 — every PUBLISHED metric is computable: its reader exists and everything the reader needs is supplied
// by the ONE shared builder (services/metricDeps.js). Before the fix the two published programme metrics needed
// deps.programme, which no route supplied: null on every surface, for ever.
// Real readers on the test PostgreSQL (the "test against the real reader" rule); the stub cases need no database.
const fs = require('fs'), os = require('os'), path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-metric-integrity-'));
process.env.DASH_USER = process.env.DASH_USER || 'smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'smoke-pass-0000';

const { test, before } = require('node:test');
const assert = require('node:assert');
const MR = require('../services/metricRegistry');
const MD = require('../services/metricDeps');
const rdb = require('../reports-db');
const mdb = require('../meetings-db');

const NOW = new Date('2026-08-20T09:00:00Z');
let site;   // { site_id, code } — a seeded site that has a meetings code

before(async () => {
  site = (await rdb.listSiteModuleCodes('meetings'))[0];
  assert.ok(site && site.code, 'the test database seeds at least one site with a meetings code');
  // FIXTURE — one signed review with one open issue, inside the 3 months before NOW
  await mdb.saveMeeting({ header: { reference: `FIX_${site.code}_INTEGRITY_2026-07`, site_code: site.code, department: 'mining', meeting_date: '2026-07-10', intake_source: 'dept_meeting', status: 'draft' },
    issues: [{ title: 'FIXTURE issue', category: 'CN', severity: 'HIGH', status: 'open', target_date: '2026-09-30' }], actions: [] }, null, null);
});

test('integrity(): no published metric is left without a reader or a dependency the shared builder supplies', () => {
  const reg = MR.createRegistry();
  assert.deepEqual(MD.integrity(reg), []);
  for (const m of reg.list({ status: 'published' })) assert.doesNotMatch(MD.wiringOf(m), /not wired/, m.key);
  for (const r of Object.keys(MD.REQUIRES)) assert.equal(typeof MR.READERS[r], 'function', `REQUIRES names a real reader: ${r}`);
  for (const r of Object.keys(MR.READERS)) assert.ok(MD.REQUIRES[r], `reader ${r} declares what it needs in metricDeps.REQUIRES`);
});

test('integrity(): a published metric whose dependency nobody supplies is reported as "reader not wired"', () => {
  const reg = MR.createRegistry();
  const gaps = MD.integrity(reg, { provided: MD.PROVIDES.filter((k) => k !== 'programme') });
  assert.deepEqual(gaps.map((g) => g.key).sort(), ['programme.composite', 'programme.site_score']);
  for (const g of gaps) assert.match(g.problem, /^reader not wired: programme\.\w+ needs deps\.programme$/);
  reg.upsert({ key: 'fixture.orphan', name: 'x', module: 'x', unit: 'count', formula: 'x', window_kind: 'current', reader: 'no.such.reader', field: 'v', status: 'published' });
  assert.ok(MD.integrity(reg).some((g) => g.key === 'fixture.orphan' && /no reader named no\.such\.reader/.test(g.problem)));
});

test('boot: load() logs each published metric that cannot be computed', async () => {
  const logs = [];
  const pg = { prepare: (sql) => ({ all: async () => (sql.includes('metric_registry') ? [{ key: 'fixture.orphan', name: 'x', module: 'x', unit: 'count', formula: 'x', window_kind: 'current', rag_policy: null, reader: 'no.such.reader', owner_role: 'x', status: 'published' }] : []), run: async () => ({}) }) };
  await MR.load({ pg, log: (m) => logs.push(m) });
  assert.ok(logs.some((l) => /fixture\.orphan: reader not wired/.test(l)), logs.join('\n'));
  assert.ok(!logs.some((l) => /programme\.\w+: reader not wired/.test(l)), 'the programme pair is wired');
});

test('every published seed metric resolves through metricDeps.build() on the fixture database without "reader not wired"', async () => {
  const reg = MR.createRegistry();
  const deps = MD.build({ now: () => NOW });
  for (const m of reg.list({ status: 'published' })) {
    const out = await reg.resolve(m.key, { site: m.reader === 'tracker.fleet' ? null : site.site_id, deps, now: NOW });
    assert.ok(out, m.key);
    assert.doesNotMatch(String(out.error || ''), /reader not wired/, `${m.key}: ${out.error}`);
    assert.equal(out.error, undefined, `${m.key} resolves without a reader error (got: ${out.error})`);
    assert.ok(out.value === null || Number.isFinite(out.value), m.key);
  }
});

test('switch metric_programme_readers = 0 (default): the programme pair stays not computed — today\'s behaviour', async () => {
  assert.equal(require('../services/reportConfig').DEFAULTS.metric_programme_readers, '0');
  const reg = MR.createRegistry();
  const deps = MD.build({ now: () => NOW });   // reads report_config: nothing stored → default '0'
  for (const k of ['programme.site_score', 'programme.composite']) {
    const out = await reg.resolve(k, { site: site.site_id, deps, now: NOW });
    assert.equal(out.value, null, k); assert.equal(out.record, null, k); assert.equal(out.rag, 'NA', k); assert.equal(out.error, undefined, k);
  }
});

test('switch = 1: programme.site_score is the coordinator report\'s own score (same inputs, same model), flagged not certified', async () => {
  const reg = MR.createRegistry();
  const deps = MD.build({ cfg: { metric_programme_readers: '1' }, now: () => NOW });
  const out = await reg.resolve('programme.site_score', { site: site.site_id, window: '2026-08-20', deps, now: NOW });
  assert.equal(out.error, undefined);
  // oracle: the site report's deps + the author's model, called directly
  const srd = require('../services/siteReportDeps').buildSiteReportDeps({ meetingsDb: mdb, inspectionDb: require('../inspection-db'), reportsDb: rdb });
  const si = await srd.scoreInputs(site.code, { as_of: '2026-08-20' });
  const want = require('../services/siteScore').computeSiteScore(si.inputs, si.window, null);
  assert.equal(want.applicable, true, 'fixture sanity: one review in the window');
  assert.equal(out.value, want.score);
  assert.equal(out.record.points, want.points);
  assert.equal(out.record.certified, false);
  assert.deepEqual([out.record.window_from, out.record.window_to], [si.window.from, '2026-08-20']);
  // a window with nothing measured is "not applicable" → null, never the inverted-dims 33
  const empty = await reg.resolve('programme.site_score', { site: site.site_id, window: '2020-01-31', deps, now: NOW });
  assert.equal(empty.value, null);
  // a site with no meetings code is not measured
  assert.equal((await reg.resolve('programme.site_score', { site: 999999, window: '2026-08-20', deps, now: NOW })).value, null);
});

test('switch = 1: programme.composite is the operational scoreboard row of the site for the month (null when no dimension is measured)', async () => {
  const reg = MR.createRegistry();
  const deps = MD.build({ cfg: { metric_programme_readers: '1' }, now: () => NOW });
  const out = await reg.resolve('programme.composite', { site: site.site_id, window: '2026-07', deps, now: NOW });
  assert.equal(out.error, undefined);
  const sb = {
    listSiteModuleCodes: rdb.listSiteModuleCodes, getCalendarMonthlyHelpdesk: rdb.getCalendarMonthlyHelpdesk,
    getMeetingsInsights: (a) => mdb.insights(a), getInspectionAggregate: (a) => require('../inspection-db').aggregate(a),
    getEffortLeaderboard: require('../assets-db').getEffortLeaderboard,
  };
  const sd = await require('../services/scoreboardData').loadScoreboardData({ month: { year: 2026, m: 7 }, asOf: '2026-07-31', deps: sb });
  const row = require('../services/siteScoreboard').buildSiteScoreboard(sd.perSite, { prev: sd.prev }).rows.find((r) => r.code === site.code);
  assert.ok(row, 'fixture sanity: the site is on the scoreboard');
  assert.equal(out.value, row.applicable ? row.score : null);
  if (row.applicable) { assert.equal(out.record.coverage_present, row.coverage.present); assert.equal(out.record.certified, false); }
});

test('resolve() completes plain route-style deps itself; a stub without the modules says "reader not wired", never a silent null', async () => {
  const reg = MR.createRegistry();
  // what the six routes build today: no programme key
  const routeDeps = { rdb, mdb, idb: require('../inspection-db'), adb: require('../assets-db'), tracker: require('../tracker-db'), trackerScore: require('../tracker-pptx'), cfg: { metric_programme_readers: '1' }, now: () => NOW };
  const viaRoute = await reg.resolve('programme.site_score', { site: site.site_id, window: '2026-08-20', deps: routeDeps, now: NOW });
  assert.equal(viaRoute.error, undefined); assert.ok(Number.isFinite(viaRoute.value));
  assert.equal(routeDeps.programme, undefined, 'the caller\'s object is not mutated');
  assert.equal(MD.complete(routeDeps), MD.complete(routeDeps), 'completed once per deps object');
  const stub = { rdb: { getCalendarMonthlyHelpdesk: async () => null } };
  assert.equal(MD.complete(stub), stub, 'a stub is left as it is (no database module is required behind its back)');
  const out = await reg.resolve('programme.composite', { site: 1, deps: stub, now: NOW });
  assert.equal(out.value, null); assert.match(out.error, /reader not wired: programme\.composite needs deps\.programme/);
});
