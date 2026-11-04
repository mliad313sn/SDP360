'use strict';
// A-15 — pure guard for the portfolio: who reads a project, who maintains its plan, and the filtered view.
// Both behaviours are PROPOSED access policy behind report_config switches; off = today (everyone reads,
// committee writes). These tests pin both states.
const { test } = require('node:test');
const assert = require('node:assert');
const A = require('../services/portfolioAccess');
const S = require('../services/projectSchedule');

const A_SITE = 1, B_SITE = 2, C_SITE = 3;
const edA = { id: 10, username: 'eda', full_name: 'Editor A', email: 'eda@x.org', site_id: A_SITE };
const viewA = { id: 11, username: 'va', site_id: A_SITE };
const edB = { id: 12, username: 'edb', site_id: B_SITE };
const edC = { id: 13, username: 'edc', site_id: C_SITE };
const pA = { id: 1, site_id: A_SITE, owner: 'someone' };
const pB = { id: 2, site_id: B_SITE, owner: 'Editor A' };   // edA owns a project on another site
const pB2 = { id: 3, site_id: B_SITE, owner: 'other' };
const pG = { id: 4, site_id: null, owner: 'other' };         // group-level

const read = (u, p, o = {}) => A.canReadProject(u, p, { scopeOn: true, isCommittee: false, isAdmin: false, ...o });
const edit = (u, p, o = {}) => A.canEditPlan(u, p, { writesOn: true, isCommittee: false, isEditor: true, ...o });

test('ownerMatches — username, full name and e-mail match case-insensitively; empty owner never matches', () => {
  assert.ok(A.ownerMatches({ owner: ' EDA ' }, edA));
  assert.ok(A.ownerMatches({ owner: 'editor a' }, edA));
  assert.ok(A.ownerMatches({ owner: 'EDA@X.ORG' }, edA));
  assert.ok(!A.ownerMatches({ owner: 'someone' }, edA));
  assert.ok(!A.ownerMatches({ owner: '' }, { username: '' }));
  assert.ok(!A.ownerMatches({ owner: null }, edA));
  assert.ok(!A.ownerMatches({ owner: 'eda' }, null));
});

test('projectSiteIds — primary + extra rows of that project, unique, no nulls; none = group-level', () => {
  assert.deepEqual(A.projectSiteIds(pA, [{ project_id: 1, site_id: 3 }, { project_id: 9, site_id: 4 }, { project_id: 1, site_id: 1 }]), [1, 3]);
  assert.deepEqual(A.projectSiteIds(pG, []), []);
  assert.deepEqual(A.projectSiteIds(pG, [{ project_id: 4, site_id: 2 }]), [2]);
});

test('canReadProject — scope off: every user reads every project (today)', () => {
  for (const u of [edA, viewA, edB, edC, { id: 99 }]) for (const p of [pA, pB, pB2, pG]) assert.ok(A.canReadProject(u, p, { scopeOn: false }));
});

test('canReadProject — scope on: editor of A reads A and group-level, not B; committee reads all; owner reads own project elsewhere', () => {
  assert.ok(read(edA, pA)); assert.ok(read(edA, pG)); assert.ok(!read(edA, pB2));
  assert.ok(read(edA, pB), 'owner of a project on another site');
  assert.ok(read(viewA, pA)); assert.ok(!read(viewA, pB));
  for (const p of [pA, pB, pB2, pG]) { assert.ok(read(edC, p, { isCommittee: true })); assert.ok(read(edC, p, { isAdmin: true })); }
});

test('canReadProject — multi-site project via extra sites is visible to an editor of the extra site', () => {
  const extra = [{ project_id: 3, site_id: C_SITE }];
  assert.ok(read(edC, pB2, { extraSites: extra }));
  assert.ok(!read(edC, pB2));
  assert.ok(!read(edC, pB2, { extraSites: [{ project_id: 99, site_id: C_SITE }] }));
});

test('canEditPlan — writes off: only committee (today)', () => {
  assert.ok(!A.canEditPlan(edA, pA, { writesOn: false, isEditor: true }));
  assert.ok(!A.canEditPlan(edA, pB, { writesOn: false, isEditor: true }), 'even the owner');
  assert.ok(A.canEditPlan(edC, pA, { writesOn: false, isCommittee: true }));
  assert.ok(A.canEditPlan(edC, pG, { writesOn: false, isCommittee: true }));
});

test('canEditPlan — writes on: site editor yes, site viewer no, other-site editor no, group-level committee only, owner yes', () => {
  assert.ok(edit(edA, pA));
  assert.ok(!edit(viewA, pA, { isEditor: false }));
  assert.ok(!edit(edB, pA));
  assert.ok(!edit(edA, pG), 'group-level stays committee');
  assert.ok(edit(edC, pG, { isCommittee: true }));
  assert.ok(edit(edA, pB), 'the owner maintains their own project on another site');
  assert.ok(edit({ id: 5, username: 'someone' }, pA, { isEditor: false }), 'owner without the editor role');
  assert.ok(edit(edC, pB2, { extraSites: [{ project_id: 3, site_id: C_SITE }] }), 'editor of an extra site');
  assert.ok(!edit(edA, null));
});

function view() {
  // two programmes, objectives on each; project 1 (site A, late, a high risk), project 2 (site B, late, a high risk)
  const programmes = [{ id: 1, key: 'P1', name: 'P1' }];
  const objectives = [{ id: 1, programme_id: 1, key: 'O1', name: 'O1', weight: 1, progress_pct: null }, { id: 2, programme_id: 1, key: 'O2', name: 'O2', weight: 1, progress_pct: null }];
  const projects = [
    { id: 1, objective_id: 1, key: 'A1', name: 'A1', site_id: A_SITE, owner: 'x', status: 'active', progress_pct: 20, end_date: '2020-01-01', depends_on: [] },
    { id: 2, objective_id: 2, key: 'B1', name: 'B1', site_id: B_SITE, owner: 'y', status: 'active', progress_pct: 80, end_date: '2020-01-01', depends_on: [] },
  ];
  const milestones = [{ id: 1, project_id: 1, name: 'mA' }, { id: 2, project_id: 2, name: 'mB' }];
  const deliverables = [{ id: 1, project_id: 1, name: 'dA' }, { id: 2, project_id: 2, name: 'dB' }];
  const risks = [{ id: 1, project_id: 1, title: 'rA', probability: 3, impact: 3, status: 'open' }, { id: 2, project_id: 2, title: 'rB', probability: 3, impact: 3, status: 'open' }];
  const tasks = [
    { id: 1, project_id: 1, name: 'tA', owner: 'Kone', start_date: '2027-01-01', end_date: '2027-01-10', allocation_pct: 60, status: 'todo', depends_on: [] },
    { id: 2, project_id: 2, name: 'tB', owner: 'Kone', start_date: '2027-01-01', end_date: '2027-01-10', allocation_pct: 60, status: 'todo', depends_on: [] },
  ];
  const now = new Date('2026-11-01T00:00:00Z');
  const PE = require('../services/portfolioEvidence');
  const ov = objectives.map(o => ({ ...PE.objectiveView(o, { projects: projects.filter(p => p.objective_id === o.id), now }), programme_id: o.programme_id }));
  const gantt = PE.ganttRows(projects, milestones, { now }).map(g => ({ ...g, objective_id: projects.find(p => p.id === g.id).objective_id }));
  const rv = risks.map(PE.riskView);
  return { programmes, objectives, projects, milestones, deliverables, tasks, project_sites: [], objective_views: ov, gantt, risks: rv,
    plans: projects.map(p => ({ project_id: p.id, key: p.key })), resource_conflicts: S.resourceConflicts(tasks),
    summary: PE.portfolioSummary({ programmes, objectiveViews: ov, gantt, risks }), as_of: now.toISOString() };
}

test('filterPortfolio — a hidden project takes its children, plans, gantt rows, conflicts and counts with it', () => {
  const v = view();
  assert.equal(v.summary[0].late_projects, 2); assert.equal(v.summary[0].high_risks, 2); assert.ok(v.resource_conflicts.length >= 1);
  const f = A.filterPortfolio(v, edA, { scopeOn: true, now: new Date('2026-11-01T00:00:00Z') });
  assert.deepEqual(f.projects.map(p => p.id), [1]);
  for (const k of ['milestones', 'deliverables', 'risks', 'tasks']) assert.deepEqual(f[k].map(x => x.project_id), [1], k);
  assert.deepEqual(f.plans.map(x => x.project_id), [1]);
  assert.deepEqual(f.gantt.map(x => x.id), [1]);
  assert.equal(f.summary[0].late_projects, 1, 'late count recomputed');
  assert.equal(f.summary[0].high_risks, 1, 'high-risk count recomputed');
  assert.equal(f.summary[0].projects, 1);
  assert.deepEqual(f.resource_conflicts, [], 'conflicts recomputed from visible tasks');
  assert.equal(f.objectives.length, 2, 'objectives stay');
  assert.equal(f.objective_views.find(o => o.id === 2).evidence_pct, null, 'objective evidence recomputed without the hidden project');
  assert.equal(f.objective_views.find(o => o.id === 1).evidence_pct, 20);
  // scope off or committee: the view is returned untouched
  assert.strictEqual(A.filterPortfolio(v, edA, { scopeOn: false }), v);
  assert.strictEqual(A.filterPortfolio(v, edA, { scopeOn: true, isCommittee: true }), v);
});

test('stageGate still uses the same identity rule (GATE_SOD unchanged)', () => {
  const b = { stage: 'approval', owner: 'Jean Dupont', charter: 'x'.repeat(30), sponsor: 'S', start_date: '2027-01-01', end_date: '2027-02-01', baseline_end: '2027-02-01' };
  assert.strictEqual(S.stageGate(b, 'in_progress', { username: 'jdupont', full_name: 'Jean Dupont' }).code, 'GATE_SOD');
  assert.strictEqual(S.stageGate(b, 'in_progress', { username: 'other' }), null);
  assert.strictEqual(S.stageGate({ ...b, owner: '' }, 'in_progress', { username: '' }), null, 'an empty owner never blocks as self-approval');
});
