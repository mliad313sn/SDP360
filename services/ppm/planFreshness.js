'use strict';
// B4 (goal programme P7, REQ B3) — "Plan updated X days ago". The plan's last update = the LATEST of
//   (a) the hash-chained ledger: max(ppm_events.at) WHERE entity = 'project' AND entity_id = the project, and
//   (b) the plan rows themselves: max(updated_at) of the project row and its live tasks / milestones / deliverables.
// (b) is needed because an ordinary task edit (dates, status, progress) does not write a ledger row — reading the
// ledger alone would call a busy plan "stale". No row and no event → null (UNKNOWN), never 0 days.
//   freshness(iso, today) PURE → { plan_updated_at, plan_updated_days }   (days = whole days, floor, ≥ 0)
//   planUpdatedAt(H, ids)  → { [project_id]: iso | null }   (H = pg handle: prepare(sql).all(...))

const DAY = 86400000;
const toIso = (v) => {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const later = (a, b) => (a == null ? b : b == null ? a : (Date.parse(a) >= Date.parse(b) ? a : b));

/** @param {string|null} iso  @param {string} today 'YYYY-MM-DD' or ISO */
function freshness(iso, today) {
  const at = toIso(iso);
  if (!at) return { plan_updated_at: null, plan_updated_days: null };
  const t = Date.parse(String(today).slice(0, 10) + 'T00:00:00Z');
  const d = Date.parse(at.slice(0, 10) + 'T00:00:00Z');
  return { plan_updated_at: at, plan_updated_days: Number.isFinite(t) ? Math.max(0, Math.floor((t - d) / DAY)) : null };
}

async function planUpdatedAt(H, projectIds) {
  const ids = [...new Set((projectIds || []).map(Number).filter(Number.isInteger))];
  const out = {}; for (const id of ids) out[id] = null;
  if (!ids.length) return out;
  const q = ids.map(() => '?').join(',');
  const take = (rows) => { for (const r of rows || []) { const id = Number(r.pid); if (id in out) out[id] = later(out[id], toIso(r.at)); } };
  take(await H.prepare(`SELECT entity_id AS pid, MAX(at) AS at FROM ppm_events WHERE entity='project' AND entity_id IN (${q}) GROUP BY entity_id`).all(...ids));
  take(await H.prepare(`SELECT id AS pid, updated_at AS at FROM portfolio_projects WHERE id IN (${q})`).all(...ids));
  for (const t of ['portfolio_tasks', 'portfolio_milestones', 'portfolio_deliverables']) {
    take(await H.prepare(`SELECT project_id AS pid, MAX(updated_at) AS at FROM ${t} WHERE deleted_at IS NULL AND project_id IN (${q}) GROUP BY project_id`).all(...ids));
  }
  return out;
}

module.exports = { freshness, planUpdatedAt, toIso };
