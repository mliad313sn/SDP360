'use strict';
// SEC-01 (parity check vs 1.11) — the field outbox "ticket" kind passed p.site straight to SDP: a site-scoped
// field user could open a ServiceDesk request naming ANY site, or none. Inert while sdp_api_write_enabled='0',
// but a defect: a non-admin must name one of their own sites; the admin tier stays unscoped.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');
const fieldRoutes = require('../routes/field');

const SITES = [{ id: 1, name: 'Hounde' }, { id: 2, name: 'Mana' }];
const USERS = { tech: { id: 11, username: 'tech', roles: ['viewer', 'field-tech'], site_id: 1 }, admin: { id: 12, username: 'adm', roles: ['admin'], site_id: null } };
const RANK = ['super_admin', 'executive', 'admin', 'editor', 'viewer'];
const has = (u, r) => (u.roles || []).some((x) => x === r || (RANK.includes(x) && RANK.includes(r) && RANK.indexOf(x) <= RANK.indexOf(r)));

function mkApp(created) {
  const rows = new Map();
  const store = {
    async receive(e) { if (!rows.has(e.uuid)) rows.set(e.uuid, { user_id: e.userId, payload_hash: e.payloadHash, status: 'received' }); return rows.get(e.uuid); },
    async claim() { return 1; },
    async finish(uuid, status, result) { rows.get(uuid).status = status; return { result }; },
    async getOutbox(uuid) { return rows.get(uuid); },
  };
  const app = express();
  app.use(fieldRoutes({ express, store,
    requireReportSession: (req, _res, next) => { req.reportUser = USERS[req.get('x-user')]; next(); },
    rdb: { userHasRole: has, listSites: async () => SITES, logEvent() {}, _logCtx: () => ({}), db: {} },
    reportConfig: { getConfig: async () => ({ sdp_api_write_enabled: '1' }) },
    qualStore: { gate: () => (_q, _r, next) => next() },
    sdpClient: { async createRequest(r) { created.push(r); return { id: 900 + created.length, display_id: String(created.length) }; } } }));
  return app;
}

async function withServer(fn) {
  const created = []; const s = http.createServer(mkApp(created)).listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  try { await fn(`http://127.0.0.1:${s.address().port}`, created); } finally { s.close(); }
}
let n = 0;
const send = (base, who, payload) => new Promise((resolve) => {
  const uuid = `5a1e4c3a-9b7d-4e21-a3f5-0c8d1e2f3a${String(++n).padStart(2, '0')}`;
  const body = JSON.stringify({ kind: 'ticket', payload });
  const r = http.request(`${base}/api/field/outbox/${uuid}`, { method: 'PUT', agent: false, headers: { 'content-type': 'application/json', 'x-user': who } },
    (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(b || '{}') })); });
  r.end(body);
});

test('a site-scoped field user can only open a ticket for one of their own sites', async () => withServer(async (base, created) => {
  const other = await send(base, 'tech', { subject: 'Printer', site: 'Mana' });
  assert.equal(other.status, 403); assert.equal(other.json.status, 'rejected');
  const none = await send(base, 'tech', { subject: 'Printer' });
  assert.equal(none.status, 403, 'a ticket naming no site is refused for a scoped user');
  assert.equal(created.length, 0, 'nothing reached SDP');
  const own = await send(base, 'tech', { subject: 'Printer', site: 'hounde' });
  assert.equal(own.status, 200); assert.equal(own.json.ok, true);
  assert.equal(created.length, 1); assert.equal(created[0].siteName, 'Hounde', 'the canonical site name is sent');
}));

test('the admin tier stays unscoped (any site, or none)', async () => withServer(async (base, created) => {
  assert.equal((await send(base, 'admin', { subject: 'X', site: 'Mana' })).json.ok, true);
  assert.equal((await send(base, 'admin', { subject: 'Y' })).json.ok, true);
  assert.equal(created.length, 2);
}));
