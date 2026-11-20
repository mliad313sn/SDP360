'use strict';
// W1-EVM — store of the per-task earned-value fields (migration 093, table ppm_task_evm) and the bulk reads the EVM
// routes need. Same db handle shape as services/governanceStore (prepare(sql).get/all/run, runTransaction); every
// write leaves a hash-chained ppm_events row through the governance store's ppmEvent (entity 'project'). The routes
// decide the switch and the access rules; the store checks the data. Pure engine: services/ppm/evm.js.
const EVM = require('./evm');

const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const invalid = (msg, reason) => Object.assign(new Error(msg), { code: 'INVALID', ...(reason ? { reason } : {}) });

/** Validate / normalise a body → the stored row (null fields = unknown). Throws INVALID. */
function normaliseEvmFields(body) {
  const b = body || {};
  const ev_method = b.ev_method == null || b.ev_method === '' ? EVM.DEFAULT_EV_METHOD : String(b.ev_method);
  if (!EVM.EV_METHODS.includes(ev_method)) throw invalid('ev_method must be ' + EVM.EV_METHODS.join(' | '), 'BAD_EV_METHOD');
  const physical_pct = num(b.physical_pct);
  if (b.physical_pct != null && b.physical_pct !== '' && (physical_pct == null || physical_pct < 0 || physical_pct > 100)) throw invalid('physical_pct must be 0..100 (leave empty when unknown)', 'BAD_PHYSICAL_PCT');
  const baseline_cost = num(b.baseline_cost), cost_rate = num(b.cost_rate);
  for (const [k, v] of [['baseline_cost', baseline_cost], ['cost_rate', cost_rate]]) {
    if (b[k] != null && b[k] !== '' && (v == null || v < 0)) throw invalid(`${k} must be a number ≥ 0 (leave empty when unknown)`, 'BAD_AMOUNT');
  }
  const cost_currency = b.cost_currency == null || b.cost_currency === '' ? null : String(b.cost_currency).toUpperCase();
  if (cost_currency != null && !/^[A-Z]{3}$/.test(cost_currency)) throw invalid('cost_currency must be an ISO code such as USD or XOF', 'BAD_CURRENCY');
  if ((baseline_cost != null || cost_rate != null) && cost_currency == null) throw invalid('a currency is required with a cost or a rate (never defaulted)', 'CURRENCY_REQUIRED');
  const capex_opex = b.capex_opex == null || b.capex_opex === '' ? null : String(b.capex_opex);
  if (capex_opex != null && !EVM.COST_CLASSES.includes(capex_opex)) throw invalid('capex_opex must be capex | opex', 'BAD_COST_CLASS');
  return { ev_method, physical_pct, baseline_cost, cost_currency, cost_rate, capex_opex };
}

function makeEvmStore(db, gov, { now = () => new Date().toISOString() } = {}) {
  if (!db || !gov) throw new Error('evm store needs a db handle and the governance store');
  const P = (sql) => db.prepare(sql);
  const tx = (fn) => (typeof db.runTransaction === 'function' ? db.runTransaction(fn) : fn());
  const ids = (xs) => [...new Set((xs || []).map(Number).filter(Number.isInteger))];
  const inList = (xs) => xs.map(() => '?').join(',');
  const row = (r) => r && { task_id: Number(r.task_id), ev_method: r.ev_method, physical_pct: num(r.physical_pct), baseline_cost: num(r.baseline_cost), cost_currency: r.cost_currency || null, cost_rate: num(r.cost_rate), capex_opex: r.capex_opex || null, updated_at: r.updated_at || null };

  /** task_id → fields, for the given tasks. */
  async function fieldsFor(taskIds) {
    const t = ids(taskIds); if (!t.length) return {};
    const out = {};
    for (const r of await P(`SELECT * FROM ppm_task_evm WHERE task_id IN (${inList(t)})`).all(...t)) out[Number(r.task_id)] = row(r);
    return out;
  }
  async function budgetPeriodsFor(projectIds) {
    const p = ids(projectIds); if (!p.length) return [];
    return (await P(`SELECT project_id, period, currency, kind, amount FROM ppm_budget_periods WHERE project_id IN (${inList(p)}) ORDER BY project_id, currency, period, kind`).all(...p))
      .map((r) => ({ project_id: Number(r.project_id), period: r.period, currency: r.currency, kind: r.kind, amount: num(r.amount) }));
  }
  /**
   * Time entries of every task of the projects, INCLUDING soft-deleted tasks (P11 R2-1: hours already logged are money
   * already spent — the engine keeps them in AC, flagged `actuals_on_deleted_tasks`). Such an entry carries the task's
   * rate / currency / cost class, since the caller only reads the EVM fields of the live tasks.
   */
  async function timeEntriesFor(projectIds) {
    const p = ids(projectIds); if (!p.length) return [];
    return (await P(`SELECT e.task_id, e.day, e.hours, t.project_id, t.deleted_at, v.cost_rate, v.cost_currency, v.capex_opex FROM ppm_time_entries e JOIN portfolio_tasks t ON t.id = e.task_id LEFT JOIN ppm_task_evm v ON v.task_id = e.task_id WHERE t.project_id IN (${inList(p)}) ORDER BY e.task_id, e.day`).all(...p))
      .map((r) => ({ task_id: Number(r.task_id), project_id: Number(r.project_id), day: r.day, hours: num(r.hours),
        ...(r.deleted_at ? { task_deleted: true } : {}), cost_rate: num(r.cost_rate), cost_currency: r.cost_currency || null, capex_opex: r.capex_opex || null }));
  }
  /**
   * P11 R3-2 — projects hidden from the portfolio by a soft delete (their own, or their objective's / programme's) that
   * still carry money already spent (time entries or monthly ACTUAL budget periods). The portfolio EVM keeps that spent
   * money in AC, flagged `actuals_on_deleted_projects`. The caller filters them by the reader's scope.
   */
  async function hiddenProjectsWithActuals() {
    return (await P(`SELECT p.*, o.programme_id AS programme_id FROM portfolio_projects p JOIN portfolio_objectives o ON o.id = p.objective_id JOIN portfolio_programmes g ON g.id = o.programme_id
      WHERE (p.deleted_at IS NOT NULL OR o.deleted_at IS NOT NULL OR g.deleted_at IS NOT NULL)
        AND (EXISTS (SELECT 1 FROM ppm_time_entries e JOIN portfolio_tasks t ON t.id = e.task_id WHERE t.project_id = p.id)
          OR EXISTS (SELECT 1 FROM ppm_budget_periods b WHERE b.project_id = p.id AND b.kind = 'actual'))
      ORDER BY p.id`).all()).map((r) => ({ ...r, id: Number(r.id), objective_id: r.objective_id == null ? null : Number(r.objective_id), programme_id: r.programme_id == null ? null : Number(r.programme_id) }));
  }
  /** The latest baseline version payload per project (frozen task dates), or nothing. */
  async function latestBaselinesFor(projectIds) {
    const p = ids(projectIds); if (!p.length) return {};
    const out = {};
    for (const r of await P(`SELECT project_id, version, payload_json FROM portfolio_baselines WHERE project_id IN (${inList(p)}) ORDER BY project_id, version`).all(...p)) {
      try { out[Number(r.project_id)] = { version: Number(r.version), payload: JSON.parse(r.payload_json) }; } catch (_) { /* an unreadable payload is no baseline */ }
    }
    return out;
  }
  async function saveTaskFields(taskId, projectId, body, { user } = {}) {
    const f = normaliseEvmFields(body), tid = Number(taskId), pid = Number(projectId);
    return tx(async () => {
      const before = row(await P(`SELECT * FROM ppm_task_evm WHERE task_id=?`).get(tid));
      if (before) await P(`UPDATE ppm_task_evm SET ev_method=?, physical_pct=?, baseline_cost=?, cost_currency=?, cost_rate=?, capex_opex=?, updated_by=?, updated_at=? WHERE task_id=?`)
        .run(f.ev_method, f.physical_pct, f.baseline_cost, f.cost_currency, f.cost_rate, f.capex_opex, user && user.id != null ? Number(user.id) : null, now(), tid);
      else await P(`INSERT INTO ppm_task_evm (task_id, ev_method, physical_pct, baseline_cost, cost_currency, cost_rate, capex_opex, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(tid, f.ev_method, f.physical_pct, f.baseline_cost, f.cost_currency, f.cost_rate, f.capex_opex, user && user.id != null ? Number(user.id) : null, now());
      const fmt = (x) => (x ? `${x.ev_method} · phys ${x.physical_pct == null ? '—' : x.physical_pct + ' %'} · cost ${x.baseline_cost == null ? '—' : x.baseline_cost} · rate ${x.cost_rate == null ? '—' : x.cost_rate}/h · ${x.capex_opex || '—'}` : null);
      await gov.ppmEvent({ entity: 'project', entity_id: pid, action: 'task_evm_edit', field: `task:${tid}`, old_value: fmt(before), new_value: fmt(f), currency: f.cost_currency, note: 'not certified' }, user);
      return row(await P(`SELECT * FROM ppm_task_evm WHERE task_id=?`).get(tid));
    });
  }
  return { fieldsFor, budgetPeriodsFor, timeEntriesFor, hiddenProjectsWithActuals, latestBaselinesFor, saveTaskFields };
}

module.exports = { makeEvmStore, normaliseEvmFields };
