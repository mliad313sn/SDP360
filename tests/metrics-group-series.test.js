'use strict';
// Step 6 (lot 6.2) — group figures, series, RAG and freshness on injected readers.
const test = require('node:test');
const assert = require('node:assert');
const D = require('../services/metrics/dispatch');
const { freshness, domainOf } = require('../services/metrics/freshness');
const registry = require('../services/metrics/registry');
const { csatFromScores } = require('../services/metrics/formulas');

// Two sites deliberately unequal: a mean of their percentages would say 70 %, the truth is 92 %.
const A = { site_id: 1, code: 'AAA' }, B = { site_id: 2, code: 'BBB' }, X = { site_id: 3, code: null };
const month = { from: '2026-09-01', to: '2026-09-30', year: 2026, month: 9 };
const deps = {
  getCalendarMonthlyHelpdesk: async (id) => ({
    1: { inbound: 300, closed: 200, sla_res_ok: 190, sla_reply_ok: 280, sla_reply_total: 290, sla_res_pct: 95 },
    2: { inbound: 10, closed: 10, sla_res_ok: 4, sla_reply_ok: 5, sla_reply_total: 10, sla_res_pct: 40 },
    3: null }[id]),
  getSiteHelpdeskWindow: async (id, from) => (id === 1
    ? { created: from === '2026-09-07' ? 40 : 30, resolved: 20, sla_res_ok: 18, sla_res_pct: 90, backlog: 5, sla_overdue: 2, major_incidents: 1 }
    : { created: 2, resolved: 2, sla_res_ok: 0, sla_res_pct: 0, backlog: 0, sla_overdue: 2, major_incidents: 0 }),
  getSiteChangesWindow: async (id) => ({ 1: { total: 9, successful: 8, executed: 8 }, 2: { total: 1, successful: 0, executed: 2 }, 3: { total: 0, successful: 0, executed: 0 } }[id]),
  getSiteMonthlyMeetingSummary: async (code) => ({ kpis: { pvs_held: code === 'AAA' ? 3 : 1 } }),
  getInspectionAggregate: async ({ site }) => ({ counts: { total: 1 }, findingStatus: site === 'AAA' ? [{ status: 'ok', n: 9 }, { status: 'major', n: 1 }] : [{ status: 'ok', n: 0 }, { status: 'na', n: 4 }] }),
  getEffortLeaderboard: async () => [], effortForSite: (code) => ({ score: code === 'AAA' ? 80 : 60 }),
  getSiteGroups: async (id) => (id === 3 ? [] : ['G' + id]),
  getSurveyKpisDB: async ({ groups }) => ({ rows1: groups[0] === 'G1' ? [{ overall_score: 100 }, { overall_score: 80 }, { overall_score: 40 }] : [{ overall_score: 90 }] }),
  meetingsInsights: async ({ site }) => ({ site_leaderboard: [{ site, score: site === 'AAA' ? 0.9 : null }] }),
  getWanSnapshots: async ({ site_id, period_type }) => (site_id === 1 ? [
    { period_type, period_start: '2026-09-01', availability_pct: 99 }, { period_type, period_start: '2026-09-01', availability_pct: 97 },
    { period_type, period_start: '2026-09-06', availability_pct: 95 },
  ] : site_id === 2 ? [{ period_type, period_start: '2026-09-01', availability_pct: 92 }] : []),
};
const G = (key, w = month) => D.computeGroupMetric(key, { sites: [A, B, X], window: w, targets: { wan: 98 } }, deps);

test('group SLA = Σ on-time ÷ Σ closed, never a mean of site percentages', async () => {
  const r = await G('helpdesk.sla_res_pct');
  assert.strictEqual(r.value, 92);                       // (190+4)/(200+10)
  assert.strictEqual(r.scope, 'group');
  assert.strictEqual(r.sites, 3);
  assert.strictEqual(r.measured_sites, 2, 'a site with no support group is not measured');
  assert.match(r.group_rule, /numerators/);
  assert.strictEqual((await G('helpdesk.sla_reply_pct')).value, 95);   // 285/300
  assert.strictEqual((await G('helpdesk.inbound')).value, 310);
  assert.strictEqual((await G('changes.success_pct')).value, 80);     // 8/10, not mean(100, 0)
  assert.strictEqual((await G('meetings.pvs_held')).value, 4);
  assert.strictEqual((await G('inspections.conformity_pct')).value, 90, 'N/A excluded, findings summed');
  assert.strictEqual((await G('assets.effort_score')).value, 70);
});

test('newly served figures: satisfaction, engagements, WAN', async () => {
  const site = await D.computeMetric('helpdesk.csat_pct', { site: A, window: month }, deps);
  assert.strictEqual(site.value, 67);                                       // 2 of 3 ≥ 80
  assert.strictEqual((await G('helpdesk.csat_pct')).value, 75, 'Σ satisfied ÷ Σ rated (3 of 4)');
  const eng = await D.computeMetric('meetings.engagements_score', { site: A, window: month }, deps);
  assert.strictEqual(eng.value, 90);
  assert.strictEqual(eng.rag, 'green', '90 % on a 0-1 policy is scaled before colouring');
  assert.strictEqual((await G('meetings.engagements_score')).value, 90, 'unmeasured site left out of the mean');
  const wan = await G('infra.wan_timeup_pct');
  assert.strictEqual(wan.value, 96, 'mean of every measured uplink: 99, 97, 92');
  assert.strictEqual(wan.rag, 'amber', 'availability_target 98 × 0.9');
  assert.strictEqual(csatFromScores([null, 'x', 85]).n, 1, 'unscored rows ignored');
});

test('the site path keeps its contract (null stays null)', async () => {
  const empty = { ...deps, getCalendarMonthlyHelpdesk: async () => ({ inbound: 3, closed: 0, sla_res_pct: null }) };
  const r = await D.computeMetric('helpdesk.sla_res_pct', { site: A, window: month }, empty);
  assert.strictEqual(r.value, null); assert.strictEqual(r.rag, null); assert.strictEqual(r.measured, false);
  assert.strictEqual((await D.computeMetric('score.programme', { site: A, window: month }, deps)).status, 422);
});

test('series windows: 13 Monday weeks ending with the week of asOf; months', () => {
  const w = D.seriesWindows('week', 13, '2026-10-22');
  assert.strictEqual(w.length, 13);
  assert.deepStrictEqual([w[12].from, w[12].to, w[12].partial], ['2026-10-19', '2026-10-25', true]);
  assert.strictEqual(w[0].from, '2026-07-27');
  assert.strictEqual(w[12].label, 'W43');
  const m = D.seriesWindows('month', 3, '2026-01-15');
  assert.deepStrictEqual(m.map(x => x.label), ['2025-11', '2025-12', '2026-01']);
});

test('series: weekly helpdesk via the window twin, group and site; monthly-only figures refuse a week', async () => {
  const s = await D.computeSeries('helpdesk.inbound', { scope: 'group', sites: [A, B], grain: 'week', points: 3, asOf: '2026-09-09' }, deps);
  assert.strictEqual(s.status, 200);
  assert.deepStrictEqual(s.points.map(p => p.value), [32, 32, 42]);   // weeks of 24 Aug, 31 Aug, 7 Sept
  const sla = await D.computeSeries('helpdesk.sla_res_pct', { scope: 'site', site: A, grain: 'week', points: 2, asOf: '2026-09-09' }, deps);
  assert.deepStrictEqual(sla.points.map(p => p.value), [90, 90]);
  assert.strictEqual(sla.points[1].rag, 'green');
  assert.strictEqual((await D.computeSeries('helpdesk.sla_reply_pct', { scope: 'site', site: A, grain: 'week', points: 2, asOf: '2026-09-09' }, deps)).status, 422);
  assert.strictEqual((await D.computeSeries('helpdesk.sla_reply_pct', { scope: 'site', site: A, grain: 'month', points: 2, asOf: '2026-09-09' }, deps)).status, 200);
  const wan = await D.computeSeries('infra.wan_timeup_pct', { scope: 'site', site: A, grain: 'week', points: 1, asOf: '2026-09-09', targets: { wan: 98 } }, deps);
  assert.strictEqual(wan.points[0].value, 95, 'the Meraki week starting Sunday 6 Sept covers the Monday 7 Sept window');
});

test('freshness: ok / late / down / live, and the domain of a figure', () => {
  const now = new Date('2026-10-22T12:00:00Z');
  const f = freshness([
    { job_key: 'zoho.requests', last_ok_at: '2026-10-22T11:00:00Z' },
    { job_key: 'meraki.wan', last_ok_at: '2026-10-21T00:00:00Z' },
  ], now);
  assert.strictEqual(f.helpdesk.status, 'ok'); assert.strictEqual(f.helpdesk.age_minutes, 60);
  assert.strictEqual(f.infra.status, 'late');
  assert.strictEqual(f.changes.status, 'down');
  assert.strictEqual(f.meetings.status, 'live');
  assert.strictEqual(domainOf(registry.get('helpdesk.csat_pct')), 'survey');
  assert.strictEqual(domainOf(registry.get('infra.wan_timeup_pct')), 'infra');
});

test('every served figure has a group rule', () => {
  for (const m of registry.list().filter(x => x.serve)) assert.ok(D.GROUP_RULE[m.serve], `${m.key}: no group rule for ${m.serve}`);
});
