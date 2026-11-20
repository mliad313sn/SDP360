'use strict';
// PORTFOLIO LOT 5 — review workflow I/O over the EXISTING hash-chained, append-only ppm_events ledger (no new audit
// table) and the existing four-eyes provenance check (services/approverProvenance). Pure rules:
// services/ppm/reviewWorkflow.js. ADR: ADR-PORTFOLIO-LOT5.
const RW = require('./reviewWorkflow');

/**
 * @param {object} db   pg handle (prepare/run)
 * @param {object} gov  services/governanceStore instance (ppmEvent)
 * @param {object} [o]  { provenanceDb } — handle with users + system_log for approverProvenance (defaults to db)
 */
function makeReviewStore(db, gov, o = {}) {
  const P = (sql) => db.prepare(sql);
  const provDb = o.provenanceDb || db;

  /** Project fields the review rules read (live rows only). */
  async function projectFacts(id) {
    if (!Number.isInteger(Number(id))) return null;
    const r = await P(`SELECT id, owner, sponsor, stage, created_by FROM portfolio_projects WHERE id=? AND deleted_at IS NULL`).get(Number(id));
    return r ? { ...r, id: Number(r.id), created_by: r.created_by == null ? null : Number(r.created_by) } : null;
  }

  /**
   * Who opened the current review cycle: the actor of the latest stage move; with no move recorded, the creator
   * (created_by, written while the field-audit or review switch is on). Null = unknown (refused downstream).
   */
  async function requesterOf(project) {
    const r = await P(`SELECT actor_id, actor FROM ppm_events WHERE entity='project' AND entity_id=? AND action='stage' ORDER BY id DESC LIMIT 1`).get(Number(project.id));
    if (r) return { id: r.actor_id == null ? null : Number(r.actor_id), name: r.actor || null };
    if (project.created_by != null) {
      const u = await P(`SELECT id, username FROM users WHERE id=?`).get(Number(project.created_by));
      return { id: Number(project.created_by), name: u ? u.username : null };
    }
    return null;
  }

  /**
   * The refusal of a decision by `actor` on this project, or null. Fail closed: an unknown requester, a requester
   * without a user id (provenance cannot be checked) or an unreadable journal is a refusal.
   */
  async function decisionRefusal(project, actor, { now = Date.now() } = {}) {
    try {
      const req = await requesterOf(project);
      const r = RW.selfApprovalRefusal(actor, project, req);
      if (r) return r;
      if (req.id == null) return { code: 'REVIEW_REQUESTER_UNKNOWN', error: 'the account that submitted this project is not recorded — return it for correction and submit it again (refused, fail closed)' };
      const ind = await require('../approverProvenance').checkIndependent({ db: provDb, requesterId: req.id, approver: actor, now });
      if (!ind.ok) return { code: 'APPROVER_NOT_INDEPENDENT', error: `the decider is not independent of the requester: ${ind.reason}` };
      return null;
    } catch (_) {
      return { code: 'REVIEW_CHECK_FAILED', error: 'the independence of the decider could not be checked — refused (fail closed)' };
    }
  }

  async function events(projectId) {
    return (await P(`SELECT id, action, field, new_value, note, actor_id, actor, at FROM ppm_events WHERE entity='project' AND entity_id=? AND action IN (${RW.ACTIONS.map(() => '?').join(',')}) ORDER BY id LIMIT 2000`).all(Number(projectId), ...RW.ACTIONS))
      .map((e) => ({ ...e, id: Number(e.id), actor_id: e.actor_id == null ? null : Number(e.actor_id) }));
  }
  async function state(projectId) { return RW.reviewState(await events(projectId)); }

  async function assign(projectId, { step, user }, by) {
    await gov.ppmEvent({ entity: 'project', entity_id: projectId, action: 'review_assign', field: step, old_value: null, new_value: Number(user.id), note: String(user.full_name || user.username || '').slice(0, 200) }, by);
  }
  async function requestInfo(projectId, { step, question }, by) {
    await gov.ppmEvent({ entity: 'project', entity_id: projectId, action: 'info_request', field: step, note: question }, by);
  }
  async function respond(projectId, { requestId, answer }, by) {
    await gov.ppmEvent({ entity: 'project', entity_id: projectId, action: 'info_response', field: `request:${Number(requestId)}`, note: answer }, by);
  }
  async function recordReturn(projectId, { from, reason }, by) {
    await gov.ppmEvent({ entity: 'project', entity_id: projectId, action: 'review_return', field: from, note: reason }, by);
  }

  return { projectFacts, requesterOf, decisionRefusal, events, state, assign, requestInfo, respond, recordReturn };
}

module.exports = { makeReviewStore };
