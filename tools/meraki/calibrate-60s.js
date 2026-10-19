'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// FINE-RESOLUTION calibration (DEV-ONLY). Reproduce Meraki's Summary Report "% Time Up"
// from the loss/latency history at 60s resolution, chunked into 1-day windows over the
// past week (60s isn't allowed on a 7d span in one call, but is on a 1d span). At 60s a
// fully-down minute (100% loss / absent) is caught — which the 600s/3600s averaging hides.
//
// Prints, per uplink, % Time Up under two denominators + the interval breakdown, next to
// the known targets (MANA wan1 84.72 / wan2 96.47 for the week). Key in ENV, never printed.
//   set MERAKI_API_KEY=...
//   set MERAKI_ORG_ID=595601050719773321
//   node tools/meraki/calibrate-60s.js
// Optional: MERAKI_CAL_TARGET=<serial> (default MANA), MERAKI_CAL_DAYS=7,
//           MERAKI_CAL_RES=60, MERAKI_CAL_DEST=8.8.8.8 (force the destination)
// ─────────────────────────────────────────────────────────────────────────────
const { makeMerakiClient } = require('../../services/merakiClient');

const DAYS = Number(process.env.MERAKI_CAL_DAYS || 7);
const RES = Number(process.env.MERAKI_CAL_RES || 60);
const TARGET_SERIAL = process.env.MERAKI_CAL_TARGET || 'Q2JN-DRWC-ZWK5'; // MANA-F/W-03
const KNOWN = { wan1: 84.72, wan2: 96.47 };
const DAY = 86400000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (ms) => new Date(ms).toISOString();
const f2 = (v) => (v == null ? '  —  ' : Number(v).toFixed(2).padStart(6));

async function history(client, args) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { const s = (await client.deviceLossLatencyHistory(args)) || []; await sleep(150); return s; }
    catch (e) { if (/HTTP 429/.test(e.message) && attempt < 2) { await sleep(1500); continue; } throw e; }
  }
  return [];
}

(async () => {
  const apiKey = process.env.MERAKI_API_KEY, orgId = process.env.MERAKI_ORG_ID;
  if (!apiKey || !orgId) { console.error('Set MERAKI_API_KEY and MERAKI_ORG_ID (numeric) in ENV first.'); process.exit(2); }
  const client = makeMerakiClient({ apiKey, orgId, baseUrl: process.env.MERAKI_BASE_URL });

  const statuses = (await client.orgUplinkStatuses()) || [];
  const tgt = statuses.find((d) => d.serial === TARGET_SERIAL);
  if (!tgt) { console.error(`target serial ${TARGET_SERIAL} not found.`); process.exit(1); }
  const nets = (await client.orgNetworks()) || [];
  const netName = (nets.find((n) => n.id === tgt.networkId) || {}).name || tgt.networkId;

  // Primary monitored destination (default = 8.8.8.8), overridable.
  let primary = process.env.MERAKI_CAL_DEST || null;
  if (!primary) {
    try {
      const cd = await client.networkConnectivityDestinations({ networkId: tgt.networkId });
      const ds = ((cd && cd.destinations) || []);
      primary = (ds.find((d) => d.default) || {}).ip || (ds.find((d) => d.ip === '8.8.8.8') ? '8.8.8.8' : (ds[0] || {}).ip) || '8.8.8.8';
    } catch { primary = '8.8.8.8'; }
  }

  const nowMs = Date.now();
  console.log(`\n=== FINE-RES (${RES}s) calibration — ${netName} (${TARGET_SERIAL}) — last ${DAYS}d, dest ${primary} ===`);
  console.log(`window: ${iso(nowMs - DAYS * DAY)} → now   (targets: wan1 ${KNOWN.wan1} · wan2 ${KNOWN.wan2})\n`);

  const uplinks = (tgt.uplinks || []).map((u) => u.interface).filter((x) => /^wan\d$/.test(x));
  for (const uplink of uplinks) {
    let expected = 0, present = 0, up = 0, loss100 = 0, chunkErr = 0;
    for (let d = 0; d < DAYS; d += 1) {
      const t1 = nowMs - d * DAY, t0 = t1 - DAY;
      expected += Math.round(DAY / 1000 / RES);
      try {
        const s = await history(client, { serial: tgt.serial, uplink, ip: primary, t0: iso(t0), t1: iso(t1), resolution: RES });
        for (const row of s) {
          const lp = row && row.lossPercent;
          if (lp == null) continue;
          present += 1;
          if (Number(lp) < 100) up += 1; else loss100 += 1;
        }
      } catch (e) { chunkErr += 1; }
    }
    const absent = Math.max(0, expected - present);
    const pctVsExpected = expected > 0 ? (100 * up / expected) : null;      // absent+loss100 = down (missing='down')
    const pctVsPresent = present > 0 ? (100 * up / present) : null;         // only responded intervals (missing='unknown')
    const tgtVal = KNOWN[uplink];
    console.log(`${uplink}:  % Time Up  vs-expected ${f2(pctVsExpected)}   vs-present ${f2(pctVsPresent)}   ⟵ Meraki target ${tgtVal != null ? tgtVal : '—'}`);
    console.log(`     intervals: expected ${expected} · present ${present} · up(loss<100) ${up} · loss=100% ${loss100} · absent ${absent}` + (chunkErr ? ` · ${chunkErr} day-chunk error(s)` : ''));
  }
  console.log('\nInterpretation: if "vs-expected" ≈ the Meraki target → 60s reproduces it (absent/100%-loss minutes = the outages).');
  console.log('Paste the whole output back (no key printed).');
  process.exit(0);
})().catch((e) => { console.error('fine-res calibration failed:', e.message); process.exit(1); });
