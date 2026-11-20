'use strict';
// Standalone runs must read the app's .env BEFORE any *-db module loads (tests/reports-cli-dotenv.test.js pattern).
if (require.main === module) require('dotenv').config({ quiet: true, path: require('path').join(__dirname, '..', '..', '.env') });
// Operator tool — plans, applies and rolls back the PROPOSED activation lots of docs/ops/switch-lots.json
// (rendered in docs/ops/SWITCH-LOTS.md). It reuses tools/agent/switch-lots.js for the lots and the dependency
// graph: there is ONE engine, this file only orders, classifies and writes.
//
//   node tools/ops/activate-switches.js --plan [--lots=L01,L02|all] [--db-url=URL] [--json]
//   node tools/ops/activate-switches.js --apply --db-url=URL --lots=L01[,L02…] [--include-outbound]
//        [--reason="…"] [--rollback-dir=DIR] [--dry-run] [--i-am-the-operator]
//   node tools/ops/activate-switches.js --rollback=FILE --db-url=URL [--force] [--i-am-the-operator]
//
// --db-url=env reads PG_URL (or DATABASE_URL) from the environment / the app's .env, so the password never sits on a
// command line (process listings and shell history keep command lines). Prefer it on a real instance.
//
// --lots accepts L01..L13, `all` (= the 13 lots) and keep groups as pseudo-lots `K:<group>` (K:outbound,
// K:armed_in_production, K:committee_policy, K:external_precondition, K:irreversible_or_destructive). Three keep
// groups are REFUSED whatever the flags: K:source_system_write (boundary: source systems are read-only),
// K:kill_switch (notifications_stop on = the opposite of activation), K:not_a_switch (settings, not behaviour).
// Retired keys (docs/ops/switch-lots.json "retire") are never written.
//
// SAFETY
//  - --apply / --rollback need --db-url; they refuse when NODE_ENV=production unless --i-am-the-operator is given.
//  - OUTBOUND switches (they send e-mail / Teams / webhooks, or call an external system) are ALWAYS skipped unless
//    --include-outbound is given explicitly.
//  - A lot is refused as a whole when one of its switches needs a prerequisite switch that is off and not applied
//    earlier in the same run (graph: tools/agent/switch-lots.js dependencies()).
//  - Every change goes through services/reportConfig.setConfig and leaves one system_log `config_changed` row
//    (services/configJournal, actor `cli:activate-switches`). A rollback file (JSON: key, from, to) is written
//    BEFORE the first write; --rollback=FILE restores the `from` values in reverse order, and skips (reports) a key
//    changed by someone else since, unless --force.
//  - Never reads or writes docs/ops/flag-decisions.json: owner, canary site and dates are human fields.
// The classification below (outbound / access / money) is an AI reading of the register text and the code, written
// to help the operator decide; it decides nothing.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const LOTS = require(path.join(ROOT, 'tools', 'agent', 'switch-lots.js'));
const ACTOR = 'cli:activate-switches';

// ---------------------------------------------------------------------------------------------------- classification
// OUTBOUND: something leaves the server. kind 'send' = e-mail / Teams / webhook / publication; 'external_call' =
// an outbound call to another system (read-only pull or directory query) that needs credentials of its own.
const OUTBOUND = Object.freeze({
  weekly_report_send_enabled: 'send', scoreboard_send_enabled: 'send', hygiene_send_enabled: 'send', asset_group_send_enabled: 'send',
  alert_external_enabled: 'send', asset_new_alert_enabled: 'send', asset_reminder_send_enabled: 'send', commitment_notify_enabled: 'send',
  handoff_notify_enabled: 'send', teams_sla_enabled: 'send', publish_cron_enabled: 'send', ppm_report_send_enabled: 'send',
  'sla_wan_config.notify.enabled': 'send',
  sync_drift_alerts: 'send',                 // services/sync/alerts.js checkDrift → sync alert path (e-mail / Teams)
  delivery_failure_alert_enabled: 'send',    // services/sync/alerts.js checkDelivery → sync alert path
  ppm_jira_sync_enabled: 'external_call', ppm_azdo_sync_enabled: 'external_call', entra_deprovision_enabled: 'external_call',
  sdp_api_write_enabled: 'external_call',
});
// ACCESS: changes who may read or write what. 'widens' = a profile gains a read or a write it did not have;
// 'narrows' = a read or a write is refused that was accepted before (lock-outs, 403/409 the users will notice).
const ACCESS = Object.freeze({
  portfolio_editor_plan_writes: ['widens', 'site editors gain plan writes on the projects of their sites'],
  commitments_enabled: ['widens', 'opens the commitments register as a new write surface'],
  ppm_project_roles_enabled: ['widens', 'project roles (pm, scheduler, resource manager, contributor) grant plan capabilities to linked team members'],
  emergency_access_enabled: ['widens', 'time-boxed emergency grants by a super_admin'],
  ppm_comments_enabled: ['widens', 'every reader of a project may write append-only comments'],
  roadmap_audience_publication_enabled: ['widens', 'public share links for site / programme roadmap snapshots'],
  portfolio_site_scope_reads: ['narrows', 'portfolio reads limited to the reader\'s sites'],
  portfolio_sensitive_projects: ['narrows', 'sensitive projects readable by admin tier, committee, owner, members and site holders only'],
  portfolio_executive_readonly: ['narrows', 'executive-only accounts get 403 on portfolio writes'],
  export_policy_strict: ['narrows', 'viewer refused on several exports; amounts only for admin tier + finance-viewer'],
  access_require_approval: ['narrows', 'role grants need an approval'],
  access_grant_expiry_job: ['narrows', 'expired grants are ended nightly'],
  auth_account_throttle_enabled: ['narrows', 'per-account failed sign-in cap (a named account can be locked out for its window)'],
  login_limit_failures_only: ['narrows', 'sign-in limiter counts failures per address + login name'],
  breakglass_timebox_enabled: ['narrows', 'break-glass sign-in needs a reason and is time-boxed'],
  site_code_shared_block: ['narrows', 'saves under a code shared by two sites refused (409)'],
  decision_lifecycle_enforced: ['narrows', 'illegal decision status jumps refused (409); done needs committee confirmation'],
  soft_delete_two_person: ['narrows', 'deletions need a second authorised person'],
  insp_action_verify_enabled: ['narrows', 'closed Critical/High actions await an independent verification'],
  entra_deprovision_apply: ['narrows', 'disables departed accounts'],
  access_recert_apply: ['narrows', 'revokes access refused at recertification'],
});
// MONEY: shows, writes, converts, certifies or claims amounts (amounts stay admin tier + finance-viewer).
const MONEY = Object.freeze(new Set([
  'ppm_evm_enabled', 'ppm_budget_periods_enabled', 'actuals_import_enabled', 'finance_currency_required', 'finance_certification_enabled',
  'benefit_value_class_enabled', 'ppm_annual_pack_enabled', 'asset_money_certify_display', 'wan_sla_claims_enabled',
  'wan_sla_require_contract_evidence', 'ppm_change_requests_enabled', 'ppm_cr_simulation_enabled', 'ppm_resources_enabled',
  'ppm_raid_enabled', 'ppm_project_report_enabled', 'ppm_simplified_view_enabled', 'exec_pack_portfolio_slide', 'ppm_mspdi_enabled',
  'roadmap_audience_publication_enabled', 'value_scoreboard_enabled', 'asset_cost_outlier_exclude', 'asset_replacement_uplift_pct',
]));
// Value that means "switched on" when it is not '1'.
const ON_VALUE = Object.freeze({ sla_headline_definition: 'incl_open', 'sla_wan_config.notify.enabled': true });
// Kill switches are tested, never required ON: a dependency on one is not a prerequisite to switch on.
const KILL = new Set(['notifications_stop']);
const REFUSED_GROUPS = Object.freeze({
  source_system_write: 'boundary: source systems are read-only (CAB / owner decision outside this tool)',
  kill_switch: 'notifications_stop on stops every notification — the opposite of activation',
  not_a_switch: 'settings or recorded facts, not behaviour switches',
});

const onValue = (k) => (k in ON_VALUE ? ON_VALUE[k] : '1');
const isNested = (k) => k.includes('.');

// ---------------------------------------------------------------------------------------------------- pure planning
function readPlan() {
  return {
    plan: JSON.parse(fs.readFileSync(LOTS.PLAN, 'utf8')),
    register: JSON.parse(fs.readFileSync(LOTS.REGISTER, 'utf8')),
  };
}

/** Pure: lots (and keep pseudo-lots) named by --lots. Throws on unknown / refused ids. */
function selectLots(plan, spec) {
  const ids = String(spec || 'all').split(',').map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const id of ids) {
    if (id === 'all') { for (const l of plan.lots) if (!out.find((o) => o.id === l.id)) out.push({ id: l.id, title: l.title, switches: l.switches.slice() }); continue; }
    if (id.startsWith('K:')) {
      const g = id.slice(2);
      if (REFUSED_GROUPS[g]) throw new Error(`${id} refused: ${REFUSED_GROUPS[g]}`);
      const grp = (plan.keep || {})[g];
      if (!grp) throw new Error(`unknown keep group ${id}`);
      out.push({ id, title: `Keep group ${g} (kept dark by the plan: ${grp.reason})`, switches: grp.switches.slice(), keep: true });
      continue;
    }
    const l = plan.lots.find((x) => x.id === id);
    if (!l) throw new Error(`unknown lot ${id}`);
    if (!out.find((o) => o.id === l.id)) out.push({ id: l.id, title: l.title, switches: l.switches.slice() });
  }
  const retired = new Set((plan.retire || []).map((r) => r.key));
  for (const l of out) {
    const bad = l.switches.filter((k) => retired.has(k) || k.startsWith('frozen:'));
    if (bad.length) throw new Error(`${l.id} names retired / pseudo keys (${bad.join(', ')}) — never written`);
  }
  return out;
}

/** Pure: hard dependency graph (kill switches removed — they are tested, not required on). */
function graph(register, plan) {
  const dark = register.report_config.filter((r) => r.dark).map((r) => r.key);
  const all = [...new Set([...dark, ...((register.pseudo || []).map((p) => p.key))])];
  const deps = LOTS.dependencies(register, plan, all);
  for (const k of Object.keys(deps)) deps[k] = deps[k].filter((d) => !KILL.has(d));
  return deps;
}

/** Pure: topological order of `keys` (deps inside the set first); ties keep the given order. */
function order(keys, deps) {
  const set = new Set(keys); const seen = new Set(); const out = []; const stack = new Set();
  const visit = (k) => {
    if (seen.has(k)) return;
    if (stack.has(k)) throw new Error(`dependency cycle through ${k}`);
    stack.add(k);
    for (const d of deps[k] || []) if (set.has(d)) visit(d);
    stack.delete(k); seen.add(k); out.push(k);
  };
  for (const k of keys) visit(k);
  return out;
}

function _getNested(cfg, key) {
  const [base, ...rest] = key.split('.');
  let o; try { o = JSON.parse((cfg && cfg[base]) || '{}'); } catch (_) { return undefined; }
  for (const p of rest) { if (o == null) return undefined; o = o[p]; }
  return o;
}
function currentValue(cfg, key) { return isNested(key) ? _getNested(cfg, key) : (cfg ? cfg[key] : undefined); }
const isOn = (cfg, key) => String(currentValue(cfg, key)) === String(onValue(key));

/** Pure: per-switch classification row. */
function classify(key, register, deps, prereqText) {
  const rc = (register.report_config || []).find((r) => r.key === key) || {};
  const acc = ACCESS[key];
  return {
    key,
    on_value: onValue(key),
    outbound: OUTBOUND[key] || null,
    access: acc ? acc[0] : null,
    access_note: acc ? acc[1] : null,
    money: MONEY.has(key),
    depends_on: deps[key] || [],
    owner_role: rc.owner_role || null,
    human_prerequisite: prereqText(key),
  };
}

/**
 * Pure: the activation plan for the selected lots against a config (`cfg` = current values).
 * Returns { steps (in write order), lots: [{id, title, status, refused_reason, switches:[…]}], skipped_outbound }.
 * A switch is applied when off, not outbound (or outbound with includeOutbound), and its lot is not refused.
 */
function buildActivation({ plan, register, lots, cfg, includeOutbound = false, prereqText = () => null }) {
  const deps = graph(register, plan);
  const selected = lots.flatMap((l) => l.switches);
  const ordered = order([...new Set(selected)], deps);
  const lotOf = new Map(); for (const l of lots) for (const k of l.switches) if (!lotOf.has(k)) lotOf.set(k, l.id);
  const willBeOn = new Set(Object.keys(cfg || {}).filter((k) => isOn(cfg, k)));
  for (const k of selected) if (isNested(k) && isOn(cfg, k)) willBeOn.add(k);
  const refused = new Map();   // lot id → reason
  const decisions = new Map();
  // Iterate to a fixed point: refusing a lot can make a later lot's prerequisite unmet.
  for (let pass = 0; pass < 20; pass++) {
    let changed = false;
    const on = new Set(willBeOn);
    decisions.clear();
    for (const k of ordered) {
      const lot = lotOf.get(k);
      const row = classify(k, register, deps, prereqText);
      if (isOn(cfg, k)) { decisions.set(k, { ...row, lot, action: 'already_on' }); continue; }
      if (refused.has(lot)) { decisions.set(k, { ...row, lot, action: 'refused_lot' }); continue; }
      if (row.outbound && !includeOutbound) { decisions.set(k, { ...row, lot, action: 'skipped_outbound' }); continue; }
      const missing = row.depends_on.filter((d) => !on.has(d));
      if (missing.length) {
        refused.set(lot, `${k} needs ${missing.join(', ')} on (off and not applied before it in this run)`);
        changed = true; break;
      }
      decisions.set(k, { ...row, lot, action: 'apply', from: currentValue(cfg, k) == null ? null : currentValue(cfg, k) });
      on.add(k);
    }
    if (!changed) break;
  }
  const steps = ordered.filter((k) => decisions.get(k) && decisions.get(k).action === 'apply').map((k) => decisions.get(k));
  const lotRows = lots.map((l) => ({
    id: l.id, title: l.title, keep: !!l.keep,
    status: refused.has(l.id) ? 'refused' : 'ok',
    refused_reason: refused.get(l.id) || null,
    switches: order(l.switches, deps).map((k) => decisions.get(k)),
  }));
  return { steps, lots: lotRows, skipped_outbound: ordered.filter((k) => decisions.get(k) && decisions.get(k).action === 'skipped_outbound') };
}

function renderPlan(act, { source }) {
  const L = [];
  L.push(`Activation plan — current values from ${source}. AI classification; nothing here is a decision or an approval.`);
  L.push('Legend: OUT=outbound (send|external_call), ACC=access (widens|narrows), $=money, dep=prerequisite switches.');
  for (const lot of act.lots) {
    L.push('');
    L.push(`== ${lot.id} ${lot.title}${lot.status === 'refused' ? `  [REFUSED: ${lot.refused_reason}]` : ''}`);
    for (const s of lot.switches) {
      const tags = [s.outbound ? `OUT:${s.outbound}` : '', s.access ? `ACC:${s.access}` : '', s.money ? '$' : ''].filter(Boolean).join(' ');
      const cur = s.action === 'apply' ? `${JSON.stringify(s.from)} -> ${JSON.stringify(s.on_value)}` : s.action;
      L.push(`  ${s.key.padEnd(40)} ${String(cur).padEnd(22)} ${tags.padEnd(22)}${s.depends_on.length ? ' dep=' + s.depends_on.join(',') : ''}`);
      if (s.access_note) L.push(`      access: ${s.access_note}`);
      if (s.human_prerequisite) L.push(`      human prerequisite: ${s.human_prerequisite}`);
    }
  }
  L.push('');
  L.push(`Write order (${act.steps.length} switch(es)): ${act.steps.map((s) => s.key).join(' → ') || '(none)'}`);
  if (act.skipped_outbound.length) L.push(`Outbound, skipped without --include-outbound: ${act.skipped_outbound.join(', ')}`);
  return L.join('\n') + '\n';
}

// ---------------------------------------------------------------------------------------------------- args + IO
function parseArgs(argv) {
  const o = { plan: false, apply: false, json: false, dryRun: false, includeOutbound: false, operator: false, force: false };
  for (const a of argv || []) {
    if (a === '--plan') o.plan = true;
    else if (a === '--apply') o.apply = true;
    else if (a === '--json') o.json = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--include-outbound') o.includeOutbound = true;
    else if (a === '--i-am-the-operator') o.operator = true;
    else if (a === '--force') o.force = true;
    else if (a.startsWith('--lots=')) o.lots = a.slice(7);
    else if (a.startsWith('--db-url=')) o.dbUrl = a.slice(9) === 'env' ? (process.env.PG_URL || process.env.DATABASE_URL || '') : a.slice(9);
    else if (a.startsWith('--rollback=')) o.rollback = a.slice(11);
    else if (a.startsWith('--rollback-dir=')) o.rollbackDir = a.slice(15);
    else if (a.startsWith('--reason=')) o.reason = a.slice(9);
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

/** Pure: a reason to refuse a write in this environment, or null. */
function writeRefusal(args, env) {
  if (!args.dbUrl) return '--db-url is required for --apply / --rollback';
  if (env.NODE_ENV === 'production' && !args.operator) return 'NODE_ENV=production: add --i-am-the-operator (a human operator action)';
  return null;
}

function redactUrl(u) {
  try { const x = new URL(String(u || '')); if (x.password) x.password = '***'; return x.toString(); } catch (_) { return '(unparsable url)'; }
}

async function defaultDeps(dbUrl) {
  process.env.PG_URL = dbUrl;
  const rdb = require(path.join(ROOT, 'reports-db'));
  await rdb.initPgReports();
  const reportConfig = require(path.join(ROOT, 'services', 'reportConfig'));
  return {
    getConfig: () => reportConfig.getConfig(rdb.db),
    setConfig: (patch) => reportConfig.setConfig(rdb.db, patch, ACTOR),
    logEvent: (ev) => rdb.logEvent(ev),
    log: (s) => process.stdout.write(s + '\n'),
  };
}

function patchFor(cfg, key, value) {
  if (!isNested(key)) return { [key]: String(value) };
  const [base, ...rest] = key.split('.');
  let o; try { o = JSON.parse(cfg[base] || '{}'); } catch (_) { o = {}; }
  let cur = o; for (const p of rest.slice(0, -1)) { if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {}; cur = cur[p]; }
  cur[rest[rest.length - 1]] = value;
  return { [base]: JSON.stringify(o) };
}

async function writeOne(d, key, value, reason) {
  const cfg = await d.getConfig();
  const patch = patchFor(cfg, key, value);
  await d.setConfig(patch);
  if (d.logEvent) {
    const J = require(path.join(ROOT, 'services', 'configJournal'));
    // logEvent is fire-and-forget in the app; a CLI exits right after, so wait for the rows to land.
    const pending = [];
    J.journal((ev) => { pending.push(Promise.resolve().then(() => d.logEvent(ev)).catch(() => {})); }, J.diffConfig(cfg, patch), { actor: ACTOR }, reason || `activate-switches ${key}`);
    await Promise.all(pending);
  }
}

async function main(argv, deps) {
  const args = parseArgs(argv);
  const { plan, register } = readPlan();
  const prereqText = require(path.join(ROOT, 'services', 'switchPrereqs')).textFor;

  if (args.rollback) {
    const why = writeRefusal(args, process.env); if (why) throw new Error(why);
    const d = deps || await defaultDeps(args.dbUrl);
    const rb = JSON.parse(fs.readFileSync(args.rollback, 'utf8'));
    const res = { restored: [], conflicts: [] };
    for (const e of [...(rb.entries || [])].reverse()) {
      const cfg = await d.getConfig();
      const cur = currentValue(cfg, e.key);
      if (String(cur) !== String(e.to) && !args.force) { res.conflicts.push({ key: e.key, expected: e.to, found: cur == null ? null : cur }); continue; }
      await writeOne(d, e.key, e.from == null ? (isNested(e.key) ? false : '0') : e.from, `rollback ${path.basename(args.rollback)}`);
      res.restored.push(e.key);
    }
    d.log(`Rollback: restored ${res.restored.length} key(s)${res.conflicts.length ? `; ${res.conflicts.length} changed since, left alone (re-run with --force): ${res.conflicts.map((c) => c.key).join(', ')}` : ''}.`);
    return res;
  }

  const lots = selectLots(plan, args.lots || 'all');
  if (args.apply) {
    const why = writeRefusal(args, process.env); if (why) throw new Error(why);
    const d = deps || await defaultDeps(args.dbUrl);
    const cfg = await d.getConfig();
    const act = buildActivation({ plan, register, lots, cfg, includeOutbound: args.includeOutbound, prereqText });
    d.log(renderPlan(act, { source: redactUrl(args.dbUrl) }).trimEnd());
    for (const l of act.lots.filter((x) => x.status === 'refused')) d.log(`REFUSED ${l.id}: ${l.refused_reason}`);
    if (args.dryRun) { d.log('DRY RUN — nothing written.'); return { ...act, applied: [], rollback_file: null }; }
    if (!act.steps.length) { d.log('Nothing to apply.'); return { ...act, applied: [], rollback_file: null }; }
    const dir = args.rollbackDir || path.join(ROOT, 'data', 'switch-rollbacks');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `rollback-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    const entries = act.steps.map((s) => ({ key: s.key, lot: s.lot, from: s.from == null ? null : s.from, to: s.on_value }));
    fs.writeFileSync(file, JSON.stringify({ created_at: new Date().toISOString(), actor: ACTOR, db: redactUrl(args.dbUrl), lots: lots.map((l) => l.id), entries }, null, 1) + '\n');
    const applied = [];
    for (const s of act.steps) { await writeOne(d, s.key, s.on_value, args.reason); applied.push(s.key); }
    d.log(`Applied ${applied.length} switch(es). Rollback file: ${file}`);
    return { ...act, applied, rollback_file: file };
  }

  // --plan (default)
  let cfg; let source;
  if (args.dbUrl) { const d = deps || await defaultDeps(args.dbUrl); cfg = await d.getConfig(); source = redactUrl(args.dbUrl); }
  else { cfg = { ...require(path.join(ROOT, 'services', 'reportConfig')).DEFAULTS }; source = 'the code defaults (no database read; pass --db-url to read one)'; }
  const act = buildActivation({ plan, register, lots, cfg, includeOutbound: args.includeOutbound, prereqText });
  const log = (deps && deps.log) || ((s) => process.stdout.write(s));
  log(args.json ? JSON.stringify(act, null, 1) + '\n' : renderPlan(act, { source }));
  return act;
}

module.exports = { OUTBOUND, ACCESS, MONEY, ON_VALUE, REFUSED_GROUPS, selectLots, graph, order, classify, buildActivation, renderPlan, parseArgs, writeRefusal, patchFor, currentValue, isOn, main };

if (require.main === module) {
  main(process.argv.slice(2))
    .then(() => process.exit(0))
    .catch((e) => { process.stderr.write(`[activate-switches] ${e.message}\n`); process.exit(1); });
}
