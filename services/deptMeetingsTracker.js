'use strict';
// Pure reader: turns the Meetings module's real per-month PV counts into the
// 12-month array the Activity Tracker's "Monthly Department Meeting" activity
// expects (Piste 1, 2026-08-05). Used by POST /api/tracker/import-dept-meetings
// so a coordinator pulls the real cadence with one click instead of re-typing
// it (no double-entry). `countFn` is injected → unit-testable without a DB.

// Tracker site code → Meetings module site code. Mirrors the canonical
// _SITE_MODULE_CODES_SEED in reports-db.js (kept in-code, like
// services/scoreboardAliases.js, because the tracker has no live join to
// site_module_codes). Sites with no Meetings module (Exploration, Tanda,
// and any office without a meetings code) map to null → not applicable.
const TRACKER_TO_MEETINGS = {
  SGO: 'SGO', MGO: 'MGO', HGO: 'HGO', ITY: 'SMI', SML: 'SML',
  EDV: 'OUA', ABJ: 'ABJ', DKR: 'DKR', KLN: 'KGO',
  EXP: null,  TND: null,
};

function trackerToMeetingsCode(trackerCode) {
  return TRACKER_TO_MEETINGS[String(trackerCode || '').toUpperCase()] || null;
}

/**
 * Per-month departmental-meeting (PV) counts for one tracker site + year.
 * @param {object} o
 * @param {string} o.trackerCode  tracker site code (MGO/HGO/ITY/…)
 * @param {number} o.year         e.g. 2026
 * @param {function} o.countFn    ({site, from, to}) → number | Promise<number>
 *                                (inject meetings-db.countMeetings)
 * @returns {Promise<{meetingsCode:string|null, months:number[], applicable:boolean}>}
 */
async function deptMeetingCounts({ trackerCode, year, countFn }) {
  const meetingsCode = trackerToMeetingsCode(trackerCode);
  if (!meetingsCode) {
    return { meetingsCode: null, months: Array(12).fill(0), applicable: false };
  }
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0');
    const n = await countFn({ site: meetingsCode, from: `${year}-${mm}-01`, to: `${year}-${mm}-31` });
    months.push(Number(n) || 0);
  }
  return { meetingsCode, months, applicable: true };
}

module.exports = { trackerToMeetingsCode, deptMeetingCounts, TRACKER_TO_MEETINGS };
