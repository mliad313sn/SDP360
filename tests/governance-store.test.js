'use strict';
// Step 8 — governance store on sqlite: cadences, sessions + item stamps, decision refs, RFI scoring/ordering, portfolio tree + cascade.
const { test } = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { makeGovernanceStore } = require('../services/governanceStore');

async function fresh() { const s = makeGovernanceStore(new Database(':memory:'), { now: () => '2026-10-19T10:00:00.000Z' }); await s.init(); return s; }

test('cadence: key validation, upsert by key, site scoping of lists', async () => {
  const s = await fresh();
  await assert.rejects(() => s.saveCadence({ key: 'bad key', name: 'x' }), /cadence key/);
  await assert.rejects(() => s.saveCadence({ key: 'ok', name: 'x', kind: 'nope' }), /unknown cadence kind/);
  const a = await s.saveCadence({ key: 'hgo-w', name: 'HGO weekly', kind: 'site_weekly', site_id: 3, weekday: 1, time_local: '09:00', participants: ['a@b.c'] });
  const b = await s.saveCadence({ key: 'hgo-w', name: 'HGO weekly v2' }); assert.equal(b.id, a.id); assert.equal(b.name, 'HGO weekly v2'); assert.equal(b.duration_min, 60);
  await s.saveCadence({ key: 'grp', name: 'Group', kind: 'group_monthly' });
  assert.equal((await s.listCadences({ siteIds: [9] })).map(c => c.key).join(), 'grp', 'fleet cadences always visible, foreign site hidden');
  assert.equal((await s.listCadences({ siteIds: [3] })).length, 2);
});

test('session: created with agenda items, start/end stamps per item, status vocabulary', async () => {
  const s = await fresh();
  const c = await s.saveCadence({ key: 'c', name: 'C', kind: 'cab' });
  const agenda = { items: [{ id: 's1-incidents' }, { id: 's2-actions' }] };
  const ses = await s.createSession({ cadenceId: c.id, scheduledAt: '2026-10-20T09:00:00Z', agenda, user: { id: 7 } });
  assert.equal(ses.status, 'planned'); assert.equal(ses.items.length, 2); assert.equal(ses.items[0].started_at, null);
  const st = await s.stampItem(ses.id, 's1-incidents', 'started_at'); assert.equal(st.items[0].started_at, '2026-10-19T10:00:00.000Z');
  const un = await s.stampItem(ses.id, 'extra', 'ended_at'); assert.equal(un.items.length, 3, 'unknown item is appended, never dropped');
  await assert.rejects(() => s.updateSession(ses.id, { status: 'weird' }), /bad session status/);
  const live = await s.updateSession(ses.id, { status: 'live', attendees: ['A', 'B'] }); assert.deepEqual(live.attendees, ['A', 'B']);
  assert.equal((await s.listSessions({ cadenceId: c.id, status: 'live' })).length, 1);
});

test('decisions + session actions: DEC-YYYY-NNN sequence per year, close stamps closed_at, reopen clears it', async () => {
  const s = await fresh();
  const d1 = await s.addDecision({ title: 'One', session_id: null, site_id: 3 }); const d2 = await s.addDecision({ title: 'Two' });
  assert.equal(d1.ref, 'DEC-2026-001'); assert.equal(d2.ref, 'DEC-2026-002');
  const done = await s.updateDecision(d1.id, { status: 'done' }); assert.ok(done.closed_at);
  const re = await s.updateDecision(d1.id, { status: 'open' }); assert.equal(re.closed_at, null);
  assert.equal((await s.listDecisions({ status: 'open', siteIds: [9] })).map(d => d.ref).join(), 'DEC-2026-002', 'site-scoped decision hidden from another site');
  await assert.rejects(() => s.addDecision({}), /title/);
  const c = await s.saveCadence({ key: 'c', name: 'C' }); const ses = await s.createSession({ cadenceId: c.id, agenda: null });
  const a = await s.addSessionAction(ses.id, { title: 'Fix', owner: 'Bob', source_kind: 'decision', source_ref: d2.ref }); assert.equal(a.status, 'open');
  await s.setSessionActionStatus(a.id, 'done'); assert.ok((await s.sessionActions(ses.id))[0].closed_at);
});

test('RFI: kinds enforced, score = impact×3 − effort − data_risk, list sorted by score, triage clamps 1..3', async () => {
  const s = await fresh();
  await assert.rejects(() => s.submitRfi({ kind: 'nope', title: 't', problem: 'p' }), /kind must be/);
  const lo = await s.submitRfi({ kind: 'widget', title: 'Low', problem: 'p', impact: 1, effort: 3, data_risk: 3 });
  const hi = await s.submitRfi({ kind: 'metric', title: 'High', problem: 'p', impact: 3, effort: 1, data_risk: 1 });
  assert.equal(lo.ref, 'RFI-2026-001'); assert.equal(hi.score, 7); assert.equal(lo.score, -3);
  assert.deepEqual((await s.listRfi()).map(r => r.ref), ['RFI-2026-002', 'RFI-2026-001']);
  const t = await s.triageRfi(lo.id, { impact: 9, status: 'accepted', decision: 'go' }); assert.equal(t.impact, 3); assert.equal(t.status, 'accepted'); assert.ok(t.decided_at);
  await assert.rejects(() => s.triageRfi(lo.id, { status: 'maybe' }), /bad RFI status/);
});

test('portfolio: required fields, tree read-back, upsert by id, cascade delete', async () => {
  const s = await fresh();
  await assert.rejects(() => s.upsertPortfolio('objective', { name: 'no parent' }), /INVALID|required|programme_id/);
  await assert.rejects(() => s.upsertPortfolio('nope', {}), /unknown portfolio entity/);
  const pr = await s.upsertPortfolio('programme', { key: 'p1', name: 'P1' });
  const ob = await s.upsertPortfolio('objective', { programme_id: pr, key: 'o1', name: 'O1', evidence_metric: 'helpdesk.resolution_sla_pct', evidence_target: 90 });
  const pj = await s.upsertPortfolio('project', { objective_id: ob, key: 'j1', name: 'J1', start_date: '2026-01-01', end_date: '2026-06-30', baseline_end: '2026-05-31', depends_on: [] });
  await s.upsertPortfolio('milestone', { project_id: pj, name: 'M1', due_date: '2026-03-01' });
  await s.upsertPortfolio('deliverable', { project_id: pj, name: 'D1' });
  await s.upsertPortfolio('risk', { project_id: pj, title: 'R1', probability: 3, impact: 3 });
  let pf = await s.portfolio(); assert.equal(pf.programmes.length, 1); assert.equal(pf.objectives[0].evidence_target, 90); assert.equal(pf.milestones.length, 1); assert.equal(pf.risks.length, 1);
  assert.equal(await s.upsertPortfolio('project', { id: pj, objective_id: ob, key: 'j1', name: 'J1 renamed' }), pj);
  pf = await s.portfolio(); assert.equal(pf.projects[0].name, 'J1 renamed');
  await s.removePortfolio('programme', pr);
  pf = await s.portfolio(); assert.equal(pf.objectives.length + pf.projects.length + pf.milestones.length + pf.deliverables.length + pf.risks.length, 0, 'cascade reaches every level');
});
