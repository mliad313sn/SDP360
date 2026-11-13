'use strict';
// B3 (P7a) — pure rules: the sensitive flag in canReadProject / filterPortfolio, and the "my projects" ids.
const test = require('node:test');
const assert = require('node:assert');
const PA = require('../services/portfolioAccess');

const edA = { id: 11, username: 'eda', site_id: 1, roles: ['editor'] };
const edB = { id: 12, username: 'edb', site_id: 2, roles: ['editor'] };
const SA = { id: 100, site_id: 1, owner: 'nobody', sensitive: 1 };
const SG = { id: 101, site_id: null, owner: 'nobody', sensitive: 1 };
const PB = { id: 102, site_id: 2, owner: 'nobody', sensitive: 0 };

test('switch off (today): the flag means nothing — every session reads every project', () => {
  for (const p of [SA, SG, PB]) assert.equal(PA.canReadProject(edB, p, { scopeOn: false, sensitiveOn: false }), true);
});

test('switch on: a sensitive project is read by its site holders, owner, members, committee and admin — nobody else', () => {
  const on = { scopeOn: false, sensitiveOn: true };
  assert.equal(PA.canReadProject(edA, SA, on), true, 'holder of the site');
  assert.equal(PA.canReadProject(edB, SA, on), false, 'other site, even with the scope switch off');
  assert.equal(PA.canReadProject(edB, SA, { ...on, memberProjectIds: [100] }), true, 'named member');
  assert.equal(PA.canReadProject({ ...edB, username: 'boss' }, { ...SA, owner: 'Boss' }, on), true, 'owner');
  assert.equal(PA.canReadProject(edB, SA, { ...on, isCommittee: true }), true);
  assert.equal(PA.canReadProject(edB, SA, { ...on, isAdmin: true }), true);
  assert.equal(PA.canReadProject(edA, SA, { ...on, extraSites: [] }), true);
  assert.equal(PA.canReadProject(edB, SA, { ...on, extraSites: [{ project_id: 100, site_id: 2 }] }), true, 'extra site counts');
  assert.equal(PA.canReadProject(edA, SG, on), false, 'group-level sensitive: not a site holder');
  assert.equal(PA.canReadProject(edB, PB, on), true, 'a non-sensitive project is unaffected');
  assert.equal(PA.canReadProject(edA, PB, { scopeOn: true, sensitiveOn: true }), false, 'scope rule still applies to the rest');
});

test('filterPortfolio: sensitive switch alone narrows the view; no sensitive project = view unchanged', () => {
  const view = { projects: [SA, SG, PB], tasks: [{ id: 1, project_id: 100 }, { id: 2, project_id: 102 }], risks: [], gantt: [{ id: 100 }, { id: 102 }], objectives: [], objective_views: [], programmes: [] };
  const v = PA.filterPortfolio(view, edB, { scopeOn: false, sensitiveOn: true });
  assert.deepEqual(v.projects.map((p) => p.id), [102]);
  assert.deepEqual(v.tasks.map((t) => t.id), [2]);
  assert.deepEqual(v.gantt.map((g) => g.id), [102]);
  const plain = { ...view, projects: [PB] };
  assert.equal(PA.filterPortfolio(plain, edB, { scopeOn: false, sensitiveOn: true }), plain, 'nothing to hide: same object');
  assert.equal(PA.filterPortfolio(view, edB, { scopeOn: false, sensitiveOn: false }), view, 'switch off: same object');
  assert.equal(PA.filterPortfolio(view, edB, { sensitiveOn: true, isCommittee: true }), view);
});

test('myProjectIds: owned, of my sites, or as a member — never a project the reader was not sent', () => {
  const ps = [{ id: 1, site_id: 1, owner: 'x' }, { id: 2, site_id: 2, owner: 'eda' }, { id: 3, site_id: null, owner: 'x' }, { id: 4, site_id: 2, owner: 'x' }];
  assert.deepEqual(PA.myProjectIds(edA, ps, { memberProjectIds: [3] }), [1, 2, 3]);
  assert.deepEqual(PA.myProjectIds(edA, [], {}), []);
});
