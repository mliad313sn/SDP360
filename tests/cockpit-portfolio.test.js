'use strict';
// Step 8 — pure parts of the cockpit and the portfolio: cadence validation and templates, minutes, portfolio
// analysis (status, drift, alerts, progress), governance indicators, Roadmap Manager mapping, monthly report.
const test = require('node:test');
const assert = require('node:assert');
const cdef = require('../services/cockpit/definition');
const minutes = require('../services/cockpit/minutes');
const A = require('../services/portfolio/analysis');
const { toNodes } = require('../services/portfolio/roadmapImport');
const report = require('../services/portfolio/report');

const served = new Set(['helpdesk.inbound', 'helpdesk.closed', 'helpdesk.sla_res_pct', 'helpdesk.backlog', 'helpdesk.sla_reply_pct', 'infra.wan_timeup_pct',
  'inspections.conformity_pct', 'changes.success_pct', 'helpdesk.csat_pct', 'meetings.engagements_score', 'changes.total']);

test('cadence: every meeting type has a valid agenda template', () => {
  for (const type of Object.keys(cdef.TYPES)) {
    const v = cdef.validate({ id: 'c-' + type, title: 'Réunion', type, agenda: cdef.TEMPLATES[type], participants: [{ name: 'A', email: 'a@x.org' }], preparer: 'p' }, { servedMetrics: served });
    assert.deepStrictEqual(v.errors, [], type);
  }
});

test('cadence: blocking errors and warnings', () => {
  const base = { id: 'weekly', title: 'Hebdo', type: 'it-weekly', agenda: [{ kind: 'topic', minutes: 10 }], participants: [{ name: 'A', email: 'a@x.org' }], preparer: 'p' };
  assert.deepStrictEqual(cdef.validate(base).errors, []);
  const errs = (p, o) => cdef.validate({ ...base, ...p }, o).errors.join(' | ');
  assert.match(errs({ id: 'Bad id' }), /id:/);
  assert.match(errs({ agenda: [] }), /at least one section/);
  assert.match(errs({ agenda: [{ kind: 'sql' }] }), /kind/);
  assert.match(errs({ agenda: [{ kind: 'kpi' }] }), /1 to 8 dictionary keys/);
  assert.match(errs({ agenda: [{ kind: 'kpi', metrics: ['helpdesk.nope'] }] }, { servedMetrics: served }), /not a served/);
  assert.match(errs({ participants: [{ name: 'A', email: 'not-an-address' }] }), /invalid address/);
  assert.match(errs({ title: '<b>x</b>' }), /HTML/);
  assert.match(errs({ site_id: 99 }, { siteIds: new Set([1, 2]) }), /unknown or inactive site/);
  const w = cdef.validate({ ...base, participants: [{ name: 'A' }], duration_min: 15, agenda: [{ kind: 'topic', minutes: 30 }] }).warnings.join(' | ');
  assert.match(w, /no e-mail address/);
  assert.match(w, /30 min planned for a 15-minute meeting/);
});

test('minutes: agenda frozen figures, time spent, notes, decisions and actions — everything escaped', () => {
  const session = { held_on: '2026-10-20', started_at: '2026-10-20T08:00:00.000Z', ended_at: '2026-10-20T08:47:00.000Z', agenda: { generated_at: '2026-10-20T08:00:00.000Z', site: null, sections: [
    { kind: 'kpi', title: 'Service', widget: { type: 'kpi' }, data: { items: [{ key: 'helpdesk.sla_res_pct', label: { fr: 'SLA <résolution>' }, unit: '%', value: 88.4, prev: 90, rag: 'amber' }, { key: 'x', label: { fr: 'Vide' }, unit: '%', value: null }] } },
    { kind: 'incidents', title: 'Incidents', widget: { type: 'events' }, data: { open: 0, items: [] } },
    { kind: 'topic', title: 'Divers', text: 'Point <script>x</script>' },
  ] } };
  const html = minutes.render({ cadence: { title: 'Hebdo IT', participants: [{ name: 'Awa', role: 'chef' }] }, session,
    items: [{ seq: 1, started_at: '2026-10-20T08:00:00.000Z', ended_at: '2026-10-20T08:12:00.000Z', notes: 'Note <b>' }],
    decisions: [{ item_seq: 1, text: 'Renforcer <astreinte>', owner: 'Ali' }],
    actions: [{ item_seq: 1, title: 'Appeler le FAI', owner: 'Ali', due_date: '2026-10-27', source_kind: 'incident', source_ref: 'INC-12' }] });
  assert.ok(html.includes('SLA &lt;résolution&gt;') && !html.includes('<résolution>'));
  assert.ok(html.includes('88,4 %') && html.includes('À surveiller') && html.includes('Non mesuré'));
  assert.ok(html.includes('12 min'), 'time spent on the point');
  assert.ok(html.includes('47 min'), 'meeting duration');
  assert.ok(html.includes('— non traité'), 'a point never opened says so');
  assert.ok(html.includes('Renforcer &lt;astreinte&gt;') && html.includes('rattachée à : incident INC-12'));
  assert.ok(!/<script/i.test(html), 'no script in the minutes');
  assert.ok(html.includes('Aucun incident majeur en cours.'));
});

const N = (o) => Object.assign({ parent_id: null, status: 'not_started', depends_on: [], incidents: [] }, o);
const tree = [
  N({ id: 'P', kind: 'programme', title: 'Prog' }),
  N({ id: 'O', parent_id: 'P', kind: 'objective', title: 'Obj', due_date: '2026-12-31', evidence_metric: 'helpdesk.sla_res_pct' }),
  N({ id: 'O2', parent_id: 'P', kind: 'objective', title: 'Obj2' }),
  N({ id: 'J', parent_id: 'O', kind: 'project', title: 'Projet', start_date: '2026-09-01', due_date: '2026-11-30', budget: 100, spent: 120 }),
  N({ id: 'M1', parent_id: 'J', kind: 'milestone', title: 'Jalon 1', due_date: '2026-10-01', baseline_due: '2026-09-15', status: 'done', done_date: '2026-09-30' }),
  N({ id: 'M2', parent_id: 'J', kind: 'milestone', title: 'Jalon 2', due_date: '2026-10-10', baseline_due: '2026-10-10', status: 'on_track' }),
  N({ id: 'M3', parent_id: 'J', kind: 'milestone', title: 'Jalon 3', start_date: '2026-10-05', due_date: '2026-12-15', baseline_due: '2026-11-01', depends_on: ['M2'] }),
];

test('portfolio: effective status, drift, progress, alerts', () => {
  const today = '2026-10-23';
  assert.equal(A.effectiveStatus(tree[5], today), 'late', 'a passed due date without delivery is late');
  assert.equal(A.effectiveStatus(tree[4], today), 'done');
  assert.equal(A.drift(tree[4]), 16);
  assert.equal(A.progressOf(tree[3], A.index(tree)), 1 / 3);
  const kinds = A.alerts(tree, today).map(a => a.kind + ':' + a.id).sort();
  assert.deepStrictEqual(kinds, ['beyond-parent:M3', 'budget:J', 'dependency:M3', 'late:M2', 'slip:M3']);
});

test('governance: milestones on time, drift, request → decision delay, evidence coverage, adoption by role', () => {
  const g = A.governance({ nodes: tree, from: '2026-09-01', to: '2026-10-31', today: '2026-10-23',
    rfis: [{ submitted_at: '2026-10-01T10:00:00Z', decided_at: '2026-10-11T10:00:00Z', status: 'decided' }, { submitted_at: '2026-10-05T10:00:00Z', status: 'new' }],
    logRows: [{ actor: 'awa' }, { actor: 'awa' }, { actor: 'ali' }, { actor: 'system' }],
    users: [{ username: 'awa', role: 'executive', roles: ['meeting-chair'] }, { username: 'ali', role: 'editor', roles: [] }] });
  assert.deepStrictEqual(g.milestones_on_time, { due: 2, on_time: 1, pct: 50 });
  assert.equal(g.mean_drift_days, 20, '(16 + 0 + 44) ÷ 3');
  assert.deepStrictEqual(g.rfi_to_decision_days, { decided: 1, mean: 10 });
  assert.equal(g.rfis_open, 1);
  assert.deepStrictEqual(g.evidence_coverage, { objectives: 2, with_evidence: 1, pct: 50 });
  assert.deepStrictEqual(g.adoption_by_role, { executive: 1, 'meeting-chair': 1, editor: 1 });
});

test('Roadmap Manager → portfolio: programme > objectives > projects > milestones, stable ids', () => {
  const nodes = toNodes({
    objectives: [{ obj_key: 'catalogue', title: 'Catalogue', status: 'green', confidence: 'high', target_date: '2026-12-31', sort_order: 1 }, { obj_key: 'vide', title: 'Sans livrable', status: 'red' }],
    deliverables: [{ uid: 'u1', obj_key: 'catalogue', label: 'Publier', delivery_date: '2026-06-30', status: 'done' }, { uid: 'u2', obj_key: 'catalogue', label: 'Former', delivery_date: '2026-11-30', status: 'todo' }],
  }, 7);
  assert.deepStrictEqual(nodes.map(n => n.kind), ['programme', 'objective', 'project', 'milestone', 'milestone', 'objective']);
  assert.equal(nodes[1].id, 'RM-7-catalogue');
  assert.equal(nodes[1].status, 'on_track'); assert.equal(nodes[1].confidence, 80);
  assert.equal(nodes[3].id, 'RM-7-d-u1'); assert.equal(nodes[3].status, 'done'); assert.equal(nodes[3].done_date, '2026-06-30');
  assert.equal(nodes[2].due_date, '2026-11-30', 'the project ends with its last deliverable');
  assert.equal(nodes[5].status, 'late');
});

test('monthly report: escaped, alerts, evidence, budget', () => {
  const html = report.render({ nodes: [...tree, N({ id: 'X', parent_id: 'P', kind: 'objective', title: '<img src=x>' })], month: '2026-10', today: '2026-10-23',
    evidence: { O: { metric: 'helpdesk.sla_res_pct', value: 91, target: 90, met: true } } });
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('État du portefeuille — 2026-10'));
  assert.ok(html.includes('helpdesk.sla_res_pct : 91 / cible 90 ✓'));
  assert.ok(html.includes('dépense 120 au-delà du budget 100'));
  assert.ok(html.includes('1 livré(s) ce mois') === false && html.includes('2 jalon(s) prévus ce mois'), 'M1 and M2 due in October; M1 was delivered in September');
});
