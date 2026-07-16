'use strict';
// ── services/reviewData.js — the IT Review dashboard's data reader ───────────
//
// Produces the authoritative dashboard's `D` shape (its `EM_DATA`) from OUR
// databases:
//
//   { meetings, issues, actions, inspections, findings, inspActions, projects }
//
// His export is DENORMALISED — every issue/action/project carries its parent
// meeting's site_code/meeting_date/department inline, and every finding /
// inspection action carries its parent inspection's site_code/inspection_date.
// Our schema is normalised, so this module is 5 JOINs. Each array is its own
// query; they cannot fan each other out.
//
// FLEET-WIDE, never per-site: `composite()`'s `fleetMttr` is the median
// resolution time across ALL sites, so scoping this reader to one site would
// silently change that site's own score. Downstream (`filterSite`) narrows.
//
// PROVEN, not merely tested: `tests/fixtures/em-data.json` is a later export of
// the very database in `prod-snapshot/`, so `tests/review-data.test.js` asserts
// field-for-field EQUALITY with it rather than approximation. A wrong join names
// the exact field of the exact row.
//
// NO STATUS FILTER — see `loadReviewData` below.

const MEETINGS_TABLES = 'md_meetings / md_issues / md_actions / md_meeting_projects';
const INSPECTION_TABLES = 'insp_inspections / insp_findings / insp_actions';

// ── Field lists ─────────────────────────────────────────────────────────────
// Only what the source reads, plus the identity columns the equality proof needs.

const SQL_MEETINGS = `
  SELECT m.id, m.reference, m.site_code, m.department, m.meeting_date,
         m.submitted_at, m.dept_head_signed_at, m.site_it_signed_at,
         m.next_meeting_date, m.priority_1, m.status
    FROM md_meetings m`;

// ⚠ LOAD-BEARING CAST (pg fork only): md_issues.updated_at is TIMESTAMPTZ while
// every other date column this reader touches is TEXT. services/pgDb.js
// registers type parsers only for NUMERIC/BIGINT, so node-pg hands back a JS
// Date; `effClose` would then yield 'Wed Jun 11' and EVERY ISO string compare
// loses ('W' > '2'). That hits 52 of 132 issues (39%) — metrics.closedCur/Prev,
// the MTTR tile, openAt → the 3 sparks + backlogPts + openPrev, flowMonths,
// composite.mttr/fleetMttr/mttrIdx and sbDims.resolution — on PROD ONLY, with no
// error. to_char keeps it a comparable ISO string. Precedent: meetings-db.js:2642.
// Do NOT cast closed_at / target_date / meeting_date / *_signed_at: already TEXT.
const _ISSUE_UPDATED_AT = {
  sqlite: 'i.updated_at',
  pg: `to_char(i.updated_at, 'YYYY-MM-DD HH24:MI:SS')`,
};

const sqlIssues = (pg) => `
  SELECT i.id, i.status, i.closed_at, i.target_date, i.severity, i.escalate,
         i.champion, i.champion_email, i.title,
         ${pg ? _ISSUE_UPDATED_AT.pg : _ISSUE_UPDATED_AT.sqlite} AS updated_at,
         m.site_code, m.meeting_date, m.department
    FROM md_issues i JOIN md_meetings m ON m.id = i.meeting_id`;

const SQL_ACTIONS = `
  SELECT a.id, a.status, a.closed_at, a.target_date,
         m.site_code, m.meeting_date
    FROM md_actions a JOIN md_meetings m ON m.id = a.meeting_id`;

const SQL_PROJECTS = `
  SELECT p.id, p.phase, p.target_end, m.site_code
    FROM md_meeting_projects p JOIN md_meetings m ON m.id = p.meeting_id`;

const SQL_INSPECTIONS = `
  SELECT i.id, i.site_code, i.inspection_date, i.status
    FROM insp_inspections i`;

const SQL_FINDINGS = `
  SELECT f.status, f.category, i.site_code, i.inspection_date
    FROM insp_findings f JOIN insp_inspections i ON i.id = f.inspection_id`;

// insp_actions has NO site_code column of its own (confirmed against the
// schema) — it hangs off the inspection, hence the join.
const SQL_INSP_ACTIONS = `
  SELECT a.id, a.status, i.site_code
    FROM insp_actions a JOIN insp_inspections i ON i.id = a.inspection_id`;

// ── Handle resolution ───────────────────────────────────────────────────────
// `deps` may supply raw better-sqlite3 handles (that is how the fixture-equality
// proof points this reader at prod-snapshot/ read-only without touching
// meetings-db / inspection-db). With no deps we defer to the real modules and
// their own backend flags.

function _ctx(handle, moduleName, backendKey) {
  if (handle) return { h: handle, pg: false };          // injected → always sqlite
  const mod = require(moduleName);
  return mod[backendKey] === 'postgres'
    ? { h: mod.pgHandle(), pg: true }
    : { h: mod.getDB(), pg: false };
}

// better-sqlite3's .all() is sync, pgDb's is async — `await` handles both.
const _all = (ctx, sql) => Promise.resolve(ctx.h.prepare(sql).all());

/**
 * loadReviewData(asOf, deps?) → the authoritative dashboard's `D`.
 *
 * @param {string}  asOf  ISO date the caller is reporting as-of. Accepted for
 *   contract symmetry with the dashboard; this reader does NOT filter on it —
 *   the model needs the full fleet history (sparks, previous windows, flow
 *   months, fleetMttr) and does its own windowing downstream.
 * @param {object} [deps] `{ meetingsHandle, inspectionHandle }` — raw sqlite
 *   handles for tests. Omit in production.
 *
 * NO STATUS FILTER — drafts included, deliberately. The authoritative export
 * contains 1 draft PV and the model applies no status filter, so it counts it.
 * Filtering here would silently diverge from the screen the team reads.
 */
async function loadReviewData(asOf, deps = {}) {
  const m = _ctx(deps.meetingsHandle, '../meetings-db', 'MEETINGS_BACKEND');
  const i = _ctx(deps.inspectionHandle, '../inspection-db', 'INSPECTION_BACKEND');

  const [meetings, issues, actions, projects, inspections, findings, inspActions] =
    await Promise.all([
      _all(m, SQL_MEETINGS),
      _all(m, sqlIssues(m.pg)),
      _all(m, SQL_ACTIONS),
      _all(m, SQL_PROJECTS),
      _all(i, SQL_INSPECTIONS),
      _all(i, SQL_FINDINGS),
      _all(i, SQL_INSP_ACTIONS),
    ]);

  return { meetings, issues, actions, inspections, findings, inspActions, projects };
}

module.exports = { loadReviewData, MEETINGS_TABLES, INSPECTION_TABLES };
