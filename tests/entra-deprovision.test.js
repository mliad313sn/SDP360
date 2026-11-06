'use strict';
// E-S04 (audit S-07) — Entra leaver job: dry run first, no Graph call while off, apply only at '1',
// Graph 401/403 = consent missing (never a deactivation), break-glass skipped, no SSO config = skipped.
const { test, before } = require('node:test');
const assert = require('node:assert');
const ED = require('../services/entraDeprovision');
const jobs = require('../services/sync/jobs');
const { DEFAULTS } = require('../services/reportConfig');

let rdb;
const ID = {};
before(async () => {
  rdb = require('../reports-db');
  for (const [u, oid] of [['ed-leaver', 'oid-disabled-0001'], ['ed-gone', 'oid-deleted-0002'], ['ed-ok', 'oid-enabled-0003'], ['ed-break', 'oid-disabled-0004'], ['ed-local', null]]) {
    await rdb.createUser({ username: u, full_name: u, password: u + '-pw-0000', roles: ['editor'] });
    ID[u] = Number((await rdb.pgHandle().prepare('SELECT id FROM users WHERE username=?').get(u)).id);
    if (oid) await rdb.pgHandle().prepare('UPDATE users SET entra_oid = ? WHERE id = ?').run(oid, ID[u]);
    await rdb.login(u, u + '-pw-0000');
  }
});
const SSO = { ready: true, breakglassUser: 'ed-break', cfg: { tenantId: 't', clientId: 'c', clientSecret: 's' } };
function stubHttp({ graph403 = false } = {}) {
  const calls = [];
  const http = async (req) => {
    calls.push(req);
    if (/oauth2\/v2\.0\/token$/.test(req.url)) return { status: 200, data: { access_token: 'tok' } };
    if (graph403) return { status: 403, data: { error: { code: 'Authorization_RequestDenied' } } };
    if (/oid-disabled/.test(req.url)) return { status: 200, data: { accountEnabled: false } };
    if (/oid-deleted/.test(req.url)) return { status: 404, data: {} };
    if (/oid-enabled/.test(req.url)) return { status: 200, data: { accountEnabled: true } };
    return { status: 500, data: {} };
  };
  return { http, calls };
}
const active = async (u) => Number((await rdb.pgHandle().prepare('SELECT active FROM users WHERE id=?').get(ID[u])).active);
const mine = (rows) => rows.filter((r) => /^ed-/.test(r.username));

test('defaults: off, dry run; the job is registered as optional internal', () => {
  assert.equal(DEFAULTS.entra_deprovision_enabled, '0'); assert.equal(DEFAULTS.entra_deprovision_apply, '0');
  assert.ok(jobs.OPTIONAL.has('access.entra_deprovision')); assert.equal(jobs.FRESHNESS_HOURS['access.entra_deprovision'], 30);
  assert.ok(jobs.buildJobs({}).some((j) => j.name === 'access.entra_deprovision'));
});

test('switch 0: skipped, no Graph call at all', async () => {
  const s = stubHttp();
  const out = await ED.run({ rdb, cfg: { entra_deprovision_enabled: '0' }, resolveSso: async () => SSO, http: s.http });
  assert.equal(out.skipped, true); assert.equal(s.calls.length, 0);
});

test('no SSO config: skipped, no Graph call', async () => {
  const s = stubHttp();
  const out = await ED.run({ rdb, cfg: { entra_deprovision_enabled: '1' }, resolveSso: async () => ({ ready: false }), http: s.http });
  assert.equal(out.skipped, true); assert.match(out.reason, /SSO/); assert.equal(s.calls.length, 0);
});

test('apply 0: disabled and deleted are listed, nothing changes; break-glass skipped; oid masked', async () => {
  const s = stubHttp();
  const out = await ED.run({ rdb, cfg: { entra_deprovision_enabled: '1', entra_deprovision_apply: '0' }, resolveSso: async () => SSO, http: s.http });
  assert.equal(out.status, 'ok'); assert.equal(out.dry_run, true); assert.equal(out.deactivated, 0);
  const by = Object.fromEntries(mine(out.rows).map((r) => [r.username, r]));
  assert.equal(by['ed-leaver'].graph_state, 'disabled'); assert.equal(by['ed-leaver'].would_deactivate, true);
  assert.equal(by['ed-gone'].graph_state, 'deleted'); assert.equal(by['ed-gone'].would_deactivate, true);
  assert.equal(by['ed-ok'].would_deactivate, false);
  assert.equal(by['ed-break'].graph_state, 'skipped_breakglass'); assert.equal(by['ed-break'].would_deactivate, false);
  assert.ok(!by['ed-local'], 'unlinked local account never asked');
  assert.ok(!JSON.stringify(out).includes('oid-disabled-0001'), 'full object id never in the result');
  assert.ok(!s.calls.some((c) => /oid-disabled-0004/.test(c.url)), 'break-glass never sent to Graph');
  assert.equal(await active('ed-leaver'), 1); assert.equal(await active('ed-gone'), 1);
});

test('Graph 403: consent_missing, nothing deactivated even with apply 1', async () => {
  const s = stubHttp({ graph403: true });
  const out = await ED.run({ rdb, cfg: { entra_deprovision_enabled: '1', entra_deprovision_apply: '1' }, resolveSso: async () => SSO, http: s.http });
  assert.equal(out.status, 'consent_missing'); assert.equal(out.deactivated, 0);
  assert.equal(await active('ed-leaver'), 1);
});

test('apply 1: disabled / deleted accounts deactivated (session refused), logged; others untouched', async () => {
  const s = stubHttp();
  const sess = (await rdb.login('ed-leaver', 'ed-leaver-pw-0000')).token;
  assert.ok(await rdb.validateSession(sess), 'session valid before');
  const out = await ED.run({ rdb, cfg: { entra_deprovision_enabled: '1', entra_deprovision_apply: '1' }, resolveSso: async () => SSO, http: s.http });
  assert.equal(out.dry_run, false); assert.equal(mine(out.rows).filter((r) => r.deactivated).length, 2);
  assert.equal(await active('ed-leaver'), 0); assert.equal(await active('ed-gone'), 0);
  assert.equal(await active('ed-ok'), 1); assert.equal(await active('ed-break'), 1);
  assert.ok(!(await rdb.validateSession(sess)), 'open session refused after deactivation');
  await new Promise((r) => setTimeout(r, 100));
  const n = await rdb.pgHandle().prepare("SELECT count(*)::int AS n FROM system_log WHERE action='user_deactivated' AND details LIKE '%entra_deprovision%'").get();
  assert.equal(n.n, 2);
});

test('graphState is conservative: anything unexpected is unknown, never a deactivation', () => {
  assert.equal(ED.graphState({ status: 500 }), 'unknown'); assert.equal(ED.graphState(null), 'unknown');
  assert.equal(ED.graphState({ status: 401 }), 'consent_missing'); assert.equal(ED.graphState({ status: 200, data: {} }), 'unknown');
});
