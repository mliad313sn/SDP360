'use strict';
// G-13 / G-14 — pure rules of services/publishGate.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../services/publishGate');

test('separation of duties: creator cannot review or publish; last commentary editor cannot review', () => {
  const run = { created_by: 1, commentary: { edited_by: 2 } };
  assert.equal(G.dutyConflict('review', run, { id: 1 }).code, 'SOD_REVIEW_OWN');
  assert.equal(G.dutyConflict('review', run, { id: 2 }).code, 'SOD_REVIEW_EDIT');
  assert.equal(G.dutyConflict('review', run, { id: 3 }), null);
  assert.equal(G.dutyConflict('publish', run, { id: 1 }).code, 'SOD_PUBLISH_OWN');
  assert.equal(G.dutyConflict('publish', run, { id: 2 }), null, 'the editor (not the creator) may publish after an independent review');
  assert.equal(G.dutyConflict('review', run, null).code, 'NO_USER');
  assert.equal(G.dutyConflict('review', { created_by: '7' }, { id: 7 }).code, 'SOD_REVIEW_OWN', 'ids compared as numbers');
});

test('modules come from the registry; unknown metrics are ignored', () => {
  const reg = { get: (k) => ({ 'helpdesk.inbound': { module: 'helpdesk' }, 'meetings.open_issues': { module: 'meetings' } })[k] || null };
  const run = { figures: [{ metric: 'helpdesk.inbound', value: 12 }, { metric: 'meetings.open_issues', rows: [{ site: 'A', value: 3 }] }, { metric: 'nope', value: 1 }, { title: 'no metric', value: 2 }] };
  assert.deepEqual(G.modulesOf(run, reg), ['helpdesk', 'meetings']);
  assert.deepEqual(G.modulesOf({ figures: [{ metric: 'helpdesk.inbound', value: null }, { metric: 'meetings.open_issues', series: [{ value: null }] }] }, reg), [], 'empty figures assert nothing');
  assert.deepEqual(G.jobsFor(['helpdesk', 'meetings']), ['zoho.requests']);
});

test('freshness: fresh, stale and never-synced sources; typed-in modules always fresh', () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  const fresh = G.freshness(['helpdesk'], { 'zoho.requests': '2026-10-28T10:30:00Z' }, now);
  assert.equal(fresh.fresh, true); assert.equal(fresh.sources[0].age_h, 1.5);
  const stale = G.freshness(['helpdesk'], { 'zoho.requests': '2026-10-28T08:00:00Z' }, now);
  assert.equal(stale.fresh, false); assert.equal(stale.sources[0].state, 'STALE');
  const never = G.freshness(['assets'], {}, now);
  assert.equal(never.fresh, false); assert.equal(never.sources[0].state, 'UNKNOWN');
  assert.equal(G.freshness(['meetings', 'inspection', 'tracker'], {}, now).fresh, true);
  assert.equal(G.freshness(['wan'], { 'meraki.wan': new Date(now - 3600e3) }, now).fresh, true, 'Date objects accepted');
});
