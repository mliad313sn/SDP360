'use strict';
// Step 3 — metric registry: seed integrity, window resolution, reader dispatch (stubs),
// RAG from registered policies only, null ≠ 0, DB load (fake pg handle).
const { test } = require('node:test');
const assert = require('node:assert');
const MR = require('../services/metricRegistry');
const KpiRag = require('../services/kpiRag');

test('seed: ≥ 40 published metrics, unique keys, every rag_policy registered, every reader wired', () => {
  assert.ok(MR.SEED.length >= 40, `seed has ${MR.SEED.length}`);
  assert.equal(new Set(MR.SEED.map((m) => m.key)).size, MR.SEED.length);
  for (const m of MR.SEED) {
    assert.ok(MR.WINDOW_KINDS.includes(m.window_kind), `${m.key} window ${m.window_kind}`);
    if (m.rag_policy) assert.ok(KpiRag.POLICIES[m.rag_policy], `${m.key} policy ${m.rag_policy}`);
    assert.equal(typeof MR.READERS[m.reader], 'function', `${m.key} reader ${m.reader}`);
    assert.ok(m.formula && m.name && m.name_fr && m.module && m.owner_role, `${m.key} incomplete`);
  }
});

test('resolveWindow: month / ytd / week (previous full week by default) / rolling3m / current', () => {
  const now = new Date('2026-10-19T10:00:00Z');
  assert.deepEqual(MR.resolveWindow('month', '2026-09', now), { kind: 'month', label: '2026-09', from: '2026-09-01', to: '2026-09-30', year: 2026, month: 9 });
  assert.equal(MR.resolveWindow('ytd', null, now).from, '2026-01-01');
  assert.deepEqual([MR.resolveWindow('week', null, now).from, MR.resolveWindow('week', null, now).to], ['2026-10-12', '2026-10-18']);
  assert.deepEqual([MR.resolveWindow('week', '2026-W40', now).from, MR.resolveWindow('week', '2026-W40', now).to], ['2026-09-28', '2026-10-04']);
  assert.equal(MR.resolveWindow('rolling3m', '2026-10-19', now).from, '2026-07-19');
  assert.equal(MR.resolveWindow('current', null, now).to, '2026-10-19');
});

test('resolve: dispatches to the reader, picks the field, colours from the policy, null stays null', async () => {
  const reg = MR.createRegistry();
  const deps = { rdb: { getCalendarMonthlyHelpdesk: async (site, y, m) => ({ inbound: 120, closed: 100, close_pct: 83.3, sla_res_pct: 92, sla_reply_pct: null }) } };
  const sla = await reg.resolve('helpdesk.resolution_sla_pct', { site: 7, window: '2026-09', deps });
  assert.equal(sla.value, 92); assert.equal(sla.rag, 'GREEN'); assert.equal(sla.window.label, '2026-09'); assert.equal(sla.site, 7);
  const fr = await reg.resolve('helpdesk.first_reply_sla_pct', { site: 7, window: '2026-09', deps });
  assert.equal(fr.value, null); assert.equal(fr.rag, 'NA');            // not measured ≠ 0
  const inb = await reg.resolve('helpdesk.inbound', { site: 7, window: '2026-09', deps });
  assert.equal(inb.value, 120); assert.equal(inb.rag, 'NA');            // no policy → no colour
  assert.equal(await reg.resolve('nope', { site: 7, deps }), null);
});

test('resolve: a reader that throws yields { value: null, error } — never a thrown 500', async () => {
  const reg = MR.createRegistry();
  const out = await reg.resolve('helpdesk.inbound', { site: 1, deps: { rdb: { getCalendarMonthlyHelpdesk: async () => { throw new Error('db down'); } } } });
  assert.equal(out.value, null); assert.match(out.error, /db down/);
});

test('resolve: tracker fleet / site through the stubbed scorer; site without tracker code → null record', async () => {
  const reg = MR.createRegistry();
  const deps = { tracker: { loadTracker: async () => ({ activeSites: ['HGO'] }) }, trackerScore: { fleetStats: () => ({ avg: 0.72, attainment: 0.6 }), ss: () => ({ active: 3, avg: 0.81, g: 2, a: 1, r: 0 }) }, codeFor: async (s) => (s === 1 ? { tracker_code: 'HGO' } : {}) };
  const f = await reg.resolve('tracker.fleet_score_pct', { deps }); assert.equal(f.value, 72); assert.equal(f.rag, 'GREEN');
  const s = await reg.resolve('tracker.site_score_pct', { site: 1, deps }); assert.equal(s.value, 81); assert.equal(s.record.g, 2);
  const none = await reg.resolve('tracker.site_score_pct', { site: 2, deps }); assert.equal(none.value, null);
});

test('load: DB policies override code, DB metric rows override the seed, missing seed rows are inserted', async () => {
  const before = { ...KpiRag.POLICIES['sla-percent'] };
  const inserted = [];
  const pg = { prepare: (sql) => ({
    all: async () => sql.includes('kpi_rag_policies') ? [{ name: 'sla-percent', scale: 'points', green: 95, amber: 80, source: 'DEC-2026-003' }] : [{ key: 'helpdesk.inbound', name: 'Inbound (committee wording)', module: 'helpdesk', unit: 'count', formula: 'x', window_kind: 'month', rag_policy: null, reader: 'helpdesk.calendar_month', owner_role: 'x', status: 'published' }],
    run: async (...a) => { inserted.push(a[0]); },
  }) };
  const reg = await MR.load({ pg });
  assert.equal(KpiRag.POLICIES['sla-percent'].green, 95);
  assert.equal(reg.get('helpdesk.inbound').name, 'Inbound (committee wording)');
  assert.ok(inserted.includes('helpdesk.closed') && !inserted.includes('helpdesk.inbound'));
  KpiRag.definePolicy('sla-percent', before); // restore for other tests
});

// F-DATA-02 — WAN metrics honour the window and the sub-site
const WAN_ROWS = [
  // Zoho weeks are Sunday-anchored: 2026-10-25..31 holds ISO Monday 2026-10-26; 2026-11-01..07 holds Monday 2026-11-02
  { site_id: 4, sub_site: '', uplink: 'wan1', period_type: 'week', period_start: '2026-11-01', period_end: '2026-11-07', availability_pct: 91.5, loss_pct: 4.2, latency_ms: 80 },
  { site_id: 4, sub_site: '', uplink: 'wan2', period_type: 'week', period_start: '2026-11-01', period_end: '2026-11-07', availability_pct: 99.1, loss_pct: 0.4, latency_ms: 35 },
  { site_id: 4, sub_site: '', uplink: 'wan1', period_type: 'week', period_start: '2026-10-25', period_end: '2026-10-31', availability_pct: 99.9, loss_pct: 0.1, latency_ms: 30 },
  { site_id: 4, sub_site: '', uplink: 'wan2', period_type: 'week', period_start: '2026-10-25', period_end: '2026-10-31', availability_pct: 97.0, loss_pct: 1.0, latency_ms: 40 },
  // Exploration sub-site circuits: newer AND different — must never stand in for the site-level link
  { site_id: 4, sub_site: 'FETEKRO', uplink: 'wan1', period_type: 'week', period_start: '2026-11-08', period_end: '2026-11-14', availability_pct: 12.0, loss_pct: 60, latency_ms: 900 },
  { site_id: 4, sub_site: 'FETEKRO', uplink: 'wan1', period_type: 'week', period_start: '2026-11-01', period_end: '2026-11-07', availability_pct: 15.0, loss_pct: 55, latency_ms: 800 },
  { site_id: 4, sub_site: 'TANDA', uplink: 'wan2', period_type: 'week', period_start: '2026-10-25', period_end: '2026-10-31', availability_pct: 20.0, loss_pct: 50, latency_ms: 700 },
];
const wanDeps = (rows = WAN_ROWS) => ({ rdb: { getWanSnapshots: async (f) => rows.filter((r) => r.site_id === f.site_id && r.period_type === f.period_type) } });

test('F-DATA-02 WAN: two weeks of snapshots → two different values; a week without a snapshot is null', async () => {
  const reg = MR.createRegistry(); const now = new Date('2026-11-12T10:00:00Z'); const deps = wanDeps();
  const w45 = await reg.resolve('wan.wan1_availability_pct', { site: 4, window: '2026-W45', deps, now });   // Mon 2026-11-02
  const w44 = await reg.resolve('wan.wan1_availability_pct', { site: 4, window: '2026-W44', deps, now });   // Mon 2026-10-26
  assert.equal(w45.window.from, '2026-11-02'); assert.equal(w45.value, 91.5); assert.equal(w45.record.period_start, '2026-11-01');
  assert.equal(w44.window.from, '2026-10-26'); assert.equal(w44.value, 99.9); assert.equal(w44.record.period_start, '2026-10-25');
  assert.notEqual(w45.value, w44.value, 'a trend is not the latest week repeated');
  assert.equal((await reg.resolve('wan.wan2_availability_pct', { site: 4, window: '2026-W44', deps, now })).value, 97.0);
  assert.equal((await reg.resolve('wan.wan1_loss_pct', { site: 4, window: '2026-10-28', deps, now })).value, 0.1, 'a date inside the week works too');
  const w43 = await reg.resolve('wan.wan1_availability_pct', { site: 4, window: '2026-W43', deps, now });
  assert.equal(w43.value, null, 'no snapshot for that week → not measured, never another week');
  assert.equal(w43.record, null); assert.equal(w43.rag, 'NA');
});

test('F-DATA-02 WAN: sub-site rows are ignored (site-level metric), with or without a window', async () => {
  const reg = MR.createRegistry(); const now = new Date('2026-11-12T10:00:00Z');
  const cur = await reg.resolve('wan.wan1_availability_pct', { site: 4, deps: wanDeps(), now });
  assert.equal(cur.value, 91.5, 'no window: latest SITE-level snapshot, not the newer FETEKRO row (12.0)');
  assert.equal(cur.record.period_start, '2026-11-01', 'the record says which week was read');
  assert.equal((await reg.resolve('wan.wan1_latency_ms', { site: 4, window: '2026-W45', deps: wanDeps(), now })).value, 80, 'not FETEKRO 800');
  // a site that only has sub-site circuits has no site-level WAN figure
  const onlySub = wanDeps(WAN_ROWS.filter((r) => r.sub_site !== ''));
  assert.equal((await reg.resolve('wan.wan1_availability_pct', { site: 4, deps: onlySub, now })).value, null);
  assert.equal((await reg.resolve('wan.wan2_availability_pct', { site: 4, window: '2026-W44', deps: onlySub, now })).value, null);
});

test('F-DATA-02 WAN: a snapshot keyed on the ISO Monday or without period_end still matches its week; null stays null', async () => {
  const reg = MR.createRegistry(); const now = new Date('2026-11-12T10:00:00Z');
  const deps = wanDeps([
    { site_id: 9, sub_site: null, uplink: 'wan1', period_type: 'week', period_start: '2026-11-02', availability_pct: null, loss_pct: 2, latency_ms: 50 },
  ]);
  const a = await reg.resolve('wan.wan1_availability_pct', { site: 9, window: '2026-W45', deps, now });
  assert.equal(a.value, null, 'zero samples = not measured, never 0'); assert.equal(a.record.wan1_loss_pct, 2);
  assert.equal((await reg.resolve('wan.wan1_loss_pct', { site: 9, window: '2026-W46', deps, now })).value, null);
});
