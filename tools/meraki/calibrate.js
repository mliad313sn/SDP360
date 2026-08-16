'use strict';
// V1b-A calibration harness (DEV-ONLY, run by the operator with their key).
// Pulls Meraki loss/latency history for a firewall's wan1/wan2 over a week window,
// derives % Time Up under BOTH missing-interval policies, and prints them next to the
// current uplink status — so you can compare against Meraki's own Summary Report
// ("% Time Up", e.g. Ity 99.86 / 97.87) and LOCK meraki_missing_policy accordingly.
//
// The key is read from the ENV, never a CLI arg, and is NEVER printed.
//   set MERAKI_API_KEY=...            (your read-only key)
//   set MERAKI_ORG_ID=...             (org id, e.g. from the dashboard URL o/<org>)
//   set MERAKI_CAL_SERIAL=Q2JN-PTVQ-M7YH   (default = ITY-F/W-01; any MX serial)
//   set MERAKI_CAL_T0=2026-08-08      (optional; match Meraki's "Past Week" start)
//   set MERAKI_CAL_T1=2026-08-14      (optional; match Meraki's "Past Week" end)
//   node tools/meraki/calibrate.js
// Paste back ONLY the printed %s (not the key).
const { makeMerakiClient } = require('../../services/merakiClient');
const { deriveAvailability, mergeDestinationSeries } = require('../../services/merakiWanQuality');

function _win() {
  const t0 = process.env.MERAKI_CAL_T0, t1 = process.env.MERAKI_CAL_T1;
  if (t0 && t1) return { t0: `${t0}T00:00:00Z`, t1: `${t1}T23:59:59Z` };
  const end = new Date(); const start = new Date(end.getTime() - 7 * 86400000);
  return { t0: start.toISOString(), t1: end.toISOString() };
}

(async () => {
  const apiKey = process.env.MERAKI_API_KEY, orgId = process.env.MERAKI_ORG_ID;
  if (!apiKey || !orgId) { console.error('Set MERAKI_API_KEY and MERAKI_ORG_ID in the environment first (never on the command line).'); process.exit(2); }
  const serial = process.env.MERAKI_CAL_SERIAL || 'Q2JN-PTVQ-M7YH';   // ITY-F/W-01
  const client = makeMerakiClient({ apiKey, orgId, baseUrl: process.env.MERAKI_BASE_URL });
  const { t0, t1 } = _win();
  const resolution = 3600;
  const totalIntervals = Math.max(1, Math.round((Date.parse(t1) - Date.parse(t0)) / (resolution * 1000)));

  console.log(`\nCalibration — serial ${serial}, window ${t0} → ${t1} (${totalIntervals} hourly intervals)\n`);

  // current status (cross-check: a destination-only outage must NOT read as a link outage)
  const statuses = (await client.orgUplinkStatuses({ serials: [serial] })) || [];
  const dev = statuses.find(d => d.serial === serial) || statuses[0];

  // ALL monitored destinations (the MX pings several) — derive across all of them.
  let destIps = [];
  try { const cd = await client.networkConnectivityDestinations({ networkId: dev && dev.networkId }); destIps = ((cd && cd.destinations) || []).map(d => d.ip).filter(Boolean); } catch { destIps = []; }
  if (!destIps.length) {   // fallback: the org-sampled destination
    const ll = (await client.orgUplinksLossLatency({ serials: [serial] })) || [];
    destIps = [...new Set(ll.map(r => r && r.ip).filter(Boolean))];
  }
  console.log(`monitored destinations: ${destIps.join(', ') || '(none found)'}\n`);

  for (const uplink of ['wan1', 'wan2']) {
    const cur = dev && (dev.uplinks || []).find(u => u.interface === uplink);
    if (!destIps.length) { console.log(`${uplink}: no monitored destination ip found (skip)`); continue; }
    const seriesList = [];
    for (const ip of destIps) seriesList.push((await client.deviceLossLatencyHistory({ serial, uplink, ip, t0, t1, resolution })) || []);
    const series = mergeDestinationSeries(seriesList);   // up if ANY destination responded
    const down = deriveAvailability(series, { totalIntervals, missing: 'down' });
    const unknown = deriveAvailability(series, { totalIntervals, missing: 'unknown' });
    console.log(`${uplink}  (status now: ${cur ? cur.status : '?'}, ${destIps.length} dest(s), ${series.length}/${totalIntervals} merged intervals present)`);
    console.log(`   % Time Up  missing='down'    : ${down.availability_pct}`);
    console.log(`   % Time Up  missing='unknown' : ${unknown.availability_pct}`);
    console.log(`   avg loss ${down.loss_pct_avg}% · latency ${down.latency_ms_avg}ms · jitter ${down.jitter_ms_avg}ms`);
    console.log(`   → compare to Meraki Summary Report "% Time Up" for ${uplink}; the matching policy is the one to set as meraki_missing_policy.\n`);
  }
  process.exit(0);
})().catch(e => { console.error('calibration failed:', e.message); process.exit(1); });
