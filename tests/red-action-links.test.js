'use strict';
// E-K03 — pure half: the red-figure source id and the "Open actions (k)" / "Create action" links.
const test = require('node:test');
const assert = require('node:assert');
const R = require('../public/lib/dashboardRender');

test('source id is "<metric>|<site_id>|<window>" and round-trips; malformed parts give null', () => {
  assert.equal(R.redActionSourceId('helpdesk.resolution_sla_pct', 7, '2026-10'), 'helpdesk.resolution_sla_pct|7|2026-10');
  assert.deepEqual(R.parseRedActionSource('helpdesk.resolution_sla_pct|7|2026-W41'), { metric: 'helpdesk.resolution_sla_pct', site_id: 7, window: '2026-W41' });
  for (const bad of [[null, 7, '2026-10'], ['m', null, '2026-10'], ['m', 'x', '2026-10'], ['m', 0, '2026-10'], ['m', 7, ''], ['m|x', 7, '2026-10'], ['m', 7, '2026|10']]) assert.equal(R.redActionSourceId(...bad), null, JSON.stringify(bad));
  for (const bad of ['', 'a|b', 'a|1|2|3', 'a|01|2026-10', 'a|-1|2026-10']) assert.equal(R.parseRedActionSource(bad), null, bad);
});

const grid = { metric: 'helpdesk.resolution_sla_pct', title: 'Resolution SLA', unit: '%', window: { label: '2026-10' },
  rows: [{ site_id: 1, site: 'Hounde', value: 61, rag: 'RED' }, { site_id: 2, site: 'Mana', value: 95, rag: 'GREEN' },
    { site_id: 3, site: 'Ity', value: null, rag: 'NA' }, { site_id: 4, site: 'Lafigue', value: 40, rag: 'RED', rag_if_fresh: 'RED' }] };
const ctx = { links: {
  'helpdesk.resolution_sla_pct|1|2026-10': { count: 2, can_create: true },
  'helpdesk.resolution_sla_pct|3|2026-10': { count: 1, can_create: true },
  'helpdesk.resolution_sla_pct|4|2026-10': { count: 1, can_create: true } } };

test('switch off (no ctx): the ragGrid is byte-identical to the renderer without the feature', () => {
  assert.equal(R.ragGridHtml(grid, {}), R.ragGridHtml(grid, { redActions: null }));
  assert.ok(!R.ragGridHtml(grid, {}).includes('edv-red-act'));
});

test('only a RED measured, current cell gets the links; grey / UNKNOWN / stale never do', () => {
  const h = R.ragGridHtml(grid, { redActions: ctx });
  assert.equal((h.match(/edv-red-actions/g) || []).length, 1, 'one red cell with links');
  assert.match(h, /Open actions \(2\)/);
  assert.match(h, /commitments\.html\?new=1&amp;metric=helpdesk\.resolution_sla_pct%7C1%7C2026-10&amp;site_id=1/);
  assert.equal(R.redActionHtml({ state: 'unknown', metric: 'helpdesk.resolution_sla_pct', site_id: 3, window: '2026-10' }, ctx), '');
  assert.equal(R.redActionHtml({ state: 'amber', metric: 'helpdesk.resolution_sla_pct', site_id: 1, window: '2026-10' }, ctx), '');
  assert.equal(R.redActionHtml({ state: 'red', metric: 'helpdesk.resolution_sla_pct', site_id: null, window: '2026-10' }, ctx), '', 'a fleet figure has no site');
});

test('no create link without the right; no "Open actions" when none is open; an id the server left out renders nothing', () => {
  const c = { state: 'red', metric: 'm.x', site_id: 9, window: '2026-10', title: 'X', site: 'S' };
  const only = R.redActionHtml(c, { links: { 'm.x|9|2026-10': { count: 1, can_create: false } } });
  assert.match(only, /Open actions \(1\)/); assert.ok(!only.includes('Create action'));
  const none = R.redActionHtml(c, { links: { 'm.x|9|2026-10': { count: 0, can_create: true } } });
  assert.ok(!none.includes('Open actions')); assert.match(none, /Create action/);
  assert.equal(R.redActionHtml(c, { links: {} }), '');
});
