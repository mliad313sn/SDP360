'use strict';
// G-13 / G-14 — report run release controls over HTTP: separation of duties, review voided by a later edit,
// a published run cannot be re-reviewed, freshness gate with a real sync row, withdrawal (admin, reason) hides
// the run from readers and from share links.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'rel-smoke-'));
process.env.DASH_USER = process.env.DASH_USER || 'rel-admin0';
process.env.DASH_PASS = process.env.DASH_PASS || 'rel-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'rel-key';
process.env.AI_PROVIDER = 'off';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, hounde, T = {};

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db');
  for (let i = 0; i < 60; i++) { try { if ((await rdb.db.prepare("SELECT 1 FROM report_templates WHERE key='site-weekly-pack'").get()) && (await rdb.db.prepare("SELECT 1 FROM dashboard_definitions WHERE key='site-weekly' AND status='published'").get())) break; } catch (_) {} await new Promise(r => setTimeout(r, 100)); }
  hounde = (await rdb.listSites({ includeInactive: true })).find((s) => /hounde/i.test(s.name)).id;
  const mk = async (u, roles, site) => { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); return (await rdb.login(u, u + 'pass1234')).token; };
  T.admin = await mk('rel_admin', ['admin']);
  T.admin2 = await mk('rel_admin2', ['admin']);
  T.authorA = await mk('rel_authorA', ['viewer', 'report-author'], hounde);
  T.authorB = await mk('rel_authorB', ['viewer', 'report-author'], hounde);
  T.viewer = await mk('rel_viewer', ['viewer'], hounde);
  T.editor = await mk('rel_editor', ['editor'], hounde);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const send = (m, p, t, body) => fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
const get = (p, t) => fetch(base + p, { headers: t ? { 'x-report-token': t } : {} });
const gen = async (t) => { const r = await send("POST", "/api/report-studio/templates/site-weekly-pack/generate", t, { site_id: hounde }); const j = await r.json(); assert.ok(j.run, `generate: ${r.status} ${JSON.stringify(j)}`); return j.run.id; };
async function markSynced(job, hoursAgo) {
  const t = new Date(Date.now() - hoursAgo * 3600e3).toISOString();
  await require('../services/sync').ensureReady();
  await rdb.db.prepare("INSERT INTO sync_runs (job, started_at, finished_at, status) VALUES (?, ?, ?, 'ok')").run(job, t, t);
}

test('separation of duties: the creator can neither review nor publish their own run', async () => {
  const id = await gen(T.authorA);
  assert.equal((await send('POST', `/api/report-studio/runs/${id}/review`, T.authorA, { status: 'reviewed' })).status, 403);
  assert.equal((await send('POST', `/api/report-studio/runs/${id}/review`, T.authorB, { status: 'reviewed' })).status, 200);
  const own = await send('POST', `/api/report-studio/runs/${id}/publish`, T.authorA, {});
  assert.equal(own.status, 403); assert.equal((await own.json()).code, 'SOD_PUBLISH_OWN');
});

test('a commentary edit after review sends the run back to draft; its editor cannot then review it', async () => {
  const id = await gen(T.authorA);
  assert.equal((await send('POST', `/api/report-studio/runs/${id}/review`, T.authorB, { status: 'reviewed' })).status, 200);
  const e = await (await send('PUT', `/api/report-studio/runs/${id}/commentary`, T.authorB, { text: 'reworded after review' })).json();
  assert.equal(e.run.status, 'draft', 'review voided');
  assert.equal((await send('POST', `/api/report-studio/runs/${id}/publish`, T.admin, {})).status, 409, 'a draft cannot be published');
  const r = await send('POST', `/api/report-studio/runs/${id}/review`, T.authorB, { status: 'reviewed' });
  assert.equal(r.status, 403); assert.equal((await r.json()).code, 'SOD_REVIEW_EDIT');
});

test('fresh sources publish without override; a published run cannot be re-reviewed; withdrawal hides it', async () => {
  const id = await gen(T.authorA);
  assert.equal((await send('POST', `/api/report-studio/runs/${id}/review`, T.authorB, { status: 'reviewed' })).status, 200);
  await markSynced('zoho.requests', 5);
  const stale = await send('POST', `/api/report-studio/runs/${id}/publish`, T.authorB, {});
  assert.equal(stale.status, 409, 'a 5-hour-old helpdesk sync is stale (limit 3 h)');
  assert.equal((await send('POST', `/api/report-studio/runs/${id}/publish`, T.authorB, { override_reason: 'author is not admin so no override' })).status, 409, 'only an admin may override');
  await markSynced('zoho.requests', 0.5);
  const pb = await send('POST', `/api/report-studio/runs/${id}/publish`, T.authorB, {});
  assert.equal(pb.status, 200, await pb.text());
  const run = (await pb.json()).run; assert.equal(run.status, 'published'); assert.equal(run.publish_override, null);
  assert.equal((await send('POST', `/api/report-studio/runs/${id}/review`, T.admin, { status: 'rejected' })).status, 409, 'published run is not re-reviewed');
  assert.equal((await get(`/api/report-studio/runs/${id}`, T.viewer)).status, 200, 'site viewer reads the published run');
  const share = await (await send('POST', '/api/engagement/share', T.editor, { target_kind: 'report_run', target_key: String(id) })).json();
  assert.equal(share.ok, true, JSON.stringify(share));
  assert.equal((await get(`/share/${share.token}`)).status, 200);
  assert.equal((await send('POST', `/api/report-studio/runs/${id}/withdraw`, T.authorB, { reason: 'wrong week' })).status, 403, 'withdraw is admin only');
  assert.equal((await send('POST', `/api/report-studio/runs/${id}/withdraw`, T.admin, { reason: 'x' })).status, 400, 'reason required');
  const wd = await (await send('POST', `/api/report-studio/runs/${id}/withdraw`, T.admin, { reason: 'figures from the wrong week' })).json();
  assert.equal(wd.run.status, 'withdrawn'); assert.equal(wd.run.withdraw_reason, 'figures from the wrong week');
  assert.equal((await get(`/api/report-studio/runs/${id}`, T.viewer)).status, 403, 'readers no longer see it');
  assert.equal((await get(`/share/${share.token}`)).status, 404, 'share link stops working');
  assert.equal((await send('PUT', `/api/report-studio/runs/${id}/commentary`, T.authorB, { text: 'late' })).status, 409, 'withdrawn run is frozen');
});

test('G07: the released content is frozen in the database; a withdrawn run is corrected by a new run that names it', async () => {
  const id = await gen(T.authorA);
  assert.equal((await send('POST', `/api/report-studio/runs/${id}/review`, T.authorB, { status: 'reviewed' })).status, 200);
  await markSynced('zoho.requests', 0.5);
  assert.equal((await send('POST', `/api/report-studio/runs/${id}/publish`, T.authorB, {})).status, 200);
  const pub = await rdb.db.prepare('SELECT html, html_sha256, row_hash FROM report_publications WHERE run_id=?').get(id);
  assert.ok(pub && pub.html.length > 100 && /^[0-9a-f]{64}$/.test(pub.html_sha256) && pub.row_hash, 'publication stored, hashed and chained');
  assert.strictEqual(require('crypto').createHash('sha256').update(pub.html, 'utf8').digest('hex'), pub.html_sha256);
  // a re-render behind the application changes the run row, never what readers get
  await rdb.db.prepare("UPDATE report_runs SET html='<p>tampered</p>' WHERE id=?").run(id);
  const h = await get(`/api/report-studio/runs/${id}.html`, T.viewer);
  assert.equal(h.headers.get('x-sdp-publication-sha256'), pub.html_sha256);
  assert.ok(!(await h.text()).includes('tampered'), 'served from the frozen publication');
  let refused = false; try { await rdb.db.prepare("UPDATE report_publications SET html='x' WHERE run_id=?").run(id); } catch (_) { refused = true; }
  assert.ok(refused, 'publications are append-only');
  // correction: only a withdrawn run of the same template + site can be superseded
  const early = await (await send('POST', '/api/report-studio/templates/site-weekly-pack/generate', T.authorA, { site_id: hounde, supersedes_id: id })).json();
  assert.equal(early.ok, false, 'a published (not withdrawn) run cannot be superseded');
  await send('POST', `/api/report-studio/runs/${id}/withdraw`, T.admin, { reason: 'site filter was wrong for this week' });
  const fix = await (await send('POST', '/api/report-studio/templates/site-weekly-pack/generate', T.authorA, { site_id: hounde, supersedes_id: id })).json();
  assert.equal(fix.ok, true, JSON.stringify(fix)); assert.equal(Number(fix.run.supersedes_id), id);
  const twice = await send('POST', '/api/report-studio/templates/site-weekly-pack/generate', T.authorA, { site_id: hounde, supersedes_id: id });
  assert.equal(twice.status, 409, 'one correction per withdrawn run');
  // the CSV of a published run comes from the frozen figures too, and so does a share link
  const fixId = fix.run.id;
  assert.equal((await send('POST', `/api/report-studio/runs/${fixId}/review`, T.authorB, { status: 'reviewed' })).status, 200);
  await markSynced('zoho.requests', 0.5);
  assert.equal((await send('POST', `/api/report-studio/runs/${fixId}/publish`, T.authorB, {})).status, 200);
  await rdb.db.prepare("UPDATE report_runs SET html='<p>tampered</p>', figures='[]' WHERE id=?").run(fixId);
  const csv = await (await get(`/api/report-studio/runs/${fixId}.csv`, T.viewer)).text();
  assert.ok(csv.split('\n').length > 2, 'CSV rows come from the frozen figures');
  const share = await (await send('POST', '/api/engagement/share', T.editor, { target_kind: 'report_run', target_key: String(fixId) })).json();
  assert.ok(!(await (await get(`/share/${share.token}`)).text()).includes('tampered'), 'share link shows the frozen copy');
  assert.ok(await rdb.db.prepare('SELECT 1 FROM report_publications WHERE run_id=?').get(id), 'the withdrawn publication stays as the record');
});
