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

test('G-23/G-24 definitions: not submitted, submitter, last editor refused; another person allowed; admin override needs 10+ chars', () => {
  const G = require('../services/publishGate');
  const def = { review_state: 'submitted', submitted_by: 1, updated_by: 2 };
  assert.equal(G.definitionConflict({ ...def, review_state: null }, { id: 3 }).code, 'NOT_SUBMITTED');
  assert.equal(G.definitionConflict(def, { id: 1 }).code, 'SOD_PUBLISH_SUBMITTER');
  assert.equal(G.definitionConflict(def, { id: 2 }).code, 'SOD_PUBLISH_EDITOR');
  assert.equal(G.definitionConflict(def, { id: 3 }), null);
  assert.equal(G.definitionConflict(def, {}).code, 'NO_USER');
  assert.deepEqual(G.publishDecision(def, { id: 3 }), { allow: true, override: null });
  assert.equal(G.publishDecision(def, { id: 1 }, { isAdmin: false, overrideReason: 'a long enough reason' }).status, 409);
  assert.equal(G.publishDecision(def, { id: 1 }, { isAdmin: true, overrideReason: 'short' }).status, 409);
  const ok = G.publishDecision(def, { id: 1 }, { isAdmin: true, overrideReason: 'reviewer on leave this week', now: new Date('2026-10-28T00:00:00Z') });
  assert.equal(ok.allow, true); assert.deepEqual(ok.override, { by: 1, at: '2026-10-28T00:00:00.000Z', reason: 'reviewer on leave this week', bypassed: 'SOD_PUBLISH_SUBMITTER' });
  assert.equal(G.publishDecision(def, {}, { isAdmin: true, overrideReason: 'reviewer on leave this week' }).status, 401, 'no user is never overridable');
});

test('moduleFreshness: no external source = FRESH; worst state wins', () => {
  const G = require('../services/publishGate');
  const now = Date.parse('2026-10-28T12:00:00Z');
  assert.equal(G.moduleFreshness('meetings', {}, now).state, 'FRESH');
  assert.equal(G.moduleFreshness('helpdesk', {}, now).state, 'UNKNOWN');
  assert.equal(G.moduleFreshness('helpdesk', { 'zoho.requests': '2026-10-28T11:00:00Z' }, now).state, 'FRESH');
  assert.equal(G.moduleFreshness('helpdesk', { 'zoho.requests': '2026-10-28T08:00:00Z' }, now).state, 'STALE');
});
