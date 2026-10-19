'use strict';
// Step 4 (SDP-DASH-2.0) — extended audit journal: writes and refusals are journaled after the
// response, reads are not, login/logout are left to their own (richer) events, no body is kept.
const { test } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const A = require('../services/apiAudit');

test('classify: writes and 403s are journaled, reads and auth routes are not', () => {
  assert.deepEqual(A.classify({ method: 'PUT', path: '/api/reports/5/infra', status: 200 }), { action: 'api_write', risk: 0 });
  assert.deepEqual(A.classify({ method: 'GET', path: '/api/sites/3', status: 403 }), { action: 'api_denied', risk: 1 });
  assert.equal(A.classify({ method: 'GET', path: '/api/reports/5', status: 200 }), null);
  assert.equal(A.classify({ method: 'POST', path: '/api/reports/auth/login', status: 401 }), null);
  assert.equal(A.classify({ method: 'GET', path: '/api/auth/sso/callback', status: 403 }), null);
});

test('middleware: one event after finish, with actor, route pattern, status — never the body', () => {
  const events = [];
  const mw = A.middleware(e => events.push(e));
  const req = { method: 'POST', originalUrl: '/api/meetings/save?x=1', ip: '10.1.1.1', baseUrl: '',
    route: { path: '/api/meetings/save' }, reportUser: { username: 'alice', id: 7 }, body: { password: 'hunter2' }, headers: {} };
  const res = new EventEmitter(); res.statusCode = 200;
  let nexted = false;
  mw(req, res, () => { nexted = true; });
  assert.ok(nexted);
  assert.equal(events.length, 0, 'nothing before the response is finished');
  res.emit('finish');
  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.category, 'api'); assert.equal(e.actor, 'alice'); assert.equal(e.actor_id, 7);
  assert.equal(e.target, '/api/meetings/save');
  assert.deepEqual(e.details, { method: 'POST', route: '/api/meetings/save', status: 200 });
  assert.ok(!JSON.stringify(e).includes('hunter2'));
});

test('a logging failure never reaches the request', () => {
  const mw = A.middleware(() => { throw new Error('db down'); });
  const res = new EventEmitter(); res.statusCode = 500;
  mw({ method: 'DELETE', originalUrl: '/api/x', headers: {} }, res, () => {});
  assert.doesNotThrow(() => res.emit('finish'));
});
