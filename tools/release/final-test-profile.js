#!/usr/bin/env node
'use strict';
// Final-test profile — merges every `valeurs_proposees` of tools/release/ai-proposals.source.js into ONE configuration
// profile (docs/business-readiness/PROFIL-TEST-FINAL.json) and, on request, applies it to a TEST / throwaway database
// so the owner can run his final test with the AI proposals switched on.
//
//   node tools/release/final-test-profile.js                 dry run: print the plan from the code defaults (default)
//   node tools/release/final-test-profile.js --write         regenerate PROFIL-TEST-FINAL.json (refused on a conflict)
//   node tools/release/final-test-profile.js --check         exit 1 if the JSON is stale or the profile has an error
//   node tools/release/final-test-profile.js --db-url=URL    dry run against that database (read only)
//   node tools/release/final-test-profile.js --apply --db-url=URL --i-confirm-test-database
//                                                            write the non-four-eyes keys to that TEST database
//
// Safety design (chosen as the safest option, documented in docs/agent-execution/AI-PROPOSALS.md):
//   - dry run by default; --apply is refused when NODE_ENV=production, without --db-url, when the database name does
//     not match /test|tmp|qual|demo|pilot|recette/i, or without the explicit --i-confirm-test-database flag;
//   - four-eyes keys (services/policyCatalogue.needsSecondPerson — the Policy Center rule) are NEVER written by this
//     tool, on any database: it lists them and they go through the normal Policy Center request (a second super_admin
//     approves in the web center) or `activate-switches.js --apply --operator-token=env`. There is no bypass flag;
//   - the profile itself may not switch ON an outbound send or a money (L05-class) switch: that is an error;
//   - every applied change goes through services/reportConfig.setConfig (same validation as the admin UI) with the
//     actor "ai-final-test-profile", and one system_log row "AI proposal applied for final test" is written.
// This tool never fills a human decision cell and never claims an approval.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = 'docs/business-readiness/PROFIL-TEST-FINAL.json';
const TEST_DB = /test|tmp|qual|demo|pilot|recette/i;
const ACTOR = 'ai-final-test-profile';
const freshRequire = (file) => { delete require.cache[require.resolve(file)]; return require(file); };
const norm = (s) => String(s).replace(/\r\n/g, '\n');

/** Pure: merge the proposals' values. Returns { values, sources, errors, warnings }. */
function merge(proposals) {
  const values = {}; const sources = {}; const errors = [];
  for (const p of proposals) {
    for (const [k, v] of Object.entries(p.valeurs_proposees || {})) {
      const s = String(v);
      if (k in values && values[k] !== s) errors.push(`conflict on ${k}: ${p.id} proposes ${JSON.stringify(s)}, ${sources[k].join(', ')} proposed ${JSON.stringify(values[k])}`);
      else values[k] = s;
      (sources[k] = sources[k] || []).push(p.id);
    }
  }
  return { values, sources, errors };
}

/** Classify each key against a current configuration: four-eyes, outbound, money, unchanged. */
function classify(values, cfg, root = ROOT) {
  const PC = freshRequire(path.join(root, 'services', 'policyCatalogue.js'));
  const A = freshRequire(path.join(root, 'tools', 'ops', 'activate-switches.js'));
  const cat = PC.build();
  const errors = []; const warnings = []; const rows = [];
  let deps = {};
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'ops', 'FLAG-REGISTER.json'), 'utf8'));
    const plan = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'ops', 'switch-lots.json'), 'utf8'));
    deps = A.graph(reg, plan);
  } catch (_) { /* dependencies are advisory */ }
  const onOf = (k) => (k in A.ON_VALUE ? String(A.ON_VALUE[k]) : '1');
  const after = { ...cfg, ...values };
  for (const [key, next] of Object.entries(values)) {
    const cur = cfg[key] == null ? '' : String(cfg[key]);
    const turningOn = next === onOf(key) && cur !== next;
    if (A.OUTBOUND[key] && next === onOf(key)) errors.push(`${key}: an outbound send may not be switched on by the final-test profile`);
    if (A.MONEY.has(key) && turningOn) errors.push(`${key}: a money switch (L05 class) may not be switched on without the Finance gate`);
    const fourEyes = PC.needsSecondPerson(cat.by.get(key), cur, next);
    for (const d of deps[key] || []) {
      if (next === onOf(key) && String(after[d]) !== onOf(d)) warnings.push(`${key} depends on ${d}, which stays off in this profile`);
    }
    rows.push({ key, from: cur, to: next, action: cur === next ? 'unchanged' : fourEyes ? 'four_eyes' : 'apply' });
  }
  return { rows, errors, warnings };
}

function build(root = ROOT) {
  const { proposals } = freshRequire(path.join(root, 'tools', 'release', 'ai-proposals.source.js'));
  const { DEFAULTS, KEYS } = freshRequire(path.join(root, 'services', 'reportConfig.js'));
  const m = merge(proposals);
  for (const k of Object.keys(m.values)) if (!KEYS.includes(k)) m.errors.push(`${k} is not a report_config key`);
  const c = classify(m.values, DEFAULTS, root);
  return { values: m.values, sources: m.sources, rows: c.rows, errors: [...m.errors, ...c.errors], warnings: c.warnings };
}

function renderJson(b) {
  const keys = Object.keys(b.values).sort();
  const doc = {
    note: 'PROPOSITIONS IA — non approuvées. Profil de configuration pour le test final du propriétaire, sur une base de TEST seulement. Généré par node tools/release/final-test-profile.js --write ; ne pas éditer à la main.',
    source: 'tools/release/ai-proposals.source.js',
    values: Object.fromEntries(keys.map((k) => [k, b.values[k]])),
    sources: Object.fromEntries(keys.map((k) => [k, b.sources[k]])),
    four_eyes_from_defaults: b.rows.filter((r) => r.action === 'four_eyes').map((r) => r.key).sort(),
    unchanged_from_defaults: b.rows.filter((r) => r.action === 'unchanged').map((r) => r.key).sort(),
    warnings: b.warnings,
  };
  return JSON.stringify(doc, null, 1) + '\n';
}

function stale(root = ROOT) {
  const b = build(root);
  const out = [...b.errors];
  const p = path.join(root, OUT);
  if (!fs.existsSync(p) || norm(fs.readFileSync(p, 'utf8')) !== renderJson(b)) out.push(`${OUT} is stale — run node tools/release/final-test-profile.js --write`);
  return out;
}

function parseArgs(argv) {
  const o = { apply: false, write: false, check: false, confirm: false, dbUrl: '' };
  for (const a of argv) {
    if (a === '--apply') o.apply = true;
    else if (a === '--write') o.write = true;
    else if (a === '--check') o.check = true;
    else if (a === '--i-confirm-test-database') o.confirm = true;
    else if (a.startsWith('--db-url=')) o.dbUrl = a.slice(9) === 'env' ? (process.env.PG_URL || '') : a.slice(9);
  }
  return o;
}

function dbNameOf(url) {
  try { return decodeURIComponent(new URL(String(url)).pathname.replace(/^\//, '')); } catch (_) { return ''; }
}
function redact(url) {
  try { const u = new URL(String(url)); if (u.password) u.password = '***'; return u.toString(); } catch (_) { return '(unparsable url)'; }
}

/** Pure: why --apply is refused, or null. */
function refusal(args, env = process.env) {
  if (!args.apply) return null;
  if (String(env.NODE_ENV || '').toLowerCase() === 'production') return 'refused: NODE_ENV=production — this tool never writes to production';
  if (!args.dbUrl) return 'refused: --apply needs --db-url=<TEST database URL>';
  const name = dbNameOf(args.dbUrl);
  if (!name || !TEST_DB.test(name)) return `refused: database "${name || '?'}" does not look like a TEST database (its name must match ${TEST_DB})`;
  if (!args.confirm) return 'refused: add --i-confirm-test-database to confirm this is a TEST / throwaway database';
  return null;
}

function renderPlan(rows, source) {
  const L = [`Final-test profile — plan against ${source}`, ''];
  for (const r of rows) L.push(`  ${r.key.padEnd(40)} ${JSON.stringify(r.from).padEnd(14)} -> ${JSON.stringify(r.to).padEnd(30)} ${r.action}`);
  const fe = rows.filter((r) => r.action === 'four_eyes').map((r) => r.key);
  L.push('');
  L.push(`To apply directly: ${rows.filter((r) => r.action === 'apply').length} key(s). Unchanged: ${rows.filter((r) => r.action === 'unchanged').length}.`);
  if (fe.length) {
    L.push(`Four-eyes (never written by this tool — file a Policy Center request approved by a second super_admin, or use activate-switches.js --apply --operator-token=env): ${fe.join(', ')}`);
  }
  return L.join('\n') + '\n';
}

async function main(argv, env = process.env, out = process.stdout) {
  const args = parseArgs(argv);
  if (args.write) {
    const b = build();
    if (b.errors.length) { process.stderr.write(b.errors.join('\n') + '\n'); return 1; }
    fs.writeFileSync(path.join(ROOT, OUT), renderJson(b));
    out.write(`final-test-profile: ${OUT} written (${Object.keys(b.values).length} keys)\n`);
    return 0;
  }
  if (args.check) {
    const problems = stale();
    if (problems.length) { process.stderr.write(problems.join('\n') + '\n'); return 1; }
    out.write('final-test-profile: OK\n');
    return 0;
  }
  const why = refusal(args, env);
  if (why) { process.stderr.write(why + '\n'); return 2; }
  const b = build();
  if (b.errors.length) { process.stderr.write(b.errors.join('\n') + '\n'); return 1; }
  if (!args.dbUrl) {
    out.write(renderPlan(b.rows, 'the code defaults (dry run — no database read)'));
    for (const w of b.warnings) out.write(`warning: ${w}\n`);
    return 0;
  }
  process.env.PG_URL = args.dbUrl;
  const rdb = require(path.join(ROOT, 'reports-db'));
  await rdb.initPgReports();
  const RC = require(path.join(ROOT, 'services', 'reportConfig'));
  const cfg = await RC.getConfig(rdb.db);
  const c = classify(b.values, cfg);
  if (c.errors.length) { process.stderr.write(c.errors.join('\n') + '\n'); return 1; }
  out.write(renderPlan(c.rows, redact(args.dbUrl) + (args.apply ? '' : ' (dry run)')));
  for (const w of c.warnings) out.write(`warning: ${w}\n`);
  if (!args.apply) return 0;
  const patch = Object.fromEntries(c.rows.filter((r) => r.action === 'apply').map((r) => [r.key, r.to]));
  if (!Object.keys(patch).length) { out.write('Nothing to apply directly.\n'); return 0; }
  const before = cfg;
  await RC.setConfig(rdb.db, patch, ACTOR);
  const J = require(path.join(ROOT, 'services', 'configJournal'));
  const pending = [];
  J.journal((ev) => { pending.push(Promise.resolve(rdb.logEvent(ev)).catch(() => {})); }, J.diffConfig(before, patch), { actor: ACTOR }, 'AI proposal applied for final test');
  pending.push(Promise.resolve(rdb.logEvent({ category: 'config', action: 'ai_proposal_test_profile_applied', actor: ACTOR, target: dbNameOf(args.dbUrl),
    details: { message: 'AI proposal applied for final test', keys: Object.keys(patch), four_eyes_not_written: c.rows.filter((r) => r.action === 'four_eyes').map((r) => r.key) } })).catch(() => {}));
  await Promise.all(pending);
  out.write(`Applied ${Object.keys(patch).length} key(s) to ${dbNameOf(args.dbUrl)} (actor ${ACTOR}).\n`);
  return 0;
}

module.exports = { OUT, TEST_DB, ACTOR, merge, classify, build, renderJson, stale, parseArgs, dbNameOf, refusal, renderPlan, main };

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { process.stderr.write(`final-test-profile: ${e.message}\n`); process.exit(1); });
}
