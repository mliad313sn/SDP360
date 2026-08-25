'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('node:http');

function makeApp(sessionUser) {
  const rdb = {
    listSites: () => [
      { id: 1, name: 'Hounde', zoho_group: 'Hounde IT Agents' },
      { id: 2, name: 'Mana', zoho_group: 'Mana IT Agent' },
    ],
    userHasRole: (u, r) => (u.roles || []).includes(r),
    getSiteHelpdeskWindow: () => ({ created: 10, resolved: 8, backlog: 2, sla_overdue: 1, major_incidents: 0, top_categories: [], recurring: [] }),
    getActiveMajorIncidentsForSite: () => [{ id: 42, subject: 'X', requester: 'SECRET PERSON', technician: 'SECRET TECH', status: 'Open', created_time: '2026-08-01' }],
  };
  const requireReportSession = (req, _res, next) => { req.reportUser = sessionUser; next(); };
  const app = express();
  app.use(require('../routes/siteAwareness')({ express, requireReportSession, rdb }));
  return app;
}
// Core http (not fetch) — undici's global keep-alive pool leaves an open handle that
// --test-force-exit flags as a file-level failure. Mirrors tests/wan-sla-routes.smoke.
function call(app, path) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app).listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      http.get(`http://127.0.0.1:${port}${path}`, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => { server.close(); let body = {}; try { body = JSON.parse(data); } catch (_) {} resolve({ status: res.statusCode, body }); });
      }).on('error', (e) => { server.close(); reject(e); });
    });
  });
}

test('site-business summary is scoped to the user site; selector lists only that site', async () => {
  const app = makeApp({ id: 5, roles: ['site-business'], site_id: 1 });
  const { status, body } = await call(app, '/api/site-awareness/summary');
  assert.equal(status, 200);
  assert.equal(body.site_id, 1);
  assert.deepEqual(body.authorized_sites.map(s => s.site_id), [1]);
  assert.equal(body.tabs.helpdesk, true);
  assert.equal(body.tabs.inspections, false);
});

test('site-business requesting a FOREIGN ?site is refused (403)', async () => {
  const app = makeApp({ id: 5, roles: ['site-business'], site_id: 1 });
  const { status } = await call(app, '/api/site-awareness/helpdesk?site=2');
  assert.equal(status, 403);
});

test('group-business may pass ?site and select any site', async () => {
  const app = makeApp({ id: 9, roles: ['group-business'] });
  const { status, body } = await call(app, '/api/site-awareness/helpdesk?site=2');
  assert.equal(status, 200);
  assert.equal(body.site_id, 2);
});

test('helpdesk payload carries NO PII (no requester/technician/subject leakage)', async () => {
  const app = makeApp({ id: 5, roles: ['site-business'], site_id: 1 });
  const { body } = await call(app, '/api/site-awareness/helpdesk');
  const json = JSON.stringify(body);
  assert.ok(!/SECRET PERSON|SECRET TECH/.test(json), 'requester/technician names must be stripped');
  assert.ok(body.snapshot && body.snapshot.created === 10);
});
