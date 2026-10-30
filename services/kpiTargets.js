'use strict';
// Committee #40 — KPI targets per site (migration 038). PURE resolution + attainment; the store is the
// small set of functions at the bottom. Resolution: the site's live target → the platform's → none.
// Attainment = value / target when higher is better, target / value otherwise; colour through the shared
// RAG table (public/lib/kpiRag.js, policy 'kpi-target': green ≥ 1.0, amber ≥ 0.9) — never a literal here.
const KpiRag = require('../public/lib/kpiRag');
const { typed } = require('./httpError');

const live = (r, d) => !r.ended_at && String(r.effective_from) <= d;
function targetFor(rows, key, siteId, today) {
  const d = String(today || new Date().toISOString()).slice(0, 10);
  const pick = (f) => (rows || []).filter((r) => r.metric_key === key && live(r, d) && f(r)).sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)) || Number(b.id) - Number(a.id))[0];
  const s = siteId == null ? null : pick((r) => r.site_id != null && Number(r.site_id) === Number(siteId));
  const p = s ? null : pick((r) => r.site_id == null);
  const r = s || p;
  return r ? { target: Number(r.target), source: s ? 'site' : 'platform', id: Number(r.id), effective_from: r.effective_from } : { target: null, source: null };
}
/** null when it cannot be judged (no value, no target, zero) — never a verdict on nothing. */
function vsTarget(value, target, higherIsBetter = true) {
  if (value == null || target == null || !Number.isFinite(Number(value)) || !Number.isFinite(Number(target))) return { attainment: null, rag: 'NA' };
  const v = Number(value), t = Number(target);
  const a = higherIsBetter ? (t === 0 ? null : v / t) : (v === 0 ? (t >= 0 ? Infinity : null) : t / v);
  if (a == null || !Number.isFinite(a) && a !== Infinity) return { attainment: null, rag: 'NA' };
  return { attainment: a === Infinity ? null : Math.round(a * 1000) / 1000, rag: KpiRag.rag(a === Infinity ? 1 : a, 'kpi-target') };
}

function makeKpiTargetStore(db, { now = () => new Date().toISOString() } = {}) {
  const P = (sql) => db.prepare(sql);
  const tx = (fn) => (db.runTransaction ? db.runTransaction(fn) : fn());
  const ev = (id, action, actorId, details) => P('INSERT INTO governance_role_events (entity, entity_id, action, actor_id, at, details) VALUES (?, ?, ?, ?, ?, ?)').run('kpi_target', Number(id), action, actorId == null ? null : Number(actorId), now(), JSON.stringify(details || {}));
  const list = async () => (await P('SELECT * FROM kpi_site_targets WHERE ended_at IS NULL ORDER BY metric_key, site_id NULLS FIRST, effective_from').all()).map((r) => ({ ...r, id: Number(r.id), target: Number(r.target), site_id: r.site_id == null ? null : Number(r.site_id) }));
  async function set(b, { actorId, knownKey }) {
    if (!knownKey(b.metric_key)) throw typed('VALIDATION', 'unknown metric', 400);
    const t = Number(b.target); if (b.target === '' || b.target == null || !Number.isFinite(t)) throw typed('VALIDATION', 'target must be a number', 400);
    const from = String(b.effective_from || now()).slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw typed('VALIDATION', 'effective_from must be YYYY-MM-DD', 400);
    if (String(b.reason || '').trim().length < 5) throw typed('VALIDATION', 'a reason (5+ characters) is required', 400);
    const site = b.site_id == null || b.site_id === '' ? null : Number(b.site_id);
    return tx(async () => {
      // one live target per metric × scope: the previous one is ended (kept in the table and the history)
      const prev = await P('SELECT id FROM kpi_site_targets WHERE metric_key=? AND COALESCE(site_id, 0)=? AND ended_at IS NULL').all(b.metric_key, site == null ? 0 : site);
      for (const p of prev) { await P('UPDATE kpi_site_targets SET ended_by=?, ended_at=? WHERE id=?').run(actorId == null ? null : Number(actorId), now(), p.id); await ev(p.id, 'replaced', actorId, {}); }
      const r = await P('INSERT INTO kpi_site_targets (metric_key, site_id, target, effective_from, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id').get(b.metric_key, site, t, from, String(b.reason).slice(0, 1000), actorId == null ? null : Number(actorId), now());
      await ev(r.id, 'set', actorId, { metric_key: b.metric_key, site_id: site, target: t, from, reason: String(b.reason).slice(0, 300) });
      return Number(r.id);
    });
  }
  async function end(id, { actorId, reason }) {
    if (String(reason || '').trim().length < 5) throw typed('VALIDATION', 'a reason (5+ characters) is required', 400);
    return tx(async () => {
      const r = await P('UPDATE kpi_site_targets SET ended_by=?, ended_at=? WHERE id=? AND ended_at IS NULL').run(actorId == null ? null : Number(actorId), now(), Number(id));
      if (Number(r && r.changes) !== 1) throw typed('NOT_FOUND', 'target not found or already ended', 404);
      await ev(id, 'ended', actorId, { reason: String(reason).slice(0, 300) });
    });
  }
  return { list, set, end };
}
module.exports = { targetFor, vsTarget, makeKpiTargetStore };
