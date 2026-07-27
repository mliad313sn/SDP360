'use strict';
// SP2 — the coordinator email's optional "Open actions" block. It renders only
// when `data.actions` is present (the assetEffort pattern), so the byte-equality
// monthly goldens — whose fixtures have no `actions` — stay unchanged.
const { test } = require('node:test');
const assert = require('node:assert');
const { composeCoordinator } = require('../services/reportTemplates/coordinator');

const base = (extra) => Object.assign({
  site_code: 'HGO', site_name: 'Houndé', period: { label: 'Jul 2026' },
  score: null, meetings: {}, inspection: {}, helpdesk: {}, changes: {},
  technicians: [], recommended: {},
}, extra);

const ACTIONS = { meetings: { count: 3, oldest: 40 }, inspection: { count: 1, oldest: 10 }, report: { count: 2, oldest: null }, total: 6 };

test('with actions + base_url: renders the block + a hub link', () => {
  const { htmlBody } = composeCoordinator(base({ base_url: 'https://x.example', actions: ACTIONS }));
  assert.match(htmlBody, /Actions ouvertes/);
  assert.match(htmlBody, /Inspections/);
  assert.match(htmlBody, /href="https:\/\/x\.example\/site-actions\.html\?site=HGO"/);
});

test('with actions but no base_url: block renders, NO dead hub link', () => {
  const { htmlBody } = composeCoordinator(base({ base_url: '', actions: ACTIONS }));
  assert.match(htmlBody, /Actions ouvertes/);
  assert.ok(!/site-actions\.html/.test(htmlBody), 'no hub link when base_url is empty');
});

test('without actions: the block is absent (golden-safe)', () => {
  const { htmlBody } = composeCoordinator(base({}));
  assert.ok(!/Actions ouvertes/.test(htmlBody), 'block only appears when actions present');
});
