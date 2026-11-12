'use strict';
// Standalone runs must read the app's .env BEFORE any app module loads (PG_URL lives there).
if (require.main === module) require('dotenv').config({ quiet: true, path: require('path').join(__dirname, '..', '..', '.env') });
// B-07 — D-13 decision pack. A READ-ONLY dry run of every report (R01–R16) and automation rule (A01–A16)
// of the catalogue (services/reportCatalogue.js), plus the scheduled senders that carry no catalogue id.
// For each one it prints, as Markdown for the decision meeting: the switch states, the recipients the
// REAL sender would use today (confirmed-only, from the directory and report_config), what fired over the
// last N days, and the decision still open.
//
// It sends nothing and changes nothing: every query runs inside one `BEGIN READ ONLY` transaction that is
// rolled back, no sender module is called, and secret-shaped values are never decrypted or printed.
//
// Usage: node tools/reports/catalogue-dry-run.js [--days=30] [--out=decision-pack.md] [--json]

const fs = require('fs');

function parseArgs(argv) {
  const out = { days: 30, out: null, json: false };
  for (const a of argv || []) {
    if (a === '--json') out.json = true;
    else if (a.startsWith('--days=')) { const n = parseInt(a.slice(7), 10); if (Number.isFinite(n) && n >= 1 && n <= 366) out.days = n; }
    else if (a.startsWith('--out=')) out.out = a.slice(6) || null;
  }
  return out;
}

// One failing table (an older database, a module never migrated) must not sink the pack: each read is
// isolated and its error is reported next to the item it feeds.
async function gather(query, { days, now = new Date() }) {
  const since = new Date(now.getTime() - days * 86400000).toISOString();
  const errors = {};
  const safe = async (name, sql, params, fallback) => {
    try { return await query(sql, params || []); } catch (e) { errors[name] = String((e && e.message) || e).slice(0, 80); return fallback; }
  };
  const stored = await safe('config', 'SELECT key, value FROM report_config', [], []);
  const directory = await safe('directory', 'SELECT * FROM report_recipients ORDER BY site_code', [], []);
  const digestUsers = (await safe('digest', `SELECT DISTINCT s.digest, u.id, COALESCE(u.full_name, u.username) AS name, u.email
      FROM subscriptions s LEFT JOIN users u ON u.id = s.user_id WHERE s.digest IN ('daily', 'weekly') ORDER BY 3`, [], []))
    .map((r) => ({ digest: r.digest, name: r.name || `user #${r.id}`, email: r.email || null }));
  const alertRules = (await safe('alert_rules', 'SELECT key, channels FROM alert_rules WHERE enabled = 1 ORDER BY key', [], []))
    .map((r) => { let ch = ['inapp']; try { const p = JSON.parse(r.channels || '[]'); if (Array.isArray(p) && p.length) ch = p; } catch (_) { /* keep in-app */ } return { key: r.key, channels: ch }; });
  const history = {
    sent_log: await safe('sent_log', `SELECT report_type, result, COUNT(*)::int AS n FROM report_sent_log
      WHERE sent_at >= $1::timestamptz GROUP BY report_type, result ORDER BY report_type, result`, [since], []),
    sync_errors: await safe('sync', `SELECT job, COUNT(*)::int AS n FROM sync_runs WHERE status = 'error' AND started_at >= $1
      GROUP BY job ORDER BY job`, [since], []),
    sync_alerts: await safe('sync', `SELECT job AS key, updated_at FROM sync_watermarks WHERE job LIKE 'alert:%'
      AND value IS NOT NULL AND updated_at >= $1 ORDER BY job`, [since], []),
    publish_runs: await safe('runs', `SELECT status, COUNT(*)::int AS n FROM sync_runs WHERE job = 'publish.connectors' AND started_at >= $1
      GROUP BY status ORDER BY status`, [since], []),
    report_runs: await safe('runs', `SELECT status, COUNT(*)::int AS n FROM report_runs WHERE created_at >= $1
      GROUP BY status ORDER BY status`, [since], []),
    notifications: ((await safe('notifications', 'SELECT COUNT(*)::int AS n FROM notifications WHERE created_at >= $1', [since], []))[0] || {}).n ?? null,
    alert_firings: ((await safe('notifications', 'SELECT COUNT(*)::int AS n FROM alert_firings WHERE fired_at >= $1', [since], []))[0] || {}).n ?? null,
    escalations: await safe('escalations', `SELECT kind, COUNT(*)::int AS n, SUM(CASE WHEN cleared_at IS NULL THEN 1 ELSE 0 END)::int AS open
      FROM commitment_escalations WHERE last_seen_at >= $1 GROUP BY kind ORDER BY kind`, [since], []),
    sla_alerts: await safe('sla', `SELECT kind, COUNT(*)::int AS n FROM sla_alert_log WHERE sent_at >= $1::timestamptz
      GROUP BY kind ORDER BY kind`, [since], []),
    errors,
  };
  return { stored, directory, digestUsers, alertRules, history, since };
}

// A pg client inside ONE read-only transaction; each statement under its own savepoint so a missing table
// does not abort the reads that follow. The transaction is always rolled back.
async function readOnlySession(url) {
  const { Client } = require('pg');
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query('BEGIN READ ONLY');
  let n = 0;
  const query = async (sql, params) => {
    const sp = `dryrun_${++n}`;
    await c.query(`SAVEPOINT ${sp}`);
    try { const r = await c.query(sql, params); await c.query(`RELEASE SAVEPOINT ${sp}`); return r.rows; }
    catch (e) { await c.query(`ROLLBACK TO SAVEPOINT ${sp}`); throw e; }
  };
  const close = async () => { try { await c.query('ROLLBACK'); } finally { await c.end(); } };
  return { query, close };
}

async function main(deps = {}) {
  const args = deps.args || parseArgs(process.argv.slice(2));
  const now = deps.now || new Date();
  const C = require('../../services/reportCatalogue');
  const { DEFAULTS } = require('../../services/reportConfig');
  let session = null, query = deps.query;
  if (!query) {
    const url = deps.pgUrl || process.env.PG_URL;
    if (!url) throw new Error('PG_URL is not set (the .env next to the app, or the environment)');
    session = await readOnlySession(url);
    query = session.query;
  }
  let g;
  try { g = await gather(query, { days: args.days, now }); } finally { if (session) await session.close(); }
  const cfg = C.effectiveConfig(DEFAULTS, g.stored);
  const pack = C.buildDryRun({ cfg, defaults: DEFAULTS, directory: g.directory, digestUsers: g.digestUsers, alertRules: g.alertRules, history: g.history, days: args.days, now });
  const text = args.json ? JSON.stringify(pack, null, 2) + '\n' : C.dryRunMarkdown(pack);
  if (args.out) (deps.writeFile || fs.writeFileSync)(args.out, text);
  else (deps.write || ((s) => process.stdout.write(s)))(text);
  return pack;
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error('[catalogue-dry-run]', e.message); process.exit(1); });
}

module.exports = { parseArgs, gather, readOnlySession, main };
