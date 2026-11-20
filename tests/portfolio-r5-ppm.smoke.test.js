'use strict';
// P11 round 5 (PPM seat) — regression pins over HTTP, fictitious data only.
//   R5-1  a project dependency loop can be created neither through soft delete + restore nor by two opposite links
//         sent at once (one writer at a time on the dependency graph; the loop check counts soft-deleted projects).
//   R5-3  a site-scoped reader who cannot see every project with demand gets no capacity colour (capacity is
//         group-wide): partial:true, rag 'NA' — never a GREEN on a partial numerator against the full capacity.
//   R5-5  a demand window over 60 months → 400 DEMAND_WINDOW.
//   R5-6  two uploads of the same document at once → v1 and v2, no orphan blob, no 500.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ppm-r5-'));
process.env.DASH_USER = process.env.DASH_USER || 'r5-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'r5-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'r5-key';
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
  T.pmo = await mk('r5p_pmo', ['viewer', 'committee-member']);
  T.adm = await mk('r5p_adm', ['admin']);
  T.siteViewer = await mk('r5p_sv', ['viewer'], sites[0]);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); }); base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());

let n = 0;
const tree = async () => { n++; const prog = (await put('programme', T.pmo, { key: `r5p-g-${n}`, name: 'G' + n })).j.id; const obj = (await put('objective', T.pmo, { programme_id: prog, key: `r5p-o-${n}`, name: 'O' + n })).j.id; return { obj }; };
const proj = async (obj, key, site) => { const r = await put('project', T.pmo, { objective_id: obj, key, name: key, owner: 'r5p_pmo', site_id: site }); assert.strictEqual(r.status, 200, r.txt); return r.j.id; };
const dep = (pid, pred) => send('POST', `/api/governance/ppm/project/${pid}/dependencies`, T.pmo, { predecessor_project_id: pred, description: 'x' });

test('R5-1a — soft delete + closing link + restore never yields a dependency loop', async () => {
  await sw({ ppm_structured_dependencies_enabled: '1', soft_delete_enabled: '1' });
  try {
    const t = await tree();
    const A = await proj(t.obj, 'R5P-A', sites[0]), B = await proj(t.obj, 'R5P-B', sites[0]), C = await proj(t.obj, 'R5P-C', sites[0]);
    assert.equal((await dep(A, B)).status, 200); assert.equal((await dep(B, C)).status, 200);
    assert.equal((await dep(C, A)).status, 409, 'control: loop refused while B is live');
    assert.equal((await send('DELETE', `/api/governance/portfolio/project/${B}`, T.pmo)).status, 200);
    const closing = await dep(C, A);
    assert.equal(closing.status, 409, 'the edges of a soft-deleted (restorable) project still count: ' + closing.txt); assert.equal(closing.j.code, 'DEP_CYCLE');
    assert.equal((await send('POST', `/api/governance/portfolio/project/${B}/restore`, T.adm, {})).status, 200);
    const g = await send('GET', '/api/governance/ppm/portfolio/dependencies', T.pmo);
    assert.deepEqual(g.j.cycles, [], 'no loop after the restore');
    assert.equal((await send('GET', `/api/governance/ppm/project/${A}/dependencies`, T.pmo)).j.in_cycle, false);
  } finally { await sw({ soft_delete_enabled: '0' }); }
});

test('R5-1b — two opposite links sent at once: never both accepted (20 rounds)', async () => {
  const t = await tree();
  let both = 0;
  for (let i = 0; i < 20; i++) {
    const X = await proj(t.obj, `R5P-X${i}`, sites[0]), Y = await proj(t.obj, `R5P-Y${i}`, sites[0]);
    const [a, b] = await Promise.all([dep(X, Y), dep(Y, X)]);
    if (a.status === 200 && b.status === 200) both++;
    assert.deepEqual([a.status, b.status].sort(), [200, 409], `round ${i}: ${a.txt} / ${b.txt}`);
  }
  assert.equal(both, 0);
  assert.deepEqual((await send('GET', '/api/governance/ppm/portfolio/dependencies', T.pmo)).j.cycles, []);
});

test('R5-3 — a site-scoped reader\'s capacity view is partial: no colour, partial:true; the committee keeps the group verdict', async () => {
  await sw({ ppm_resource_demand_enabled: '1', ppm_scenarios_enabled: '1', ppm_capacity_fte: JSON.stringify({ '*': 1.5 }), portfolio_site_scope_reads: '1' });
  try {
    const t = await tree();
    const P1 = await proj(t.obj, 'R5P-S1', sites[0]), P2 = await proj(t.obj, 'R5P-S2', sites[1]);
    for (const p of [P1, P2]) { const r = await send('POST', `/api/governance/ppm/project/${p}/demand`, T.pmo, { skill: 'Zeta engineer', avg_fte: 1, peak_fte: 1, start_month: '2031-01', finish_month: '2031-01' }); assert.strictEqual(r.status, 200, r.txt); }
    const cell = (j) => (j.cells || []).find((c) => c.skill === 'zeta engineer' && c.month === '2031-01');
    const a = (await send('GET', '/api/governance/ppm/portfolio/capacity', T.pmo)).j;
    assert.equal(a.partial, false); assert.equal(cell(a).avg_fte, 2); assert.equal(cell(a).rag, 'RED');
    const b = (await send('GET', '/api/governance/ppm/portfolio/capacity', T.siteViewer)).j;
    assert.equal(b.partial, true); assert.match(b.partial_note, /group-wide/);
    assert.equal(cell(b).avg_fte, 1); assert.equal(cell(b).rag, 'NA', 'no GREEN on a partial demand'); assert.equal(cell(b).utilisation_pct, null);
    const s = (await send('POST', '/api/governance/ppm/portfolio/scenario', T.siteViewer, { shifts: [] })).j;
    assert.equal(s.partial, true); assert.ok(s.baseline.cells.every((c) => c.rag === 'NA'));
    // R5-5 — a window longer than the calendar places is refused, never silently cut
    const w = await send('POST', `/api/governance/ppm/project/${P1}/demand`, T.pmo, { skill: 'Long skill', avg_fte: 1, start_month: '2030-01', finish_month: '2039-12' });
    assert.equal(w.status, 400, w.txt); assert.equal(w.j.code, 'DEMAND_WINDOW');
  } finally { await sw({ portfolio_site_scope_reads: '0', ppm_capacity_fte: '' }); }
});

test('R5-6 — two uploads of one document at once: v1 + v2, no 500, no orphan blob', async () => {
  await sw({ ppm_documents_enabled: '1' });
  const t = await tree(); const P = await proj(t.obj, 'R5P-DOC', sites[0]);
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 2)]);
  const up = (title) => send('POST', `/api/governance/ppm/project/${P}/documents?doc_type=design&title=${encodeURIComponent(title)}`, T.pmo, pdf, { 'content-type': 'application/pdf' });
  const dir = _path.join(require('../services/blobStore').BLOB_ROOT, 'ppm-doc', `p${P}`);
  const ls = () => { try { return new Set(_fs.readdirSync(dir)); } catch (_) { return new Set(); } };
  const beforeFiles = ls();   // the blob root may be shared with other runs (preloaded before SDP_DATA_DIR is set)
  const r = await Promise.all([up('Design pack'), up('design PACK'), up('Design pack')]);
  assert.deepEqual(r.map((x) => x.status), [200, 200, 200], r.map((x) => x.txt).join(' | '));
  assert.deepEqual(r.map((x) => x.j.document.version).sort(), [1, 2, 3], 'one version sequence per type + title, case-insensitive');
  const rows = await rdb.db.prepare('SELECT blob_ref FROM ppm_project_documents WHERE project_id=?').all(P);
  const added = [...ls()].filter((f) => !beforeFiles.has(f)).sort();
  assert.deepEqual(added, rows.map((x) => x.blob_ref.split('/').pop()).sort(), 'one new file per row, no orphan');
});
