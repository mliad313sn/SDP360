'use strict';
// C-23 (G52) I3 — a Microsoft sign-in merges an APPROVED access grant instead of stripping it. Entra group
// provisioning replaces the role set on every login (C-18 trap); a role held through an ACTIVE grant must
// survive it, on the first login (e-mail match, then oid link) and on the next one (oid match).
// The Entra engine is stubbed in-process exactly as the SSO unit tests do (services/ssoEntra.beginLogin /
// completeLogin): no request ever leaves 127.0.0.1 — the stubbed authorize URL is the local callback.
// SSO settings + group map are switched on inside this throwaway database only.
const assert = require('node:assert');
const crypto = require('crypto');
const path = require('path');
const { runJourney } = require('./fixtures/harness');
const { person, api, raw, day } = require('./fixtures/iam');

const ROOT = path.join(__dirname, '..', '..');

runJourney('I3 SSO login merges an approved grant and does not strip it', async ({ app, base, world, browser, j }) => {
  const email = 'i3.sso.' + crypto.randomBytes(3).toString('hex') + '@example.invalid';
  const oid = crypto.randomUUID();
  const subject = await person(app, 'i3_sso', ['viewer'], world.siteA, { email });
  const approver = await person(app, 'i3_adminA', ['admin'], world.siteA);

  // an approved, ACTIVE grant of report-author (requested by the super_admin, decided by the site A admin)
  const c = await world.call('POST', '/api/access/requests', world.users.sa.token, { subject_user_id: subject.id, roles: ['report-author'], site_ids: [world.siteA.id], valid_from: day(0), valid_to: day(60), justification: 'prepares the monthly deck for site A' });
  assert.strictEqual(c.status, 201, JSON.stringify(c.j));
  const a = await world.call('POST', `/api/access/requests/${c.j.id}/approve`, approver.token, { reason: 'agreed' });
  assert.strictEqual(a.j && a.j.status, 'ACTIVE', JSON.stringify(a.j));

  // SSO on (this database only) with a group map that alone would give `editor` on site A
  await world.setConfig({ sso_mode: 'available', entra_tenant_id: '00000000-0000-0000-0000-000000000001', entra_client_id: 'e2e-client',
    entra_client_secret: 'e2e-' + crypto.randomBytes(6).toString('hex'), entra_redirect_uri: base + '/api/auth/sso/callback',
    sso_group_map: JSON.stringify([{ group: 'g-e2e-site-a', roles: ['editor'], site_id: world.siteA.id }]) });
  require(path.join(ROOT, 'services', 'ssoSettings.js'))._invalidate();
  const entra = require(path.join(ROOT, 'services', 'ssoEntra.js'));
  const orig = { beginLogin: entra.beginLogin, completeLogin: entra.completeLogin };
  const pending = new Map();
  entra.beginLogin = () => {
    const state = crypto.randomBytes(12).toString('hex'), nonce = crypto.randomBytes(12).toString('hex'), codeVerifier = crypto.randomBytes(24).toString('hex');
    pending.set(state, nonce);
    return { url: '/api/auth/sso/callback?code=stub-code&state=' + state, state, nonce, codeVerifier };
  };
  entra.completeLogin = async ({ expectedNonce }) => {
    assert.ok([...pending.values()].includes(expectedNonce), 'the callback carried the nonce of a login we started');
    return { oid, email, email_source: 'email', name: 'E2E i3_sso', first_name: 'E2E', last_name: 'SSO', groups: ['g-e2e-site-a'], groups_overage: false, tid: null, raw: {} };
  };
  try {
    const ctx = await j.newContext(browser); const page = await ctx.newPage();
    assert.strictEqual(JSON.parse((await raw(base, 'GET', '/api/auth/config')).text).sso_enabled, true, 'SSO ready in this database');

    const signIn = async (label) => {
      await page.goto(base + '/api/auth/sso/login');
      await page.waitForURL((u) => u.pathname === '/index.html', { timeout: 20000 });
      const me = await api(page, 'GET', '/api/access/me');
      assert.strictEqual(me.status, 200, label + ': signed in through Microsoft');
      return me.body;
    };
    const first = await signIn('first login');
    assert.strictEqual(first.user.id, subject.id);
    assert.deepStrictEqual([...first.user.roles].sort(), ['editor', 'report-author'], 'group role added, approved grant kept: ' + JSON.stringify(first.user.roles));
    assert.ok(first.grants.some((g) => g.role === 'report-author' && g.valid_to === day(60)));
    const H = app.rdb.pgHandle();
    assert.strictEqual((await H.prepare('SELECT entra_oid FROM users WHERE id = ?').get(subject.id)).entra_oid, oid, 'linked to the Microsoft identity');
    const log = await H.prepare("SELECT details FROM system_log WHERE action = 'user_role_changed' AND target = ? ORDER BY id DESC LIMIT 1").get(subject.username);
    assert.match(String(log && log.details), /kept_by_grant[^\]]*report-author/, 'the journal says which role the grant kept');
    await j.measure(page, 'sso-first-login');

    await page.context().clearCookies();
    const second = await signIn('second login (oid)');
    assert.deepStrictEqual([...second.user.roles].sort(), ['editor', 'report-author'], 'the next login does not strip it either');
  } finally {
    entra.beginLogin = orig.beginLogin; entra.completeLogin = orig.completeLogin;
  }
});
