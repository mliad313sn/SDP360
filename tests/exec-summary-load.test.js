'use strict';
// Mapper integration test (Task 5). Injects STUB rdb / trackerDb / trackerScore
// returning KNOWN raw shapes (mirroring the REAL reader return values observed
// in reports-db.js + tracker-pptx.js) and asserts loadExecSummary remaps them
// correctly into the final Executive View summary produced by buildExecSummary.
//
// TDD: this is written FIRST — it drives the mapper shapes. Run it and watch it
// FAIL (loadExecSummary/mappers don't exist yet), then implement until it PASSES.

const test = require('node:test');
const assert = require('node:assert');
const { loadExecSummary } = require('../services/execSummary');

// now = 2026-06-15 → period '2026-06', prev month '2026-05'
const NOW = new Date(2026, 5, 15, 8, 0, 0);

// ── STUB reports-db ────────────────────────────────────────────────────────
// Shapes mirror the real readers:
//  getMonthlyHelpdeskHistory → [{ 'Created Time','Requests','Closed Requests Count',
//                                 '% of SLA Violated','% of First Responses SLA Violated' }]
//  getSlaTrendDB             → [{ 'Created Date','% of SLA Violated',... , n }]
//  getRequestMetrics         → { open_count, incident_count, backlog_count, avg_resolution_hrs, ... }
//  getChangeMetrics          → { change_success_rate, ... }
//  getSurveyKpisDB           → { rows1:[{overall_score}], rows2:[{overall_score,responded_on}] }
//  getActiveMajorIncidentsForSite → [{ site, ... }]
//  listSites                 → [{ id, name, zoho_group }]
//  getUpcomingChanges        → [{ date, title, window, impact, scope }]
//  getExecEditorial          → { highlights:[], focus:[] }
//  getLastSyncAt             → ISO string
function makeRdb() {
  return {
    getLastSyncAt(job) { return job === 'requests' ? '2026-06-15T06:30:00Z' : null; },
    // Fleet-wide monthly helpdesk history — current month last, prev month before.
    getMonthlyHelpdeskHistory(monthsBack) {
      return [
        { 'Created Time': 'Apr 2026', 'Requests': 1000, 'Closed Requests Count': 900, '% of SLA Violated': 12, '% of First Responses SLA Violated': 10 },
        { 'Created Time': 'May 2026', 'Requests': 1100, 'Closed Requests Count': 1000, '% of SLA Violated': 11, '% of First Responses SLA Violated': 9 },
        { 'Created Time': 'Jun 2026', 'Requests': 1300, 'Closed Requests Count': 1200, '% of SLA Violated': 9,  '% of First Responses SLA Violated': 8 },
      ];
    },
    // 6-month violation trend → spark.sla = 100 - violated
    getSlaTrendDB(monthsBack) {
      return [
        { 'Created Date': 'Jan 2026', '% of SLA Violated': 15, n: 800 },
        { 'Created Date': 'Feb 2026', '% of SLA Violated': 14, n: 820 },
        { 'Created Date': 'Mar 2026', '% of SLA Violated': 13, n: 900 },
        { 'Created Date': 'Apr 2026', '% of SLA Violated': 12, n: 1000 },
        { 'Created Date': 'May 2026', '% of SLA Violated': 11, n: 1100 },
        { 'Created Date': 'Jun 2026', '% of SLA Violated': 9,  n: 1300 },
      ];
    },
    // avg resolution (hours). current-month call vs prev-month call
    getRequestMetrics(opts = {}) {
      // Per-site calls (opts.site set) drive site rows; fleet calls (no site) drive avg resolution.
      if (opts.site) {
        const bySite = {
          'Sabodala': { open_count: 5, incident_count: 5, backlog_count: 2, avg_resolution_hrs: 20 },
          'Mana':     { open_count: 1, incident_count: 1, backlog_count: 0, avg_resolution_hrs: 10 },
          'Houndé':   { open_count: 3, incident_count: 3, backlog_count: 0, avg_resolution_hrs: 12 },
        };
        return bySite[opts.site] || { open_count: 0, incident_count: 0, backlog_count: 0, avg_resolution_hrs: null };
      }
      // fleet-wide avg resolution: current period since = 2026-06-01, prev since = 2026-05-01
      if (opts.since === '2026-06-01') return { avg_resolution_hrs: 14 };
      if (opts.since === '2026-05-01') return { avg_resolution_hrs: 17 };
      return { avg_resolution_hrs: null };
    },
    getChangeMetrics(opts = {}) {
      // current period (since 2026-06-01) vs prev (since 2026-05-01)
      if (opts.since === '2026-06-01') return { change_success_rate: 96 };
      if (opts.since === '2026-05-01') return { change_success_rate: 95 };
      return { change_success_rate: null };
    },
    getSurveyKpisDB({ yr, mo } = {}) {
      // rows1 = current-period scores; rows2 = 12-mo trend with responded_on
      // current month (2026-06): 3 responses, 2 satisfied (>=80) → 67%
      // prev month    (2026-05): 4 responses, 3 satisfied        → 75%
      return {
        rows1: [{ overall_score: 90 }, { overall_score: 82 }, { overall_score: 40 }],
        rows2: [
          { overall_score: 70, responded_on: '2026-05-04' },
          { overall_score: 85, responded_on: '2026-05-10' },
          { overall_score: 88, responded_on: '2026-05-20' },
          { overall_score: 95, responded_on: '2026-05-25' },
          { overall_score: 90, responded_on: '2026-06-02' },
          { overall_score: 82, responded_on: '2026-06-09' },
          { overall_score: 40, responded_on: '2026-06-12' },
        ],
      };
    },
    getActiveMajorIncidentsForSite(groups) {
      // one active MI at Sabodala
      return [{ site: 'Sabodala', display_id: 'INC-1', status: 'Open' }];
    },
    listSites() {
      return [
        { id: 1, name: 'Sabodala', zoho_group: 'Sabodala IT Agents' },
        { id: 2, name: 'Mana',     zoho_group: 'Mana IT Agents' },
        { id: 3, name: 'Houndé',   zoho_group: 'Hounde IT Agents' },
      ];
    },
    getUpcomingChanges(days) {
      return [
        { date: '2026-06-20', title: 'Core switch firmware', window: '22:00–02:00', impact: 'High', scope: 'SGO' },
      ];
    },
    getExecEditorial(period) {
      assert.equal(period, '2026-06');
      return { highlights: ['Fibre link to Houndé live'], focus: [{ title: 'UPS refresh', subtitle: 'Power' }] };
    },
  };
}

// ── STUB tracker ────────────────────────────────────────────────────────────
const STUB_D = {
  activeSites: ['SGO', 'MGO'],
  sites: ['SGO', 'MGO'],
  year: 2026,
  currentMonth: 6,
  pillarWeights: { 'P1-Network Infrast': 0.30, 'P2-Business Partner': 0.35 },
};
function makeTrackerDb() { return { loadTracker() { return STUB_D; } }; }
function makeTrackerScore() {
  return {
    // fleetStats returns { avg (0-1 fraction), best, attainment }
    fleetStats(D, sites, yr, mo) { return { avg: 0.72, best: 'SGO', attainment: 0.6 }; },
    // ps2 returns a 0-1 fraction per pillar
    ps2(D, site, pillar, yr, mo) {
      const byPillar = { 'P1-Network Infrast': 0.82, 'P2-Business Partner': 0.60 };
      return byPillar[pillar] != null ? byPillar[pillar] : 0.5;
    },
    // ss/score present so mapStrategic can derive pillar names if it wants
    ss() { return { avg: 0.72, g: 0, a: 0, r: 0, active: 0, sc: [], pScores: {} }; },
    // gP-style pillar name source — provide the pillar list via score()'s activities-free stub
    score() { return []; },
  };
}

test('loadExecSummary: helpdesk KPIs remap (resolved + MoM delta_pct)', () => {
  const s = loadExecSummary({ rdb: makeRdb(), trackerDb: makeTrackerDb(), trackerScore: makeTrackerScore(), now: NOW });
  assert.equal(s.period, '2026-06');
  assert.equal(s.data_as_of, '2026-06-15T06:30:00Z');
  // resolved = current closed (1200); delta_pct vs prev (1000) = +20
  assert.equal(s.kpis.requests_resolved.value, 1200);
  assert.equal(s.kpis.requests_resolved.delta_pct, 20);
});

test('loadExecSummary: sla_compliance = 100 - %violated, delta_pp current-prev', () => {
  const s = loadExecSummary({ rdb: makeRdb(), trackerDb: makeTrackerDb(), trackerScore: makeTrackerScore(), now: NOW });
  // current violated 9 → 91; prev violated 11 → 89; delta +2pp
  assert.equal(s.kpis.sla_compliance.value_pct, 91);
  assert.equal(s.kpis.sla_compliance.delta_pp, 2);
});

test('loadExecSummary: avg_resolution_h value + delta_h (current - prev)', () => {
  const s = loadExecSummary({ rdb: makeRdb(), trackerDb: makeTrackerDb(), trackerScore: makeTrackerScore(), now: NOW });
  assert.equal(s.kpis.avg_resolution_h.value, 14);
  assert.equal(s.kpis.avg_resolution_h.delta_h, -3);   // 14 - 17
});

test('loadExecSummary: csat value_pct + delta_pp from survey scores', () => {
  const s = loadExecSummary({ rdb: makeRdb(), trackerDb: makeTrackerDb(), trackerScore: makeTrackerScore(), now: NOW });
  // current month rows1: 2 of 3 satisfied → 67
  assert.equal(s.kpis.csat.value_pct, 67);
  // prev month (2026-05 in rows2): 3 of 4 satisfied → 75 ; delta 67-75 = -8
  assert.equal(s.kpis.csat.delta_pp, -8);
});

test('loadExecSummary: change_success value_pct + delta_pp', () => {
  const s = loadExecSummary({ rdb: makeRdb(), trackerDb: makeTrackerDb(), trackerScore: makeTrackerScore(), now: NOW });
  assert.equal(s.kpis.change_success.value_pct, 96);
  assert.equal(s.kpis.change_success.delta_pp, 1);
});

test('loadExecSummary: spark arrays populated', () => {
  const s = loadExecSummary({ rdb: makeRdb(), trackerDb: makeTrackerDb(), trackerScore: makeTrackerScore(), now: NOW });
  assert.deepEqual(s.kpis.spark.sla, [85, 86, 87, 88, 89, 91]);   // 100 - violated
  assert.deepEqual(s.kpis.spark.csat, [75, 67]);                  // May 3/4=75, Jun 2/3=67 (byMonth csatPct)
});

test('loadExecSummary: site rows → attention (Sabodala major via active MI)', () => {
  const s = loadExecSummary({ rdb: makeRdb(), trackerDb: makeTrackerDb(), trackerScore: makeTrackerScore(), now: NOW });
  // Sabodala has active MI → major ; Houndé has overdue_open 0 → operational (excluded); Mana clean
  const codes = s.sites_attention.map(x => x.name);
  assert.ok(codes.includes('Sabodala'));
  const sgo = s.sites_attention.find(x => x.name === 'Sabodala');
  assert.equal(sgo.status, 'major');
  assert.equal(s.status.level, 'major');
  assert.equal(s.status.active_major_incidents, 1);
});

test('loadExecSummary: planned maintenance passthrough (5 whitelisted fields only)', () => {
  const s = loadExecSummary({ rdb: makeRdb(), trackerDb: makeTrackerDb(), trackerScore: makeTrackerScore(), now: NOW });
  assert.equal(s.planned_maintenance.length, 1);
  assert.deepEqual(Object.keys(s.planned_maintenance[0]).sort(), ['date', 'impact', 'scope', 'title', 'window']);
});

test('loadExecSummary: strategic_progress from faithful scorers (fraction → pct)', () => {
  const s = loadExecSummary({ rdb: makeRdb(), trackerDb: makeTrackerDb(), trackerScore: makeTrackerScore(), now: NOW });
  assert.equal(s.strategic_progress.overall_pct, 72);   // 0.72 → 72
  const net = s.strategic_progress.pillars.find(p => p.name === 'P1-Network Infrast');
  assert.ok(net);
  assert.equal(net.pct, 82);                              // ps2 0.82 → 82
});

test('loadExecSummary: editorial passthrough', () => {
  const s = loadExecSummary({ rdb: makeRdb(), trackerDb: makeTrackerDb(), trackerScore: makeTrackerScore(), now: NOW });
  assert.deepEqual(s.highlights, ['Fibre link to Houndé live']);
  assert.equal(s.focus_areas.length, 1);
});

test('loadExecSummary: ANTI-PII — no forbidden keys in the final JSON', () => {
  const s = loadExecSummary({ rdb: makeRdb(), trackerDb: makeTrackerDb(), trackerScore: makeTrackerScore(), now: NOW });
  const blob = JSON.stringify(s).toLowerCase();
  for (const bad of ['subject', 'requester', 'technician', 'request_id', 'udf', 'verbatim', 'email', 'overall_score']) {
    assert.ok(!blob.includes(bad), `must not contain "${bad}"`);
  }
});
