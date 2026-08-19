'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// CIRCUIT-MAPPING helper (DEV-ONLY, read-only). Dumps, for every MX appliance in the org,
// the exact Meraki NETWORK NAME + serial + the device NOTES (which carry the ISP + bandwidth
// per uplink, e.g. "WAN 1 (ORANGE): 200Mbps") + each uplink's current status + public IP.
// This is the raw material to (a) fix the site↔Meraki-network seed and (b) build the WAN SLA
// circuits config (site_id/uplink/isp/tier/mrc/contact). Key in ENV, NEVER printed.
//   set MERAKI_API_KEY=...
//   set MERAKI_ORG_ID=595601050719773321
//   node tools/meraki/list-circuits.js
// ─────────────────────────────────────────────────────────────────────────────
const { makeMerakiClient } = require('../../services/merakiClient');

(async () => {
  const apiKey = process.env.MERAKI_API_KEY, orgId = process.env.MERAKI_ORG_ID;
  if (!apiKey || !orgId) { console.error('Set MERAKI_API_KEY and MERAKI_ORG_ID (numeric) in ENV first.'); process.exit(2); }
  const client = makeMerakiClient({ apiKey, orgId, baseUrl: process.env.MERAKI_BASE_URL });

  const nets = (await client.orgNetworks()) || [];
  const nameByNet = {}; for (const n of nets) nameByNet[n.id] = n.name;

  const statuses = (await client.orgUplinkStatuses()) || [];
  let devices = [];
  try { devices = (await client.orgDevices({ productTypes: ['appliance'] })) || []; } catch { devices = []; }
  const devBySerial = {}; for (const d of devices) devBySerial[d.serial] = d;

  console.log(`\n=== WAN circuits — org ${orgId} — ${statuses.length} appliance(s) ===`);
  console.log('For each appliance: NETWORK NAME (exact) · serial · device name · NOTES (ISP+bandwidth) · uplinks (status/ip)\n');

  const rows = statuses.map((s) => ({ s, net: nameByNet[s.networkId] || s.networkId, dev: devBySerial[s.serial] || {} }));
  rows.sort((a, b) => String(a.net).localeCompare(String(b.net)));

  for (const { s, net, dev } of rows) {
    const notes = (dev.notes || '').replace(/\s+/g, ' ').trim();
    const tags = Array.isArray(dev.tags) ? dev.tags.join(',') : (dev.tags || '');
    console.log(`NETWORK: "${net}"`);
    console.log(`   serial ${s.serial}  ·  name "${dev.name || ''}"  ·  model ${dev.model || s.model || ''}` + (tags ? `  ·  tags [${tags}]` : ''));
    console.log(`   NOTES: ${notes || '(empty)'}`);
    for (const u of (s.uplinks || [])) {
      if (!/^wan\d$/.test(u.interface || '')) continue;
      console.log(`   ${u.interface}: status=${u.status || '?'}  publicIp=${u.publicIp || u.ip || '?'}  gateway=${u.gateway || '?'}`);
    }
    console.log('');
  }
  console.log('Paste the whole output back (no key printed). NOTES + exact NETWORK names are the key part.');
  process.exit(0);
})().catch((e) => { console.error('list-circuits failed:', e.message); process.exit(1); });
