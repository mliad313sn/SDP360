'use strict';
// E-D03 (audit D-04) — site_local_calendar extends to the remaining site-window readers:
// the monthly Top-10, the window reader behind the site-report weekly chart and the 6-month history.
// '0' (default) = UTC buckets, byte-identical to before; '1' = the site's local date (sites.time_zone,
// else its country — services/siteTimeZone.js). London (BST, UTC+1 in summer) moves; Dakar (UTC+0) does not.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const rdb = require('../reports-db');
const cfg = require('../services/reportConfig');

let L, D;
const ins = (id, group, created, overdue = 0, category = 'Network') => rdb.db.prepare(
  `INSERT INTO request_records (request_id, request_status, pending_status, overdue_status, tech_group, site, category, created_time, resolved_time, responded_time)
   VALUES (?, 'Closed', 0, ?, ?, ?, ?, ?, ?, ?)`).run(id, overdue, group, group === 'EDLC London G' ? 'EDLC London' : 'EDLC Dakar', category, created, created, created);

before(async () => {
  await rdb.db.prepare("INSERT INTO sites (name, zoho_group, active) VALUES ('EDLC London', 'EDLC London G', 1), ('EDLC Dakar', 'EDLC Dakar G', 1)").run();
  L = (await rdb.db.prepare("SELECT id FROM sites WHERE name='EDLC London'").get()).id;
  D = (await rdb.db.prepare("SELECT id FROM sites WHERE name='EDLC Dakar'").get()).id;
  await rdb.db.prepare("UPDATE sites SET country='GB' WHERE id=?").run(L);
  await rdb.db.prepare("UPDATE sites SET country='SN' WHERE id=?").run(D);
  // 00:30 BST on Tuesday 1 Sept 2026 = 23:30 UTC on Monday 31 Aug: August/week of 24 Aug in UTC,
  // September/week of 31 Aug in London. Both overdue (they feed the Top-10).
  await ins('EDLC-L1', 'EDLC London G', '2026-08-31T23:30:00.000Z', 1);
  await ins('EDLC-D1', 'EDLC Dakar G', '2026-08-31T23:30:00.000Z', 1);
});
after(async () => { await cfg.setConfig(rdb.db, { site_local_calendar: '0' }, 'test'); });

const setSwitch = (v) => cfg.setConfig(rdb.db, { site_local_calendar: v }, 'test');
const top10Count = (rows) => rows.reduce((n, r) => n + r.violations, 0);
const histMonth = (h, label) => (h.find(x => x.label === label) || {}).inbound;

test("switch '0' (default): every reader buckets on the UTC date and carries no zone (byte-identical)", async () => {
  assert.equal(String((await cfg.getConfig(rdb.db)).site_local_calendar), '0');
  const aug = await rdb.getCalendarMonthlyTop10(L, 2026, 8);
  assert.equal(top10Count(aug), 1);
  assert.deepStrictEqual(Object.keys(aug[0]).sort(), ['category', 'pct', 'violations']);
  assert.equal(top10Count(await rdb.getCalendarMonthlyTop10(L, 2026, 9)), 0);
  const w1 = await rdb.getSiteHelpdeskWindow(L, '2026-08-24', '2026-08-31');
  assert.equal(w1.created, 1);
  assert.ok(!('time_zone' in w1));
  assert.equal((await rdb.getSiteHelpdeskWindow(L, '2026-09-01', '2026-09-07')).created, 0);
  const h = await rdb.getHelpdesk6MonthHistory(L, 2026, 9, ['EDLC London G']);
  assert.equal(histMonth(h, 'Aug 2026'), 1);
  assert.equal(histMonth(h, 'Sep 2026'), null);
  assert.ok(h.every(x => !('time_zone' in x)));
});

test("switch '1': London's 00:30 BST ticket lands in September / the 1 Sept window; Dakar (UTC+0) stays; zone carried", async () => {
  await setSwitch('1');
  try {
    assert.equal(top10Count(await rdb.getCalendarMonthlyTop10(L, 2026, 8)), 0);
    const sep = await rdb.getCalendarMonthlyTop10(L, 2026, 9);
    assert.equal(top10Count(sep), 1);
    assert.equal(sep[0].time_zone, 'Europe/London');
    assert.equal(top10Count(await rdb.getCalendarMonthlyTop10(D, 2026, 8)), 1, 'Africa/Dakar is UTC+0: nothing moves');

    assert.equal((await rdb.getSiteHelpdeskWindow(L, '2026-08-24', '2026-08-31')).created, 0);
    const w2 = await rdb.getSiteHelpdeskWindow(L, '2026-09-01', '2026-09-07');
    assert.equal(w2.created, 1);
    assert.equal(w2.time_zone, 'Europe/London');
    assert.equal((await rdb.getSiteHelpdeskWindow(D, '2026-08-24', '2026-08-31')).created, 1);

    const h = await rdb.getHelpdesk6MonthHistory(L, 2026, 9, ['EDLC London G']);
    assert.equal(histMonth(h, 'Aug 2026'), null);
    assert.equal(histMonth(h, 'Sep 2026'), 1);
    assert.ok(h.every(x => x.time_zone === 'Europe/London'));
    const hd = await rdb.getHelpdesk6MonthHistory(D, 2026, 9, ['EDLC Dakar G']);
    assert.equal(histMonth(hd, 'Aug 2026'), 1);

    // the default (calendar) path of the 6-month history already used the local month (D-07)
    const hc = await rdb.getHelpdesk6MonthHistory(L, 2026, 9);
    assert.equal(histMonth(hc, 'Sep 2026'), 1);

    // an explicit sites.time_zone wins; an invalid zone falls back to UTC (never a 500)
    await rdb.db.prepare("UPDATE sites SET time_zone='UTC' WHERE id=?").run(L);
    assert.equal((await rdb.getSiteHelpdeskWindow(L, '2026-08-24', '2026-08-31')).created, 1);
    await rdb.db.prepare("UPDATE sites SET time_zone='Not/AZone' WHERE id=?").run(L);
    assert.equal(top10Count(await rdb.getCalendarMonthlyTop10(L, 2026, 8)), 1);
  } finally {
    await rdb.db.prepare('UPDATE sites SET time_zone=NULL WHERE id=?').run(L);
    await setSwitch('0');
  }
  assert.equal(top10Count(await rdb.getCalendarMonthlyTop10(L, 2026, 8)), 1, 'switch back off → UTC again');
});
