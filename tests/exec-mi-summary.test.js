'use strict';

// Unit tests for the MI summarizer service (services/execMiSummary.js):
// - miSrcHash is stable and change-sensitive
// - applyCachedSummaries swaps in cached summaries on a fresh hit, marks
//   _summarized, and routes misses / stale hashes to the regen list
// - parseSummaryResponse tolerates fenced / noisy model output
// - regenerate calls the injected aiCall and writes via rdb.setExecMiSummary

const test = require('node:test');
const assert = require('node:assert');
const S = require('../services/execMiSummary');

const MI = () => ({ request_id: 'R1', subject: 'Fibre cut', impact: 'Enterprise',
  rca: 'Backhoe severed the trunk line during civil works.',
  ca: 'Rerouted via satellite; splice scheduled.' });

test('miSrcHash is stable for identical input and changes when text changes', () => {
  const a = S.miSrcHash(MI());
  const b = S.miSrcHash(MI());
  assert.equal(a, b);
  const c = S.miSrcHash({ ...MI(), ca: 'Different corrective action.' });
  assert.notEqual(a, c);
});

test('applyCachedSummaries: fresh cache hit swaps summaries + marks _summarized', () => {
  const mis = [MI()];
  const cache = { R1: { src_hash: S.miSrcHash(MI()),
    root_cause_summary: 'Trunk line cut by digging.',
    action_summary: 'Traffic rerouted; repair scheduled.' } };
  const { mis: out, stale } = S.applyCachedSummaries(mis, cache);
  assert.equal(stale.length, 0);
  assert.equal(out[0].rca, 'Trunk line cut by digging.');
  assert.equal(out[0].ca, 'Traffic rerouted; repair scheduled.');
  assert.equal(out[0]._summarized, true);
});

test('applyCachedSummaries: cache miss keeps verbatim + goes to stale', () => {
  const mis = [MI()];
  const { mis: out, stale } = S.applyCachedSummaries(mis, {});
  assert.equal(stale.length, 1);
  assert.equal(out[0]._summarized, undefined);
  assert.match(out[0].rca, /Backhoe/);           // verbatim retained
});

test('applyCachedSummaries: stale hash (source text changed) re-queues for regen', () => {
  const mis = [MI()];
  const cache = { R1: { src_hash: 'OLD', root_cause_summary: 'x', action_summary: 'y' } };
  const { stale } = S.applyCachedSummaries(mis, cache);
  assert.equal(stale.length, 1);
});

test('applyCachedSummaries: an MI with no RCA/CA is neither summarized nor stale', () => {
  const mis = [{ request_id: 'R2', subject: 'x', impact: 'Single', rca: '', ca: '' }];
  const { stale } = S.applyCachedSummaries(mis, {});
  assert.equal(stale.length, 0);
});

test('parseSummaryResponse: extracts JSON from fenced / noisy output', () => {
  const txt = 'Sure!\n```json\n{"root_cause":"Cut fibre.","action":"Rerouted."}\n```';
  const p = S.parseSummaryResponse(txt);
  assert.equal(p.root_cause, 'Cut fibre.');
  assert.equal(p.action, 'Rerouted.');
});

test('regenerate: calls aiCall and persists via rdb.setExecMiSummary', async () => {
  const writes = [];
  const rdb = { setExecMiSummary: (id, s) => writes.push({ id, s }) };
  const aiCall = async () => '{"root_cause":"Digging cut the line.","action":"Rerouted + repair booked."}';
  await S.regenerate({ stale: [MI()], aiCall, rdb, model: 'test-model' });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].id, 'R1');
  assert.equal(writes[0].s.root_cause_summary, 'Digging cut the line.');
  assert.equal(writes[0].s.action_summary, 'Rerouted + repair booked.');
  assert.equal(writes[0].s.src_hash, S.miSrcHash(MI()));
  assert.equal(writes[0].s.model, 'test-model');
});

test('regenerate: a failing aiCall does not throw and writes nothing', async () => {
  const writes = [];
  const rdb = { setExecMiSummary: (id, s) => writes.push({ id, s }) };
  const aiCall = async () => { throw new Error('LLM down'); };
  await S.regenerate({ stale: [MI()], aiCall, rdb });
  assert.equal(writes.length, 0);
});
