'use strict';
// W4-CONNECTORS — store of the optional Jira / Azure DevOps pull (migration 112): per-project opt-in (system + scope),
// task ↔ work-item links, and the APPLY of a planSync() result (services/ppm/workItemSync). Native tasks are created
// and updated through the governance store's upsertPortfolio (same validation, integrity checks and audit as a manual
// edit); every applied sync also leaves one hash-chained ppm_events row on the project. Read-only towards the external
// tool: nothing here talks to it.
const SYSTEMS = ['jira', 'azdo'];
const invalid = (msg, reason) => Object.assign(new Error(msg), { code: 'INVALID', status: 400, reason });

function makeExternalLinkStore(db, gov, { now = () => new Date().toISOString() } = {}) {
  if (!db || !gov) throw new Error('external link store needs a db handle and the governance store');
  const P = (sql) => db.prepare(sql);
  const tx = (fn) => (typeof db.runTransaction === 'function' ? db.runTransaction(fn) : fn());
  const sys = (s) => { if (!SYSTEMS.includes(s)) throw invalid('system must be jira or azdo', 'BAD_SYSTEM'); return s; };
  const srcRow = (r) => r && { project_id: Number(r.project_id), system: r.system, scope: r.scope, enabled_by: r.enabled_by_name || null, enabled_at: r.enabled_at,
    last_sync_at: r.last_sync_at || null, last_sync_by: r.last_sync_by || null, last_result: r.last_result_json ? JSON.parse(r.last_result_json) : null };

  async function getSource(pid, system) { return srcRow(await P(`SELECT * FROM ppm_external_sources WHERE project_id=? AND system=?`).get(Number(pid), sys(system))) || null; }
  async function listSources() { return (await P(`SELECT * FROM ppm_external_sources ORDER BY project_id, system`).all()).map(srcRow); }
  async function setSource(pid, system, scope, { user } = {}) {
    const s = String(scope == null ? '' : scope).trim();
    if (!s) throw invalid('scope is required (Jira project key / JQL, or Azure DevOps area path)', 'SCOPE_REQUIRED');
    if (s.length > 1000) throw invalid('scope is too long', 'SCOPE_TOO_LONG');
    const at = now();
    await P(`INSERT INTO ppm_external_sources (project_id, system, scope, enabled_by, enabled_by_name, enabled_at) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (project_id, system) DO UPDATE SET scope = EXCLUDED.scope, enabled_by = EXCLUDED.enabled_by, enabled_by_name = EXCLUDED.enabled_by_name, enabled_at = EXCLUDED.enabled_at`)
      .run(Number(pid), sys(system), s, user && user.id != null ? Number(user.id) : null, (user && (user.full_name || user.username)) || null, at);
    await gov.ppmEvent({ entity: 'project', entity_id: Number(pid), action: 'external_source_set', field: system, new_value: s }, user);
    return getSource(pid, system);
  }
  async function removeSource(pid, system, { user } = {}) {
    const r = await P(`DELETE FROM ppm_external_sources WHERE project_id=? AND system=?`).run(Number(pid), sys(system));
    if (r && r.changes) await gov.ppmEvent({ entity: 'project', entity_id: Number(pid), action: 'external_source_removed', field: system }, user);
    return { removed: !!(r && r.changes) };
  }
  async function listLinks(pid, system) {
    return (await P(`SELECT l.*, t.name AS task_name, t.status AS task_status, t.progress_pct, t.effort_hours, t.deadline, t.start_date, t.end_date, t.deleted_at
                     FROM ppm_external_links l JOIN portfolio_tasks t ON t.id = l.task_id WHERE l.project_id=? AND l.system=? ORDER BY l.id`).all(Number(pid), sys(system)))
      .map((r) => ({ external_key: r.external_key, task_id: Number(r.task_id), external_url: r.external_url, external_status: r.external_status, external_type: r.external_type, last_synced_at: r.last_synced_at,
        task: { name: r.task_name, status: r.task_status, progress_pct: r.progress_pct == null ? null : Number(r.progress_pct), effort_hours: r.effort_hours == null ? null : Number(r.effort_hours), deadline: r.deadline, start_date: r.start_date, end_date: r.end_date, deleted: !!r.deleted_at } }));
  }

  /** Applies a planSync() result. Idempotent: links are unique per project × system × key. */
  async function applyPlan(pid, system, plan, { user, summary } = {}) {
    sys(system);
    const at = now();
    return tx(async () => {
      let created = 0, updated = 0;
      const maxSort = await P(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM portfolio_tasks WHERE project_id=?`).get(Number(pid));
      let sort = Number(maxSort && maxSort.m) || 0;
      for (const it of plan.create) {
        const body = { project_id: Number(pid), name: it.name, status: it.status, sort_order: ++sort };
        if (it.progress_pct != null) body.progress_pct = it.progress_pct;
        if (it.effort_hours != null) body.effort_hours = it.effort_hours;
        if (it.deadline) body.deadline = it.deadline;
        if (it.start_date && it.end_date) { body.schedule_mode = 'manual'; body.start_date = it.start_date; body.end_date = it.end_date; }
        const tid = await gov.upsertPortfolio('task', body, { user });
        await P(`INSERT INTO ppm_external_links (project_id, task_id, system, external_key, external_url, external_status, external_type, first_synced_at, last_synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT (project_id, system, external_key) DO UPDATE SET task_id = EXCLUDED.task_id, external_url = EXCLUDED.external_url, external_status = EXCLUDED.external_status, external_type = EXCLUDED.external_type, last_synced_at = EXCLUDED.last_synced_at`)
          .run(Number(pid), Number(tid), system, it.external_key, it.external_url, it.external_status, it.external_type, at, at);
        created++;
      }
      for (const u of plan.update) {
        await gov.upsertPortfolio('task', { id: u.task_id, ...u.patch }, { user });
        updated++;
      }
      for (const u of [...plan.update, ...plan.unchanged]) {
        await P(`UPDATE ppm_external_links SET external_status=?, external_type=?, external_url=?, last_synced_at=? WHERE project_id=? AND system=? AND external_key=?`)
          .run(u.item.external_status, u.item.external_type, u.item.external_url, at, Number(pid), system, u.external_key);
      }
      const result = { ...(summary || {}), created, updated, at };
      await P(`UPDATE ppm_external_sources SET last_sync_at=?, last_sync_by=?, last_result_json=? WHERE project_id=? AND system=?`).run(at, (user && user.username) || null, JSON.stringify(result), Number(pid), system);
      await gov.ppmEvent({ entity: 'project', entity_id: Number(pid), action: 'external_sync', field: system, new_value: `${created} created · ${updated} updated · ${plan.unchanged.length} unchanged · ${plan.missing_upstream.length} missing upstream` }, user);
      return result;
    });
  }

  return { getSource, listSources, setSource, removeSource, listLinks, applyPlan, SYSTEMS };
}

module.exports = { makeExternalLinkStore, SYSTEMS };
