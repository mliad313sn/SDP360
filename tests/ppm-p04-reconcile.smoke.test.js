'use strict';
// P04 PPM certification — T10 with calendars: every view of ONE project reads the SAME engine dates.
// Defect found at certification (2026-11-19): the W2 /schedule route schedules on the project calendar
// (site holidays, exceptions) while the project page plan, the W3 summary cards, the RAG slip and DCMA
// scheduled on the default Mon–Fri calendar — the dashboard did not reconcile to the engine as soon as
// ppm_calendars_enabled was on. Fictitious data only.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ppm-p04-'));
process.env.DASH_USER = process.env.DASH_USER || 'p04-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'p04-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'p04-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, cfg, siteA, pid, T = {};
const SW = { ppm_schedule_engine_v2_ui: '1', ppm_calendars_enabled: '1', ppm_simplified_view_enabled: '1', ppm_project_rag_enabled: '1', ppm_dcma_enabled: '1' };
const OFF = Object.fromEntries(Object.keys(SW).map((k) => [k, '0']));

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'ppm_calendars'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  const sites = await rdb.listSites({ includeInactive: true });
  siteA = sites.find((s) => /hounde/i.test(s.name)).id;
  await rdb.createUser({ username: 'p04_pmo', full_name: 'p04_pmo', password: 'p04_pmopass1234', roles: ['viewer', 'committee-member'] });
  T.pmo = (await rdb.login('p04_pmo', 'p04_pmopass1234')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  const prog = (await put('programme', T.pmo, { key: 'p04-prog', name: 'P04' })).j.id;
  const obj = (await put('objective', T.pmo, { programme_id: prog, key: 'p04-o', name: 'O' })).j.id;
  pid = (await put('project', T.pmo, { objective_id: obj, key: 'P04-1', name: 'Fictitious reconcile project', owner: 'nobody', sponsor: 'S', site_id: siteA, start_date: '2027-01-04', end_date: '2027-01-29',
    charter: 'Fictitious charter text long enough for the gate rule.', baseline_start: '2027-01-04', baseline_end: '2027-01-15' })).j.id;
  const t1 = (await put('task', T.pmo, { project_id: pid, name: 'Design', start_date: '2027-01-04', duration_days: 5, effort_hours: 40, progress_pct: 100, status: 'done' })).j.id;
  const t2 = (await put('task', T.pmo, { project_id: pid, name: 'Build', duration_days: 5, effort_hours: 40, progress_pct: 20, depends_on: [t1] })).j.id;
  await put('task', T.pmo, { project_id: pid, name: 'Go live', duration_days: 0, depends_on: [t2] });
  // Monday 2027-01-11 is a SITE holiday of site A (migration 037): the project calendar is built on it
  await rdb.db.prepare(`INSERT INTO site_calendar (site_id, day, kind, label, created_at) VALUES (?, '2027-01-11', 'holiday', 'fictitious', '2026-11-19')`).run(siteA);
});
after(() => server && server.close());
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }); let j = null; const txt = await r.text(); try { j = JSON.parse(txt); } catch (_) {} return { status: r.status, j, txt }; };
const put = (k, t, b) => send('PUT', '/api/governance/portfolio/' + k, t, b);
const sw = (patch) => cfg.setConfig(rdb.db, patch, 'smoke');

test('T10 + calendars: the project page plan, the W3 summary card and the W2 schedule give the same finish', async () => {
  await sw(SW);
  try {
    const cal = await send('PUT', '/api/governance/ppm/calendars', T.pmo, { name: 'Site A Mon–Fri', site_id: siteA, workdays: [1, 2, 3, 4, 5], hours_per_day: 8 });
    assert.equal(cal.status, 200, JSON.stringify(cal.j));
    assert.equal((await send('PUT', `/api/governance/ppm/project/${pid}/calendar`, T.pmo, { calendar_id: cal.j.id })).status, 200);
    const eng = await send('GET', `/api/governance/ppm/project/${pid}/schedule`, T.pmo);
    assert.equal(eng.status, 200, JSON.stringify(eng.j));
    const finish = eng.j.schedule.project_finish;
    // Design Mon 04 → Fri 08; Build 5 working days skipping the Monday 11 holiday: Tue 12 → Mon 18
    assert.equal(finish, '2027-01-18', 'the engine honours the site holiday');
    const page = (await send('GET', `/api/governance/portfolio/project/${pid}`, T.pmo)).j;
    assert.equal(page.plan.project_finish, finish, 'project page plan = engine');
    const sum = await send('GET', `/api/governance/ppm/project/${pid}/summary`, T.pmo);
    assert.equal(sum.status, 200, JSON.stringify(sum.j));
    assert.equal(sum.j.cards.forecast_finish, finish, 'W3 summary card = engine');
    // switches off = today: the plan is the default Mon–Fri calendar (no holiday)
    await sw({ ...SW, ppm_calendars_enabled: '0' });
    const page0 = (await send('GET', `/api/governance/portfolio/project/${pid}`, T.pmo)).j;
    assert.equal(page0.plan.project_finish, '2027-01-15', 'calendars off: today behaviour unchanged');
  } finally { await sw(OFF); }
});
