'use strict';
// PPM parity W4 (enterprise) — store of the per-project roles and the comments (migration 108). Same db handle shape as
// services/governanceStore (prepare(sql).get/all/run, runTransaction). Role changes leave a hash-chained ppm_events row
// through the governance store's ppmEvent; comments are their own append-only record. The routes decide the switches
// and the access rules; the store only checks the data. Pure rules: services/ppm/projectRoles.js, services/ppm/comments.js.
const PR = require('./projectRoles');
const CM = require('./comments');

function makeCollabStore(db, gov, { now = () => new Date().toISOString() } = {}) {
  if (!db) throw new Error('collab store needs a db handle');
  const P = (sql) => db.prepare(sql);
  const tx = (fn) => (typeof db.runTransaction === 'function' ? db.runTransaction(fn) : fn());
  const n = (v) => (v == null ? null : Number(v));
  const notFound = (what) => Object.assign(new Error(`${what} not found`), { code: 'NOT_FOUND', status: 404 });

  /** The effective project role of a user on a project (most restrictive of their rows), or null. */
  async function roleOf(projectId, userId) {
    if (projectId == null || userId == null) return null;
    const rows = await P(`SELECT ppm_role FROM ppm_project_members WHERE project_id=? AND user_id=? AND ppm_role IS NOT NULL`).all(Number(projectId), Number(userId));
    return PR.effectiveRole(rows.map((r) => r.ppm_role));
  }
  /** Every project where the user holds a project role: [{project_id, ppm_role}] (effective role per project). */
  async function membershipsOf(userId) {
    if (userId == null) return [];
    const rows = await P(`SELECT project_id, ppm_role FROM ppm_project_members WHERE user_id=? AND ppm_role IS NOT NULL`).all(Number(userId));
    const by = new Map();
    for (const r of rows) { const k = Number(r.project_id); (by.get(k) || by.set(k, []).get(k)).push(r.ppm_role); }
    return [...by.entries()].map(([project_id, roles]) => ({ project_id, ppm_role: PR.effectiveRole(roles) }));
  }
  /** Members of a project with their project role (display name only, never a login name nor an e-mail). */
  async function listRoles(projectId) {
    const rows = await P(`SELECT m.id, m.user_id, m.label, m.role, m.ppm_role, u.full_name FROM ppm_project_members m LEFT JOIN users u ON u.id = m.user_id WHERE m.project_id=? ORDER BY m.label, m.id`).all(Number(projectId));
    return rows.map((r) => ({ id: Number(r.id), label: r.label, job_role: r.role || null, linked: r.user_id != null, user_id: n(r.user_id), display_name: r.full_name || r.label, ppm_role: r.ppm_role || null }));
  }
  async function setRole(projectId, memberId, role, { user } = {}) {
    const pid = Number(projectId), mid = Number(memberId), r = PR.normaliseRole(role);
    const before = await P(`SELECT * FROM ppm_project_members WHERE id=? AND project_id=?`).get(mid, pid);
    if (!before) throw notFound('member');
    if (r && before.user_id == null) throw Object.assign(new Error('a project role needs a member linked to a user account'), { code: 'CONFLICT', status: 409, reason: 'NO_ACCOUNT' });
    return tx(async () => {
      await P(`UPDATE ppm_project_members SET ppm_role=?, updated_at=? WHERE id=?`).run(r, now(), mid);
      if (gov && typeof gov.ppmEvent === 'function') await gov.ppmEvent({ entity: 'project', entity_id: pid, action: 'project_role_set', field: `member:${mid}`, old_value: before.ppm_role || null, new_value: r }, user);
      return (await listRoles(pid)).find((m) => m.id === mid);
    });
  }
  /** The owner text of a live task and its project, or null. */
  async function taskOwner(taskId) {
    const r = await P(`SELECT id, project_id, owner FROM portfolio_tasks WHERE id=? AND deleted_at IS NULL`).get(Number(taskId));
    return r ? { id: Number(r.id), project_id: Number(r.project_id), owner: r.owner || null } : null;
  }

  // ── comments (append-only) ────────────────────────────────────────────────────────────────────────────────
  const commentRow = (r) => r && ({ id: Number(r.id), project_id: Number(r.project_id), task_id: n(r.task_id), body: r.body, author_id: n(r.author_id), author_name: r.author_name || null, mentions: (() => { try { return JSON.parse(r.mentions_json || '[]'); } catch (_) { return []; } })(), created_at: r.created_at });
  async function listComments(projectId, { taskId = null, limit = 200 } = {}) {
    const lim = Math.max(1, Math.min(500, Number(limit) || 200));
    const rows = taskId != null
      ? await P(`SELECT * FROM ppm_comments WHERE project_id=? AND task_id=? ORDER BY id DESC LIMIT ${lim}`).all(Number(projectId), Number(taskId))
      : await P(`SELECT * FROM ppm_comments WHERE project_id=? ORDER BY id DESC LIMIT ${lim}`).all(Number(projectId));
    return rows.map(commentRow);
  }
  async function addComment(projectId, { taskId = null, body, mentions = [] }, { user } = {}) {
    const text = CM.normaliseBody(body);
    if (taskId != null) {
      const t = await taskOwner(taskId);
      if (!t || t.project_id !== Number(projectId)) throw notFound('task');
    }
    const r = await P(`INSERT INTO ppm_comments (project_id, task_id, body, author_id, author_name, mentions_json, created_at) VALUES (?,?,?,?,?,?,?) RETURNING id`)
      .run(Number(projectId), taskId == null ? null : Number(taskId), text, user && user.id != null ? Number(user.id) : null, user ? (user.full_name || user.username || null) : null, JSON.stringify((mentions || []).map((m) => ({ id: Number(m.id), label: m.label }))), now());
    const id = Number(r && (r.id != null ? r.id : r.lastID != null ? r.lastID : (r.rows && r.rows[0] && r.rows[0].id)));
    return commentRow(await P(`SELECT * FROM ppm_comments WHERE id=?`).get(id));
  }

  return { roleOf, membershipsOf, listRoles, setRole, taskOwner, listComments, addComment };
}

module.exports = { makeCollabStore };
