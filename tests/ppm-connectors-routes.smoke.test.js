'use strict';
// W4-CONNECTORS over HTTP, fictitious data, FAKE transports only (no network, no real tenant): every connector route is
// 404 while its switch is '0' (= today) and the native project works untouched; XER export → import into an empty project
// (dry run for a plan writer, apply = committee); .mpp answers 501 while no converter is configured, then converts through
// a fake local converter; Jira / Azure DevOps pull only into a project that opted in, dry run first, idempotent apply,
// read-only (no write verb ever sent), credentials never echoed.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ppm-w4c-'));
process.env.DASH_USER = process.env.DASH_USER || 'ppmw4c-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'ppmw4c-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'ppmw4c-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const WIC = require('../services/ppm/workItemClient');
const MPP = require('../services/ppm/mppConverter');
const MSPDI = require('../services/ppm/mspdi');
let server, base, rdb, cfg, siteA, obj, T = {}, P = {};

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'ppm_external_links'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  siteA = (await rdb.listSites({ includeInactive: true })).find((s) => /hounde/i.test(s.name)).id;
  const mk = async (u, roles, site) => { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); return (await rdb.login(u, u + 'pass1234')).token; };
  T.pmo = await mk('w4c_pmo', ['viewer', 'committee-member']);
  T.viewer = await mk('w4c_viewer', ['viewer'], siteA);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  const prog = (await put('programme', T.pmo, { key: 'w4c-prog', name: 'W4C' })).j.id;
  obj = (await put('objective', T.pmo, { programme_id: prog, key: 'w4c-o', name: 'O' })).j.id;
  const mkp = async (key) => (await put('project', T.pmo, { objective_id: obj, key, name: 'Fictitious ' + key, owner: 'w4c_pmo', site_id: siteA, start_date: '2027-01-04' })).j.id;
  P.src = await mkp('W4C-SRC'); P.xer = await mkp('W4C-XER'); P.mpp = await mkp('W4C-MPP'); P.jira = await mkp('W4C-JIRA'); P.azdo = await mkp('W4C-AZDO');
  const a = (await put('task', T.pmo, { project_id: P.src, name: 'Design', duration_days: 3 })).j.id;
  await put('task', T.pmo, { project_id: P.src, name: 'Build', duration_days: 2, depends_on: [a] });
});
after(() => { WIC.useTransport(null); return server && server.close(); });
const send = async (m, p, t, body, raw) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, raw != null ? { 'content-type': 'application/octet-stream' } : body ? { 'content-type': 'application/json' } : {}), body: raw != null ? raw : body ? JSON.stringify(body) : undefined }); const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (_) {} return { status: r.status, j, txt, headers: r.headers }; };
const put = (k, t, b) => send('PUT', '/api/governance/portfolio/' + k, t, b);
const sw = (patch) => cfg.setConfig(rdb.db, patch, 'smoke');
const OFF = { ppm_xer_enabled: '0', ppm_mpp_import_enabled: '0', ppm_jira_sync_enabled: '0', ppm_azdo_sync_enabled: '0' };

test('W4-CONNECTORS: every connector route is 404 while its switch is off; the native project still works', async () => {
  await sw(OFF);
  for (const [m, p] of [['GET', `/api/governance/ppm/project/${P.src}/project.xer`], ['POST', `/api/governance/ppm/project/${P.xer}/xer/import`], ['POST', `/api/governance/ppm/project/${P.mpp}/mpp/import`],
    ['GET', `/api/governance/ppm/project/${P.jira}/work-items/jira`], ['PUT', `/api/governance/ppm/project/${P.jira}/work-items/jira`], ['POST', `/api/governance/ppm/project/${P.jira}/work-items/azdo/sync`],
    ['GET', `/api/governance/ppm/project/${P.jira}/work-items/other`], ['GET', '/api/governance/ppm/connectors/status']]) {
    assert.equal((await send(m, p, T.pmo, m === 'GET' ? null : {})).status, 404, `${m} ${p}`);
  }
  const f = (await send('GET', '/api/governance/ppm/features', T.viewer)).j;
  assert.deepEqual([f.xer, f.mpp_import, f.jira_sync, f.azdo_sync], [false, false, false, false]);
  assert.equal((await put('task', T.pmo, { project_id: P.src, name: 'Native still works', duration_days: 1 })).status, 200);
});

test('XER: export → import into an EMPTY project (dry run = plan writer, apply = committee)', async () => {
  await sw({ ppm_xer_enabled: '1' });
  try {
    const ex = await send('GET', `/api/governance/ppm/project/${P.src}/project.xer`, T.viewer);
    assert.equal(ex.status, 200, ex.txt);
    assert.match(ex.txt, /^ERMHDR\t/); assert.match(ex.txt, /%T\tTASKPRED/);
    assert.equal((await send('POST', `/api/governance/ppm/project/${P.xer}/xer/import`, T.pmo, null, '<Project/>')).j.code, 'XER_PARSE');
    const dry = await send('POST', `/api/governance/ppm/project/${P.xer}/xer/import`, T.pmo, null, ex.txt);
    assert.equal(dry.status, 200, dry.txt); assert.equal(dry.j.dry_run, true); assert.equal(dry.j.source, 'xer'); assert.equal(dry.j.summary.tasks, 3); assert.equal(dry.j.summary.links, 1);
    assert.equal((await send('POST', `/api/governance/ppm/project/${P.xer}/xer/import?apply=1`, T.viewer, null, ex.txt)).status, 403);
    const ap = await send('POST', `/api/governance/ppm/project/${P.xer}/xer/import?apply=1`, T.pmo, null, ex.txt);
    assert.equal(ap.status, 200, ap.txt); assert.equal(ap.j.result.tasks, 3); assert.equal(ap.j.result.links, 1);
    assert.equal((await send('POST', `/api/governance/ppm/project/${P.xer}/xer/import?apply=1`, T.pmo, null, ex.txt)).status, 409, 'never into a project with tasks');
  } finally { await sw(OFF); }
});

test('.mpp: 501 with the how-to while no converter is set; then converts through a fake local converter', async () => {
  await sw({ ppm_mpp_import_enabled: '1', ppm_mpp_converter_cmd: '' });
  const mpp = Buffer.concat([MPP.OLE2_MAGIC, Buffer.from('fictitious')]);
  try {
    const r = await send('POST', `/api/governance/ppm/project/${P.mpp}/mpp/import`, T.pmo, null, mpp);
    assert.equal(r.status, 501, r.txt); assert.equal(r.j.code, 'MPP_CONVERTER_NOT_CONFIGURED'); assert.match(r.j.error, /ppm_mpp_converter_cmd/);
    if (process.platform === 'win32') return;
    const d = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'w4c-conv-'));
    const xml = _path.join(d, 'fixture.xml');
    _fs.writeFileSync(xml, MSPDI.toXml({ name: 'Converted', start_date: '2027-01-04', tasks: [{ uid: 1, id: 1, name: 'From mpp', outline_level: 1, duration_days: 2 }] }));
    const conv = _path.join(d, 'fake-mpxj'); _fs.writeFileSync(conv, `#!/bin/sh\ncp "${xml}" "$2"\n`, { mode: 0o755 });
    await sw({ ppm_mpp_converter_cmd: conv });
    assert.equal((await send('POST', `/api/governance/ppm/project/${P.mpp}/mpp/import`, T.pmo, null, Buffer.from('not ole2'))).j.code, 'MPP_NOT_OLE2');
    const ok = await send('POST', `/api/governance/ppm/project/${P.mpp}/mpp/import`, T.pmo, null, mpp);
    assert.equal(ok.status, 200, ok.txt); assert.equal(ok.j.source, 'mpp'); assert.equal(ok.j.summary.tasks, 1); assert.equal(ok.j.dry_run, true);
  } finally { await sw({ ...OFF, ppm_mpp_converter_cmd: '' }); }
});

test('Jira / Azure DevOps: opt-in, dry run, idempotent apply, read-only, credentials never echoed', async () => {
  let issues = [{ key: 'FIC-1', fields: { summary: 'Login page', status: { name: 'To Do', statusCategory: { key: 'new' } }, timeoriginalestimate: 14400 } },
    { key: 'FIC-2', fields: { summary: 'API', status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } }, duedate: '2027-02-01' } }];
  const verbs = [];
  WIC.useTransport({
    get: async (url, o) => { verbs.push('GET'); assert.ok(!url.includes('jira-SECRET') && !url.includes('azdo-SECRET'), 'secret never in a URL');
      if (url.includes('/rest/api/2/search')) return { data: { total: issues.length, issues } };
      return { data: { value: [{ id: 7, fields: { 'System.Title': 'Fictitious WI', 'System.State': 'Active', 'Microsoft.VSTS.Scheduling.StartDate': '2027-01-05', 'Microsoft.VSTS.Scheduling.TargetDate': '2027-01-07' } }] } }; },
    post: async (url) => { verbs.push(url.includes('/_apis/wit/wiql') ? 'WIQL' : 'POST'); return { data: { workItems: [{ id: 7 }] } }; },
  });
  await sw({ ppm_jira_sync_enabled: '1', ppm_azdo_sync_enabled: '1' });
  try {
    const J = `/api/governance/ppm/project/${P.jira}/work-items/jira`;
    assert.equal((await send('POST', J + '/sync', T.pmo, {})).j.code, 'NOT_OPTED_IN');
    assert.equal((await send('PUT', J, T.viewer, { scope: 'FIC' })).status, 403, 'opt-in is a plan write');
    assert.equal((await send('PUT', J, T.pmo, { scope: '' })).status, 400);
    assert.equal((await send('PUT', J, T.pmo, { scope: 'FIC' })).status, 200);
    assert.equal((await send('POST', J + '/sync', T.pmo, {})).j.code, 'CONNECTOR_NOT_CONFIGURED');
    await sw({ ppm_jira_base_url: 'https://jira.fict.example', ppm_jira_user: 'svc@fict.example', ppm_jira_api_token: 'jira-SECRET-tok', ppm_azdo_org_url: 'https://dev.fict.example/org', ppm_azdo_project: 'Fict', ppm_azdo_pat: 'azdo-SECRET-pat' });
    const dry = await send('POST', J + '/sync', T.pmo, {});
    assert.equal(dry.status, 200, dry.txt); assert.equal(dry.j.dry_run, true); assert.equal(dry.j.summary.create, 2);
    assert.equal((await send('GET', J, T.pmo)).j.links.length, 0, 'a dry run writes nothing');
    assert.equal((await send('POST', J + '/sync?apply=1', T.viewer, {})).status, 403);
    const ap = await send('POST', J + '/sync?apply=1', T.pmo, {});
    assert.equal(ap.status, 200, ap.txt); assert.equal(ap.j.result.created, 2);
    const again = await send('POST', J + '/sync?apply=1', T.pmo, {});
    assert.deepEqual([again.j.result.created, again.j.result.updated, again.j.summary.unchanged], [0, 0, 2], 'idempotent');
    issues = [{ ...issues[0], fields: { ...issues[0].fields, status: { name: 'Done', statusCategory: { key: 'done' } } } }, issues[1]];
    const upd = await send('POST', J + '/sync?apply=1', T.pmo, {});
    assert.equal(upd.j.result.updated, 1);
    const view = (await send('GET', J, T.viewer)).j;
    assert.equal(view.links.length, 2); assert.equal(view.read_only, true); assert.ok(view.links[0].external_url.startsWith('https://jira.fict.example/browse/'));
    const d = (await send('GET', `/api/governance/portfolio/project/${P.jira}`, T.pmo)).j;
    const tasks = d.tasks || (d.detail && d.detail.tasks) || (d.project && d.project.tasks) || [];
    assert.equal(tasks.length, 2, 'two native tasks created: ' + Object.keys(d).join(','));
    const t1 = tasks.find((t) => /FIC-1/.test(t.name)); assert.equal(t1.status, 'done'); assert.equal(Number(t1.effort_hours), 4);
    // Azure DevOps
    const A = `/api/governance/ppm/project/${P.azdo}/work-items/azdo`;
    assert.equal((await send('PUT', A, T.pmo, { scope: 'Fict\\Team A' })).status, 200);
    const az = await send('POST', A + '/sync?apply=1', T.pmo, {});
    assert.equal(az.status, 200, az.txt); assert.equal(az.j.result.created, 1);
    assert.ok(verbs.every((v) => v === 'GET' || v === 'WIQL'), 'only reads and the WIQL query are sent: ' + verbs.join(','));
    // status: committee only, secrets never echoed
    assert.equal((await send('GET', '/api/governance/ppm/connectors/status', T.viewer)).status, 403);
    const st = await send('GET', '/api/governance/ppm/connectors/status', T.pmo);
    assert.equal(st.status, 200, st.txt); assert.equal(st.j.connections.jira.token_set, true); assert.ok(!st.txt.includes('SECRET'));
    assert.equal(st.j.sources.length, 2);
    // opt out
    assert.equal((await send('PUT', A, T.pmo, { enabled: false })).j.removed, true);
    assert.equal((await send('POST', A + '/sync', T.pmo, {})).j.code, 'NOT_OPTED_IN');
  } finally { WIC.useTransport(null); await sw(OFF); }
});
