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

// G-23 / G-24 — four-eyes on DEFINITIONS (trackers, dashboards). A definition goes live only after it
// was submitted for review by one person and published by another; the last editor cannot publish
// either. def = { review_state, submitted_by, updated_by }.
function definitionConflict(def, user) {
  const me = _uid(user && user.id);
  if (me == null) return { code: 'NO_USER', error: 'no user' };
  if (!def || def.review_state !== 'submitted') return { code: 'NOT_SUBMITTED', error: 'submit the draft for review first; another person publishes it' };
  if (_uid(def.submitted_by) === me) return { code: 'SOD_PUBLISH_SUBMITTER', error: 'the person who submitted a draft cannot publish it' };
  if (_uid(def.updated_by) === me) return { code: 'SOD_PUBLISH_EDITOR', error: 'the person who last edited a draft cannot publish it' };
  return null;
}

/**
 * Route decision for publishing a definition. An admin may bypass the review with a written reason
 * (10+ characters) — the override is returned so the caller stores and logs it as a risk event.
 * @returns {{allow:true, override:null|object} | {allow:false, status:number, code:string, error:string}}
 */
function publishDecision(def, user, { isAdmin = false, overrideReason = '', now = new Date() } = {}) {
  const c = definitionConflict(def, user);
  if (!c) return { allow: true, override: null };
  if (c.code === 'NO_USER') return { allow: false, status: 401, ...c };
  const reason = String(overrideReason || '').trim();
  if (isAdmin && reason.length >= 10) return { allow: true, override: { by: Number(user.id), at: now.toISOString(), reason: reason.slice(0, 1000), bypassed: c.code } };
  return { allow: false, status: 409, ...c, message: 'an admin may publish without review with override_reason (10+ characters)' };
}

/** Freshness state of ONE module now (for a value served to a consumer). Modules without an external source are FRESH. */
function moduleFreshness(module, lastOk, nowMs) {
  const f = freshness([module], lastOk, nowMs);
  if (!f.sources.length) return { state: 'FRESH', sources: [] };
  const worst = f.sources.some((x) => x.state === 'UNKNOWN') ? 'UNKNOWN' : f.sources.some((x) => x.state === 'STALE') ? 'STALE' : 'FRESH';
  return { state: worst, sources: f.sources };
}

/** Last successful run per job from the sync run store (null when never). Impure helper; tests inject their own. */
async function lastOkFromSyncStore(jobs) {
  const out = {}; if (!jobs || !jobs.length) return out;
  try {
    const st = require('./sync'); await st.ensureReady();
    for (const j of jobs) { const r = await st.getStore().lastSuccessfulRun(j); out[j] = r ? (r.finished_at || r.started_at) : null; }
  } catch (_) { for (const j of jobs) out[j] = null; }
  return out;
}

function jobsFor(modules) { return [...new Set((modules || []).flatMap((m) => (SOURCES[m] || []).map(([j]) => j)))]; }

module.exports = { SOURCES, dutyConflict, definitionConflict, publishDecision, modulesOf, freshness, moduleFreshness, jobsFor, lastOkFromSyncStore };
