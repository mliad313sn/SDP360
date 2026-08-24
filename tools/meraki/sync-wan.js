'use strict';
// V1b-A — Meraki WAN availability & quality collector. Reads the Meraki Dashboard API
// (read-only), derives per-link % Time Up + quality over the report's Zoho week + the
// current month, and archives them in wan_link_snapshots (Meraki purges ~60d; OPS is the
// long-term book of record). Config-gated (no meraki_api_key → skip) + best-effort
// (a failure writes NOTHING and keeps prior snapshots). All deps injectable — no DB/network
// in tests. NEVER passes a Promise-returning resolver into the pure derive (pg-Promise trap):
// the network→site map + destination ips are pre-resolved with awaited calls first.
const { deriveAvailability, qualityAvailability, statusColor, mergeDestinationSeries } = require('../../services/merakiWanQuality');

// Fine resolution can't span a whole week in one call — split [t0,t1] into ≤1-day chunks.
function _dayChunks(t0Ms, t1Ms) {
  const DAY = 86400000, out = [];
  for (let s = t0Ms; s < t1Ms; s += DAY) out.push([s, Math.min(s + DAY, t1Ms)]);
  return out.length ? out : [[t0Ms, t1Ms]];
}

function _safeParse(s, d) { try { return JSON.parse(s); } catch { return d; } }
function _lc(x) { return String(x == null ? '' : x).trim().toLowerCase(); }
// Meraki splits a site into product-typed networks ("Sabodala Gold Operations - appliance"
// / "- switch"). Normalise both the seed name and the live network name by stripping that
// product suffix, so the base-name seed still maps the appliance network to its site.
function _normNet(x) { return _lc(x).replace(/\s*-\s*(appliance|switch|wireless|combined|cellular ?gateway|sensor|camera)\s*$/, ''); }

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
    const mosCfg = _safeParse(cfg.wan_mos_config, {});   // ITU-T E-model config (R-factor → MOS)
    // "% Time Up" down-thresholds — approximate Meraki (high-loss/timeout = down, not only 100% loss).
    const tu = { lossDownPct: cfg.wan_timeup_loss_pct != null && cfg.wan_timeup_loss_pct !== '' ? Number(cfg.wan_timeup_loss_pct) : 100,
                 latencyDownMs: cfg.wan_timeup_latency_ms != null && cfg.wan_timeup_latency_ms !== '' ? Number(cfg.wan_timeup_latency_ms) : null };

    // Windows: the report's PREVIOUS Zoho week (Sunday→Saturday, = weeks.start_date, the
    // report join key + tz control) and the current month. Injected in tests.
    let week = deps.asOfWeek, month = deps.asOfMonth;
    if (!week) { const pw = rdb.getPreviousWeek(); const r = rdb.getWeekRange(pw.year, pw.week); week = { period_start: r.start, period_end: r.end }; }
    if (!month) month = _currentMonthBounds(now);

    // Pre-resolve network name → targets and network id → name, with awaited calls,
    // BEFORE the pure derive. A network can feed MULTIPLE {site_id, sub_site} targets:
    // the main meraki seed (sub_site '') plus any sub-site rows sharing that network — so
    // one Exploration network fans to per-sub-site rows from a SINGLE fetch.
    const codes = (await rdb.listSiteModuleCodes('meraki')) || [];
    const netToTargets = new Map();
    const _pushTarget = (net, t) => { const k = _normNet(net); const a = netToTargets.get(k) || []; a.push(t); netToTargets.set(k, a); };
    for (const c of codes) _pushTarget(c.code, { site_id: c.site_id, sub_site: '' });
    // Guard the optional sub-site call: callers/tests may inject a minimal rdb without it,
    // and best-effort ethos means an absent fn is tolerated (no sub-sites → normal behaviour).
    const subs = (typeof rdb.listWanSubsiteNetworks === 'function' ? await rdb.listWanSubsiteNetworks() : []) || [];
    for (const s of subs) _pushTarget(s.network, { site_id: s.site_id, sub_site: s.sub_site });
    let networkNameById = deps.networkNameById;
    if (!networkNameById) {
      const nets = (await client.orgNetworks()) || [];
      const nameById = {}; for (const n of nets) nameById[n.id] = n.name;
      networkNameById = (id) => nameById[id] || null;
    }

    const statuses = (await client.orgUplinkStatuses({})) || [];
    const ll = (await client.orgUplinksLossLatency({})) || [];
    const ipByKey = {}; for (const r of ll) if (r && r.serial && r.uplink && !(`${r.serial}|${r.uplink}` in ipByKey)) ipByKey[`${r.serial}|${r.uplink}`] = r.ip;

    // Per-network monitored destinations (the MX pings SEVERAL). Cached per network; falls
    // back to the org-sampled ip if the network has none / the call fails. `ip` is REQUIRED
    // by deviceLossLatencyHistory, and using only one destination would false-flag a link as
    // down on a single-destination outage — so we merge across all destinations.
    const destsByNet = {};
    async function destIpsFor(dev, up) {
      if (!(dev.networkId in destsByNet)) {
        let ips = [];
        try { const r = await client.networkConnectivityDestinations({ networkId: dev.networkId }); ips = ((r && r.destinations) || []).map(d => d.ip).filter(Boolean); }
        catch { ips = []; }
        destsByNet[dev.networkId] = ips;
      }
      if (destsByNet[dev.networkId].length) return destsByNet[dev.networkId];
      const fb = ipByKey[`${dev.serial}|${up.interface}`];   // fallback: the sampled destination
      return fb ? [fb] : [];
    }

    const rows = [];
    const unmapped = new Set();   // networks that returned uplinks but map to no site (seed gap)
    for (const dev of statuses) {
      const netName = networkNameById(dev.networkId);
      const targets = netName != null ? (netToTargets.get(_normNet(netName)) || []) : [];
      if (targets.length === 0) { if (netName) unmapped.add(netName); continue; }   // unmapped → skip (never guess)
      for (const up of (dev.uplinks || [])) {
        if (!/^wan\d$/.test(String(up.interface || ''))) continue;   // wan1/wan2/… (cellular not a report family)
        const destIps = await destIpsFor(dev, up);
        for (const [ptype, win] of [['week', week], ['month', month]]) {
          const t0 = `${win.period_start}T00:00:00Z`;
          // Clamp the window END to NOW: an IN-PROGRESS period (the current month) must NOT count
          // its FUTURE days as "down". Without this, every link reads ~elapsed/total of the month
          // (e.g. 23 of 31 days ≈ 75%) — the unrealistic Monthly figure. The week is a past
          // complete window so min(...) leaves it unchanged.
          const t0Ms = Date.parse(t0);
          const t1Ms = Math.min(Date.parse(`${win.period_end}T23:59:59Z`), Date.parse(now));
          const t1 = new Date(t1Ms).toISOString();
          const resolution = 3600;
          const totalIntervals = Math.max(1, Math.round((t1Ms - t0Ms) / (resolution * 1000)));
          const seriesList = [];
          for (const ip of destIps) seriesList.push((await client.deviceLossLatencyHistory({ serial: dev.serial, uplink: up.interface, ip, t0, t1, resolution })) || []);
          const series = mergeDestinationSeries(seriesList);   // up if ANY destination responded
          // No samples at all (a warm-spare MX whose uplinks read 'not connected', or an API
          // gap) → skip: don't push a null row that would OVERWRITE the active MX's good data
          // for the same (site, uplink, period) key. (Fixes MANA reading '—' — two MX in one
          // network, the spare clobbering the master.)
          if (!series.length) continue;
          const q = deriveAvailability(series, { totalIntervals, missing, ...tu });   // % Time Up (loss/latency thresholds)

          // Quality-weighted (Meraki-aligned) availability needs FINE resolution: a loss burst
          // averaged into an hour reads clean. For the WEEK, take an extra 600s (10-min) pull,
          // day-chunked; for the month, reuse the 3600s series (coarser, acceptable). Best-effort.
          let qSeries = series, qTotal = totalIntervals;
          if (ptype === 'week') {
            const fine = 600;
            qTotal = Math.max(1, Math.round((t1Ms - t0Ms) / (fine * 1000)));
            const parts = [];
            for (const [c0, c1] of _dayChunks(t0Ms, t1Ms)) {
              const sl = [];
              for (const ip of destIps) sl.push((await client.deviceLossLatencyHistory({ serial: dev.serial, uplink: up.interface, ip, t0: new Date(c0).toISOString(), t1: new Date(c1).toISOString(), resolution: fine })) || []);
              parts.push(...mergeDestinationSeries(sl));
            }
            if (parts.length) qSeries = parts; else qTotal = totalIntervals;
          }
          const qq = qualityAvailability(qSeries, { totalIntervals: qTotal, missing, mos: mosCfg });
          // % Time Up (loss<100) — for the WEEK use the FINE (600s) series so short total-loss
          // bursts aren't averaged away inside an hour: at 3600s a bursty link reads ~100%, at
          // fine resolution it drops to Meraki's figure (MANA wan1 ~84%). Month keeps 3600s.
          const conn = (ptype === 'week' && qSeries !== series)
            ? deriveAvailability(qSeries, { totalIntervals: qTotal, missing, ...tu })
            : q;
          for (const t of targets) {
            rows.push({
              site_id: t.site_id, sub_site: t.sub_site, uplink: up.interface, period_type: ptype, period_start: win.period_start, period_end: win.period_end,
              availability_pct: conn.availability_pct, status_color: statusColor(conn.availability_pct, wanTarget),
              loss_pct_avg: q.loss_pct_avg, latency_ms_avg: q.latency_ms_avg, jitter_ms_avg: q.jitter_ms_avg, goodput_avg: q.goodput_avg,
              avail_quality_pct: qq.effective_pct, loss_pct_max: qq.loss_pct_max, latency_ms_max: qq.latency_ms_max,
              status_current: up.status || null, uplink_label: up.label || null, device_serial: dev.serial, network_id: dev.networkId,
              data_through: win.period_end, collected_at: now, source: 'meraki_api', raw_json: null,
            });
          }
        }
      }
    }
    await rdb.upsertWanSnapshots(rows);
    log(`[meraki-wan] devices=${statuses.length} rows=${rows.length} → upserted (week ${week.period_start})`);
    if (unmapped.size) log(`[meraki-wan] ${unmapped.size} network(s) unmapped to a site (add to the meraki seed / fix the site name): ${[...unmapped].join(' | ')}`);
    return { ok: true, rows: rows.length,
      week: rows.filter(r => r.period_type === 'week').length, month: rows.filter(r => r.period_type === 'month').length };
  } catch (e) {
    console.warn('[meraki-wan] failed (non-blocking, prior snapshots kept):', e.message);
    return { ok: false, error: e.message };
  }
}

if (require.main === module) { main().then(r => process.exit(r && r.ok !== false ? 0 : 1)).catch(() => process.exit(1)); }
module.exports = { main, _currentMonthBounds };
