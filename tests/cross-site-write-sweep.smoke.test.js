'use strict';
// G-04 — cross-site WRITE sweep (committee review 2026-10-28), sibling of cross-site-read-sweep.
//
// An editor locked to site A calls EVERY registered POST / PUT / PATCH / DELETE route of the site-scoped
// modules with each path parameter replaced by a site-B id, and a body that would pass validation on
// most routes (status change + comment + ticket number). Two checks:
//   1. no 2xx response;
//   2. the site-B objects (PV, inspection, weekly report) read back IDENTICAL by the super admin afterwards
//      — a route that answered 400/500 but still wrote something is caught here.
// Routes come from the live router, so a new write route is covered automatically.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'xwrite-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'xw-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'xw-super-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'xw-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const PREFIXES = ['/api/meetings', '/api/inspection', '/api/reports', '/api/sites'];
// Not object-scoped (session, account and admin settings routes have their own role tests).
const SKIP = [/^\/api\/reports\/auth\//, /^\/api\/reports\/(users|sessions|config|sites|departments|directory|schedules?|send|test-smtp)/,
  /\/lookups/, /\/reset$/, /\/import\//];
// A body that clears validation on most write routes, so a missing site check shows as a 2xx or a change.
const BODY = { status: 'closed', status_change: 'resolved', body: 'cross-site probe', note: 'probe', comment: 'probe',
  helpdesk_ticket: '123456', which: 'site_it', description: 'probe', task: 'probe', lineage: 'probe', source: 'meetings',
  origin_id: 1, items: [], actions: [], kpis: [], week: 1, year: 2026, notes: 'probe' };

let server, base, superTok, edTok, ids;
const H = (t) => ({ 'Content-Type': 'application/json', 'x-report-token': t });

function collect(stack, out) {
  for (const l of stack) {
    if (l.route) {
      for (const p of [].concat(l.route.path)) if (typeof p === 'string') for (const m of Object.keys(l.route.methods)) out.push({ method: m.toUpperCase(), path: p });
    } else if (l.name === 'router' && l.handle && l.handle.stack) collect(l.handle.stack, out);
  }
}

function urlFor(path) {
  if (!path.includes(':') || !PREFIXES.some((x) => path.startsWith(x)) || SKIP.some((re) => re.test(path))) return null;
  const mod = path.startsWith('/api/meetings') ? 'meetings' : path.startsWith('/api/inspection') ? 'inspection' : 'reports';
  const segs = path.split('/');
  let ok = true;
  const out = segs.map((seg, k) => {
    if (!seg.startsWith(':')) return seg;
    const name = seg.slice(1).replace(/\?$/, '');
    const prev = segs[k - 1] || '';
    let v;
    if (name === 'year') v = 2026; else if (name === 'month') v = 9; else if (name === 'week') v = 37;
    else if (/source_report_id/.test(name)) v = ids.report;
    else if (mod === 'meetings') v = prev === 'issues' ? ids.issue : prev === 'actions' ? ids.mAction : ids.pv;
    else if (mod === 'inspection') v = prev === 'actions' ? ids.iAction : ids.insp;
    else if (/site/i.test(name)) v = ids.siteB;
    else if (/uid/i.test(name)) v = ids.actionUid;
    else if (/^(id|reportId|report_id)$/.test(name)) v = ids.report;
    if (v == null) { ok = false; return seg; }
    return encodeURIComponent(String(v));
  }).join('/');
  return ok ? out : null;
}

// Everything a write could change on the site-B objects, read by the super admin.
async function snapshot() {
  const read = async (u) => { const r = await fetch(base + u, { headers: H(superTok) }); return r.status + ':' + (await r.text()); };
  return [await read(`/api/meetings/${ids.pv}`), await read(`/api/inspection/${encodeURIComponent(ids.insp)}`),
    await read(`/api/reports/${ids.report}`), await read(`/api/reports/monthly/${ids.siteB}/2026/9`),
    await read(`/api/reports/objectives/${ids.siteB}/2026`)]
    .map((s) => s.replace(/"(last_seen|fetched_at|generated_at|now|as_of)":"[^"]*"/g, '"$1":""'));
}

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  const sites = (await rdb.listSites()) || [];
  const A = sites.find((s) => /hounde/i.test(s.name));
  const B = sites.find((s) => /sabodala/i.test(s.name));
  assert.ok(A && B, 'seeded sites Hounde + Sabodala');
  const me = ((await rdb.listUsers()) || []).find((u) => u.username === process.env.DASH_USER);
  await rdb.setUserRoles(me.id, ['super_admin']);
  superTok = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  await rdb.createUser({ username: 'xw-editor', full_name: 'Site A editor', password: 'xw-editor-0000', roles: ['editor', 'tracker-editor'], site_id: A.id });
  edTok = (await rdb.login('xw-editor', 'xw-editor-0000')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, b) => fetch(base + p, { method: 'POST', headers: H(superTok), body: JSON.stringify(b) });

  const s = await post('/api/meetings/save', { state: {
    header: { site_code: 'SGO', department: 'Mining', meeting_date: '2026-09-10', status: 'draft' },
    issues: [{ ord: 1, title: 'B issue', category: 'CN', severity: 'HIGH', status: 'open' }],
    actions: [{ ord: 1, description: 'B action', owner_it: 'someone', status: 'open' }],
  } });
  assert.equal(s.status, 200, await s.text());
  const pvId = (await s.json()).id;
  const pv = await (await fetch(`${base}/api/meetings/${pvId}`, { headers: H(superTok) })).json();
  const i = await post('/api/inspection/save', { state: {
    meta: { f_site: 'Sabodala (SGO)', f_date: '2026-09-10', f_area: 'Server room' },
    items: {}, actions: [{ desc: 'B corrective', owner: 'x', due: '2026-10-01', priority: 'High' }],
  } });
  assert.equal(i.status, 200, await i.text());
  const inspId = (await i.json()).id;
  const insp = await (await fetch(`${base}/api/inspection/${encodeURIComponent(inspId)}`, { headers: H(superTok) })).json();
  const rep = await rdb.ensureReport(B.id, 2026, 37);
  await rdb.saveActionItems(rep.id, [{ task: 'B follow-up', status: 'open', owner: 'x', department: 'IT' }]);
  const full = await rdb.getReport(rep.id);
  ids = { siteB: B.id, pv: pvId, issue: pv.issues[0].id, mAction: pv.actions[0].id, insp: inspId,
    iAction: insp.actions[0].id, report: rep.id, actionUid: (full.action_items || [])[0] && full.action_items[0].uid };
});
after(() => { try { server && server.close(); } catch {} });

test('a site-A editor cannot change a site-B object through any write route', async () => {
  const routes = []; collect(require('../server').app._router.stack, routes);
  const writes = routes.filter((r) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method));
  const before = await snapshot();
  const accepted = [], statuses = {};
  let probed = 0;
  for (const r of writes) {
    const url = urlFor(r.path);
    if (!url) continue;
    probed++;
    const res = await fetch(base + url, { method: r.method, headers: H(edTok), body: r.method === 'DELETE' ? undefined : JSON.stringify(BODY) });
    statuses[res.status] = (statuses[res.status] || 0) + 1;
    if (res.status >= 200 && res.status < 300) accepted.push(`${r.method} ${r.path} → ${res.status}`);
  }
  // Body-scoped writes: the target is named in the body, not in the URL.
  const bodyWrites = [
    ['POST', '/api/meetings/save', { state: { id: ids.pv, header: { site_code: 'HGO', department: 'Mining', meeting_date: '2026-09-10', status: 'draft' }, issues: [], actions: [] } }],
    ['POST', '/api/meetings/save', { state: { header: { site_code: 'SGO', department: 'Mining', meeting_date: '2026-09-10', status: 'draft' }, issues: [], actions: [] } }],
    ['POST', '/api/inspection/save', { state: { meta: { f_id: ids.insp, f_site: 'Hounde (HGO)', f_date: '2026-09-10', f_area: 'x' }, items: {}, actions: [] } }],
    ['POST', '/api/inspection/save', { state: { meta: { f_site: 'Sabodala (SGO)', f_date: '2026-09-11', f_area: 'x' }, items: {}, actions: [] } }],
  ];
  for (const [m, u, b] of bodyWrites) {
    const res = await fetch(base + u, { method: m, headers: H(edTok), body: JSON.stringify(b) });
    probed++;
    if (res.status >= 200 && res.status < 300) accepted.push(`${m} ${u} (body names site B) → ${res.status}`);
  }
  const afterSnap = await snapshot();
  assert.ok(probed >= 20, `sweep probed too few write routes (${probed})`);
  assert.deepEqual(accepted, [], 'write routes accepted a site-B object from a site-A editor');
  for (let k = 0; k < before.length; k++) assert.equal(afterSnap[k], before[k], `site-B object #${k} changed (statuses ${JSON.stringify(statuses)})`);
});

test('control: the same body from the super admin does change a site-B object', async () => {
  const r = await fetch(`${base}/api/meetings/actions/${ids.mAction}/update`, { method: 'POST', headers: H(superTok), body: JSON.stringify({ status_change: 'in_progress', body: 'control' }) });
  assert.equal(r.status, 200, await r.text());
  const pv = await (await fetch(`${base}/api/meetings/${ids.pv}`, { headers: H(superTok) })).json();
  assert.equal(pv.actions.find((a) => a.id === ids.mAction).status, 'in_progress');
});
