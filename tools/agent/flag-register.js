'use strict';
// C-09 (G33) — flag register: ONE file listing every behaviour switch with its default (= today's behaviour),
// owner, and rollback. Generated, never hand-edited, so it cannot drift from the code:
//
//   node tools/agent/flag-register.js            writes docs/ops/FLAG-REGISTER.md
//   node tools/agent/flag-register.js --check    exits 1 when a committed file is out of date
//   node tools/agent/flag-register.js --stale [--today=YYYY-MM-DD] [--fail]
//                                                report: decision entries whose expiry / deadline has passed, and
//                                                entries naming a switch that no longer exists (dead → delete)
//
// D1 (P10) — the same run also writes docs/ops/FLAG-REGISTER.json (machine-readable) and
// docs/ops/FLAG-DECISIONS-GAPS.md (every DARK switch with the decision fields nobody has filled yet). Decision
// fields (risk, dependencies, canary site, rollback trigger, success metric, decision deadline, expiry, named owner)
// come ONLY from the hand-maintained sidecar docs/ops/flag-decisions.json — a field nobody filled stays null and is
// listed as missing; the generator never invents one.
//
// Sources (read, nothing executed against a database):
//   1. services/reportConfig.js DEFAULTS            — report_config keys (Admin ▸ Config / set-ui-policy.js)
//   2. services/governancePolicy.js PARAMS          — governance policies (Admin ▸ Governance policies)
//   3. process.env / env.X reads in *.js, services/, routes/ — environment switches (.env, restart)
//   4. docs/ops/pilot/PILOT-PROFILE.md              — who decides + recommended pilot value + planned keys
// Secrets are listed by NAME only; a secret's value or default is never printed.

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'ops', 'FLAG-REGISTER.md');
const PROFILE = path.join(ROOT, 'docs', 'ops', 'pilot', 'PILOT-PROFILE.md');
const OUT_JSON = path.join(ROOT, 'docs', 'ops', 'FLAG-REGISTER.json');
const OUT_GAPS = path.join(ROOT, 'docs', 'ops', 'FLAG-DECISIONS-GAPS.md');
const SIDECAR = path.join(ROOT, 'docs', 'ops', 'flag-decisions.json');
/** The decision fields a dark switch needs before anyone turns it on (GAP-MATRIX D1). */
const DECISION_FIELDS = ['owner', 'risk', 'dependencies', 'canary_site', 'rollback_trigger', 'success_metric', 'decision_deadline', 'expiry'];

const SECRET_RE = /(pass|secret|token|_key$|api_key|webhook_url|teams_url|channels|ca_bundle|PASS|SECRET|TOKEN|_KEY$)/;
const cell = (v) => String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const code = (v) => '`' + String(v).replace(/`/g, "'") + '`';

/** PILOT-PROFILE table rows + the env/policy keys named in its bullet notes. */
function readProfile(text) {
  const rows = new Map();
  for (const line of String(text).split('\n')) {
    if (!/^\|\s*`[a-z0-9_.]+`/.test(line)) continue;
    const c = line.split('|').slice(1, -1).map((x) => x.trim());
    const key = c[0].replace(/`/g, '');
    rows.set(key, { status: c[1], today: c[2], recommended: c[3], owner: c[4], ref: c[5] });
  }
  const notes = new Set();
  for (const line of String(text).split('\n')) {
    if (!/^\s*-\s/.test(line) && !/^\s{2,}\S/.test(line)) continue;
    for (const [, t] of line.matchAll(/`([^`]+)`/g)) {
      if (/^SDP_[A-Z0-9_]+$/.test(t) || /^(governance|reports)\.[a-z_.]+$/.test(t)) notes.add(t);
    }
  }
  return { rows, notes };
}

/** process.env.X / env.X / env['X'] reads in the server code (root *.js, services/, routes/). */
function scanEnv(root = ROOT) {
  const files = [];
  for (const f of fs.readdirSync(root)) if (/\.js$/.test(f)) files.push(f);
  for (const d of ['services', 'routes']) for (const f of fs.readdirSync(path.join(root, d))) if (/\.js$/.test(f)) files.push(d + '/' + f);
  const seen = new Map();
  for (const f of files.sort()) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    for (const re of [/\b(?:process\.)?env\.([A-Z][A-Z0-9_]{2,})\b/g, /\benv\[['"]([A-Z][A-Z0-9_]{2,})['"]\]/g]) {
      for (const [, name] of src.matchAll(re)) {
        if (!seen.has(name)) seen.set(name, new Set());
        seen.get(name).add(f);
      }
    }
  }
  return seen;
}

// env switches whose default behaviour is documented elsewhere (PILOT-PROFILE A-28 notes, CLAUDE.md).
const ENV_DEFAULTS = {
  SDP_CSP_REPORT_ONLY: ['unset (no report-only header, no /api/security/csp-report)', 'Security owner'],
  SDP_CONFIG_BOX_VERSION: ['unset = 2 (`enc:v2`)', 'Security owner'],
  SDP_PDF_SANDBOX: ['unset (PDF render keeps --no-sandbox)', 'Security owner'],
  AI_PROVIDER: ['off (no AI call)', 'Owner'],
  SESSION_COOKIE_SECURE: ['unset', 'Security owner'],
};

function build({ root = ROOT } = {}) {
  // fresh copies each run (the tool may be required by a test that already loaded these modules)
  const { DEFAULTS, _SECRET_BLANK_KEEP } = require(path.join(root, 'services', 'reportConfig'));
  const { PARAMS } = require(path.join(root, 'services', 'governancePolicy'));
  const prof = readProfile(fs.existsSync(PROFILE) ? fs.readFileSync(PROFILE, 'utf8') : '');
  const env = scanEnv(root);
  const isSecret = (k) => (_SECRET_BLANK_KEEP && _SECRET_BLANK_KEEP.has(k)) || (SECRET_RE.test(k) && !/ALLOW_|^REQUIRE_/.test(k));
  const L = [];
  L.push('# Flag register — every behaviour switch, its default and its rollback');
  L.push('');
  L.push('**Generated** by `node tools/agent/flag-register.js` — do not edit by hand; `--check` fails when this file is');
  L.push('out of date (`tests/flag-register.test.js`). Every default below **is today\'s behaviour**: changing one is a');
  L.push('decision of the named owner (PILOT-PROFILE "Who decides"); "to be named" means no owner is recorded yet.');
  L.push('Recommended values are **proposals, not approvals**. Secrets are listed by name only — never a value.');
  L.push('');
  L.push('Rollback, by source: **report_config** → set the key back to its default in Admin ▸ Config (the `ui_*` keys:');
  L.push('`node tools/reports/set-ui-policy.js`, dry run first); **governance policy** → Admin ▸ Governance policies');
  L.push('(protected rules need two people to relax); **environment** → restore the `.env` line, then pm2 stop → start.');
  L.push('');
  L.push('Always-on internal telemetry (no switch, nothing a user sees): `page_viewed` (C-09) — one system_log row per');
  L.push('user × page × day, user id + role tier only; report at Admin ▸ System Logs ▸ Page usage.');
  L.push('');

  const keys = Object.keys(DEFAULTS).sort();
  L.push(`## 1. report_config keys (${keys.length}) — services/reportConfig.js DEFAULTS`);
  L.push('');
  L.push('Prerequisites (E-A07, services/switchPrereqs.js) are WARNINGS in plain words, never approvals: the config PUT');
  L.push('answer and the `set-ui-policy.js` dry run repeat them when the switch is moved to its switched-on value.');
  L.push('');
  L.push('| Key | Default (today) | Kind | Owner | Recommended pilot value | Reference | Prerequisites |');
  L.push('|---|---|---|---|---|---|---|');
  for (const k of keys) {
    const p = prof.rows.get(k);
    const secret = isSecret(k);
    const def = secret ? '(secret — not shown)' : (String(DEFAULTS[k]).length > 60 ? code(String(DEFAULTS[k]).slice(0, 57) + '…') : code(DEFAULTS[k]));
    const kind = secret ? 'secret' : (/^ui_/.test(k) ? 'ui policy' : (/_enabled$|_send_enabled$/.test(k) ? 'arm switch' : 'setting'));
    const pre = require('../../services/switchPrereqs').textFor(k);
    L.push(`| ${code(k)} | ${cell(def)} | ${kind} | ${cell(p ? p.owner : 'to be named')} | ${cell(p ? p.recommended : '—')} | ${cell(p ? p.ref : '—')} | ${cell(pre || '—')} |`);
  }
  L.push('');

  const planned = [...prof.rows.entries()].filter(([k]) => !(k in DEFAULTS)).sort(([a], [b]) => a.localeCompare(b));
  L.push(`## 2. Planned switches (${planned.length}) — named in PILOT-PROFILE, not yet in DEFAULTS on this branch`);
  L.push('');
  if (!planned.length) L.push('None.');
  else {
    L.push('| Key | Status | Default its goal fixes | Owner | Reference |');
    L.push('|---|---|---|---|---|');
    for (const [k, p] of planned) L.push(`| ${code(k)} | ${cell(p.status)} | ${cell(p.today)} | ${cell(p.owner)} | ${cell(p.ref)} |`);
  }
  L.push('');

  const params = [...PARAMS].sort((a, b) => a.key.localeCompare(b.key));
  L.push(`## 3. Governance policies (${params.length}) — services/governancePolicy.js PARAMS`);
  L.push('');
  L.push('| Key | Default (today) | Type | Protected | Site-scoped | Owner |');
  L.push('|---|---|---|---|---|---|');
  for (const p of params) {
    L.push(`| ${code(p.key)} | ${code(JSON.stringify(p.default))} | ${p.type} | ${p.protected ? 'yes' : 'no'} | ${p.siteScoped === false ? 'no' : 'yes'} | ${cell(prof.rows.has(p.key) ? prof.rows.get(p.key).owner : (p.key === 'governance.skip_inactive_holders' ? 'Owner (access policy)' : 'to be named'))} |`);
  }
  L.push('');

  const names = [...env.keys()].sort();
  L.push(`## 4. Environment variables (${names.length}) — read in *.js, services/, routes/`);
  L.push('');
  L.push('| Variable | Kind | Default when unset | Owner | Read in |');
  L.push('|---|---|---|---|---|');
  for (const n of names) {
    const d = ENV_DEFAULTS[n];
    const kind = isSecret(n) ? 'secret' : (/^SDP_|_ENABLED$|^AI_PROVIDER$|SESSION_COOKIE/.test(n) ? 'switch' : 'setting');
    const where = [...env.get(n)].slice(0, 4).join(', ') + (env.get(n).size > 4 ? ` (+${env.get(n).size - 4})` : '');
    L.push(`| ${code(n)} | ${kind} | ${cell(d ? d[0] : (isSecret(n) ? '(secret — not shown)' : 'see the reading file'))} | ${cell(d ? d[1] : 'to be named')} | ${cell(where)} |`);
  }
  L.push('');
  // D1 — pseudo-switches (no key of their own)
  const fl = frozenLots(root);
  const arms = nestedArms(DEFAULTS);
  L.push(`## 5. Pseudo-switches (${fl.lots.length + arms.length}) — frozen lots and nested arms`);
  L.push('');
  L.push(`Frozen lots come from ${fl.source}: commits kept behind the deploy marker on purpose — "turning on" = packaging the files`);
  L.push('by hand after the owner\'s decision; rollback = do not package them. Nested arms are booleans inside a JSON setting.');
  L.push('Machine-readable copy: `docs/ops/FLAG-REGISTER.json`; decision fields still missing: `docs/ops/FLAG-DECISIONS-GAPS.md`.');
  L.push('');
  L.push('| Key | Kind | Default (today) | What it changes | Reference |');
  L.push('|---|---|---|---|---|');
  for (const l of fl.lots) L.push(`| ${code('frozen:' + l.id)} | frozen lot | ${cell(l.today)} | ${cell(l.label + ' — ' + (l.commits || []).join(', ') + ' · ' + (l.files || []).join(', '))} | ${cell(l.reference)} |`);
  for (const a of arms) L.push(`| ${code(a.key)} | nested arm | ${code(JSON.stringify(a.default))} | ${cell(a.label)} | ${cell(a.reference)} |`);
  L.push('');
  return L.join('\n');
}

// ── D1 — pseudo-switches: things that behave like a dark switch but are not a report_config key ──────────────────
// Frozen lots = commits kept BEHIND the deploy marker on purpose (CLAUDE.md "Deployment reality"); there is no key to
// flip, the "switch" is packaging the files by hand. tools/deploy/frozen-lots.json is read when present on the branch
// (it is not on this one); otherwise the lots named in CLAUDE.md are used. Commit ids are the post-rewrite ones.
const FROZEN_FALLBACK = [
  { id: 'tracker_green_band_90', label: 'Tracker RAG band: GREEN ≥ 90 % of the pro-rated target (COUNT/PERCENT/CURRENCY/RATING)', commits: ['437a80f'], files: ['public/activity-tracker/engine.js', 'tracker-pptx.js'], today: 'not in production: GREEN needs 100 % of the pro-rated target', reference: 'CLAUDE.md "Deployment reality" (frozen 2026-09-04)' },
  { id: 'tracker_weighted_donut', label: 'Tracker attainment donut weighted by activity weight', commits: ['b681083'], files: ['public/activity-tracker/App.jsx'], today: 'not in production: unweighted donut', reference: 'CLAUDE.md "Deployment reality" (frozen 2026-09-04)' },
  { id: 'installer_safety_parity', label: 'Installer safety parity (red screens, backup before DROP, pre-restore point)', commits: ['f6f0b12'], files: ['tools/installer/*', '_sdp_admin.cmd', 'tools/pg/dump-db.js'], today: 'not in production: previous installer', reference: 'CLAUDE.md "Deployment reality" (installer files behind the marker)' },
];
function frozenLots(root = ROOT) {
  const f = path.join(root, 'tools', 'deploy', 'frozen-lots.json');
  if (!fs.existsSync(f)) return { source: 'CLAUDE.md (tools/deploy/frozen-lots.json absent on this branch)', lots: FROZEN_FALLBACK };
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    const list = Array.isArray(j) ? j : (j.lots || []);
    return { source: 'tools/deploy/frozen-lots.json', lots: list.map((l) => ({ id: String(l.id || l.name), label: l.label || l.description || String(l.id || l.name), commits: l.commits || [], files: l.files || [], today: l.today || 'not in production', reference: 'tools/deploy/frozen-lots.json' })) };
  } catch (_) { return { source: 'CLAUDE.md (tools/deploy/frozen-lots.json unreadable)', lots: FROZEN_FALLBACK }; }
}
/** Nested arm switches: a boolean inside a JSON setting (no row of its own in DEFAULTS). Default read from the code. */
const NESTED_ARMS = [
  { config: 'sla_wan_config', path: ['notify', 'enabled'], label: 'WAN SLA operator / ISP notification (15 min)', owner_role: 'Network owner', reference: 'WAN SLA V1 (2026-08-17) — Admin ▸ SLA WAN' },
];
function nestedArms(DEFAULTS) {
  return NESTED_ARMS.map((n) => {
    let def = null;
    try { let v = JSON.parse(DEFAULTS[n.config]); for (const k of n.path) v = v == null ? undefined : v[k]; def = v === undefined ? null : v; } catch (_) { def = null; }
    return { key: `${n.config}.${n.path.join('.')}`, kind: 'nested arm', default: def, label: n.label, owner_role: n.owner_role, reference: n.reference };
  });
}
// A switch is DARK when its default leaves the behaviour switched off: a non-secret report_config key whose default
// is exactly '0', the keys below whose "off" value is a word, every frozen lot and every nested arm whose default
// is false. Settings that only tune a dark feature (a delay, a list) are not switches and are not listed here.
const DARK_WORD_DEFAULTS = { sla_headline_definition: 'closed_only' };

function readSidecar(root = ROOT) {
  const f = path.join(root, 'docs', 'ops', 'flag-decisions.json');
  if (!fs.existsSync(f)) return { items: {} };
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  return { ...j, items: j.items || {} };
}
const _blank = (v) => v == null || (typeof v === 'string' && (v.trim() === '' || /^to be (decided|named)$/i.test(v.trim())));

/** The whole register as data (the Markdown above and the JSON below come from the same sources). */
function collect({ root = ROOT, sidecar } = {}) {
  const { DEFAULTS, _SECRET_BLANK_KEEP } = require(path.join(root, 'services', 'reportConfig'));
  const { PARAMS } = require(path.join(root, 'services', 'governancePolicy'));
  const prereq = require(path.join(root, 'services', 'switchPrereqs'));
  const prof = readProfile(fs.existsSync(PROFILE) ? fs.readFileSync(PROFILE, 'utf8') : '');
  const env = scanEnv(root);
  const isSecret = (k) => (_SECRET_BLANK_KEEP && _SECRET_BLANK_KEEP.has(k)) || (SECRET_RE.test(k) && !/ALLOW_|^REQUIRE_/.test(k));
  const side = sidecar || readSidecar(root);
  const report_config = Object.keys(DEFAULTS).sort().map((k) => {
    const p = prof.rows.get(k); const secret = isSecret(k);
    const kind = secret ? 'secret' : (/^ui_/.test(k) ? 'ui policy' : (/_enabled$|_send_enabled$/.test(k) ? 'arm switch' : 'setting'));
    const dark = !secret && (String(DEFAULTS[k]) === '0' || (k in DARK_WORD_DEFAULTS && String(DEFAULTS[k]) === DARK_WORD_DEFAULTS[k]));
    return { key: k, source: 'report_config', kind, secret, default: secret ? null : String(DEFAULTS[k]), dark,
      owner_role: p && p.owner ? p.owner : null, recommended: p ? p.recommended : null, reference: p ? p.ref : null,
      prerequisites: prereq.textFor(k) || null };
  });
  const planned = [...prof.rows.entries()].filter(([k]) => !(k in DEFAULTS)).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, p]) => ({ key: k, source: 'planned', status: p.status, default: p.today, owner_role: p.owner, reference: p.ref }));
  const governance = [...PARAMS].sort((a, b) => a.key.localeCompare(b.key)).map((p) => ({ key: p.key, source: 'governance_policy', type: p.type, default: p.default, protected: !!p.protected, site_scoped: p.siteScoped !== false,
    owner_role: prof.rows.has(p.key) ? prof.rows.get(p.key).owner : (p.key === 'governance.skip_inactive_holders' ? 'Owner (access policy)' : null) }));
  const environment = [...env.keys()].sort().map((n) => ({ key: n, source: 'environment', kind: isSecret(n) ? 'secret' : (/^SDP_|_ENABLED$|^AI_PROVIDER$|SESSION_COOKIE/.test(n) ? 'switch' : 'setting'),
    secret: isSecret(n), default_when_unset: ENV_DEFAULTS[n] ? ENV_DEFAULTS[n][0] : null, owner_role: ENV_DEFAULTS[n] ? ENV_DEFAULTS[n][1] : null, read_in: [...env.get(n)].sort() }));
  const fl = frozenLots(root);
  const pseudo = [
    ...fl.lots.map((l) => ({ key: `frozen:${l.id}`, source: 'frozen_lot', kind: 'frozen lot', default: l.today, label: l.label, commits: l.commits, files: l.files, reference: l.reference, owner_role: 'Owner (deployment)', dark: true })),
    ...nestedArms(DEFAULTS).map((n) => ({ ...n, source: 'nested_arm', dark: n.default === false })),
  ];
  // decisions: every dark row, decision fields from the sidecar only
  const darkRows = [...report_config.filter((r) => r.dark), ...pseudo.filter((r) => r.dark)];
  const known = new Set([...report_config.map((r) => r.key), ...pseudo.map((r) => r.key), ...governance.map((r) => r.key), ...environment.map((r) => r.key)]);
  const dark = darkRows.map((r) => {
    const d = side.items[r.key] || {};
    const decision = {}; for (const f of DECISION_FIELDS) decision[f] = _blank(d[f]) ? null : d[f];
    return { key: r.key, source: r.source, default: r.default, owner_role: r.owner_role || null, reference: r.reference || null,
      prerequisites: r.prerequisites || null, decision, missing: DECISION_FIELDS.filter((f) => decision[f] == null) };
  });
  const dead = Object.keys(side.items).filter((k) => !known.has(k)).sort();
  return { report_config, planned, governance, environment, pseudo, frozen_source: fl.source, dark, dead, sidecar_fields: DECISION_FIELDS };
}

function buildJson(opts = {}) {
  const c = collect(opts);
  const out = {
    generated_by: 'node tools/agent/flag-register.js (do not edit by hand; decision fields come from docs/ops/flag-decisions.json)',
    note: 'Every default is today\'s behaviour. Secrets carry no default (null). A decision field nobody filled is null — never invented. Recommended values are proposals, not approvals.',
    decision_fields: c.sidecar_fields,
    counts: { report_config: c.report_config.length, planned: c.planned.length, governance_policies: c.governance.length, environment: c.environment.length, pseudo: c.pseudo.length, dark: c.dark.length, dark_complete: c.dark.filter((d) => !d.missing.length).length },
    frozen_lots_source: c.frozen_source,
    report_config: c.report_config, planned: c.planned, governance_policies: c.governance, environment: c.environment, pseudo: c.pseudo,
    dark: c.dark, sidecar_entries_without_switch: c.dead,
  };
  return JSON.stringify(out, null, 1) + '\n';
}

/** Report-only: which dark switches still lack which decision fields. The test checks the file is CURRENT, not full. */
function buildGaps(opts = {}) {
  const c = collect(opts);
  const L = [];
  L.push('# Flag decisions — what is still missing before a dark switch can be turned on');
  L.push('');
  L.push('**Generated** by `node tools/agent/flag-register.js` from `docs/ops/flag-decisions.json` (hand-maintained) — do not');
  L.push('edit this file; fill the sidecar instead. A dark switch = a behaviour that is OFF today (default `0`, a frozen lot,');
  L.push('or a nested arm whose default is false). Turning one on is a human decision: the fields below are what that decision');
  L.push('must name. The agent fills none of them (no owner, canary site, date or business threshold is ever invented).');
  L.push('');
  const done = c.dark.filter((d) => !d.missing.length).length;
  L.push(`Dark switches: **${c.dark.length}** · with every decision field filled: **${done}** · fields: ${DECISION_FIELDS.map(code).join(', ')}.`);
  L.push('');
  if (c.dead.length) { L.push(`Sidecar entries naming no current switch (delete them): ${c.dead.map(code).join(', ')}`); L.push(''); }
  L.push('| Switch | Source | Owner role (profile) | Missing decision fields |');
  L.push('|---|---|---|---|');
  for (const d of c.dark) L.push(`| ${code(d.key)} | ${d.source} | ${cell(d.owner_role || 'to be named')} | ${d.missing.length ? d.missing.join(', ') : '— (complete)'} |`);
  L.push('');
  return L.join('\n');
}

/** --stale: expiry / decision deadline passed, and sidecar entries naming no switch. PURE given the inputs. */
function staleReport({ today, root = ROOT, sidecar } = {}) {
  const t = String(today || new Date().toISOString()).slice(0, 10);
  const c = collect({ root, sidecar });
  const side = sidecar || readSidecar(root);
  const expired = [], overdue = [];
  for (const [k, d] of Object.entries(side.items).sort(([a], [b]) => a.localeCompare(b))) {
    const exp = d && /^\d{4}-\d{2}-\d{2}/.test(String(d.expiry || '')) ? String(d.expiry).slice(0, 10) : null;
    const dl = d && /^\d{4}-\d{2}-\d{2}/.test(String(d.decision_deadline || '')) ? String(d.decision_deadline).slice(0, 10) : null;
    if (exp && exp < t) expired.push({ key: k, expiry: exp });
    if (dl && dl < t) overdue.push({ key: k, decision_deadline: dl });
  }
  return { today: t, expired, overdue, dead: c.dead };
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--stale')) {
    const tArg = argv.find((a) => a.startsWith('--today='));
    const r = staleReport({ today: tArg ? tArg.slice(8) : undefined });
    const out = [`flag decisions — stale report at ${r.today}`];
    out.push(`expired (expiry passed — review: keep, re-date or delete the switch): ${r.expired.length ? r.expired.map((x) => `${x.key} (${x.expiry})`).join(', ') : 'none'}`);
    out.push(`decision deadline passed: ${r.overdue.length ? r.overdue.map((x) => `${x.key} (${x.decision_deadline})`).join(', ') : 'none'}`);
    out.push(`sidecar entries naming no current switch (dead — delete): ${r.dead.length ? r.dead.join(', ') : 'none'}`);
    process.stdout.write(out.join('\n') + '\n');
    return argv.includes('--fail') && (r.expired.length || r.overdue.length || r.dead.length) ? 1 : 0;
  }
  const files = [[OUT, build()], [OUT_JSON, buildJson()], [OUT_GAPS, buildGaps()]];
  if (argv.includes('--check')) {
    let bad = 0;
    for (const [f, txt] of files) {
      const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n') : '';
      if (cur !== txt) { process.stderr.write(`${path.relative(ROOT, f)} is out of date — run node tools/agent/flag-register.js\n`); bad++; }
    }
    if (bad) return 1;
    process.stdout.write('flag register up to date\n');
    return 0;
  }
  for (const [f, txt] of files) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, txt);
    process.stdout.write(`written ${path.relative(ROOT, f)}\n`);
  }
  return 0;
}

module.exports = { build, buildJson, buildGaps, collect, staleReport, readSidecar, readProfile, scanEnv, frozenLots, DECISION_FIELDS, OUT, OUT_JSON, OUT_GAPS, SIDECAR, PROFILE };
if (require.main === module) process.exitCode = main();
