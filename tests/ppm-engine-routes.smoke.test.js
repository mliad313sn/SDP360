'use strict';
// W2-ENGINE over HTTP, fictitious data only: every W2 action is 404 while its switch is '0' (= today); once on, the
// schedule contract carries the calendar built on the SITE holiday calendar + a working exception, typed lags,
// time-phased loads and over-allocations; money (rates, costs) only for money readers; shared calendars / the pool /
// rates are committee writes; levelling is a proposal applied only with its fingerprint; baseline slots are immutable;
// MSPDI export → import into an empty project round-trips the plan.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ppm-w2e-'));
process.env.DASH_USER = process.env.DASH_USER || 'ppmw2e-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'ppmw2e-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'ppmw2e-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, cfg, pid, pid2, siteA, siteB, obj, T = {}, task = {};

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'ppm_baseline_slots'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  const sites = await rdb.listSites({ includeInactive: true });
  siteA = sites.find((s) => /hounde/i.test(s.name)).id;
  siteB = sites.find((s) => s.id !== siteA).id;
  const mk = async (u, roles, site) => { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); return (await rdb.login(u, u + 'pass1234')).token; };
  T.pmo = await mk('w2e_pmo', ['viewer', 'committee-member']);
  T.fin = await mk('w2e_fin', ['viewer', 'finance-viewer']);
  T.viewer = await mk('w2e_viewer', ['viewer'], siteA);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  const prog = (await put('programme', T.pmo, { key: 'w2e-prog', name: 'W2E' })).j.id;
  obj = (await put('objective', T.pmo, { programme_id: prog, key: 'w2e-o', name: 'O' })).j.id;
  pid = (await put('project', T.pmo, { objective_id: obj, key: 'W2E-1', name: 'Fictitious W2 project', owner: 'w2e_pmo', site_id: siteA, start_date: '2027-01-04', currency: 'USD' })).j.id;
  pid2 = (await put('project', T.pmo, { objective_id: obj, key: 'W2E-2', name: 'Empty import target', owner: 'w2e_pmo', site_id: siteA, start_date: '2027-01-04', currency: 'USD' })).j.id;
  const mkTask = async (name, o) => { const r = await put('task', T.pmo, { project_id: pid, name, ...o }); assert.equal(r.status, 200, JSON.stringify(r.j)); return r.j.id; };
  task.A = await mkTask('A', { duration_days: 2, effort_hours: 16 });
  task.B = await mkTask('B', { duration_days: 3 });
  task.C = await mkTask('C', { duration_days: 1, depends_on: [task.B], dependency_links: [{ id: task.B, type: 'FS', lag: 2, lag_unit: 'ed' }] });
  task.D = await mkTask('D', { duration_days: 1, depends_on: [task.C] });
  // the SITE holiday calendar (migration 037): Monday 2027-01-11 is a holiday of site A
  await rdb.db.prepare(`INSERT INTO site_calendar (site_id, day, kind, label, created_at) VALUES (?, '2027-01-11', 'holiday', 'fictitious', '2026-11-13')`).run(siteA);
});
after(() => server && server.close());
const send = async (m, p, t, body, raw) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, raw ? { 'content-type': 'application/xml' } : body ? { 'content-type': 'application/json' } : {}), body: raw != null ? raw : body ? JSON.stringify(body) : undefined }); const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (_) {} return { status: r.status, j, txt }; };
const put = (k, t, b) => send('PUT', '/api/governance/portfolio/' + k, t, b);
const sw = (patch) => cfg.setConfig(rdb.db, patch, 'smoke');
const ALL = { ppm_schedule_engine_v2_ui: '1', ppm_calendars_enabled: '1', ppm_resources_enabled: '1', ppm_leveling_enabled: '1', ppm_baseline_slots_enabled: '1', ppm_mspdi_enabled: '1' };
const OFF = Object.fromEntries(Object.keys(ALL).map((k) => [k, '0']));

test('W2-ENGINE: every action is 404 while its switch is off (today)', async () => {
  await sw(OFF);
  for (const [m, p] of [['GET', `/api/governance/ppm/project/${pid}/schedule`], ['GET', '/api/governance/ppm/calendars'], ['PUT', '/api/governance/ppm/calendars'], ['GET', '/api/governance/ppm/resources'],
    ['PUT', `/api/governance/ppm/task/${task.A}/engine`], ['GET', `/api/governance/ppm/project/${pid}/leveling`], ['POST', `/api/governance/ppm/project/${pid}/leveling/apply`],
    ['GET', `/api/governance/ppm/project/${pid}/baseline-slots`], ['GET', `/api/governance/ppm/project/${pid}/mspdi.xml`], ['PUT', `/api/governance/ppm/task/${task.A}/assignments`]]) {
    assert.equal((await send(m, p, T.pmo, m === 'GET' ? null : {})).status, 404, `${m} ${p}`);
  }
  const f = (await send('GET', '/api/governance/ppm/features', T.viewer)).j;
  assert.deepEqual([f.calendars, f.resources, f.leveling, f.baseline_slots, f.mspdi], [false, false, false, false, false]);
});

test('W2-ENGINE: calendars on the site holiday calendar, pool + rates, schedule contract, money rule, levelling, slots, MSPDI', async () => {
  await sw(ALL);
  try {
    // calendars — committee only; the site holiday + a working Saturday exception
    assert.equal((await send('PUT', '/api/governance/ppm/calendars', T.viewer, { name: 'x' })).status, 403);
    const cal = await send('PUT', '/api/governance/ppm/calendars', T.pmo, { name: 'Site A Mon–Fri', site_id: siteA, workdays: [1, 2, 3, 4, 5], hours_per_day: 8 });
    assert.equal(cal.status, 200, JSON.stringify(cal.j));
    assert.equal((await send('POST', `/api/governance/ppm/calendars/${cal.j.id}/exceptions`, T.pmo, { day_from: '2027-01-09', working: true, label: 'Saturday shift' })).status, 200);
    assert.equal((await send('POST', `/api/governance/ppm/calendars/${cal.j.id}/exceptions`, T.pmo, { day_from: '2027-01-10', day_to: '2027-01-09' })).j.code, 'BAD_RANGE');
    assert.equal((await send('PUT', `/api/governance/ppm/project/${pid}/calendar`, T.viewer, { calendar_id: cal.j.id })).status, 403);
    assert.equal((await send('PUT', `/api/governance/ppm/project/${pid}/calendar`, T.pmo, { calendar_id: cal.j.id })).status, 200);
    const cl = (await send('GET', '/api/governance/ppm/calendars', T.viewer)).j;
    assert.equal(cl.can_edit, false); assert.equal(cl.calendars[0].resolved.holidays, 1);

    // schedule: B Mon 04 → Wed 06; FS +2 elapsed days → Sat 09 (a working exception); D after C → Mon 11 is the site holiday → Tue 12
    let s = await send('GET', `/api/governance/ppm/project/${pid}/schedule`, T.viewer);
    assert.equal(s.status, 200, JSON.stringify(s.j));
    assert.equal(s.j.contract, 'w2-engine/1');
    const row = (x, id) => x.j.schedule.tasks.find((t) => t.id === id);
    assert.deepEqual([row(s, task.B).es_date, row(s, task.B).ef_date, row(s, task.C).es_date, row(s, task.D).es_date], ['2027-01-04', '2027-01-06', '2027-01-09', '2027-01-12']);
    assert.deepEqual(row(s, task.C).calendar, { calendar_id: cal.j.id, source: 'project' });
    assert.equal(s.j.schedule.links.find((l) => l.to === task.C).lag_unit, 'ed');
    assert.deepEqual(s.j.ui_calendar, { workdays: [1, 2, 3, 4, 5], holidays: ['2027-01-11'], working_exceptions: ['2027-01-09'] });

    // pool + rates (committee; rates are money) + assignments (plan write)
    assert.equal((await send('PUT', '/api/governance/ppm/resources', T.viewer, { name: 'x' })).status, 403);
    const ana = (await send('PUT', '/api/governance/ppm/resources', T.pmo, { name: 'Ana (fictitious)', kind: 'work', site_id: siteA, max_units_pct: 100 })).j.id;
    const bob = (await send('PUT', '/api/governance/ppm/resources', T.pmo, { name: 'Bob (fictitious, other site)', kind: 'work', site_id: siteB })).j.id;
    assert.equal((await send('PUT', `/api/governance/ppm/resources/${ana}/rates`, T.viewer, { rate_table: 'A', standard_rate: 50, currency: 'USD' })).status, 403);
    assert.equal((await send('PUT', `/api/governance/ppm/resources/${ana}/rates`, T.pmo, { rate_table: 'A', standard_rate: 50 })).j.code, 'CURRENCY_REQUIRED');
    assert.equal((await send('PUT', `/api/governance/ppm/resources/${ana}/rates`, T.pmo, { rate_table: 'A', standard_rate: 50, cost_per_use: 10, currency: 'USD' })).status, 200);
    const rv = (await send('GET', '/api/governance/ppm/resources', T.viewer)).j;
    assert.ok(rv.money_hidden && rv.resources.every((r) => !('rates' in r)));
    assert.ok(!rv.resources.some((r) => r.id === bob), 'site perimeter: a resource of another site is not listed to a site reader');
    assert.equal((await send('GET', '/api/governance/ppm/resources', T.pmo)).j.resources.find((r) => r.id === ana).rates[0].standard_rate, 50);
    assert.ok(!(await send('GET', '/api/governance/ppm/resources', T.fin)).j.resources.some((r) => r.id === ana), 'a site-less finance reader sees group-wide resources only');
    assert.equal((await send('PUT', `/api/governance/ppm/task/${task.A}/assignments`, T.viewer, { assignments: [{ resource_id: ana, units_pct: 100 }] })).status, 403);
    for (const t of [task.A, task.B]) assert.equal((await send('PUT', `/api/governance/ppm/task/${t}/assignments`, T.pmo, { assignments: [{ resource_id: ana, units_pct: 100 }] })).status, 200);
    assert.equal((await send('PUT', `/api/governance/ppm/task/${task.A}/assignments`, T.pmo, { assignments: [{ resource_id: ana, contour: 'zigzag' }] })).j.code, 'BAD_CONTOUR');
    assert.equal((await send('PUT', `/api/governance/ppm/task/${task.A}/engine`, T.pmo, { priority: 600 })).status, 200);
    assert.equal((await send('PUT', `/api/governance/ppm/task/${task.A}/engine`, T.pmo, { leveling_delay_days: 3 })).j.code, 'LEVELING_BY_PROPOSAL');

    s = await send('GET', `/api/governance/ppm/project/${pid}/schedule`, T.viewer);
    assert.equal(s.j.money_hidden, true); assert.equal(s.j.task_costs, undefined);
    assert.ok(s.j.assignments.every((a) => !('cost' in a)));
    assert.deepEqual(s.j.overallocations.map((o) => [o.day, o.load_hours]), [['2027-01-04', 16], ['2027-01-05', 16]]);
    const sf = await send('GET', `/api/governance/ppm/project/${pid}/schedule`, T.fin);
    assert.deepEqual(sf.j.task_costs[task.A], { USD: 810 });   // 16 h × 50 + 10 per use
    assert.deepEqual(sf.j.task_costs[task.B], { USD: 1210 });  // 24 h × 50 + 10

    // levelling: a proposal (nothing written), applied only with its fingerprint
    const lv = await send('GET', `/api/governance/ppm/project/${pid}/leveling`, T.viewer);
    assert.equal(lv.status, 200, JSON.stringify(lv.j));
    assert.equal(lv.j.applied, false);
    assert.deepEqual(lv.j.delays, { [task.B]: 2 });
    assert.equal(lv.j.moves[0].reasons[0].rule, `lower priority (500) than task #${task.A} (600)`);
    assert.equal((await send('POST', `/api/governance/ppm/project/${pid}/leveling/apply`, T.viewer, { fingerprint: lv.j.fingerprint })).status, 403);
    assert.equal((await send('POST', `/api/governance/ppm/project/${pid}/leveling/apply`, T.pmo, { fingerprint: 'stale' })).j.code, 'STALE_PROPOSAL');
    assert.equal(row(await send('GET', `/api/governance/ppm/project/${pid}/schedule`, T.pmo), task.B).es_date, '2027-01-04', 'nothing applied yet');
    const ap = await send('POST', `/api/governance/ppm/project/${pid}/leveling/apply`, T.pmo, { fingerprint: lv.j.fingerprint });
    assert.equal(ap.status, 200, JSON.stringify(ap.j));
    s = await send('GET', `/api/governance/ppm/project/${pid}/schedule`, T.pmo);
    assert.deepEqual([row(s, task.B).es_date, row(s, task.B).leveling_delay_days], ['2027-01-06', 2]);
    assert.deepEqual(s.j.overallocations, []);
    const hist = (await send('GET', `/api/governance/portfolio/project/${pid}/history`, T.pmo)).j.events.map((e) => e.action);
    assert.ok(hist.includes('leveling_applied') && hist.includes('task_assignments') && hist.includes('project_calendar'));

    // baseline slots: immutable, cost for money readers only
    assert.equal((await send('POST', `/api/governance/ppm/project/${pid}/baseline-slots`, T.viewer, { kind: 'baseline', slot: 0, reason: 'first' })).status, 403);
    assert.equal((await send('POST', `/api/governance/ppm/project/${pid}/baseline-slots`, T.pmo, { kind: 'interim', slot: 0, reason: 'x y z' })).j.code, 'BAD_SLOT');
    const s0 = await send('POST', `/api/governance/ppm/project/${pid}/baseline-slots`, T.pmo, { kind: 'baseline', slot: 0, reason: 'plan of record' });
    assert.equal(s0.status, 200, JSON.stringify(s0.j)); assert.equal(s0.j.slot.name, 'Baseline');
    assert.equal((await send('POST', `/api/governance/ppm/project/${pid}/baseline-slots`, T.pmo, { kind: 'baseline', slot: 0, reason: 'again' })).j.code, 'SLOT_TAKEN');
    assert.equal((await send('POST', `/api/governance/ppm/project/${pid}/baseline-slots`, T.pmo, { kind: 'interim', slot: 1, reason: 'week 1' })).status, 200);
    await assert.rejects(rdb.db.prepare(`UPDATE ppm_baseline_slots SET reason='edited' WHERE project_id=?`).run(pid), /append-only|not allowed|refus/i);
    const gv = (await send('GET', `/api/governance/ppm/project/${pid}/baseline-slots`, T.viewer)).j;
    assert.equal(gv.slots.length, 2); assert.ok(!JSON.stringify(gv).includes('"cost"'));
    const gf = (await send('GET', `/api/governance/ppm/project/${pid}/baseline-slots`, T.fin)).j;
    assert.deepEqual(gf.slots.find((x) => x.kind === 'baseline').payload.tasks.find((t) => t.id === task.A).cost, { USD: 810 });
    assert.equal(gf.slots[0].variance.project_finish_variance_days, 0);

    // MSPDI: export (pmo reads money) → dry run → apply (committee) into the EMPTY project → same plan
    const x = await send('GET', `/api/governance/ppm/project/${pid}/mspdi.xml`, T.pmo);
    assert.equal(x.status, 200); assert.match(x.txt, /^<\?xml/); assert.ok(x.txt.includes('<LagFormat>8</LagFormat>') && x.txt.includes('<StandardRate>50</StandardRate>'));
    const xv = await send('GET', `/api/governance/ppm/project/${pid}/mspdi.xml`, T.viewer);
    assert.ok(!xv.txt.includes('<StandardRate>'), 'no rate for a reader without the money right');
    const dry = await send('POST', `/api/governance/ppm/project/${pid2}/mspdi/import`, T.pmo, null, x.txt);
    assert.equal(dry.status, 200, JSON.stringify(dry.j)); assert.equal(dry.j.dry_run, true); assert.equal(dry.j.summary.tasks, 4);
    assert.equal((await send('POST', `/api/governance/ppm/project/${pid2}/mspdi/import?apply=1`, T.viewer, null, x.txt)).status, 403);
    assert.equal((await send('POST', `/api/governance/ppm/project/${pid2}/mspdi/import`, T.pmo, null, '<Project><Tasks></Project>')).j.code, 'MSPDI_PARSE');
    const imp = await send('POST', `/api/governance/ppm/project/${pid2}/mspdi/import?apply=1`, T.pmo, null, x.txt);
    assert.equal(imp.status, 200, JSON.stringify(imp.j));
    assert.deepEqual([imp.j.result.tasks, imp.j.result.links, imp.j.result.resources_reused, imp.j.result.slots], [4, 2, 1, 1]);
    assert.equal((await send('POST', `/api/governance/ppm/project/${pid2}/mspdi/import?apply=1`, T.pmo, null, x.txt)).j.code, 'PROJECT_NOT_EMPTY');
    const s2 = (await send('GET', `/api/governance/ppm/project/${pid2}/schedule`, T.pmo)).j;
    const s1 = (await send('GET', `/api/governance/ppm/project/${pid}/schedule`, T.pmo)).j;
    const dates = (sc) => sc.schedule.tasks.map((t) => [t.es_date, t.ef_date]).sort();
    assert.deepEqual(dates(s2), dates(s1), 'the imported project schedules to the same dates (calendar, exception, holiday, elapsed lag, levelling delay)');
    const x2 = await send('GET', `/api/governance/ppm/project/${pid2}/mspdi.xml`, T.pmo);
    const strip = (t) => t.replace(/<UID>\d+<\/UID>|<TaskUID>\d+<\/TaskUID>|<ResourceUID>\d+<\/ResourceUID>|<PredecessorUID>\d+<\/PredecessorUID>|<CalendarUID>-?\d+<\/CalendarUID>|<BaseCalendarUID>-?\d+<\/BaseCalendarUID>|<Name>[^<]*<\/Name>/g, '');
    assert.equal(strip(x2.txt), strip(x.txt), 'export → import → export is lossless (ids and names aside)');
    // assignments read (money rule), levelling clear, exception removal (committee)
    const av = (await send('GET', `/api/governance/ppm/project/${pid}/assignments`, T.viewer)).j;
    assert.equal(av.money_hidden, true); assert.equal(av.assignments.length, 2); assert.equal(av.task_costs, undefined);
    assert.deepEqual((await send('GET', `/api/governance/ppm/project/${pid}/assignments`, T.fin)).j.task_costs[task.B], { USD: 1210 });
    assert.equal((await send('POST', `/api/governance/ppm/project/${pid}/leveling/clear`, T.viewer, {})).status, 403);
    const clr = await send('POST', `/api/governance/ppm/project/${pid}/leveling/clear`, T.pmo, {});
    assert.equal(clr.status, 200); assert.equal(clr.j.cleared, 1);
    assert.equal(row(await send('GET', `/api/governance/ppm/project/${pid}/schedule`, T.pmo), task.B).es_date, '2027-01-04');
    const exid = (await send('GET', '/api/governance/ppm/calendars', T.pmo)).j.calendars[0].exceptions[0].id;
    const dv = await send('DELETE', `/api/governance/ppm/calendars/${cal.j.id}/exceptions/${exid}`, T.viewer); assert.equal(dv.status, 403, JSON.stringify([exid, dv.j]));
    assert.equal((await send('DELETE', `/api/governance/ppm/calendars/${cal.j.id}/exceptions/${exid}`, T.pmo)).status, 200);
    assert.equal((await send('GET', `/api/governance/ppm/project/${pid}/schedule`, T.pmo)).j.ui_calendar.working_exceptions.length, 0);
  } finally { await sw(OFF); }
});
