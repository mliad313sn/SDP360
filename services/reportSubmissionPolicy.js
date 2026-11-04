'use strict';
// A-24 — submitted weekly reports: submission hash capture (always on, invisible, additive) and
// the PROPOSED D-3 switches (all OFF = today's behaviour; D-3 reverses the 2026-10-02 decision and
// is NOT approved):
//   report_revert_policy      site_editor (today) | second_person
//   report_reassign_submitted '1' (today: a submitted report may change week) | '0'
//   report_drift_banner       '0' (today: no banner) | '1'
// Kept out of server.js (line budget). The hash is integrity evidence, never an approval.
const reportConfig = require('./reportConfig');
const { canonicalFigures, figuresHash } = require('./reportFigures');

const REASON_MAX = 500;

async function loadPolicy(db) {
  let c = {};
  try { c = (await reportConfig.getConfig(db)) || {}; } catch (_) { c = {}; }   // unreadable → today's behaviour
  const D = reportConfig.DEFAULTS;
  return {
    revert_policy: (c.report_revert_policy || D.report_revert_policy) === 'second_person' ? 'second_person' : 'site_editor',
    reassign_submitted: String(c.report_reassign_submitted ?? D.report_reassign_submitted) !== '0',
    drift_banner: String(c.report_drift_banner ?? D.report_drift_banner) === '1',
  };
}

// Who submitted this (still submitted) report? Must be read BEFORE updateReportStatus, which clears
// weekly_reports.submitted_by on revert. Order: last submission row → the row's submitted_by →
// the last "submitted" audit entry. null = unknown.
async function findSubmitter(rdb, report) {
  try { const s = await rdb.lastReportSubmission(report.id); if (s && s.submitted_by != null) return Number(s.submitted_by); } catch (_) { /* table absent → fall back */ }
  if (report.submitted_by != null) return Number(report.submitted_by);
  try {
    const log = await rdb.getReportAuditLog(report.id, 200);
    const hit = (log || []).find((l) => l.action === 'submitted' && l.user_id != null);
    if (hit) return Number(hit.user_id);
  } catch (_) { /* no audit → unknown */ }
  return null;
}

// Pure decision for a revert under second_person: null = allowed, else {status, error}.
// The reason is checked last so a refused person learns the rule, not the form.
function revertDecision({ userId, isAdminTier, submitterId, reason }) {
  if (submitterId != null && Number(userId) === Number(submitterId)) {
    return { status: 403, error: 'A second person must revert this report: the person who submitted it cannot revert their own submission' };
  }
  if (!isAdminTier) return { status: 403, error: 'A second person must revert this report: an admin, executive or super_admin' };
  const r = String(reason == null ? '' : reason).trim();
  if (!r) return { status: 400, error: 'A reason is required to revert a submitted report' };
  if (r.length > REASON_MAX) return { status: 400, error: `The reason is limited to ${REASON_MAX} characters` };
  return null;
}

// Gate for PUT /api/reports/:id/status. Returns {denial} or {reason} (reason null = no change).
async function checkRevert(rdb, user, report, status, body) {
  if (!(report && report.status === 'submitted' && status !== 'submitted')) return { reason: null };
  const pol = await loadPolicy(rdb.db);
  if (pol.revert_policy !== 'second_person') return { reason: null };
  const denial = revertDecision({ userId: user && user.id, isAdminTier: rdb.userHasRole(user, 'admin'),
    submitterId: await findSubmitter(rdb, report), reason: body && body.reason });
  return denial ? { denial } : { reason: String(body.reason).trim() };
}

// Gate for PUT /api/reports/:id/reassign-week: null = allowed, else {status, error}.
async function checkReassign(rdb, report) {
  if (!report || report.status !== 'submitted') return null;
  const pol = await loadPolicy(rdb.db);
  return pol.reassign_submitted ? null : { status: 409, error: 'Submitted reports cannot change week — revert first' };
}

// Every submit records the canonical figures + SHA-256. Best-effort: never blocks a submission.
async function recordSubmission(rdb, reportId, userId) {
  try {
    const report = await rdb.getReport(reportId);
    if (!report) return null;
    return await rdb.recordReportSubmission({ report_id: reportId, site_id: report.site_id, user_id: userId,
      figures: canonicalFigures(report), sha: figuresHash(report) });
  } catch (e) {
    console.error('[api/reports/status] submission hash not recorded:', e.message);
    return null;
  }
}

// GET /api/reports/:id/integrity payload. A report with no recorded submission (submitted before
// migration 054, or never submitted) says so with a null hash — never "drift".
async function integrity(rdb, report) {
  const pol = await loadPolicy(rdb.db);
  let last = null;
  try { last = await rdb.lastReportSubmission(report.id); } catch (_) { last = null; }
  const current = figuresHash(report);
  const submitted = last ? last.figures_sha256 : null;
  return {
    report_id: report.id, status: report.status,
    submitted_hash: submitted, current_hash: current,
    drift: submitted != null && submitted !== current,
    submitted_by: last ? (last.submitted_by_username || null) : null,
    submitted_by_id: last && last.submitted_by != null ? Number(last.submitted_by) : null,
    submitted_at: last ? last.submitted_at : null,
    drift_banner: pol.drift_banner, revert_policy: pol.revert_policy, reassign_submitted: pol.reassign_submitted,
  };
}

module.exports = { REASON_MAX, loadPolicy, findSubmitter, revertDecision, checkRevert, checkReassign, recordSubmission, integrity };
