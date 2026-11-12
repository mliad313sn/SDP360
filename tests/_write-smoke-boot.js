'use strict';
// F-ARCH-08 — shared boot for the seed smokes of routes that had no strict test reference:
// boots server.js in-process on the test's throwaway PostgreSQL (tests/_pg-boot.mjs), creates the
// personas asked for, returns { base, tok, rdb, send, close }.
const fetch = require('./_http-fetch');
const http = require('http');

async function boot(personas, { prefix = 'ws' } = {}) {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  const sites = (await rdb.listSites({ includeInactive: true })) || [];
  const tok = {};
  for (const [name, roles, siteIx] of personas) {
    const username = `${prefix}_${name}`, password = `${username}-pass-0000`;
    const site_id = siteIx == null ? null : (sites[siteIx] || {}).id;
    try { await rdb.createUser({ username, full_name: username, password, role: roles[0], roles, site_id }); } catch (_) { /* already there */ }
    tok[name] = (await rdb.login(username, password)).token;
  }
  let server;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const send = (method, p, t, body) => fetch(base + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, t ? { 'x-report-token': t } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
  return { base, tok, rdb, sites, send, close: () => server && server.close() };
}
module.exports = { boot };
