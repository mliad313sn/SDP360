'use strict';
// Mapper integration test. Injects STUB rdb / trackerDb / trackerScore returning
// KNOWN raw shapes (mirroring the REAL reader returns in reports-db.js +
// tracker-pptx.js) and asserts loadExecSummary remaps them into the final
// Executive View summary.
//
// v1.1 (2026-07-02): KPIs anchor to the LAST COMPLETE month (not the current
// partial one). With now = 2026-06-15, the "report month" is MAY 2026 and the
// MoM comparison is May-vs-April. Site panel + status band are MAJOR-INCIDENT-
// centric, and a whitelisted major_incidents[] detail block is included.

const test = require('node:test');
const assert = require('node:assert');
const { loadExecSummary } = require('../services/execSummary');

// now = 2026-06-15 → period '2026-06', report month (last complete) '2026-05'.
const NOW = new Date(2026, 5, 15, 8, 0, 0);

function makeRdb() {
  return {
    getLastSyncAt(job) { return job === 'requests' ? '2026-06-15T06:30:00Z' : null; },
    // oldest→newest; LAST row = current (partial) month, so report month = [len-2].
    getMonthlyHelpdeskHistory() {
      return [
        { 'Created Time': 'Apr 2026', 'Requests': 1100, 'Closed Requests Count': 1000, '% of SLA Violated': 11 },
        { 'Created Time': 'May 2026', 'Requests': 1300, 'Closed Requests Count': 1200, '% of SLA Violated': 9 },   // report month
        { 'Created Time': 'Jun 2026', 'Requests': 40,   'Closed Requests Count': 30,   '% of SLA Violated': 3 },   // current partial (ignored)
      ];
    },
    getSlaTrendDB() {
      return [
        { 'Created Date': 'Jan 2026', '% of SLA Violated': 15, n: 800 },
        { 'Created Date': 'Feb 2026', '% of SLA Violated': 14, n: 820 },
        { 'Created Date': 'Mar 2026', '% of SLA Violated': 13, n: 900 },
        { 'Created Date': 'Apr 2026', '% of SLA Violated': 12, n: 1000 },
        { 'Created Date': 'May 2026', '% of SLA Violated': 11, n: 1100 },
        { 'Created Date': 'Jun 2026', '% of SLA Violated': 9,  n: 1300 },
      ];
    },
    // fleet avg-resolution: report month since=2026-05-01, prior since=2026-04-01.
    getRequestMetrics(opts = {}) {
      if (opts.since === '2026-05-01') return { avg_resolution_hrs: 14 };
      if (opts.since === '2026-04-01') return { avg_resolution_hrs: 17 };
      return { avg_resolution_hrs: null };
    },
    getChangeMetrics(opts = {}) {
      if (opts.since === '2026-05-01') return { change_success_rate: 96 };
      if (opts.since === '2026-04-01') return { change_success_rate: 95 };
      return { change_success_rate: null };
    },
    getSurveyKpisDB() {
      // rows1 = report-month (May) scores → 2/3 satisfied = 67%.
      // rows2 = trend window incl. April (prev, for the delta) + May + June.
      return {
        rows1: [{ overall_score: 90 }, { overall_score: 82 }, { overall_score: 40 }],
        rows2: [
          { overall_score: 85, responded_on: '2026-04-04' },
          { overall_score: 88, responded_on: '2026-04-10' },
          { overall_score: 95, responded_on: '2026-04-20' },
          { overall_score: 70, responded_on: '2026-04-25' },   // Apr: 3/4 = 75%
          { overall_score: 88, responded_on: '2026-05-02' },
          { overall_score: 95, responded_on: '2026-05-09' },   // May: 2/2 = 100%
          { overall_score: 90, responded_on: '2026-06-02' },
          { overall_score: 40, responded_on: '2026-06-12' },   // Jun: 1/2 = 50%
        ],
      };
    },
    // Active MI reader output shape (curated rows from _mapActiveMajorIncidentRows):
    // rich with personal fields that mapMajorIncidents MUST drop.
    getActiveMajorIncidentsForSite() {
      return [{
        request_id: 'REQ-9', display_id: 'INC-1', site: 'Sabodala',
        status: 'On Hold', overdue: true, technician: 'Bob', requester: 'Alice',
        subject: 'Fibre cut - Sabodala internet down', impact: 'Enterprise',
        rca: 'Backhoe severed the trunk line', ca: 'Rerouted via satellite link', downtime: '6',
      }];
    },
    listSites() {
      return [
        { id: 1, name: 'Sabodala', zoho_group: 'Sabodala IT Agents' },
        { id: 2, name: 'Mana',     zoho_group: 'Mana IT Agents' },
        { id: 3, name: 'Houndé',   zoho_group: 'Hounde IT Agents' },
      ];
    },
    getUpcomingChanges() {
      return [{ date: '2026-06-20', title: 'Core switch firmware', window: '22:00–02:00', impact: 'High', scope: 'SGO' }];
    },
    getExecEditorial(period) {
      assert.equal(period, '2026-06');
      return { highlights: ['Fibre link to Houndé live'], focus: [{ title: 'UPS refresh', subtitle: 'Power' }] };
    },
  };
}

const STUB_D = { activeSites: ['SGO', 'MGO'], sites: ['SGO', 'MGO'], year: 2026, currentMonth: 6,
  pillarWeights: { 'P1-Network Infrast': 0.30, 'P2-Business Partner': 0.35 } };
function makeTrackerDb() { return { loadTracker() { return STUB_D; } }; }
function makeTrackerScore() {
  return {
    fleetStats() { return { avg: 0.72, best: 'SGO', attainment: 0.6 }; },
    ps2(D, site, pillar) { const p = { 'P1-Network Infrast': 0.82, 'P2-Business Partner': 0.60 }; return p[pillar] != null ? p[pillar] : 0.5; },
    ss() { return { avg: 0.72 }; },
    score() { return []; },
  };
}
const deps = () => ({ rdb: makeRdb(), trackerDb: makeTrackerDb(), trackerScore: makeTrackerScore(), now: NOW });

test('loadExecSummary: report_month = last complete month (May for a mid-June now)', async () => {
  const s = await loadExecSummary(deps());
  assert.equal(s.period, '2026-06');
  assert.equal(s.report_month, '2026-05');
  assert.equal(s.data_as_of, '2026-06-15T06:30:00Z');
});

test('loadExecSummary: resolved + MoM delta reflect the report month (May vs Apr)', async () => {
  const s = await loadExecSummary(deps());
  assert.equal(s.kpis.requests_resolved.value, 1200);         // May closed
  assert.equal(s.kpis.requests_resolved.delta_pct, 20);       // (1200-1000)/1000
});

test('loadExecSummary: sla_compliance = 100 - %violated (May 91, delta vs Apr +2pp)', async () => {
  const s = await loadExecSummary(deps());
  assert.equal(s.kpis.sla_compliance.value_pct, 91);          // 100 - 9
  assert.equal(s.kpis.sla_compliance.delta_pp, 2);            // 91 - 89
});

test('loadExecSummary: avg_resolution_h (May 14, delta -3 vs Apr 17)', async () => {
  const s = await loadExecSummary(deps());
  assert.equal(s.kpis.avg_resolution_h.value, 14);
  assert.equal(s.kpis.avg_resolution_h.delta_h, -3);
});

test('loadExecSummary: csat (May 67 from rows1, delta -8 vs Apr 75)', async () => {
  const s = await loadExecSummary(deps());
  assert.equal(s.kpis.csat.value_pct, 67);
  assert.equal(s.kpis.csat.delta_pp, -8);
});

test('loadExecSummary: change_success (May 96, delta +1 vs Apr 95)', async () => {
  const s = await loadExecSummary(deps());
  assert.equal(s.kpis.change_success.value_pct, 96);
  assert.equal(s.kpis.change_success.delta_pp, 1);
});

test('loadExecSummary: spark arrays populated', async () => {
  const s = await loadExecSummary(deps());
  assert.deepEqual(s.kpis.spark.sla, [85, 86, 87, 88, 89, 91]);
  assert.deepEqual(s.kpis.spark.csat, [75, 100, 50]);         // Apr/May/Jun monthly CSAT
});

test('loadExecSummary: MAJOR-INCIDENT-centric site panel (only MI sites, count = # MIs)', async () => {
  const s = await loadExecSummary(deps());
  assert.equal(s.sites_attention.length, 1);                 // only Sabodala (has the MI)
  const sgo = s.sites_attention[0];
  assert.equal(sgo.name, 'Sabodala');
  assert.equal(sgo.status, 'major');
  assert.equal(sgo.open_incidents, 1);                        // = active MIs at the site (NOT raw ticket volume)
  assert.equal(s.status.level, 'major');
  assert.equal(s.status.active_major_incidents, 1);
});

test('loadExecSummary: major_incidents detail block is whitelisted (no personal fields)', async () => {
  const s = await loadExecSummary(deps());
  assert.equal(s.major_incidents.length, 1);
  const mi = s.major_incidents[0];
  assert.equal(mi.title, 'Fibre cut - Sabodala internet down');
  assert.equal(mi.site, 'Sabodala');
  assert.equal(mi.status, 'On Hold');
  assert.equal(mi.impact, 'Enterprise');
  assert.equal(mi.root_cause, 'Backhoe severed the trunk line');
  assert.equal(mi.corrective_action, 'Rerouted via satellite link');
  assert.equal(mi.downtime_h, '6');
  // personal / internal fields dropped
  assert.deepEqual(Object.keys(mi).sort(),
    ['corrective_action', 'downtime_h', 'impact', 'root_cause', 'site', 'status', 'title']);
});

test('loadExecSummary: planned maintenance passthrough (5 whitelisted fields only)', async () => {
  const s = await loadExecSummary(deps());
  assert.equal(s.planned_maintenance.length, 1);
  assert.deepEqual(Object.keys(s.planned_maintenance[0]).sort(), ['date', 'impact', 'scope', 'title', 'window']);
});

test('loadExecSummary: strategic_progress from faithful scorers (fraction → pct)', async () => {
  const s = await loadExecSummary(deps());
  assert.equal(s.strategic_progress.overall_pct, 72);
  const net = s.strategic_progress.pillars.find(p => p.name === 'P1-Network Infrast');
  assert.ok(net);
  assert.equal(net.pct, 82);
});

test('loadExecSummary: editorial passthrough', async () => {
  const s = await loadExecSummary(deps());
  assert.deepEqual(s.highlights, ['Fibre link to Houndé live']);
  assert.equal(s.focus_areas.length, 1);
});

test('loadExecSummary: ANTI-PII — no PERSONAL/internal identifiers in the final JSON', async () => {
  const s = await loadExecSummary(deps());
  const blob = JSON.stringify(s).toLowerCase();
  // MI operational detail (title/root_cause/corrective_action) is intentionally
  // public per the 2026-07-02 decision; PERSONAL + internal identifiers are not.
  for (const bad of ['requester', 'technician', 'verbatim', '"email"', 'request_id', 'display_id', 'overall_score', 'udf', '"rca"', '"subject"']) {
    assert.ok(!blob.includes(bad), `must not contain "${bad}"`);
  }
});
