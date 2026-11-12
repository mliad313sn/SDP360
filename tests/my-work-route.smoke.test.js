'use strict';
// A-10 — GET /api/me/work (per-person "My work") + GET /home.html through the real app.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'my-work-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'mw-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'mw-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'mw-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, hounde, mana, T = {};
before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  const sites = await rdb.listSites({ includeInactive: true });
  hounde = sites.find((s) => /hounde/i.test(s.name)).id; mana = sites.find((s) => /^mana$/i.test(s.name)).id;
  const mk = async (k, roles, site, extra) => {
    const u = 'mw_' + k;
    try { await rdb.createUser({ username: u, full_name: 'Person ' + k, password: u + 'pass1234', roles, site_id: site, extra_site_ids: extra }); } catch {}
    T[k] = (await rdb.login(u, u + 'pass1234')).token;
  };
  await mk('two', ['editor'], hounde, [mana]);
  await mk('tech', ['field-tech'], mana);
  await mk('nosite', ['admin']);
  const mdb = require('../meetings-db');
  await mdb.saveMeeting({ header: { site_code: 'HGO', department: 'mining', meeting_date: '2026-10-05', status: 'draft' },
    actions: [{ description: 'Replace the plant switch', status: 'open', owner_it: 'mw_two', target_date: '2026-10-10' }] }, null, null);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const get = async (t, p = '/api/me/work') => {
  const r = await fetch(base + p, { headers: t ? { 'x-report-token': t } : {} });
  return { status: r.status, body: p.endsWith('.html') ? await r.text() : await r.json().catch(() => null) };
};

test('401 without a session', async () => {
  assert.equal((await get(null)).status, 401);
});

test('a two-site editor sees exactly their two sites, each block measured or null', async () => {
  const r = await get(T.two);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(r.body.sites.map((s) => s.site_id).sort(), [hounde, mana].sort());
  const h = r.body.sites.find((s) => s.site_id === hounde);
  assert.equal(h.code, 'HGO');
  assert.ok(h.actions.open >= 1 && h.actions.overdue >= 1, 'the late PV action is open + overdue');
  assert.ok(['Not started', 'In progress', 'Complete but not submitted', 'Submitted'].includes(h.weekly_report.label));
  assert.ok(h.unsigned_pvs.count >= 1, 'the draft PV is unsigned');
  assert.ok('last_inspection' in h && 'tracker_empty' in h);
  assert.equal(r.body.message, null);
});

test('a field tech with one site gets one card', async () => {
  const r = await get(T.tech);
  assert.equal(r.status, 200);
  assert.deepStrictEqual(r.body.sites.map((s) => s.site_id), [mana]);
});

test('an admin without a site gets a message, never the fleet', async () => {
  const r = await get(T.nosite);
  assert.equal(r.status, 200);
  assert.deepStrictEqual(r.body.sites, []);
  assert.match(r.body.message, /not attached to a site/);
});

test('GET /home.html returns the page with the shell mount', async () => {
  const r = await get(T.two, '/home.html');
  assert.equal(r.status, 200);
  assert.match(r.body, /<div id="__shell" data-section="home" data-current="home">/);
  assert.match(r.body, /lib\/home-page\.js\?v=/, 'asset versioning applied (served through sendHtmlPage)');
});

test('login.html (strict CSP page) serves lib/landing.js with the per-request nonce', async () => {
  const r = await get(null, '/login.html');
  assert.equal(r.status, 200);
  assert.match(r.body, /<script nonce="(?!%%)[^"]+" src="lib\/landing\.js\?v=[^"]+"><\/script>/);
  assert.ok(!r.body.includes('%%CSP_NONCE%%'));
});

// F-PRODUCT-07 — "Awaiting me": absent while mywork_awaiting_me_enabled = 0; on, each source is scoped and SoD holds
test('awaiting me: off = no block; on = my reviews, acceptances, owned decisions and PVs to sign — never my own work', async () => {
  const rc = require('../services/reportConfig'); const sw = (p) => rc.setConfig(rdb.db, p);
  assert.equal((await rc.getConfig(rdb.db)).mywork_awaiting_me_enabled, '0', 'default = today');
  assert.ok(!('awaiting_me' in (await get(T.two)).body), 'off: the answer is unchanged');
  const uid = async (k) => Number((await rdb.db.prepare('SELECT id FROM users WHERE username=?').get('mw_' + k)).id);
  const two = await uid('two'), tech = await uid('tech');
  const H = rdb.pgHandle(); const t = new Date().toISOString(); const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10), far = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  // fixtures: commitments (reviewer = mw_two; one of them owned by mw_two), a handoff to mw_two, decisions, a PV naming "Person two"
  await H.prepare(`INSERT INTO commitments (uid, kind, title, site_id, status, reviewer, accountable_owner, created_by, due_date, created_at, updated_at) VALUES
    ('mw-aw-1', 'issue', 'Review me', ?, 'awaiting_verification', 'mw_two', 'mw_tech', 'mw_tech', ?, ?, ?),
    ('mw-aw-2', 'issue', 'My own work', ?, 'awaiting_verification', 'mw_two', 'mw_two', 'mw_tech', ?, ?, ?),
    ('mw-aw-3', 'issue', 'Not waiting', ?, 'in_progress', 'mw_two', 'mw_tech', 'mw_tech', ?, ?, ?)`).run(hounde, soon, t, t, hounde, soon, t, t, hounde, soon, t, t);
  await H.prepare(`INSERT INTO handoffs (ref, title, site_id, from_department, to_department, requested_by, receiver_id, status, created_at, updated_at) VALUES
    ('HND-MW-1', 'Accept me', ?, 'Mining', 'Finance', ?, ?, 'requested', ?, ?), ('HND-MW-2', 'I asked', ?, 'Mining', 'Finance', ?, ?, 'requested', ?, ?)`).run(mana, tech, two, t, t, mana, two, tech, t, t);
  const gov = require('../services/governanceStore').makeGovernanceStore(H);
  const d1 = await gov.addDecision({ title: 'Mine, due soon', owner: 'mw_two', due_date: soon, site_id: hounde });
  await gov.addDecision({ title: 'Mine, far', owner: 'mw_two', due_date: far, site_id: hounde });
  await gov.addDecision({ title: 'Not mine', owner: 'mw_tech', due_date: soon, site_id: hounde });
  await require('../meetings-db').saveMeeting({ header: { site_code: 'HGO', department: 'finance', meeting_date: '2026-10-06', status: 'draft', department_head: 'Person two', site_it_lead: 'Someone Else' } }, null, null);
  await sw({ mywork_awaiting_me_enabled: '1' });
  try {
    // commitments / handoffs modules are off → those two sources are "not measured", the others are measured
    let a = (await get(T.two)).body.awaiting_me;
    assert.strictEqual(a.commitments, null); assert.strictEqual(a.handoffs, null); assert.deepEqual(a.not_measured, ['commitments', 'handoffs']);
    assert.deepEqual(a.decisions.items.map((x) => x.ref), [d1.ref], 'only my decision due within 7 days');
    assert.equal(a.pvs.count, 1); assert.match(a.pvs.items[0].link, /^meeting\.html\?id=\d+$/);
    assert.deepEqual(a.benefits, { count: 0, items: [] }, 'not a committee member: nothing to verify (measured, 0)');
    await sw({ commitments_enabled: '1', handoffs_enabled: '1' });
    a = (await get(T.two)).body.awaiting_me;
    assert.deepEqual(a.commitments.items.map((x) => x.title), ['Review me'], 'my own commitment and the one not waiting are excluded');
    assert.match(a.commitments.items[0].link, /^commitments\.html\?id=\d+$/);
    assert.deepEqual(a.handoffs.items.map((x) => x.ref), ['HND-MW-1'], 'the handoff I requested is not mine to accept');
    assert.deepEqual(a.not_measured, []); assert.equal(a.total, a.commitments.count + a.handoffs.count + a.decisions.count + a.pvs.count);
    // another person sees none of it
    const o = (await get(T.tech)).body.awaiting_me;
    assert.equal(o.commitments.count, 0); assert.equal(o.pvs.count, 0); assert.ok(!o.decisions.items.some((x) => x.ref === d1.ref));
    assert.deepEqual(o.handoffs.items.map((x) => x.ref), ['HND-MW-2']);
    // a site-less admin still gets the block (no site card, but an inbox)
    const n = (await get(T.nosite)).body; assert.deepStrictEqual(n.sites, []); assert.ok(n.awaiting_me && n.awaiting_me.decisions);
  } finally { await sw({ mywork_awaiting_me_enabled: '0', commitments_enabled: '0', handoffs_enabled: '0' }); }
  assert.ok(!('awaiting_me' in (await get(T.two)).body));
});
