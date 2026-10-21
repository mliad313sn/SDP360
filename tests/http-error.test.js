'use strict';
// M9 — services/httpError: a 5xx answer is generic + carries a correlation id that the server
// log line shares; a TYPED error (or an explicit non-5xx status) passes its message through.
const test = require('node:test');
const assert = require('node:assert');
const H = require('../services/httpError');

function fakeRes(req) {
  const r = { req, headersSent: false, statusCode: null, body: null };
  r.status = (s) => { r.statusCode = s; return r; };
  r.json = (b) => { r.body = b; r.headersSent = true; return r; };
  return r;
}
function capture(fn) {
  const lines = []; const orig = console.error;
  console.error = (...a) => lines.push(a.join(' '));
  try { fn(); } finally { console.error = orig; }
  return lines;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('a plain Error → 500, generic body, correlation id, and ONE log line carrying id + path + message + stack', () => {
  const res = fakeRes({ method: 'GET', originalUrl: '/api/x?y=1' });
  const e = new Error('SELECT * FROM secret_table failed at /srv/app/db.js');
  const lines = capture(() => H.fail(res, e));
  assert.equal(res.statusCode, 500);
  assert.deepEqual(Object.keys(res.body).sort(), ['correlation_id', 'error']);
  assert.equal(res.body.error, 'internal_error');
  assert.match(res.body.correlation_id, UUID);
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes(res.body.correlation_id), 'log carries the same id');
  assert.ok(lines[0].includes('GET /api/x?y=1') && lines[0].includes('secret_table') && /\| at /.test(lines[0]));
  assert.ok(!JSON.stringify(res.body).includes('secret_table'), 'the message never reaches the client');
});

test('typed() errors pass their message + code with the status of their code', () => {
  for (const [code, st] of [['FORBIDDEN', 403], ['VALIDATION', 400], ['NOT_FOUND', 404], ['CONFLICT', 409], ['UNSAFE_URL', 400], ['INVALID', 400], ['RATE_LIMITED', 429]]) {
    const res = fakeRes();
    capture(() => H.fail(res, H.typed(code, `msg for ${code}`)));
    assert.equal(res.statusCode, st, code);
    assert.deepEqual(res.body, { error: `msg for ${code}`, code });
  }
  // a typed error may pin its own status; `errors` detail rides along
  const res = fakeRes();
  const e = Object.assign(new Error('two fields are wrong'), { code: 'INVALID', errors: ['a', 'b'] });
  capture(() => H.fail(res, e));
  assert.equal(res.statusCode, 400); assert.deepEqual(res.body.errors, ['a', 'b']);
  assert.equal(H.typed('NOT_FOUND', 'x', 410).status, 410);
  assert.ok(H.isTyped({ expose: true }) && !H.isTyped(new Error('x')) && !H.isTyped({ code: 'ECONNREFUSED' }));
});

test('an explicit non-5xx status exposes the message (user-facing validation text); an explicit 5xx stays generic', () => {
  const r1 = fakeRes(); capture(() => H.fail(r1, new Error('name is required'), 400));
  assert.equal(r1.statusCode, 400); assert.deepEqual(r1.body, { error: 'name is required' });
  const r2 = fakeRes(); capture(() => H.fail(r2, new Error('upstream exploded at https://x/y?token=abc'), 502, { ok: false }));
  assert.equal(r2.statusCode, 502); assert.equal(r2.body.error, 'internal_error'); assert.equal(r2.body.ok, false);
  assert.ok(!JSON.stringify(r2.body).includes('upstream'));
  // `extra` may replace the generic label with a CONSTANT the caller chose — never the message
  const r3 = fakeRes(); capture(() => H.fail(r3, new Error('boom'), 500, { error: 'AI analysis failed.' }));
  assert.equal(r3.body.error, 'AI analysis failed.'); assert.match(r3.body.correlation_id, UUID);
});

test('a 5xx with a transport error code (not in the whitelist) stays generic — e.code alone is not a passport', () => {
  const res = fakeRes();
  capture(() => H.fail(res, Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { code: 'ECONNREFUSED' })));
  assert.equal(res.statusCode, 500); assert.equal(res.body.error, 'internal_error');
});

test('errorHandler: same logic; body-parser errors (expose=true, status 4xx) keep their message; headersSent → next(err)', () => {
  const req = { method: 'POST', originalUrl: '/api/p' };
  const r1 = fakeRes(req); let nexted = null;
  capture(() => H.errorHandler(new Error('db gone'), req, r1, (e) => { nexted = e; }));
  assert.equal(nexted, null); assert.equal(r1.statusCode, 500); assert.equal(r1.body.error, 'internal_error');
  const r2 = fakeRes(req);
  const bp = Object.assign(new Error('request entity too large'), { status: 413, expose: true, type: 'entity.too.large' });
  capture(() => H.errorHandler(bp, req, r2, () => {}));
  assert.equal(r2.statusCode, 413); assert.equal(r2.body.error, 'request entity too large');
  const r3 = fakeRes(req); r3.headersSent = true; const err = new Error('late');
  capture(() => H.errorHandler(err, req, r3, (e) => { nexted = e; }));
  assert.equal(nexted, err); assert.equal(r3.body, null);
});

test('logError returns the id and never throws on odd input', () => {
  const lines = capture(() => { assert.match(H.logError('a string', null), UUID); assert.match(H.logError(null), UUID); });
  assert.equal(lines.length, 2);
});
