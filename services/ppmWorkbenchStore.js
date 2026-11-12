'use strict';
// R2-WORKBENCH — store of the workbench tables (migration 085). Same db handle shape as services/governanceStore
// (prepare(sql).get/all/run, runTransaction), and every write leaves a hash-chained ppm_events row through the
// governance store's ppmEvent (entity 'project'). The routes decide the switches and the access rules; the store only
// checks the data. Pure rules: services/ppmWorkbench.js.
const WB = require('./ppmWorkbench');

function makeWorkbenchStore(db, gov, { now = () => new Date().toISOString() } = {}) {
  if (!db || !gov) throw new Error('workbench store needs a db handle and the governance store');
  const P = (sql) => db.prepare(sql);
  const tx = (fn) => (typeof db.runTransaction === 'function' ? db.runTransaction(fn) : fn());
  const n = (v) => (v == null ? null : Number(v));
  const uid = (user) => (user && user.id != null ? Number(user.id) : null);
  async function insert(table, cols, vals) {
    const r = await P(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')}) RETURNING id`).run(...vals);
    return Number(r && (r.id != null ? r.id : r.lastID != null ? r.lastID : (r.rows && r.rows[0] && r.rows[0].id)));
  }
  const notFound = (what) => Object.assign(new Error(`${what} not found`), { code: 'NOT_FOUND', status: 404 });

  // ── R2-WB-04 project team ──────────────────────────────────────────────────────────────────────────────────
  const memberRow = (r) => r && ({ id: Number(r.id), project_id: Number(r.project_id), user_id: n(r.user_id), label: r.label, role: r.role || null, allocation_pct: n(r.allocation_pct), from_day: r.from_day || null, to_day: r.to_day || null, username: r.username || null });
  async function listMembers(projectId) {
    return (await P(`SELECT m.*, u.username FROM ppm_project_members m LEFT JOIN users u ON u.id = m.user_id WHERE m.project_id=? ORDER BY m.label, m.id`).all(Number(projectId))).map(memberRow);
  }
  async function listMembersFor(projectIds) {
    const ids = [...new Set((projectIds || []).map(Number).filter(Number.isInteger))];
    if (!ids.length) return [];
    return (await P(`SELECT m.*, u.username FROM ppm_project_members m LEFT JOIN users u ON u.id = m.user_id WHERE m.project_id IN (${ids.map(() => '?').join(',')}) ORDER BY m.project_id, m.label, m.id`).all(...ids)).map(memberRow);
  }
  async function saveMember(projectId, body, { user } = {}) {
    const pid = Number(projectId), m = WB.normaliseMember(body), id = body && body.id ? Number(body.id) : null;
    return tx(async () => {
      let before = null;
      if (id) { before = await P(`SELECT * FROM ppm_project_members WHERE id=? AND project_id=?`).get(id, pid); if (!before) throw notFound('member'); }
      if (before) await P(`UPDATE ppm_project_members SET user_id=?, label=?, role=?, allocation_pct=?, from_day=?, to_day=?, updated_at=? WHERE id=?`).run(m.user_id, m.label, m.role, m.allocation_pct, m.from_day, m.to_day, now(), id);
      const mid = before ? id : await insert('ppm_project_members', ['project_id', 'user_id', 'label', 'role', 'allocation_pct', 'from_day', 'to_day', 'created_by', 'created_at', 'updated_at'], [pid, m.user_id, m.label, m.role, m.allocation_pct, m.from_day, m.to_day, uid(user), now(), now()]);
      await gov.ppmEvent({ entity: 'project', entity_id: pid, action: before ? 'team_member_edit' : 'team_member_added', field: `member:${mid}`, old_value: before ? `${before.label} · ${before.role || '—'} · ${before.allocation_pct == null ? 'unknown' : before.allocation_pct + ' %'}` : null, new_value: `${m.label} · ${m.role || '—'} · ${m.allocation_pct == null ? 'unknown' : m.allocation_pct + ' %'}` }, user);
      return memberRow(await P(`SELECT m.*, u.username FROM ppm_project_members m LEFT JOIN users u ON u.id = m.user_id WHERE m.id=?`).get(mid));
    });
  }
  async function removeMember(projectId, memberId, { user } = {}) {
    const pid = Number(projectId);
    const before = await P(`SELECT * FROM ppm_project_members WHERE id=? AND project_id=?`).get(Number(memberId), pid);
    if (!before) throw notFound('member');
    return tx(async () => {
      await P(`DELETE FROM ppm_project_members WHERE id=?`).run(Number(memberId));
      await gov.ppmEvent({ entity: 'project', entity_id: pid, action: 'team_member_removed', field: `member:${memberId}`, old_value: before.label, new_value: null }, user);
      return true;
    });
  }

  // ── R2-WB-02 time entries ───────────────────────────────────────────────────────────────────────────────────
  const timeRow = (r) => r && ({ id: Number(r.id), task_id: Number(r.task_id), person_user_id: n(r.person_user_id), person_label: r.person_label, day: r.day, hours: n(r.hours), note: r.note || null, created_by: n(r.created_by), created_at: r.created_at || null });
  async function listTimeEntries(taskId) { return (await P(`SELECT * FROM ppm_time_entries WHERE task_id=? ORDER BY day, id`).all(Number(taskId))).map(timeRow); }
  /** Every entry of the LIVE tasks of a project (a soft-deleted task's hours are not served). */
  async function listProjectTimeEntries(projectId) {
    return (await P(`SELECT e.* FROM ppm_time_entries e JOIN portfolio_tasks t ON t.id = e.task_id WHERE t.project_id=? AND t.deleted_at IS NULL ORDER BY e.task_id, e.day, e.id`).all(Number(projectId))).map(timeRow);
  }
  async function listTimeEntriesForTasks(taskIds) {
    const ids = [...new Set((taskIds || []).map(Number).filter(Number.isInteger))];
    if (!ids.length) return [];
    return (await P(`SELECT * FROM ppm_time_entries WHERE task_id IN (${ids.map(() => '?').join(',')}) ORDER BY task_id, day, id`).all(...ids)).map(timeRow);
  }
  async function addTimeEntry(taskId, projectId, body, { user } = {}) {
    const e = WB.normaliseTimeEntry(body, user);
    return tx(async () => {
      const id = await insert('ppm_time_entries', ['task_id', 'person_user_id', 'person_label', 'day', 'hours', 'note', 'created_by', 'created_at'], [Number(taskId), e.person_user_id, e.person_label, e.day, e.hours, e.note, uid(user), now()]);
      await gov.ppmEvent({ entity: 'project', entity_id: Number(projectId), action: 'time_entry_added', field: `task:${taskId}`, old_value: null, new_value: `${e.hours} h`, note: `${e.person_label} · ${e.day}${e.note ? ' · ' + e.note : ''}` }, user);
      return timeRow(await P(`SELECT * FROM ppm_time_entries WHERE id=?`).get(id));
    });
  }
  async function removeTimeEntry(taskId, entryId, projectId, { user } = {}) {
    const before = await P(`SELECT * FROM ppm_time_entries WHERE id=? AND task_id=?`).get(Number(entryId), Number(taskId));
    if (!before) throw notFound('time entry');
    return tx(async () => {
      await P(`DELETE FROM ppm_time_entries WHERE id=?`).run(Number(entryId));
      await gov.ppmEvent({ entity: 'project', entity_id: Number(projectId), action: 'time_entry_removed', field: `task:${taskId}`, old_value: `${n(before.hours)} h`, new_value: null, note: `${before.person_label} · ${before.day}` }, user);
      return true;
    });
  }

  // ── R2-WB-01 change requests ────────────────────────────────────────────────────────────────────────────────
  const crRow = (r) => r && ({ ...r, id: Number(r.id), project_id: Number(r.project_id), impact_dates_days: n(r.impact_dates_days), impact_budget: n(r.impact_budget), author_id: n(r.author_id), assessed_by: n(r.assessed_by), decided_by: n(r.decided_by), applied_baseline_version: n(r.applied_baseline_version) });
  async function listChangeRequests(projectId) { return (await P(`SELECT * FROM ppm_change_requests WHERE project_id=? ORDER BY id`).all(Number(projectId))).map(crRow); }
  async function listChangeRequestsFor(projectIds) {
    const ids = [...new Set((projectIds || []).map(Number).filter(Number.isInteger))];
    if (!ids.length) return [];
    return (await P(`SELECT * FROM ppm_change_requests WHERE project_id IN (${ids.map(() => '?').join(',')}) ORDER BY project_id, id`).all(...ids)).map(crRow);
  }
  async function getChangeRequest(id) { return crRow(await P(`SELECT * FROM ppm_change_requests WHERE id=?`).get(Number(id))); }
  const actorName = (user) => (user ? String(user.full_name || user.username || '') : null);
  async function createChangeRequest(projectId, body, { user } = {}) {
    const c = WB.normaliseChangeRequest(body), pid = Number(projectId);
    return tx(async () => {
      const id = await insert('ppm_change_requests', ['project_id', 'title', 'reason', 'impact_dates_days', 'impact_budget', 'currency', 'status', 'author_id', 'author_name', 'created_at'],
        [pid, c.title, c.reason, c.impact_dates_days, c.impact_budget, c.currency, 'proposed', uid(user), actorName(user), now()]);
      await gov.ppmEvent({ entity: 'project', entity_id: pid, action: 'change_request_proposed', field: `cr:${id}`, old_value: null, new_value: 'proposed', currency: c.currency, note: c.title }, user);
      return getChangeRequest(id);
    });
  }
  const _shiftDay = (d, days) => new Date(Date.parse(String(d).slice(0, 10) + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  /**
   * One lifecycle step (rules: services/ppmWorkbench.crTransition). opts: { user, isCommittee, note, rebaselineEnabled }.
   * apply with a dates impact moves the baseline through the governance store's rebaseline (version recorded on the CR);
   * refused 409 REBASELINE_OFF while ppm_rebaseline_enabled is '0', 409 NO_BASELINE when the project has no baseline end.
   */
  async function transitionChangeRequest(projectId, id, action, { user, isCommittee = false, note = null, rebaselineEnabled = false } = {}) {
    const cr = await getChangeRequest(id);
    if (!cr || cr.project_id !== Number(projectId)) throw notFound('change request');
    const prob = WB.crTransition(cr, action, { id: uid(user), isCommittee }, note);
    if (prob) throw Object.assign(new Error(prob.error), { code: prob.status === 403 ? 'FORBIDDEN' : prob.status === 409 ? 'CONFLICT' : 'INVALID', status: prob.status, reason: prob.code, expose: true });
    const to = WB.CR_ACTIONS[action].to, txt = WB.text(note, 2000);
    let version = null;
    if (action === 'apply' && cr.impact_dates_days) {
      if (!rebaselineEnabled) throw Object.assign(new Error('this change request moves the dates: applying it re-baselines the project, which needs the committee re-baseline (setting ppm_rebaseline_enabled) to be on'), { code: 'CONFLICT', status: 409, reason: 'REBASELINE_OFF', expose: true });
      const d = await gov.projectDetail(cr.project_id); const p = d && d.project;
      if (!p || !p.baseline_end) throw Object.assign(new Error('the project has no baseline end to move'), { code: 'CONFLICT', status: 409, reason: 'NO_BASELINE', expose: true });
      const r = await gov.rebaseline(cr.project_id, { reason: `Change request #${cr.id} — ${cr.title}`, project: { baseline_end: _shiftDay(p.baseline_end, cr.impact_dates_days) } }, { user });
      version = r.version;
    }
    return tx(async () => {
      const set = { assess: 'assessed_by=?, assessed_at=?, assessment_note=?', approve: 'decided_by=?, decided_at=?, decision_note=?', reject: 'decided_by=?, decided_at=?, decision_note=?', withdraw: 'decided_by=?, decided_at=?, decision_note=?', apply: 'applied_at=?, applied_baseline_version=?' }[action];
      const vals = action === 'apply' ? [now(), version] : [uid(user), now(), txt];
      const extra = ['approve', 'reject', 'withdraw'].includes(action) ? ', decided_by_name=?' : '';
      const r = await P(`UPDATE ppm_change_requests SET status=?, ${set}${extra} WHERE id=? AND status=?`).run(to, ...vals, ...(extra ? [actorName(user)] : []), cr.id, cr.status);
      if (r && r.changes === 0) throw Object.assign(new Error('the change request was changed by someone else — reload'), { code: 'CONFLICT', status: 409, reason: 'CR_ORDER', expose: true });
      await gov.ppmEvent({ entity: 'project', entity_id: cr.project_id, action: `change_request_${to}`, field: `cr:${cr.id}`, old_value: cr.status, new_value: to, currency: cr.currency, note: [txt, version != null ? `baseline v${version}` : null].filter(Boolean).join(' · ') || null }, user);
      return getChangeRequest(cr.id);
    });
  }

  return { listChangeRequests, listChangeRequestsFor, getChangeRequest, createChangeRequest, transitionChangeRequest, listMembers, listMembersFor, saveMember, removeMember, listTimeEntries, listProjectTimeEntries, listTimeEntriesForTasks, addTimeEntry, removeTimeEntry };
}

module.exports = { makeWorkbenchStore };
