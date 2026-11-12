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

  return { listMembers, listMembersFor, saveMember, removeMember };
}

module.exports = { makeWorkbenchStore };
