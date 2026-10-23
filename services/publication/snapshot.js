'use strict';
// Step 9 — the nightly SNAPSHOT of the published indicators (job publication.snapshot): every published key × the group
// and each site × the last 13 months, computed by the metrics dispatch (the same figures as the screens) and stored in
// pb_metric_values. The OData feed (Power BI) and the scheduled publications read it; nothing recomputes on request.

const sql = require('../sqlStore');
const D = require('../metrics/dispatch');
const registry = require('../metrics/registry');

const handle = () => sql.handle('021_engagement_reports_publication.sql');
// Default published set (DEC-9.6, recommended): the six service objectives + volume and backlog.
const DEFAULT_KEYS = ['helpdesk.sla_res_pct', 'helpdesk.sla_reply_pct', 'infra.wan_timeup_pct', 'changes.success_pct', 'helpdesk.csat_pct',
  'meetings.engagements_score', 'helpdesk.inbound', 'helpdesk.closed', 'helpdesk.backlog'];

function publishedKeys(cfg) {
  const raw = String((cfg && cfg.published_metrics) || '').split(',').map(s => s.trim()).filter(Boolean);
  const served = new Set(registry.list().filter(m => m.serve).map(m => m.key));
  return (raw.length ? raw : DEFAULT_KEYS).filter(k => served.has(k));
}
function lastMonths(n, nowDate = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth() - i, 1)); out.push(d.toISOString().slice(0, 7)); }
  return out;
}

/** deps = { metrics, sites, targets }. Returns { keys, scopes, months, values }. */
async function run(keys, deps, { months = 13, nowDate = new Date() } = {}) {
  const { H, isPg } = handle();
  const ms = lastMonths(months, nowDate), t = new Date().toISOString();
  const scopes = ['GROUP', ...deps.sites.filter(s => s.code).map(s => s.code)];
  const rows = [];
  for (const key of keys) {
    const def = registry.get(key) || {};
    for (const month of ms) {
      const window = D.resolveWindow({ month });
      const g = await D.computeGroupMetric(key, { sites: deps.sites, window, targets: deps.targets }, deps.metrics);
      rows.push([key, 'GROUP', month, g.status === 200 ? g.value : null, def.unit || null, g.status === 200 ? g.rag || null : null]);
      for (const site of deps.sites.filter(s => s.code)) {
        const r = await D.computeMetric(key, { site, window, targets: deps.targets }, deps.metrics);
        rows.push([key, site.code, month, r.status === 200 ? r.value : null, def.unit || null, r.status === 200 ? r.rag || null : null]);
      }
    }
  }
  const up = `INSERT INTO pb_metric_values (metric_key, scope, month, value, unit, rag, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (metric_key, scope, month) DO UPDATE SET value = EXCLUDED.value, unit = EXCLUDED.unit, rag = EXCLUDED.rag, computed_at = EXCLUDED.computed_at`;
  if (isPg) await H.runTransaction(async () => { for (const r of rows) await H.prepare(up).run(...r, t); });
  else { const st = H.prepare(up); H.transaction(() => { for (const r of rows) st.run(...r, t); })(); }
  return { keys: keys.length, scopes: scopes.length, months: ms.length, values: rows.length };
}

/** Rows of the snapshot, filtered. */
async function read({ key, scope, from, to, limit = 5000, offset = 0 } = {}) {
  const { H } = handle();
  const w = [], p = [];
  if (key) { w.push('metric_key = ?'); p.push(key); }
  if (scope) { w.push('scope = ?'); p.push(scope); }
  if (from) { w.push('month >= ?'); p.push(from); }
  if (to) { w.push('month <= ?'); p.push(to); }
  return H.prepare(`SELECT * FROM pb_metric_values ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY metric_key, scope, month LIMIT ? OFFSET ?`).all(...p, limit, offset);
}

module.exports = { run, read, publishedKeys, lastMonths, DEFAULT_KEYS };
