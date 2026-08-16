'use strict';
// V1b-A — Meraki WAN availability & quality collector. Reads the Meraki Dashboard API
// (read-only), derives per-link % Time Up + quality over the report's Zoho week + the
// current month, and archives them in wan_link_snapshots (Meraki purges ~60d; OPS is the
// long-term book of record). Config-gated (no meraki_api_key → skip) + best-effort
// (a failure writes NOTHING and keeps prior snapshots). All deps injectable — no DB/network
// in tests. NEVER passes a Promise-returning resolver into the pure derive (pg-Promise trap):
// the network→site map + destination ips are pre-resolved with awaited calls first.
const { deriveAvailability, statusColor } = require('../../services/merakiWanQuality');

function _safeParse(s, d) { try { return JSON.parse(s); } catch { return d; } }
function _lc(x) { return String(x == null ? '' : x).trim().toLowerCase(); }

// Prod entrypoint window helpers (not used when windows are injected).
function _currentMonthBounds(nowIso) {
  const d = new Date(nowIso);
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  const start = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return { period_start: start, period_end: `${y}-${String(m + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}` };
}

async function main(deps = {}) {
  const log = deps.log || console.log;
  const rdb = deps.rdb || require('../../reports-db');
  const getConfig = deps.getConfig || (() => require('../../services/reportConfig').getConfig(rdb.db));
  const now = deps.now || new Date().toISOString();

  try {
    const cfg = await getConfig();                          // Promise on pg — MUST await
    if (!cfg || !cfg.meraki_api_key) { log('[meraki-wan] not configured (meraki_api_key) — skipping'); return { skipped: true }; }

    const client = deps.client || require('../../services/merakiClient').makeMerakiClient({
      apiKey: cfg.meraki_api_key, orgId: cfg.meraki_org_id, baseUrl: cfg.meraki_base_url });
    const wanTarget = _safeParse(cfg.opm_targets, {}).wan;
    const missing = cfg.meraki_missing_policy === 'unknown' ? 'unknown' : 'down';

    // Windows: the report's PREVIOUS Zoho week (Sunday→Saturday, = weeks.start_date, the
    // report join key + tz control) and the current month. Injected in tests.
    let week = deps.asOfWeek, month = deps.asOfMonth;
    if (!week) { const pw = rdb.getPreviousWeek(); const r = rdb.getWeekRange(pw.year, pw.week); week = { period_start: r.start, period_end: r.end }; }
    if (!month) month = _currentMonthBounds(now);

    // Pre-resolve network name → site_id (seed) and network id → name, with awaited calls,
    // BEFORE the pure derive.
    const codes = (await rdb.listSiteModuleCodes('meraki')) || [];
    const siteByNet = {}; for (const c of codes) siteByNet[_lc(c.code)] = c.site_id;
    let networkNameById = deps.networkNameById;
    if (!networkNameById) {
      const nets = (await client.orgNetworks()) || [];
      const nameById = {}; for (const n of nets) nameById[n.id] = n.name;
      networkNameById = (id) => nameById[id] || null;
    }

    const statuses = (await client.orgUplinkStatuses({})) || [];
    const ll = (await client.orgUplinksLossLatency({})) || [];
    const ipByKey = {}; for (const r of ll) if (r && r.serial && r.uplink && !(`${r.serial}|${r.uplink}` in ipByKey)) ipByKey[`${r.serial}|${r.uplink}`] = r.ip;

    const rows = [];
    for (const dev of statuses) {
      const netName = networkNameById(dev.networkId);
      const site_id = netName != null ? siteByNet[_lc(netName)] : null;
      if (site_id == null) continue;                        // unmapped network → skip (never guess)
      for (const up of (dev.uplinks || [])) {
        if (!/^wan\d$/.test(String(up.interface || ''))) continue;   // wan1/wan2/… (cellular not a report family)
        const ip = ipByKey[`${dev.serial}|${up.interface}`];
        for (const [ptype, win] of [['week', week], ['month', month]]) {
          const t0 = `${win.period_start}T00:00:00Z`, t1 = `${win.period_end}T23:59:59Z`;
          const resolution = 3600;
          const totalIntervals = Math.max(1, Math.round((Date.parse(t1) - Date.parse(t0)) / (resolution * 1000)));
          const series = ip ? (await client.deviceLossLatencyHistory({ serial: dev.serial, uplink: up.interface, ip, t0, t1, resolution })) : [];
          const q = deriveAvailability(series, { totalIntervals, missing });
          rows.push({
            site_id, uplink: up.interface, period_type: ptype, period_start: win.period_start, period_end: win.period_end,
            availability_pct: q.availability_pct, status_color: statusColor(q.availability_pct, wanTarget),
            loss_pct_avg: q.loss_pct_avg, latency_ms_avg: q.latency_ms_avg, jitter_ms_avg: q.jitter_ms_avg, goodput_avg: q.goodput_avg,
            status_current: up.status || null, uplink_label: up.label || null, device_serial: dev.serial, network_id: dev.networkId,
            data_through: win.period_end, collected_at: now, source: 'meraki_api', raw_json: null,
          });
        }
      }
    }
    await rdb.upsertWanSnapshots(rows);
    log(`[meraki-wan] devices=${statuses.length} rows=${rows.length} → upserted (week ${week.period_start})`);
    return { ok: true, rows: rows.length,
      week: rows.filter(r => r.period_type === 'week').length, month: rows.filter(r => r.period_type === 'month').length };
  } catch (e) {
    console.warn('[meraki-wan] failed (non-blocking, prior snapshots kept):', e.message);
    return { ok: false, error: e.message };
  }
}

if (require.main === module) { main().then(r => process.exit(r && r.ok !== false ? 0 : 1)).catch(() => process.exit(1)); }
module.exports = { main, _currentMonthBounds };
