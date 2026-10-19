'use strict';
// Zoho Analytics (helpdesk data) connection, editable in Admin ▸ Intégration API (2026-10-04).
// Every value resolves DATABASE first, then .env, then the built-in default — so a deploy
// changes nothing until someone saves the admin form.
const test = require('node:test');
const assert = require('node:assert');
const A = require('../services/analyticsSettings');

const ENV = { ZOHO_CLIENT_ID: 'env-id', ZOHO_CLIENT_SECRET: 'env-sec', ZOHO_REFRESH_TOKEN: 'env-rt', WORKSPACE_ID: 'env-ws', ORG_ID: 'env-org' };

test('nothing in the database → exactly the .env values', () => {
  const s = A.mergeAnalyticsSettings({}, ENV);
  assert.deepEqual([s.clientId, s.clientSecret, s.refreshToken, s.workspaceId, s.orgId, s.accountsUrl],
    ['env-id', 'env-sec', 'env-rt', 'env-ws', 'env-org', 'https://accounts.zoho.com']);
  assert.deepEqual(s.sources, { clientId: 'env', clientSecret: 'env', refreshToken: 'env', workspaceId: 'env', orgId: 'env', accountsUrl: 'default' });
  assert.equal(s.ready, true);
});

test('a database value wins over .env, field by field', () => {
  const s = A.mergeAnalyticsSettings({ analytics_refresh_token: 'db-rt', analytics_workspace_id: 'db-ws' }, ENV);
  assert.equal(s.refreshToken, 'db-rt'); assert.equal(s.sources.refreshToken, 'db');
  assert.equal(s.clientId, 'env-id'); assert.equal(s.sources.clientId, 'env');
  assert.equal(s.workspaceId, 'db-ws');
});

test('built-in defaults for workspace / org when neither is set; not ready without credentials', () => {
  const s = A.mergeAnalyticsSettings({}, {});
  assert.equal(s.workspaceId, '106803000000002012'); assert.equal(s.orgId, '878991289');
  assert.equal(s.sources.clientId, 'none'); assert.equal(s.ready, false);
});

test('resolve: cached, invalidated on demand, a failed read is NOT cached', async () => {
  let calls = 0, fail = true;
  const getConfig = async () => { calls++; if (fail) throw new Error('pg not ready'); return { analytics_client_id: 'db-id' }; };
  A._invalidate();
  const s1 = await A.resolveAnalyticsSettings(null, { getConfig, env: ENV });
  assert.equal(s1.clientId, 'env-id', 'degraded → .env');
  fail = false;
  const s2 = await A.resolveAnalyticsSettings(null, { getConfig, env: ENV });
  assert.equal(s2.clientId, 'db-id', 'degraded read was not cached');
  await A.resolveAnalyticsSettings(null, { getConfig, env: ENV });
  assert.equal(calls, 2, 'second good read served from cache');
  A._invalidate();
  await A.resolveAnalyticsSettings(null, { getConfig, env: ENV });
  assert.equal(calls, 3);
});

test('the analytics keys exist; secret + refresh token are secrets', () => {
  const rc = require('../services/reportConfig');
  for (const k of ['analytics_client_id', 'analytics_client_secret', 'analytics_refresh_token', 'analytics_workspace_id', 'analytics_org_id', 'analytics_accounts_url']) {
    assert.ok(rc.KEYS.includes(k), k);
    assert.equal(rc.DEFAULTS[k], '', `${k} defaults blank so .env still applies`);
  }
  for (const k of ['analytics_client_secret', 'analytics_refresh_token']) assert.ok(rc._SECRET_BLANK_KEEP.has(k), k);
});
