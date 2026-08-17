'use strict';

// WAN SLA — pure service-hours calendar helpers.
//
// All timestamps are UTC and treated as local (every site is GMT+0 — a hard
// V1 constraint). No DB, no network, no I/O.
//
// A "calendar" is keyed by lowercase weekday (`mon`..`sun`); each value is an
// array of `[HH:MM, HH:MM]` window pairs. A day can carry two windows (the
// lunch split). An empty array = closed that day.

const DOW_KEY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// 'HH:MM' → minutes-of-day.
function hmToMinutes(hm) {
  const [h, m] = String(hm).split(':');
  return Number(h) * 60 + Number(m);
}

// UTC midnight (ms) of the day containing `ms`.
function utcMidnight(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

const DAY_MS = 24 * 3600 * 1000;

// Sum of in-window seconds intersecting [fromMs, toMs). Shared core.
function _serviceSeconds(cal, fromMs, toMs) {
  if (!cal || !(toMs > fromMs)) return 0;
  let total = 0;
  // Step day-by-day from the UTC midnight of the fromMs day until we pass toMs.
  // Iterating in UTC makes DST irrelevant.
  for (let dayStart = utcMidnight(fromMs); dayStart < toMs; dayStart += DAY_MS) {
    const key = DOW_KEY[new Date(dayStart).getUTCDay()];
    const windows = cal[key];
    if (!windows || windows.length === 0) continue;
    for (const [startHM, endHM] of windows) {
      const winStart = dayStart + hmToMinutes(startHM) * 60 * 1000;
      const winEnd = dayStart + hmToMinutes(endHM) * 60 * 1000;
      const isectStart = Math.max(winStart, fromMs);
      const isectEnd = Math.min(winEnd, toMs);
      if (isectEnd > isectStart) total += (isectEnd - isectStart) / 1000;
    }
  }
  return Math.round(total);
}

// Total service-hour seconds between two instants.
function serviceSecondsBetween(cal, fromMs, toMs) {
  return _serviceSeconds(cal, fromMs, toMs);
}

// In-window seconds of an outage [startMs, endMs].
function clipToService(cal, [startMs, endMs]) {
  if (!(endMs > startMs)) return 0;
  return _serviceSeconds(cal, startMs, endMs);
}

module.exports = {
  serviceSecondsBetween,
  clipToService,
  hmToMinutes,
  utcMidnight,
};
