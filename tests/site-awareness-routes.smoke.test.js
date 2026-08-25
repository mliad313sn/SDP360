'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');

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
async function call(app, path) {
  const srv = app.listen(0); const port = srv.address().port;
  try { const r = await fetch(`http://127.0.0.1:${port}${path}`); return { status: r.status, body: await r.json().catch(() => ({})) }; }
  finally { srv.close(); }
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
