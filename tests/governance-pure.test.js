'use strict';
// Step 8 — pure services: agenda builder (sections per kind, null never 0, summary), minutes renderer (escaping, refs), portfolio evidence (evidence %, slippage, dependencies, roll-up).
const { test } = require('node:test');
const assert = require('node:assert');
const { buildAgenda, metricKeysFor, DEFAULT_TEMPLATES } = require('../services/agendaBuilder');
const { renderMinutes } = require('../services/minutesRenderer');
const PE = require('../services/portfolioEvidence');

test('agenda: sections follow the cadence kind, time budget split, reds counted, missing figures stay null', () => {
  const a = buildAgenda({ cadence: { kind: 'site_weekly', name: 'HGO weekly' }, scheduledAt: '2026-10-20T09:00:00Z', now: new Date('2026-10-19T00:00:00Z'),
    metrics: [{ key: 'k1', name: 'K1', value: 40, unit: '%', rag: 'RED', window: { label: 'W42' } }, { key: 'k2', name: 'K2', value: null, rag: 'NA' }], actions: { open: 5, overdue: 2, list: [] }, incidents: [{ display_id: '311587', subject: 'Power' }], decisions: [{ ref: 'DEC-2026-001', title: 'x' }] });
  assert.deepEqual(a.items.map(i => i.kind), DEFAULT_TEMPLATES.site_weekly.sections);
  assert.equal(a.items.reduce((s, i) => s + i.minutes, 0) <= 45, true); assert.equal(a.items[0].minutes, 9);
  assert.equal(a.summary.reds, 1); assert.equal(a.summary.overdue_actions, 2); assert.equal(a.summary.incidents, 1);
  assert.equal(a.items[0].content[1].value, null); assert.equal(a.items[0].content[0].window, 'W42');
  const b = buildAgenda({ cadence: { kind: 'custom', agenda_template: { minutes: 30, sections: ['kpis', 'next'] } } });
  assert.equal(b.total_minutes, 30); assert.equal(b.items.length, 2); assert.equal(b.summary.overdue_actions, null, 'no actions → null, not 0');
  assert.deepEqual(metricKeysFor('custom', { kpis: ['x.y'] }), ['x.y']); assert.ok(metricKeysFor('committee').includes('tracker.fleet_score_pct'));
});

test('minutes: HTML carries cadence, items with timestamps, decisions refs, actions; user text is escaped', () => {
  const html = renderMinutes({ cadence: { name: 'CAB <weekly>', kind: 'cab' }, siteName: 'Houndé',
    session: { id: 4, scheduled_at: '2026-10-20T09:00:00Z', started_at: '2026-10-20T09:02:00Z', closed_at: '2026-10-20T09:40:00Z', attendees: ['A', 'B'], notes: 'ok <script>x</script>', agenda: { items: [{ id: 's1-incidents', title: 'Major incidents', content: [] }] }, items: [{ id: 's1-incidents', started_at: '2026-10-20T09:03:00Z', ended_at: '2026-10-20T09:10:00Z', notes: 'n' }] },
    decisions: [{ ref: 'DEC-2026-003', title: 'Buy <UPS>', owner: 'Bob', due_date: '2026-11-01', status: 'open' }], actions: [{ title: 'Call ISP', owner: 'Ann', due_date: '2026-10-25', status: 'open', source_ref: 'DEC-2026-003' }], baseUrl: 'https://x' });
  assert.ok(html.startsWith('<!DOCTYPE html>')); assert.ok(html.includes('CAB &lt;weekly&gt;')); assert.ok(!html.includes('<script>x'));
  assert.ok(html.includes('DEC-2026-003')); assert.ok(html.includes('Buy &lt;UPS&gt;')); assert.ok(html.includes('Call ISP')); assert.ok(html.includes('Houndé'));
});

test('evidence: capped 0..100, lower-is-better inverts, unmeasured is null (never 0)', () => {
  assert.equal(PE.evidencePct(45, 90), 50); assert.equal(PE.evidencePct(120, 90), 100); assert.equal(PE.evidencePct(null, 90), null); assert.equal(PE.evidencePct(10, 0), null);
  assert.equal(PE.evidencePct(5, 10, false), 100); assert.equal(PE.evidencePct(20, 10, false), 50); assert.equal(PE.evidencePct(0, 10, false), 100);
  const now = new Date('2026-10-19T00:00:00Z');
  const auto = PE.objectiveView({ id: 1, key: 'o', name: 'O', evidence_target: 90, target_date: '2026-09-30', progress_pct: 10 }, { metric: { key: 'm', value: 81, unit: '%' }, projects: [{ progress_pct: 50, end_date: '2026-12-31' }], now });
  assert.equal(auto.evidence_pct, 90); assert.equal(auto.evidence_source, 'metric'); assert.equal(auto.slip_days, 92); assert.equal(auto.overdue, true);
  const man = PE.objectiveView({ id: 2, key: 'p', name: 'P', progress_pct: 30 }, { now }); assert.equal(man.evidence_source, 'manual'); assert.equal(man.slip_days, null);
  const prj = PE.objectiveView({ id: 3, key: 'q', name: 'Q' }, { projects: [{ progress_pct: 20 }, { progress_pct: 60 }], now }); assert.equal(prj.evidence_pct, 40); assert.equal(prj.evidence_source, 'projects');
  const none = PE.objectiveView({ id: 4, key: 'r', name: 'R' }, { now }); assert.equal(none.evidence_pct, null); assert.equal(none.evidence_source, 'none');
});

test('gantt: slip vs baseline, late end, unfinished dependency, overdue milestones; risks + programme roll-up', () => {
  const now = new Date('2026-10-19T00:00:00Z');
  const projects = [{ id: 1, key: 'A', name: 'A', status: 'active', start_date: '2026-01-01', end_date: '2026-09-30', baseline_end: '2026-08-31', objective_id: 10, budget: 100, spent: 40 },
    { id: 2, key: 'B', name: 'B', status: 'planned', start_date: '2026-09-01', end_date: '2026-12-31', depends_on: [1], objective_id: 10 }];
  const g = PE.ganttRows(projects, [{ id: 5, project_id: 1, name: 'M', due_date: '2026-07-01', done_at: null }], { now }).map(r => ({ ...r, objective_id: 10 }));
  assert.equal(g[0].slip_days, 30); assert.equal(g[0].late, true); assert.ok(g[0].alerts.some(x => /slipped 30 d/.test(x))); assert.ok(g[0].alerts.some(x => /1 milestone/.test(x))); assert.equal(g[0].milestones[0].late, true);
  assert.deepEqual(g[1].depends_on, ['A']); assert.ok(g[1].alerts.some(x => /depends on unfinished A/.test(x))); assert.equal(g[1].late, false);
  assert.equal(PE.riskView({ probability: 3, impact: 2 }).severity, 'high'); assert.equal(PE.riskView({ probability: 1, impact: 2 }).severity, 'low');
  const sum = PE.portfolioSummary({ programmes: [{ id: 7, key: 'p', name: 'P' }], objectiveViews: [{ id: 10, programme_id: 7, weight: 2, evidence_pct: 50, evidence_source: 'metric' }, { id: 11, programme_id: 7, weight: 1, evidence_pct: null, evidence_source: 'none' }], gantt: g, risks: [{ project_id: 1, status: 'open', probability: 3, impact: 3 }, { project_id: 1, status: 'closed', probability: 3, impact: 3 }] });
  assert.equal(sum[0].objectives, 2); assert.equal(sum[0].auto_evidence_pct, 50); assert.equal(sum[0].weighted_evidence_pct, 50, 'unmeasured objective excluded, not counted as 0'); assert.equal(sum[0].projects, 2); assert.equal(sum[0].late_projects, 1); assert.equal(sum[0].high_risks, 1); assert.equal(sum[0].spent, 40);
});
