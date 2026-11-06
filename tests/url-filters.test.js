'use strict';
// E-U02 — public/lib/urlFilters.js (pure parse / serialise of Analytics filters) + the page wiring.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const U = require('../public/lib/urlFilters');

const SCHEMA = {
  site: { type: 'enum', values: ['', 'Sabodala', 'MANA'], def: '' },
  period: { type: 'enum', values: ['', '7d', '30d'], def: '' },
  status: { type: 'list', max: 3, def: null },
};

test('parse keeps only known keys and allowed values', () => {
  const s = U.parse('?site=MANA&period=30d&evil=1&status=Open,Closed', SCHEMA);
  assert.deepEqual(s, { site: 'MANA', period: '30d', status: ['Open', 'Closed'] });
  assert.equal('evil' in s, false);
});

test('an unknown / foreign enum value falls back to the default', () => {
  const s = U.parse('?site=%3Cscript%3Ealert(1)%3C%2Fscript%3E&period=999d', SCHEMA);
  assert.deepEqual(s, { site: '', period: '', status: null });
});

test('malformed escapes are ignored, empty query = defaults', () => {
  assert.deepEqual(U.parse('?site=%E0%A4%A&period=7d', SCHEMA), { site: '', period: '7d', status: null });
  assert.deepEqual(U.parse('', SCHEMA), { site: '', period: '', status: null });
  assert.deepEqual(U.parse(null, SCHEMA), { site: '', period: '', status: null });
});

test('list values are trimmed, de-duplicated, capped; an empty list means "none" (not all)', () => {
  assert.deepEqual(U.parse('?status=%20a%20,a,b,,c,d', SCHEMA).status, ['a', 'b', 'c']);
  assert.deepEqual(U.parse('?status=', SCHEMA).status, []);
  assert.deepEqual(U.parse('?status=' + 'x'.repeat(200), SCHEMA).status, []);
});

test('filterList intersects with the live options; null (all) stays null', () => {
  assert.deepEqual(U.filterList(['Open', '<img src=x>'], ['Open', 'Closed']), ['Open']);
  assert.equal(U.filterList(null, ['Open']), null);
});

test('serialise writes only non-default values, escaped; round-trips', () => {
  assert.equal(U.serialise({ site: '', period: '', status: null }, SCHEMA), '');
  const q = U.serialise({ site: 'MANA', period: '7d', status: ['On Hold', 'A&B'] }, SCHEMA);
  assert.equal(q, '?site=MANA&period=7d&status=On%20Hold,A%26B');
  assert.deepEqual(U.parse(q, SCHEMA), { site: 'MANA', period: '7d', status: ['On Hold', 'A&B'] });
  assert.equal(U.serialise({ site: 'NOT-A-SITE' }, SCHEMA), '', 'an invalid value is never written');
});

test('merge keeps foreign query keys and replaces schema keys (Reset → clean schema keys)', () => {
  assert.equal(U.merge('?tab=x&site=Sabodala', { site: 'MANA', period: '', status: null }, SCHEMA), '?tab=x&site=MANA');
  assert.equal(U.merge('?site=Sabodala&period=7d', { site: '', period: '', status: null }, SCHEMA), '');
});

test('analytics.html: wiring is gated on ui_url_filters and never writes HTML from the URL', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'analytics.html'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /<script src="lib\/urlFilters\.js"><\/script>/);
  assert.match(src, /url_filters === '1'/);
  assert.match(src, /history\.replaceState/);
  assert.match(src, /addEventListener\('popstate'/);
  assert.match(src, /id="urlfReset" type="button" hidden/, 'Reset is hidden unless the switch is on');
  const block = src.slice(src.indexOf('// ── E-U02'), src.indexOf('function resetFilters'));
  assert.ok(block.length > 200, 'E-U02 block found');
  assert.doesNotMatch(block, /innerHTML/, 'URL values are never inserted as HTML');
});

test('switch is a ui_* policy key defaulting to today (0)', () => {
  const P = require('../services/uiPolicy');
  assert.equal(P.UI_DEFAULTS.ui_url_filters, '0');
  assert.equal(P.uiPolicyFrom({}).url_filters, '0');
  assert.equal(P.uiPolicyFrom({ ui_url_filters: 'yes' }).url_filters, '0');
  assert.equal(P.uiPolicyFrom({ ui_url_filters: '1' }).url_filters, '1');
  assert.equal(require('../services/reportConfig').DEFAULTS.ui_url_filters, '0');
});
