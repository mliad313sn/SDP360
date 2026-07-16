'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { siteReportData } = require('../services/siteReport');

const WIN = { from: '2026-04-14', to: '2026-07-14' };

const deps = {
  meetingsSummary: async () => ({
    site_code: 'HGO', month_label: 'July 2026', available: true,
    kpis: { pvs_held: 2, pvs_target: 3, open_issues: 4, high_open: 1, resolved: 6, new: 3, escalations: 1, signoff_pct: 80, overdue_actions_count: 2 },
    departments: [{ department: 'Maintenance', status: 'on_track', last_pv: '2026-07-05' }],
  }),
  meetingsActions: async () => [{ description: 'Fix X', owner: 'Jean', target_date: '2026-07-20' }],
  // adapted shape (siteReportAdapters.adaptInspectionAggregate), period-scoped
  inspectionAggregate: async (code, period) => ({ inspections_done: 1, findings_critical_major: 0, overall_risk: 'low' }),
  inspectionActions: async () => [{ description: 'Replace UPS', owner: 'Sam', due_date: '2026-07-30' }],
  helpdesk: async () => ({ created: 40, resolved: 35, backlog: 5, sla_overdue: 2, major_incidents: 1, top_categories: [{ category: 'Network', count: 12 }], recurring: [] }),
  // Task 1's changes contract VERBATIM (reports-db._computeSiteChanges): _tallyChanges'
  // output + total/emergency/success_pct. `failed` ALREADY includes backed_out — the
  // raw counts survive only under `buckets`. There is no completed/open pair.
  changes: async () => ({ buckets: { success: 3, backed_out: 1 }, successful: 3, failed: 1, cancelled: 0,
                          deferred: 0, pending: 2, executed: 4, total: 6, emergency: 1, success_pct: 75 }),
  // Major incidents OPEN RIGHT NOW — a different population from
  // helpdesk.major_incidents (created in the report month).
  majorIncidents: async () => [{ display_id: '311587', subject: 'WAN down', status: 'In Progress', overdue: true, created_time: '2026-07-02T08:00:00.000Z', downtime: '4h' }],
  technicians: async () => [{ name: 'Tech A', assigned: 20, resolved: 18, avg_resolution_h: 6, reopened: 1, current_load: 4 }],
  siteStatus: () => 'degraded',
  // The score comes from its OWN 3-month-rolling reader now — NOT derived from
  // the meetings/inspection blocks above (which stay monthly narrative content).
  // 8→2 · 50→2 · 2→1 · 3→2 · 0→2 · 80→2 = 11/12 → 92, GREEN.
  scoreInputs: async () => ({ window: { ...WIN }, inputs: { reviews: 8, resolution: 50, overdue: 2, inspections: 3, findings: 0, signoff: 80 } }),
  prevScore: async () => 58,
};

test('assembles all six blocks + fm view', async () => {
  const r = await siteReportData('HGO', { year: 2026, month: 7, kind: 'weekly' }, deps);
  assert.strictEqual(r.site_code, 'HGO');
  assert.strictEqual(r.score.score, 92);
  assert.strictEqual(r.score.points, 11);
  assert.strictEqual(r.score.rag, 'GREEN');            // UPPERCASE — the sbDims contract
  assert.strictEqual(r.score.trend_pts, 34);           // 92 − 58
  assert.strictEqual(r.score.dims.length, 6);
  assert.strictEqual(r.score.moves.length, 2);
  assert.deepStrictEqual(r.score.window, WIN);         // the score states its own window
  assert.strictEqual(r.meetings.pvs_held, 2);
  assert.strictEqual(r.inspection.inspections_done, 1);
  assert.strictEqual(r.helpdesk.created, 40);
  assert.strictEqual(r.technicians.length, 1);
  assert.ok(Array.isArray(r.recommended));
  assert.strictEqual(r.fm.site_status, 'degraded');
  assert.strictEqual(r.fm.major_incidents, 1);
});

test('dims carry the raw value, its display string and a 0/1/2 rating', async () => {
  const r = await siteReportData('HGO', { year: 2026, month: 7, kind: 'weekly' }, deps);
  const byKey = Object.fromEntries(r.score.dims.map(d => [d.key, d]));
  assert.deepStrictEqual(Object.keys(byKey), ['reviews', 'resolution', 'overdue', 'inspections', 'findings', 'signoff']);
  assert.strictEqual(byKey.resolution.val, 50);
  assert.strictEqual(byKey.resolution.disp, '50%');
  assert.strictEqual(byKey.overdue.pts, 1);
  assert.ok(byKey.overdue.tip);
});

// THE contract change: the score is no longer derived from the monthly
// meetings/inspection blocks. Zeroing those must not move it.
test('the score comes from scoreInputs, not from the meetings/inspection blocks', async () => {
  const barren = { ...deps,
    meetingsSummary: async () => ({ site_code: 'HGO', month_label: 'July 2026', kpis: {}, departments: [] }),
    inspectionAggregate: async () => ({ inspections_done: 0, findings_critical_major: 0, overall_risk: '—' }),
  };
  const r = await siteReportData('HGO', { year: 2026, month: 7, kind: 'weekly' }, barren);
  assert.strictEqual(r.score.score, 92);
  assert.strictEqual(r.meetings.pvs_held, 0);
});

test('no previous window → trend_pts null, not a fabricated 0', async () => {
  const r = await siteReportData('HGO', { year: 2026, month: 7, kind: 'weekly' }, { ...deps, prevScore: async () => null });
  assert.strictEqual(r.score.trend_pts, null);
});

test('a failing reader degrades to an empty block, not a throw', async () => {
  const broken = { ...deps, helpdesk: async () => { throw new Error('db down'); },
                   majorIncidents: async () => [] };
  const r = await siteReportData('HGO', { year: 2026, month: 7, kind: 'weekly' }, broken);
  assert.deepStrictEqual(r.helpdesk, { created: 0, resolved: 0, backlog: 0, sla_overdue: 0, major_incidents: 0, top_categories: [], recurring: [], major_incidents_open: [] });
  assert.ok(r.score);
});

// Each reader degrades on its own: the open-MI list is a SEPARATE dep, so a dead
// helpdesk reader must not silently blank incidents that are genuinely running.
test('readers degrade independently — a dead helpdesk reader keeps the open MIs', async () => {
  const broken = { ...deps, helpdesk: async () => { throw new Error('db down'); } };
  const r = await siteReportData('HGO', { year: 2026, month: 7, kind: 'weekly' }, broken);
  assert.strictEqual(r.helpdesk.created, 0);
  assert.strictEqual(r.helpdesk.major_incidents_open.length, 1);
});

// ── the changes block ────────────────────────────────────────────────────────
test('assembles the changes block on Task 1\'s contract', async () => {
  const r = await siteReportData('HGO', { year: 2026, month: 7, kind: 'weekly' }, deps);
  assert.strictEqual(r.changes.total, 6);
  assert.strictEqual(r.changes.successful, 3);
  assert.strictEqual(r.changes.failed, 1);            // already includes backed_out
  assert.strictEqual(r.changes.pending, 2);
  assert.strictEqual(r.changes.executed, 4);
  assert.strictEqual(r.changes.emergency, 1);
  assert.strictEqual(r.changes.success_pct, 75);
  assert.strictEqual(r.changes.buckets.backed_out, 1);   // the raw count survives
  assert.ok(!('completed' in r.changes), 'no invented completed/open pair');
});

// THE test this block exists for. The house idiom one layer up is `x || 0`, and
// `null || 0` is 0 — so a site with nothing to judge would print "0%" in the
// coordinator email. Every '—' guard in the renderers is powerless against that,
// because the null is destroyed HERE. A template-level test would stay green.
test('success_pct null survives siteReportData — never coerced to 0', async () => {
  const nothingExecuted = { ...deps,
    changes: async () => ({ buckets: { pending: 1 }, successful: 0, failed: 0, cancelled: 0, deferred: 0,
                            pending: 1, executed: 0, total: 1, emergency: 0, success_pct: null }) };
  const r = await siteReportData('HGO', { year: 2026, month: 7, kind: 'weekly' }, nothingExecuted);
  assert.strictEqual(r.changes.success_pct, null, '"nothing to judge" is not "0% success"');
  assert.strictEqual(r.changes.total, 1);
});

test('a failing changes reader degrades to counts-zero + verdict NULL', async () => {
  const broken = { ...deps, changes: async () => { throw new Error('db down'); } };
  const r = await siteReportData('HGO', { year: 2026, month: 7, kind: 'weekly' }, broken);
  assert.strictEqual(r.changes.total, 0);
  assert.strictEqual(r.changes.executed, 0);
  assert.strictEqual(r.changes.success_pct, null, 'a failed reader has judged nothing');
  assert.deepStrictEqual(r.changes.buckets, {});
});

// A deps object built before this block existed (no `changes` key at all) must
// degrade the same way rather than throwing the whole report.
test('a deps object with no changes reader still composes', async () => {
  const legacy = { ...deps };
  delete legacy.changes;
  const r = await siteReportData('HGO', { year: 2026, month: 7, kind: 'weekly' }, legacy);
  assert.strictEqual(r.changes.success_pct, null);
  assert.strictEqual(r.changes.total, 0);
});

// ── major-incident detail ────────────────────────────────────────────────────
test('major incidents get detail, not just the bare count', async () => {
  const r = await siteReportData('HGO', { year: 2026, month: 7, kind: 'weekly' }, deps);
  assert.strictEqual(r.helpdesk.major_incidents, 1);            // the month's count, unchanged
  assert.strictEqual(r.helpdesk.major_incidents_open.length, 1);
  const mi = r.helpdesk.major_incidents_open[0];
  assert.strictEqual(mi.display_id, '311587');
  assert.strictEqual(mi.subject, 'WAN down');
  assert.strictEqual(mi.overdue, true);
  // whitelisted — the open-MI reader also carries requester/technician PII.
  assert.ok(!('requester' in mi));
  assert.ok(!('technician' in mi));
});

test('a failing major-incident reader degrades to an empty list', async () => {
  const broken = { ...deps, majorIncidents: async () => { throw new Error('db down'); } };
  const r = await siteReportData('HGO', { year: 2026, month: 7, kind: 'weekly' }, broken);
  assert.deepStrictEqual(r.helpdesk.major_incidents_open, []);
});

test('a failing scoreInputs degrades to "non applicable", not a fabricated RED', async () => {
  const broken = { ...deps, scoreInputs: async () => { throw new Error('db down'); } };
  const r = await siteReportData('HGO', { year: 2026, month: 7, kind: 'weekly' }, broken);
  // This used to assert score 33 / RED / 6 dims — all six inputs at 0, with
  // overdue+findings INVERTED to 2 pts each = 4/12 = 33. A confident RED for a
  // site whose reader threw. It now declines to score.
  assert.strictEqual(r.score.applicable, false);
  assert.strictEqual(r.score.score, null);
  assert.strictEqual(r.score.rag, null);
  assert.strictEqual(r.score.window, null);
  assert.deepStrictEqual(r.score.dims, []);
  assert.deepStrictEqual(r.score.moves, []);
});

test('technicians get deterministic alerts', async () => {
  const overloaded = { ...deps, technicians: async () => [
    { name: 'Busy', assigned: 30, resolved: 12, avg_resolution_h: 9, reopened: 0, current_load: 20 },
    { name: 'Norm', assigned: 10, resolved: 9, avg_resolution_h: 5, reopened: 0, current_load: 4 },
  ] };
  const r = await siteReportData('HGO', { year: 2026, month: 7, kind: 'weekly' }, overloaded);
  const busy = r.technicians.find(t => t.name === 'Busy');
  assert.ok(busy.alerts.includes('overloaded') || busy.alerts.includes('low_closure'));
});
