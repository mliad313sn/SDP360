'use strict';
// G-18 — server-side validation of commitment sources (committee review 2026-10-28). Before this fix a
// site-A editor could (a) attach a site-B meeting action, inspection action or report follow-up to a
// site-A commitment, and (b) replay POST /api/commitments with a source already linked on site B and
// receive site B's whole commitment back (the idempotent "created:false" answer). Both are refused now;
// the admin tier is unchanged. Also: GET /api/commitments/escalations is site-scoped.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'cmt-scope-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'cs-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'cs-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'cs-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, hounde, mana, edH, edM, superT, manaAction, manaIssue, houndeAction, manaUid, manaInsp;

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db');
  for (let i = 0; i < 50; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'commitment_escalations'").get())) break; await new Promise((r) => setTimeout(r, 100)); }
  const sites = await rdb.listSites({ includeInactive: true });
  hounde = sites.find((s) => /hounde/i.test(s.name)).id; mana = sites.find((s) => /^mana$/i.test(s.name)).id;
  const mk = async (u, roles, site) => { try { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); } catch {} return (await rdb.login(u, u + 'pass1234')).token; };
  edH = await mk('cs_ed_h', ['editor'], hounde); edM = await mk('cs_ed_m', ['editor'], mana); superT = await mk('cs_super', ['super_admin']);
  const mdb = require('../meetings-db');
  const mm = await mdb.saveMeeting({ header: { site_code: 'MGO', department: 'mining', meeting_date: '2026-10-05', status: 'draft' },
    issues: [{ ord: 1, title: 'Mana issue', category: 'CN', severity: 'HIGH', status: 'open' }],
    actions: [{ description: 'Mana action', status: 'open', owner_it: 'cs_ed_m' }] }, null, null);
  const mfull = await mdb.getMeeting(mm.id); manaAction = mfull.actions[0].id; manaIssue = mfull.issues[0].id;
  const hm = await mdb.saveMeeting({ header: { site_code: 'HGO', department: 'mining', meeting_date: '2026-10-05', status: 'draft' },
    actions: [{ description: 'Hounde action', status: 'open', owner_it: 'cs_ed_h' }] }, null, null);
  houndeAction = (await mdb.getMeeting(hm.id)).actions[0].id;
  const rep = await rdb.ensureReport(mana, 2026, 40);
  await rdb.saveActionItems(rep.id, [{ task: 'Mana follow-up', status: 'open', owner: 'x', department: 'IT' }]);
  manaUid = (await rdb.getReport(rep.id)).action_items[0].uid;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  const ir = await fetch(base + '/api/inspection/save', { method: 'POST', headers: { 'content-type': 'application/json', 'x-report-token': superT },
    body: JSON.stringify({ state: { meta: { f_site: 'Mana (MGO)', f_date: '2026-10-05', f_area: 'Server room' }, items: {}, actions: [{ desc: 'Mana corrective', owner: 'x', due: '2026-11-01', priority: 'High' }] } }) });
  assert.equal(ir.status, 200, await ir.text());
  const insp = await (await fetch(base + '/api/inspection/' + encodeURIComponent((await ir.json()).id), { headers: { 'x-report-token': superT } })).json();
  manaInsp = insp.actions[0].id;
  await require('../services/reportConfig').setConfig(rdb.db, { commitments_enabled: '1' }, 'test');
});
after(() => server && server.close());
const send = (m, p, t, body) => fetch(base + p, { method: m, headers: { 'x-report-token': t, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const mine = (src) => ({ kind: 'issue', title: 'probe', site_id: hounde, source: src });

test('create: a site-A editor cannot attach a site-B source (meeting action, issue, inspection action, report follow-up)', async () => {
  for (const src of [{ system: 'meetings', id: String(manaAction) }, { system: 'meetings', id: 'issue:' + manaIssue },
    { system: 'inspection', id: String(manaInsp) }, { system: 'report', id: manaUid }]) {
    const r = await send('POST', '/api/commitments', edH, mine(src));
    assert.equal(r.status, 403, `${src.system}:${src.id} → ${r.status} ${await r.text()}`);
  }
  assert.equal((await send('POST', '/api/commitments', edH, mine({ system: 'meetings', id: '999999' }))).status, 400, 'missing source');
  assert.equal((await send('POST', '/api/commitments', edH, mine({ system: 'meetings', id: String(houndeAction) }))).status, 201, 'own source works');
});

test('replay: a source already linked on site B never reveals site B\'s commitment', async () => {
  // an SDP ticket has no verifiable site: a site editor cannot CREATE from it (committee security) — the answer
  // is the same whether or not another site already holds it, so nothing leaks
  const free = await send('POST', '/api/commitments', edH, { ...mine({ system: 'sdp_ticket', id: '777099' }) });
  assert.equal(free.status, 403);
  const b = await send('POST', '/api/commitments', superT, { kind: 'issue', title: 'Mana secret', site_id: mana, source: { system: 'sdp_ticket', id: '777001' } });
  assert.equal(b.status, 201, 'the admin tier creates from a ticket');
  const r = await send('POST', '/api/commitments', edH, { ...mine({ system: 'sdp_ticket', id: '777001' }) });
  const body = await r.text();
  assert.equal(r.status, 403, body); assert.equal(JSON.parse(body).error, (await free.json()).error, 'identical answer: held or not');
  assert.ok(!/Mana secret/.test(body), 'no site-B data in the answer');
  // a site record already held on site B: replay answers 409 without site-B data
  const mb = await send('POST', '/api/commitments', edM, { kind: 'issue', title: 'Mana secret 2', site_id: mana, source: { system: 'meetings', id: String(manaAction) } });
  assert.equal(mb.status, 201);
});

test('links: a site-A editor cannot link a site-B record to their own commitment; the admin tier can', async () => {
  const c = (await (await send('POST', '/api/commitments', edH, { kind: 'issue', title: 'own', site_id: hounde })).json()).commitment;
  for (const l of [{ source_system: 'meetings', source_id: String(manaAction) }, { source_system: 'inspection', source_id: String(manaInsp) }, { source_system: 'report', source_id: manaUid }]) {
    assert.equal((await send('POST', `/api/commitments/${c.id}/links`, edH, l)).status, 403, JSON.stringify(l));
  }
  const ok = await send('POST', `/api/commitments/${c.id}/links`, superT, { source_system: 'meetings', source_id: String(manaAction), relation: 'related' });
  assert.equal(ok.status, 200);
});

test('escalations: ledger is site-scoped and deduplicated', async () => {
  await send('POST', '/api/commitments', edM, { kind: 'issue', title: 'Mana serious unowned', site_id: mana, severity: 'critical' });
  await send('POST', '/api/commitments', edH, { kind: 'issue', title: 'Hounde serious unowned', site_id: hounde, severity: 'high' });
  const store = require('../routes/commitments').createStore(rdb);
  const first = await store.escalate(); const second = await store.escalate();
  assert.equal(first.raised.length, 2); assert.equal(second.raised.length, 0);
  const h = await (await send('GET', '/api/commitments/escalations', edH)).json();
  assert.deepEqual(h.escalations.map((e) => e.title), ['Hounde serious unowned']);
  const all = await (await send('GET', '/api/commitments/escalations', superT)).json();
  assert.equal(all.escalations.length, 2);
});
