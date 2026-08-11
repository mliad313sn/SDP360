'use strict';
// F1 Task A6 — buildResourcePayload: SDP sites (listSiteModuleCodes('meetings')) +
// people (listPeople) → the C1 resource-sync payload. Person id = "SDP-U<id>"; sites
// first; a person whose site_code isn't a synced site is dropped (Meridian FK RESTRICT).
const { test } = require('node:test');
const assert = require('node:assert');
const { buildResourcePayload } = require('../services/meridianResources');

test('maps sites+people to C1 shape; drops person with unknown site', () => {
  const sites = [{ site_id:1, code:'HGO', name:'Houndé' }, { site_id:2, code:'MGO', name:'Mana' }];
  const people = [
    { id:42, full_name:'A. S', role:'coordinator', site_code:'HGO', active:true },
    { id:7,  full_name:'Ghost', role:'editor', site_code:'ZZZ' },   // ZZZ not a synced site → dropped
  ];
  const p = buildResourcePayload({ sites, people });
  assert.deepEqual(p.sites.map(s => s.id).sort(), ['HGO', 'MGO']);
  assert.deepEqual(p.sites.find(s => s.id === 'HGO'), { id:'HGO', name:'Houndé', country:null, region:null });
  assert.equal(p.people.length, 1);
  assert.deepEqual(p.people[0], { id:'SDP-U42', name:'A. S', role:'coordinator', site_id:'HGO', active:true });
  assert.equal(p._skipped_unknown_site, 1);
});

test('site name falls back to code; role falls back; active defaults true', () => {
  const p = buildResourcePayload({
    sites: [{ code:'SGO' }],
    people: [{ id:9, full_name:'', site_code:'SGO' }],   // no name, no role, no active flag
  });
  assert.equal(p.sites[0].name, 'SGO');
  assert.equal(p.people[0].name, '9');            // full_name blank → String(id)
  assert.equal(p.people[0].role, 'staff');
  assert.equal(p.people[0].active, true);
});

test('active:false is preserved (only absent/true → true)', () => {
  const p = buildResourcePayload({ sites:[{code:'HGO'}], people:[{ id:1, full_name:'X', site_code:'HGO', active:false }] });
  assert.equal(p.people[0].active, false);
});

test('empty inputs → empty payload, never throws', () => {
  assert.deepEqual(buildResourcePayload({}), { sites:[], people:[], _skipped_unknown_site:0 });
});
