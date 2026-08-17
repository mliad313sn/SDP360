'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const {
  DEFAULT_SLA_WAN_CONFIG,
  parseSlaWanConfig,
  resolveCircuit,
} = require('../services/slaWanConfig');

test('parseSlaWanConfig("") returns defaults', () => {
  const c = parseSlaWanConfig('');
  assert.strictEqual(c.tiers.SILVER.availability_target_pct, 97);
  assert.ok(c.event_types.includes('wan_1_down'));
  assert.strictEqual(c.ingest.reconcile_tolerance_minutes, 60);
});

test('parseSlaWanConfig(undefined) returns defaults', () => {
  const c = parseSlaWanConfig(undefined);
  assert.strictEqual(c.tiers.SILVER.availability_target_pct, 97);
  assert.ok(c.event_types.includes('wan_1_down'));
  assert.strictEqual(c.ingest.reconcile_tolerance_minutes, 60);
});

test('parseSlaWanConfig("{bad json") returns defaults, never throws', () => {
  const c = parseSlaWanConfig('{bad json');
  assert.strictEqual(c.tiers.SILVER.availability_target_pct, 97);
  assert.ok(c.event_types.includes('wan_1_down'));
  assert.strictEqual(c.ingest.reconcile_tolerance_minutes, 60);
});

test('parseSlaWanConfig(garbage object) returns a well-formed config', () => {
  const c = parseSlaWanConfig(42);
  assert.strictEqual(c.tiers.SILVER.availability_target_pct, 97);
  assert.ok(Array.isArray(c.circuits));
});

test('parseSlaWanConfig deep-merges — overriding clock_start keeps tiers.SILVER', () => {
  const c = parseSlaWanConfig(JSON.stringify({ clock_start: 'detection' }));
  assert.strictEqual(c.clock_start, 'detection');
  assert.ok(c.tiers.SILVER, 'tiers.SILVER still present after deep-merge');
  assert.strictEqual(c.tiers.SILVER.availability_target_pct, 97);
});

test('parseSlaWanConfig accepts an object (not just JSON string)', () => {
  const c = parseSlaWanConfig({ clock_start: 'detection' });
  assert.strictEqual(c.clock_start, 'detection');
  assert.ok(c.tiers.SILVER);
});

test('resolveCircuit finds a mapped circuit and merges the tier', () => {
  const cfg = parseSlaWanConfig(JSON.stringify({
    circuits: [{ site_id: 5, sub_site: '', uplink: 'wan1', tier: 'SILVER', isp: 'Orange' }],
  }));
  const r = resolveCircuit(cfg, { site_id: 5, sub_site: '', uplink: 'wan1' });
  assert.ok(r, 'circuit resolved');
  assert.strictEqual(r.isp, 'Orange');
  // hours falls back to the tier default when circuit.hours is null
  assert.ok(r.hours, 'hours present');
  assert.deepStrictEqual(r.hours, cfg.tiers.SILVER.hours_default);
  assert.ok(r.credit_schedule, 'credit_schedule present');
  assert.deepStrictEqual(r.credit_schedule, cfg.tiers.SILVER.credit_schedule);
  assert.ok(r.tier, 'resolved tier attached');
  assert.strictEqual(r.tier.availability_target_pct, 97);
});

test('resolveCircuit honours a circuit-level hours / credit_schedule override', () => {
  const ownHours = { mon: [['09:00', '18:00']], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
  const ownSchedule = [{ min: 99, credit: 0 }, { min: 0, credit: 100 }];
  const cfg = parseSlaWanConfig(JSON.stringify({
    circuits: [{ site_id: 5, sub_site: 'FETEKRO', uplink: 'wan2', tier: 'SILVER', hours: ownHours, credit_schedule: ownSchedule }],
  }));
  const r = resolveCircuit(cfg, { site_id: 5, sub_site: 'FETEKRO', uplink: 'wan2' });
  assert.ok(r);
  assert.deepStrictEqual(r.hours, ownHours);
  assert.deepStrictEqual(r.credit_schedule, ownSchedule);
  assert.strictEqual(r.tier.availability_target_pct, 97);
});

test('resolveCircuit returns null for an unmapped circuit', () => {
  const cfg = parseSlaWanConfig(JSON.stringify({
    circuits: [{ site_id: 5, sub_site: '', uplink: 'wan1', tier: 'SILVER' }],
  }));
  assert.strictEqual(resolveCircuit(cfg, { site_id: 99, sub_site: '', uplink: 'wan1' }), null);
});

test('resolveCircuit defaults sub_site to "" when omitted', () => {
  const cfg = parseSlaWanConfig(JSON.stringify({
    circuits: [{ site_id: 5, sub_site: '', uplink: 'wan1', tier: 'SILVER' }],
  }));
  const r = resolveCircuit(cfg, { site_id: 5, uplink: 'wan1' });
  assert.ok(r, 'resolved with sub_site defaulted to ""');
});

test('reportConfig.DEFAULTS.sla_wan_config is a JSON string with tiers.SILVER', () => {
  const { DEFAULTS } = require('../services/reportConfig');
  assert.strictEqual(typeof DEFAULTS.sla_wan_config, 'string');
  const parsed = JSON.parse(DEFAULTS.sla_wan_config);
  assert.ok(parsed.tiers.SILVER, 'tiers.SILVER present in the DEFAULTS JSON');
});

test('DEFAULT_SLA_WAN_CONFIG is exported and well-formed', () => {
  assert.ok(DEFAULT_SLA_WAN_CONFIG.tiers.SILVER);
  assert.strictEqual(DEFAULT_SLA_WAN_CONFIG.clock_start, 'notification');
});
