'use strict';
// P4 / A2 — pure Connector Health composition: plain-language cause, disarmed ≠ error, unknown ≠ 0, the first
// blocking OpManager step, and Meraki configuration read from the database only.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../services/connectorHealth');
const NOW = Date.parse('2026-11-12T12:00:00Z');
const FRESH = { 'zoho.requests': 3, 'meraki.wan': 30, 'opmanager.availability': 30, 'teams.sla_poll': 1 };
const by = (h) => Object.fromEntries(h.connectors.map((c) => [c.id, c]));

test('nothing readable at all → every card unknown/not configured, coverage null (never 0), no green', () => {
  const h = by(C.compose({ now: NOW }));
  for (const c of Object.values(h)) {
    assert.notStrictEqual(c.state, 'ok', c.id);
    assert.strictEqual(c.coverage.pct, null, c.id + ' coverage unknown, not 0');
    assert.strictEqual(c.last_success, null);
  }
  assert.strictEqual(h.sdp_cloud.state, 'disarmed');
  assert.strictEqual(h.sdp_cloud.state_label, 'désarmé');
  assert.match(h.sdp_cloud.human_step, /SDPOnDemand\.requests\.READ/);
});

test('injected Meraki failure → error with a plain cause and the raw text kept; coverage stays as measured', () => {
  const h = by(C.compose({ now: NOW, freshness: FRESH,
    config: { meraki: { api_key: 'db', org_id: true } },
    jobs: { 'meraki.wan': { last_ok: '2026-11-10T05:20:00Z', last_error: '2026-11-12T05:20:00Z', last_error_text: 'Request failed with status code 401', last_run_ms: 4200 } },
    coverage: { meraki: { expected: [1, 2], covered: [1], period: 'week of 2026-11-01' } }, sites: [{ id: 1, name: 'Ity' }, { id: 2, name: 'Mana' }] }));
  const m = h.meraki;
  assert.strictEqual(m.state, 'error');
  assert.match(m.cause, /refused our credentials/);
  assert.match(m.last_failure_text, /401/);
  assert.strictEqual(m.last_run_ms, 4200);
  assert.strictEqual(m.coverage.pct, 50);
  assert.deepStrictEqual(m.failing_scope.map((x) => x.site), ['Mana']);
  assert.ok(m.fix_targets.some((t) => t.site_id === 2 && t.scope === 'site'), 'the missing site is a fix target');
});

test('Meraki config: stored but unreadable (missing SDP_CONFIG_KEY) is named, not reported as "missing key"', () => {
  const h = by(C.compose({ now: NOW, config: { meraki: { api_key: 'db_unreadable', org_id: true } } }));
  assert.strictEqual(h.meraki.state, 'not_configured');
  assert.match(h.meraki.cause, /SDP_CONFIG_KEY/);
  const none = by(C.compose({ now: NOW, config: { meraki: { api_key: 'none' } } }));
  assert.match(none.meraki.cause, /no \.env fallback/);
});

test('OpManager: the FIRST blocking step is the cause — unconfigured, then stale view, then discovery not done', () => {
  const base = { now: NOW, freshness: FRESH, jobs: { 'opmanager.availability': { last_ok: '2026-11-12T05:10:00Z' } } };
  assert.match(by(C.compose({ ...base, config: { opmanager: { api_key: 'none', base_url: false, view_id: false } } })).opmanager.cause, /Neither the OpManager REST API/);
  const stale = by(C.compose({ ...base, config: { opmanager: { api_key: 'none', view_id: true } }, opmDataThrough: '2026-05-24', opmStaleDays: '9' })).opmanager;
  assert.strictEqual(stale.state, 'stale'); assert.match(stale.cause, /2026-05-24/);
  const disc = by(C.compose({ ...base, config: { opmanager: { api_key: 'db', base_url: true } }, opmDataThrough: '2026-11-12', coverage: { opmanager: { expected: [1, 2], covered: [] } } })).opmanager;
  assert.strictEqual(disc.state, 'error'); assert.match(disc.cause, /discovery/);
  assert.strictEqual(disc.coverage.pct, 0, 'measured zero coverage is 0 (expected sites exist, none covered)');
});

test('SDP Cloud armed with a token follows its job; disarmed with a token says arming is a human decision', () => {
  const dis = by(C.compose({ now: NOW, config: { sdp_cloud: { armed: false, refresh_token: 'db' } } })).sdp_cloud;
  assert.strictEqual(dis.state, 'disarmed'); assert.match(dis.human_step, /human decision/);
  const ok = by(C.compose({ now: NOW, freshness: FRESH, config: { sdp_cloud: { armed: true, refresh_token: 'db' } }, jobs: { 'teams.sla_poll': { last_ok: '2026-11-12T11:55:00Z' } } })).sdp_cloud;
  assert.strictEqual(ok.state, 'ok');
});

test('plainCause maps the usual failures and keeps a generic sentence otherwise', () => {
  assert.match(C.plainCause('connect ETIMEDOUT 1.2.3.4:443'), /did not answer/);
  assert.match(C.plainCause('getaddrinfo ENOTFOUND api.meraki.com'), /resolve/);
  assert.match(C.plainCause('weird'), /failed/);
  assert.strictEqual(C.plainCause(''), null);
});
