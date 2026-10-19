'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Meraki "% Time Up" — SUPERVISED calibration harness (DEV-ONLY, run by the operator).
//
// What it does
//   1. Reads the ground truth the operator transcribed from the Meraki UI
//      (tools/meraki/calibration/timeup-groundtruth.csv — one row per site × uplink ×
//      window with Meraki's "% Time Up").
//   2. For each row, fetches the RAW loss/latency series for that exact rolling window
//      (ending at the row's "Captured At") for every monitored destination, and ARCHIVES
//      it under tools/meraki/calibration/series/ — Meraki only keeps 31 days, so the
//      archive is what makes the calibration repeatable later.
//   3. Runs the grid search (services/wanTimeUpCalibration.js) over the rule family
//      lossDownPct × latencyDownMs × missing-policy × destination-mode and prints the
//      combination that best reproduces Meraki, with per-point residuals and an
//      identifiability verdict.
//
// The API key is read from the ENV, NEVER a CLI arg, and is NEVER printed.
//
//   set MERAKI_API_KEY=...                  (READ-ONLY key)
//   set MERAKI_ORG_ID=595601050719773321    (numeric org id)
//   node tools/meraki/calibrate-timeup.js [--truth file.csv] [--captured 2026-09-04T12:00:00Z]
//                                         [--offline] [--map "Site=SERIAL,Site2=SERIAL2"]
//
//   --captured  fallback capture instant for rows whose "Captured At" column is empty
//   --offline   do not call Meraki — score the archived series only (re-run the grid)
//   --map       force the site → appliance serial mapping when the automatic network-name
//               match picks the wrong device (the chosen mapping is always printed)
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const { makeMerakiClient } = require('../../services/merakiClient');
const { mergeDestinationSeries } = require('../../services/merakiWanQuality');
const cal = require('../../services/wanTimeUpCalibration');

const ROOT = path.join(__dirname, 'calibration');
const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const TRUTH = argOf('--truth', path.join(ROOT, 'timeup-groundtruth.csv'));
const CAPTURED_DEFAULT = argOf('--captured', null);
const OFFLINE = args.includes('--offline');
const ARCHIVE = path.join(ROOT, 'series');
const forcedMap = {};
for (const kv of String(argOf('--map', '')).split(',').filter(Boolean)) { const [s, ser] = kv.split('='); if (s && ser) forcedMap[s.trim().toLowerCase()] = ser.trim(); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const fmt = (v, w = 7) => (v == null ? '—' : String(v)).padStart(w);

// Throttled history pull (~7/s) + 429 retry, like calibrate.js.
async function history(client, params) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { const s = (await client.deviceLossLatencyHistory(params)) || []; await sleep(150); return s; }
    catch (e) { if (/HTTP 429/.test(e.message) && attempt < 2) { await sleep(1500); continue; } throw e; }
  }
  return [];
}

// site name (as typed in the CSV) → appliance {serial, networkId, name}. Automatic match =
// the network whose folded name contains the folded site token; when several match, prefer
// names containing "gold"/"operations" (the mine network) then "office"; always printed.
function resolveDevices(rows, statuses, nameByNet) {
  const out = {};
  const sites = [...new Set(rows.map(r => r.site))];
  for (const site of sites) {
    const key = fold(site);
    if (forcedMap[key]) {
      const d = statuses.find(x => x.serial === forcedMap[key]);
      out[site] = d ? { serial: d.serial, networkId: d.networkId, name: nameByNet[d.networkId] || d.networkId, how: 'forced' } : null;
      continue;
    }
    const cands = statuses.filter(d => fold(nameByNet[d.networkId]).includes(key));
    const rank = (d) => { const n = fold(nameByNet[d.networkId]); return (/gold|operations/.test(n) ? 0 : /office/.test(n) ? 1 : 2); };
    cands.sort((a, b) => rank(a) - rank(b));
    const d = cands[0];
    out[site] = d ? { serial: d.serial, networkId: d.networkId, name: nameByNet[d.networkId] || d.networkId, how: cands.length > 1 ? `auto (${cands.length} candidates)` : 'auto' } : null;
  }
  return out;
}

const _destCache = new Map();
async function destsFor(client, networkId) {
  if (_destCache.has(networkId)) return _destCache.get(networkId);
  let dests = [];
  try { const cd = await client.networkConnectivityDestinations({ networkId }); dests = ((cd && cd.destinations) || []).map(d => ({ ip: d.ip, default: !!d.default })).filter(d => d.ip); } catch { dests = []; }
  const ips = dests.map(d => d.ip);
  const primary = (dests.find(d => d.default) || {}).ip || (ips.includes('8.8.8.8') ? '8.8.8.8' : ips[0]) || '8.8.8.8';
  const out = { ips: ips.length ? ips : ['8.8.8.8'], primary };
  _destCache.set(networkId, out);
  return out;
}

function archivePath(row, win) {
  const safe = (s) => String(s).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  return path.join(ARCHIVE, `${safe(row.site)}_${row.uplink}_${win.window}_${win.t1}.json`);
}

(async () => {
  const text = fs.readFileSync(TRUTH, 'utf8');
  const rows = cal.parseGroundTruthCsv(text);
  if (!rows.length) { console.error(`no readable rows in ${TRUTH}`); process.exit(2); }
  const missingCap = rows.filter(r => !r.capturedAt && !CAPTURED_DEFAULT);
  if (missingCap.length) { console.error(`${missingCap.length} row(s) have no "Captured At" and no --captured fallback — windows are rolling from the capture instant, so this is required.`); process.exit(2); }
  console.log(`\n=== Meraki % Time Up — supervised calibration — ${rows.length} ground-truth points ===`);

  let client = null, statuses = [], nameByNet = {};
  if (!OFFLINE) {
    const apiKey = process.env.MERAKI_API_KEY, orgId = process.env.MERAKI_ORG_ID;
    if (!apiKey || !orgId) { console.error('Set MERAKI_API_KEY and MERAKI_ORG_ID in the environment (never on the command line), or use --offline.'); process.exit(2); }
    client = makeMerakiClient({ apiKey, orgId, baseUrl: process.env.MERAKI_BASE_URL });
    const nets = (await client.orgNetworks()) || [];
    for (const n of nets) nameByNet[n.id] = n.name;
    statuses = (await client.orgUplinkStatuses()) || [];
    if (!statuses.length) { console.error('No appliance uplink statuses returned — check the org id and key.'); process.exit(1); }
  }
  const devices = OFFLINE ? {} : resolveDevices(rows, statuses, nameByNet);
  if (!OFFLINE) {
    console.log('\nSite → appliance mapping (override with --map "Site=SERIAL" if wrong):');
    for (const [site, d] of Object.entries(devices)) console.log(`  ${site.padEnd(14)} → ${d ? `${d.serial}  ${d.name}  [${d.how}]` : 'NOT FOUND'}`);
  }
  fs.mkdirSync(ARCHIVE, { recursive: true });

  // ── fetch (or load) the series per point ─────────────────────────────────
  const points = [];
  let fetched = 0, loaded = 0, skipped = 0;
  for (const row of rows) {
    const win = cal.windowFor(row.window, row.capturedAt || CAPTURED_DEFAULT);
    const file = archivePath(row, win);
    let rec = null;
    if (fs.existsSync(file)) { rec = JSON.parse(fs.readFileSync(file, 'utf8')); loaded++; }
    else if (!OFFLINE) {
      const dev = devices[row.site];
      if (!dev) { skipped++; continue; }
      const { ips, primary } = await destsFor(client, dev.networkId);
      const byIp = {};
      for (const ip of ips) {
        try { byIp[ip] = await history(client, { serial: dev.serial, uplink: row.uplink, ip, t0: win.t0, t1: win.t1, resolution: win.resolution }); }
        catch (e) { byIp[ip] = { error: e.message }; }
      }
      rec = { meta: { site: row.site, serial: dev.serial, network: dev.name, uplink: row.uplink, window: win, primary, target: row.target, ui: { loss: row.loss, latency: row.latency, jitter: row.jitter } }, byIp };
      fs.writeFileSync(file, JSON.stringify(rec));
      fetched++;
    } else { skipped++; continue; }
    const primary = rec.meta.primary;
    const ok = Object.entries(rec.byIp).filter(([, s]) => Array.isArray(s)).map(([, s]) => s);
    points.push({
      key: `${row.site} ${row.uplink} ${row.window}`.padEnd(24),
      target: row.target,
      totalIntervals: win.totalIntervals,
      series: { primary: Array.isArray(rec.byIp[primary]) ? rec.byIp[primary] : (ok[0] || []), merged: mergeDestinationSeries(ok) },
      samples: (Array.isArray(rec.byIp[primary]) ? rec.byIp[primary] : (ok[0] || [])).length,
    });
  }
  console.log(`\nseries: ${fetched} fetched, ${loaded} loaded from archive, ${skipped} skipped   (archive: ${path.relative(process.cwd(), ARCHIVE)})`);

  // ── grid ──────────────────────────────────────────────────────────────────
  const { combos, best, note } = cal.gridSearch(points);
  if (!best) { console.log('nothing to score.'); process.exit(1); }
  const current = combos.find(c => c.lossCap === 100 && c.latencyCap == null && c.missing === 'down' && c.dest === 'merged');
  console.log('\n--- TOP 12 rules (lower MAE = closer to Meraki) ---');
  console.log('  dest     missing  loss>=  lat>    n   MAE    max');
  for (const c of combos.slice(0, 12)) console.log(`  ${c.dest.padEnd(8)} ${c.missing.padEnd(8)} ${fmt(c.lossCap, 6)}  ${fmt(c.latencyCap == null ? 'none' : c.latencyCap, 5)}  ${fmt(c.n, 3)}  ${fmt(c.mae, 5)}  ${fmt(c.maxAbs, 5)}`);
  if (current) console.log(`\n  current production rule (loss<100, merged, missing=down):  MAE ${current.mae}  max ${current.maxAbs}`);
  console.log(`\n  identifiability: ${note}`);

  console.log(`\n--- BEST rule residuals: dest=${best.dest} missing=${best.missing} loss>=${best.lossCap} lat>${best.latencyCap == null ? 'none' : best.latencyCap} ---`);
  console.log('  point                     samples  Meraki  derived   err');
  for (const r of best.residuals) {
    const p = points.find(x => x.key === r.key);
    console.log(`  ${r.key}  ${fmt(p ? p.samples : '—', 6)}  ${fmt(r.target, 6)}  ${fmt(r.derived, 7)}  ${fmt(r.err, 6)}`);
  }
  // Per-window best (resolutions differ: day 60s / week 600s / month 3600s).
  console.log('\n--- best rule per window ---');
  for (const w of ['day', 'week', 'month']) {
    const sub = points.filter(p => p.key.trim().endsWith(' ' + w));
    if (!sub.length) continue;
    const g = cal.gridSearch(sub);
    if (g.best) console.log(`  ${w.padEnd(6)} n=${g.best.n}  dest=${g.best.dest} missing=${g.best.missing} loss>=${g.best.lossCap} lat>${g.best.latencyCap == null ? 'none' : g.best.latencyCap}  MAE ${g.best.mae}  max ${g.best.maxAbs}   (${g.note})`);
  }
  console.log('\nDone — paste this output back (no key was printed). Re-run the grid any time with --offline.');
  process.exit(0);
})().catch((e) => { console.error('calibration failed:', e.message); process.exit(1); });
