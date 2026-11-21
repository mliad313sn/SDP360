'use strict';
// P11 round 7 (PPM seat, fix 30) — regression pins over HTTP, fictitious data only. AI-written, not a human review.
//   R7-1  a shared skill × month where THIS project alone already exceeds group capacity reads RED (certain), counted in
//         load.over — never greyed to NA.
//   R7-2  a reader who cannot read every project carrying demand gets no per-cell shared_with_other_projects flag and
//         no name of the other project; only a neutral response-level view_partial.
// (the setup below is copied from tests/portfolio-r5-ppm.smoke.test.js)
//   R5-1  a project dependency loop can be created neither through soft delete + restore nor by two opposite links
//         sent at once (one writer at a time on the dependency graph; the loop check counts soft-deleted projects).
//   R5-3  a site-scoped reader who cannot see every project with demand gets no capacity colour (capacity is
//         group-wide): partial:true, rag 'NA' — never a GREEN on a partial numerator against the full capacity.
//   R5-5  a demand window over 60 months → 400 DEMAND_WINDOW.
//   R5-6  two uploads of the same document at once → v1 and v2, no orphan blob, no 500.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ppm-r7-'));
process.env.DASH_USER = process.env.DASH_USER || 'r7-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'r7-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'r7-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, cfg, sites; const T = {};
const send = async (m, p, t, body, headers) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body !== undefined && !headers ? { 'content-type': 'application/json' } : {}, headers || {}), body: body === undefined ? undefined : (Buffer.isBuffer(body) ? body : JSON.stringify(body)) }); const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (_) {} return { status: r.status, j, txt }; };
const put = (k, t, b) => send('PUT', '/api/governance/portfolio/' + k, t, b);
const sw = (patch) => cfg.setConfig(rdb.db, patch, 'smoke');

before(async () => {
  const { app } = require('../server'); await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  for (let i = 0; i < 80; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'ppm_project_documents'").get())) break; await new Promise((r) => setTimeout(r, 100)); }
  sites = (await rdb.listSites({ includeInactive: true })).map((s) => s.id);
  const mk = async (u, roles, site) => { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); return (await rdb.login(u, u + 'pass1234')).token; };
  T.pmo = await mk('r7p_pmo', ['viewer', 'committee-member']);
  T.adm = await mk('r7p_adm', ['admin']);
  T.siteViewer = await mk('r7p_sv', ['viewer'], sites[0]);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); }); base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());

let n = 0;
const tree = async () => { n++; const prog = (await put('programme', T.pmo, { key: `r7p-g-${n}`, name: 'G' + n })).j.id; const obj = (await put('objective', T.pmo, { programme_id: prog, key: `r7p-o-${n}`, name: 'O' + n })).j.id; return { obj }; };
const proj = async (obj, key, site) => { const r = await put('project', T.pmo, { objective_id: obj, key, name: key, owner: 'r7p_pmo', site_id: site }); assert.strictEqual(r.status, 200, r.txt); return r.j.id; };
const dep = (pid, pred) => send('POST', `/api/governance/ppm/project/${pid}/dependencies`, T.pmo, { predecessor_project_id: pred, description: 'x' });


test('R7-1 / R7-2 — project demand: certain RED kept on a shared cell; sharing told only to a full-portfolio reader', async () => {
  await sw({ ppm_resource_demand_enabled: '1', ppm_capacity_fte: JSON.stringify({ '*': 1.5 }), portfolio_site_scope_reads: '1' });
  try {
    const t = await tree();
    const P1 = await proj(t.obj, 'R7P-K1', sites[0]), P2 = await proj(t.obj, 'R7P-K2', sites[1]);
    const ad = async (p, skill, f, m) => { const r = await send('POST', `/api/governance/ppm/project/${p}/demand`, T.pmo, { skill, avg_fte: f, peak_fte: f, start_month: m, finish_month: m }); assert.strictEqual(r.status, 200, r.txt); };
    await ad(P1, 'Kappa', 2.0, '2034-01'); await ad(P2, 'Kappa', 0.1, '2034-01');     // P1 alone 2.0 > 1.5
    await ad(P1, 'Kappa', 0.5, '2034-02'); await ad(P2, 'Kappa', 1.0, '2034-02');     // shared, P1 alone under capacity
    await ad(P1, 'Lambda', 0.5, '2034-03');                                            // P1 only
    const cellOf = (j, m) => (j.load.cells || []).find((c) => c.skill === 'kappa' && c.month === m);
    // full-portfolio reader (committee member)
    const pd = (await send('GET', `/api/governance/ppm/project/${P1}/demand`, T.pmo)).j;
    const jan = cellOf(pd, '2034-01'), feb = cellOf(pd, '2034-02');
    assert.equal(jan.rag, 'RED', 'R7-1: this project alone is over capacity — certain RED'); assert.equal(jan.own_demand_over_capacity, true);
    assert.equal(jan.shared_with_other_projects, true);
    assert.equal(feb.rag, 'NA'); assert.equal(feb.utilisation_pct, null); assert.equal(feb.shared_with_other_projects, true);
    assert.equal(pd.load.over, 1, 'R7-1: the certain RED counts');
    assert.equal(pd.view_partial, true);
    // site-scoped reader (site of P1 only): reads P1, cannot read P2
    assert.equal((await send('GET', `/api/governance/ppm/project/${P2}/demand`, T.siteViewer)).status, 404);
    const sv = (await send('GET', `/api/governance/ppm/project/${P1}/demand`, T.siteViewer));
    assert.equal(sv.status, 200, sv.txt);
    for (const c of sv.j.load.cells) assert.ok(!('shared_with_other_projects' in c), 'R7-2: no per-cell sharing flag for a partial reader');
    assert.ok(!sv.txt.includes('R7P-K2') && !sv.txt.includes('"' + P2 + '"'), 'R7-2: the other project is never named');
    assert.equal(cellOf(sv.j, '2034-01').rag, 'RED', 'a certain RED stays RED');
    assert.equal(cellOf(sv.j, '2034-02').rag, 'NA');
    const solo = (sv.j.load.cells || []).find((c) => c.skill === 'lambda');
    assert.equal(solo.rag, 'NA', 'a partial reader cannot tell a solo cell from a shared one: no colour (no leak)');
    assert.equal(sv.j.view_partial, true); assert.match(sv.j.view_partial_note, /partial view/);
    for (const c of sv.j.load.cells) assert.ok(!(c.projects || []).includes(Number(P2)), 'R7-2: no other project id in a cell');
  } finally { await sw({ portfolio_site_scope_reads: '0', ppm_capacity_fte: '' }); }
});
