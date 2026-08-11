'use strict';
// F1 Task A6 — sync-resources main(): reads SDP sites+people, POSTs the C1 payload to
// Meridian's ingest API with X-API-Key. Config-gated (no-op when unconfigured). Deps
// injectable so this runs with no DB and no network.
const { test } = require('node:test');
const assert = require('node:assert');
const { main } = require('../tools/meridian/sync-resources');

const sites = [{ site_id:1, code:'HGO', name:'Houndé' }, { site_id:2, code:'MGO', name:'Mana' }];
const people = [{ id:42, full_name:'A. S', role:'coordinator', site_code:'HGO', active:true }];

test('configured → POSTs {base}/v1/resources/sync with X-API-Key and the C1 body', async () => {
  let seen;
  const deps = {
    getConfig: async () => ({ meridian_base_url:'https://m.example/', meridian_out_key:'OUT' }),  // trailing slash trimmed
    readSites: async () => sites,
    readPeople: async () => people,
    httpPost: async (url, body, opts) => { seen = { url, body, opts }; return { data: { sites:{upserted:2}, people:{upserted:1} } }; },
    log: () => {},
  };
  const r = await main(deps);
  assert.equal(r.ok, true);
  assert.match(seen.url, /^https:\/\/m\.example\/v1\/resources\/sync$/);
  assert.equal(seen.opts.headers['X-API-Key'], 'OUT');
  assert.deepEqual(seen.body.sites.map(s => s.id).sort(), ['HGO', 'MGO']);
  assert.equal(seen.body.people[0].id, 'SDP-U42');
  assert.ok(!('_skipped_unknown_site' in seen.body), 'internal counter is not sent to Meridian');
});

test('unconfigured (no base_url / out_key) → does NOT POST, returns skipped', async () => {
  let called = false;
  const deps = {
    getConfig: async () => ({ meridian_base_url:'', meridian_out_key:'' }),
    readSites: async () => sites, readPeople: async () => people,
    httpPost: async () => { called = true; return { data:{} }; }, log: () => {},
  };
  const r = await main(deps);
  assert.equal(r.skipped, true);
  assert.equal(called, false, 'must not hit the network when unconfigured');
});

test('httpPost failure is non-blocking → returns {ok:false}, does not throw', async () => {
  const deps = {
    getConfig: async () => ({ meridian_base_url:'https://m', meridian_out_key:'k' }),
    readSites: async () => sites, readPeople: async () => people,
    httpPost: async () => { throw new Error('meridian down'); }, log: () => {},
  };
  const r = await main(deps);
  assert.equal(r.ok, false);
  assert.match(r.error, /meridian down/);
});
