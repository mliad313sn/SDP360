'use strict';
// F-UX-06 — adoption report (vision §6.2 reach / workflow adoption), READ-ONLY.
//
//   node tools/pilot/adoption-report.js --from=2026-11-02 --to=2026-11-29 [--expected=docs/ops/pilot/FIRST-CLICK-SHEET.csv] [--out=FILE]
//
// Reads system_log category 'ux' (page_viewed, ux_export, ux_drill, ux_action_open, ux_action_done, ux_first_click)
// and prints: reach per role tier (distinct users), repeat use (users seen on ≥ 2 days), task events per kind, and the
// first-click-on-expected-page ratio per landing page — numerator / denominator always shown. A figure with no
// sample is UNKNOWN, never 0. The expected first clicks are a HUMAN input (decision D4, the CSV's `expected_page`
// column); without it the ratio is UNKNOWN. Users are counted, never listed; no name, e-mail or IP is read.
if (require.main === module) require('dotenv').config({ quiet: true, path: require('path').join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const path = require('path');

const KINDS = ['export', 'drill', 'action_open', 'action_done', 'first_click'];
const tierOf = (d) => { try { const o = typeof d === 'string' ? JSON.parse(d) : (d || {}); return o.tier || 'unknown'; } catch (_) { return 'unknown'; } };
const toOf = (d) => { try { const o = typeof d === 'string' ? JSON.parse(d) : (d || {}); return o.to || null; } catch (_) { return null; } };
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

/** expected: Map landing page → Set of acceptable first-click pages (from the CSV). */
function parseExpected(csv) {
  const m = new Map();
  const lines = String(csv || '').split(/\r?\n/).filter((l) => l.trim() && !/^\s*#/.test(l));
  if (!lines.length) return m;
  const head = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const iL = head.indexOf('landing_page'), iE = head.indexOf('expected_page');
  if (iL < 0 || iE < 0) return m;
  for (const l of lines.slice(1)) {
    const c = l.split(',').map((x) => x.trim().toLowerCase());
    if (!c[iL] || !c[iE] || c[iE] === 'unknown') continue;
    if (!m.has(c[iL])) m.set(c[iL], new Set());
    m.get(c[iL]).add(c[iE]);
  }
  return m;
}

/** rows: [{action, actor_id, target, details, ts}] → report object (pure). */
function adoption(rows, { expected = new Map() } = {}) {
  const reach = new Map(), days = new Map(), events = {};
  KINDS.forEach((k) => { events[k] = { events: 0, users: new Set() }; });
  const fc = new Map();   // landing page → { n, hit }
  for (const r of rows || []) {
    if (!r || r.actor_id == null) continue;
    const uid = String(r.actor_id), day = String(r.ts || '').slice(0, 10);
    if (r.action === 'page_viewed') {
      const t = tierOf(r.details);
      if (!reach.has(t)) reach.set(t, new Set()); reach.get(t).add(uid);
      if (!days.has(uid)) days.set(uid, new Set()); days.get(uid).add(day);
      continue;
    }
    const k = /^ux_(.+)$/.exec(r.action || ''); if (!k || !events[k[1]]) continue;
    events[k[1]].events++; events[k[1]].users.add(uid);
    if (k[1] === 'first_click') {
      const land = String(r.target || '');
      const exp = expected.get(land);
      if (!fc.has(land)) fc.set(land, { n: 0, hit: 0, known: !!exp });
      const f = fc.get(land); f.n++;
      if (exp && exp.has(String(toOf(r.details) || ''))) f.hit++;
    }
  }
  const users = days.size;
  const repeat = [...days.values()].filter((s) => s.size >= 2).length;
  return {
    reach: [...reach.entries()].map(([tier, s]) => ({ tier, users: s.size })).sort((a, b) => b.users - a.users || a.tier.localeCompare(b.tier)),
    users, repeat_users: users ? repeat : null, repeat_pct: pct(repeat, users),
    events: KINDS.map((k) => ({ kind: k, events: events[k].events, users: events[k].users.size })),
    first_click: [...fc.entries()].sort().map(([page, f]) => ({ page, clicks: f.n, on_expected: f.known ? f.hit : null, pct: f.known ? pct(f.hit, f.n) : null })),
  };
}

function render(rep, meta = {}) {
  const f = (v) => (v == null ? 'UNKNOWN' : String(v));
  const L = ['# Adoption report — observation (F-UX-06)', '',
    '> Read-only, from system_log. Users are counted, never listed. A missing sample reads UNKNOWN, never 0. No target is set here.', '',
    `- Window: ${meta.from || '?'} → ${meta.to || '?'} · users with a page view: ${rep.users} · repeat users (≥ 2 days): ${f(rep.repeat_users)} / ${rep.users} (${f(rep.repeat_pct)} %)`, '',
    '## Reach per role tier', '', '| Tier | Users |', '|---|---|', ...rep.reach.map((r) => `| ${r.tier} | ${r.users} |`), '',
    '## Task events', '', '| Kind | Events | Users |', '|---|---|---|', ...rep.events.map((e) => `| ${e.kind} | ${e.events} | ${e.users} |`), '',
    '## First click on the expected page (expected answers = human input, decision D4)', '', '| Landing page | First clicks | On expected | % |', '|---|---|---|---|',
    ...rep.first_click.map((x) => `| ${x.page} | ${x.clicks} | ${f(x.on_expected)} | ${f(x.pct)} |`), ''];
  return L.join('\n');
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const get = (k) => { const a = argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
  const from = get('from'), to = get('to');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) throw new Error('--from=YYYY-MM-DD and --to=YYYY-MM-DD are required');
  if (!env.PG_URL) throw new Error('PG_URL is not set (.env)');
  const expFile = get('expected');
  const expected = expFile && fs.existsSync(expFile) ? parseExpected(fs.readFileSync(expFile, 'utf8')) : new Map();
  const { Client } = require('pg'); const c = new Client({ connectionString: env.PG_URL }); await c.connect();
  try {
    await c.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    const r = await c.query(`SELECT action, actor_id, target, details, ts FROM system_log WHERE category = 'ux' AND substr(ts, 1, 10) BETWEEN $1 AND $2`, [from, to]);
    const md = render(adoption(r.rows, { expected }), { from, to });
    if (get('out')) fs.writeFileSync(path.resolve(get('out')), md); else process.stdout.write(md + '\n');
    return md;
  } finally { await c.end(); }
}

module.exports = { adoption, parseExpected, render, main, KINDS };
if (require.main === module) main().catch((e) => { console.error('[adoption-report] ' + e.message); process.exit(1); });
