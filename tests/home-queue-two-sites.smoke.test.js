'use strict';
// R2-QUEUE (R3) — two sites, real app on PostgreSQL: the queue an editor of site A builds never shows site B's items,
// and the endpoints it reads refuse site B even when asked directly (the queue adds no new route and no new right).
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'home-queue-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'hq-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'hq-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'hq-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const HQ = require('../public/lib/homeQueue');
let server, base, hounde, mana; const T = {};
before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  const sites = await rdb.listSites({ includeInactive: true });
  hounde = sites.find((s) => /hounde/i.test(s.name)).id; mana = sites.find((s) => /^mana$/i.test(s.name)).id;
  const mk = async (k, roles, site) => {
    const u = 'hq_' + k;
    try { await rdb.createUser({ username: u, full_name: 'Person ' + k, password: u + 'pass1234', roles, site_id: site }); } catch { /* exists */ }
    T[k] = (await rdb.login(u, u + 'pass1234')).token;
  };
  await mk('hgo', ['editor'], hounde);
  await mk('admin', ['admin'], hounde);
  const mdb = require('../meetings-db');
  await mdb.saveMeeting({ header: { site_code: 'HGO', department: 'mining', meeting_date: '2026-10-05', status: 'draft' },
    actions: [{ description: 'HGO switch replacement', status: 'open', owner_it: 'hq_hgo', target_date: '2026-10-10' }] }, null, null);
  await mdb.saveMeeting({ header: { site_code: 'MGO', department: 'mining', meeting_date: '2026-10-06', status: 'draft' },
    actions: [{ description: 'MGO secret action', status: 'open', owner_it: 'someone', target_date: '2026-10-10' }] }, null, null);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const fetchJsonAs = (tok) => async (url) => {
  const r = await fetch(base + url, { headers: { 'x-report-token': tok } });
  return { status: r.status, json: r.status < 300 ? await r.json().catch(() => null) : null };
};

test('the editor of site A sees A\'s action, never B\'s, and the queue only asked for A', async () => {
  const work = (await fetchJsonAs(T.hgo)('/api/me/work')).json;
  assert.deepStrictEqual(work.sites.map((s) => s.code), ['HGO']);
  const calls = [];
  const fj = fetchJsonAs(T.hgo);
  const q = HQ.createQueue({ sites: work.sites, asOf: work.as_of, awaiting: work.awaiting_me, fetchJson: (u) => { calls.push(u); return fj(u); } });
  await q.loadAll();
  const v = q.view();
  assert.ok(v.items.some((x) => x.title === 'HGO switch replacement' && x.overdue && x.deep), JSON.stringify(v.items));
  assert.ok(!v.items.some((x) => /MGO/.test(x.title) || x.site_code === 'MGO'));
  assert.ok(!calls.some((u) => /site=MGO/.test(u)));
  assert.equal(v.states.find((s) => s.source === 'meetings').state, 'available');
});

test('the endpoints the queue reads refuse site B to that editor (no new right through the queue)', async () => {
  const fj = fetchJsonAs(T.hgo);
  for (const p of ['/api/meetings/actions?site=MGO', '/api/inspection/actions?site=MGO', '/api/reports/site-actions?site=MGO']) {
    assert.equal((await fj(p)).status, 403, p);
  }
  // a queue forced to ask for B (tampered client) gets "denied", never B's rows
  const q = HQ.createQueue({ sites: [{ site_id: mana, code: 'MGO' }], asOf: '2026-11-12', fetchJson: fj, awaiting: undefined });
  await q.loadAll();
  assert.equal(q.state.meetings.state, 'denied');
  assert.equal(q.view().items.length, 0);
});

test('the admin tier sees its own site in the queue too (Home is "your sites", never the fleet)', async () => {
  const work = (await fetchJsonAs(T.admin)('/api/me/work')).json;
  assert.deepStrictEqual(work.sites.map((s) => s.code), ['HGO']);
  const q = HQ.createQueue({ sites: work.sites, asOf: work.as_of, fetchJson: fetchJsonAs(T.admin), awaiting: work.awaiting_me });
  await q.loadAll();
  assert.ok(!q.view().items.some((x) => /MGO secret/.test(x.title)));
});
