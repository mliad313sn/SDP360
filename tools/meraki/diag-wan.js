'use strict';
// V1b-A diagnostic (DEV-ONLY, operator-run). Traces ONE uplink end-to-end so you can
// see WHERE the WAN data stops when snapshots upsert but the metrics come back null:
//   uplink statuses → monitored destination IP → loss/latency history.
// The key is read from the ENV, never a CLI arg, and is NEVER printed.
//   set MERAKI_API_KEY=...          (your read-only key)
//   set MERAKI_ORG_ID=...           (the numeric org id)
//   node tools/meraki/diag-wan.js
const { makeMerakiClient } = require('../../services/merakiClient');

(async () => {
  const apiKey = process.env.MERAKI_API_KEY, orgId = process.env.MERAKI_ORG_ID;
  if (!apiKey || !orgId) { console.error('Set MERAKI_API_KEY and MERAKI_ORG_ID in the environment first (never on the command line).'); process.exit(2); }
  const mk = makeMerakiClient({ apiKey, orgId, baseUrl: process.env.MERAKI_BASE_URL });

  // 1) MX appliances + their wan1/wan2 status
  const st = (await mk.orgUplinkStatuses({})) || [];
  console.log(`\n[1] appliance uplink statuses: ${st.length} device(s)`);
  const dev = st.find(d => (d.uplinks || []).some(u => /^wan\d$/.test(u.interface || '')));
  if (!dev) { console.log('    → no MX with a wan uplink found — check the org id / that MX devices exist.'); return; }
  console.log(`    sample: serial=${dev.serial} network=${dev.networkId} uplinks=${(dev.uplinks || []).map(u => `${u.interface}:${u.status}`).join(', ')}`);

  // 2) Configured connectivity-monitoring destinations for that network (the IPs the MX pings)
  let dst;
  try { dst = await mk.networkConnectivityDestinations({ networkId: dev.networkId }); }
  catch (e) { dst = { err: e.message }; }
  const destIps = (dst && dst.destinations || []).map(d => d.ip).filter(Boolean);
  console.log(`\n[2] connectivity-monitoring destinations: ${destIps.length ? destIps.join(', ') : JSON.stringify(dst)}`);

  // 3) Org-level recent loss/latency (the fallback source of a monitored IP)
  let ll;
  try { ll = await mk.orgUplinksLossLatency({}); } catch (e) { ll = { err: e.message }; }
  console.log(`\n[3] org uplinks loss/latency: ${Array.isArray(ll) ? `${ll.length} sample(s); first=${JSON.stringify(ll[0])}` : JSON.stringify(ll)}`);

  // 4) Loss/latency HISTORY for one uplink over the last 7 days (the actual metric source)
  const ip = destIps[0] || (Array.isArray(ll) && ll[0] && ll[0].ip);
  const up = dev.uplinks.find(u => /^wan\d$/.test(u.interface || ''));
  const t1 = new Date().toISOString(), t0 = new Date(Date.now() - 7 * 86400000).toISOString();
  console.log(`\n[4] history for ${dev.serial} ${up.interface} ip=${ip || '(none — THIS is why metrics are null)'} window=${t0}..${t1}`);
  if (!ip) { console.log('    → no destination IP available from [2] or [3]. Configure connectivity monitoring on the MX, or we add a fallback IP.'); return; }
  let h;
  try { h = await mk.deviceLossLatencyHistory({ serial: dev.serial, uplink: up.interface, ip, t0, t1, resolution: 3600 }); }
  catch (e) { h = { err: e.message }; }
  if (Array.isArray(h)) {
    console.log(`    → ${h.length} interval(s). first=${JSON.stringify(h[0]) || '(empty)'}`);
    console.log(h.length ? '    ✅ data IS present — if the dashboard is still blank the merge/derive step is the culprit.'
                         : '    ⚠ history is EMPTY for this ip/window — try a different destination IP, or resolution 60/600.');
  } else console.log(`    → ${JSON.stringify(h)}`);
})().catch(e => console.error('ERR', e.message));
