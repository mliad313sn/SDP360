'use strict';
// A0 — invariant 7: the platform READS ServiceDesk Plus, Meraki and OpManager; it never writes to them unless an
// approved, explicit switch says so. The one dark write path is SDP createRequest (services/sdpApiClient.js, field
// "SDP ticket from a finding"), gated on sdp_api_write_enabled = '1' (default '0', CREATE scope = CAB decision).
// Pinned two ways: a static scan of every caller and every client, and a runtime check of the clients with a
// recording transport (no network).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
function jsFiles() {
  const out = ['server.js'];
  for (const dir of ['routes', 'services', 'tools']) {
    const walk = (d) => {
      for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
        const p = d + '/' + e.name;
        if (e.isDirectory()) { if (!['node_modules', 'tests', 'installer-build'].includes(e.name)) walk(p); } else if (e.name.endsWith('.js')) out.push(p);
      }
    };
    walk(dir);
  }
  return out;
}

test('static: Meraki and OpManager clients carry no write verb at all', () => {
  for (const f of ['services/merakiClient.js', 'services/opmanagerClient.js']) {
    const src = read(f);
    assert.doesNotMatch(src, /\.(post|put|patch|delete)\s*\(/i, f + ' calls a write verb');
    assert.doesNotMatch(src, /method\s*:\s*['"](POST|PUT|PATCH|DELETE)['"]/i, f + ' sets a write method');
    assert.doesNotMatch(src, /safe(Post|Put|Patch|Delete)/, f + ' uses a write transport');
  }
});

test('static: the SDP client has exactly two POSTs — the OAuth token refresh and the gated createRequest', () => {
  const src = read('services/sdpApiClient.js');
  const posts = src.split('\n').filter((l) => /T\.(post|put|patch|delete)\s*\(/.test(l)).map((l) => l.trim());
  assert.equal(posts.length, 2, 'write calls in sdpApiClient: ' + posts.join(' | '));
  assert.match(posts[0], /oauth\/v2\/token/);
  assert.match(posts[1], /\/requests`/);
  const create = src.slice(src.indexOf('async function createRequest'));
  assert.ok(create.indexOf("if (!writeEnabled) throw") > -1 && create.indexOf("if (!writeEnabled) throw") < create.indexOf('T.post'), 'createRequest checks writeEnabled before posting');
  assert.match(src, /writeEnabled = false/, 'writeEnabled defaults to false');
});

test('static: only routes/field.js ticket() reaches createRequest, after the sdp_api_write_enabled check; no job does', () => {
  const callers = [], armers = [];
  for (const f of jsFiles()) {
    if (f === 'services/sdpApiClient.js') continue;
    const src = read(f);
    // the SDP client's createRequest (services/accessStore.js has an unrelated createRequest for access requests)
    if (/sdpApiClient|sdpClient/.test(src) && /\.createRequest\s*\(/.test(src)) callers.push(f);
    if (/writeEnabled\s*:\s*true/.test(src)) armers.push(f);
  }
  assert.deepEqual(callers, ['routes/field.js'], 'createRequest callers');
  assert.deepEqual(armers, ['routes/field.js'], 'writeEnabled:true set by');
  const src = read('routes/field.js');
  const t = src.slice(src.indexOf('async ticket(u, p)'));
  const gate = t.indexOf("String(c.sdp_api_write_enabled) !== '1'"), arm = t.indexOf('writeEnabled: true'), call = t.indexOf('.createRequest(');
  assert.ok(gate > -1 && gate < arm && arm < call, 'switch checked before the client is armed and called');
  assert.equal(require('../services/reportConfig').DEFAULTS.sdp_api_write_enabled, '0', 'the write switch ships OFF');
  // no scheduled job (tools/, cron) and no other route imports a write helper of the external clients
  for (const f of jsFiles().filter((x) => x.startsWith('tools/'))) assert.ok(!(/sdpApiClient/.test(read(f)) && /createRequest/.test(read(f))), f);
});

test('runtime: clients with a recording transport — Meraki/OpManager issue GETs only; SDP createRequest refuses while not armed', async () => {
  const calls = [];
  const get = async (url) => { calls.push(['GET', url]); return { data: [] }; };
  const m = require('../services/merakiClient').makeMerakiClient({ apiKey: 'k', orgId: 'o', baseUrl: 'https://api.example.test/api/v1', get });
  for (const [k, fn] of Object.entries(m)) if (typeof fn === 'function') { try { await fn({ networkId: 'n', serial: 's', uplink: 'wan1', ip: '1.1.1.1' }); } catch (_) { /* shape errors are fine */ } }
  const o = require('../services/opmanagerClient').makeOpmanagerClient({ apiKey: 'k', baseUrl: 'https://opm.example.test', get });
  for (const [k, fn] of Object.entries(o)) if (typeof fn === 'function') { try { await fn({ name: 'd' }); } catch (_) { /* fine */ } }
  assert.ok(calls.length > 3, 'clients exercised');
  assert.ok(calls.every((c) => c[0] === 'GET'));

  const sdpCalls = [];
  const transport = { get: async (u) => { sdpCalls.push(['GET', u]); return { data: { requests: [], list_info: { has_more_rows: false } } }; },
    post: async (u) => { sdpCalls.push(['POST', u]); return { data: { access_token: 't', expires_in: 3600, request: { id: '1', display_id: '1' } } }; } };
  const mk = (writeEnabled) => require('../services/sdpApiClient').makeSdpClient({ baseUrl: 'https://sdp.example.test/api/v3', accountsUrl: 'https://accounts.example.test', clientId: 'c', clientSecret: 's', refreshToken: 'r', transport, writeEnabled });
  await assert.rejects(() => mk(undefined).createRequest({ subject: 'x' }), (e) => e.code === 'WRITE_DISABLED');
  await assert.rejects(() => mk(false).createRequest({ subject: 'x' }), (e) => e.code === 'WRITE_DISABLED');
  assert.deepEqual(sdpCalls, [], 'nothing sent while not armed');
  await mk(false).listOpenRequests().catch(() => {});
  assert.ok(sdpCalls.every((c) => c[0] === 'GET' || /oauth\/v2\/token/.test(c[1])), 'reads use GET (+ token refresh): ' + JSON.stringify(sdpCalls));
  // positive control: the path is real — armed, it posts to /requests (so the gate above is what keeps it dark)
  sdpCalls.length = 0;
  await mk(true).createRequest({ subject: 'x' });
  assert.ok(sdpCalls.some((c) => c[0] === 'POST' && /\/requests$/.test(c[1])));
});

test('static: the outbound-write surface is closed — every file sending a non-GET HTTP request is on a reviewed list', () => {
  // Reviewed 2026-11-12: none of these targets ServiceDesk Plus data, Meraki or OpManager.
  const REVIEWED = {
    'server.js': 'Zoho OAuth token refresh (accounts) + AI provider calls (off by default)',
    'routes/engagement.js': 'alert evaluation hands engagementJobs.safePostFor (Teams / webhook consumers)',
    'routes/teamsSla.js': 'Teams Workflows webhook test card',
    'services/engagementJobs.js': 'Teams / webhook alert posts + Microsoft identity token',
    'services/entraDeprovision.js': 'Microsoft Graph (identity), behind entra_deprovision_enabled',
    'services/ssoEntra.js': 'OIDC token exchange',
    'services/safeUrl.js': 'the guarded transport itself',
    'services/ppm/workItemClient.js': 'W4-CONNECTORS: the Azure DevOps WIQL QUERY (a read sent as POST by that API; nothing created upstream), behind ppm_azdo_sync_enabled',
    'services/sdpApiClient.js': 'Zoho OAuth token + the gated createRequest (pinned above)',
    'tools/teams/poll-sla.js': 'Teams Workflows webhook cards',
  };
  const found = jsFiles().filter((f) => /safePost|axios\.(post|put|patch|delete)\s*\(|axios\s*\(\s*\{[^}]*method/.test(read(f)));
  assert.deepEqual(found.sort(), Object.keys(REVIEWED).sort(), 'a new outbound write path needs a review (invariant 7) — add it here with what it targets');
});
