'use strict';
// OPManager availability sync. Two acquisition paths, one downstream store:
//   • V1b-B REST (preferred when opmanager_api_key+base_url set) — read device availability
//     via getDeviceCompleteDetails.availdata and aggregate device-grain per site per family
//     (LAN/WLAN/Servers; WAN is Meraki, skipped). Stored basis='recent'.
//   • V1a Analytics (fallback, gated on opm_availability_view_id) — the prepared daily view.
// Both config-gated + best-effort (a failure writes NOTHING, keeps prior snapshots). Deps
// injectable. Never passes a Promise-returning resolver into a pure aggregate (pg trap).
const { aggregate } = require('../../services/opmAvailability');
const { aggregateDeviceAvail } = require('../../services/opmanagerAvailability');
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
function _currentMonthBounds(nowIso) {
  const d = new Date(nowIso); const y = d.getUTCFullYear(), m = d.getUTCMonth();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const mm = String(m + 1).padStart(2, '0');
  return { period_type: 'month', period_start: `${y}-${mm}-01`, period_end: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}
function _isFirewall(d) {
  return /F\/?W/i.test(String(d.name || d.deviceName || d.displayName || '')) ||
    /meraki\s*security|meraki\s*mx/i.test(String(d.category || '') + ' ' + String(d.type || ''));
}
function _trendOf(cur, prev) {
  if (cur == null || prev == null) return 'no_change';
  const d = cur - prev;
  if (Math.abs(d) < 0.1) return 'stable';
  return d > 0 ? 'up' : 'down';
}

// V1b-B — REST device-grain path (LAN/WLAN/Servers). Config-gated on opmanager_api_key+base_url.
async function _restPath(deps, cfg, rdb, now, log) {
  const client = deps.opmanagerClient || require('../../services/opmanagerClient').makeOpmanagerClient(
          require('../../services/opmanagerClient').optionsFromConfig(cfg));
  const targets = _safeParse(cfg.opm_targets, {});

  // Pre-resolve a PLAIN device→site map (default: probeName via the opmanager seed; the
  // probe-vs-name strategy is the discovery decision, overridable via deps.deviceToSite).
  const codes = (await rdb.listSiteModuleCodes('opmanager')) || [];
  const byProbe = {}; for (const c of codes) byProbe[String(c.code).trim().toLowerCase()] = c.site_id;
  const deviceToSite = deps.deviceToSite ||
    (d => { const k = String(d.probeName == null ? '' : d.probeName).trim().toLowerCase(); return byProbe[k] != null ? byProbe[k] : null; });

  // Windows: the report's PREVIOUS Zoho week + the current month.
  let week = deps.asOfWeek;
  if (!week) { const pw = rdb.getPreviousWeek(); const r = rdb.getWeekRange(pw.year, pw.week); week = { period_type: 'week', period_start: r.start, period_end: r.end }; }
  const month = deps.asOfMonth || _currentMonthBounds(now);

  const raw = (await client.listDevices({ rows: 5000, page: 1 })) || [];
  const devices = [];
  for (const d of raw) {
    if (_isFirewall(d)) continue;                                   // WAN = Meraki
    const name = d.name || d.deviceName || d.displayName;
    const details = await client.getDeviceCompleteDetails({ name });
    const availUp = details && details.availdata ? details.availdata.Up : null;
    devices.push({ name, type: d.type, category: d.category, probeName: d.probeName, availUp });
  }

  const wk = aggregateDeviceAvail(devices, { classify: classifyKpiFamily, deviceToSite, targets, period: week, collected_at: now });
  const mo = aggregateDeviceAvail(devices, { classify: classifyKpiFamily, deviceToSite, targets, period: month, collected_at: now });
  const all = [...wk, ...mo];
  await rdb.upsertInfraSnapshots(all);
  log(`[opm-sync:rest] devices=${devices.length} week=${wk.length} month=${mo.length} → upserted (recent)`);
  return { ok: true, mode: 'rest', devices: devices.length, week: wk.length, month: mo.length };
}

async function main(deps = {}) {
  const log = deps.log || console.log;
  const rdb = deps.rdb || require('../../reports-db');
  const getConfig = deps.getConfig || (() => require('../../services/reportConfig').getConfig(rdb.db));
  const now = deps.now || new Date().toISOString();

  const cfg = await getConfig();                      // Promise on postgres — MUST await

  // V1b-B REST path takes precedence when configured.
  if (cfg && cfg.opmanager_api_key && cfg.opmanager_base_url) {
    try { return await _restPath(deps, cfg, rdb, now, log); }
    catch (e) { console.warn('[opm-sync:rest] failed (non-blocking, prior snapshots kept):', e.message); return { ok: false, error: e.message }; }
  }

  const viewId = cfg && cfg.opm_availability_view_id;
  if (!viewId) { log('[opm-sync] not configured (opmanager REST or opm_availability_view_id) — skipping'); return { skipped: true }; }

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

    // Identify the OpManager monitoring servers themselves (remote probes + central)
    // from the config patterns, so they're excluded from the business pools and their
    // downtime flags blind-spot periods.
    const monPats = String((cfg && cfg.opm_monitor_patterns) || '')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const isMonitor = monPats.length
      ? (r => { const k = String(r.device_key || r.device_name || '').toLowerCase(); return monPats.some(p => k.includes(p)); })
      : (() => false);

    const wk = aggregate(rows, { probeToSite, classify: classifyKpiFamily, targets, periodType: 'week', isMonitor });
    const mo = aggregate(rows, { probeToSite, classify: classifyKpiFamily, targets, periodType: 'month', isMonitor });
    const all = [...wk, ...mo];

    // Blind-spot alert: a monitoring server was down during a period → that site's
    // availability may be understated. This is the "probe outage helps detect outages"
    // signal — surfaced in logs (and stamped on the snapshot via basis='monitoring_gap').
    const blind = all.filter(g => g.monitoring_ok === false);
    if (blind.length) {
      const uniq = [...new Set(blind.map(g => `${g.site_id}/${g.period_type}/${g.period_start}`))];
      console.warn(`[opm-sync] ⚠ monitoring blind spot in ${uniq.length} site-period(s) (probe/central was down — availability may be understated): ${uniq.join(', ')}`);
    }

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
module.exports = { main, _shiftDays, _prevMonthStart, _trendOf, _currentMonthBounds, _isFirewall };
