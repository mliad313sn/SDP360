'use strict';
// C-09 (G33) — flag register: ONE file listing every behaviour switch with its default (= today's behaviour),
// owner, and rollback. Generated, never hand-edited, so it cannot drift from the code:
//
//   node tools/agent/flag-register.js            writes docs/ops/FLAG-REGISTER.md
//   node tools/agent/flag-register.js --check    exits 1 when the committed file is out of date
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
  return L.join('\n');
}

function main(argv = process.argv.slice(2)) {
  const md = build();
  if (argv.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
    if (cur !== md) { process.stderr.write('docs/ops/FLAG-REGISTER.md is out of date — run node tools/agent/flag-register.js\n'); return 1; }
    process.stdout.write('flag register up to date\n');
    return 0;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, md);
  process.stdout.write(`written ${path.relative(ROOT, OUT)}\n`);
  return 0;
}

module.exports = { build, readProfile, scanEnv, OUT, PROFILE };
if (require.main === module) process.exitCode = main();
