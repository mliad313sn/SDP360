'use strict';
// G2-PLATFORM (2026-11-12) — services/routerStack must find the app's routes on Express 4
// (`app._router`) and Express 5 (`app.router`). On Express 5 a reader of `app._router` sees
// an EMPTY stack: the authz instrument then wraps nothing and capability enforcement fails
// OPEN without a single error. These tests pin that the real app exposes its routes and
// that its guarded layers are instrumented.
const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { routerStack } = require('../services/routerStack');

test('a plain app built with the installed express exposes its routes', () => {
  const app = express(); const r = express.Router();
  r.get('/api/x', (q, s) => s.end()); app.use(r); app.get('/api/y', (q, s) => s.end());
  const stack = routerStack(app);
  assert.ok(stack.some(l => l.route && l.route.path === '/api/y'), 'top-level route visible');
  assert.ok(stack.some(l => l.handle && Array.isArray(l.handle.stack) && l.handle.stack.some(x => x.route && x.route.path === '/api/x')), 'mounted router visible');
});

test('Express 4-shaped and empty inputs', () => {
  const s = [{ route: { path: '/a', stack: [] } }];
  assert.equal(routerStack({ _router: { stack: s } }), s);
  assert.deepEqual(routerStack(null), []);
  assert.deepEqual(routerStack({}), []);
});

test('the real app: hundreds of /api routes are visible and every tagged guard is instrumented', () => {
  const { app } = require('../server');
  const stack = routerStack(app);
  let routes = 0, tagged = 0, wrapped = 0;
  const visit = (st) => { for (const l of st || []) {
    if (l.route) { if (String(l.route.path).startsWith('/api')) routes++;
      for (const x of l.route.stack) if (x.handle && Array.isArray(x.handle.legacyRoles)) { tagged++; if (x.handle.__authzShadow) wrapped++; } }
    else if (l.handle && l.handle.stack) visit(l.handle.stack);
  } };
  visit(stack);
  assert.ok(routes > 300, `expected hundreds of /api routes, saw ${routes}`);
  assert.ok(tagged > 50, `expected tagged role guards, saw ${tagged}`);
  assert.equal(wrapped, tagged, 'every tagged guard is wrapped by the authz instrument (none left un-enforced)');
});
