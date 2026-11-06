'use strict';
// E-A07 — config change journal (pure diff + set-ui-policy --apply).
const test = require('node:test');
const assert = require('node:assert');
const J = require('../services/configJournal');

const secrets = new Set(['smtp_pass']);
test('one change per actually changed key; unchanged keys none', () => {
  const c = J.diffConfig({ a: '1', b: 'x' }, { a: '1', b: 'y' }, { keys: ['a', 'b'] });
  assert.deepEqual(c, [{ key: 'b', from: 'x', to: 'y' }]);
  assert.deepEqual(J.diffConfig({ a: '1' }, { a: '1' }, { keys: ['a'] }), []);
  assert.deepEqual(J.diffConfig({}, { unknown: '1' }, { keys: ['a'] }), [], 'keys setConfig drops are not journalled');
});

test('a secret never carries a value; blank-keep is no change', () => {
  const c = J.diffConfig({ smtp_pass: 'old-secret' }, { smtp_pass: 'new-secret-value' }, { keys: ['smtp_pass'], secretSet: secrets });
  assert.deepEqual(c, [{ key: 'smtp_pass', change: 'set' }]);
  assert.ok(!JSON.stringify(c).includes('secret-value'));
  assert.deepEqual(J.diffConfig({ smtp_pass: 'old' }, { smtp_pass: '' }, { keys: ['smtp_pass'], secretSet: secrets, blankKeep: secrets }), []);
  assert.deepEqual(J.diffConfig({ meraki_api_key: 'k' }, { meraki_api_key: '' }), [{ key: 'meraki_api_key', change: 'cleared' }], 'secret-shaped name');
});

test('journal writes one row per change with the reason', () => {
  const rows = [];
  const n = J.journal((ev) => rows.push(ev), [{ key: 'b', from: 'x', to: 'y' }], { actor: 'u' }, ' because\npilot ');
  assert.equal(n, 1);
  assert.equal(rows[0].action, 'config_changed'); assert.equal(rows[0].category, 'config'); assert.equal(rows[0].target, 'b');
  assert.deepEqual(rows[0].details, { key: 'b', from: 'x', to: 'y', reason: 'because pilot' });
});

test('set-ui-policy: dry run warns + writes nothing; --apply journals one row', async () => {
  const { main } = require('../tools/reports/set-ui-policy');
  const logs = [], events = [], writes = [];
  const deps = { getConfig: async () => ({ ui_i18n_pages: '0' }), setConfig: async (p) => writes.push(p), log: (s) => logs.push(s), logEvent: (ev) => events.push(ev) };
  const dry = await main(['--key=ui_i18n_pages', '--value=1'], deps);
  assert.equal(dry.applied, false); assert.equal(writes.length, 0); assert.equal(events.length, 0);
  assert.ok(Array.isArray(dry.warnings));
  const app = await main(['--key=ui_i18n_pages', '--value=1', '--apply', '--reason=pilot FR'], deps);
  assert.equal(app.applied, true); assert.equal(events.length, 1);
  assert.deepEqual(events[0].details, { key: 'ui_i18n_pages', from: '0', to: '1', reason: 'pilot FR' });
  await main(['--key=ui_i18n_pages', '--value=0', '--apply'], { ...deps, getConfig: async () => ({ ui_i18n_pages: '0' }) });
  assert.equal(events.length, 1, 'no change → no row');
});
