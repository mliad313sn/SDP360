'use strict';
// P03 (prompt-pack "Switch activation in lots") — turns the dark switches of docs/ops/FLAG-REGISTER.json into the
// PROPOSED activation lots of docs/ops/switch-lots.json, checks the plan, and writes docs/ops/SWITCH-LOTS.md
// (lot plan, one dossier per lot, keep list, retire list, dependency graph, cycles, orphans, cross-lot overlaps).
//
//   node tools/agent/switch-lots.js                 writes docs/ops/SWITCH-LOTS.md
//   node tools/agent/switch-lots.js --check         exits 1 when the plan is invalid or the Markdown is out of date
//   node tools/agent/switch-lots.js --lot=L01 --force   prints the SDP_FORCE_SWITCHES value for that lot
//   node tools/agent/switch-lots.js --lot=L01 --tests   prints the targeted test files for that lot (one per line)
//   --lot=L02+L03 merges lots for a pairwise run (both lots' switches forced together)
//
// QUALIFY, NOT DECIDE: the plan is an agent proposal. Owner, canary site, dates, thresholds and rollback-trigger
// values are never written here — they belong to docs/ops/flag-decisions.json, filled by humans.
// Dependencies are derived from the code as text (which files read a key) and from the register's recommended
// text; table / route overlap is a file-level approximation, stated as such in the output.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const PLAN = path.join(ROOT, 'docs', 'ops', 'switch-lots.json');
const REGISTER = path.join(ROOT, 'docs', 'ops', 'FLAG-REGISTER.json');
const OUT = path.join(ROOT, 'docs', 'ops', 'SWITCH-LOTS.md');
// The test files every lot runs with its switches forced on, whatever the keys (authorization + RBAC outcomes).
const AUTHZ_TESTS = ['tests/authz-matrix-json.test.js', 'tests/authz-route-matrix.test.js', 'tests/authz-enforce.test.js',
  'tests/rbac-matrix.smoke.test.js', 'tests/rbac-write-scope.smoke.test.js', 'tests/rbac-scope-frozen.smoke.test.js',
  'tests/rbac-ui-gates.test.js', 'tests/rbac-external-writes.test.js'];
// A file read by more switches than this is a hub (config page, flag aggregator, monolith): sharing it says nothing
// about two switches touching the same behaviour, so it is left out of the overlap report.
const HUB_THRESHOLD = 6;
const ROLE_NAMES = ['super_admin', 'executive', 'admin', 'editor', 'viewer', 'finance-viewer', 'committee-member',
  'report-author', 'audit-viewer', 'scorecard-viewer', 'tracker-admin', 'tracker-editor'];

function readJson(f) { return JSON.parse(fs.readFileSync(f, 'utf8')); }
const keyName = (k) => k.replace(/^frozen:/, '').split('.')[0];
const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const code = (s) => '`' + s + '`';

function listFiles(root) {
  let out;
  try { out = cp.execSync("git ls-files '*.js' '*.mjs' '*.jsx' '*.html' '*.sql'", { cwd: root, encoding: 'utf8' }); }
  catch (_) { return []; }
  return out.split('\n').filter(Boolean)
    .filter((f) => !/^(docs|vendor|node_modules)\//.test(f) && !/\.min\./.test(f))
    // generated JS compiled from a .jsx sibling would double-count the consumer
    .filter((f) => !(f.endsWith('.js') && fs.existsSync(path.join(root, f.replace(/\.js$/, '.jsx')))));
}
// files that only declare or list switches (they would make every key "consumed")
const NOT_A_CONSUMER = /^(services\/reportConfig\.js|services\/switchPrereqs\.js|tools\/agent\/(flag-register|switch-lots)\.js|tools\/test\/force-switches\.js|tools\/ops\/activate-switches\.js|tests\/activate-switches\.test\.js)$/;

/** Scan the repository once: per dark key, consumer code files and test files. */
function scan(keys, root = ROOT) {
  const files = listFiles(root);
  const text = new Map(files.map((f) => [f, fs.readFileSync(path.join(root, f), 'utf8')]));
  const out = {};
  for (const k of keys) {
    const re = new RegExp('\\b' + keyName(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
    const hit = files.filter((f) => !NOT_A_CONSUMER.test(f) && re.test(text.get(f)));
    out[k] = { code: hit.filter((f) => !/^tests\//.test(f)).sort(), tests: hit.filter((f) => /^tests\/.*\.test\.(js|mjs)$/.test(f)).sort() };
  }
  // tables: SQL table names named in a consumer's own file, mapped to the migration that creates them
  const creates = new Map();
  for (const f of files.filter((x) => /^db\/postgres\/.*\.sql$/.test(x))) {
    for (const m of text.get(f).matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+("?)([a-z_][a-z0-9_]*)\1/gi)) if (!creates.has(m[2].toLowerCase())) creates.set(m[2].toLowerCase(), f);
  }
  const jobs = text.get('services/sync/jobs.js') || '';
  for (const k of keys) {
    const tables = new Set(); const routes = new Set(); const fileTables = {};
    for (const f of out[k].code) {
      if (/^(server|reports-db)\.js$/.test(f)) continue;   // monoliths: every table, no signal
      const t = text.get(f);
      const ft = new Set();
      for (const m of t.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_][a-z0-9_]*)\b/g)) if (creates.has(m[1])) { tables.add(m[1]); ft.add(m[1]); }
      if (ft.size) fileTables[f] = [...ft].sort();
      if (/^routes\//.test(f)) for (const m of t.matchAll(/router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g)) routes.add(`${m[1].toUpperCase()} ${m[2]}`);
    }
    out[k].tables = [...tables].sort();
    out[k].fileTables = fileTables;
    out[k].migrations = [...new Set([...tables].map((t) => creates.get(t)))].sort();
    out[k].routes = [...routes].sort();
    out[k].job = new RegExp('\\b' + keyName(k) + '\\b').test(jobs) || out[k].code.some((f) => /^services\/sync\//.test(f));
  }
  return out;
}

/** Hard dependencies: switch keys named in the register's recommended / prerequisite text, plus the plan's extras. */
function dependencies(register, plan, darkKeys) {
  const rc = new Map(register.report_config.map((r) => [r.key, r]));
  const soft = plan.dependencies_soft || {};
  const deps = {};
  for (const k of darkKeys) {
    const r = rc.get(k) || {};
    const txt = `${r.recommended || ''} ${r.prerequisites || ''}`;
    const named = darkKeys.filter((o) => o !== k && new RegExp('\\b' + o.replace(/\./g, '\\.') + '\\b').test(txt));
    const s = new Set(soft[k] || []);
    deps[k] = [...new Set([...named.filter((o) => !s.has(o)), ...((plan.dependencies_extra || {})[k] || [])])].sort();
  }
  return deps;
}

/** Cycles in the dependency graph (each as a list of keys, smallest rotation first). */
function cycles(deps) {
  const found = new Set(); const out = [];
  const visit = (k, stack, onStack) => {
    for (const d of deps[k] || []) {
      if (onStack.has(d)) {
        const cyc = stack.slice(stack.indexOf(d));
        const i = cyc.indexOf([...cyc].sort()[0]); const norm = [...cyc.slice(i), ...cyc.slice(0, i)];
        const id = norm.join('>'); if (!found.has(id)) { found.add(id); out.push(norm); }
        continue;
      }
      if (stack.length > 50) continue;
      stack.push(d); onStack.add(d); visit(d, stack, onStack); stack.pop(); onStack.delete(d);
    }
  };
  for (const k of Object.keys(deps).sort()) visit(k, [k], new Set([k]));
  return out;
}

/** Pure: every check on the plan. Returns { errors[], warnings[], classOf, lotIndex }. */
function validate(register, plan, deps) {
  const errors = []; const warnings = [];
  const dark = register.dark.map((d) => d.key);
  const live = (register.live || []).map((d) => d.key);   // P11 R3-A2 — default-ON switches
  const defaults = new Map(register.dark.map((d) => [d.key, d.default]));
  const classOf = {}; const lotIndex = {};
  const put = (k, c) => { if (classOf[k]) errors.push(`${k} is classified twice (${classOf[k]} and ${c})`); classOf[k] = c; };
  plan.lots.forEach((l, i) => {
    if (l.switches.length > plan.max_lot_size) errors.push(`${l.id} has ${l.switches.length} switches (max ${plan.max_lot_size})`);
    if (l.status !== 'PROPOSED') errors.push(`${l.id} status must stay PROPOSED (a human approves a lot, not the plan)`);
    for (const k of l.switches) { put(k, l.id); lotIndex[k] = i; if (live.includes(k)) errors.push(`${k} (lot ${l.id}) is ON by default ('1') — a lot forces switches on; record a keep decision instead`); if (defaults.has(k) && defaults.get(k) !== '0') errors.push(`${k} (lot ${l.id}) is not a '0'/'1' switch (default ${defaults.get(k)}) — it cannot be forced on as '1'`); }
    for (const f of ['owner', 'canary_site', 'decision_deadline', 'expiry', 'threshold', 'rollback_threshold']) if (l[f] != null) errors.push(`${l.id} carries the human field "${f}" — leave it to docs/ops/flag-decisions.json`);
  });
  for (const [g, v] of Object.entries(plan.keep)) for (const k of v.switches) put(k, `keep:${g}`);
  for (const r of plan.retire) put(r.key, 'retire');
  for (const k of dark) if (!classOf[k]) errors.push(`${k} is dark in the register but not classified (lot, keep or retire)`);
  for (const k of live) if (!classOf[k]) errors.push(`${k} is ON by default ('1') in the register but not classified — keep it (group with a reason) or retire it`);
  for (const k of Object.keys(classOf)) if (!dark.includes(k) && !live.includes(k)) errors.push(`${k} is classified but is not a dark switch in the register (regenerate the register or remove it)`);
  for (const [k, ds] of Object.entries(deps)) {
    if (!(k in lotIndex)) continue;
    for (const d of ds) {
      if (!(d in classOf)) continue;
      if (!(d in lotIndex)) errors.push(`${k} (lot ${plan.lots[lotIndex[k]].id}) depends on ${d}, which is ${classOf[d]} — move one of them`);
      else if (lotIndex[d] > lotIndex[k]) errors.push(`${k} (lot ${plan.lots[lotIndex[k]].id}) depends on ${d} in a LATER lot ${plan.lots[lotIndex[d]].id}`);
    }
  }
  for (const c of cycles(deps)) errors.push(`dependency cycle: ${c.join(' → ')} → ${c[0]}`);
  return { errors, warnings, classOf, lotIndex };
}

/** Pairs of switches in DIFFERENT lots that share a non-hub consumer file or a table. */
function overlaps(plan, sc) {
  const lotOf = {}; plan.lots.forEach((l) => l.switches.forEach((k) => { lotOf[k] = l.id; }));
  const fileCount = {}; for (const k of Object.keys(lotOf)) for (const f of sc[k].code) fileCount[f] = (fileCount[f] || 0) + 1;
  const hubs = new Set(Object.keys(fileCount).filter((f) => fileCount[f] > HUB_THRESHOLD || /^(server|reports-db)\.js$/.test(f)));
  // tables only from non-hub files; a table reached by more than HUB_THRESHOLD lot switches is a hub table too
  const ownTables = {}; const tableCount = {};
  for (const k of Object.keys(lotOf)) {
    ownTables[k] = [...new Set(Object.entries(sc[k].fileTables || {}).filter(([f]) => !hubs.has(f)).flatMap(([, t]) => t))];
    for (const t of ownTables[k]) tableCount[t] = (tableCount[t] || 0) + 1;
  }
  const hubTables = new Set(Object.keys(tableCount).filter((t) => tableCount[t] > HUB_THRESHOLD));
  const keys = Object.keys(lotOf).sort(); const out = [];
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const a = keys[i]; const b = keys[j]; if (lotOf[a] === lotOf[b]) continue;
    const files = sc[a].code.filter((f) => !hubs.has(f) && sc[b].code.includes(f));
    const tables = ownTables[a].filter((t) => !hubTables.has(t) && ownTables[b].includes(t)).sort();
    if (files.length || tables.length) out.push({ a, b, lots: [lotOf[a], lotOf[b]].sort(), files, tables });
  }
  out.sort((x, y) => (x.lots.join() + x.a + x.b).localeCompare(y.lots.join() + y.a + y.b));
  return { pairs: out, hubs: [...hubs].sort(), hubTables: [...hubTables].sort() };
}

/** Targeted test files for a lot: the tests that name one of its switches, plus the authorization set. */
function lotTests(lot, sc, root = ROOT) {
  const s = new Set();
  for (const k of lot.switches) for (const t of sc[k].tests) s.add(t);
  for (const t of AUTHZ_TESTS) if (fs.existsSync(path.join(root, t))) s.add(t);
  return [...s].sort();
}
const forceValue = (lot) => lot.switches.map((k) => `${k}=1`).join(',');

/**
 * Pure (P03 step 7): switches recorded ON in the pilot whose age passed N days with neither a keep nor a removal
 * decision. `items` = flag-decisions.json items; an item opts in with `pilot_on_since: 'YYYY-MM-DD'` and closes the
 * clock with `lifecycle_decision: 'keep' | 'remove'`. N null = not armed (the owner has not set it) → [].
 */
function expiryViolations(items, maxDays, today) {
  if (maxDays == null || maxDays === '' || !Number.isFinite(Number(maxDays))) return [];
  const t = Date.parse(`${today}T00:00:00Z`); const out = [];
  for (const [key, it] of Object.entries(items || {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (!it || !it.pilot_on_since) continue;
    if (['keep', 'remove'].includes(String(it.lifecycle_decision || '').toLowerCase())) continue;
    const since = Date.parse(`${it.pilot_on_since}T00:00:00Z`);
    if (!Number.isFinite(since)) { out.push({ key, days: null, reason: `pilot_on_since "${it.pilot_on_since}" is not a YYYY-MM-DD date` }); continue; }
    const days = Math.floor((t - since) / 86400000);
    if (days > Number(maxDays)) out.push({ key, days, reason: `on in the pilot for ${days} days (> ${maxDays}) without a keep or removal decision` });
  }
  return out;
}

function build({ root = ROOT } = {}) {
  const register = readJson(path.join(root, 'docs', 'ops', 'FLAG-REGISTER.json'));
  const plan = readJson(path.join(root, 'docs', 'ops', 'switch-lots.json'));
  const dark = register.dark.map((d) => d.key);
  const sc = scan(dark, root);
  const deps = dependencies(register, plan, dark);
  const v = validate(register, plan, deps);
  const ov = overlaps(plan, sc);
  const cyc = cycles(deps);
  const orphans = dark.filter((k) => !k.startsWith('frozen:') && !sc[k].code.length).sort();
  const rc = new Map(register.report_config.map((r) => [r.key, r]));
  const dk = new Map(register.dark.map((d) => [d.key, d]));
  const roles = (k) => { const t = ((rc.get(k) || {}).recommended || ''); return ROLE_NAMES.filter((r) => new RegExp(`(^|[^a-z-])${r}([^a-z-]|$)`).test(t)); };
  const inLots = plan.lots.reduce((n, l) => n + l.switches.length, 0);
  const keepN = Object.values(plan.keep).reduce((n, g) => n + g.switches.length, 0);
  const notASwitch = (plan.keep.not_a_switch || { switches: [] }).switches.length;

  const L = [];
  L.push('# Switch activation lots — PROPOSED plan (P03)');
  L.push('');
  L.push('**Generated** by `node tools/agent/switch-lots.js` from `docs/ops/FLAG-REGISTER.json` (the dark switches) and');
  L.push('`docs/ops/switch-lots.json` (the agent\'s proposal). Do not edit by hand; `--check` fails when this file is out of date');
  L.push('or the plan breaks a rule (`tests/switch-lots.test.js`).');
  L.push('');
  L.push('> **Nothing here is approved.** Every lot is PROPOSED by an AI agent. Owner, canary site, decision dates, expiry,');
  L.push('> thresholds and the numeric rollback trigger are **left empty on purpose** — they are human fields of');
  L.push('> `docs/ops/flag-decisions.json`. No switch was turned on anywhere but a throwaway test database.');
  L.push('');
  L.push('## Summary');
  L.push('');
  L.push(`| Dark switches in the register | In a lot | Keep dark | Retire (proposal) | Lots | Proposed count after decisions |`);
  L.push('|---|---|---|---|---|---|');
  L.push(`| ${dark.length} | ${inLots} | ${keepN} (of which ${notASwitch} are not switches) | ${plan.retire.length} | ${plan.lots.length} | ${dark.length - plan.retire.length - notASwitch} dark entries if the ${plan.retire.length} retirements and the ${notASwitch} reclassifications are accepted (activations then lower it further, lot by lot) |`);
  L.push('');
  L.push(`Plan checks: **${v.errors.length ? v.errors.length + ' error(s)' : 'clean'}** · dependency cycles: **${cyc.length}** · orphans (no code reads the key): **${orphans.length}**${orphans.length ? ' — ' + orphans.map(code).join(', ') : ''}.`);
  if (v.errors.length) { L.push(''); for (const e of v.errors) L.push(`- ERROR: ${e}`); }
  L.push('');
  L.push('## Lots (ordered by user journey)');
  L.push('');
  L.push('| Lot | Journey | Switches | Status |');
  L.push('|---|---|---|---|');
  for (const l of plan.lots) L.push(`| ${l.id} | ${esc(l.title)} | ${l.switches.length} | ${l.status}${l.order_note ? ' — ' + esc(l.order_note) : ''} |`);
  L.push('');
  L.push('Run a lot\'s targeted tests with its switches forced on (throwaway database only):');
  L.push('');
  L.push('```');
  L.push('export SDP_FORCE_SWITCHES="$(node tools/agent/switch-lots.js --lot=L01 --force)"');
  L.push('NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --require $PWD/tools/test/force-switches.js --import file://$PWD/tests/_pg-boot.mjs" \\');
  L.push('  node --test --test-force-exit $(node tools/agent/switch-lots.js --lot=L01 --tests)');
  L.push('```');
  L.push('');
  for (const l of plan.lots) {
    L.push(`## Dossier ${l.id} — ${l.title}`);
    L.push('');
    L.push(`- **Status**: ${l.status}. **Owner**: _(empty — human)_. **Canary site**: _(empty — human)_. **Decision date / expiry**: _(empty — human)_.`);
    L.push(`- **Who sees a change**: ${l.profiles}.`);
    L.push(`- **What changes**: ${l.changes}`);
    L.push(`- **Risk**: ${l.risk}`);
    L.push(`- **Metric that would show it worked** (candidate, no threshold): ${l.metric_candidate}.`);
    L.push(`- **Rollback**: set every switch of the lot back to its default \`0\` (Admin or \`setConfig\`). Data written while on stays in place and is no longer shown or acted on; the rehearsal is \`tests/switch-lots-rollback.test.js\`. **Rollback trigger**: _(observable and threshold left to the owner)_.`);
    const ldeps = [...new Set(l.switches.flatMap((k) => deps[k]))].filter((d) => !l.switches.includes(d)).sort();
    L.push(`- **Needs earlier lots**: ${ldeps.length ? ldeps.map((d) => `${code(d)} (${v.classOf[d] || '?'})`).join(', ') : 'none'}.`);
    L.push('');
    L.push('| Switch | Who decides (register) | Human prerequisite (register text) | Depends on | Roles named | Tables touched | Job | Consumer files | Tests naming it |');
    L.push('|---|---|---|---|---|---|---|---|---|');
    for (const k of l.switches) {
      const r = rc.get(k) || {}; const s = sc[k];
      const pre = r.prerequisites || ((r.recommended || '').match(/\bonce\b[^.;(]*|\bonly (?:if|after)\b[^.;(]*|\bafter\b[^.;(]*/i) || [''])[0] || '—';
      L.push(`| ${code(k)} | ${esc((dk.get(k) || {}).owner_role || 'to be named')} | ${esc(pre) || '—'} | ${deps[k].length ? deps[k].map(code).join(', ') : '—'} | ${roles(k).join(', ') || '—'} | ${s.tables.length ? s.tables.slice(0, 6).join(', ') + (s.tables.length > 6 ? ` +${s.tables.length - 6}` : '') : '—'} | ${s.job ? 'yes' : '—'} | ${s.code.length} | ${s.tests.length} |`);
    }
    L.push('');
  }
  L.push('## Keep dark (with the reason)');
  L.push('');
  for (const [g, v2] of Object.entries(plan.keep)) {
    L.push(`### ${g.replace(/_/g, ' ')} (${v2.switches.length})`);
    L.push('');
    L.push(v2.reason);
    L.push('');
    L.push(v2.switches.map((k) => `- ${code(k)} — decides: ${esc((dk.get(k) || {}).owner_role || 'to be named')}`).join('\n'));
    L.push('');
  }
  L.push('## Retire list (proposals — no code was deleted)');
  L.push('');
  L.push('| Switch | Why it looks dead or superseded | What removal would delete |');
  L.push('|---|---|---|');
  for (const r of plan.retire) L.push(`| ${code(r.key)} | ${esc(r.reason)} | ${esc(r.remove)} |`);
  L.push('');
  L.push('## Dependency graph');
  L.push('');
  L.push('Edges = a switch whose register text (recommended value or prerequisite) names another dark switch, plus the plan\'s');
  L.push('`dependencies_extra`; mentions listed in `dependencies_soft` (e.g. "nothing is sent while `notifications_stop`") are not edges.');
  L.push('');
  const edges = Object.entries(deps).filter(([, ds]) => ds.length).sort(([a], [b]) => a.localeCompare(b));
  L.push('| Switch | Class | Depends on |');
  L.push('|---|---|---|');
  for (const [k, ds] of edges) L.push(`| ${code(k)} | ${v.classOf[k] || '?'} | ${ds.map((d) => `${code(d)} (${v.classOf[d] || '?'})`).join(', ')} |`);
  L.push('');
  L.push(`Cycles: ${cyc.length ? cyc.map((c) => c.join(' → ')).join('; ') : 'none'}.`);
  L.push('');
  L.push(`Orphans (dark keys no code file reads, outside \`services/reportConfig.js\`): ${orphans.length ? orphans.map(code).join(', ') : 'none'}.`);
  L.push('');
  L.push('## Cross-lot overlaps (pairwise tests needed)');
  L.push('');
  L.push(`Pairs of switches in different lots that share a consumer file or a table named in that file\'s SQL. Hub files read by more`);
  L.push(`than ${HUB_THRESHOLD} lot switches (and the two monoliths) are excluded: sharing them says nothing. File-level approximation.`);
  L.push(`Hub files excluded: ${ov.hubs.map(code).join(', ') || 'none'}. Hub tables excluded: ${ov.hubTables.join(', ') || 'none'}.`);
  L.push('');
  const pairCount = {}; for (const p of ov.pairs) { const id = p.lots.join(' × '); pairCount[id] = (pairCount[id] || 0) + 1; }
  L.push('| Lot pair | Overlapping switch pairs |');
  L.push('|---|---|');
  for (const [id, n] of Object.entries(pairCount).sort()) L.push(`| ${id} | ${n} |`);
  L.push('');
  L.push('| Lots | Switch A | Switch B | Shared files | Shared tables |');
  L.push('|---|---|---|---|---|');
  for (const p of ov.pairs) L.push(`| ${p.lots.join(' × ')} | ${code(p.a)} | ${code(p.b)} | ${p.files.map(code).join(', ') || '—'} | ${p.tables.join(', ') || '—'} |`);
  L.push('');
  L.push('## Expiry (step 7)');
  L.push('');
  const n = plan.expiry && plan.expiry.max_days_on_without_decision;
  L.push(`N (days a switch may stay on in the pilot without a keep or removal decision): **${n == null ? 'not set — the owner sets `expiry.max_days_on_without_decision` in docs/ops/switch-lots.json' : n}**.`);
  L.push('An entry of `docs/ops/flag-decisions.json` opts in with `pilot_on_since: "YYYY-MM-DD"` and closes the clock with');
  L.push('`lifecycle_decision: "keep" | "remove"`. `tests/switch-expiry.test.js` fails when one has passed N days; while N is unset');
  L.push('it is not armed and says so (the check itself is unit-tested with fixtures).');
  L.push('');
  return { md: L.join('\n') + '\n', errors: v.errors, plan, sc, deps, overlaps: ov, orphans, cycles: cyc };
}

function main(argv = process.argv.slice(2)) {
  const lotArg = argv.find((a) => a.startsWith('--lot='));
  if (lotArg) {
    // --lot=L02+L03 merges lots (pairwise run: both lots' switches forced together, both lots' tests)
    const plan = readJson(PLAN); const ids = lotArg.slice(6).split('+');
    const parts = ids.map((id) => plan.lots.find((l) => l.id === id));
    if (parts.some((l) => !l)) { process.stderr.write(`unknown lot in ${lotArg.slice(6)}\n`); return 2; }
    const lot = { id: ids.join('+'), switches: parts.flatMap((l) => l.switches) };
    if (argv.includes('--force')) { process.stdout.write(forceValue(lot) + '\n'); return 0; }
    if (argv.includes('--tests')) { const sc = scan(lot.switches); process.stdout.write(lotTests(lot, sc).join('\n') + '\n'); return 0; }
    process.stdout.write(lot.switches.join('\n') + '\n'); return 0;
  }
  const b = build();
  if (argv.includes('--check')) {
    let bad = 0;
    for (const e of b.errors) { process.stderr.write(`plan error: ${e}\n`); bad++; }
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
    if (cur !== b.md) { process.stderr.write('docs/ops/SWITCH-LOTS.md is out of date — run node tools/agent/switch-lots.js\n'); bad++; }
    if (bad) return 1;
    process.stdout.write('switch lots up to date\n'); return 0;
  }
  fs.writeFileSync(OUT, b.md);
  process.stdout.write(`written docs/ops/SWITCH-LOTS.md (${b.errors.length} plan error(s))\n`);
  for (const e of b.errors) process.stderr.write(`plan error: ${e}\n`);
  return b.errors.length ? 1 : 0;
}

module.exports = { build, scan, dependencies, cycles, validate, overlaps, lotTests, forceValue, expiryViolations, AUTHZ_TESTS, PLAN, REGISTER, OUT };
if (require.main === module) process.exitCode = main();
