'use strict';
// P9 / goal B7 — the export policy on the live router:
//  1. every export / download route carries the policy gate (or is exempted below, with the reason);
//  2. default (export_policy_strict = '0') keeps today's access; strict refuses the PROPOSED rows;
//  3. every delivered export lands in system_log, category `export` (who, module, format, site scope, rows);
//  4. export_watermark_enabled = '1' stamps the file (CSV last line, XLSX first sheet) + a response header.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'xpol-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'xp-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'xp-super-pass-0000';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, cfgMod, A, tok = {};
const get = (p, t) => fetch(base + p, { headers: t ? { 'x-report-token': t } : {} });
const setCfg = (patch) => cfgMod.setConfig(rdb.db, patch, 'test');

// Download routes that are NOT data exports — the policy does not apply (reason kept here, reviewed with the matrix).
const EXEMPT = [
  [/^\/api\/engagement\/share\//, 'share-link management (the shared page itself is the governed surface)'],
  [/^\/api\/field\/uploads\//, 'field upload transfer (inbound file chunks)'],
  [/^\/api\/governance\/sessions\/:id\/minutes\/send$/, 'e-mail delivery of minutes (own approval flow)'],
  [/^\/api\/save-pptx$/, 'upload of a browser-built deck to the server'],
];
const EXPORT_RE = /(export|\.xlsx|\.csv|\.json$|pptx|\.pdf|minutes|download|risk-register-export|\/uploads\/:|\.:fmt|evidence\.html|report\.html|sites\/master|governance\/oversight|legacy\/compare)/i;

function collect(stack, out) {
  for (const l of stack) {
    if (l.route) {
      for (const p of [].concat(l.route.path)) if (typeof p === 'string') for (const m of Object.keys(l.route.methods)) out.push({ method: m.toUpperCase(), path: p, names: l.route.stack.map((s) => s.name) });
    } else if (l.name === 'router' && l.handle && l.handle.stack) collect(l.handle.stack, out);
  }
}

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfgMod = require('../services/reportConfig');
  const sites = (await rdb.listSites()) || [];
  A = sites.find((s) => /hounde/i.test(s.name));
  const me = ((await rdb.listUsers()) || []).find((u) => u.username === process.env.DASH_USER);
  await rdb.setUserRoles(me.id, ['super_admin']);
  tok.super = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  const mk = async (u, roles, site) => { await rdb.createUser({ username: u, full_name: u, password: u + '-pw-0000', roles, site_id: site }); tok[u] = (await rdb.login(u, u + '-pw-0000')).token; };
  await mk('xp-viewA', ['viewer'], A.id);
  await mk('xp-edA', ['editor'], A.id);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('every export / download route carries the export policy gate (or a documented exemption)', () => {
  const routes = []; collect(require('../services/routerStack').routerStack(require('../server').app), routes);
  const exp = routes.filter((r) => r.path.startsWith('/api/') && EXPORT_RE.test(r.path) && !/import\/template|incubation\/template/.test(r.path));
  assert.ok(exp.length >= 45, `too few export routes (${exp.length})`);
  // a path registered several times (shared read-scope guards first, then the handler) is covered when ANY of its layers gates
  const gated = new Set(exp.filter((r) => r.names.includes('exportPolicyGate')).map((r) => `${r.method} ${r.path}`));
  const missing = [...new Set(exp.filter((r) => !EXEMPT.some(([re]) => re.test(r.path))).map((r) => `${r.method} ${r.path}`))].filter((k) => !gated.has(k));
  assert.deepEqual(missing, []);
});

test('default keeps today: a site viewer exports the action register and an editor the risk register', async () => {
  await setCfg({ export_policy_strict: '0', export_watermark_enabled: '0' });
  const r1 = await get('/api/reports/site-actions/export.xlsx?site=HGO', tok['xp-viewA']);
  assert.equal(r1.status, 200, await r1.text());
  const r2 = await get('/api/risk-register-export?month=2026-10', tok['xp-edA']);
  assert.equal(r2.status, 200);
  assert.equal(r2.headers.get('x-export-watermark'), null, 'no watermark by default');
});

test('strict (PROPOSED) refuses the viewer action register and the fleet risk register for a site editor', async () => {
  await setCfg({ export_policy_strict: '1' });
  try {
    const r1 = await get('/api/reports/site-actions/export.xlsx?site=HGO', tok['xp-viewA']);
    assert.equal(r1.status, 403);
    const j = await r1.json(); assert.equal(j.export_policy.decision, 'deny');
    assert.equal((await get('/api/reports/site-actions/export.xlsx?site=HGO', tok['xp-edA'])).status, 200, 'editor of the site kept');
    assert.equal((await get('/api/risk-register-export?month=2026-10', tok['xp-edA'])).status, 403);
    assert.equal((await get('/api/risk-register-export?month=2026-10', tok.super)).status, 200);
  } finally { await setCfg({ export_policy_strict: '0' }); }
});

test('every delivered export is logged under category export', async () => {
  await setCfg({ export_policy_strict: '0' });
  const r = await get('/api/reports/site-actions/export.xlsx?site=HGO', tok['xp-edA']); assert.equal(r.status, 200); await r.arrayBuffer();
  let rows = [];
  for (let i = 0; i < 30; i++) {
    rows = await rdb.db.prepare(`SELECT actor, action, target, details FROM system_log WHERE category = 'export' AND actor = ? ORDER BY ts DESC`).all('xp-edA');
    if (rows.some((x) => x.action === 'export_reports.site_actions')) break;
    await new Promise((s) => setTimeout(s, 100));
  }
  const row = rows.find((x) => x.action === 'export_reports.site_actions');
  assert.ok(row, 'export logged');
  const d = JSON.parse(row.details);
  assert.equal(d.module, 'reports'); assert.equal(d.format, 'xlsx'); assert.equal(d.site_scope, 'HGO');
  assert.ok(Number.isInteger(d.rows) && d.rows >= 0, 'row count from the workbook');
  assert.equal(d.decision, 'allow'); assert.equal(d.strict, false);
});

test('watermark switch stamps CSV (last line) and XLSX (first sheet) with the user and a timestamp', async () => {
  await setCfg({ export_watermark_enabled: '1' });
  try {
    const r = await get('/api/analytics/wan/sla/export.csv?month=2026-10', tok.super);
    assert.equal(r.status, 200);
    const text = await r.text();
    const last = text.trim().split(/\r?\n/).pop();
    assert.ok(last.includes(process.env.DASH_USER) && /\d{4}-\d\d-\d\dT/.test(last), last);
    assert.ok(decodeURIComponent(r.headers.get('x-export-watermark') || '').includes(process.env.DASH_USER));
    const x = await get('/api/reports/site-actions/export.xlsx?site=HGO', tok['xp-edA']);
    assert.equal(x.status, 200);
    const wb = require('xlsx').read(Buffer.from(await x.arrayBuffer()), { type: 'buffer' });
    assert.equal(wb.SheetNames[0], 'Export');
    assert.ok(String(wb.Sheets.Export.A1.v).includes('xp-edA'));
  } finally { await setCfg({ export_watermark_enabled: '0' }); }
});
