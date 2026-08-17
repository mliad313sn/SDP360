'use strict';

const assert = require('node:assert');
const { test } = require('node:test');
const { pairEvents, attributeOutages } = require('../services/wanSla');

// ── pairEvents — Meraki up/down event log → outage intervals ──────────────────

const S = { site_id: 1, sub_site: '', uplink: 'wan1' };

test('pairEvents: a down + a later up on wan1 → one closed outage', () => {
  const events = [
    { ...S, type: 'wan1_down', occurredAt: '2026-08-17T09:00:00Z' },
    { ...S, type: 'wan1_up',   occurredAt: '2026-08-17T11:00:00Z' },
  ];
  const out = pairEvents(events);
  assert.equal(out.length, 1);
  assert.equal(out[0].site_id, 1);
  assert.equal(out[0].uplink, 'wan1');
  assert.equal(out[0].detected_start, '2026-08-17T09:00:00Z');
  assert.equal(out[0].restored_end, '2026-08-17T11:00:00Z');
});

test('pairEvents: a trailing down with no following up → restored_end null (still open)', () => {
  const events = [
    { ...S, type: 'wan1_down', occurredAt: '2026-08-17T09:00:00Z' },
  ];
  const out = pairEvents(events);
  assert.equal(out.length, 1);
  assert.equal(out[0].detected_start, '2026-08-17T09:00:00Z');
  assert.equal(out[0].restored_end, null);
});

test('pairEvents: out-of-order events still pair correctly', () => {
  const events = [
    { ...S, type: 'wan1_up',   occurredAt: '2026-08-17T11:00:00Z' },
    { ...S, type: 'wan1_down', occurredAt: '2026-08-17T09:00:00Z' },
  ];
  const out = pairEvents(events);
  assert.equal(out.length, 1);
  assert.equal(out[0].detected_start, '2026-08-17T09:00:00Z');
  assert.equal(out[0].restored_end, '2026-08-17T11:00:00Z');
});

test('pairEvents: two down/up cycles → two outages', () => {
  const events = [
    { ...S, type: 'wan1_down', occurredAt: '2026-08-17T09:00:00Z' },
    { ...S, type: 'wan1_up',   occurredAt: '2026-08-17T10:00:00Z' },
    { ...S, type: 'wan1_down', occurredAt: '2026-08-17T14:00:00Z' },
    { ...S, type: 'wan1_up',   occurredAt: '2026-08-17T15:00:00Z' },
  ];
  const out = pairEvents(events);
  assert.equal(out.length, 2);
  assert.equal(out[0].detected_start, '2026-08-17T09:00:00Z');
  assert.equal(out[0].restored_end, '2026-08-17T10:00:00Z');
  assert.equal(out[1].detected_start, '2026-08-17T14:00:00Z');
  assert.equal(out[1].restored_end, '2026-08-17T15:00:00Z');
});

test('pairEvents: an orphan up with no preceding open down is ignored', () => {
  const events = [
    { ...S, type: 'wan1_up',   occurredAt: '2026-08-17T08:00:00Z' },
    { ...S, type: 'wan1_down', occurredAt: '2026-08-17T09:00:00Z' },
    { ...S, type: 'wan1_up',   occurredAt: '2026-08-17T11:00:00Z' },
  ];
  const out = pairEvents(events);
  assert.equal(out.length, 1);
  assert.equal(out[0].detected_start, '2026-08-17T09:00:00Z');
  assert.equal(out[0].restored_end, '2026-08-17T11:00:00Z');
});

test('pairEvents: accepts the wan_1_up underscore style for the direction suffix', () => {
  const events = [
    { site_id: 2, sub_site: '', uplink: 'wan1', type: 'wan_1_down', occurredAt: '2026-08-17T09:00:00Z' },
    { site_id: 2, sub_site: '', uplink: 'wan1', type: 'wan_1_up',   occurredAt: '2026-08-17T10:00:00Z' },
  ];
  const out = pairEvents(events);
  assert.equal(out.length, 1);
  assert.equal(out[0].restored_end, '2026-08-17T10:00:00Z');
});

// ── attributeOutages — cross-uplink + maintenance attribution ─────────────────

test("attributeOutages: overlapping wan1+wan2 at same site ≥ threshold → BOTH 'site'", () => {
  const outages = [
    { site_id: 1, sub_site: '', uplink: 'wan1', detected_start: '2026-08-17T09:00:00Z', restored_end: '2026-08-17T11:00:00Z' },
    { site_id: 1, sub_site: '', uplink: 'wan2', detected_start: '2026-08-17T09:30:00Z', restored_end: '2026-08-17T10:30:00Z' },
  ];
  const out = attributeOutages(outages, { overlapMinutes: 60, maintenance: [] });
  assert.equal(out[0].attribution, 'site');
  assert.equal(out[1].attribution, 'site');
  assert.ok(out[0].attribution_reason.length > 0);
});

test("attributeOutages: a lone wan1 outage with no wan2 overlap → 'isp'", () => {
  const outages = [
    { site_id: 1, sub_site: '', uplink: 'wan1', detected_start: '2026-08-17T09:00:00Z', restored_end: '2026-08-17T11:00:00Z' },
  ];
  const out = attributeOutages(outages, { overlapMinutes: 60, maintenance: [] });
  assert.equal(out[0].attribution, 'isp');
});

test("attributeOutages: an outage inside a maintenance window → 'maintenance'", () => {
  const outages = [
    { site_id: 1, sub_site: '', uplink: 'wan1', detected_start: '2026-08-17T09:15:00Z', restored_end: '2026-08-17T09:45:00Z' },
  ];
  const maintenance = [
    { site_id: 1, uplink: '', from: '2026-08-17T09:00:00Z', to: '2026-08-17T10:00:00Z' },
  ];
  const out = attributeOutages(outages, { overlapMinutes: 60, maintenance });
  assert.equal(out[0].attribution, 'maintenance');
  assert.ok(out[0].attribution_reason.length > 0);
});

test("attributeOutages: overlap BELOW threshold → not 'site'", () => {
  const outages = [
    { site_id: 1, sub_site: '', uplink: 'wan1', detected_start: '2026-08-17T09:00:00Z', restored_end: '2026-08-17T10:00:00Z' },
    { site_id: 1, sub_site: '', uplink: 'wan2', detected_start: '2026-08-17T09:45:00Z', restored_end: '2026-08-17T10:45:00Z' },
  ];
  const out = attributeOutages(outages, { overlapMinutes: 60, maintenance: [] });
  assert.equal(out[0].attribution, 'isp');
  assert.equal(out[1].attribution, 'isp');
});

test('attributeOutages: does not mutate the input outages and preserves order', () => {
  const outages = [
    { site_id: 1, sub_site: '', uplink: 'wan1', detected_start: '2026-08-17T09:00:00Z', restored_end: '2026-08-17T11:00:00Z' },
  ];
  const out = attributeOutages(outages, { overlapMinutes: 60, maintenance: [] });
  assert.equal(outages[0].attribution, undefined);       // input untouched
  assert.notStrictEqual(out, outages);                    // new array
  assert.equal(out[0].uplink, 'wan1');
});

test("attributeOutages: an OPEN outage (restored_end null) overlaps a later outage on the other uplink → 'site'", () => {
  const outages = [
    { site_id: 1, sub_site: '', uplink: 'wan1', detected_start: '2026-08-17T09:00:00Z', restored_end: null },
    { site_id: 1, sub_site: '', uplink: 'wan2', detected_start: '2026-08-17T12:00:00Z', restored_end: '2026-08-17T14:00:00Z' },
  ];
  const out = attributeOutages(outages, { overlapMinutes: 60, maintenance: [] });
  assert.equal(out[0].attribution, 'site');
  assert.equal(out[1].attribution, 'site');
});
