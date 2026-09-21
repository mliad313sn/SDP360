'use strict';
const test = require('node:test');
const assert = require('node:assert');
const XLSX = require('xlsx');
const { buildAssetRecap, buildNewAssetAlert } = require('../services/assetReminderReport');

const row = (id, extra = {}) => ({ asset_id: id, asset_name: 'PC-' + id, product_type: 'Laptop', manufacturer: 'Dell',
  serial_number: 'S' + id, state: 'In Use', site: 'Hounde', user_name: '', department: '', acquisition_date: '', has_cost: false, ...extra });
// A coloured count tile: value div carries the tile's own colour.
const TILE_RE = /font-size:22px;font-weight:bold;color:(#[0-9A-Fa-f]{6});line-height:1\.2;">([^<]*)<\/div>/g;
const followups = () => ({
  counts: { no_tag: 1, unassigned: 25, no_cost: 0, no_date: 2 },
  no_tag: [row('N1')],
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
  assert.deepStrictEqual(wb.SheetNames, ['Sans QR code', 'Sans date', 'Sans utilisateur']);
  assert.strictEqual(XLSX.utils.sheet_to_json(wb.Sheets['Sans utilisateur']).length, 25);
});

test('recap: links only with baseUrl AND a single label', () => {
  const withLink = buildAssetRecap({ site: 'HGO', followups: followups(), baseUrl: 'https://x.test', weekLabel: 'W30 2026', year: 2026, week: 30, labels: ['Hounde'] });
  assert.match(withLink.html, /https:\/\/x\.test\/assets\.html\?site=Hounde/);
  const multi = buildAssetRecap({ site: 'SGO', followups: followups(), baseUrl: 'https://x.test', weekLabel: 'W30 2026', year: 2026, week: 30, labels: ['Sabodala', 'MASSAWA'] });
  assert.ok(!multi.html.includes('assets.html'));
});

test('recap escapes untrusted asset names', () => {
  const f = followups(); f.no_tag[0].asset_name = '<img src=x>';
  const r = buildAssetRecap({ site: 'HGO', followups: f, baseUrl: '', weekLabel: 'W30 2026', year: 2026, week: 30, labels: ['Hounde'] });
  assert.ok(!r.html.includes('<img src=x>'));
});

test('recap: null counts render em dash, a real zero still renders 0', () => {
  const f = followups();
  f.counts = { no_tag: null, unassigned: 25, no_cost: 0, no_date: 2 };
  const r = buildAssetRecap({ site: 'HGO', followups: f, baseUrl: '', weekLabel: 'W30 2026', year: 2026, week: 30, labels: ['Hounde'] });
  // Coloured KPI tiles, in LISTS order (no_tag, no_date, no_cost, unassigned).
  const values = [...r.html.matchAll(TILE_RE)].map(m => m[2]);
  assert.deepStrictEqual(values, ['—', '2', '0', '25']);
  assert.match(r.html, /Sans QR code \(—\)/);
  assert.ok(!r.html.includes('Sans QR code (0)'));
});

test('recap: filename sanitises the site and falls back without year/week', () => {
  const dirty = buildAssetRecap({ site: 'H/G:O*?', followups: followups(), baseUrl: '', weekLabel: 'W30 2026', year: 2026, week: 30, labels: ['Hounde'] });
  assert.strictEqual(dirty.attachments[0].filename, 'assets-suivi-H_G_O__-2026-W30.xlsx');
  const noPeriod = buildAssetRecap({ site: 'HGO', followups: followups(), baseUrl: '', weekLabel: 'W30 2026', labels: ['Hounde'] });
  assert.strictEqual(noPeriod.attachments[0].filename, 'assets-suivi-HGO.xlsx');
});

test('new-asset alert escapes an <img onerror> asset name and only links with baseUrl', () => {
  const malicious = row('N2', { asset_name: '<img src=x onerror=alert(1)>' });
  const noBase = buildNewAssetAlert({ site: 'HGO', rows: [malicious], baseUrl: '', date: '2026-07-28', labels: ['Hounde'] });
  assert.ok(!noBase.html.includes('<img '), 'raw <img tag must not appear');
  assert.ok(noBase.html.includes('&lt;img'), 'name is html-escaped');
  assert.ok(!noBase.html.includes('assets.html'), 'no link without baseUrl');

  const withBase = buildNewAssetAlert({ site: 'HGO', rows: [malicious], baseUrl: 'https://x.test', date: '2026-07-28', labels: ['Hounde'] });
  assert.match(withBase.html, /https:\/\/x\.test\/assets\.html\?site=Hounde#inventory/);
});

test('new-asset alert: short list, date in subject, no attachment', () => {
  const r = buildNewAssetAlert({ site: 'HGO', rows: [row('N1', { first_seen_date: '2026-07-28' })], baseUrl: '', date: '2026-07-28', labels: ['Hounde'] });
  assert.match(r.subject, /HGO/);
  assert.match(r.subject, /2026-07-28/);
  assert.match(r.html, /PC-N1/);
  assert.deepStrictEqual(r.attachments, []);
});

// ── colour presentation (2026-09-18) ─────────────────────────────────────────
// Same visual language as the weekly e-mail's Parc informatique block: violet
// header band, coloured tiles (one accent per list), coloured title bars, zebra rows.
const recap = (extra = {}) => buildAssetRecap({ site: 'HGO', followups: followups(), baseUrl: 'https://x.test', weekLabel: 'W30 2026', year: 2026, week: 30, labels: ['Hounde'], ...extra });
const alertMail = () => buildNewAssetAlert({ site: 'HGO', rows: [row('N1', { first_seen_date: '2026-07-28' }), row('N2', { first_seen_date: '2026-07-28' })], baseUrl: 'https://x.test', date: '2026-07-28', labels: ['Hounde'] });
const ZEBRA_ON = /<tr style="background:#F8FAFC;">/;
const ZEBRA_OFF = /<tr style="background:#FFFFFF;">/;

test('recap: violet header band carrying the title', () => {
  assert.match(recap().html, /background:#7C3AED;[^>]*>\s*<div[^>]*>Suivi du parc informatique<\/div>/);
});

test('recap: the 4 counters are coloured tiles, one distinct accent per list; null = neutral "—"', () => {
  const tiles = [...recap().html.matchAll(TILE_RE)].map(m => [m[1].toUpperCase(), m[2]]);
  assert.strictEqual(tiles.length, 4);
  assert.deepStrictEqual(tiles.map(t => t[1]), ['1', '2', '0', '25']);
  assert.strictEqual(new Set(tiles.map(t => t[0])).size, 4, 'four distinct accents');
  const f = followups(); f.counts.no_tag = null;
  const nul = [...buildAssetRecap({ site: 'HGO', followups: f, baseUrl: '', weekLabel: 'W30 2026', labels: ['Hounde'] }).html.matchAll(TILE_RE)];
  assert.strictEqual(nul[0][2], '—');
  assert.strictEqual(nul[0][1].toUpperCase(), '#64748B', 'null count is grey, not the list accent');
});

test('recap: each list has a coloured title bar and zebra rows', () => {
  const { html } = recap();
  assert.match(html, /background:#D97706;[^>]*>\s*<div[^>]*>Non assigné à un utilisateur \(25\)<\/div>/, 'unassigned = amber title bar');
  assert.match(html, /background:#0D9488;[^>]*>\s*<div[^>]*>Sans QR code \(1\)<\/div>/, 'no QR code = teal title bar');
  assert.ok(ZEBRA_ON.test(html) && ZEBRA_OFF.test(html), 'alternating row backgrounds');
});

test('recap: links, subject and attachment filename unchanged; no $', () => {
  const r = recap();
  assert.strictEqual(r.subject, 'Suivi du parc informatique - HGO - W30 2026');
  assert.strictEqual(r.attachments[0].filename, 'assets-suivi-HGO-2026-W30.xlsx');
  assert.ok(r.html.includes('https://x.test/assets.html?site=Hounde#inventory'));
  assert.ok(r.html.includes('https://x.test/assets.html?site=Hounde&amp;kind=no_age#hygiene'));
  assert.ok(!r.html.includes('$'));
  assert.ok(!/display:\s*(inline-)?(flex|grid)|var\(--/.test(r.html), 'e-mail safe');
});

test('alert: header band, count tile, zebra table with a coloured header row, link kept', () => {
  const r = alertMail();
  assert.strictEqual(r.subject, 'Nouveau matériel sans QR code - HGO - 2026-07-28');
  assert.match(r.html, /background:#7C3AED;[^>]*>\s*<div[^>]*>Nouveau matériel sans QR code<\/div>/);
  const t = [...r.html.matchAll(TILE_RE)];
  assert.strictEqual(t.length, 1); assert.strictEqual(t[0][2], '2');
  assert.match(r.html, /<th style="[^"]*background:#0D9488;[^"]*color:#FFFFFF;/, 'coloured header row');
  assert.ok(ZEBRA_ON.test(r.html) && ZEBRA_OFF.test(r.html), 'zebra rows');
  assert.ok(r.html.includes('https://x.test/assets.html?site=Hounde#inventory'));
  assert.ok(!r.html.includes('$'));
  assert.deepStrictEqual(r.attachments, []);
});
