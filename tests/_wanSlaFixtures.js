'use strict';

// Shared fixtures for the WAN SLA / ISP-chargeback feature tests.
// All timestamps are UTC and treated as local (all sites GMT+0 — V1 hard constraint).

const DAY_WINDOWS = [['08:00', '13:00'], ['14:00', '17:00']];

// Office calendar: Mon–Fri service hours, closed weekends.
const SILVER_OFFICE = {
  mon: DAY_WINDOWS.map((w) => w.slice()),
  tue: DAY_WINDOWS.map((w) => w.slice()),
  wed: DAY_WINDOWS.map((w) => w.slice()),
  thu: DAY_WINDOWS.map((w) => w.slice()),
  fri: DAY_WINDOWS.map((w) => w.slice()),
  sat: [],
  sun: [],
};

// Mine calendar: same daily windows but all 7 days (mines run 7 days).
const SILVER_MINE = {
  mon: DAY_WINDOWS.map((w) => w.slice()),
  tue: DAY_WINDOWS.map((w) => w.slice()),
  wed: DAY_WINDOWS.map((w) => w.slice()),
  thu: DAY_WINDOWS.map((w) => w.slice()),
  fri: DAY_WINDOWS.map((w) => w.slice()),
  sat: DAY_WINDOWS.map((w) => w.slice()),
  sun: DAY_WINDOWS.map((w) => w.slice()),
};

const SILVER = {
  availability_target_pct: 97,
  min_outage_minutes: 15,
  credit_schedule: [
    { min: 97, credit: 0 },
    { min: 95, credit: 10 },
    { min: 90, credit: 25 },
    { min: 0, credit: 50 },
  ],
  credit_cap_pct: 100,
  credit_model: 'tiered',
  response: { resolution_h: { crit1: 12, crit2: 24, crit3: 48 } },
  hours_default: SILVER_OFFICE,
};

const AUG1 = Date.parse('2026-08-01T00:00:00Z');
const SEP1 = Date.parse('2026-09-01T00:00:00Z');

module.exports = { SILVER_OFFICE, SILVER_MINE, SILVER, AUG1, SEP1 };
