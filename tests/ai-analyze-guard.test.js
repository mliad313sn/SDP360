'use strict';
// E-B08 step 2 — /api/ai/analyze number check: metadata only, never drops the reply.
const test = require('node:test');
const assert = require('node:assert');
const G = require('../services/aiAnalyzeGuard');
const reply = (t) => ({ id: 'm', content: [{ type: 'text', text: t }] });

test('no facts → answer unchanged (same object)', () => {
  const d = reply('Closure rate 93.4%');
  assert.strictEqual(G.annotate(d, undefined), d);
});

test('facts given: an invented number is flagged, the reply is kept', () => {
  const out = G.annotate(reply('Closure rate 87.6% (1,240 closed), 12 changes'), ['Closure rate 93.1%', 1236, 'changes: 0']);
  assert.equal(out.verification.verified, false);
  assert.ok(out.verification.offending.includes('87.6'));
  assert.equal(out.content[0].text, 'Closure rate 87.6% (1,240 closed), 12 changes', 'never silently dropped');
});

test('facts given: every number canonical → verified', () => {
  const out = G.annotate(reply('Closure rate 93.1% with 1236 tickets closed.'), ['93.1', '1236']);
  assert.deepEqual(out.verification, { verified: true, offending: [] });
});
