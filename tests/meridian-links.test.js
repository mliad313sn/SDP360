'use strict';
// F1 Task A4 — meridianLinks.getLinksForSite: thin, best-effort read-back of Meridian
// project links. Config-gated, injectable httpGet, NEVER throws → degrades to {}.
const { test } = require('node:test');
const assert = require('node:assert');
const { getLinksForSite } = require('../services/meridianLinks');

test('calls {base}/v1/links?site= with X-API-Key, returns map keyed by ext_id', async () => {
  let seen;
  const httpGet = async (url, opts) => { seen = { url, opts }; return { data: { links: [
    { ext_source:'meetings', ext_id:'meetings:1234', activity_id:'AC-7', project_id:'PR-3', project_name:'WAN', title_cache:'x' } ] } }; };
  const cfg = { meridian_base_url:'https://m.example/', meridian_out_key:'OUT' };  // trailing slash trimmed
  const map = await getLinksForSite('HGO', { httpGet, config: cfg });
  assert.match(seen.url, /^https:\/\/m\.example\/v1\/links\?site=HGO$/);
  assert.equal(seen.opts.headers['X-API-Key'], 'OUT');
  assert.equal(map['meetings:1234'].project_name, 'WAN');
  assert.equal(map['meetings:1234'].project_id, 'PR-3');
});

test('degrades to {} on HTTP error', async () => {
  const boom = async () => { throw new Error('down'); };
  assert.deepEqual(await getLinksForSite('HGO', { httpGet: boom, config: { meridian_base_url:'https://m', meridian_out_key:'k' } }), {});
});

test('inert (no call, {}) when unconfigured or no site', async () => {
  let called = false; const spy = async () => { called = true; return { data:{ links:[] } }; };
  assert.deepEqual(await getLinksForSite('HGO', { httpGet: spy, config: {} }), {});                 // no base_url
  assert.deepEqual(await getLinksForSite('HGO', { httpGet: spy, config: { meridian_base_url:'https://m' } }), {}); // no key
  assert.deepEqual(await getLinksForSite('',    { httpGet: spy, config: { meridian_base_url:'https://m', meridian_out_key:'k' } }), {}); // no site
  assert.equal(called, false, 'must not hit the network when inert');
});

test('tolerates a missing/empty links array', async () => {
  const httpGet = async () => ({ data: {} });
  assert.deepEqual(await getLinksForSite('HGO', { httpGet, config: { meridian_base_url:'https://m', meridian_out_key:'k' } }), {});
});
