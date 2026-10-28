'use strict';
// G-03 / G-05 — cross-site READ sweep (committee review 2026-10-28).
//
// Every site-B object below carries a unique MARKER string. An editor locked to site A then calls
// EVERY registered GET route, with each path parameter replaced by a site-B id. A 2xx response
// whose body contains the MARKER is a leak. New routes are covered automatically: the route list
// comes from the live Express router, not from a hand-written list.
//
// Allowed exceptions must be listed in ALLOWED with the reason (none today). The sweep writes the
// observed matrix to SDP_AUTHZ_MATRIX_OUT when set (docs/sdp360/completion/AUTHZ-OBJECT-MATRIX.csv).
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'xread-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'xr-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'xr-super-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'xr-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const MARKER = 'XSITEB' + Math.random().toString(36).slice(2, 10).toUpperCase();
// Route → reason. A route listed here may return site-B data to a site-A editor.
const ALLOWED = new Map([]);

let server, base, superTok, edTok, ids;
const H = (t) => ({ 'Content-Type': 'application/json', 'x-report-token': t });
const post = (p, t, b) => fetch(base + p, { method: 'POST', headers: H(t), body: JSON.stringify(b || {}) });

function collect(stack, out) {
  for (const l of stack) {
    if (l.route) {
      for (const p of [].concat(l.route.path)) if (typeof p === 'string' && l.route.methods.get) out.push(p);
    } else if (l.name === 'router' && l.handle && l.handle.stack) collect(l.handle.stack, out);
  }
}

const PREFIXES = ['/api/meetings', '/api/inspection', '/api/reports', '/api/sites', '/api/commitments', '/api/site-actions', '/api/actions'];
const SKIP = [/^\/api\/reports\/auth\//, /\/lookups/, /\/people/];

// Builds the probe URL for a route: path params → site-B ids; list routes get a site-B filter.
function probeFor(path) {
  if (!PREFIXES.some((x) => path.startsWith(x)) || SKIP.some((re) => re.test(path))) return null;
  const mod = path.startsWith('/api/meetings') ? 'meetings' : path.startsWith('/api/inspection') ? 'inspection' : 'reports';
  const segs = path.split('/');
  let ok = true;
  const out = segs.map((seg, k) => {
    if (!seg.startsWith(':')) return seg;
    const name = seg.slice(1).replace(/\?$/, '');
    const prev = segs[k - 1] || '';
    let v;
    if (name === 'year') v = 2026;
    else if (name === 'month') v = 9;
    else if (name === 'week') v = 37;
    else if (/source_report_id/.test(name)) v = ids.report;
    else if (mod === 'meetings') v = prev === 'issues' ? ids.issue : prev === 'actions' ? ids.mAction : ids.pv;
    else if (mod === 'inspection') v = prev === 'actions' ? ids.iAction : ids.insp;
    else if (/site/i.test(name)) v = ids.siteB;
    else if (/uid/i.test(name)) v = ids.actionUid;
    else if (/^(id|reportId|report_id)$/.test(name)) v = ids.report;
    if (v == null) { ok = false; return seg; }
    return encodeURIComponent(String(v));
  }).join('/');
  if (!ok) return null;
  // A list route is probed twice: asking for site B explicitly, and with the default scope.
  return path.includes(':') ? [out] : [`${out}?site=SGO&site_code=SGO&site_id=${ids.siteB}&year=2026&month=9`, out];
}

// Text of a response; office/zip payloads are unzipped so compressed exports are checked too.
async function bodyText(r) {
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b) {
    try {
      const zip = await require('jszip').loadAsync(buf);
      const parts = await Promise.all(Object.values(zip.files).filter((f) => !f.dir && /\.(xml|rels|txt|csv|json)$/.test(f.name)).map((f) => f.async('string')));
      return parts.join('\n');
    } catch (_) { /* not a zip after all */ }
  }
  return buf.toString('utf8');
}

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  const sites = (await rdb.listSites()) || [];
  const A = sites.find((s) => s.name === 'Hounde');
  const B = sites.find((s) => s.name === 'Sabodala');
  assert.ok(A && B, 'seeded sites Hounde + Sabodala');
  const me = ((await rdb.listUsers()) || []).find((u) => u.username === process.env.DASH_USER);
  await rdb.setUserRoles(me.id, ['super_admin']);
  superTok = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  await rdb.createUser({ username: 'xr-editor', full_name: 'Site A editor', password: 'xr-editor-0000', roles: ['editor'], site_id: A.id });
  edTok = (await rdb.login('xr-editor', 'xr-editor-0000')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;

  const s = await post('/api/meetings/save', superTok, { state: {
    header: { site_code: 'SGO', department: 'Mining', meeting_date: '2026-09-10', status: 'draft', priority_1: MARKER },
    issues: [{ ord: 1, title: MARKER + ' issue', category: 'CN', severity: 'HIGH', status: 'open' }],
    actions: [{ ord: 1, description: MARKER + ' action', owner_it: 'someone', status: 'open' }],
  } });
  assert.equal(s.status, 200, await s.text());
  const pvId = (await s.json()).id;
  const pv = await (await fetch(`${base}/api/meetings/${pvId}`, { headers: H(superTok) })).json();

  const i = await post('/api/inspection/save', superTok, { state: {
    meta: { f_site: 'Sabodala (SGO)', f_date: '2026-09-10', f_area: 'Server room', f_obs: MARKER },
    items: {}, actions: [{ desc: MARKER + ' corrective', owner: 'x', due: '2026-10-01', priority: 'High' }],
  } });
  assert.equal(i.status, 200, await i.text());
  const inspId = (await i.json()).id;
  const insp = await (await fetch(`${base}/api/inspection/${encodeURIComponent(inspId)}`, { headers: H(superTok) })).json();

  const rep = await rdb.ensureReport(B.id, 2026, 37);
  await rdb.saveActionItems(rep.id, [{ task: MARKER + ' follow-up', status: 'open', owner: 'x', department: 'IT' }]);
  const full = await rdb.getReport(rep.id);
  ids = {
    siteB: B.id, pv: pvId, issue: pv.issues[0].id, mAction: pv.actions[0].id,
    insp: inspId, iAction: insp.actions[0].id, report: rep.id,
    actionUid: (full.action_items || [])[0] && full.action_items[0].uid,
  };
});
after(() => { try { server && server.close(); } catch {} });

test('a site-A editor never reads site-B content through any GET route', async () => {
  const { app } = require('../server');
  const paths = []; collect(app._router.stack, paths);
  const rows = [], leaks = [];
  for (const p of [...new Set(paths)]) {
    for (const url of probeFor(p) || []) {
      const r = await fetch(base + url, { headers: H(edTok) });
      const body = await bodyText(r);
      const leaked = r.status >= 200 && r.status < 300 && body.includes(MARKER);
      rows.push({ route: url.includes('?') ? p + ' (site=B)' : p, probe: url, status: r.status, leaked });
      if (leaked && !ALLOWED.has(p)) leaks.push(`${url} → ${r.status}`);
    }
  }
  if (process.env.SDP_AUTHZ_MATRIX_OUT) {
    const csv = ['route,persona,object_site,status,site_b_content_returned,verdict']
      .concat(rows.map((x) => [x.route, 'editor@siteA', 'B', x.status, x.leaked ? 'yes' : 'no',
        x.leaked ? (ALLOWED.has(x.route) ? 'ALLOWED: ' + ALLOWED.get(x.route) : 'LEAK') : 'DENIED_OR_EMPTY'].join(',')));
    _fs.writeFileSync(process.env.SDP_AUTHZ_MATRIX_OUT, csv.join('\n') + '\n');
  }
  assert.ok(rows.length >= 90, `sweep probed too few routes (${rows.length}) — substitution broke`);
  assert.deepEqual(leaks, [], `site-B content returned to a site-A editor:\n${leaks.join('\n')}`);
});

test('the sweep would see a leak: the super admin reads the same site-B objects', async () => {
  for (const u of [`/api/meetings/${ids.pv}`, `/api/inspection/${encodeURIComponent(ids.insp)}`, `/api/reports/${ids.report}`,
    '/api/meetings/issues', '/api/meetings/actions', '/api/inspection/actions', '/api/meetings/export.xlsx']) {
    const r = await fetch(base + u, { headers: H(superTok) });
    assert.equal(r.status, 200, u);
    assert.ok((await r.text()).includes(MARKER), `${u} carries the marker for an authorised reader`);
  }
});
