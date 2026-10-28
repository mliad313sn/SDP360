'use strict';
// G-13 / G-14 — rules a report run must pass before it becomes authoritative (committee review 2026-10-28).
// Pure: the caller supplies the run, the user, the last successful sync times and the clock.
//
// Separation of duties (four-eyes):
//   - the reviewer is neither the person who generated the run nor the last person who edited its commentary;
//   - the publisher is not the person who generated the run.
//   Full author ≠ reviewer ≠ approver ≠ publisher separation needs named roles per report (D-13); until then
//   the reviewer is the approver.
// Freshness: every module behind a figure must have a recent successful sync. A source that never synced
// is UNKNOWN and blocks like a stale one — no data is not fresh data.

// Module (metric registry `module`) → sync jobs that feed it, with their freshness limit in hours
// (same limits as services/sync/jobs.js). Modules typed into the app (meetings, inspection, trackers,
// commitments, actions) have no external source and are always current.
const SOURCES = {
  helpdesk: [['zoho.requests', 3]],
  changes: [['zoho.change_cab', 3]],
  survey: [['zoho.survey', 3]],
  assets: [['assets.sync', 30]],
  wan: [['meraki.wan', 30]],
  infra: [['opmanager.availability', 30]],
};

function _uid(v) { return v == null ? null : Number(v); }

/** @returns {null | {code:string, error:string}} */
function dutyConflict(action, run, user) {
  const me = _uid(user && user.id);
  if (me == null) return { code: 'NO_USER', error: 'no user' };
  const creator = _uid(run && run.created_by);
  const editor = _uid(run && run.commentary && run.commentary.edited_by);
  if (action === 'review') {
    if (creator != null && creator === me) return { code: 'SOD_REVIEW_OWN', error: 'the person who generated a run cannot review it' };
    if (editor != null && editor === me) return { code: 'SOD_REVIEW_EDIT', error: 'the person who last edited the commentary cannot review it' };
  } else if (action === 'publish') {
    if (creator != null && creator === me) return { code: 'SOD_PUBLISH_OWN', error: 'the person who generated a run cannot publish it' };
  }
  return null;
}

// A figure asserts something only when it carries a number; an empty figure renders "—" and cannot be stale.
function _hasValue(f) {
  if (f.value != null && f.value !== '') return true;
  if (Array.isArray(f.series) && f.series.some((p) => p && p.value != null)) return true;
  if (Array.isArray(f.rows) && f.rows.some((x) => x && x.value != null)) return true;
  return false;
}

/** Modules behind the run's figures that carry a value, via the metric registry (unknown metrics ignored). */
function modulesOf(run, registry) {
  const mods = new Set();
  for (const f of (run && run.figures) || []) {
    if (!f || !_hasValue(f)) continue;
    const m = f.metric && registry && registry.get ? registry.get(f.metric) : null;
    if (m && m.module) mods.add(m.module);
  }
  return [...mods].sort();
}

/**
 * @param {string[]} modules
 * @param {Object<string,string|null>} lastOk  job → ISO time of the last successful run (or null)
 * @param {number} nowMs
 * @returns {{fresh:boolean, sources:Array<{module,job,last_ok,age_h,limit_h,state}>}}
 */
function freshness(modules, lastOk, nowMs) {
  const sources = [];
  for (const mod of modules || []) {
    for (const [job, limit] of SOURCES[mod] || []) {
      const t = lastOk && lastOk[job] ? new Date(lastOk[job]).getTime() : NaN;
      if (!Number.isFinite(t)) { sources.push({ module: mod, job, last_ok: null, age_h: null, limit_h: limit, state: 'UNKNOWN' }); continue; }
      const age = Math.round((nowMs - t) / 36e5 * 10) / 10;
      sources.push({ module: mod, job, last_ok: new Date(t).toISOString(), age_h: age, limit_h: limit, state: age > limit ? 'STALE' : 'FRESH' });
    }
  }
  return { fresh: sources.every((s) => s.state === 'FRESH'), sources };
}

function jobsFor(modules) { return [...new Set((modules || []).flatMap((m) => (SOURCES[m] || []).map(([j]) => j)))]; }

module.exports = { SOURCES, dutyConflict, modulesOf, freshness, jobsFor };
