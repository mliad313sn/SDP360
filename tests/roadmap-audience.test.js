'use strict';
// B6 (P7a) — pure rules of the audience-scoped roadmap publication + the page's "my projects" filter.
const test = require('node:test');
const assert = require('node:assert');
const RA = require('../services/roadmapAudience');
const PM = require('../public/lib/portfolioMine');

const view = {
  programmes: [{ id: 1, key: 'P1', name: 'Prog 1' }, { id: 2, key: 'P2', name: 'Prog 2' }],
  objectives: [{ id: 10, programme_id: 1, name: 'O1' }, { id: 20, programme_id: 2, name: 'O2' }],
  projects: [
    { id: 100, objective_id: 10, key: 'A', name: 'A', site_id: 1, budget: 500, spent: 50, currency: 'USD', progress_pct: null },
    { id: 101, objective_id: 10, key: 'S', name: 'S', site_id: 1, sensitive: 1, budget: 9, spent: 1, currency: 'USD' },
    { id: 102, objective_id: 20, key: 'B', name: 'B', site_id: 2, budget: 7 },
    { id: 103, objective_id: 20, key: 'X', name: 'X', site_id: 2 },
  ],
  project_sites: [{ project_id: 103, site_id: 1 }],
  gantt: [{ id: 100, slip_days: 3, late: false, milestones: [{ name: 'M', due: '2027-01-01', late: false }] }],
  as_of: '2026-11-13T00:00:00Z',
};
const edA = { id: 1, site_id: 1 }, edB = { id: 2, site_id: 2 };

test('canPublish: site → committee or an editor of that site; other audiences → committee', () => {
  assert.equal(RA.canPublish(edA, 'site', 1, { isEditor: true }), true);
  assert.equal(RA.canPublish(edA, 'site', 2, { isEditor: true }), false);
  assert.equal(RA.canPublish({ id: 9, site_id: 1 }, 'site', 1, {}), false, 'a viewer does not publish');
  for (const a of ['programme', 'committee', 'exec']) assert.equal(RA.canPublish(edA, a, a === 'programme' ? 1 : null, { isEditor: true }), false, a);
  assert.equal(RA.canPublish(edA, 'exec', null, { isCommittee: true }), true);
  assert.equal(RA.canPublish(edA, 'site', null, { isCommittee: true }), false, 'site needs a site id');
  assert.equal(RA.canPublish(edA, 'nope', null, { isCommittee: true }), false);
});

test('buildSnapshot: perimeter per audience, sensitive only for committee / exec, amounts only on request', () => {
  const site = RA.buildSnapshot(view, { audience: 'site', ref: 1 });
  assert.deepEqual(site.projects.map((p) => p.key), ['A', 'X'], 'primary + extra site, never the sensitive one');
  assert.ok(site.projects.every((p) => p.budget === undefined), 'no amount');
  assert.equal(site.projects[0].progress_pct, null, 'unknown stays null');
  assert.equal(site.projects[0].slip_days, 3); assert.equal(site.projects[1].slip_days, null);
  const prog = RA.buildSnapshot(view, { audience: 'programme', ref: 1 });
  assert.deepEqual(prog.projects.map((p) => p.key), ['A']);
  const exec = RA.buildSnapshot(view, { audience: 'exec', amounts: true });
  assert.deepEqual(exec.projects.map((p) => p.key), ['A', 'S', 'B', 'X']);
  assert.equal(exec.projects[1].sensitive, true); assert.equal(exec.projects[0].budget, 500); assert.equal(exec.projects[3].budget, null);
  assert.throws(() => RA.buildSnapshot(view, { audience: 'site' }), /audience/);
});

test('canRead + visible: audience, expiry, revocation, amounts only for admin tier / finance', () => {
  const now = new Date('2026-11-13T12:00:00Z');
  const site = { audience: 'site', audience_ref: 1, site_ids: [1] };
  assert.equal(RA.canRead(edA, site, {}, now), true); assert.equal(RA.canRead(edB, site, {}, now), false);
  assert.equal(RA.canRead(edB, site, { isCommittee: true }, now), true);
  assert.equal(RA.canRead(edB, { ...site, expires_at: '2026-11-13T11:00:00Z' }, { isAdmin: true }, now), false, 'expired');
  assert.equal(RA.canRead(edA, { ...site, revoked_at: 'x' }, {}, now), false, 'revoked');
  assert.equal(RA.canRead(edB, { audience: 'programme', audience_ref: 1, site_ids: [2] }, {}, now), true);
  assert.equal(RA.canRead(edB, { audience: 'committee' }, {}, now), false);
  assert.equal(RA.canRead(edB, { audience: 'exec' }, { isCommittee: true }, now), false, 'exec = admin tier');
  const snap = RA.buildSnapshot(view, { audience: 'exec', amounts: true });
  assert.equal(RA.visible(snap, { money: true }).projects[0].budget, 500);
  const hidden = RA.visible(snap, { money: false });
  assert.equal(hidden.projects[0].budget, undefined); assert.equal(hidden.amounts_hidden, true);
  assert.equal(RA.shareable({ audience: 'exec' }), false); assert.equal(RA.shareable({ audience: 'site' }), true);
  assert.equal(RA.shareTtlHours({ expires_at: '2026-11-13T14:30:00Z' }, 72, now), 2, 'capped at the publication expiry');
  assert.equal(RA.shareTtlHours({ expires_at: '2026-11-13T11:00:00Z' }, 72, now), null);
  const html = RA.renderHtml({ title: '<x>', audience: 'site', created_at: '2026-11-13' }, snap);
  assert.ok(!/500|budget/i.test(html), 'the share view never prints an amount'); assert.ok(html.includes('&lt;x&gt;'));
});

test('PortfolioMine: mine by default, all only when allowed; filter narrows project lists only', () => {
  assert.equal(PM.choice('', { ids: [], can_see_all: true }), 'mine');
  assert.equal(PM.choice('?show=all', { ids: [], can_see_all: true }), 'all');
  assert.equal(PM.choice('?show=all', { ids: [], can_see_all: false }), 'mine');
  assert.equal(PM.choice('?show=all', null), 'all', 'switch off: no my_projects → everything as today');
  const v = PM.filterView({ projects: [{ id: 1 }, { id: 2 }], gantt: [{ id: 2 }], tasks: [{ project_id: 1 }, { project_id: 2 }], summary: [{ projects: 2 }] }, [2]);
  assert.deepEqual(v.projects, [{ id: 2 }]); assert.deepEqual(v.tasks, [{ project_id: 2 }]); assert.deepEqual(v.summary, [{ projects: 2 }]);
});
