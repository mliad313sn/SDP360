'use strict';
// E-D06 + E-Q02 (expert audit 2026-11-05, audit D-08 / Q-01 prep) — snapshot anonymiser, RUN BY AN OPERATOR
// (the data owner or someone they name) on a COPY of the production database, never by an agent and never on
// the live database. The ten "no prod-snapshot" tests (tests/.skip-allowlist.json) need a restored copy; this
// turns such a copy into one that can be shared with developers once the data owner has approved it.
//
//   SDP_ANON_KEY=<16+ chars, kept by the operator> \
//   node tools/dev/anonymize-snapshot.js --db=postgres://…/sdp_snapshot_copy --confirm-copy=sdp_snapshot_copy [--dry-run]
//
// What it does, in ONE transaction on the database named by --db:
//   • replaces people names, e-mails, free text (subjects, descriptions, notes, comments, observations…) and
//     ticket ids with stable KEYED pseudonyms (HMAC-SHA256 with SDP_ANON_KEY — the same input always gives the
//     same pseudonym, so joins by name or ticket id survive; the key is never printed or stored);
//   • walks JSON columns (udf_json, state_json, details…) keeping structural keys, dates and numbers;
//   • removes photos/signature blobs, password hashes, report_config secrets, sessions and IP addresses;
//   • keeps structure, row counts, dates, statuses, codes, site names and currencies;
//   • then scans EVERY text column of EVERY table for an e-mail address or a phone number and, if anything is
//     left, ROLLS BACK and exits 2 (refuses to finish), printing only table.column and a count — never a value.
// --dry-run does everything, prints the same report, and rolls back.
//
// Refuses to start without the key, when --confirm-copy is not exactly the database name, or when that name is
// the database of the .env PG_URL (production). Nothing is sent anywhere: the only connection is --db.
// The output still needs the data owner's review: a name written inside a column this tool does not know is
// not detectable by a pattern — the "columns not covered" list printed at the end is what they review.
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const ANON_DOMAIN = 'anon.invalid';
const KEEP_JSON_KEYS = /^(udf:)?(priority|severity|status|stage|impact|site|site_code|category|sub_category|subcategory|module|kind|type|action|code|currency|services affected|change implementation outcome|review decision|division|request type|template|risk|scope|unit|mode|level|result|phase)$/i;
const isDate = (s) => s.length <= 32 && /^\d{4}-\d{2}-\d{2}/.test(s) && !Number.isNaN(Date.parse(s));
const isNumber = (s) => /^-?[0-9.]+$/.test(s) && Number.isFinite(Number(s));

// table → { column: kind }. Kinds: person · email · free · json · blob · secret · ip · ticket:<namespace>
const RULES = {
  users: { username: 'username', full_name: 'person', first_name: 'person', last_name: 'person', title: 'free', office: 'free', entra_oid: 'free', password_hash: 'secret', salt: 'secret' },
  request_records: { request_id: 'ticket:req', display_id: 'ticket:reqd', subject: 'free', technician: 'person', requester: 'person', udf_json: 'json' },
  change_records: { change_id: 'ticket:chg', display_id: 'ticket:chgd', subject: 'free', requester: 'person', manager: 'person', requester_id: 'ticket:usr', owner_id: 'ticket:usr', udf_json: 'json', description: 'free', reason: 'free' },
  cab_approvals: { change_id: 'ticket:chg', approver_name: 'person', comments: 'free' },
  survey_results: { request_id: 'ticket:req', request_display_id: 'ticket:reqd', change_id: 'ticket:chg', user_id: 'ticket:usr' },
  survey_answers: { answer_text: 'free' },
  sla_alert_log: { request_id: 'ticket:req' },
  md_meetings: { department_head: 'person', department_head_title: 'free', site_it_lead: 'person', other_attendees: 'free', dept_head_signed_by: 'person', site_it_signed_by: 'person', dept_head_signed_on_behalf: 'free', site_it_signed_on_behalf: 'free', next_meeting_location: 'free', priority_1: 'free', priority_2: 'free', priority_3: 'free', delete_reason: 'free', incubation_json: 'json' },
  md_meeting_projects: { it_lead: 'person', business_sponsor: 'person', notes: 'free', project_name: 'free' },
  md_issues: { title: 'free', description: 'free', champion: 'person', affects: 'free', notes: 'free', status_note: 'free' },
  md_issue_updates: { author_name: 'person', body: 'free' },
  md_actions: { description: 'free', owner_it: 'person', notes: 'free', status_note: 'free' },
  md_action_updates: { author_name: 'person', body: 'free' },
  md_meeting_attachments: { data_b64: 'blob', file_name: 'free' },
  insp_inspections: { inspector_name: 'person', accompanied_by: 'free', key_observations: 'free', positive_findings: 'free', distribution: 'free', specific_location: 'free', area_text: 'free', scope: 'free', operational_impact: 'free', delete_reason: 'free', label: 'free', state_json: 'json' },
  insp_findings: { notes: 'free' },
  insp_actions: { description: 'free', owner: 'person', notes: 'free' },
  insp_action_updates: { author_name: 'person', body: 'free' },
  insp_photos: { caption: 'free', data_b64: 'blob' },
  insp_signatures: { signer_name: 'person', signature_b64: 'blob' },
  action_items: { task: 'free', owner: 'person', comment: 'free' },
  helpdesk_data: { comments_metrics: 'free', comments_sla: 'free', tech_on_break: 'free', techs_on_duty: 'free' },
  monthly_reports: { notes: 'free', edited_lights: 'json', edited_actions: 'json' },
  report_recipients: { coordinator_name: 'person', fm_name: 'person' },
  roadmap_objectives: { gap_note: 'free' },
  roadmap_deliverables: { notes: 'free' },
  system_log: { actor: 'person', ip: 'ip', details: 'json' },
  audit_log: { username: 'person', details: 'json' },
};
const CLEAR_TABLES = ['sessions'];   // rows removed (login tokens)
const SECRET_KEY_RE = /(pass|secret|token|_key$|api_key|webhook_url|teams_url|channels|ca_bundle)/i;

// ── pure core ─────────────────────────────────────────────────────────────────────────────
function makePseudo(key) {
  if (!key || String(key).length < 16) throw new Error('SDP_ANON_KEY must be set (16+ characters)');
  const h = (ns, v, n) => crypto.createHmac('sha256', String(key)).update(ns + '\u0000' + v).digest('hex').slice(0, n);
  const norm = (v) => String(v).trim().toLowerCase().replace(/\s+/g, ' ');
  return {
    person: (v) => 'Person ' + h('person', norm(v), 8),
    username: (v) => 'user-' + h('username', norm(v), 10),
    email: (v) => String(v).split(/[,;\s]+/).filter(Boolean).map((e) => 'user-' + h('email', norm(e), 10) + '@' + ANON_DOMAIN).join(', '),
    free: (v) => 'Text ' + h('free', String(v), 10),
    ticket: (ns, v) => (/^\d+$/.test(String(v).trim()) ? String(1e11 + (parseInt(h('t' + ns, String(v).trim(), 10), 16) % 8.9e11)) : ns.toUpperCase() + '-' + h('t' + ns, String(v).trim(), 10)),
  };
}
/** Replace every non-structural string of a JSON value; dates, numbers, booleans and keys in KEEP_JSON_KEYS stay. */
function scrubJsonValue(val, P, k = '') {
  if (val == null || typeof val === 'number' || typeof val === 'boolean') return val;
  if (Array.isArray(val)) return val.map((x) => scrubJsonValue(x, P, k));
  if (typeof val === 'object') { const o = {}; for (const [kk, vv] of Object.entries(val)) o[kk] = scrubJsonValue(vv, P, kk); return o; }
  const s = String(val);
  if (s === '' || isDate(s) || isNumber(s)) return s;
  if (/^data:/i.test(s)) return null;
  if (/email/i.test(k) || EMAIL_RE.test(s)) return P.email(s.match(EMAIL_RE_G) ? s.match(EMAIL_RE_G).join(',') : s);
  if (KEEP_JSON_KEYS.test(k) && s.length <= 80 && !EMAIL_RE.test(s)) return s;
  return P.free(s);
}
function scrubJson(text, P) {
  if (text == null || text === '') return text;
  try { return JSON.stringify(scrubJsonValue(JSON.parse(text), P)); } catch (_) { return P.free(text); }
}
function scrubValue(kind, v, P) {
  if (v == null || v === '') return v;
  if (kind === 'blob') return null;
  if (kind === 'ip') return null;
  if (kind === 'secret') return 'anonymised';
  if (kind === 'json') return scrubJson(v, P);
  if (kind.startsWith('ticket:')) return P.ticket(kind.slice(7), v);
  return P[kind](v);
}
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const EMAIL_RE_G = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_INTL = /(?:^|[^0-9])(?:\+|00)[0-9][0-9 .-]{7,20}/g;
const PHONE_LOCAL = /(?:^|[^0-9])0[0-9][ .][0-9]{2}[ .][0-9]{2}[ .][0-9]{2}[ .][0-9]{2}(?:[^0-9]|$)/;
function hasPhone(t) {
  for (const m of t.match(PHONE_INTL) || []) { const d = m.replace(/[^0-9]/g, '').length; if (d >= 8 && d <= 15) return true; }
  return PHONE_LOCAL.test(t);
}
/** Residual-PII test for one string: 'email' | 'phone' | null (pseudonymised e-mails are ignored). */
function residual(s) {
  if (s == null) return null;
  const t = String(s).replace(new RegExp('[A-Za-z0-9._%+-]+@' + ANON_DOMAIN.replace('.', '\\.'), 'g'), '');
  if (EMAIL_RE.test(t)) return 'email';
  if (hasPhone(t)) return 'phone';
  return null;
}
/** Kind for a (table, column), or null = not covered. Any column named like an e-mail is an e-mail. */
function kindFor(table, column) {
  if (RULES[table] && RULES[table][column]) return RULES[table][column];
  if (/email/i.test(column)) return 'email';
  return null;
}

// ── database driver (q = async (sql, params) → rows, `?` placeholders) ────────────────────
async function textColumns(q) {
  return q(`SELECT c.table_name AS t, c.column_name AS c, c.data_type AS dt FROM information_schema.columns c
              JOIN information_schema.tables x ON x.table_schema = c.table_schema AND x.table_name = c.table_name AND x.table_type = 'BASE TABLE'
             WHERE c.table_schema = current_schema() AND c.data_type IN ('text', 'character varying', 'json', 'jsonb')
             ORDER BY c.table_name, c.ordinal_position`, []);
}
const qi = (n) => '"' + String(n).replace(/"/g, '""') + '"';

async function anonymize(q, { key, log = () => {} }) {
  const P = makePseudo(key);
  const cols = await textColumns(q);
  const byTable = new Map();
  for (const r of cols) { if (!byTable.has(r.t)) byTable.set(r.t, []); byTable.get(r.t).push(r); }
  const changed = {}; const uncovered = [];
  for (const t of CLEAR_TABLES) if (byTable.has(t)) { await q(`DELETE FROM ${qi(t)}`, []); changed[t + '.*'] = 'rows removed'; }
  if (byTable.has('report_config')) {
    const rows = await q('SELECT key FROM report_config', []);
    let n = 0; for (const r of rows) if (SECRET_KEY_RE.test(r.key)) { await q("UPDATE report_config SET value = '' WHERE key = ?", [r.key]); n++; }
    if (n) changed['report_config.value'] = `${n} secret(s) blanked`;
  }
  for (const [t, list] of byTable) {
    if (CLEAR_TABLES.includes(t)) continue;
    const todo = list.map((r) => ({ c: r.c, json: r.dt === 'json' || r.dt === 'jsonb', kind: kindFor(t, r.c) })).filter((x) => x.kind);
    for (const r of list) if (!kindFor(t, r.c) && !(t === 'report_config' && r.c === 'value')) uncovered.push(`${t}.${r.c}`);
    if (!todo.length) continue;
    const rows = await q(`SELECT ctid::text AS _ctid, ${todo.map((x) => qi(x.c)).join(', ')} FROM ${qi(t)}`, []);
    let n = 0;
    for (const row of rows) {
      const sets = []; const vals = [];
      for (const x of todo) {
        const before = row[x.c]; if (before == null || before === '') continue;
        const raw = x.json && typeof before !== 'string' ? JSON.stringify(before) : before;
        const after = scrubValue(x.json ? 'json' : x.kind, raw, P);
        if (after !== raw) { sets.push(`${qi(x.c)} = ?${x.json ? '::' + list.find((l) => l.c === x.c).dt : ''}`); vals.push(after); }
      }
      if (sets.length) { await q(`UPDATE ${qi(t)} SET ${sets.join(', ')} WHERE ctid = ?::tid`, [...vals, row._ctid]); n++; }
    }
    changed[t] = `${n} row(s) rewritten (${todo.map((x) => x.c + ':' + x.kind).join(', ')})`;
    log(`[anon] ${t}: ${n} row(s)`);
  }
  const leaks = await scan(q, cols);
  return { changed, leaks, uncovered };
}

/** Every text column of every table: rows still holding an e-mail or a phone number. Counts only. */
async function scan(q, cols) {
  const leaks = [];
  for (const r of cols || await textColumns(q)) {
    const rows = await q(`SELECT ${qi(r.c)}::text AS v FROM ${qi(r.t)} WHERE ${qi(r.c)}::text ~ '[@0-9]'`, []);
    const counts = {};
    for (const x of rows) { const k = residual(x.v); if (k) counts[k] = (counts[k] || 0) + 1; }
    for (const [kind, n] of Object.entries(counts)) leaks.push({ table: r.t, column: r.c, kind, rows: n });
  }
  return leaks;
}

function report(res, { dryRun = false } = {}) {
  const L = ['# Anonymised snapshot — run report', ''];
  L.push(res.leaks.length ? '**REFUSED — residual personal data found; the transaction was rolled back.**' : dryRun ? 'Dry run — nothing kept (rolled back).' : 'Done — committed.');
  L.push('', '## Rewritten', '');
  for (const [k, v] of Object.entries(res.changed)) L.push(`- ${k}: ${v}`);
  L.push('', '## Residual scan (e-mail / phone patterns, every text column)', '');
  if (!res.leaks.length) L.push('- none'); else for (const l of res.leaks) L.push(`- ${l.table}.${l.column}: ${l.rows} row(s) with a ${l.kind}`);
  L.push('', '## Columns not covered (kept as they are — the data owner reviews them before approving the extract)', '');
  L.push(res.uncovered.length ? res.uncovered.map((x) => '`' + x + '`').join(', ') : '- none');
  return L.join('\n') + '\n';
}

function dbName(url) { try { return decodeURIComponent(new URL(url).pathname.replace(/^\//, '')); } catch (_) { return null; } }
/** Pre-flight checks, pure. Returns an error message or null. */
function preflight({ url, confirm, key, prodUrl }) {
  if (!url) return '--db=<url of the COPY> is required';
  const name = dbName(url); if (!name) return '--db is not a postgres URL';
  if (!key || String(key).length < 16) return 'SDP_ANON_KEY must be set (16+ characters) — keep it with the operator, never in a file of the repository';
  if (confirm !== name) return `--confirm-copy must repeat the database name exactly (${name})`;
  if (prodUrl && dbName(prodUrl) === name) return `refused: ${name} is the database of the .env PG_URL (production). Restore a dump into a copy first.`;
  return null;
}

async function main(argv = process.argv.slice(2)) {
  const arg = (k) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
  const url = arg('db'); const dryRun = argv.includes('--dry-run');
  let prodUrl = null; const envFile = path.join(__dirname, '..', '..', '.env');
  if (fs.existsSync(envFile)) { try { prodUrl = require('dotenv').parse(fs.readFileSync(envFile)).PG_URL || null; } catch (_) { prodUrl = null; } }
  const err = preflight({ url, confirm: arg('confirm-copy'), key: process.env.SDP_ANON_KEY, prodUrl });
  if (err) { console.error(err); return 1; }
  const { Client } = require('pg');
  const c = new Client({ connectionString: url }); await c.connect();
  let code = 0;
  try {
    const q = async (sql, params) => { let i = 0; return (await c.query(sql.replace(/\?/g, () => '$' + (++i)), params)).rows; };
    await c.query('BEGIN');
    const res = await anonymize(q, { key: process.env.SDP_ANON_KEY, log: (m) => console.error(m) });
    if (res.leaks.length || dryRun) { await c.query('ROLLBACK'); code = res.leaks.length ? 2 : 0; } else await c.query('COMMIT');
    process.stdout.write(report(res, { dryRun }));
  } catch (e) { try { await c.query('ROLLBACK'); } catch (_) {} console.error(e.message); code = 1; } finally { await c.end(); }
  return code;
}

if (require.main === module) main().then((c) => { process.exitCode = c; });
module.exports = { RULES, makePseudo, scrubValue, scrubJson, residual, kindFor, anonymize, scan, report, preflight, dbName, main, ANON_DOMAIN };
