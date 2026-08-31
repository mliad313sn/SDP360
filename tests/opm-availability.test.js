'use strict';
// V1a Task 4 — parsers + aggregate (week + month), SUM-durations formula + AVG fallback,
// excluded/unmapped dropped, null-not-zero.
const { test } = require('node:test');
const assert = require('node:assert');
const { parsePercent, parseDuration, toDateStr, aggregate } = require('../services/opmAvailability');
const { classifyKpiFamily } = require('../services/opmClassify');

const probeToSite = p => (p === 'Mana' ? 42 : null);
const classify = classifyKpiFamily;
const targets = { servers: 99, lan: 99 };

// 7 daily rows for ONE Windows/Server device at probe 'Mana', week of 2026-07-20..26:
// 6 full-up days + 1 full-down day.
function serverWeek() {
  const up = '1 days 00 hrs 00 mins 00 secs', zero = '0 days 00 hrs 00 mins 00 secs';
  const rows = [];
  for (let d = 20; d <= 26; d++) {
    const down = d === 22;
    rows.push({ probe:'Mana', type:'Windows 2022', category:'Server', device_key:'srv1',
      day:`2026-07-${d}`, uptime_pct: down?'0%':'100%',
      uptime_dur: down?zero:up, downtime_dur: down?up:zero, dependent_dur:zero, unmonitored_dur:zero });
  }
  return rows;
}

test('parsers', () => {
  assert.equal(parsePercent('95.8%'), 95.8);
  assert.equal(parsePercent(''), null);
  assert.equal(parseDuration('0 days 22 hrs 59 mins 34 secs'), 22*3600+59*60+34);
  assert.equal(parseDuration('1 days 00 hrs 00 mins 00 secs'), 86400);
  assert.equal(parseDuration('garbage'), null);
  assert.equal(toDateStr('May 28, 2026 12:00:00 AM'), '2026-05-28');   // no tz drift
  assert.equal(toDateStr('2026-07-22T00:00:00Z'), '2026-07-22');
});

test('weekly SUM-durations aggregate → red for a server at 6/7 days', () => {
  const out = aggregate(serverWeek(), { probeToSite, classify, targets, periodType:'week' });
  assert.equal(out.length, 1);
  const g = out[0];
  assert.equal(g.site_id, 42); assert.equal(g.kpi_family, 'servers');
  assert.equal(g.period_start, '2026-07-20'); assert.equal(g.period_end, '2026-07-26');
  assert.ok(Math.abs(g.metric_value - (6/7*100)) < 0.01, `~85.71 got ${g.metric_value}`);
  assert.equal(g.status_color, 'red');           // < 99-2
  assert.equal(g.target_value, 99);
  assert.equal(g.device_count, 1); assert.equal(g.included_device_count, 1);
  assert.equal(g.data_through, '2026-07-26');
  assert.equal(g.trend, null);                    // filled by the sync, not here
});

test('unmonitored counts as unavailable WITHIN a measured device (partial gap → denominator)', () => {
  const rows = [{ probe:'Mana', type:'Windows 2022', category:'Server', device_key:'s',
    day:'2026-07-20', uptime_pct:'50%', uptime_dur:'0 days 12 hrs 00 mins 00 secs',
    downtime_dur:'0 days 00 hrs 00 mins 00 secs', dependent_dur:'0 days 00 hrs 00 mins 00 secs',
    unmonitored_dur:'0 days 12 hrs 00 mins 00 secs' }];
  const g = aggregate(rows, { probeToSite, classify, targets, periodType:'week' })[0];
  assert.ok(Math.abs(g.metric_value - 50) < 0.01, '12h up / (12h up + 12h unmonitored) = 50%');
});

test('a 100%-unmonitored device-day (no up/down/dep) is EXCLUDED, never dragging the mean to 0', () => {
  const day = '0 days 00 hrs 00 mins 00 secs', full = '1 days 00 hrs 00 mins 00 secs';
  const rows = [
    // Device A: fully measured, fully up → 100%.
    { probe:'Mana', type:'Windows 2022', category:'Server', device_key:'A', day:'2026-07-20',
      uptime_pct:'100%', uptime_dur:full, downtime_dur:day, dependent_dur:day, unmonitored_dur:day },
    // Device B: never actually measured — a full day of unmonitored, zero up/down/dep.
    { probe:'Mana', type:'Windows 2022', category:'Server', device_key:'B', day:'2026-07-20',
      uptime_pct:'0%', uptime_dur:day, downtime_dur:day, dependent_dur:day, unmonitored_dur:full },
  ];
  const g = aggregate(rows, { probeToSite, classify, targets, periodType:'week' })[0];
  assert.equal(g.metric_value, 100, 'B excluded → 100% (old formula would have read 50%)');
  assert.equal(g.device_count, 2, 'both devices still counted for coverage');
  assert.equal(g.included_device_count, 1, 'only the measured device is in the average');
  const raw = JSON.parse(g.raw_json);
  assert.equal(raw.unmon_sec, 0, "the unmeasured device's unmonitored time is not in the denominator");
});

test('a group with ONLY unmeasured device-days → null metric (nothing fabricated, but coverage keeps them)', () => {
  const day = '0 days 00 hrs 00 mins 00 secs', full = '1 days 00 hrs 00 mins 00 secs';
  const rows = [{ probe:'Mana', type:'Windows 2022', category:'Server', device_key:'X', day:'2026-07-20',
    uptime_pct:'', uptime_dur:day, downtime_dur:day, dependent_dur:day, unmonitored_dur:full }];
  const g = aggregate(rows, { probeToSite, classify, targets, periodType:'week' })[0];
  assert.equal(g.metric_value, null, 'no measurement anywhere → null, not 0');
  assert.equal(g.status_color, 'none');
  assert.equal(g.device_count, 1);
  assert.equal(g.included_device_count, 0);
});

test('excluded + unmapped are dropped from KPI output', () => {
  const rows = [
    { probe:'Mana', type:'Unknown', category:'Unknown', day:'2026-07-20', uptime_pct:'100%', uptime_dur:'1 days 00 hrs 00 mins 00 secs', downtime_dur:'0 days 00 hrs 00 mins 00 secs', dependent_dur:'0 days 00 hrs 00 mins 00 secs', unmonitored_dur:'0 days 00 hrs 00 mins 00 secs' }, // excluded
    { probe:'ZZ_unmapped', type:'Meraki MS Series', category:'Meraki Switch', day:'2026-07-20', uptime_pct:'100%', uptime_dur:'1 days 00 hrs 00 mins 00 secs', downtime_dur:'0 days 00 hrs 00 mins 00 secs', dependent_dur:'0 days 00 hrs 00 mins 00 secs', unmonitored_dur:'0 days 00 hrs 00 mins 00 secs' }, // unmapped
  ];
  assert.deepEqual(aggregate(rows, { probeToSite, classify, targets, periodType:'week' }), []);
});

test('AVG-fallback when durations unparseable', () => {
  const rows = [{ probe:'Mana', type:'Windows', category:'Server', device_key:'s', day:'2026-07-20',
    uptime_pct:'97.5%', uptime_dur:'n/a', downtime_dur:'n/a', dependent_dur:'n/a', unmonitored_dur:'n/a' }];
  const g = aggregate(rows, { probeToSite, classify, targets, periodType:'week' })[0];
  assert.equal(g.metric_value, 97.5);
  assert.equal(g.status_color, 'orange');   // 97.5 >= 99-2
});

test('month bucketing', () => {
  const g = aggregate(serverWeek(), { probeToSite, classify, targets, periodType:'month' })[0];
  assert.equal(g.period_start, '2026-07-01'); assert.equal(g.period_end, '2026-07-31');
});

test('empty input → empty (null-not-zero: nothing fabricated)', () => {
  assert.deepEqual(aggregate([], { probeToSite, classify, targets, periodType:'week' }), []);
});
