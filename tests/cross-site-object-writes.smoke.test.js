'use strict';
const fetch = require('./_http-fetch');
// WP-M02-004 (remediation M02) — object-ID substitution: an editor scoped to site A (HGO)
// must not change, sign, delete or export an object that belongs to site B (SGO) by
// guessing its id. Covers the meetings + inspection id-keyed write routes that had no
// cross-site test. Each refusal is followed by a server-side check that nothing changed.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'xsite-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'xs-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'xs-super-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'xs-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, superTok, edTok, pv, insp;
const H = (t) => ({ 'Content-Type': 'application/json', 'x-report-token': t });
const get = (p, t) => fetch(base + p, { headers: H(t) });
const post = (p, t, b) => fetch(base + p, { method: 'POST', headers: H(t), body: JSON.stringify(b || {}) });
const del = (p, t) => fetch(base + p, { method: 'DELETE', headers: H(t) });

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  const A = (rdb.listSites() || []).find((s) => s.name === 'Hounde');
  assert.ok(A, 'seeded site Hounde');
  const me = (rdb.listUsers() || []).find((u) => u.username === process.env.DASH_USER);
  rdb.setUserRoles(me.id, ['super_admin']);
  superTok = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  rdb.createUser({ username: 'xs-editor', full_name: 'Site A editor', password: 'xs-editor-0000', roles: ['editor'], site_id: A.id });
  edTok = (await rdb.login('xs-editor', 'xs-editor-0000')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;

  // Site B (SGO) objects, created by the super admin.
  const s = await post('/api/meetings/save', superTok, { state: {
    header: { site_code: 'SGO', department: 'Mining', meeting_date: '2026-09-10', status: 'draft' },
    issues: [{ ord: 1, title: 'B issue', category: 'CN', severity: 'HIGH', status: 'open' }],
    actions: [{ ord: 1, description: 'B action', owner_it: 'someone', status: 'open' }],
  } });
  assert.equal(s.status, 200, await s.text());
  const sj = await s.json();
  pv = await (await get(`/api/meetings/${sj.id}`, superTok)).json();
  assert.ok(pv.actions && pv.actions.length && pv.issues && pv.issues.length, 'PV children created');

  const i = await post('/api/inspection/save', superTok, { state: {
    meta: { f_site: 'Sabodala (SGO)', f_date: '2026-09-10', f_area: 'Server room' },
    items: {}, actions: [{ desc: 'B corrective action', owner: 'x', due: '2026-10-01', priority: 'High' }],
  } });
  assert.equal(i.status, 200, await i.text());
  insp = await (await get(`/api/inspection/${(await i.json()).id}`, superTok)).json();
  assert.ok(insp.actions && insp.actions.length, 'inspection action created');
});
after(() => { try { server && server.close(); } catch {} });

const denied = (r) => assert.ok(r.status === 403 || r.status === 404, `expected 403/404, got ${r.status}`);

test('meetings: site-A editor cannot update a site-B action', async () => {
  const a = pv.actions[0];
  denied(await post(`/api/meetings/actions/${a.id}/update`, edTok, { status_change: 'resolved', body: 'x' }));
  const after = await (await get(`/api/meetings/${pv.header ? pv.header.id : pv.id}`, superTok)).json();
  assert.equal(after.actions.find((x) => x.id === a.id).status, a.status, 'status unchanged');
});

test('meetings: site-A editor cannot update a site-B issue or add an action to it', async () => {
  const is = pv.issues[0];
  denied(await post(`/api/meetings/issues/${is.id}/update`, edTok, { status_change: 'resolved', body: 'x' }));
  denied(await post(`/api/meetings/issues/${is.id}/actions`, edTok, { description: 'injected' }));
  const after = await (await get(`/api/meetings/${pv.header ? pv.header.id : pv.id}`, superTok)).json();
  assert.equal(after.issues.find((x) => x.id === is.id).status, is.status);
  assert.equal(after.actions.length, pv.actions.length, 'no action injected');
});

test('meetings: site-A editor cannot sign or delete a site-B PV', async () => {
  const id = pv.header ? pv.header.id : pv.id;
  denied(await post(`/api/meetings/${id}/sign`, edTok, { which: 'site_it' }));
  denied(await del(`/api/meetings/${id}`, edTok));
  const h = (await (await get(`/api/meetings/${id}`, superTok)).json()); const hdr = h.header || h;
  assert.ok(!hdr.site_it_signed_at, 'not signed');
  assert.equal((await get(`/api/meetings/${id}`, superTok)).status, 200, 'PV still exists');
});

test('inspection: site-A editor cannot update a site-B action, delete or export the inspection', async () => {
  const a = insp.actions[0];
  denied(await post(`/api/inspection/actions/${a.id}/update`, edTok, { status_change: 'Closed', body: 'x' }));
  denied(await del(`/api/inspection/${encodeURIComponent(insp.id || insp.header.id)}`, edTok));
  denied(await post(`/api/inspection/${encodeURIComponent(insp.id || insp.header.id)}/export`, edTok, {}));
  const after = await (await get(`/api/inspection/${encodeURIComponent(insp.id || insp.header.id)}`, superTok)).json();
  assert.equal(after.actions.find((x) => x.id === a.id).status, a.status, 'action unchanged, inspection still exists');
});

test('positive control: the site-A editor CAN update an action on their own site', async () => {
  const s = await post('/api/meetings/save', edTok, { state: {
    header: { site_code: 'HGO', department: 'Mining', meeting_date: '2026-09-11', status: 'draft' },
    actions: [{ ord: 1, description: 'A action', owner_it: 'me', status: 'open' }],
  } });
  assert.equal(s.status, 200, await s.text());
  const mine = await (await get(`/api/meetings/${(await s.json()).id}`, edTok)).json();
  const r = await post(`/api/meetings/actions/${mine.actions[0].id}/update`, edTok, { status_change: 'in_progress', body: 'ok' });
  assert.equal(r.status, 200, await r.text());
});

// WP-M02-005 — field quick actions: a site-scoped user could submit one with NO site, which every
// site's coordinator then saw and could mark done. Now the scoped submitter must name one of
// their own sites; a stored site-less action is closable by the admin tier only.
test('field quick action: scoped editor must give one of their own sites', async () => {
  const put = (b) => post('/api/field/quick-actions', edTok, { kind: 'sdp_ticket', subject: 'printer down', ...b });
  assert.equal((await put({ id: 'xs-qa-nosite-01' })).status, 403, 'empty site refused');
  assert.equal((await put({ id: 'xs-qa-other-001', site: 'SGO' })).status, 403, 'other site refused');
  assert.ok([200, 201].includes((await put({ id: 'xs-qa-own-0001', site: 'HGO' })).status), 'own site accepted');
});

test('field quick action: a site-less action (legacy row) is not closable by a scoped editor', async () => {
  const r = await post('/api/field/quick-actions', superTok, { id: 'xs-qa-legacy-01', kind: 'sdp_ticket', subject: 'no site' });
  assert.ok([200, 201].includes(r.status), 'admin tier may still record a site-less action');
  denied(await post('/api/field/quick-actions/xs-qa-legacy-01/done', edTok, { note: 'x' }));
  const list = await (await get('/api/field/quick-actions', edTok)).json();
  assert.ok(!list.actions.some((a) => a.id === 'xs-qa-legacy-01'), 'not listed to the scoped editor');
});


// DEC-07 (2026-10-28) — meetings + inspection READS are limited to the reader's own site(s).
test('reads: site-A editor cannot read site-B PV / inspection by id, nor ask ?site=SGO', async () => {
  const id = pv.header ? pv.header.id : pv.id, iid = encodeURIComponent(insp.id || insp.header.id);
  assert.equal((await get(`/api/meetings/${id}`, edTok)).status, 403);
  assert.equal((await get(`/api/meetings/${id}/export-pptx`, edTok)).status, 403);
  assert.equal((await get(`/api/inspection/${iid}`, edTok)).status, 403);
  for (const p of ['/api/meetings/list?site=SGO', '/api/meetings/issues?site=SGO', '/api/meetings/actions?site=SGO',
    '/api/meetings/progress?site=SGO&department=Mining', '/api/inspection/list?site=SGO', '/api/inspection/actions?site=SGO'])
    assert.equal((await get(p, edTok)).status, 403, p);
});

test('reads: lists and roll-ups returned to the site-A editor contain no site-B row', async () => {
  for (const p of ['/api/meetings/list', '/api/meetings/issues', '/api/meetings/escalations', '/api/meetings/actions',
    '/api/meetings/compliance', '/api/meetings/insights', '/api/meetings/aggregate', '/api/inspection/list', '/api/inspection/actions']) {
    const r = await get(p, edTok);
    assert.equal(r.status, 200, p);
    const b = await r.text();
    assert.ok(!/"site_code":"SGO"|"site":"SGO"/.test(b), `${p} leaked a SGO row`);
  }
});

test('reads: the admin tier still reads every site', async () => {
  const id = pv.header ? pv.header.id : pv.id;
  assert.equal((await get(`/api/meetings/${id}`, superTok)).status, 200);
  assert.match(await (await get('/api/meetings/list', superTok)).text(), /SGO/);
  assert.match(await (await get('/api/inspection/list', superTok)).text(), /SGO/);
});

test('lookups: site pickers offer only the reader\'s sites; admin tier sees all', async () => {
  const m = await (await get('/api/meetings/lookups', edTok)).json();
  assert.deepEqual(m.sites.map((x) => x.code), ['HGO']);
  const i = await (await get('/api/inspection/lookups', edTok)).json();
  assert.deepEqual(i.sites.map((x) => x.code), ['HGO']);
  assert.ok((await (await get('/api/meetings/lookups', superTok)).json()).sites.length > 1);
});
