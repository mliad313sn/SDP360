'use strict';
// P11 F-04 (carried R1→R3) — the unauthenticated GET /health exposed Zoho OAuth state (tokenValid, grantedScope, the
// raw lastRefreshError body), org/workspace ids and the survey view id. Anonymous /health is now a liveness answer
// only: {status: 'ok' | 'degraded', uptime}. The details live behind the admin tier on /api/health/deps.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');
const fetch = require('./_http-fetch');

const SECRET_STATE = { accessToken: 'tok-SECRET', expiresAt: Date.now() + 3600e3, refreshCount: 7, grantedScope: 'MEAplus.fullaccess.all',
  lastRefreshError: null };
async function serve(tokenState, { admin = false } = {}) {
  const app = express();
  const rdb = {
    userHasRole: () => admin, pgHandle: () => ({ prepare: () => ({ get: async () => ({ ok: 1 }), all: async () => [] }) }),
    listSystemLog: async () => ({ rows: [] }), db: null,
  };
  app.use(require('../routes/health')({ express, getRdb: () => rdb, requireReportSession: (q, r, n) => { q.reportUser = { id: 1 }; n(); },
    getTokenState: () => tokenState, getHealthDetail: () => ({ orgId: 'ORG-123', workspaceId: 'WS-456', surveySource: 'Analytics Plus view 999' }),
    sync: { ensureReady: async () => {}, getStore: () => ({}) } }));
  const server = await new Promise((r) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => r(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('anonymous /health: only {status, uptime}; no token state, scope, error body or ids', async () => {
  const { server, base } = await serve({ ...SECRET_STATE, lastRefreshError: '{"error":"invalid_code","org":"ORG-123"}' });
  try {
    const r = await fetch(base + '/health');
    assert.equal(r.status, 200, 'a liveness probe answers 200 while the process is up');
    const text = await r.text(); const j = JSON.parse(text);
    assert.deepEqual(Object.keys(j).sort(), ['status', 'uptime']);
    for (const leak of ['tok-SECRET', 'MEAplus', 'invalid_code', 'ORG-123', 'WS-456', '999', 'tokenValid', 'grantedScope']) assert.ok(!text.includes(leak), leak);
  } finally { server.close(); }
});

test('/health status is coarse: ok with a valid token, degraded after a failed refresh with no valid token', async () => {
  const ok = await serve(SECRET_STATE);
  try { assert.equal((await (await fetch(ok.base + '/health')).json()).status, 'ok'); } finally { ok.server.close(); }
  const bad = await serve({ accessToken: null, expiresAt: 0, refreshCount: 0, grantedScope: null, lastRefreshError: 'boom' });
  try {
    const r = await fetch(bad.base + '/health');
    assert.equal(r.status, 200); assert.equal((await r.json()).status, 'degraded');
  } finally { bad.server.close(); }
});

test('admin /api/health/deps carries the Zoho detail that left /health; a non-admin is refused', async () => {
  const a = await serve({ ...SECRET_STATE, lastRefreshError: 'boom' }, { admin: true });
  try {
    const j = await (await fetch(a.base + '/api/health/deps')).json();
    assert.equal(j.zoho_detail.granted_scope, 'MEAplus.fullaccess.all');
    assert.equal(j.zoho_detail.refresh_count, 7);
    assert.equal(j.zoho_detail.last_refresh_error, 'boom');
    assert.equal(j.zoho_detail.org_id, 'ORG-123');
    assert.ok(!JSON.stringify(j).includes('tok-SECRET'), 'the access token itself never leaves the server');
  } finally { a.server.close(); }
  const v = await serve(SECRET_STATE, { admin: false });
  try { assert.equal((await fetch(v.base + '/api/health/deps')).status, 403); } finally { v.server.close(); }
});
