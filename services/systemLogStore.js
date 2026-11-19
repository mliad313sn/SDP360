'use strict';
// ─────────────────────────────────────────────────────────────────────────
// System log store (system_log: logEvent, list/count/analytics, retention purge, audit backfill) — moved out of reports-db.js (P06, monolith reduction). Same SQL, same behaviour; reports-db.js
// builds the store with its PostgreSQL handle getter and re-exports every function under the same name
// (pinned by tests/p06-reports-db-surface.test.js).
// ─────────────────────────────────────────────────────────────────────────

function createSystemLogStore({ handle }) {
  const pgHandle = handle;
  // ══ SYSTEM LOGS v1 ══════════════════════════════════════════════════════════
  // Unified security/audit event log. logEvent() is fire-and-forget: it NEVER
  // throws/rejects to a caller (a dead log must not break a request). Callers
  // invoke it BARE (never awaited, never chained → clear of await-precedence).
  const _RISK_ACTIONS = new Set([
    'login_failed','session_killed','user_deleted','user_role_changed','password_reset','report_deleted',
    'sso_link_conflict','sso_groups_overage',
    'inspection_purged','meetings_purged','portfolio_purged',   // A-19 — soft-deleted rows hard-deleted by the purge
  ]);
  function _isRiskAction(action) { return _RISK_ACTIONS.has(String(action || '')); }

  const _SECRET_KEY = /pass|secret|token|password|key$|_key|auth/i;
  function _redactKeys(keys) { return (keys || []).filter(k => !_SECRET_KEY.test(String(k))); }

  function _logCtx(req) {                       // authenticated call sites only
    const u = (req && req.reportUser) || {};
    const ip = (req && (req.ip || (req.headers && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()))) || null;
    return { actor: u.username || 'anonymous', actor_id: (u.id != null ? u.id : null), ip };
  }

  async function _logEventPg(row) {
    await pgHandle().prepare(
      `INSERT INTO system_log (ts,category,action,actor,actor_id,target,details,ip,risk)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(row.ts,row.category,row.action,row.actor,row.actor_id,row.target,row.details,row.ip,row.risk);
  }
  // Step 4 — audit retention: delete system_log rows older than `months` (default 12), never
  // the risk-flagged ones younger than `riskMonths` (default 24). Returns the deleted count.
  // Audit-trail retention (committee audit P1-8): risk events AND every governance-class event (policy
  // changes, overrides, handoffs, commitments, publication and minutes decisions) are kept 7 years —
  // UK Companies Act 6 years + one. Ordinary activity rows follow AUDIT_RETENTION_MONTHS (12).
  const GOVERNANCE_LOG_CATEGORIES = Object.freeze(['governance', 'commitments', 'handoffs', 'reports', 'trackers', 'dashboards', 'security']);
  function purgeSystemLog({ months = 12, riskMonths = Number(process.env.AUDIT_RISK_RETENTION_MONTHS) || 84, now = new Date() } = {}) {
    const cut = (m) => { const d = new Date(now); d.setUTCMonth(d.getUTCMonth() - m); return d.toISOString(); };
    const keep = Math.max(84, Number(riskMonths) || 84);   // never below 7 years, whatever the caller passes
    const inList = GOVERNANCE_LOG_CATEGORIES.map(() => '?').join(',');
    const sql = `DELETE FROM system_log WHERE (risk = 0 AND category NOT IN (${inList}) AND ts < ?) OR ((risk = 1 OR category IN (${inList})) AND ts < ?)`;
    return pgHandle().prepare(sql).run(...GOVERNANCE_LOG_CATEGORIES, cut(months), ...GOVERNANCE_LOG_CATEGORIES, cut(keep)).then((r) => ({ deleted: Number(r && (r.changes ?? r.rowCount)) || 0 }));
  }

  async function logEvent(ev = {}) {
    try {
      const row = {
        ts: new Date().toISOString(),
        category: String(ev.category || 'system'),
        action: String(ev.action || 'unknown'),
        actor: ev.actor != null ? String(ev.actor) : 'system',
        actor_id: ev.actor_id != null ? ev.actor_id : null,
        target: ev.target != null ? String(ev.target) : null,
        details: ev.details == null ? null : (typeof ev.details === 'string' ? ev.details : JSON.stringify(ev.details)),
        ip: ev.ip != null ? String(ev.ip) : null,
        risk: ev.risk != null ? (ev.risk ? 1 : 0) : (_isRiskAction(ev.action) ? 1 : 0),
      };
      await _logEventPg(row);
    } catch (e) { console.warn('[system-log] logEvent failed (swallowed):', e.message); }
  }

  // WHERE builder — present keys only, parameterised. Unknown keys ignored.
  function _syslogWhere(f = {}) {
    const c = [], p = [];
    if (f.category) { c.push('category = ?'); p.push(f.category); }
    if (f.action)   { c.push('action = ?');   p.push(f.action); }
    if (f.actor)    { c.push('actor LIKE ?');  p.push('%' + f.actor + '%'); }
    if (f.risk === 1 || f.risk === '1') { c.push('risk = 1'); }
    if (f.from && f.to) { c.push('substr(ts,1,10) BETWEEN ? AND ?'); p.push(f.from, f.to); }
    else if (f.from)    { c.push('substr(ts,1,10) >= ?'); p.push(f.from); }
    else if (f.to)      { c.push('substr(ts,1,10) <= ?'); p.push(f.to); }
    if (f.q) { c.push('(action LIKE ? OR target LIKE ? OR details LIKE ? OR actor LIKE ?)');
               const like = '%' + f.q + '%'; p.push(like, like, like, like); }
    return { where: c.length ? 'WHERE ' + c.join(' AND ') : '', params: p };
  }
  async function countSystemLog(filters = {}) {
    const { where, params } = _syslogWhere(filters);
    const sql = `SELECT COUNT(*) AS n FROM system_log ${where}`;
    return Number((await pgHandle().prepare(sql).get(...params)).n);
  }
  async function listSystemLog(filters = {}, { limit = 50, offset = 0 } = {}) {
    const { where, params } = _syslogWhere(filters);
    const sql = `SELECT * FROM system_log ${where} ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?`;
    const rows = (await pgHandle().prepare(sql).all(...params, limit, offset));
    return { rows, total: await countSystemLog(filters) };
  }
  async function getSystemLogAnalytics({ window: win = '30d' } = {}) {
    const days = { '7d':7, '30d':30, '90d':90 }[win] || 30;
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const q = async (sql, ...a) => ((pgHandle().prepare(sql).all(...a)));
    const g = async (sql, ...a) => ((pgHandle().prepare(sql).get(...a)));
    const t = await g(`SELECT COUNT(*) AS events, COALESCE(SUM(risk),0) AS risk_events,
        COUNT(DISTINCT actor) AS distinct_actors, COUNT(DISTINCT ip) AS distinct_ips
        FROM system_log WHERE ts >= ?`, since);
    const series      = await q(`SELECT substr(ts,1,10) AS d, COUNT(*) AS n FROM system_log WHERE ts >= ? GROUP BY substr(ts,1,10) ORDER BY d`, since);
    const risk_series = await q(`SELECT substr(ts,1,10) AS d, COUNT(*) AS n FROM system_log WHERE ts >= ? AND risk=1 GROUP BY substr(ts,1,10) ORDER BY d`, since);
    const top_actions = await q(`SELECT action, COUNT(*) AS n FROM system_log WHERE ts >= ? GROUP BY action ORDER BY n DESC LIMIT 12`, since);
    const top_actors  = await q(`SELECT actor, COUNT(*) AS n FROM system_log WHERE ts >= ? GROUP BY actor ORDER BY n DESC LIMIT 12`, since);
    const top_ips     = await q(`SELECT ip, COUNT(*) AS n FROM system_log WHERE ts >= ? AND ip IS NOT NULL GROUP BY ip ORDER BY n DESC LIMIT 12`, since);
    const hourRows    = await q(`SELECT substr(ts,12,2) AS h, COUNT(*) AS n FROM system_log WHERE ts >= ? GROUP BY substr(ts,12,2)`, since);
    const by_hour = Array.from({ length: 24 }, () => 0);
    for (const r of hourRows) { const h = parseInt(r.h, 10); if (h >= 0 && h < 24) by_hour[h] = Number(r.n); }
    const num = a => a.map(x => ({ ...x, n: Number(x.n) }));
    return {
      totals: { events: Number(t.events), risk_events: Number(t.risk_events),
                distinct_actors: Number(t.distinct_actors), distinct_ips: Number(t.distinct_ips) },
      series: num(series), risk_series: num(risk_series),
      top_actions: num(top_actions), top_actors: num(top_actors), top_ips: num(top_ips), by_hour,
    };
  }

  // One-time backfill of the existing report audit_log into system_log. Idempotent
  // via the zero-report-rows guard (NO setConfig marker — DEFAULTS filter trap).
  async function _backfillSystemLogFromAudit() {
    try {
      const have = await countSystemLog({ category: 'report' });
      if (have > 0) return;
      const rows = (await pgHandle().prepare(`SELECT report_id, user_id, username, action, details, created_at FROM audit_log`).all());
      for (const r of rows) {
        await logEvent({ category: 'report',
          action: /^report_/.test(r.action) ? r.action : 'report_' + r.action,
          actor: r.username, actor_id: r.user_id, target: r.report_id != null ? String(r.report_id) : null,
          details: r.details, risk: r.action === 'deleted' ? 1 : undefined });
      }
      if (rows.length) console.log(`[system-log] backfilled ${rows.length} report audit rows`);
    } catch (e) { console.warn('[system-log] backfill skipped:', e.message); }
  }

  return { _isRiskAction, _redactKeys, _logCtx, logEvent, purgeSystemLog, GOVERNANCE_LOG_CATEGORIES,
    listSystemLog, countSystemLog, getSystemLogAnalytics, _backfillSystemLogFromAudit };
}

module.exports = { createSystemLogStore };
