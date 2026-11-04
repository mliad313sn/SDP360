'use strict';
// B-05 — the seeded world the journeys run against. Everything is created through the same code
// paths the product uses (reports-db users, the HTTP API for reports / portfolio / cadences,
// meetings-db for a PV), on the throwaway database of fixtures/server.js. Passwords are random per run.
const crypto = require('crypto');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const pw = () => 'E2e!' + crypto.randomBytes(9).toString('hex');

function call(base, method, p, token, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(base + p);
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, agent: false,
      headers: Object.assign({ 'x-report-token': token || '' }, data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) }, (res) => {
      let t = ''; res.setEncoding('utf8'); res.on('data', (c) => { t += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch (_) {} resolve({ status: res.statusCode, j }); });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}

async function seed(app) {
  const { rdb, base } = app;
  const mdb = require(path.join(ROOT, 'meetings-db.js'));
  const cfg = require(path.join(ROOT, 'services', 'reportConfig.js'));
  const sites = await rdb.listSites({ includeInactive: true });
  const siteA = sites.find((s) => /hounde/i.test(s.name));
  const siteB = sites.find((s) => /mana/i.test(s.name));

  const users = {};
  async function user(key, roles, site) {
    const u = { username: 'e2e_' + key, password: pw(), full_name: 'E2E ' + key, site_id: site ? site.id : null };
    await rdb.createUser({ username: u.username, full_name: u.full_name, password: u.password, roles, site_id: u.site_id });
    u.token = (await rdb.login(u.username, u.password)).token;   // seeding only; the browser logs in itself
    users[key] = u;
    return u;
  }
  await user('edA', ['editor'], siteA);          // site IT lead of A (Hounde, meetings code HGO)
  await user('edB', ['editor'], siteB);          // site IT lead of B (MANA)
  await user('groupit', ['viewer', 'committee-member'], null);
  await user('tech', ['field-tech'], siteA);     // technician of A (field app)

  // T1 — a PV on site A with one OVERDUE open action
  const pv = await mdb.saveMeeting({
    header: { reference: 'E2E_PV_HGO_MINING', site_code: 'HGO', department: 'mining', meeting_date: '2026-01-15', intake_source: 'dept_meeting', status: 'submitted' },
    issues: [],
    actions: [{ description: 'E2E overdue action — replace the core switch PSU', owner_it: 'E2E edA', target_date: '2026-02-01', status: 'open' }],
  }, null, null);
  const meeting = await mdb.getMeeting(pv.id);
  const action = meeting.actions[0];

  // T2 + deny — last week's report for each site (created by its own editor, the way the page does it)
  const wk = await rdb.getPreviousWeek();
  const repA = await call(base, 'POST', '/api/reports/ensure', users.edA.token, { site_id: siteA.id, year: wk.year, week: wk.week });
  const repB = await call(base, 'POST', '/api/reports/ensure', users.edB.token, { site_id: siteB.id, year: wk.year, week: wk.week });
  if (repA.status !== 200 || repB.status !== 200) throw new Error('[seed] report ensure failed: ' + JSON.stringify([repA, repB]));

  // deny — one portfolio project per site (committee writes)
  const put = (k, b) => call(base, 'PUT', '/api/governance/portfolio/' + k, users.groupit.token, b);
  const prog = (await put('programme', { key: 'e2e-prog', name: 'E2E programme' })).j.id;
  const obj = (await put('objective', { programme_id: prog, key: 'e2e-o', name: 'E2E objective' })).j.id;
  const projA = (await put('project', { objective_id: obj, key: 'E2E-A', name: 'E2E project Hounde', site_id: siteA.id, owner: 'nobody', status: 'active' })).j.id;
  const projB = (await put('project', { objective_id: obj, key: 'E2E-B', name: 'E2E project Mana', site_id: siteB.id, owner: 'nobody', status: 'active' })).j.id;
  if (!projA || !projB) throw new Error('[seed] portfolio projects not created');

  // T4 — a group cadence for Friday
  const cad = await call(base, 'PUT', '/api/governance/cadences', users.groupit.token, { key: 'e2e-group-friday', name: 'E2E Group IT Friday', kind: 'group_monthly', site_id: null, weekday: 5, time_local: '09:00', duration_min: 60, participants: [] });
  if (cad.status !== 200) throw new Error('[seed] cadence not created: ' + JSON.stringify(cad));

  const setConfig = (patch) => cfg.setConfig(rdb.db, patch, 'e2e');
  return { users, siteA, siteB, action, meetingId: pv.id, reportA: repA.j.id, reportB: repB.j.id, projA, projB, cadenceId: cad.j.cadence.id, call: (m, p, t, b) => call(base, m, p, t, b), setConfig };
}

module.exports = { seed };
