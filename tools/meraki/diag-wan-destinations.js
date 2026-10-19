'use strict';
// READ-ONLY diagnostic — proves the "multi-destination averaging" hypothesis for the WAN
// Quality figures. A Meraki MX pings SEVERAL destinations per uplink; sync-wan MERGES them
// (mergeDestinationSeries: loss = best-of, latency/jitter = AVERAGE across destinations),
// while Meraki's Summary Report shows ONE destination. This dumps, per uplink, the avg
// loss/latency/jitter of EACH destination + the merged value (= what our dashboard shows),
// so you can see whether a far destination is inflating our latency vs Meraki.
//
// NOTHING is written. The API key comes from the ENV — it is NEVER printed.
//
//   set MERAKI_API_KEY=<your key>        (org id defaults to Endeavour's; override with MERAKI_ORG_ID)
//   node tools/meraki/diag-wan-destinations.js --network=ouaga --days=7
//
// Flags: --network=<name substring> (default "ouaga") · --days=N (default 7, rolling, ends yesterday)

const { makeMerakiClient } = require('../../services/merakiClient');
const { mergeDestinationSeries } = require('../../services/merakiWanQuality');

function arg(name, dflt) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : dflt;
}
function avg(nums) {
  const xs = nums.filter(n => n != null && Number.isFinite(+n)).map(Number);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
function f2(x) { return x == null ? '—' : (Math.round(x * 100) / 100).toString(); }
function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }

// Split [t0,t1] into <=1-day chunks (Meraki caps the span at fine resolution), same as sync-wan.
function dayChunks(t0Ms, t1Ms) {
  const DAY = 86400000, out = [];
  for (let c0 = t0Ms; c0 < t1Ms; c0 += DAY) out.push([c0, Math.min(c0 + DAY, t1Ms)]);
  return out;
}

async function main() {
  const apiKey = process.env.MERAKI_API_KEY;
  const orgId = process.env.MERAKI_ORG_ID || '595601050719773321';   // Endeavour org (non-secret; overridable)
  const baseUrl = process.env.MERAKI_BASE_URL || 'https://api.meraki.com/api/v1';
  if (!apiKey) { console.error('✗ Set MERAKI_API_KEY in the environment first (never paste it into chat).'); process.exit(1); }

  const netQuery = String(arg('network', 'ouaga')).toLowerCase();
  const days = Math.max(1, Math.min(31, parseInt(arg('days', '7'), 10) || 7));
  const resolution = 600;   // 10-min, like the sync's fine WEEK pull

  // Meraki "past week" preset = rolling N complete days ending at start-of-today (UTC).
  const to = new Date(); to.setUTCHours(0, 0, 0, 0);
  const t1Ms = to.getTime(), t0Ms = t1Ms - days * 86400000;
  const client = makeMerakiClient({ apiKey, orgId, baseUrl });

  console.log(`\nWindow: ${new Date(t0Ms).toISOString().slice(0, 10)} → ${new Date(t1Ms).toISOString().slice(0, 10)}  (${days}d, resolution ${resolution}s)\n`);

  const nets = (await client.orgNetworks()) || [];
  const matches = nets.filter(n => String(n.name || '').toLowerCase().includes(netQuery));
  if (!matches.length) { console.error(`✗ No network name contains "${netQuery}". Available: ${nets.map(n => n.name).join(', ')}`); process.exit(1); }
  const netIds = new Set(matches.map(n => n.id));
  console.log(`Matched network(s): ${matches.map(n => `${n.name} [${n.id}]`).join(', ')}\n`);

  const statuses = (await client.orgUplinkStatuses({})) || [];
  const ll = (await client.orgUplinksLossLatency({})) || [];
  const ipByKey = {}; for (const r of ll) if (r && r.serial && r.uplink) ipByKey[`${r.serial}|${r.uplink}`] = r.ip;

  for (const dev of statuses) {
    if (!netIds.has(dev.networkId)) continue;
    const netName = (matches.find(n => n.id === dev.networkId) || {}).name || dev.networkId;

    // Destinations the MX pings (same source as the sync), + the org-sampled ip as fallback.
    let destIps = [];
    try { const r = await client.networkConnectivityDestinations({ networkId: dev.networkId }); destIps = ((r && r.destinations) || []).map(d => d.ip).filter(Boolean); } catch (_) {}

    for (const up of (dev.uplinks || [])) {
      const iface = String(up.interface || '');
      if (!/^wan\d$/.test(iface)) continue;
      const ips = destIps.length ? destIps : (ipByKey[`${dev.serial}|${iface}`] ? [ipByKey[`${dev.serial}|${iface}`]] : []);
      console.log(`── ${netName} · ${iface}  (serial ${dev.serial})  destinations: ${ips.length ? ips.join(', ') : '(none)'}`);
      console.log(`   ${pad('destination', 20)} ${pad('samples', 8)} ${pad('loss %', 9)} ${pad('latency ms', 12)} ${pad('jitter ms', 10)}`);

      const perDestSeries = [];
      for (const ip of ips) {
        // day-chunk the fine pull, exactly like sync-wan
        const parts = [];
        for (const [c0, c1] of dayChunks(t0Ms, t1Ms)) {
          const s = (await client.deviceLossLatencyHistory({ serial: dev.serial, uplink: iface, ip, t0: new Date(c0).toISOString(), t1: new Date(c1).toISOString(), resolution })) || [];
          parts.push(...s);
        }
        perDestSeries.push(parts);
        const loss = avg(parts.map(s => s && s.lossPercent));
        const lat = avg(parts.map(s => s && s.latencyMs));
        const jit = avg(parts.map(s => s && s.jitter));
        console.log(`   ${pad(ip, 20)} ${pad(parts.length, 8)} ${pad(f2(loss), 9)} ${pad(f2(lat), 12)} ${pad(f2(jit), 10)}`);
      }

      // The MERGED series = exactly what the dashboard stores/shows.
      const merged = mergeDestinationSeries(perDestSeries);
      const mLoss = avg(merged.map(s => s && s.lossPercent));
      const mLat = avg(merged.map(s => s && s.latencyMs));
      const mJit = avg(merged.map(s => s && s.jitter));
      console.log(`   ${pad('» MERGED (dashboard)', 20)} ${pad(merged.length, 8)} ${pad(f2(mLoss), 9)} ${pad(f2(mLat), 12)} ${pad(f2(mJit), 10)}`);
      console.log('');
    }
  }
  console.log('Done. Compare the per-destination rows to Meraki\'s Summary Report: if one destination\nis far (high latency) it drags the MERGED latency/jitter up vs Meraki\'s single-destination figure.\n');
}

if (require.main === module) main().catch(e => { console.error('✗', e && e.message || e); process.exit(1); });
module.exports = { main };
