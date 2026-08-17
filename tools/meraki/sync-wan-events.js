'use strict';
// WAN SLA / ISP chargeback — nightly event-log INGESTER. Reads the Meraki appliance event
// log, pairs down/up events into outages, attributes them (site/maintenance/isp), and writes
// AUTHORITATIVE rows — reconciling any provisional open rows the poller (poll-wan-outages.js)
// left behind. Config-gated (no meraki_api_key → {skipped:true}) + best-effort (a throw writes
// NOTHING and returns {ok:false,error}; prior rows kept). All deps injectable — no DB/network in
// tests. NEVER passes a Promise-returning resolver into the pure pairEvents/attributeOutages
// (pg-Promise trap): the network→site map is pre-resolved with AWAITED calls first.
const { pairEvents, attributeOutages } = require('../../services/wanSla');
const { parseSlaWanConfig, resolveCircuit } = require('../../services/slaWanConfig');

function _lc(x) { return String(x == null ? '' : x).trim().toLowerCase(); }
// Meraki splits a site into product-typed networks ("… - appliance" / "- switch"). Normalise
// both the seed name and the live network name by stripping that suffix (same as sync-wan.js).
function _normNet(x) { return _lc(x).replace(/\s*-\s*(appliance|switch|wireless|combined|cellular ?gateway|sensor|camera)\s*$/, ''); }
// wan uplink from a Meraki event type: 'wan_1_down' → 'wan1', 'wan2_up' → 'wan2'.
// 'uplink_change' (and anything without a wanN token) → null (no direction/uplink → skipped).
function _uplinkFromType(type) { const m = /wan_?(\d)_(?:up|down)$/.exec(String(type || '')); return m ? `wan${m[1]}` : null; }

async function main(deps = {}) {
  const log = deps.log || console.log;
  const rdb = deps.rdb || require('../../reports-db');
  const getConfig = deps.getConfig || (() => require('../../services/reportConfig').getConfig(rdb.db));
  const now = deps.now || new Date().toISOString();

  try {
    const config = await getConfig();                         // Promise on pg — MUST await
    if (!config || !config.meraki_api_key) { log('[wan-events] not configured (meraki_api_key) — skipping'); return { skipped: true }; }
    const cfg = parseSlaWanConfig(config.sla_wan_config);
    const eventTypes = new Set(cfg.event_types || []);

    const client = deps.client || require('../../services/merakiClient').makeMerakiClient({
      apiKey: config.meraki_api_key, orgId: config.meraki_org_id, baseUrl: config.meraki_base_url });
    const fetchEvents = deps.fetchAllNetworkEvents || require('../../services/merakiClient').fetchAllNetworkEvents;

    // Pre-resolve (awaited, BEFORE the pure calls): network name → targets. A network can feed
    // MULTIPLE {site_id, sub_site} targets — the main meraki seed (sub_site '') plus any sub-site
    // rows sharing that network (Exploration fans from ONE network to per-sub-site rows).
    const netToTargets = new Map();
    const _push = (net, t) => { if (!net) return; const k = _normNet(net); const a = netToTargets.get(k) || []; a.push(t); netToTargets.set(k, a); };
    const siteMap = (await rdb.listSiteMerakiMap()) || [];
    for (const r of siteMap) _push(r.network, { site_id: r.site_id, sub_site: '' });
    // Guard the optional sub-site call: minimal injected rdbs may omit it (no sub-sites → normal).
    const subs = (typeof rdb.listWanSubsiteNetworks === 'function' ? await rdb.listWanSubsiteNetworks() : []) || [];
    for (const s of subs) _push(s.network, { site_id: s.site_id, sub_site: s.sub_site });

    // networkId → [{site_id,sub_site}] targets, via orgNetworks (awaited).
    const nets = (await client.orgNetworks()) || [];
    const netIdToTargets = new Map();
    for (const n of nets) { const t = netToTargets.get(_normNet(n.name)) || []; if (t.length) netIdToTargets.set(n.id, t); }

    // Fetch + tag events. pairEvents strips down to (site,sub,uplink,detected/restored), so we
    // stash network_id/device_serial per (site|sub|uplink) key to re-attach to the outage after.
    const lookbackDays = (cfg.ingest && cfg.ingest.lookback_days) || 3;
    const since = deps.since || new Date(Date.parse(now) - lookbackDays * 86400000).toISOString();
    const allEvents = [];
    const metaByKey = new Map();
    for (const [networkId, targets] of netIdToTargets) {
      const evs = (await fetchEvents(client, { networkId, since })) || [];
      for (const e of evs) {
        if (!eventTypes.has(e.type)) continue;
        const uplink = _uplinkFromType(e.type);
        if (!uplink) continue;                                // uplink_change etc → no direction
        for (const t of targets) {
          allEvents.push({ ...e, site_id: t.site_id, sub_site: t.sub_site, uplink });
          metaByKey.set(`${t.site_id}|${t.sub_site}|${uplink}`, { network_id: networkId, device_serial: e.deviceSerial || null });
        }
      }
    }

    const outages = pairEvents(allEvents);
    const attributed = attributeOutages(outages, {
      overlapMinutes: cfg.simultaneous_overlap_minutes, maintenance: cfg.maintenance });

    // Pre-read open provisional rows once (awaited) → the reconcile time-proximity gate.
    const tolMin = (cfg.ingest && cfg.ingest.reconcile_tolerance_minutes) || 60;
    const openProvisional = (await rdb.listOpenWanOutages()).filter((r) => r.source === 'meraki_status');

    let reconciled = 0, inserted = 0;
    for (const o of attributed) {
      const t0 = Date.parse(o.detected_start);
      const t1 = o.restored_end ? Date.parse(o.restored_end) : null;
      const duration_s = (t1 != null && Number.isFinite(t0) && Number.isFinite(t1)) ? Math.round((t1 - t0) / 1000) : null;
      const circuit = resolveCircuit(cfg, { site_id: o.site_id, sub_site: o.sub_site, uplink: o.uplink });
      const meta = metaByKey.get(`${o.site_id}|${o.sub_site}|${o.uplink}`) || {};
      const authoritative = {
        detected_start: o.detected_start, restored_end: o.restored_end, duration_s,
        attribution: o.attribution, attribution_reason: o.attribution_reason,
        isp: circuit ? (circuit.isp || null) : null,
        circuit_id: circuit ? (circuit.circuit_id || null) : null,
        network_id: meta.network_id || null, device_serial: meta.device_serial || null,
        source: 'meraki_event',
      };

      // reconcile-or-insert: upgrade a provisional poller row IF one is open within the tolerance
      // window (time proximity gates the reconcile — the store UPDATE has no time bound of its own).
      const near = openProvisional.find((r) =>
        r.site_id === o.site_id && (r.sub_site || '') === (o.sub_site || '') && r.uplink === o.uplink &&
        Math.abs(Date.parse(r.detected_start) - t0) <= tolMin * 60000);
      let did = 0;
      if (near) did = await rdb.reconcileProvisionalOutage({ site_id: o.site_id, sub_site: o.sub_site, uplink: o.uplink }, authoritative);
      if (did > 0) { reconciled += 1; continue; }
      await rdb.upsertWanOutage({ site_id: o.site_id, sub_site: o.sub_site, uplink: o.uplink, ...authoritative, raw_json: null });
      inserted += 1;
    }

    log(`[wan-events] outages=${attributed.length} reconciled=${reconciled} inserted=${inserted} (since ${since})`);
    return { ok: true, outages: attributed.length, reconciled };
  } catch (e) {
    console.warn('[wan-events] failed (non-blocking, prior rows kept):', e.message);
    return { ok: false, error: e.message };
  }
}

if (require.main === module) { main().then(r => process.exit(r && r.ok !== false ? 0 : 1)).catch(() => process.exit(1)); }
module.exports = { main, _uplinkFromType, _normNet };
