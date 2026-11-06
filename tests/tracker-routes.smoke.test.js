'use strict';
// E-A01b — the /api/tracker/* routes (extracted from server.js into routes/tracker.js) keep their
// gates and answers; POST /api/tracker/delete-year now snapshots the year (blob) and journals a
// risk-flagged system_log row, and refuses (400, nothing deleted) when the snapshot cannot be written.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'trk-routes-'));
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'trk-smoke-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, superToken, viewerToken, editorToken, rdb, tdb, blobStore;

function req(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (token) headers['x-report-token'] = token;
    if (body) headers['content-type'] = 'application/json';
    const r = http.request(base + path, { method, headers, agent: false },
      (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b ? (() => { try { return JSON.parse(b); } catch { return b; } })() : null })); });
    r.on('error', reject); r.end(body ? JSON.stringify(body) : undefined);
  });
}

async function addYear(y) {
  const h = tdb.pgHandle();
  const cfg = await h.prepare('SELECT years_json FROM tracker_config WHERE id=1').get();
  const years = JSON.parse(cfg.years_json || '[]');
  if (!years.includes(2026)) years.push(2026);
  await h.prepare('INSERT INTO tracker_years (year,active) VALUES (2026,1) ON CONFLICT DO NOTHING').run();
  years.push(y);
  await h.prepare('UPDATE tracker_config SET years_json=? WHERE id=1').run(JSON.stringify(years));
  await h.prepare('INSERT INTO tracker_years (year,active) VALUES (?,1) ON CONFLICT DO NOTHING').run(y);
  const p = await h.prepare(`INSERT INTO tracker_pillars (year,code,name,weight,display_order,active) VALUES (?,'PX','Pillar X',25,0,1)`).run(y);
  const a = await h.prepare(`INSERT INTO tracker_activities (pillar_id,code,name,kpi_type,start_month,end_month,display_order,active,weight,shared) VALUES (?,'AX','Act X','COUNT',1,12,0,1,0,0)`).run(p.lastID);
  await h.prepare(`INSERT INTO tracker_inputs_v2 (year,site,activity_id,months_json) VALUES (?,'HGO',?,'[3,0,0,0,0,0,0,0,0,0,0,0]')`).run(y, a.lastID);
}

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db'); tdb = require('../tracker-db'); blobStore = require('../services/blobStore');
  const su = ((await rdb.listUsers()) || []).find((u) => u.username === process.env.DASH_USER);
  await rdb.setUserRoles(su.id, ['super_admin']);
  superToken = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  await rdb.createUser({ username: 'trk-viewer', full_name: 'V', password: 'trk-viewer-pass-1', role: 'viewer' });
  viewerToken = (await rdb.login('trk-viewer', 'trk-viewer-pass-1')).token;
  await rdb.createUser({ username: 'trk-editor', full_name: 'E', password: 'trk-editor-pass-1', role: 'editor', roles: ['editor', 'tracker-editor'] });
  editorToken = (await rdb.login('trk-editor', 'trk-editor-pass-1')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} try { _fs.rmSync(_path.join(blobStore.BLOB_ROOT, 'tracker'), { recursive: true, force: true }); } catch {} });

test('tracker routes answer 401 without a session', async () => {
  assert.equal((await req('GET', '/api/tracker/load')).status, 401);
  for (const p of ['save', 'import-dept-meetings', 'export', 'reset', 'delete-year']) assert.equal((await req('POST', '/api/tracker/' + p)).status, 401, p);
});

test('load: super_admin 200 with D, viewer 403', async () => {
  const r = await req('GET', '/api/tracker/load', superToken);
  assert.equal(r.status, 200);
  assert.ok(r.body.D && Array.isArray(r.body.D.years));
  assert.equal(r.body.scope, null);
  assert.equal((await req('GET', '/api/tracker/load', viewerToken)).status, 403);
});

test('save without D is 400; export without params is 400; reset is 501 on PostgreSQL', async () => {
  assert.equal((await req('POST', '/api/tracker/save', superToken, {})).status, 400);
  assert.equal((await req('POST', '/api/tracker/export', superToken, {})).status, 400);
  assert.equal((await req('POST', '/api/tracker/reset', superToken, {})).status, 501);
});

test('delete-year: viewer and tracker-editor get 403; GET preview unchanged', async () => {
  await addYear(2093);
  for (const t of [viewerToken, editorToken]) {
    assert.equal((await req('POST', '/api/tracker/delete-year', t, { year: 2093 })).status, 403);
    assert.equal((await req('GET', '/api/tracker/delete-year?year=2093', t)).status, 403);
  }
  const p = await req('GET', '/api/tracker/delete-year?year=2093', superToken);
  assert.equal(p.status, 200);
  assert.equal(p.body.year, 2093);
  assert.equal(p.body.inputs_will_be_deleted, 1);
  assert.equal(p.body.is_in_config, true);
  assert.equal((await req('GET', '/api/tracker/delete-year?year=abc', superToken)).status, 400);
});

test('delete-year snapshots the year, returns backup_path, journals system_log', async () => {
  const r = await req('POST', '/api/tracker/delete-year', superToken, { year: 2093 });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  const ref = r.body.summary.backup_path;
  assert.ok(ref, 'backup_path is not null');
  const snap = JSON.parse(Buffer.from(blobStore.getB64(ref), 'base64').toString('utf8'));
  assert.equal(snap.tables.tracker_inputs_v2.length, 1);
  assert.ok(!r.body.D.years.includes(2093));
  let rows = [];   // logEvent is fire-and-forget — poll briefly for the row
  for (let i = 0; i < 40 && !rows.length; i++) { rows = (await rdb.listSystemLog({ category: 'tracker', action: 'tracker_year_deleted' })).rows; if (!rows.length) await new Promise((r) => setTimeout(r, 50)); }
  assert.equal(rows.length, 1);
  assert.equal(rows[0].risk, 1);
  assert.equal(rows[0].target, '2093');
  const d = JSON.parse(rows[0].details);
  assert.equal(d.backup_path, ref);
  assert.equal(d.counts.tracker_inputs_v2, 1);
});

test('delete-year refuses (400) and deletes nothing when the snapshot cannot be written', async () => {
  await addYear(2094);
  const blocker = _path.join(blobStore.BLOB_ROOT, 'tracker');
  _fs.rmSync(blocker, { recursive: true, force: true });
  _fs.mkdirSync(blobStore.BLOB_ROOT, { recursive: true });
  _fs.writeFileSync(blocker, 'not a directory');
  try {
    const r = await req('POST', '/api/tracker/delete-year', superToken, { year: 2094 });
    assert.equal(r.status, 400);
    const n = (await tdb.pgHandle().prepare('SELECT count(*)::int n FROM tracker_years WHERE year=?').get(2094)).n;
    assert.equal(n, 1, 'year still present');
  } finally { _fs.rmSync(blocker, { force: true }); }
});
