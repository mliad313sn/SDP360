'use strict';
// E-I06 — routes: switch 0 = today's close behaviour (no verification field, verify 404, repeat 404); switch 1 =
// a closed High action is "awaiting verification", the closer cannot verify it (SELF_VERIFY), another editor of the
// site can; a re-save of the inspection keeps the verification; repeat findings by site, other site 403.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'insp-verify-'));
process.env.DASH_USER = process.env.DASH_USER || 'insp-verify-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'insp-verify-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'insp-verify-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, cfg, inspDb, codeA, codeB, actId, actMed;
const tok = {};
const H = (t) => ({ 'Content-Type': 'application/json', 'x-report-token': t });
const post = (p, t, b) => fetch(base + p, { method: 'POST', headers: H(t), body: JSON.stringify(b) });
const get = (p, t) => fetch(base + p, { headers: H(t) });
const state = (id, code, date, items, actions = []) => ({ state: { meta: { f_id: id, f_site: `Site (${code})`, f_date: date, f_area: 'Server room', f_lead: 'Tester' }, status: 'submitted', items, actions } });

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db'); cfg = require('../services/reportConfig'); inspDb = require('../inspection-db');
  const sites = await rdb.listSites();
  const coded = sites.map((s) => ({ s, code: inspDb.siteNameToCode(s.name) })).filter((x) => x.code);
  const [A, B] = coded; codeA = A.code; codeB = B.code;
  const mk = async (username, roles, site_id) => { await rdb.createUser({ username, full_name: username, password: username + '-0000', roles, site_id }); return (await rdb.login(username, username + '-0000')).token; };
  tok.admin = await mk('iv-admin', ['admin'], null);
  tok.a1 = await mk('iv-editor-a1', ['editor'], A.s.id); tok.a2 = await mk('iv-editor-a2', ['editor'], A.s.id); tok.b = await mk('iv-editor-b', ['editor'], B.s.id);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  const bad = { net__0: { status: 'major' } };
  for (const [id, date, items] of [['EM-IV-1', '2026-08-01', bad], ['EM-IV-2', '2026-09-01', {}], ['EM-IV-3', '2026-10-01', bad]]) {
    const r = await post('/api/inspection/save', tok.admin, state(id, codeA, date, items, id === 'EM-IV-3'
      ? [{ desc: 'Replace switch', owner: 'x', due: '2026-11-01', priority: 'High' }, { desc: 'Tidy cables', owner: 'x', due: '2026-11-01', priority: 'Medium' }] : []));
    assert.equal(r.status, 200, await r.text());
  }
  const full = await inspDb.getInspection('EM-IV-3');
  actId = full.actions.find((a) => a.priority === 'High').id; actMed = full.actions.find((a) => a.priority === 'Medium').id;
});
after(() => { try { server && server.close(); } catch {} });

test('switch 0 = today: close works, no verification field, verify and repeat 404', async () => {
  assert.equal(cfg.DEFAULTS.insp_action_verify_enabled, '0'); assert.equal(cfg.DEFAULTS.insp_repeat_findings, '0'); assert.equal(cfg.DEFAULTS.insp_repeat_window, '');
  assert.equal((await post(`/api/inspection/actions/${actMed}/update`, tok.a1, { status_change: 'Closed' })).status, 200);
  const j = await (await get(`/api/inspection/actions?site=${codeA}`, tok.a1)).json();
  assert.equal(j.verify_enabled, undefined, 'response shape unchanged'); assert.ok(j.rows.every((r) => !('verification_state' in r)));
  assert.equal(j.rows.find((r) => r.id === actMed).status, 'Closed');
  assert.equal((await post(`/api/inspection/actions/${actId}/verify`, tok.a2, {})).status, 404);
  assert.equal((await get('/api/inspection/repeat-findings', tok.a1)).status, 404);
});

test('switch 1: awaiting verification, SoD refusal, independent verify, survives a re-save', async () => {
  await cfg.setConfig(rdb.db, { insp_action_verify_enabled: '1' }, 'test');
  try {
    assert.equal((await post(`/api/inspection/actions/${actId}/update`, tok.a1, { status_change: 'Closed' })).status, 200);
    let j = await (await get(`/api/inspection/actions?site=${codeA}`, tok.a1)).json();
    assert.equal(j.rows.find((r) => r.id === actId).verification_state, 'awaiting_verification');
    assert.equal(j.rows.find((r) => r.id === actMed).verification_state, null, 'Medium needs no verification');
    assert.equal((await post(`/api/inspection/actions/${actMed}/verify`, tok.a2, {})).status, 400);
    const self = await post(`/api/inspection/actions/${actId}/verify`, tok.a1, { note: 'me' });
    assert.equal(self.status, 403); assert.match((await self.json()).error, /SELF_VERIFY/);
    assert.equal((await post(`/api/inspection/actions/${actId}/verify`, tok.b, {})).status, 403, 'other site');
    const ok = await post(`/api/inspection/actions/${actId}/verify`, tok.a2, { note: 'switch replaced, port up' });
    assert.equal(ok.status, 200, await ok.text()); assert.equal((await ok.json()).closer_known, true);
    assert.equal((await post(`/api/inspection/actions/${actId}/verify`, tok.a2, {})).status, 400, 'already verified');
    // the form re-saves the inspection with the action Closed → verification kept
    const rec = await inspDb.getInspection('EM-IV-3');
    const st = { ...rec.state, actions: rec.actions.map((a) => ({ desc: a.description, owner: a.owner, due: a.due_date, priority: a.priority, status: a.status })) };
    assert.equal((await post('/api/inspection/save', tok.admin, { state: st })).status, 200);
    j = await (await get(`/api/inspection/actions?site=${codeA}`, tok.a1)).json();
    const after = j.rows.find((r) => r.description === 'Replace switch');
    assert.equal(after.verification_state, 'verified'); assert.equal(after.verified_by, 'iv-editor-a2');
  } finally { await cfg.setConfig(rdb.db, { insp_action_verify_enabled: '0' }, 'test'); }
});

test('repeat findings: window empty → nothing; N=3 → NET-01 repeats on site A; other site 403', async () => {
  await cfg.setConfig(rdb.db, { insp_repeat_findings: '1' }, 'test');
  try {
    let j = await (await get('/api/inspection/repeat-findings', tok.a1)).json();
    assert.equal(j.enabled, false);
    await cfg.setConfig(rdb.db, { insp_repeat_window: '3' }, 'test');
    j = await (await get(`/api/inspection/repeat-findings?site=${codeA}`, tok.a1)).json();
    assert.equal(j.n, 3);
    const rep = j.sites[codeA].repeats;
    assert.equal(rep.length, 1, JSON.stringify(j)); assert.equal(rep[0].item_code, 'NET-01'); assert.equal(rep[0].hits, 2); assert.equal(rep[0].of, 3);
    assert.equal((await get(`/api/inspection/repeat-findings?site=${codeB}`, tok.a1)).status, 403);
  } finally { await cfg.setConfig(rdb.db, { insp_repeat_findings: '0', insp_repeat_window: '' }, 'test'); }
});
