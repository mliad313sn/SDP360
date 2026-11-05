'use strict';
// D-01 / D-02 (AMDEC 2026-11-05, AM-01..03) — pure parts: which of an account's codes are shared by two active
// sites, the "fill the registry from the hard maps" dry-run plan, and the per-site onboarding checklist.
const { test } = require('node:test');
const assert = require('node:assert');
const SCS = require('../services/siteCodeShared');
const OB = require('../services/siteOnboarding');

const sites = [{ id: 1, name: 'Assafo' }, { id: 2, name: 'Tanda' }, { id: 3, name: 'Hounde' }];
const code = { Assafo: 'TND', Tanda: 'TND', Hounde: 'HGO' };

test('sharedAmong names every other active site that resolves to the same code, never picks an owner', () => {
  const out = SCS.sharedAmong(sites, ['TND', 'HGO'], (s) => code[s.name]);
  assert.deepStrictEqual(out, [{ code: 'TND', sites: ['Assafo', 'Tanda'] }]);
  assert.deepStrictEqual(SCS.sharedAmong(sites, ['HGO'], (s) => code[s.name]), []);
  assert.deepStrictEqual(SCS.sharedAmong(sites, [], (s) => code[s.name]), []);
  assert.deepStrictEqual(SCS.sharedAmong(sites, ['TND'], () => { throw new Error('x'); }), [], 'a failing resolver never blocks');
});

test('the refusal message names the module, the code and the sites, and says nothing was saved', () => {
  const m = SCS.message('tracker', [{ code: 'TND', sites: ['Assafo', 'Tanda'] }]);
  assert.match(m, /tracker code TND/); assert.match(m, /Assafo, Tanda/); assert.match(m, /Nothing was saved/);
});

test('fillPlan proposes the hard-coded code for a missing site, skips shared codes and registry clashes', () => {
  const diff = [
    { module: 'meetings', site_id: 5, site: 'Exploration', hard_coded: 'EXP', registry: null, kind: 'missing_in_registry' },
    { module: 'tracker', site_id: 1, site: 'Assafo', hard_coded: 'TND', registry: null, kind: 'missing_in_registry' },
    { module: 'tracker', site_id: 2, site: 'Tanda', hard_coded: 'TND', registry: null, kind: 'missing_in_registry' },
    { module: 'tracker', site_id: 1, site: 'Assafo', hard_coded: 'TND', registry: null, kind: 'shared_code', source: 'hard_coded', shared_with: ['Tanda'] },
    { module: 'tracker', site_id: 2, site: 'Tanda', hard_coded: 'TND', registry: null, kind: 'shared_code', source: 'hard_coded', shared_with: ['Assafo'] },
    { module: 'inspection', site_id: 7, site: 'Massawa', hard_coded: null, registry: null, kind: 'missing_in_registry' },
    { module: 'inspection', site_id: 8, site: 'Other', hard_coded: null, registry: 'ZZZ', kind: 'registry_only' },
    { module: 'inspection', site_id: 9, site: 'Late', hard_coded: 'ZZZ', registry: null, kind: 'missing_in_registry' },
  ];
  const p = OB.fillPlan(diff);
  assert.equal(p.dry_run, true);
  assert.deepStrictEqual(p.proposed, [{ module: 'meetings', site_id: 5, site: 'Exploration', code: 'EXP' }]);
  assert.deepStrictEqual(p.skipped.map((x) => [x.site, x.module, x.reason]).sort(),
    [['Assafo', 'tracker', 'shared_code'], ['Late', 'inspection', 'registry_clash'], ['Massawa', 'inspection', 'no_hard_code'], ['Tanda', 'tracker', 'shared_code']]);
});

test('buildOnboarding lists, per site, what is missing before a coordinator can start', () => {
  const rows = OB.buildOnboarding({
    sites: [{ id: 7, name: 'Massawa', zoho_group: 'Massawa IT Agents' }, { id: 3, name: 'Hounde', zoho_group: null }],
    attrs: new Map([[7, { country: 'SN', business_unit: null }]]),
    codesFor: (s) => (s.id === 3 ? { tracker: 'HGO', inspection: 'HGO', meetings: 'HGO' } : { tracker: null, inspection: null, meetings: null }),
    currencyFor: (s) => (s.id === 7 ? 'XOF' : null),
    coordinatorFor: (s) => (s.id === 3 ? { name: 'A', confirmed: true } : null),
    sharedFor: () => [],
  });
  const mas = rows.find((r) => r.site === 'Massawa');
  assert.deepStrictEqual(mas.missing, ['tracker code', 'inspection code', 'meetings code', 'business unit', 'coordinator']);
  assert.equal(mas.ready, false); assert.equal(mas.country, 'SN'); assert.equal(mas.currency, 'XOF');
  const hgo = rows.find((r) => r.site === 'Hounde');
  assert.deepStrictEqual(hgo.missing, ['country', 'business unit', 'currency', 'Zoho group']);
});

test('buildOnboarding flags a shared code as a blocking item', () => {
  const [r] = OB.buildOnboarding({ sites: [{ id: 1, name: 'Assafo', zoho_group: 'g' }], attrs: new Map([[1, { country: 'CI', business_unit: 'Expl' }]]),
    codesFor: () => ({ tracker: 'TND', inspection: null, meetings: null }), currencyFor: () => 'XOF', coordinatorFor: () => ({ name: 'x', confirmed: true }),
    sharedFor: (s, mod) => (mod === 'tracker' ? ['Tanda'] : []) });
  assert.ok(r.missing.includes('tracker code TND shared with Tanda'));
});
