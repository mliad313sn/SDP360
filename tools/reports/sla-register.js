'use strict';
// Standalone runs must read .env BEFORE any db module loads (tests/reports-cli-dotenv.test.js).
if (require.main === module) require('dotenv').config({ quiet: true, path: require('path').join(__dirname, '..', '..', '.env') });
// E-I01 — SLA/OLA reconciliation register, READ-ONLY. Prints (or writes with --out) a Markdown register:
// per site × tech_group for one month, the resolution SLA under BOTH definitions of services/slaDefinition.js,
// the first-reply SLA, the counts, the documented Zoho profile and OLA = UNKNOWN. See services/slaRegister.js.
//
// Every query runs inside ONE `BEGIN READ ONLY` transaction that is rolled back. Nothing is written to the
// database. A production run's output is for the ITSM owner — never commit it (docs/ops/SLA-REGISTER.md is
// generated from the fictitious fixture: --fixture=tests/fixtures/sla-register.json).
//
// Usage: node tools/reports/sla-register.js [--month=YYYY-MM] [--out=file.md] [--json] [--fixture=file.json]

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const DOC = path.join(ROOT, 'docs', 'ops', 'SLA-REGISTER.md');
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'sla-register.json');

function parseArgs(argv, now = new Date()) {
  const out = { month: null, out: null, json: false, fixture: null };
  for (const a of argv || []) {
    if (a === '--json') out.json = true;
    else if (a.startsWith('--month=') && /^\d{4}-\d{2}$/.test(a.slice(8))) out.month = a.slice(8);
    else if (a.startsWith('--out=')) out.out = a.slice(6) || null;
    else if (a.startsWith('--fixture=')) out.fixture = a.slice(10) || null;
  }
  if (!out.month) {   // default = last CLOSED month
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    out.month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  return out;
}

const COLS = 'tech_group, request_status, pending_status, overdue_status, due_by_time, resolved_time, completed_time, responded_time, first_response_overdue';

/** Reads through an injected `query(sql, params) → rows`. */
async function gather(query, month) {
  const sites = await query('SELECT id, name, zoho_group FROM sites ORDER BY name', []);
  const rows = await query(`SELECT ${COLS} FROM request_records WHERE substr(created_time, 1, 7) = $1`, [month]);
  const cfg = await query("SELECT value FROM report_config WHERE key = 'helpdesk_sla_definition'", []);
  return { sites, rows, slaDefinition: cfg[0] ? cfg[0].value : undefined };
}

async function readOnlySession(url) {
  const { Client } = require('pg');
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query('BEGIN READ ONLY');
  const query = async (sql, params) => (await c.query(sql, params)).rows;
  const close = async () => { try { await c.query('ROLLBACK'); } finally { await c.end(); } };
  return { query, close };
}

function buildFromFixture(file = FIXTURE) {
  const { buildRegister, toMarkdown } = require('../../services/slaRegister');
  const fx = JSON.parse(fs.readFileSync(file, 'utf8'));
  return toMarkdown(buildRegister(fx), { source: 'fictitious test fixture (tests/fixtures/sla-register.json)' });
}

async function main(deps = {}) {
  const args = deps.args || parseArgs(process.argv.slice(2), deps.now);
  const { buildRegister, toMarkdown } = require('../../services/slaRegister');
  let md, reg;
  if (args.fixture) {
    md = buildFromFixture(path.resolve(args.fixture));
  } else {
    let session = null, query = deps.query;
    if (!query) {
      if (!process.env.PG_URL) throw new Error('PG_URL is not set (.env)');
      session = await readOnlySession(process.env.PG_URL);
      query = session.query;
    }
    try {
      const g = await gather(query, args.month);
      reg = buildRegister({ ...g, month: args.month });
      md = toMarkdown(reg, { source: 'database (read-only transaction, rolled back)' });
    } finally { if (session) await session.close(); }
  }
  const text = args.json && reg ? JSON.stringify(reg, null, 2) : md;
  if (args.out) fs.writeFileSync(args.out, text.endsWith('\n') ? text : text + '\n');
  else if (!deps.quiet) process.stdout.write(text + '\n');
  return { reg, md };
}

if (require.main === module) {
  main().catch((e) => { console.error('[sla-register]', e && e.message); process.exit(1); });
}

module.exports = { parseArgs, gather, main, buildFromFixture, DOC, FIXTURE };
