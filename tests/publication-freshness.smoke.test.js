'use strict';
// G-14 extended (committee review 2026-10-28): values served to machine consumers (/ext/v1, OData) and
// dashboard data say whether the source behind them synced recently. Real sync_runs rows drive it.
//   helpdesk  never synced → UNKNOWN → authoritative:false, X-SDP-Freshness: stale
//   inspection (typed in the app, no external source) → FRESH → authoritative:true
//   helpdesk  synced 1 h ago (limit 3 h) → FRESH;  synced 5 h ago → STALE
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'pub-fresh-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'pf-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pf-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'pf-key';
process.env.EXT_API_RATE_PER_MIN = '1000';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, admin, key, hounde;

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db');
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'api_consumers'").get())) break; await new Promise((r) => setTimeout(r, 100)); }
  try { await rdb.createUser({ username: 'pf_admin', full_name: 'pf_admin', password: 'pf_adminpass1234', roles: ['admin'] }); } catch {}
  admin = (await rdb.login('pf_admin', 'pf_adminpass1234')).token;
  hounde = (await rdb.listSites()).find((s) => /hounde/i.test(s.name)).id;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  key = (await (await fetch(base + '/api/engagement/consumers', { method: 'POST', headers: { 'x-report-token': admin, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'PBI', scopes: ['values:read', 'metrics:read', 'sites:read'], quota_per_day: 5000 }) })).json()).key;
  await require('../services/sync').ensureReady();
  await rdb.db.prepare("DELETE FROM sync_runs WHERE job = 'zoho.requests'").run();
});
after(() => server && server.close());
const ext = (p) => fetch(base + p, { headers: { 'x-api-key': key } });
async function markSynced(job, hoursAgo) {
  const t = new Date(Date.now() - hoursAgo * 3600e3).toISOString();
  await rdb.db.prepare("DELETE FROM sync_runs WHERE job = ?").run(job);
  await rdb.db.prepare("INSERT INTO sync_runs (job, started_at, finished_at, status) VALUES (?, ?, ?, 'ok')").run(job, t, t);
}

test('/ext/v1: never-synced helpdesk is not authoritative; typed-in inspection is', async () => {
  const r = await ext(`/ext/v1/values?metrics=helpdesk.resolution_sla_pct,inspection.conformity_pct&site=${hounde}`);
  assert.equal(r.status, 200); assert.equal(r.headers.get('x-sdp-freshness'), 'stale');
  const vs = (await r.json()).values;
  const hd = vs.find((v) => v.metric === 'helpdesk.resolution_sla_pct'), ins = vs.find((v) => v.metric === 'inspection.conformity_pct');
  assert.equal(hd.freshness, 'UNKNOWN'); assert.equal(hd.authoritative, false);
  assert.equal(ins.freshness, 'FRESH'); assert.equal(ins.authoritative, true);
  const one = await ext(`/ext/v1/metrics/inspection.conformity_pct/values?site=${hounde}`);
  assert.equal(one.headers.get('x-sdp-freshness'), 'fresh');
});

test('/ext/v1: synced 1 h ago is fresh, 5 h ago is stale (limit 3 h)', async () => {
  await markSynced('zoho.requests', 1);
  let v = (await (await ext(`/ext/v1/metrics/helpdesk.resolution_sla_pct/values?site=${hounde}`)).json()).values[0];
  assert.equal(v.freshness, 'FRESH'); assert.equal(v.authoritative, true);
  await markSynced('zoho.requests', 5);
  const r = await ext(`/ext/v1/metrics/helpdesk.resolution_sla_pct/values?site=${hounde}`);
  v = (await r.json()).values[0];
  assert.equal(v.freshness, 'STALE'); assert.equal(v.authoritative, false); assert.equal(r.headers.get('x-sdp-freshness'), 'stale');
});

test('OData Values carry Freshness + Authoritative (declared in $metadata)', async () => {
  const meta = await (await ext('/ext/odata/$metadata')).text();
  assert.match(meta, /Name="Freshness"/); assert.match(meta, /Name="Authoritative"/);
  const j = await (await ext(`/ext/odata/Values?$filter=Metric eq 'helpdesk.resolution_sla_pct' and SiteId eq ${hounde}&$select=Metric,Freshness,Authoritative`)).json();
  assert.ok(j.value.length >= 1); assert.equal(j.value[0].Freshness, 'STALE'); assert.equal(j.value[0].Authoritative, false);
});

test('dashboard data lists stale sources behind its widgets', async () => {
  const def = { key: 'pf-dash', title: 'PF', audience: 'site', grid: { columns: 12 }, widgets: [
    { id: 'a', type: 'kpi', metric: 'helpdesk.resolution_sla_pct', title: 'SLA', layout: { x: 0, y: 0, w: 3, h: 2 } },
    { id: 'b', type: 'kpi', metric: 'inspection.conformity_pct', title: 'Insp', layout: { x: 3, y: 0, w: 3, h: 2 } }] };
  const H = { 'x-report-token': admin, 'content-type': 'application/json' };
  assert.equal((await fetch(base + '/api/dashboards/pf-dash', { method: 'PUT', headers: H, body: JSON.stringify({ definition: def }) })).status, 200);
  const d = await (await fetch(base + `/api/dashboards/pf-dash/data?draft=1&site=${hounde}`, { headers: H })).json();
  assert.deepEqual(d.stale_sources.map((s) => [s.module, s.state]), [['helpdesk', 'STALE']]);
  await markSynced('zoho.requests', 0.5);
  const d2 = await (await fetch(base + `/api/dashboards/pf-dash/data?draft=1&site=${hounde}`, { headers: H })).json();
  assert.deepEqual(d2.stale_sources, []);
});
