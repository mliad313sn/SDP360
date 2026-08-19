'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// EVENT-LOG calibration (DEV-ONLY). Pulls the appliance event log for the MANA network
// over the past week, DISCOVERS the uplink up/down event vocabulary of THIS org (the key
// unknown), pairs down→up into outages, computes an event-based % Time Up (24/7, plain —
// matching how Meraki's Summary Report shows it), and compares to the known targets
// (MANA wan1 84.72 / wan2 96.47 for the week).
//
// It PRINTS: (1) the raw `type` histogram, (2) the raw uplink-looking events (so we can
// read the exact strings + structure and set `event_types` in config correctly), (3) the
// paired outages + event-based % Time Up per uplink vs target.
//
// Key in ENV, NEVER printed. Paste back the whole output.
//   set MERAKI_API_KEY=...
//   set MERAKI_ORG_ID=595601050719773321
//   node tools/meraki/calibrate-events.js
// Optional: MERAKI_CAL_TARGET=<serial> (default MANA), MERAKI_CAL_DAYS=7, MERAKI_EV_PAGES=40
// ─────────────────────────────────────────────────────────────────────────────
const { makeMerakiClient, fetchAllNetworkEvents } = require('../../services/merakiClient');

const DAYS = Number(process.env.MERAKI_CAL_DAYS || 7);
const MAXPAGES = Number(process.env.MERAKI_EV_PAGES || 40);
const TARGET_SERIAL = process.env.MERAKI_CAL_TARGET || 'Q2JN-DRWC-ZWK5'; // MANA-F/W-03
const KNOWN = { wan1: 84.72, wan2: 96.47 };                              // week targets

const _toMs = (t) => { const n = Date.parse(t); return Number.isFinite(n) ? n : null; };

// Heuristic classification (we don't yet know this org's exact strings — that's the point).
function classify(ev) {
  const type = String(ev.type || '');
  const desc = String(ev.description || '');
  const ed = ev.eventData || {};
  const hay = `${type} ${desc} ${JSON.stringify(ed)}`.toLowerCase();
  let uplink = null;
  const m = hay.match(/wan[\s_]*([12])/) || hay.match(/uplink[\s_]*([12])/) || hay.match(/internet[\s_]*([12])/);
  if (m) uplink = `wan${m[1]}`;
  else {
    const iface = String(ed.interface || ed.uplink || '').toLowerCase();
    const im = iface.match(/(\d)/);
    if (/wan/.test(iface) && im) uplink = `wan${im[1]}`;
  }
  let dir = null;
  if (/_down$/.test(type)) dir = 'down';                 // precise: wan_1_down style
  else if (/_up$/.test(type)) dir = 'up';                // precise: wan_1_up style
  else {
    // "changed from <old> to <new>" — the NEW (arrival) state decides direction.
    const ft = hay.match(/from\s+([a-z ]+?)\s+to\s+([a-z ]+)/);
    if (ft) {
      const nw = ft[2];
      if (/(ready|active|\bup\b|connected|online|reachable)/.test(nw)) dir = 'up';
      else if (/(failed|\bdown\b|dead|disconnect|unreachable|inactive|offline|not connected)/.test(nw)) dir = 'down';
    }
    if (!dir) {                                          // keyword fallback (no explicit transition)
      if (/(is up|back up|restored|regained|able to reach|now reachable)/.test(hay)) dir = 'up';
      else if (/(no longer|not able|unreachable|is down|went down|failed|disconnect|offline|lost connectivity|dead)/.test(hay)) dir = 'down';
    }
  }
  return { uplink, dir };
}

function pair(evs) {           // evs sorted asc by ms, one uplink
  const outages = []; let open = null;
  for (const e of evs) {
    if (e.dir === 'down') { if (open == null) open = e; }
    else if (e.dir === 'up' && open != null) { outages.push({ start: open.ms, end: e.ms }); open = null; }
  }
  if (open != null) outages.push({ start: open.ms, end: null });
  return outages;
}

(async () => {
  const apiKey = process.env.MERAKI_API_KEY, orgId = process.env.MERAKI_ORG_ID;
  if (!apiKey || !orgId) { console.error('Set MERAKI_API_KEY and MERAKI_ORG_ID (numeric) in ENV first.'); process.exit(2); }
  const client = makeMerakiClient({ apiKey, orgId, baseUrl: process.env.MERAKI_BASE_URL });

  const statuses = (await client.orgUplinkStatuses()) || [];
  const tgt = statuses.find((d) => d.serial === TARGET_SERIAL);
  if (!tgt) { console.error(`target serial ${TARGET_SERIAL} not found among appliances.`); process.exit(1); }
  const networkId = tgt.networkId;
  const nets = (await client.orgNetworks()) || [];
  const netName = (nets.find((n) => n.id === networkId) || {}).name || networkId;

  const nowMs = Date.now();
  const startMs = nowMs - DAYS * 86400000;
  const sinceIso = new Date(startMs).toISOString();
  const windowSec = (nowMs - startMs) / 1000;
  console.log(`\n=== EVENT-LOG calibration — ${netName} (${TARGET_SERIAL}) — last ${DAYS}d ===`);
  console.log(`window: ${sinceIso} → now   (targets: wan1 ${KNOWN.wan1} · wan2 ${KNOWN.wan2})\n`);

  const all = await fetchAllNetworkEvents(client, { networkId, productType: 'appliance', since: sinceIso }, MAXPAGES);
  if (!all.length) { console.log('No appliance events returned (check productType support / network id).'); process.exit(0); }

  const times = all.map((e) => _toMs(e.occurredAt)).filter((x) => x != null).sort((a, b) => a - b);
  const oldest = times[0], newest = times[times.length - 1];
  const truncated = oldest != null && oldest > startMs + 3600000; // oldest pulled is >1h after window start
  console.log(`pulled ${all.length} appliance events; coverage ${new Date(oldest).toISOString()} → ${new Date(newest).toISOString()}` +
    (truncated ? `  ⚠ TRUNCATED (raise MERAKI_EV_PAGES; % is a lower bound on downtime)` : ''));

  // (1) type histogram
  const hist = {};
  for (const e of all) hist[e.type || '(none)'] = (hist[e.type || '(none)'] || 0) + 1;
  console.log('\n--- event TYPE histogram (all appliance events in window) ---');
  Object.entries(hist).sort((a, b) => b[1] - a[1]).forEach(([t, n]) => console.log(`  ${String(n).padStart(6)}  ${t}`));

  // (2) uplink-looking events (raw) — so we read the exact vocabulary + structure
  const uplinkEvs = [];
  for (const e of all) {
    const c = classify(e);
    if (c.uplink || c.dir || /uplink|wan|failover|connectivity|dhcp lease|vpn/i.test(`${e.type} ${e.description}`)) {
      uplinkEvs.push({ e, c });
    }
  }
  console.log(`\n--- uplink-looking events (raw, first 60 of ${uplinkEvs.length}) ---`);
  uplinkEvs.slice(0, 60).forEach(({ e, c }) => {
    console.log(`  ${e.occurredAt}  [${c.uplink || '?'}/${c.dir || '?'}]  type="${e.type}"  desc="${(e.description || '').slice(0, 90)}"  data=${JSON.stringify(e.eventData || {}).slice(0, 120)}`);
  });

  // (3) pair + event-based % Time Up per uplink
  console.log('\n--- event-based % Time Up (paired down→up, clamped to window, 24/7) ---');
  for (const uplink of ['wan1', 'wan2']) {
    const evs = uplinkEvs
      .map(({ e, c }) => ({ ...c, ms: _toMs(e.occurredAt), occurredAt: e.occurredAt }))
      .filter((x) => x.uplink === uplink && x.dir && x.ms != null)
      .sort((a, b) => a.ms - b.ms);
    if (!evs.length) { console.log(`  ${uplink}: no classified up/down events — see raw dump above to set the vocabulary.`); continue; }
    const outages = pair(evs);
    let downSec = 0;
    const clamped = outages.map((o) => {
      const s = Math.max(o.start, startMs), e = Math.min(o.end == null ? nowMs : o.end, nowMs);
      const d = Math.max(0, (e - s) / 1000); downSec += d;
      return { start: new Date(Math.max(o.start, startMs)).toISOString(), end: o.end == null ? '(open)' : new Date(o.end).toISOString(), mins: Math.round(d / 60) };
    });
    const pct = Math.max(0, Math.min(100, 100 * (windowSec - downSec) / windowSec));
    console.log(`  ${uplink}: ${outages.length} outage(s), ${Math.round(downSec / 60)} min down → event-based % Time Up = ${pct.toFixed(2)}   ⟵ Meraki target ${KNOWN[uplink]}`);
    clamped.slice(0, 12).forEach((o) => console.log(`       ${o.start} → ${o.end}   (${o.mins} min)`));
  }
  console.log('\nDone. Paste the whole output back (no key printed). The TYPE histogram + raw dump are the key part.');
  process.exit(0);
})().catch((e) => { console.error('event calibration failed:', e.message); process.exit(1); });
