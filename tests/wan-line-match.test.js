'use strict';
// V1b-E Task 3 — shared UMD wan-line matcher. parseServiceLine(name, tokens) resolves a report
// line to (family, sub_site). sub_site is gated on configured tokens only, so a site with no
// sub-site config behaves exactly as today (sub_site always '').
const { test } = require('node:test');
const assert = require('node:assert');
const { parseServiceLine } = require('../public/lib/wanLineMatch');

test('no configured tokens → sub_site is always "" (normal sites unchanged)', () => {
  assert.deepEqual(parseServiceLine('WAN1 Primary', []), { family: 'wan1', sub_site: '' });
  assert.deepEqual(parseServiceLine('LAN Main', []),     { family: 'lan',  sub_site: '' });
  assert.deepEqual(parseServiceLine('WAN1', []),         { family: 'wan1', sub_site: '' });
});

test('configured token gates the sub_site; multi-word + case/accents', () => {
  const toks = ['FETEKRO', 'TANDA'];
  assert.deepEqual(parseServiceLine('WAN1 FETEKRO', toks),      { family: 'wan1', sub_site: 'FETEKRO' });
  assert.deepEqual(parseServiceLine('WAN1 Fetekro Explo', toks),{ family: 'wan1', sub_site: 'FETEKRO' });
  assert.deepEqual(parseServiceLine('LAN TANDA', toks),         { family: 'lan',  sub_site: 'TANDA' });
});

test('wlan before wan; backup/radio → family null', () => {
  assert.equal(parseServiceLine('WLAN FETEKRO', ['FETEKRO']).family, 'wifi');
  assert.equal(parseServiceLine('Backup FETEKRO', ['FETEKRO']).family, null);
});

test('longest token wins on overlap', () => {
  assert.equal(parseServiceLine('WAN1 MANA CAMP', ['MANA', 'MANA CAMP']).sub_site, 'MANA CAMP');
});
