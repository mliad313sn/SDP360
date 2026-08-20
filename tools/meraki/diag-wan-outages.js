'use strict';
// READ-ONLY diagnostic for the WAN Health "why is availability low / symmetric" question.
// Reads wan_outages for the live window and prints, per (site, sub_site, uplink): availability
// (all-attributions), total down-time, row/open counts, and the attribution mix — plus any
// detected_start minute shared by >=3 rows (a "batch-open" artifact signal, e.g. a transient
// Meraki API blip that reported many uplinks down at one poll). Never prints the DB URL.
//
// Run on the box where the poller writes (prod): `node tools/meraki/diag-wan-outages.js`
// Optional first arg = window days (default 7). Postgres only (reads PG_URL from .env or env).
const fs = require('fs'), path = require('path');
function pgUrl() {
  if (process.env.PG_URL) return process.env.PG_URL;
  try {
    const env = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
    const m = env.match(/^\s*PG_URL\s*=\s*(.+?)\s*$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch (_) {}
  return null;
}
(async () => {
  const url = pgUrl();
  if (!url) { console.log('No PG_URL (env or .env) — this diagnostic is postgres-only.'); process.exit(0); }
  const days = Math.max(1, parseInt(process.argv[2], 10) || 7);
  const { Client } = require('pg');
  const c = new Client({ connectionString: url });
  await c.connect();
  const now = Date.now(), win = days * 86400000;
  const from = new Date(now - win).toISOString(), to = new Date(now).toISOString();
  const r = await c.query(
    `SELECT site_id, sub_site, uplink, detected_start, restored_end, duration_s, attribution, source
     FROM wan_outages WHERE detected_start<=$1 AND (restored_end IS NULL OR restored_end>=$2)
     ORDER BY site_id, uplink, detected_start`, [to, from]);
  const agg = {}, startCounts = {};
  for (const o of r.rows) {
    const k = o.site_id + '|' + (o.sub_site || '') + '|' + o.uplink;
    const s = Math.max(Date.parse(o.detected_start), Date.parse(from));
    const e = Math.min(o.restored_end ? Date.parse(o.restored_end) : now, now);
    (agg[k] = agg[k] || { down: 0, n: 0, open: 0, attrs: {} });
    agg[k].down += Math.max(0, e - s); agg[k].n++;
    if (!o.restored_end) agg[k].open++;
    const a = o.attribution || 'null'; agg[k].attrs[a] = (agg[k].attrs[a] || 0) + 1;
    const ds = String(o.detected_start).slice(0, 16); startCounts[ds] = (startCounts[ds] || 0) + 1;
  }
  console.log(`window: last ${days}d — ${r.rows.length} outage rows\n`);
  console.log('per (site|sub|uplink): availability(all-attr) · down(h) · rows · open · attributions');
  Object.keys(agg).sort().forEach(k => {
    const a = agg[k];
    console.log('  ' + k.padEnd(20), 'av=' + (100 * (1 - a.down / win)).toFixed(1) + '%',
      'down=' + (a.down / 3600000).toFixed(1) + 'h', 'rows=' + a.n, 'open=' + a.open, JSON.stringify(a.attrs));
  });
  const shared = Object.entries(startCounts).filter(([, n]) => n >= 3).sort((x, y) => y[1] - x[1]);
  console.log('\ndetected_start minutes shared by >=3 rows (batch-open artifact signal):');
  console.log(shared.length ? shared.map(([t, n]) => '  ' + t + ' -> ' + n + ' rows').join('\n') : '  (none — no batch-open pattern)');
  await c.end();
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
