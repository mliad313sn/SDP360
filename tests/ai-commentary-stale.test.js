'use strict';
// E-B08 — ai_commentary_stale_block: off → identical output to today; on + stale source → deterministic + reason.
const test = require('node:test');
const assert = require('node:assert');
const { generateCommentary } = require('../services/aiCommentary');
const { staleSourcesFor, STALE_ERROR } = require('../services/aiStaleGate');

const analysis = { headline: 'Resolution SLA 91% this week', bullets: ['42 tickets closed'], figures: [{ title: 'SLA', metric: 'sla', value: 91, unit: '%' }, { title: 'Closed', metric: 'closed', value: 42 }], tone: 'neutral' };
const NOW = new Date('2026-11-06T12:00:00Z');
const aiCall = async () => 'The share of tickets solved on time was 91%, and 42 tickets were closed.';
const registry = { get: (k) => (k === 'sla' ? { key: 'sla', module: 'helpdesk' } : null) };
const figures = [{ metric: 'sla', value: 91 }];

test('off (default): the switch reads null and the commentary is exactly today\'s', async () => {
  assert.equal(require('../services/reportConfig').DEFAULTS.ai_commentary_stale_block, '0');
  const stale = await staleSourcesFor({ figures, registry }, { getConfig: async () => ({ ai_commentary_stale_block: '0' }) });
  assert.equal(stale, null);
  const a = await generateCommentary({ analysis, provider: 'local', aiCall, now: NOW });
  const b = await generateCommentary({ analysis, provider: 'local', aiCall, now: NOW, staleSources: stale });
  assert.deepEqual(b, a, 'snapshot unchanged');
  assert.equal(a.source, 'ai');
});

test('on + a stale / never-synced source → deterministic text with the reason, logged once', async () => {
  const logs = [];
  const deps = { getConfig: async () => ({ ai_commentary_stale_block: '1' }), lastOk: async () => ({ 'zoho.requests': '2026-11-01T00:00:00Z' }), policy: async () => null, now: NOW.getTime(), logEvent: (e) => logs.push(e) };
  const stale = await staleSourcesFor({ figures, registry, siteId: 3, runRef: 7 }, deps);
  assert.equal(stale.length, 1); assert.equal(stale[0].state, 'STALE');
  assert.equal(logs.length, 1); assert.equal(logs[0].action, 'ai_commentary_stale_blocked');
  let called = 0;
  const c = await generateCommentary({ analysis, provider: 'local', aiCall: async () => { called++; return 'x'; }, now: NOW, staleSources: stale });
  assert.equal(called, 0, 'no model call');
  assert.equal(c.source, 'deterministic'); assert.equal(c.error, STALE_ERROR);
  const never = await staleSourcesFor({ figures, registry }, { ...deps, lastOk: async () => ({}) });
  assert.equal(never[0].state, 'UNKNOWN', 'never synced counts as stale');
});

test('on + every source fresh → AI commentary as today', async () => {
  const deps = { getConfig: async () => ({ ai_commentary_stale_block: '1' }), lastOk: async () => ({ 'zoho.requests': '2026-11-06T11:00:00Z' }), policy: async () => null, now: NOW.getTime(), logEvent: () => {} };
  const stale = await staleSourcesFor({ figures, registry }, deps);
  assert.deepEqual(stale, []);
  assert.equal((await generateCommentary({ analysis, provider: 'local', aiCall, now: NOW, staleSources: stale })).source, 'ai');
});

test('an unreadable config never blocks (= today)', async () => {
  assert.equal(await staleSourcesFor({ figures, registry }, { getConfig: async () => { throw new Error('pg down'); } }), null);
});
