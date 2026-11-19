'use strict';
// P11 round 2 R2-N1 — subscriptions to report templates bypassed site scope and audience: any session could
// follow any template, and reports.weekly/monthly notified every subscriber of every site's run and of the
// executive pack (site name + headline). The `s.site_id` filter read a column subscriptions does not have.
// Contract now: (1) subscribing needs the template's audience (site → an account with a site; council →
// committee member; executive → authors); (2) every notification re-checks the run against the subscriber's
// current roles and sites with the report studio's read rule — so subscriptions created before the fix
// cannot leak either; (3) the publish-time notification applies the same rule.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_p.join(_os.tmpdir(), 'r2n1-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'r2n1-key-0123456789abcdef0123456789abcdef';
process.env.DASH_USER = process.env.DASH_USER || 'r2n1-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'r2n1-super-pass-0000';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, rs, eng, sites;
const tok = {}, ids = {};
const H = (t) => ({ 'Content-Type': 'application/json', ...(t ? { 'x-report-token': t } : {}) });
const post = (p, t, b) => fetch(base + p, { method: 'POST', headers: H(t), body: JSON.stringify(b) });

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  sites = await rdb.listSites({ includeInactive: false });
  const mk = async (u, roles, site) => {
    await rdb.createUser({ username: u, full_name: u, password: u + '-pass-0000', roles, site_id: site });
    ids[u] = (await rdb.listUsers()).find((x) => x.username === u).id;
    return (await rdb.login(u, u + '-pass-0000')).token;
  };
  tok.viewer = await mk('n1-vw', ['viewer'], Number(sites[0].id));
  tok.nosite = await mk('n1-ns', ['viewer']);
  tok.cm = await mk('n1-cm', ['viewer', 'committee-member'], Number(sites[0].id));
  tok.author = await mk('n1-au', ['viewer', 'report-author'], Number(sites[0].id));
  rs = require('../routes/reportStudio').createStore(rdb);
  eng = require('../routes/engagement').createStore(rdb);
  await rs.saveTemplate({ key: 'n1-site', name: 'n1 site', dashboard_key: 'direction', audience: 'site', cadence: 'weekly' });
  await rs.saveTemplate({ key: 'n1-exec', name: 'n1 exec', dashboard_key: 'direction', audience: 'executive', cadence: 'weekly' });
  await rs.saveTemplate({ key: 'n1-council', name: 'n1 council', dashboard_key: 'direction', audience: 'council', cadence: 'monthly' });
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server.close(); } catch (_) { /* closed */ } });

const sub = (t, key) => post('/api/engagement/subscriptions', t, { kind: 'report_template', target_key: key });

test('subscribing needs the template audience', async () => {
  assert.equal((await sub(tok.viewer, 'n1-site')).status, 200, 'site viewer → site template');
  assert.equal((await sub(tok.viewer, 'n1-exec')).status, 403, 'viewer → executive pack refused');
  assert.equal((await sub(tok.viewer, 'n1-council')).status, 403, 'non-member → council refused');
  assert.equal((await sub(tok.cm, 'n1-council')).status, 200, 'committee member → council');
  assert.equal((await sub(tok.nosite, 'n1-site')).status, 403, 'account with no site → site template refused');
  assert.equal((await sub(tok.author, 'n1-exec')).status, 200, 'author → any template');
  assert.equal((await sub(tok.viewer, 'nope')).status, 404, 'unknown template');
});

async function runJob(cadence, status) {
  const gen = require('../services/reportGenerator');
  const orig = gen.generateRun; let n = 0;
  gen.generateRun = async ({ site }) => ({ id: 910000 + (++n), site_id: site ? site.id : null, status,
    analysis: { headline: `${site ? site.name : 'the scope'}: 3 red indicator(s)` } });
  try {
    const J = require('../services/engagementJobs');
    return await J.generateScheduledReports({ cadence, reportStore: { listTemplates: async () => (await rs.listTemplates()).filter((t) => t.key.startsWith('n1-')) },
      dashStore: { published: async () => ({ definition: {} }) }, engStore: eng, registry: null, deps: {}, rdb, baseUrl: '' });
  } finally { gen.generateRun = orig; }
}

test('delivery re-checks visibility: pre-existing out-of-scope subscriptions never leak', async () => {
  // subscriptions written before the fix (straight into the store, bypassing the route check)
  await eng.subscribe(ids['n1-vw'], { kind: 'report_template', target_key: 'n1-exec' });
  await eng.subscribe(ids['n1-ns'], { kind: 'report_template', target_key: 'n1-site' });
  await eng.markAllRead(ids['n1-vw']); await eng.markAllRead(ids['n1-au']);
  // draft runs (what the job creates): only authors are told
  const out = await runJob('weekly', 'draft');
  assert.ok(out.withheld > 0);
  assert.equal((await eng.listNotifications(ids['n1-vw'], { unreadOnly: true })).length, 0, 'viewer: nothing about drafts');
  assert.equal((await eng.listNotifications(ids['n1-ns'], { unreadOnly: true })).length, 0);
  const au = await eng.listNotifications(ids['n1-au'], { unreadOnly: true });
  assert.ok(au.some((x) => /n1 exec/.test(x.title)), 'the author is told about the executive draft');
  // published runs: a site viewer hears only about their own site, never the executive pack
  await runJob('weekly', 'published');
  const vw = await eng.listNotifications(ids['n1-vw'], { unreadOnly: true });
  assert.equal(vw.length, 1, 'exactly the own-site run');
  assert.ok(vw[0].title.includes(sites[0].name));
  assert.ok(!vw.some((x) => x.title.includes(sites[1].name) || /exec/.test(x.title)));
  assert.equal((await eng.listNotifications(ids['n1-ns'], { unreadOnly: true })).length, 0, 'no site → nothing');
});

test('council run: committee member notified, plain viewer not', async () => {
  await eng.subscribe(ids['n1-vw'], { kind: 'report_template', target_key: 'n1-council' });   // pre-fix row
  await eng.markAllRead(ids['n1-vw']); await eng.markAllRead(ids['n1-cm']);
  await runJob('monthly', 'published');
  assert.equal((await eng.listNotifications(ids['n1-vw'], { unreadOnly: true })).length, 0);
  assert.equal((await eng.listNotifications(ids['n1-cm'], { unreadOnly: true })).length, 1);
});
