'use strict';
// Adoption Lot A (item 3) — one "reporting week" for Home, the report picker and the Helpdesk labels.
// The review saw three weeks on 20 Nov 2026: Home W45, picker W44, Helpdesk W46. The picker stepped back a second
// time from /api/reports/current-week, which already returns the due (previous) week.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const RW = require('../public/lib/reportingWeek');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

test('20 Nov 2026: due week W45 (08–14 Nov), week in progress W46 (15–21 Nov)', () => {
  const now = new Date(2026, 10, 20, 9, 0, 0);
  assert.deepStrictEqual(RW.dueWeek(now), { year: 2026, week: 45 });
  assert.deepStrictEqual(RW.currentWeek(now), { year: 2026, week: 46 });
  assert.deepStrictEqual(RW.range(2026, 45), { start: '2026-11-08', end: '2026-11-14' });
  assert.strictEqual(RW.label(2026, 45, 'fr'), 'S45 (08–14 nov.)');
  assert.strictEqual(RW.label(2026, 45, 'en'), 'W45 (08–14 Nov)');
  assert.strictEqual(RW.label(2026, 44, 'en'), 'W44 (01–07 Nov)');
});

test('a week spanning two months names both months; year boundary rolls back to the last Zoho week', () => {
  assert.strictEqual(RW.label(2026, 48, 'fr'), 'S48 (29 nov. – 05 déc.)');
  // 2 Jan 2027 is before the first Sunday of 2027 (3 Jan) → still in the last week of 2026
  assert.strictEqual(RW.weekOf(new Date(2027, 0, 2)).year, 2026);
  assert.deepStrictEqual(RW.weekOf(new Date(2027, 0, 3)), { year: 2027, week: 1 });
});

test('the server uses the same helper (reports-db getISOWeek / getPreviousWeek / getWeekRange agree)', () => {
  const rdb = require('../reports-db');
  const now = new Date();
  assert.deepStrictEqual(rdb.getPreviousWeek(), RW.dueWeek(now));
  const r = rdb.getWeekRange(2026, 45);
  assert.strictEqual(r.start, '2026-11-08'); assert.strictEqual(r.end, '2026-11-14');
});

test('the report picker defaults to the week returned by /api/reports/current-week, never one week before', () => {
  const src = read('public/reports.html');
  const i = src.indexOf("await api('GET', '/api/reports/current-week')");
  assert.ok(i > 0);
  const block = src.slice(i, i + 600);
  assert.doesNotMatch(block, /w\.week\s*-\s*1/, 'no second step back');
  assert.match(block, /const defWeek = w\.week;/);
  assert.match(src, /src="lib\/reportingWeek\.js"/);
});

test('Home and Helpdesk load the shared helper and label weeks with their dates', () => {
  assert.match(read('public/home.html'), /src="lib\/reportingWeek\.js"/);
  assert.match(read('public/lib/home-page.js'), /ReportingWeek\.label\(/);
  const idx = read('public/index.html');
  assert.match(idx, /src="lib\/reportingWeek\.js"/);
  assert.match(idx, /RW\.dueWeek\(n\)/);
});
