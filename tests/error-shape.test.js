'use strict';
// E-A03 (audit A-03, X-Q-05) — error shape, measured and ratcheted. Every hand-written
// `res.status(4xx|5xx).json(…)` in server.js / routes / services bypasses services/httpError.fail().
// That is allowed for 4xx validation text, but the count may only go DOWN (move a call to fail()
// and lower RATCHET in the same commit), every body must carry an `error` field, and no 5xx may echo
// an internal message (`e.message`) — fail() answers `internal_error` + a correlation id instead.
const { test } = require('node:test');
const assert = require('node:assert');
const { scan, scanSource, summarise } = require('../tools/test/error-shape-scan');

// Measured on 2026-11-05 (d38fa41 + goal/w1-qa): 485 call sites; 446 after the plan-E wave-1 merges moved governance/policies denials to fail(). Lower these when you migrate calls.
const RATCHET = { total: 444, without_error_field: 1, five_xx_leaking_message: 0 };
// The one known body without `error`: the tracker validation answer `{ ok:false, errors:[…] }`.
const KNOWN_WITHOUT_ERROR = ['routes/trackers.js'];

test('scanner: finds a call, reads its body, flags a missing error field and a leaked message', () => {
  const src = [
    "res.status(400).json({ error: 'bad (input)' });",
    'res.status(500).json({ error: e.message });',
    "res.status(404).json({ ok: false, reason: 'x' });",
    '// res.status(500).json({ error: e.message }) — a comment, ignored',
    "fail(res, e); res.status(200).json({ ok: true });",
  ].join('\n');
  const rows = scanSource(src, 'x.js');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => [r.line, r.status, r.hasError, r.leaksMessage]), [[1, 400, true, false], [2, 500, true, true], [3, 404, false, false]]);
});

test('ratchet: hand-written error answers may only go down', () => {
  const s = summarise(scan());
  assert.ok(s.total <= RATCHET.total, `hand-written res.status(4xx|5xx).json( grew to ${s.total} (ratchet ${RATCHET.total}) — use services/httpError.fail()`);
  if (s.total < RATCHET.total) console.log(`[error-shape] ${s.total} < ratchet ${RATCHET.total}: lower RATCHET.total in this file`);
  assert.ok(s.without_error_field <= RATCHET.without_error_field, `${s.without_error_field} error bodies without an "error" field`);
  assert.equal(s.five_xx_leaking_message, RATCHET.five_xx_leaking_message, 'a 5xx echoes e.message to the client — use fail(res, e)');
});

test('every hand-written error body carries an "error" field (one named exception)', () => {
  const bad = scan().filter((r) => !r.hasError).filter((r) => !KNOWN_WITHOUT_ERROR.includes(r.file));
  assert.deepEqual(bad.map((r) => `${r.file}:${r.line}`), []);
});
