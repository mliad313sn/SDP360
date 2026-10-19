'use strict';
const fetch = require('./_http-fetch');
// POST /api/meetings/save carries the Business Incubation extras when the session is
// entered by hand (2026-10-03): state.incubation is normalised and stored for an
// incubation session, ignored (and cleared) for a regular PV, and an omitted key leaves
// the stored blob untouched (header-only saves, imports).
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'inc-save-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'inc-save-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'inc-save-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'inc-save-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, mdb, code, dept, tok;
const post = (b) => fetch(base + '/api/meetings/save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-report-token': tok }, body: JSON.stringify(b) });
const INC = {
  roles: { incubator: 'Jean K', incubator_title: 'Géologue', incubation_manager: 'Ghislain', it_manager: 'Eric' },
  session_end: '2026-08-22', duration: '2 jours', business_description: 'La géologie minière',
  flow: [{ incoming: 'Forage', activity: 'Analyse', outgoing: 'Modèles' }],
  services: [{ service: 'Data Mobile', beneficiary: 'Tous', status: 'Actif' }],
};

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  mdb = require('../meetings-db');
  const L = await mdb.loadLookups();
  dept = L.departments[0].code; code = L.sites[0].code;
  await rdb.createUser({ username: 'inc-admin', full_name: 'inc-admin', password: 'inc-admin-0000', roles: ['admin'], site_id: null });
  tok = (await rdb.login('inc-admin', 'inc-admin-0000')).token;
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

const incHeader = (date) => ({ site_code: code, department: dept, meeting_date: date, intake_source: 'business_incubation', status: 'draft' });

test('an incubation saved from the form stores the normalised extras', async () => {
  const r = await post({ state: { header: incHeader('2026-08-20'), incubation: INC } });
  assert.equal(r.status, 200);
  const id = (await r.json()).id;
  const inc = (await mdb.getMeeting(id)).header.incubation;
  assert.equal(inc.roles.incubator, 'Jean K');
  assert.equal(inc.session_end, '2026-08-22');
  assert.equal(inc.flow[0].outgoing, 'Modèles');
  assert.equal(inc.services[0].status, 'active', 'closed-list status');
});

test('a save WITHOUT the incubation key leaves the stored extras untouched', async () => {
  const id = (await (await post({ state: { header: incHeader('2026-07-20'), incubation: INC } })).json()).id;
  const r = await post({ state: { id, header: { ...incHeader('2026-07-20'), id, status: 'submitted' } } });
  assert.equal(r.status, 200);
  assert.equal((await mdb.getMeeting(id)).header.incubation.roles.incubator, 'Jean K');
});

test('a regular PV never stores incubation extras', async () => {
  const r = await post({ state: { header: { site_code: code, department: dept, meeting_date: '2026-06-10', intake_source: 'dept_meeting' }, incubation: INC } });
  const id = (await r.json()).id;
  assert.equal((await mdb.getMeeting(id)).header.incubation, undefined);
});

test('switching an incubation back to a PV clears the extras', async () => {
  const id = (await (await post({ state: { header: incHeader('2026-05-20'), incubation: INC } })).json()).id;
  await post({ state: { id, header: { ...incHeader('2026-05-20'), id, intake_source: 'dept_meeting' }, incubation: null } });
  assert.ok(!(await mdb.getMeeting(id)).header.incubation);
});
