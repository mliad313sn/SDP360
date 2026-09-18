'use strict';
const test = require('node:test');
const assert = require('node:assert');
const XLSX = require('xlsx');
const { buildAssetRecap, buildNewAssetAlert } = require('../services/assetReminderReport');

const row = (id, extra = {}) => ({ asset_id: id, asset_name: 'PC-' + id, product_type: 'Laptop', manufacturer: 'Dell',
  serial_number: 'S' + id, state: 'In Use', site: 'Hounde', user_name: '', department: '', acquisition_date: '', has_cost: false, ...extra });
const followups = () => ({
  counts: { new: 1, unassigned: 25, no_cost: 0, no_date: 2 },
  new: [row('N1', { first_seen_date: '2026-07-28' })],
  unassigned: Array.from({ length: 25 }, (_, i) => row('U' + i)),
  no_cost: [], no_date: [row('D1'), row('D2')],
});

test('recap: subject, counts, first 20 rows, no money glyph', () => {
  const r = buildAssetRecap({ site: 'HGO', followups: followups(), baseUrl: '', weekLabel: 'W30 2026', labels: ['Hounde'] });
  assert.match(r.subject, /HGO/);
  assert.match(r.subject, /W30 2026/);
  assert.match(r.html, /25/);
  assert.ok(r.html.includes('PC-U19') && !r.html.includes('PC-U20'), 'first 20 rows only in the body');
  assert.ok(!r.html.includes('$'));
  assert.ok(!/purchase_cost|book_value/.test(r.html));
});

test('recap: xlsx named assets-suivi-<SITE>-<YYYY>-W<nn>.xlsx, one sheet per non-empty list, full rows', () => {
  const r = buildAssetRecap({ site: 'HGO', followups: followups(), baseUrl: '', weekLabel: 'W30 2026', year: 2026, week: 30, labels: ['Hounde'] });
  assert.strictEqual(r.attachments[0].filename, 'assets-suivi-HGO-2026-W30.xlsx');
  const wb = XLSX.read(r.attachments[0].content);
  assert.deepStrictEqual(wb.SheetNames, ['Nouveau', 'Sans affectation', 'Sans date']);
  assert.strictEqual(XLSX.utils.sheet_to_json(wb.Sheets['Sans affectation']).length, 25);
});

test('recap: links only with baseUrl AND a single label', () => {
  const withLink = buildAssetRecap({ site: 'HGO', followups: followups(), baseUrl: 'https://x.test', weekLabel: 'W30 2026', year: 2026, week: 30, labels: ['Hounde'] });
  assert.match(withLink.html, /https:\/\/x\.test\/assets\.html\?site=Hounde/);
  const multi = buildAssetRecap({ site: 'SGO', followups: followups(), baseUrl: 'https://x.test', weekLabel: 'W30 2026', year: 2026, week: 30, labels: ['Sabodala', 'MASSAWA'] });
  assert.ok(!multi.html.includes('assets.html'));
});

test('recap escapes untrusted asset names', () => {
  const f = followups(); f.new[0].asset_name = '<img src=x>';
  const r = buildAssetRecap({ site: 'HGO', followups: f, baseUrl: '', weekLabel: 'W30 2026', year: 2026, week: 30, labels: ['Hounde'] });
  assert.ok(!r.html.includes('<img src=x>'));
});

test('new-asset alert: short list, date in subject, no attachment', () => {
  const r = buildNewAssetAlert({ site: 'HGO', rows: [row('N1', { first_seen_date: '2026-07-28' })], baseUrl: '', date: '2026-07-28', labels: ['Hounde'] });
  assert.match(r.subject, /HGO/);
  assert.match(r.subject, /2026-07-28/);
  assert.match(r.html, /PC-N1/);
  assert.deepStrictEqual(r.attachments, []);
});
