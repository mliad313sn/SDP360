'use strict';
// G-06 (audit 2026-09-24) — once-per-actor-per-day gate for the `*_viewed` events.
//
// system_log carried only auth + report_* actions, so the audit engine's KPI
// ("how many asset managers opened the module in the last 30 days") had no answer.
// Logging the module's read route answers it — but a tab switch re-hits that route,
// so an ungated log would write dozens of rows per person per day and bury the
// journal it is meant to feed.
//
// Pure and injectable: the caller supplies the day string, so there is no clock and
// no storage here. In-process state only — a pm2 restart simply re-opens the gate and
// writes one extra row, which is the harmless direction to fail in.
function makeOncePerDay() {
  let day = null;
  let seen = new Set();

  const gate = (actor, today) => {
    const key = actor == null ? '\u0000anonymous' : String(actor);
    if (today !== day) { day = today; seen = new Set(); }   // a new day drops yesterday
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  gate.size = () => seen.size;
  return gate;
}

module.exports = { makeOncePerDay };
