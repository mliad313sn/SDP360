'use strict';
// Standalone runs must read the app's .env BEFORE any app module loads (PG_URL lives there).
if (require.main === module) require('dotenv').config({ quiet: true, path: require('path').join(__dirname, '..', '..', '.env') });
// B-09 — Roadmap Manager → portfolio PARITY report (read-only).
// Compares every user's Roadmap Manager objectives/deliverables with the portfolio programme `itsm-roadmap`
// created by the roadmap migration, item by item (services/roadmapParity.js), and prints Markdown (or JSON).
//
// It changes nothing: every query runs inside ONE `BEGIN READ ONLY` transaction that is rolled back. It does
// NOT read through reports-db.getRoadmap (that reader lazy-seeds a user's first read, i.e. it writes).
// Deleting the Roadmap Manager data is NOT this tool's job: that is a human / CAB step after a parity cycle.
//
// Usage: node tools/governance/roadmap-parity.js [--user=<id>] [--json] [--out=parity.md] [--strict]
//   --strict  exit code 2 when any user is not in parity (for a scripted gate); default exit 0.

const fs = require('fs');
const parity = require('../../services/roadmapParity');

function parseArgs(argv) {
  const out = { user: null, json: false, out: null, strict: false };
  for (const a of argv || []) {
    if (a === '--json') out.json = true;
    else if (a === '--strict') out.strict = true;
    else if (a.startsWith('--user=')) { const n = parseInt(a.slice(7), 10); if (Number.isInteger(n) && n > 0) out.user = n; }
    else if (a.startsWith('--out=')) out.out = a.slice(6) || null;
  }
  return out;
}

// `?` placeholders (shared with the route, which uses pgDb) → pg's $n.
function toPg(sql) { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); }

async function readOnlySession(url) {
  const { Client } = require('pg');
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query('BEGIN READ ONLY');
  const query = async (sql, params) => (await c.query(toPg(sql), params || [])).rows;
  const close = async () => { try { await c.query('ROLLBACK'); } finally { await c.end(); } };
  return { query, close };
}

async function main(deps = {}) {
  const args = deps.args || parseArgs(process.argv.slice(2));
  let session = null, query = deps.query;
  if (!query) {
    const url = deps.pgUrl || process.env.PG_URL;
    if (!url) throw new Error('PG_URL is not set (the .env next to the app, or the environment)');
    session = await readOnlySession(url);
    query = session.query;
  }
  let report;
  try { report = await parity.buildReport(query, { userId: args.user, now: deps.now || new Date() }); }
  finally { if (session) await session.close(); }
  const text = args.json ? JSON.stringify(report, null, 2) + '\n' : parity.renderMarkdown(report);
  if (args.out) (deps.writeFile || fs.writeFileSync)(args.out, text);
  else (deps.write || ((s) => process.stdout.write(s)))(text);
  const allInParity = report.users.length > 0 && report.users.every((u) => u.verdict === 'in_parity');
  return { report, exitCode: args.strict && !allInParity ? 2 : 0 };
}

if (require.main === module) {
  main().then((r) => process.exit(r.exitCode)).catch((e) => { console.error('[roadmap-parity]', e.message); process.exit(1); });
}

module.exports = { parseArgs, toPg, readOnlySession, main };
