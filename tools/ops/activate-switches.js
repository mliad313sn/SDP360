'use strict';
// Standalone runs must read the app's .env BEFORE any *-db module loads (tests/reports-cli-dotenv.test.js pattern).
if (require.main === module) require('dotenv').config({ quiet: true, path: require('path').join(__dirname, '..', '..', '.env') });
// Operator tool — plans, applies and rolls back the PROPOSED activation lots of docs/ops/switch-lots.json
// (rendered in docs/ops/SWITCH-LOTS.md). It reuses tools/agent/switch-lots.js for the lots and the dependency
// graph: there is ONE engine, this file only orders, classifies and writes.
//
//   node tools/ops/activate-switches.js --plan [--lots=L01,L02|all] [--db-url=URL] [--json]
//   node tools/ops/activate-switches.js --apply --db-url=URL --lots=L01[,L02…] --reason="…" [--operator=NAME]
//        [--operator-token=env|env:VAR|file:PATH] [--include-outbound] [--rollback-dir=DIR] [--dry-run] [--i-am-the-operator]
//   node tools/ops/activate-switches.js --rollback=FILE --db-url=URL [--operator=NAME] [--operator-token=…] [--reason="…"] [--force] [--i-am-the-operator]
//        [--accept-unsealed]   (a legacy rollback file without HMAC seal while SDP_CONFIG_KEY / SDP_BACKUP_KEY is set)
//
// --db-url=env reads PG_URL (or DATABASE_URL) from the environment / the app's .env, so the password never sits on a
// command line (process listings and shell history keep command lines). Prefer it on a real instance.
//
// --lots accepts the lot ids of docs/ops/switch-lots.json (L01..L14), `all` (= every lot) and keep groups as pseudo-lots `K:<group>` (K:outbound,
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
//  - P11 r4 R4-A4: --apply (unless --dry-run) REQUIRES an explicit --lots (no implicit "all") and a --reason of at
//    least 10 characters. The operator's identity (--operator=NAME, else the OS user) is recorded on every journal
//    row (actor `cli:activate-switches:<operator>`), in report_config.updated_by and in the rollback file. The name is
//    DECLARED: the OS account and host that ran the tool are recorded beside it (rollback file + switch_rollback_file
//    event, P11 r5) so it can be checked. Rollback files carry a sha256 CHECKSUM (recorded in system_log) and, when
//    SDP_CONFIG_KEY or SDP_BACKUP_KEY is set, an HMAC-SHA256 SEAL — without a key they are checksummed, not signed.
//  - P11 r4 R4-A3: a rollback file carries a sha256 of its content, recorded in system_log
//    (category config, action switch_rollback_file, target = the hash) when the tool writes it. --rollback refuses
//    a file whose hash does not match or was never recorded, any key outside the file's own lots, any key of a
//    refused keep group or a retired key, an entry whose `to` is not the switch's ON value, and a non-flag `from`.
//    --force overrides only the "changed since" conflict check, never this validation.
//  - Never reads or writes docs/ops/flag-decisions.json: owner, canary site and dates are human fields.
//  - P11 r5 N-15 — FOUR-EYES: a step whose change docs/ops/policy-catalogue.json marks as needing a second super_admin
//    (policyCatalogue.needsSecondPerson — the same rule as the Policy Center) is tagged 4EYES in the plan. --apply
//    refuses such a step unless (a) --second-operator=NAME names a DIFFERENT person (look-alike spellings fold; both are
//    recorded on every journal row of those keys, in the switch_rollback_file event and in the checksummed (HMAC-sealed when a key is set) rollback file),
//    or (b) report_config policy_center_enabled = '1': the tool then writes NOTHING for those keys and files one Policy
//    Center request per key instead (requested by the --operator account, which must be an active super_admin); a
//    second super_admin decides in the center. Rolling back a four-eyes key towards its weaker side needs
//    --second-operator too. Lots without four-eyes steps behave exactly as before.
//  - P11 r6 R6-A1 — SUPERSEDES the paragraph above for four-eyes steps: a typed name is not an authenticated person
//    (one super_admin filed a request "as" a colleague with --operator=<colleague> and approved it himself). Now:
//    (a) --second-operator is REFUSED — the tool never applies a four-eyes change itself, whatever the names;
//    (b) four-eyes steps need policy_center_enabled = '1' AND --operator-token: a one-time token (10 minutes) that the
//        logged-in super_admin issues for HIS OWN account in /policy-center.html ("CLI operator token"). The tool
//        consumes it and files one Policy Center request per four-eyes key with THAT account as requester (the reason
//        records the token id, OS user and host). --operator, when given, must be the token's account.
//    (c) the approval stays an act of ANOTHER logged-in super_admin in the web Policy Center, which already refuses the
//        requester and any account that is not independent of it (services/approverProvenance.js).
//    The token is read from the environment (SDP_OPERATOR_TOKEN, or env:VAR) or a file (file:PATH), never from the
//    command line itself. Rolling back a four-eyes key towards its weaker side goes through the same path (a request,
//    not a write). Lots without four-eyes steps behave exactly as before (single operator, OS user + host recorded).
// The classification below (outbound / access / money) is an AI reading of the register text and the code, written
// to help the operator decide; it decides nothing.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const LOTS = require(path.join(ROOT, 'tools', 'agent', 'switch-lots.js'));
const ACTOR = 'cli:activate-switches';
const crypto = require('crypto');
const MIN_REASON = 10;
const actorOf = (operator) => (operator ? `${ACTOR}:${String(operator).replace(/[^\w.@-]/g, '_').slice(0, 64)}` : ACTOR);
function osOperator() { try { return require('os').userInfo().username || null; } catch (_) { return process.env.USERNAME || process.env.USER || null; } }
// P11 r5 R5-A6 — the declared --operator is free text; the OS account and host that ran the tool are recorded beside it
// (rollback file + journal event) so the declared name can be checked against who actually ran the command.
function osIdentity() {
  const os = require('os');
  let user = null; try { user = os.userInfo().username || null; } catch (_) { user = process.env.USERNAME || process.env.USER || null; }
  let host = null; try { host = os.hostname() || null; } catch (_) { host = null; }
  const clean = (v) => (v == null ? null : String(v).replace(/[^\w.@ -]/g, '_').slice(0, 64));
  return { os_user: clean(user), host: clean(host) };
}

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
  L.push('Legend: 4EYES=a second super_admin is required (--second-operator, or a Policy Center request), OUT=outbound (send|external_call), ACC=access (widens|narrows), $=money, dep=prerequisite switches.');
  for (const lot of act.lots) {
    L.push('');
    L.push(`== ${lot.id} ${lot.title}${lot.status === 'refused' ? `  [REFUSED: ${lot.refused_reason}]` : ''}`);
    for (const s of lot.switches) {
      const tags = [s.four_eyes ? '4EYES' : '', s.outbound ? `OUT:${s.outbound}` : '', s.access ? `ACC:${s.access}` : '', s.money ? '$' : ''].filter(Boolean).join(' ');
      const cur = s.action === 'apply' ? `${JSON.stringify(s.from)} -> ${JSON.stringify(s.on_value)}` : s.action;
      L.push(`  ${s.key.padEnd(40)} ${String(cur).padEnd(22)} ${tags.padEnd(22)}${s.depends_on.length ? ' dep=' + s.depends_on.join(',') : ''}`);
      if (s.access_note) L.push(`      access: ${s.access_note}`);
      if (s.human_prerequisite) L.push(`      human prerequisite: ${s.human_prerequisite}`);
    }
  }
  L.push('');
  L.push(`Write order (${act.steps.length} switch(es)): ${act.steps.map((s) => s.key).join(' → ') || '(none)'}`);
  if (act.skipped_outbound.length) L.push(`Outbound, skipped without --include-outbound: ${act.skipped_outbound.join(', ')}`);
  const fe = act.steps.filter((x) => x.four_eyes).map((x) => x.key);
  if (fe.length) L.push(`Four-eyes (second super_admin required): ${fe.join(', ')}`);
  return L.join('\n') + '\n';
}

// ---------------------------------------------------------------------------------------------------- four-eyes (N-15)
/** Raw report_config value of the key a switch writes (the base key for a nested switch), after a hypothetical write. */
function _baseValues(cfg, key, value) {
  const base = isNested(key) ? key.split('.')[0] : key;
  const cur = cfg ? cfg[base] : undefined;
  const next = patchFor(cfg || {}, key, value)[base];
  return { base, cur: cur == null ? '' : String(cur), next: next == null ? '' : String(next) };
}
/** Pure: does writing `value` to switch `key` need a second super_admin (Policy Center rule)? */
function needsFourEyes(cfg, key, value, catalogue) {
  const PC = require(path.join(ROOT, 'services', 'policyCatalogue'));
  const cat = catalogue || PC.build();
  const { base, cur, next } = _baseValues(cfg, key, value);
  return PC.needsSecondPerson(cat.by.get(base), cur, next);
}
/** Mark every apply step whose change needs a second person (mutates the step rows, shared with the lot rows). */
function markFourEyes(act, cfg, catalogue) {
  for (const s of act.steps) s.four_eyes = needsFourEyes(cfg, s.key, s.on_value, catalogue);
  return act;
}
/** Pure: the second operator is a real, different person, or a reason to refuse. */
function secondOperatorRefusal(operator, second) {
  const sk = require(path.join(ROOT, 'services', 'commitmentLifecycle')).skeletonKey;
  if (!second || !String(second).trim()) return 'missing';
  if (!operator || !String(operator).trim()) return 'the first operator is unknown (pass --operator=NAME)';
  if (sk(operator) && sk(operator) === sk(second)) return `--second-operator "${second}" is the same person as --operator "${operator}"`;
  return null;
}
/**
 * P11 r6 O-4 — the second operator is no longer free text: it must name an ACTIVE super_admin ACCOUNT (looked up in the
 * database), a different account from the --operator one, and a different person by the identity rules (skeletonKey
 * folds case, dots, look-alike letters). Returns { id, username, name } or throws — the caller has written nothing yet.
 */
async function resolveSecondOperator(d, operator, second) {
  const r = secondOperatorRefusal(operator, second);
  if (r) return { refusal: r };
  if (typeof d.operatorAccount !== 'function') return { refusal: 'the second operator cannot be checked against the user accounts (no account lookup in this run)' };
  const acct = await d.operatorAccount(String(second).trim());
  if (!acct) return { refusal: `--second-operator "${second}" is not the username of an active super_admin account` };
  const sk = require(path.join(ROOT, 'services', 'commitmentLifecycle')).skeletonKey;
  // look-alike fold (skeletonKey) plus punctuation and an e-mail domain: "a.smith", "asmith@corp" and "ASMITH" are one person
  const loose = (x) => sk(x).replace(/@.*$/, '').replace(/[^\p{L}\p{N}]/gu, '');
  const first = await d.operatorAccount(String(operator).trim());
  if ((first && Number(first.id) === Number(acct.id)) || (loose(acct.username) && loose(acct.username) === loose(operator))) {
    return { refusal: `--second-operator "${second}" is the same person as --operator "${operator}"` };
  }
  return { account: acct };
}
// ---- P11 r6 R6-A1: authenticated requester (operator token) ---------------------------------------------------------
/** Pure-ish: read the token named by --operator-token (env | env:VAR | file:PATH). A literal token is refused. */
function readOperatorToken(spec, env = process.env) {
  if (!spec) return { refusal: 'missing' };
  const s = String(spec);
  if (s === 'env' || s.startsWith('env:')) {
    const name = s === 'env' ? 'SDP_OPERATOR_TOKEN' : s.slice(4);
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) return { refusal: `--operator-token=env:${name}: not an environment variable name` };
    const v = String(env[name] || '').trim();
    return v ? { token: v } : { refusal: `--operator-token: ${name} is empty` };
  }
  if (s.startsWith('file:')) {
    try { const v = fs.readFileSync(s.slice(5), 'utf8').trim(); return v ? { token: v } : { refusal: '--operator-token: the file is empty' }; }
    catch (e) { return { refusal: `--operator-token: cannot read ${s.slice(5)} (${e.code || e.message})` }; }
  }
  return { refusal: '--operator-token takes env, env:VAR or file:PATH — never the token itself (command lines are kept in process listings and shell history)' };
}
/**
 * Authenticate the person running the tool from the operator token. Returns { account, token_id } or { refusal }.
 * consume:false (dry run) checks without burning the token.
 */
async function authenticateOperator(d, args, { consume = true, consumedBy = null } = {}) {
  const t = readOperatorToken(args.operatorToken);
  if (t.refusal) return { refusal: t.refusal === 'missing' ? 'add --operator-token=env (issue a one-time token for YOUR account in /policy-center.html, "CLI operator token", and put it in SDP_OPERATOR_TOKEN)' : t.refusal };
  if (typeof d.checkOperatorToken !== 'function' || typeof d.operatorAccountById !== 'function') return { refusal: 'this run cannot verify operator tokens' };
  const c = await d.checkOperatorToken(t.token, { consume, consumedBy });
  if (!c || c.refusal) return { refusal: (c && c.refusal) || 'operator token refused' };
  const acct = await d.operatorAccountById(c.user_id);
  if (!acct) return { refusal: `the operator token belongs to "${c.username}", which is no longer an active super_admin` };
  if (args.operatorName && String(args.operatorName).trim().toLowerCase() !== String(acct.username).toLowerCase()) {
    return { refusal: `--operator "${args.operatorName}" is not the account that issued the operator token ("${acct.username}") — the requester of record is the authenticated account` };
  }
  return { account: acct, token_id: c.id };
}
const SECOND_OPERATOR_REFUSED = '--second-operator is no longer accepted (P11 r6 R6-A1): a typed name is not a second person. Turn the Policy Center on, run with --operator-token=env, and let another super_admin approve the request in /policy-center.html';
const _filedReason = (reason, tokenId, ident) => `${reason} [filed by activate-switches; authenticated by operator token #${tokenId}; os ${ident.os_user || '?'}@${ident.host || '?'}]`;

const _withSecond = (reason, second) => `${reason} [four-eyes, second operator: ${String(second).replace(/[^\w.@ -]/g, '_').slice(0, 64)}]`;

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
    else if (a === '--accept-unsealed') o.acceptUnsealed = true;
    else if (a === '--force') o.force = true;
    else if (a.startsWith('--lots=')) o.lots = a.slice(7);
    else if (a.startsWith('--db-url=')) o.dbUrl = a.slice(9) === 'env' ? (process.env.PG_URL || process.env.DATABASE_URL || '') : a.slice(9);
    else if (a.startsWith('--rollback=')) o.rollback = a.slice(11);
    else if (a.startsWith('--rollback-dir=')) o.rollbackDir = a.slice(15);
    else if (a.startsWith('--reason=')) o.reason = a.slice(9);
    else if (a.startsWith('--operator=')) o.operatorName = a.slice(11);
    else if (a.startsWith('--second-operator=')) o.secondOperator = a.slice(18);
    else if (a.startsWith('--operator-token=')) o.operatorToken = a.slice(17);
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

/** Pure (R4-A4): what --apply is missing before it may write, or null. */
function applyRefusal(args) {
  if (args.dryRun) return null;
  if (!args.lots || !String(args.lots).trim()) return '--apply needs an explicit --lots=L01[,L02…] (there is no implicit "all")';
  if (String(args.reason || '').replace(/\s+/g, ' ').trim().length < MIN_REASON) return `--apply needs --reason="…" of at least ${MIN_REASON} characters (why, ticket / CAB reference)`;
  return null;
}

// ---------------------------------------------------------------------------------------------------- rollback files
// The second operator (and, since P11 r5, the OS user + host) join the checksummed content only when present, so files
// written before keep their hash.
function _canon(rb) { return JSON.stringify({ created_at: rb.created_at, actor: rb.actor, operator: rb.operator || null, ...(rb.second_operator ? { second_operator: rb.second_operator } : {}), ...(rb.second_operator_id != null ? { second_operator_id: rb.second_operator_id } : {}), ...(rb.os_user !== undefined ? { os_user: rb.os_user, host: rb.host } : {}), lots: rb.lots, entries: rb.entries }); }
/** Unkeyed sha256 CHECKSUM of the content (what --apply records in system_log). An integrity check, not a signature. */
function rollbackHash(rb) { return crypto.createHash('sha256').update(_canon(rb)).digest('hex'); }
// P11 r5 R5-A4 — a real keyed seal when the server has a secret: HMAC-SHA256 under SDP_CONFIG_KEY (else SDP_BACKUP_KEY),
// ≥ 16 characters, domain-separated. Someone who can write system_log but does not hold the .env key cannot forge it.
function rollbackKey(env = process.env) {
  for (const k of ['SDP_CONFIG_KEY', 'SDP_BACKUP_KEY']) { const v = String(env[k] || ''); if (v.length >= 16) return { name: k, key: crypto.createHash('sha256').update('sdp-rollback-hmac:' + v).digest() }; }
  return null;
}
function rollbackHmac(rb, key) { return crypto.createHmac('sha256', key.key).update(_canon(rb)).digest('hex'); }
/** Pure: problems (refusals) and warnings about the keyed seal of a rollback file. */
function sealCheck(rb, env = process.env, opts = {}) {
  const k = rollbackKey(env);
  if (rb.hmac) {
    if (!k) return { problems: ['the file is HMAC-sealed but neither SDP_CONFIG_KEY nor SDP_BACKUP_KEY is configured here — cannot verify'], warnings: [] };
    const want = rollbackHmac(rb, k);
    const a = Buffer.from(String(rb.hmac)), b = Buffer.from(want);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { problems: ['HMAC does not match (edited by hand, or sealed under another key)'], warnings: [] };
    return { problems: [], warnings: [] };
  }
  // a key is configured here, so this tool would have sealed the file: an unsealed one is refused unless the operator
  // explicitly accepts a legacy file (--accept-unsealed), which is then logged as a warning
  if (k && !opts.acceptUnsealed) return { problems: [`the file carries no HMAC seal although ${k.name} is configured (a file written before the seal existed needs --accept-unsealed)`], warnings: [] };
  return { problems: [], warnings: ['legacy / unsealed rollback file: integrity is checked by its sha256 checksum and the system_log record only — it is NOT signed' + (k ? '' : ' (no SDP_CONFIG_KEY / SDP_BACKUP_KEY configured, so new files are checksummed only)')] };
}
const FLAG_VALUE = (v) => v === null || typeof v === 'boolean' || (typeof v === 'string' && /^[\w.:-]{0,40}$/.test(v));

/** Pure (R4-A3): problems with a rollback file against the plan (empty = valid content; the hash is checked apart). */
function validateRollback(rb, plan) {
  const out = [];
  if (!rb || !Array.isArray(rb.entries) || !Array.isArray(rb.lots)) return ['not a rollback file written by this tool (entries / lots missing)'];
  if (!rb.sha256 || rb.sha256 !== rollbackHash(rb)) out.push('sha256 missing or does not match the file content (edited by hand?)');
  let lots = [];
  try { lots = selectLots(plan, rb.lots.join(',')); } catch (e) { out.push(`lots refused: ${e.message}`); }
  const allowed = new Set(lots.flatMap((l) => l.switches));
  const refused = new Set(Object.keys(REFUSED_GROUPS).flatMap((g) => ((plan.keep || {})[g] || { switches: [] }).switches || []));
  const retired = new Set((plan.retire || []).map((r) => r.key));
  for (const e of rb.entries) {
    const k = e && e.key;
    if (typeof k !== 'string') { out.push('an entry has no key'); continue; }
    if (refused.has(k)) out.push(`${k}: in a refused keep group — never written by this tool`);
    else if (retired.has(k) || k.startsWith('frozen:')) out.push(`${k}: retired / pseudo key — never written`);
    else if (!allowed.has(k)) out.push(`${k}: not a switch of the file's lots (${rb.lots.join(',')})`);
    if (String(e.to) !== String(onValue(k))) out.push(`${k}: "to" ${JSON.stringify(e.to)} is not the switch's ON value`);
    if (!FLAG_VALUE(e.from)) out.push(`${k}: "from" ${JSON.stringify(e.from)} is not a switch value`);
  }
  return out;
}

function redactUrl(u) {
  try { const x = new URL(String(u || '')); if (x.password) x.password = '***'; return x.toString(); } catch (_) { return '(unparsable url)'; }
}

async function defaultDeps(dbUrl, operator) {
  process.env.PG_URL = dbUrl;
  const rdb = require(path.join(ROOT, 'reports-db'));
  await rdb.initPgReports();
  const reportConfig = require(path.join(ROOT, 'services', 'reportConfig'));
  return {
    getConfig: () => reportConfig.getConfig(rdb.db),
    setConfig: (patch) => reportConfig.setConfig(rdb.db, patch, actorOf(operator)),
    logEvent: (ev) => rdb.logEvent(ev),
    log: (s) => process.stdout.write(s + '\n'),
    ...storedDeps(rdb),
  };
}

// P11 r4 — which keys have a ROW in report_config (getConfig folds DEFAULTS in, so it cannot tell "stored at the
// default" from "absent"), and how to remove a row so the key follows its default again.
function storedDeps(rdb) {
  return {
    storedKeys: async () => new Set((await rdb.pgHandle().prepare('SELECT key FROM report_config').all()).map((r) => r.key)),
    unsetConfig: async (key) => { await rdb.pgHandle().prepare('DELETE FROM report_config WHERE key = ?').run(key); },
    rollbackKnown: async (sha) => !!(await rdb.pgHandle().prepare(
      "SELECT 1 AS ok FROM system_log WHERE category = 'config' AND action = 'switch_rollback_file' AND target = ? LIMIT 1").get(sha)),
    // N-15 — Policy Center mode: the --operator account (an active super_admin) files one request per four-eyes key.
    operatorAccount: async (name) => {
      const u = await rdb.pgHandle().prepare('SELECT id, username, full_name, active FROM users WHERE lower(username) = lower(?)').get(String(name || ''));
      if (!u || Number(u.active) === 0) return null;
      const roles = await rdb.getUserRoles(u.id);
      return roles.includes('super_admin') ? { id: Number(u.id), username: u.username, name: u.full_name } : null;
    },
    // P11 r6 R6-A1 — operator tokens (services/operatorTokens.js) and the account behind them
    checkOperatorToken: async (token, opts) => require(path.join(ROOT, 'services', 'operatorTokens')).check(rdb.pgHandle(), token, opts),
    operatorAccountById: async (id) => {
      const u = await rdb.pgHandle().prepare('SELECT id, username, full_name, active FROM users WHERE id = ?').get(Number(id));
      if (!u || Number(u.active) === 0) return null;
      const roles = await rdb.getUserRoles(u.id);
      return roles.includes('super_admin') ? { id: Number(u.id), username: u.username, name: u.full_name } : null;
    },
    createPolicyRequest: async (req) => require(path.join(ROOT, 'services', 'policyChangeStore')).makePolicyChangeStore(() => rdb.pgHandle()).create(req),
  };
}

const UNSET = Symbol('unset');   // remove a nested sub-key instead of writing a value
function patchFor(cfg, key, value) {
  if (!isNested(key)) return { [key]: String(value) };
  const [base, ...rest] = key.split('.');
  let o; try { o = JSON.parse(cfg[base] || '{}'); } catch (_) { o = {}; }
  let cur = o; for (const p of rest.slice(0, -1)) { if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {}; cur = cur[p]; }
  if (value === UNSET) delete cur[rest[rest.length - 1]]; else cur[rest[rest.length - 1]] = value;
  return { [base]: JSON.stringify(o) };
}

// P11 r4 — return a flat key to "absent" (it follows its default again) and journal the change.
async function unsetOne(d, key, reason) {
  const cfg = await d.getConfig();
  await d.unsetConfig(key);
  if (d.logEvent) {
    const after = await d.getConfig();
    const J = require(path.join(ROOT, 'services', 'configJournal'));
    const pending = [];
    J.journal((ev) => { pending.push(Promise.resolve().then(() => d.logEvent(ev)).catch(() => {})); },
      J.diffConfig(cfg, { [key]: after[key] == null ? '' : after[key] }), { actor: actorOf(d.operator) }, (reason || `rollback ${key}`) + ' (returned to default)');
    await Promise.all(pending);
  }
}

async function writeOne(d, key, value, reason) {
  const cfg = await d.getConfig();
  const patch = patchFor(cfg, key, value);
  await d.setConfig(patch);
  if (d.logEvent) {
    const J = require(path.join(ROOT, 'services', 'configJournal'));
    // logEvent is fire-and-forget in the app; a CLI exits right after, so wait for the rows to land.
    const pending = [];
    J.journal((ev) => { pending.push(Promise.resolve().then(() => d.logEvent(ev)).catch(() => {})); }, J.diffConfig(cfg, patch), { actor: actorOf(d.operator) }, reason || `activate-switches ${key}`);
    await Promise.all(pending);
  }
}

async function main(argv, deps) {
  const args = parseArgs(argv);
  const { plan, register } = readPlan();
  const prereqText = require(path.join(ROOT, 'services', 'switchPrereqs')).textFor;

  if (args.rollback) {
    const why = writeRefusal(args, process.env); if (why) throw new Error(why);
    const operator = args.operatorName || osOperator();
    const d = { ...(deps || await defaultDeps(args.dbUrl, operator)), operator };
    const rb = JSON.parse(fs.readFileSync(args.rollback, 'utf8'));
    const problems = validateRollback(rb, plan);
    const seal = sealCheck(rb, process.env, { acceptUnsealed: !!args.acceptUnsealed });
    problems.push(...seal.problems);
    for (const w of seal.warnings) d.log(`WARNING: ${w}`);
    if (!problems.length) {
      if (typeof d.rollbackKnown !== 'function') problems.push('cannot verify the file against system_log (no verifier) — refused');
      else if (!(await d.rollbackKnown(rb.sha256))) problems.push('this file\'s sha256 was never recorded in system_log by --apply — refused');
    }
    if (problems.length) throw new Error(`rollback file refused: ${problems.join('; ')}`);
    // N-15 — restoring a four-eyes key towards its weaker side needs a second person too.
    const cfg0 = await d.getConfig();
    const feBack = (rb.entries || []).filter((e) => {
      const target = (e.absent === true || e.from == null) ? (isNested(e.key) ? null : require(path.join(ROOT, 'services', 'reportConfig')).DEFAULTS[e.key]) : e.from;
      return target != null && needsFourEyes(cfg0, e.key, target);
    }).map((e) => e.key);
    // P11 r6 R6-A1 — a four-eyes key is never written back by the tool: it becomes a Policy Center request filed by the
    // authenticated operator; another super_admin decides in the web center.
    const res = { restored: [], conflicts: [], requested: [], second_operator: null, second_operator_id: null };
    if (feBack.length) {
      if (args.secondOperator) throw new Error(`rollback of four-eyes key(s) ${feBack.join(', ')}: ${SECOND_OPERATOR_REFUSED} — nothing restored`);
      if (String(cfg0.policy_center_enabled) !== '1') throw new Error(`rollback of four-eyes key(s) ${feBack.join(', ')} needs a second super_admin: turn the Policy Center on (policy_center_enabled) — the tool files requests, another super_admin approves them in /policy-center.html — nothing restored`);
      if (typeof d.createPolicyRequest !== 'function') throw new Error('Policy Center is on but this run cannot file requests — nothing restored');
      const ident = (deps && deps.osIdentity) ? deps.osIdentity : osIdentity();
      const au = await authenticateOperator(d, args, { consume: true, consumedBy: `activate-switches rollback ${ident.os_user || '?'}@${ident.host || '?'}` });
      if (au.refusal) throw new Error(`rollback of four-eyes key(s) ${feBack.join(', ')}: ${au.refusal} — nothing restored`);
      for (const e of rb.entries.filter((x) => feBack.includes(x.key))) {
        const target = (e.absent === true || e.from == null) ? require(path.join(ROOT, 'services', 'reportConfig')).DEFAULTS[e.key] : e.from;
        const { base, cur, next } = _baseValues(cfg0, e.key, target);
        const req = await d.createPolicyRequest({ key: base, oldValue: cur, newValue: next, reason: _filedReason(`rollback ${path.basename(args.rollback)}${args.reason ? ` — ${args.reason}` : ''}`, au.token_id, ident), actor: au.account, origin: 'cli', operatorTokenId: au.token_id });
        res.requested.push({ key: base, request_id: req && req.id != null ? req.id : null, requested_by: au.account.username });
      }
      d.log(`Policy Center: ${res.requested.length} four-eyes rollback request(s) filed by ${au.account.username} (authenticated) — another super_admin decides in /policy-center.html.`);
    }
    for (const e of [...(rb.entries || [])].reverse()) {
      if (feBack.includes(e.key)) continue;
      const cfg = await d.getConfig();
      const cur = currentValue(cfg, e.key);
      if (String(cur) !== String(e.to) && !args.force) { res.conflicts.push({ key: e.key, expected: e.to, found: cur == null ? null : cur }); continue; }
      const why0 = `rollback ${path.basename(args.rollback)}${args.reason ? ` — ${args.reason}` : ''}`;
      const why = why0;
      // P11 r4 — a key that was ABSENT before the activation returns to absent (it follows future defaults) instead of
      // being pinned to a literal '0'/false row. `absent` is recorded at apply time; an older rollback file without it
      // treats from == null the same way (it means: no value was known).
      const wasAbsent = e.absent === true || e.from == null;
      if (wasAbsent && isNested(e.key)) await writeOne(d, e.key, UNSET, why);
      else if (wasAbsent && typeof d.unsetConfig === 'function') await unsetOne(d, e.key, why);
      else await writeOne(d, e.key, e.from == null ? '0' : e.from, why);
      res.restored.push(e.key);
    }
    d.log(`Rollback: restored ${res.restored.length} key(s)${res.conflicts.length ? `; ${res.conflicts.length} changed since, left alone (re-run with --force): ${res.conflicts.map((c) => c.key).join(', ')}` : ''}.`);
    return res;
  }

  if (args.apply) { const miss = applyRefusal(args); if (miss) throw new Error(miss); }
  const lots = selectLots(plan, args.lots || 'all');
  if (args.apply) {
    const why = writeRefusal(args, process.env); if (why) throw new Error(why);
    const operator = args.operatorName || osOperator();
    const d = { ...(deps || await defaultDeps(args.dbUrl, operator)), operator };
    const cfg = await d.getConfig();
    const act = markFourEyes(buildActivation({ plan, register, lots, cfg, includeOutbound: args.includeOutbound, prereqText }), cfg);
    d.log(renderPlan(act, { source: redactUrl(args.dbUrl) }).trimEnd());
    for (const l of act.lots.filter((x) => x.status === 'refused')) d.log(`REFUSED ${l.id}: ${l.refused_reason}`);
    // N-15 — four-eyes steps: a named second operator, or Policy Center requests instead of writes. Decided BEFORE
    // anything is written, so a refusal leaves the database untouched.
    const feSteps = act.steps.filter((x) => x.four_eyes);
    const viaCenter = feSteps.length > 0 && String(cfg.policy_center_enabled) === '1';
    let requester = null; let tokenId = null; const secondAcct = null;
    const ident = (deps && deps.osIdentity) ? deps.osIdentity : osIdentity();
    if (feSteps.length) {
      const keys = feSteps.map((x) => x.key).join(', ');
      if (args.secondOperator) throw new Error(`four-eyes switch(es) ${keys}: ${SECOND_OPERATOR_REFUSED} — nothing written`);
      if (!viaCenter) throw new Error(`four-eyes switch(es) ${keys} need a second super_admin: turn the Policy Center on (policy_center_enabled) — the tool then files requests as the authenticated operator (--operator-token=env) and another super_admin approves them in /policy-center.html — nothing written`);
      if (typeof d.createPolicyRequest !== 'function') throw new Error('Policy Center is on but this run cannot file requests — nothing written');
      const au = await authenticateOperator(d, args, { consume: !args.dryRun, consumedBy: `activate-switches ${ident.os_user || '?'}@${ident.host || '?'}` });
      if (au.refusal) throw new Error(`four-eyes switch(es) ${keys}: ${au.refusal} — nothing written`);
      requester = au.account; tokenId = au.token_id;
      d.operator = requester.username;   // the authenticated account is the operator of record for this run
    }
    if (args.dryRun) { d.log('DRY RUN — nothing written.'); return { ...act, applied: [], requested: [], rollback_file: null }; }
    const toWrite = viaCenter ? act.steps.filter((x) => !x.four_eyes) : act.steps;
    const requested = [];
    if (viaCenter) {
      for (const st of feSteps) {
        const { base, cur, next } = _baseValues(cfg, st.key, st.on_value);
        const req = await d.createPolicyRequest({ key: base, oldValue: cur, newValue: next, reason: _filedReason(`${args.reason} (activate-switches ${st.lot})`, tokenId, ident), actor: requester, origin: 'cli', operatorTokenId: tokenId });
        requested.push({ key: base, request_id: req && req.id != null ? req.id : null, requested_by: requester.username });
        if (d.logEvent) await Promise.resolve(d.logEvent({ category: 'config', action: 'policy_change_requested', actor: actorOf(requester.username), target: base,
          details: { request: req && req.id, from: cur, to: next, via: 'activate-switches', operator_token: tokenId, os_user: ident.os_user, host: ident.host }, risk: 1 })).catch(() => {});
      }
      d.log(`Policy Center: ${requested.length} four-eyes request(s) filed by ${requester.username} (authenticated by operator token) — another super_admin decides in /policy-center.html: ${requested.map((r) => `${r.key}#${r.request_id}`).join(', ')}`);
    }
    if (!toWrite.length) { d.log('Nothing to apply.'); return { ...act, applied: [], requested, rollback_file: null }; }
    const dir = args.rollbackDir || path.join(ROOT, 'data', 'switch-rollbacks');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `rollback-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    const stored = typeof d.storedKeys === 'function' ? await d.storedKeys() : null;
    const second = secondAcct ? String(secondAcct.username) : null;
    const secondId = secondAcct ? Number(secondAcct.id) : null;
    const entries = toWrite.map((s) => {
      const e = { key: s.key, lot: s.lot, from: s.from == null ? null : s.from, to: s.on_value };
      // flat key with no report_config row = it followed its default; nested = the sub-key was missing
      if (isNested(s.key) ? s.from == null : (stored ? !stored.has(s.key) : false)) e.absent = true;
      if (s.four_eyes) e.four_eyes = true;
      return e;
    });
    const rb = { created_at: new Date().toISOString(), actor: ACTOR, operator: d.operator || operator || null, ...(second ? { second_operator: second, second_operator_id: secondId } : {}), os_user: ident.os_user, host: ident.host, reason: args.reason, db: redactUrl(args.dbUrl), lots: lots.map((l) => l.id), entries };
    rb.sha256 = rollbackHash(rb);
    const rk = rollbackKey(process.env);
    if (rk) { rb.hmac = rollbackHmac(rb, rk); rb.integrity = `hmac-sha256 (${rk.name})`; } else { rb.integrity = 'sha256 checksum only (no SDP_CONFIG_KEY / SDP_BACKUP_KEY)'; }
    fs.writeFileSync(file, JSON.stringify(rb, null, 1) + '\n');
    // R4-A3: only a checksum recorded here by --apply can be rolled back (R5-A4: plus the HMAC seal when a key is set).
    if (d.logEvent) await Promise.resolve(d.logEvent({ category: 'config', action: 'switch_rollback_file', actor: actorOf(d.operator), target: rb.sha256,
      details: { file: path.basename(file), lots: rb.lots, keys: entries.map((e) => e.key), reason: args.reason, os_user: rb.os_user, host: rb.host, sealed: !!rb.hmac,
        ...(second ? { second_operator: second, second_operator_id: secondId, four_eyes_keys: entries.filter((e) => e.four_eyes).map((e) => e.key) } : {}) } })).catch(() => {});
    const applied = [];
    for (const s of toWrite) { await writeOne(d, s.key, s.on_value, s.four_eyes && second ? _withSecond(args.reason, `${second} user id ${secondId}`) : args.reason); applied.push(s.key); }
    d.log(`Applied ${applied.length} switch(es)${second ? ` (four-eyes, second operator: ${second})` : ''}. Rollback file: ${file}`);
    return { ...act, applied, requested, second_operator: second, second_operator_id: secondId, rollback_file: file };
  }

  // --plan (default)
  let cfg; let source;
  if (args.dbUrl) { const d = deps || await defaultDeps(args.dbUrl); cfg = await d.getConfig(); source = redactUrl(args.dbUrl); }
  else { cfg = { ...require(path.join(ROOT, 'services', 'reportConfig')).DEFAULTS }; source = 'the code defaults (no database read; pass --db-url to read one)'; }
  const act = markFourEyes(buildActivation({ plan, register, lots, cfg, includeOutbound: args.includeOutbound, prereqText }), cfg);
  const log = (deps && deps.log) || ((s) => process.stdout.write(s));
  log(args.json ? JSON.stringify(act, null, 1) + '\n' : renderPlan(act, { source }));
  return act;
}

module.exports = { readOperatorToken, authenticateOperator, SECOND_OPERATOR_REFUSED, needsFourEyes, markFourEyes, secondOperatorRefusal, resolveSecondOperator, applyRefusal, validateRollback, rollbackHash, rollbackHmac, rollbackKey, sealCheck, osIdentity, storedDeps, actorOf, OUTBOUND, ACCESS, MONEY, ON_VALUE, REFUSED_GROUPS, selectLots, graph, order, classify, buildActivation, renderPlan, parseArgs, writeRefusal, patchFor, currentValue, isOn, main };

if (require.main === module) {
  main(process.argv.slice(2))
    .then(() => process.exit(0))
    .catch((e) => { process.stderr.write(`[activate-switches] ${e.message}\n`); process.exit(1); });
}
