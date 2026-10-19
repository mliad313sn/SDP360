'use strict';
// Step 4 (SDP-DASH-2.0) — Entra groups → roles/sites: validation, union, refusal rules.
const { test } = require('node:test');
const assert = require('node:assert');
const G = require('../services/ssoGroupSync');

const MAP = JSON.stringify([
  { group: 'AAA', label: 'Coordinators Hounde', roles: ['editor', 'tracker-editor'], site_id: 3 },
  { group: 'bbb', label: 'Coordinators Ity', roles: ['editor'], site_id: 5 },
  { group: 'ccc', label: 'IT Management', roles: ['executive'] },
]);

test('parseGroupMap validates rows and refuses super_admin by group', () => {
  assert.equal(G.parseGroupMap(MAP).rows.length, 3);
  assert.match(G.parseGroupMap('{').errors[0], /JSON/);
  const bad = G.parseGroupMap(JSON.stringify([{ group: 'x', roles: ['boss'] }, { group: 'y', roles: ['super_admin'] }, { roles: ['viewer'] }]));
  assert.equal(bad.rows.length, 0);
  assert.equal(bad.errors.length, 3);
});

test('resolveAccess: union of roles, first site primary, ids case-insensitive', () => {
  const { rows } = G.parseGroupMap(MAP);
  const a = G.resolveAccess(['aaa', 'BBB'], rows);
  assert.deepEqual(a.roles.sort(), ['editor', 'tracker-editor']);
  assert.equal(a.site_id, 3);
  assert.deepEqual(a.extra_site_ids, [5]);
  assert.equal(G.resolveAccess(['zzz'], rows).matched, false);
  assert.equal(G.resolveAccess(['ccc'], rows).site_id, null);
});

test('decide: off = skip; on = apply, or deny when not in a group / overage / bad map', () => {
  const claims = { groups: ['AAA'] };
  assert.equal(G.decide({ enabled: false, claims, mapText: MAP }).action, 'skip');
  assert.equal(G.decide({ enabled: true, claims, mapText: MAP }).action, 'apply');
  assert.equal(G.decide({ enabled: true, claims: { groups: ['nope'] }, mapText: MAP }).reason, 'not_in_group');
  assert.equal(G.decide({ enabled: true, claims: { groups: [], groups_overage: true }, mapText: MAP }).reason, 'groups_overage');
  assert.equal(G.decide({ enabled: true, claims, mapText: '[]' }).reason, 'group_map_invalid');
});
