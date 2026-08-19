'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Meraki "% Time Up" CALIBRATION harness (DEV-ONLY, run by the operator with their key).
//
// GOAL: reproduce Meraki's own Summary Report "% Time Up" from the loss/latency history,
// so WAN Health shows the FAITHFUL availability (not the raw loss<100 derivation), and so
// the ISP-chargeback figures reconcile with what Meraki shows.
//
// It does two things:
//   1) DETAILED block on one target appliance (default MANA), printing % Time Up under the
//      full matrix — [primary-dest-only vs merged-all-dest] × [missing=down vs unknown] ×
//      [resolutions] × [week 7d, month 30d] — RIGHT NEXT TO the known Meraki targets
//      (MANA I1 84.72/87.68, I2 96.47/97.86). The combo that matches = the policy to lock.
//   2) ALL-SITES summary: every MX × uplink, week & month, primary destination, so you get
//      the whole fleet in one run.
//
// The API key is read from the ENV, NEVER a CLI arg, and is NEVER printed. Paste back ONLY
// the printed table.
//
//   set MERAKI_API_KEY=...                 (your READ-ONLY key)
//   set MERAKI_ORG_ID=595601050719773321   (NUMERIC org id — from the dashboard footer
//                                            "organization ID: ...", NOT the o/Epcmqa6 shard)
//   node tools/meraki/calibrate.js
//
// Optional:
//   set MERAKI_BASE_URL=...                (default https://api.meraki.com/api/v1)
//   set MERAKI_CAL_TARGET=Q2JN-DRWC-ZWK5   (serial for the detailed block; default = MANA)
//   set MERAKI_CAL_ONLY=1                  (detailed block only — skip the all-sites sweep)
// ─────────────────────────────────────────────────────────────────────────────
const { makeMerakiClient } = require('../../services/merakiClient');
const { deriveAvailability, mergeDestinationSeries } = require('../../services/merakiWanQuality');

const WINDOWS = [
  { label: 'week',  timespan: 7 * 86400 },
  { label: 'month', timespan: 30 * 86400 },
];
// Resolutions to test in the detailed block (finer = closer to Meraki's own granularity).
// Meraki accepts 60/600/3600/86400; a big timespan rejects tiny resolutions, so we tolerate
// per-call failure. Week tests 600+3600; month tests 3600 (600 over 30d = too many points).
const RES_BY_WINDOW = { week: [3600, 600], month: [3600] };
const SUMMARY_RES = 3600;

// Known Meraki Summary Report targets for the default detailed target (MANA), read live from
// the dashboard on 2026-08-19 — the calibration oracle.
const KNOWN = {
  'Q2JN-DRWC-ZWK5': { name: 'MANA-F/W-03', wan1: { week: 84.72, month: 87.68 }, wan2: { week: 96.47, month: 97.86 } },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (v) => (v == null ? '  —  ' : String(v).padStart(6));

// One loss/latency history pull, throttled (~7/s, under Meraki's 10/s) + one 429 retry.
async function history(client, args) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const s = (await client.deviceLossLatencyHistory(args)) || [];
      await sleep(150);
      return s;
    } catch (e) {
      if (/HTTP 429/.test(e.message) && attempt < 2) { await sleep(1500); continue; }
      throw e;
    }
  }
  return [];
}

// Resolve the monitored destinations for a network (cached). Primary = the one flagged
// default, else 8.8.8.8 if present, else the first. Falls back to 8.8.8.8 on any failure.
const _destCache = new Map();
async function destsFor(client, networkId) {
  if (_destCache.has(networkId)) return _destCache.get(networkId);
  let dests = [];
  try {
    const cd = await client.networkConnectivityDestinations({ networkId });
    dests = ((cd && cd.destinations) || []).map((d) => ({ ip: d.ip, default: !!d.default })).filter((d) => d.ip);
  } catch { dests = []; }
  const ips = dests.map((d) => d.ip);
  let primary = (dests.find((d) => d.default) || {}).ip || (ips.includes('8.8.8.8') ? '8.8.8.8' : ips[0]) || '8.8.8.8';
  const out = { ips: ips.length ? ips : ['8.8.8.8'], primary };
  _destCache.set(networkId, out);
  return out;
}

// % Time Up for a given series set, both missing policies.
function derive(series, totalIntervals) {
  const d = deriveAvailability(series, { totalIntervals, missing: 'down' });
  const u = deriveAvailability(series, { totalIntervals, missing: 'unknown' });
  return { down: d.availability_pct, unknown: u.availability_pct, loss: d.loss_pct_avg, lat: d.latency_ms_avg, jit: d.jitter_ms_avg };
}

(async () => {
  const apiKey = process.env.MERAKI_API_KEY, orgId = process.env.MERAKI_ORG_ID;
  if (!apiKey || !orgId) {
    console.error('Set MERAKI_API_KEY and MERAKI_ORG_ID (numeric) in the environment first (never on the command line).');
    process.exit(2);
  }
  const client = makeMerakiClient({ apiKey, orgId, baseUrl: process.env.MERAKI_BASE_URL });
  const targetSerial = process.env.MERAKI_CAL_TARGET || 'Q2JN-DRWC-ZWK5';

  // Enumerate appliances (serial + networkId + uplinks) and network names.
  const nets = (await client.orgNetworks()) || [];
  const nameByNet = {}; for (const n of nets) nameByNet[n.id] = n.name;
  const statuses = (await client.orgUplinkStatuses()) || [];
  if (!Array.isArray(statuses) || !statuses.length) {
    console.error('No appliance uplink statuses returned — check the org id (numeric) and that the key can read this org.');
    process.exit(1);
  }
  console.log(`\n=== Meraki % Time Up calibration — org ${orgId} — ${statuses.length} appliance(s) ===`);
  console.log('Windows are ROLLING from now (week=7d, month=30d), matching the Summary Report display.\n');

  // ── 1) DETAILED calibration on the target appliance ──────────────────────────
  const tgt = statuses.find((d) => d.serial === targetSerial);
  if (!tgt) {
    console.log(`[detailed] target serial ${targetSerial} not found among appliances — skipping detailed block.\n`);
  } else {
    const known = KNOWN[targetSerial] || {};
    const { ips, primary } = await destsFor(client, tgt.networkId);
    console.log(`--- DETAILED: ${known.name || tgt.serial} (${tgt.serial}) — ${nameByNet[tgt.networkId] || tgt.networkId} ---`);
    console.log(`monitored destinations: ${ips.join(', ')}   (primary = ${primary})`);
    console.log('Each cell = % Time Up. Find the [primary|merged]×[down|unknown]×resolution combo that matches the Meraki target.\n');
    const uplinks = (tgt.uplinks || []).map((u) => u.interface).filter((x) => /^wan\d$/.test(x));
    for (const w of WINDOWS) {
      console.log(`  ${w.label.toUpperCase()} (${w.timespan / 86400}d):`);
      for (const res of RES_BY_WINDOW[w.label]) {
        const totalIntervals = Math.max(1, Math.round(w.timespan / res));
        console.log(`    resolution ${res}s (${totalIntervals} intervals):`);
        for (const uplink of uplinks) {
          try {
            // fetch each destination once, derive primary-only and merged from the same data
            const byIp = {};
            for (const ip of ips) byIp[ip] = await history(client, { serial: tgt.serial, uplink, ip, timespan: w.timespan, resolution: res });
            const prim = derive(byIp[primary] || [], totalIntervals);
            const merged = derive(mergeDestinationSeries(Object.values(byIp)), totalIntervals);
            const tgtVal = known[uplink] && known[uplink][w.label];
            console.log(
              `      ${uplink}  primary[down ${fmt(prim.down)} · unk ${fmt(prim.unknown)}]  ` +
              `merged[down ${fmt(merged.down)} · unk ${fmt(merged.unknown)}]` +
              (tgtVal != null ? `   ⟵ Meraki target ${tgtVal}` : '')
            );
          } catch (e) {
            console.log(`      ${uplink}  (resolution ${res}s not available: ${e.message})`);
          }
        }
      }
    }
    console.log('');
  }

  if (process.env.MERAKI_CAL_ONLY) { console.log('[MERAKI_CAL_ONLY set — skipping all-sites sweep]'); process.exit(0); }

  // ── 2) ALL-SITES sweep (primary destination, one resolution) ─────────────────
  console.log(`--- ALL SITES (primary dest, resolution ${SUMMARY_RES}s, week & month) ---`);
  console.log('Site (network)                         uplink   week down/unk    month down/unk   loss%  lat/jit');
  const rows = [];
  for (const dev of statuses) {
    const site = (nameByNet[dev.networkId] || dev.networkId || '').slice(0, 36).padEnd(36);
    const { primary } = await destsFor(client, dev.networkId);
    const uplinks = (dev.uplinks || []).map((u) => u.interface).filter((x) => /^wan\d$/.test(x));
    for (const uplink of uplinks) {
      const cell = {};
      for (const w of WINDOWS) {
        const totalIntervals = Math.max(1, Math.round(w.timespan / SUMMARY_RES));
        try {
          const s = await history(client, { serial: dev.serial, uplink, ip: primary, timespan: w.timespan, resolution: SUMMARY_RES });
          cell[w.label] = derive(s, totalIntervals);
        } catch (e) { cell[w.label] = { err: e.message }; }
      }
      const wk = cell.week || {}, mo = cell.month || {};
      const line =
        `${site} ${uplink}   ` +
        `${fmt(wk.down)}/${fmt(wk.unknown)}   ${fmt(mo.down)}/${fmt(mo.unknown)}   ` +
        `${fmt(wk.loss)}  ${fmt(wk.lat)}/${fmt(wk.jit)}`;
      console.log(line);
      rows.push(line);
    }
  }
  console.log(`\nDone — ${rows.length} uplink rows. Paste the whole output back (no key was printed).`);
  process.exit(0);
})().catch((e) => { console.error('calibration failed:', e.message); process.exit(1); });
