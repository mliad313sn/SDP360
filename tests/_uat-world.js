'use strict';
// AMDEC 2026-11-05 — seeded MULTINATIONAL world for the agent-executed scenario campaign ("UAT simulée").
// Not a test file (no .test.js suffix): required by tests/uat-amdec-*.test.js, which run on the throwaway
// PostgreSQL schema of tests/_pg-boot.mjs. Everything is created through the product's own code paths
// (reports-db users and sites, the HTTP API where a route exists). Passwords are random per run; no real
// person, credential or production record is used.
//
// Countries / currencies : Senegal (SN, XOF), Burkina Faso (BF, XOF), Côte d'Ivoire (CI, XOF), Mali (ML, XOF),
//                          United Kingdom (GB, GBP); amounts reported in USD.
// Organisation models    : (a) central Group IT (site-less admin / super_admin) · (b) federated site
//                          coordinators (editor locked to one site) · (c) multi-site editor spanning three
//                          countries · (d) shared office service desk (one editor for Dakar + Abidjan +
//                          Ouagadougou) · (e) sites with no meetings/inspection code (Exploration, Assafo,
//                          London) · (f) business-only accounts · (g) executive / scorecard / finance readers
//                          · (h) field technician · (i) KPI committee (no dedicated role exists — see report)
//                          · (j) committee member, viewer, deactivated account.
const crypto = require('crypto');
const http = require('http');

const pw = () => 'Uat!' + crypto.randomBytes(9).toString('hex');

// Country of every seeded site (the product stores it in sites.country, migration 036).
const COUNTRY = {
  Sabodala: 'SN', Massawa: 'SN', Dakar: 'SN',
  MANA: 'BF', Hounde: 'BF', Ouagadougou: 'BF', Wahgnion: 'BF',
  Ity: 'CI', Lafigue: 'CI', Abidjan: 'CI', Tanda: 'CI', Exploration: 'CI', Assafo: 'CI',
  Kalana: 'ML', 'London Office': 'GB',
};

function call(base, method, p, token, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(base + p);
    const data = body !== undefined ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, agent: false,
      headers: Object.assign({ 'x-report-token': token || '' }, data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks); const t = buf.toString('utf8');
        let j = null; try { j = JSON.parse(t); } catch (_) {}
        resolve({ status: res.statusCode, j, text: t, buf, headers: res.headers });
      });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}

async function boot() {
  for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
  process.env.AI_PROVIDER = 'off';
  process.env.SDP_TEST_NO_RATE_LIMIT = '1';
  process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'uat-amdec-key-000000000000000000';
  const srv = require('../server');
  await srv.seedStores();
  const rdb = require('../reports-db');
  const server = await new Promise((r) => { const s = http.createServer(srv.app).listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { app: srv.app, rdb, server, base, close: () => new Promise((r) => server.close(() => r())) };
}

async function siteId(rdb, name, group) {
  await rdb.db.prepare('INSERT INTO sites (name, zoho_group) VALUES (?, ?) ON CONFLICT DO NOTHING').run(name, group || null);
  return Number((await rdb.db.prepare('SELECT id FROM sites WHERE name=?').get(name)).id);
}

async function seedWorld(ctx) {
  const { rdb, base } = ctx;
  // Extra sites the shipped seed does not carry: Massawa as its own Senegal site (user decision 4f5d427),
  // Assafo (exploration, no module codes), the London office (GBP). Shared helpdesk groups are kept distinct.
  await siteId(rdb, 'Massawa', 'Massawa IT Agents');
  await siteId(rdb, 'Assafo', 'Assafo IT Support');
  await siteId(rdb, 'London Office', 'London IT Support');
  const sites = await rdb.listSites({ includeInactive: true });
  const S = {}; for (const s of sites) S[s.name] = s;
  for (const [n, c] of Object.entries(COUNTRY)) if (S[n]) await rdb.db.prepare('UPDATE sites SET country=? WHERE id=?').run(c, S[n].id);

  const users = {};
  async function user(key, roles, site, extra, opts) {
    const u = { key, username: 'uat_' + key, password: pw(), site_id: site ? S[site].id : null };
    await rdb.createUser({ username: u.username, full_name: (opts && opts.full_name) || ('UAT ' + key), password: u.password, roles, site_id: u.site_id,
      extra_site_ids: (extra || []).map((n) => S[n].id) });
    u.id = Number((await rdb.db.prepare('SELECT id FROM users WHERE username=?').get(u.username)).id);
    u.token = (await rdb.login(u.username, u.password)).token;
    users[key] = u; return u;
  }
  const me = (await rdb.listUsers()).find((u) => u.username === process.env.DASH_USER);
  await rdb.setUserRoles(me.id, ['super_admin']);
  users.sa = { key: 'sa', username: process.env.DASH_USER, id: Number(me.id), token: (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token };
  await user('central', ['admin'], null);                                      // (a) Group IT, site-less
  await user('edSGO', ['editor', 'tracker-editor'], 'Sabodala');               // (b) federated
  await user('edMAS', ['editor'], 'Massawa');                                  // (b) new SN site, no module code
  await user('edHGO', ['editor', 'tracker-editor'], 'Hounde', [], { full_name: 'Awa Ouédraogo' }); // (b) FR name
  await user('ms3', ['editor', 'tracker-editor'], 'Sabodala', ['Hounde', 'Ity']); // (c) 3 sites, 3 countries
  await user('desk', ['editor'], 'Dakar', ['Abidjan', 'Ouagadougou']);         // (d) shared office desk SN/CI/BF
  await user('edEXP', ['editor', 'tracker-editor'], 'Exploration');            // (e) sub-sites FETEKRO/TANDA
  await user('edASF', ['editor', 'tracker-editor'], 'Assafo');                 // (e) no meetings/inspection code
  await user('edTND', ['editor', 'tracker-editor'], 'Tanda');                  // exploration site, tracker code TND
  await user('edLDN', ['editor'], 'London Office');                            // (e) UK office
  await user('bizHGO', ['site-business'], 'Hounde');                           // (f)
  await user('bizGRP', ['group-business'], null);                              // (f)
  await user('exec', ['executive'], null);                                     // (g)
  await user('scv', ['scorecard-viewer'], null);                               // (g)
  await user('fin', ['viewer', 'finance-viewer'], null);                       // (g) Finance reader
  await user('tech', ['field-tech'], 'Hounde');                                // (h)
  await user('cttee', ['viewer', 'committee-member'], null);                   // (i)/(j)
  await user('viewer', ['viewer'], null);                                      // (j) site-less reader
  await user('viewerSGO', ['viewer'], 'Sabodala');                             // (j) site reader
  await user('gone', ['editor'], 'Hounde');                                    // (j) deactivated below
  await rdb.db.prepare('UPDATE users SET active=0 WHERE id=?').run(users.gone.id);

  // One weekly report per relevant site, same ISO week (W37 2026).
  const reports = {};
  for (const n of ['Sabodala', 'Massawa', 'Hounde', 'Ity', 'Dakar', 'Abidjan', 'Ouagadougou', 'Exploration', 'Assafo', 'London Office', 'Kalana'])
    reports[n] = (await rdb.ensureReport(S[n].id, 2026, 37)).id;

  return { S, users, reports, call: (m, p, t, b) => call(base, m, p, t, b) };
}

module.exports = { boot, seedWorld, call, COUNTRY };
