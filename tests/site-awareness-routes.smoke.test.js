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
    listSiteModuleCodes: (m) => (m === 'meetings' ? [{ site_id: 1, code: 'HGO' }, { site_id: 2, code: 'MGO' }] : []),
    getSiteHelpdeskWindow: () => ({ created: 10, resolved: 8, backlog: 2, sla_overdue: 1, major_incidents: 0, top_categories: [], recurring: [] }),
    getActiveMajorIncidentsForSite: () => [{ id: 42, subject: 'X', requester: 'SECRET PERSON', technician: 'SECRET TECH', status: 'Open', created_time: '2026-08-01' }],
    getSiteChangesWindow: () => ({ total: 5, executed: 4, successful: 3, failed: 1, cancelled: 0, pending: 1, emergency: 1, success_pct: 75 }),
  };
  const inspectionDb = {
    siteNameToCode: (n) => ({ Hounde: 'HGO', Mana: 'MGO' }[n] || null),
    aggregate: () => ({ counts: { total: 4, critical_count: 1, draft_count: 0, submitted_count: 4, closed_count: 0, sites_covered: 1 }, findingStatus: [{ status: 'ok', n: 30 }, { status: 'minor', n: 5 }, { status: 'critical', n: 1 }, { status: 'na', n: 10 }] }),
    listInspections: () => [{ id: 'EM-IT-1', inspection_date: '2026-08-01', area_text: 'Datacenter', overall_risk: 'Low', status: 'submitted' }],
    listActions: () => [{ id: 7, description: 'Fix UPS', priority: 'High', due_date: '2026-09-01', owner: 'Site IT', status: 'open' }],
  };
  const meetingsDb = {
    siteNameToCode: (n) => ({ Hounde: 'HGO', Mana: 'MGO' }[n] || null),
    getSiteMonthlyMeetingSummary: () => ({ site_code: 'HGO', month_label: 'Aug 2026', available: true,
      kpis: { pvs_held: 3, depts_with_pv: 3, dept_target: 3, open_issues: 12, high_open: 2, escalations_open: 1, resolved_month: 5, new_month: 4 },
      departments: [{ department: 'Maintenance', status: 'on_track' }],
      trend: { months: ['Jun', 'Jul', 'Aug'], opened: [4, 5, 4], closed: [3, 4, 5] }, commentary: 'ok' }),
  };
  const requireReportSession = (req, _res, next) => { req.reportUser = sessionUser; next(); };
  const app = express();
  app.use(require('../routes/siteAwareness')({ express, requireReportSession, rdb, meetingsDb, inspectionDb }));
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
  assert.equal(body.tabs.inspections, true);
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

test('helpdesk payload includes a whitelisted 90-day changes block', async () => {
  const app = makeApp({ id: 5, roles: ['site-business'], site_id: 1 });
  const { body } = await call(app, '/api/site-awareness/helpdesk');
  assert.equal(body.changes.total, 5);
  assert.equal(body.changes.success_pct, 75);
  assert.equal(body.changes.window_days, 90);
});

test('inspections tab returns a whitelisted per-site block', async () => {
  const app = makeApp({ id: 5, roles: ['site-business'], site_id: 1 });
  const { status, body } = await call(app, '/api/site-awareness/inspections');
  assert.equal(status, 200);
  assert.equal(body.applicable, true);
  assert.equal(body.snapshot.inspections, 4);
  assert.equal(body.snapshot.open_actions, 1);
  assert.ok(body.findings.ok === 30);
  assert.ok(Array.isArray(body.recent) && body.recent[0].area === 'Datacenter');
});

test('meetings tab returns a whitelisted per-site block', async () => {
  const app = makeApp({ id: 5, roles: ['site-business'], site_id: 1 });
  const { status, body } = await call(app, '/api/site-awareness/meetings');
  assert.equal(status, 200);
  assert.equal(body.applicable, true);
  assert.equal(body.snapshot.pvs, 3);
  assert.equal(body.snapshot.open, 12);
  assert.ok(Array.isArray(body.trend.months) && body.trend.months.length === 3);
});
