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
    getSiteIdByModuleCode: () => ({ site_id: 1 }),
    getSiteOpenReportActions: () => ({ actions: [{ uid: 'x', task: 'Report follow-up', owner: 'IT', status: 'open' }] }),
  };
  const inspectionDb = {
    siteNameToCode: (n) => ({ Hounde: 'HGO', Mana: 'MGO' }[n] || null),
    aggregate: () => ({ counts: { total: 4, critical_count: 1, draft_count: 0, submitted_count: 4, closed_count: 0, sites_covered: 1 }, findingStatus: [{ status: 'ok', n: 30 }, { status: 'minor', n: 5 }, { status: 'critical', n: 1 }, { status: 'na', n: 10 }] }),
    listInspections: () => [{ id: 'EM-IT-1', inspection_date: '2026-08-01', area_text: 'Datacenter', overall_risk: 'Low', status: 'submitted' }],
    listActions: () => [{ id: 7, description: 'Fix UPS', priority: 'High', due_date: '2026-09-01', owner: 'Site IT', status: 'open' }],
  };
  const meetingsDb = {
    siteNameToCode: (n) => ({ Hounde: 'HGO', Mana: 'MGO' }[n] || null),
    listActions: () => [{ id: 1, description: 'Deploy Helix', owner_it: 'Engineering', target_date: '2026-09-15', status: 'open', created_at: '2026-08-05', meeting_reference: 'HGO_Maintenance_PV_2026-08' }],
    getSiteMonthlyMeetingSummary: () => ({ site_code: 'HGO', month_label: 'Aug 2026', available: true,
      kpis: { pvs_held: 3, depts_with_pv: 3, dept_target: 3, open_issues: 12, high_open: 2, escalations_open: 1, resolved_month: 5, new_month: 4 },
      departments: [{ department: 'Maintenance', status: 'on_track' }],
      trend: { months: ['Jun', 'Jul', 'Aug'], opened: [4, 5, 4], closed: [3, 4, 5] }, commentary: 'ok' }),
  };
  const trackerDb = {
    siteNameToCode: (n) => ({ Hounde: 'HGO', Mana: 'MGO' }[n] || null),
    loadTracker: () => ({ year: 2026, currentMonth: 8, pillarWeights: { P1: 0.25, P2: 0.25, P3: 0.25, P4: 0.25 } }),
  };
  const trackerScore = {
    ss: () => ({ avg: 0.72, g: 5, a: 3, r: 1, active: 9, pScores: {} }),
    ps2: () => 0.7,
    gP: () => ['P1', 'P2', 'P3', 'P4'],
  };
  const requireReportSession = (req, _res, next) => { req.reportUser = sessionUser; next(); };
  const app = express();
  app.use(require('../routes/siteAwareness')({ express, requireReportSession, rdb, meetingsDb, inspectionDb, trackerDb, trackerScore }));
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

test('actions tab returns a whitelisted per-site register', async () => {
  const app = makeApp({ id: 5, roles: ['site-business'], site_id: 1 });
  const { status, body } = await call(app, '/api/site-awareness/actions');
  assert.equal(status, 200);
  assert.equal(body.applicable, true);
  assert.ok(body.snapshot && typeof body.snapshot.total_open === 'number');
  assert.equal(body.snapshot.total_open, 3);
  assert.deepEqual(body.snapshot.by_source, { meetings: 1, inspection: 1, report: 1 });
  assert.ok(Array.isArray(body.actions) && body.actions.length === 3);
});

test('tracker tab returns a whitelisted per-site scorecard', async () => {
  const app = makeApp({ id: 5, roles: ['site-business'], site_id: 1 });
  const { status, body } = await call(app, '/api/site-awareness/tracker');
  assert.equal(status, 200);
  assert.equal(body.applicable, true);
  assert.equal(body.snapshot.overall_pct, 72);
  assert.equal(body.pillars.length, 4);
  assert.equal(body.trend.length, 6);
});

test('fleet view is GROUP-only: site-business gets 403', async () => {
  const app = makeApp({ id: 5, roles: ['site-business'], site_id: 1 });
  const { status } = await call(app, '/api/site-awareness/fleet');
  assert.equal(status, 403);
});
test('fleet view returns a per-site RAG grid for a group user', async () => {
  const app = makeApp({ id: 9, roles: ['group-business'] });
  const { status, body } = await call(app, '/api/site-awareness/fleet');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.sites) && body.sites.length >= 1);
  const r = body.sites[0];
  assert.ok(r.cells && r.cells.helpdesk && r.cells.tracker && r.overall_rag);
});

// REGRESSION (prod bug 2026-08-25): on postgres, rdb.listSites / listSiteModuleCodes return a
// PROMISE. siteResolve is pure/sync — the route MUST pre-await them, else `.map` on a Promise
// throws → every response degrades to the empty fallback (authorized_sites: []) and the page shows
// "no site assigned" for EVERY user, including a group/super_admin. This test drives ASYNC fakes.
test('dual-backend: async (postgres-style) listSites/listSiteModuleCodes are awaited, not treated as arrays', async () => {
  const SITES = [{ id: 1, name: 'Hounde', zoho_group: 'Hounde IT Agents' }, { id: 2, name: 'Mana', zoho_group: 'Mana IT Agent' }];
  const CODES = [{ site_id: 1, code: 'HGO' }, { site_id: 2, code: 'MGO' }];
  const rdb = {
    listSites: () => Promise.resolve(SITES),                                   // async, like pg
    listSiteModuleCodes: (m) => Promise.resolve(m === 'meetings' ? CODES : []), // async, like pg
    userHasRole: (u, r) => (u.roles || []).includes(r),
  };
  const requireReportSession = (req, _res, next) => { req.reportUser = { id: 9, roles: ['group-business'] }; next(); };
  const app = express();
  app.use(require('../routes/siteAwareness')({ express, requireReportSession, rdb }));
  const { status, body } = await call(app, '/api/site-awareness/summary');
  assert.equal(status, 200);
  assert.equal(body.is_group_view, true);
  assert.ok(Array.isArray(body.authorized_sites) && body.authorized_sites.length === 2,
    'async listSites must be awaited → both sites, not the empty fallback');
  assert.equal(body.site_name, 'Hounde');
});

test('audit is super_admin-only and returns a per-site linkage table', async () => {
  const nonSuper = makeApp({ id: 5, roles: ['group-business'] });
  assert.equal((await call(nonSuper, '/api/site-awareness/audit')).status, 403);
  const sup = makeApp({ id: 1, roles: ['super_admin'] });
  const { status, body } = await call(sup, '/api/site-awareness/audit');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.sites) && body.sites.length >= 1);
  const r = body.sites[0];
  assert.ok(r.helpdesk && r.meetings && r.inspections && r.tracker && 'active' in r);
});
