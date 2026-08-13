'use strict';
// V1a — OPManager availability sync. Reads the prepared daily Analytics view, classifies
// + aggregates (week + month) in pure JS, and upserts infra_metric_snapshots. Config-gated
// (skips when opm_availability_view_id unset), best-effort (a fetch/parse failure writes
// NOTHING and keeps prior snapshots — never a partial/empty replace). Deps injectable.
const { aggregate } = require('../../services/opmAvailability');
const { classifyKpiFamily } = require('../../services/opmClassify');

function _safeParse(s, d) { try { return JSON.parse(s); } catch { return d; } }
function _shiftDays(dateIso, n) {
  const d = new Date(String(dateIso).slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function _prevMonthStart(dateIso) {
  let [y, m] = String(dateIso).split('-').map(Number);
  m -= 1; if (m < 1) { m = 12; y -= 1; }
  return `${y}-${String(m).padStart(2, '0')}-01`;
}
function _trendOf(cur, prev) {
  if (cur == null || prev == null) return 'no_change';
  const d = cur - prev;
  if (Math.abs(d) < 0.1) return 'stable';
  return d > 0 ? 'up' : 'down';
}

async function main(deps = {}) {
  const log = deps.log || console.log;
  const rdb = deps.rdb || require('../../reports-db');
  const getConfig = deps.getConfig || (() => require('../../services/reportConfig').getConfig(rdb.db));
  const now = deps.now || new Date().toISOString();

  const cfg = await getConfig();                      // Promise on postgres — MUST await
  const viewId = cfg && cfg.opm_availability_view_id;
  if (!viewId) { log('[opm-sync] not configured (opm_availability_view_id) — skipping'); return { skipped: true }; }

  const readDailyRows = deps.readDailyRows || ((a) => require('../../services/opmAnalytics').readDailyRows(a));
  const targets = _safeParse(cfg.opm_targets, {});

  try {
    const rows = await readDailyRows({ fetchView: deps.fetchView, viewId });

    // Pre-resolve a PLAIN sync probe→site_id map (getSiteIdByModuleCode returns a
    // Promise on pg, so never pass it as a live resolver into the pure aggregate).
    const codes = (await rdb.listSiteModuleCodes('opmanager')) || [];
    const byProbe = {};
    for (const c of codes) byProbe[String(c.code).trim().toLowerCase()] = c.site_id;
    const probeToSite = p => { const k = String(p == null ? '' : p).trim().toLowerCase(); return byProbe[k] != null ? byProbe[k] : null; };

    const wk = aggregate(rows, { probeToSite, classify: classifyKpiFamily, targets, periodType: 'week' });
    const mo = aggregate(rows, { probeToSite, classify: classifyKpiFamily, targets, periodType: 'month' });
    const all = [...wk, ...mo];

    // Trend vs the PREVIOUS period's snapshot — read BEFORE the upsert (never self-compare).
    for (const g of all) {
      const prevStart = g.period_type === 'week' ? _shiftDays(g.period_start, -7) : _prevMonthStart(g.period_start);
      const prior = await rdb.getInfraSnapshots({ site_id: g.site_id, period_type: g.period_type, kpi_family: g.kpi_family, period_start: prevStart });
      const pv = (prior && prior[0]) ? prior[0].metric_value : null;
      g.trend = _trendOf(g.metric_value, pv);
      g.source = 'analytics_opmanager';
      g.source_view = String(viewId);
      g.collected_at = now;
    }
    await rdb.upsertInfraSnapshots(all);
    log(`[opm-sync] rows=${rows.length} week=${wk.length} month=${mo.length} → upserted`);
    return { ok: true, rows: rows.length, week: wk.length, month: mo.length };
  } catch (e) {
    console.warn('[opm-sync] failed (non-blocking, prior snapshots kept):', e.message);
    return { ok: false, error: e.message };
  }
}

if (require.main === module) { main().then(r => process.exit(r && r.ok !== false ? 0 : 1)).catch(() => process.exit(1)); }
module.exports = { main, _shiftDays, _prevMonthStart, _trendOf };
