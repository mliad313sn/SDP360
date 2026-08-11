'use strict';
// F2a Task 2 — resolveSsoSettings: DB config ?? .env ?? default, cached + invalidatable,
// degrading to env/defaults when getConfig rejects (pg path has no try/catch).
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveSsoSettings, _invalidate } = require('../services/ssoSettings');

const envStub = { SSO_MODE: 'available', ENTRA_TENANT_ID: 'T-env', ENTRA_CLIENT_ID: 'C-env',
  ENTRA_CLIENT_SECRET: 'S-env', ENTRA_REDIRECT_URI: 'https://env/cb', SSO_BREAKGLASS_USER: 'bg-env' };

test('DB config wins over env when non-empty; blank DB field falls to env', async () => {
  _invalidate();
  const getConfig = async () => ({ sso_mode: 'only', entra_tenant_id: 'T-db',
    entra_client_id: '', entra_client_secret: '', entra_redirect_uri: '', sso_breakglass_user: '' });
  const s = await resolveSsoSettings({}, { env: envStub, getConfig });
  assert.equal(s.mode, 'only');              // DB wins
  assert.equal(s.cfg.tenantId, 'T-db');      // DB wins
  assert.equal(s.cfg.clientId, 'C-env');     // DB blank → env
  assert.equal(s.breakglassUser, 'bg-env');  // DB blank → env
  assert.equal(s.cfg.scopes, 'openid profile email User.Read');
});

test('falls to defaults when both DB and env are empty', async () => {
  _invalidate();
  const s = await resolveSsoSettings({}, { env: {}, getConfig: async () => ({}) });
  assert.equal(s.mode, 'off');
  assert.equal(s.ssoEnabled, false);
  assert.equal(s.breakglassUser, 'admin');
  assert.equal(s.cfg.redirectUri, 'https://itops-dashboard.edv-ops.com/api/auth/sso/callback');
  assert.equal(s.ready, false);
});

test('legacy SSO_ENABLED=true → mode=only when no explicit mode', async () => {
  _invalidate();
  const s = await resolveSsoSettings({}, { env: { SSO_ENABLED: 'true' }, getConfig: async () => ({}) });
  assert.equal(s.mode, 'only');
});

test('ready is true only when tenant + client + secret all present', async () => {
  _invalidate();
  const getConfig = async () => ({ sso_mode: 'available', entra_tenant_id: 't', entra_client_id: 'c', entra_client_secret: 's' });
  const s = await resolveSsoSettings({}, { env: {}, getConfig });
  assert.equal(s.ready, true);
  assert.equal(s.ssoEnabled, true);
});

test('getConfig rejection degrades to env/defaults (no throw)', async () => {
  _invalidate();
  const getConfig = async () => { throw new Error('pg down'); };
  const s = await resolveSsoSettings({}, { env: envStub, getConfig });
  assert.equal(s.mode, 'available');       // env wins when DB read fails
  assert.equal(s.cfg.tenantId, 'T-env');
});

test('cache: second call within TTL does not re-read; invalidate forces re-read', async () => {
  _invalidate();
  let calls = 0; const getConfig = async () => { calls++; return { sso_mode: 'available' }; };
  await resolveSsoSettings({}, { env: {}, getConfig });
  await resolveSsoSettings({}, { env: {}, getConfig });
  assert.equal(calls, 1, 'cached');
  _invalidate();
  await resolveSsoSettings({}, { env: {}, getConfig });
  assert.equal(calls, 2, 're-read after invalidate');
});
