'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// QUALITY calibration (DEV-ONLY). Finds the threshold that makes our quality-weighted
// availability match Meraki's Summary Report "% Time Up". Pulls the loss/latency history at
// 60s (chunked into 1-day windows over the past week), merges monitored destinations (best-of),
// then computes qualityAvailability under several loss.bad candidates + the binary (loss<100),
// and prints them next to your Meraki target. Pick the loss.bad whose EFFECTIVE % lands on the
// Meraki number. API key in ENV, never printed.
//
//   set MERAKI_API_KEY=...
//   set MERAKI_ORG_ID=595601050719773321
//   node tools/meraki/calibrate-quality.js
//
// Optional:
//   MERAKI_CAL_NET="Sabodala"          substring of the network name to target (default: first MX)
//   MERAKI_CAL_TARGET=<serial>         force a device serial instead of resolving by network
//   MERAKI_CAL_UP="wan1:97.06,wan2:24.43"   your Meraki % Time Up targets, for side-by-side
//   MERAKI_CAL_DAYS=7  MERAKI_CAL_RES=60
// ─────────────────────────────────────────────────────────────────────────────
const { makeMerakiClient } = require('../../services/merakiClient');
const { mergeDestinationSeries, deriveAvailability, qualityAvailability } = require('../../services/merakiWanQuality');

const DAYS = Number(process.env.MERAKI_CAL_DAYS || 7);
const RES = Number(process.env.MERAKI_CAL_RES || 60);
const LOSS_BAD = [5, 8, 10, 15, 20, 30];   // candidate "h=0" loss thresholds (good fixed at 1%)
const DAY = 86400000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (ms) => new Date(ms).toISOString();
const f2 = (v) => (v == null ? '   —  ' : Number(v).toFixed(2).padStart(6));

function parseTargets() {
  const out = {};
  for (const part of String(process.env.MERAKI_CAL_UP || '').split(',')) {
    const m = part.trim().match(/^(wan\d)\s*[:=]\s*([\d.]+)$/i);
    if (m) out[m[1].toLowerCase()] = Number(m[2]);
  }
  return out;
}

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
  const nets = (await client.orgNetworks()) || [];
  const netName = (id) => (nets.find((n) => n.id === id) || {}).name || id;

  let tgt;
  if (process.env.MERAKI_CAL_TARGET) tgt = statuses.find((d) => d.serial === process.env.MERAKI_CAL_TARGET);
  else if (process.env.MERAKI_CAL_NET) {
    const q = process.env.MERAKI_CAL_NET.toLowerCase();
    tgt = statuses.find((d) => String(netName(d.networkId)).toLowerCase().includes(q));
  } else tgt = statuses[0];
  if (!tgt) { console.error('target device not found (check MERAKI_CAL_NET / MERAKI_CAL_TARGET).'); process.exit(1); }

  const destIps = await (async () => {
    if (process.env.MERAKI_CAL_DEST) return [process.env.MERAKI_CAL_DEST];
    try {
      const cd = await client.networkConnectivityDestinations({ networkId: tgt.networkId });
      const ds = (cd && cd.destinations) || [];
      const ips = ds.map((d) => d.ip).filter(Boolean);
      return ips.length ? ips : ['8.8.8.8'];
    } catch { return ['8.8.8.8']; }
  })();

  const targets = parseTargets();
  const nowMs = Date.now();
  console.log(`\n=== QUALITY calibration — ${netName(tgt.networkId)} (${tgt.serial}) — last ${DAYS}d @ ${RES}s — dests ${destIps.join(', ')} ===`);
  console.log(`window ${iso(nowMs - DAYS * DAY)} → now\n`);

  const uplinks = (tgt.uplinks || []).map((u) => u.interface).filter((x) => /^wan\d$/.test(x));
  for (const uplink of uplinks) {
    let merged = [], expected = 0, chunkErr = 0;
    for (let d = 0; d < DAYS; d += 1) {
      const t1 = nowMs - d * DAY, t0 = t1 - DAY;
      expected += Math.round(DAY / 1000 / RES);
      try {
        const seriesList = [];
        for (const ip of destIps) seriesList.push(await history(client, { serial: tgt.serial, uplink, ip, t0: iso(t0), t1: iso(t1), resolution: RES }));
        merged = merged.concat(mergeDestinationSeries(seriesList));
      } catch (e) { chunkErr += 1; }
    }
    const binary = deriveAvailability(merged, { totalIntervals: expected, missing: 'down' });
    const q0 = qualityAvailability(merged, { totalIntervals: expected, missing: 'down' });
    const tv = targets[uplink];

    console.log(`── ${uplink}  ${tv != null ? `⟵ Meraki % Time Up = ${tv}` : ''}`);
    console.log(`   present ${merged.length}/${expected} · loss avg ${f2(q0.loss_pct_avg)} max ${f2(q0.loss_pct_max)} · lat avg ${f2(q0.latency_ms_avg)} max ${f2(q0.latency_ms_max)}` + (chunkErr ? ` · ${chunkErr} chunk err` : ''));
    console.log(`   binary %TimeUp (loss<100): ${f2(binary.availability_pct)}`);
    const row = LOSS_BAD.map((bad) => {
      const q = qualityAvailability(merged, { totalIntervals: expected, missing: 'down', thresholds: { loss: { good: 1, bad } } });
      return `bad=${String(bad).padStart(2)}→${f2(q.effective_pct)}`;
    }).join('   ');
    console.log(`   effective %  ${row}`);
  }
  console.log(`\nPick the loss.bad whose "effective %" lands on your Meraki target for each uplink.`);
  console.log(`Paste the whole output back (no key is printed).`);
  process.exit(0);
})().catch((e) => { console.error('quality calibration failed:', e.message); process.exit(1); });
