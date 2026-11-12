'use strict';
// UAT-OI-08 (G3-UX) — project team members were free text with a bare "user account id" number box. With
// ppm_project_team_enabled on, whoever may edit the team gets a picker of active users (id + display name, never an
// e-mail) at GET …/team/people, the picked id is stored, an unknown id is refused, free text stays allowed, and the
// team rows sent to a reader carry the display name, never the login name (which can be an e-mail address).
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ppm-picker-'));
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'ppm-picker-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const WB = require('../services/ppmWorkbench');
const UI = require('../public/lib/ppmWorkbench');
let server, base, rdb, cfg, pid; const T = {}, ID = {};
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; };
const sw = (v) => cfg.setConfig(rdb.db, { ppm_project_team_enabled: v }, 'smoke');

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'ppm_project_members'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  const mk = async (u, full, roles) => { await rdb.createUser({ username: u, full_name: full, password: 'pk-pass-1234', roles }); ID[u] = Number(((await rdb.listUsers()) || []).find((x) => x.username === u).id); return (await rdb.login(u, 'pk-pass-1234')).token; };
  T.pmo = await mk('pk_pmo', 'Pat PMO', ['viewer', 'committee-member']);
  T.viewer = await mk('pk_viewer', 'Vic Viewer', ['viewer']);
  T.mail = await mk('ana.kone@example.test', 'Ana Koné', ['viewer']);
  await mk('nofull@example.test', '', ['viewer']);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  const prog = (await send('PUT', '/api/governance/portfolio/programme', T.pmo, { key: 'pk-prog', name: 'PK' })).j.id;
  const obj = (await send('PUT', '/api/governance/portfolio/objective', T.pmo, { programme_id: prog, key: 'pk-o', name: 'O' })).j.id;
  pid = (await send('PUT', '/api/governance/portfolio/project', T.pmo, { objective_id: obj, key: 'PK-1', name: 'Fictitious picker project', start_date: '2026-11-02', end_date: '2027-03-31' })).j.id;
});
after(() => server && server.close());

test('pure: picker people and public member rows never carry an e-mail', () => {
  const p = WB.pickerPeople([{ id: 2, username: 'b@x.test', full_name: 'Bea' }, { id: 1, username: 'c@x.test', full_name: '' }, { id: 3, username: 'old', full_name: 'Old', active: 0 }]);
  assert.deepEqual(p, [{ id: 2, name: 'Bea' }, { id: 1, name: 'User #1' }]);
  assert.ok(!JSON.stringify(p).includes('@'));
  const m = WB.publicMember({ id: 9, user_id: 1, label: 'Ext', username: 'c@x.test', user_full_name: null });
  assert.equal(m.user_name, 'User #1'); assert.equal(m.username, undefined);
  assert.equal(WB.publicMember({ id: 8, user_id: null, label: 'External contractor' }).user_name, null);
  const o = UI.pickerOptions([{ id: 2, name: '<b>Bea</b>' }], (s) => String(s).replace(/</g, '&lt;'));
  assert.match(o, /— not linked —/); assert.match(o, /value="2">&lt;b>Bea/);
});

test('switch off: the picker does not exist (404) — today', async () => {
  await sw('0');
  assert.equal((await send('GET', `/api/governance/ppm/project/${pid}/team/people`, T.pmo)).status, 404);
});

test('switch on: team editors get active users by display name; readers without plan-write get 403; ids stored; free text kept', async () => {
  await sw('1');
  try {
    const url = `/api/governance/ppm/project/${pid}/team`;
    const ppl = await send('GET', url + '/people', T.pmo);
    assert.equal(ppl.status, 200);
    const names = ppl.j.people.map((x) => x.name);
    assert.ok(names.includes('Ana Koné') && names.includes('Pat PMO'));
    assert.ok(!JSON.stringify(ppl.j).includes('@'), 'no e-mail / address-like login in the picker');
    assert.equal((await send('GET', url + '/people', T.viewer)).status, 403, 'a reader who cannot edit the team gets no user list');
    const linked = await send('PUT', url, T.pmo, { label: 'Ana Koné', role: 'radio technician', allocation_pct: 50, user_id: ID['ana.kone@example.test'] });
    assert.equal(linked.status, 200, JSON.stringify(linked.j));
    assert.equal(linked.j.member.user_id, ID['ana.kone@example.test']);
    assert.equal(linked.j.member.user_name, 'Ana Koné');
    const ext = await send('PUT', url, T.pmo, { label: 'External contractor', role: 'cabling' });
    assert.equal(ext.status, 200); assert.equal(ext.j.member.user_id, null, 'free text, no account');
    const bad = await send('PUT', url, T.pmo, { label: 'Ghost', user_id: 999999 });
    assert.equal(bad.status, 400); assert.equal(bad.j.code, 'UNKNOWN_USER');
    const read = await send('GET', url, T.viewer);
    assert.equal(read.status, 200);
    assert.ok(!JSON.stringify(read.j).includes('@'), 'team rows carry no login name / e-mail');
    assert.equal(read.j.members.find((m) => m.label === 'Ana Koné').user_name, 'Ana Koné');
  } finally { await sw('0'); }
});
