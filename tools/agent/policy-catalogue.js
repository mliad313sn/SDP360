'use strict';
// Policy Control Center — catalogue maintenance (ADR docs/ai-decisions/ADR-POLICY-CENTER.md).
//
//   node tools/agent/policy-catalogue.js             --check (default): exit 1 when a report_config key or a
//                                                    governance policy has no entry in docs/ops/policy-catalogue.json
//                                                    (and is not in its `excluded` list with a reason), or when the
//                                                    file names a key that no longer exists
//   node tools/agent/policy-catalogue.js --bootstrap adds an entry for every MISSING key using the classification
//                                                    rules below; existing entries are never overwritten (the file is
//                                                    hand-maintained once an entry exists). Review the diff.
//
// The catalogue file is the one hand-maintained half; the rest of a rule's description (default, type, owner role,
// PROPOSED recommendation, FR/EN text of the governance policies, consumers) is read from the code and from
// docs/ops/FLAG-REGISTER.json at run time by services/policyCatalogue.js. Nothing here invents a threshold, an
// owner or an approval: `risk` and `four_eyes` are engineering classifications (reviewable), not business policy.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const FILE = path.join(ROOT, 'docs', 'ops', 'policy-catalogue.json');

// Ordered rules — first match wins. [regex, category, risk]
const RULES = [
  [/^(wan_poll_last_run|wan_poll_first_run|teams_sla_last_run)$/, null, null],   // runtime state, see EXCLUDE
  [/retention|purge|^soft_delete/, 'retention', 'high'],
  [/^ppm_mpp_converter_cmd$/, 'integrations', 'high'],
  [/^(auth_|login_|sso_|entra_|access_|authz_|dashkey_|breakglass|emergency_access|csp_|embed_frame|ui_inject_dash_key|outbound_allow_hosts|qualification_)/, 'access', 'high'],
  [/^(portfolio_site_scope_reads|portfolio_editor_plan_writes|portfolio_executive_readonly|portfolio_sensitive_projects|export_policy_strict|export_watermark_enabled|report_revert_policy|report_reassign_submitted|metric_programme_readers|ui_deck_builder_roles|benefit_money_verifier_role)$/, 'access', 'high'],
  [/^(finance_|actuals_import|asset_money_certify|xof_usd_rate|asset_currency|asset_site_currency|ppm_evm_fx_rates)/, 'kpi', 'high'],
  [/^(sdp_api_write_enabled|opmanager_tls_insecure|opmanager_ca_bundle)$/, 'integrations', 'high'],
  [/(_send_enabled|_notify_enabled|^alert_external_enabled|^publish_cron_enabled|^notifications_stop|^teams_sla_enabled|^sync_alert_enabled|_webhook_url|_teams_url|^teams_sla_channels|^agenda_cron_enabled|^asset_new_alert_enabled|^delivery_failure_alert_enabled)$/, 'reporting', 'high'],
  [/(_recipients|^group_report_|^never_send_unconfirmed$|^smtp_|^transport$|^from$|^reply_to$|^default_email_domain$|^public_base_url$|^formats$)/, 'reporting', 'medium'],
  [/^(sync_|tracker_engine_cutover|site_codes_from_registry|site_code_shared_block|reconcile_|opm_stale_days|wan_stale_close_at|department_rollup|asset_amount_parser|asset_cost_outlier)/, 'data', 'medium'],
  [/(kpi|^helpdesk_sla_definition|^sla_headline_definition|^site_score_published_model|^exec_view_change_formula|^exec_payload_zero_policy|^wan_timeup|^wan_quality|^wan_mos|^opm_targets|^asset_depreciation|^asset_replacement_uplift|^ppm_rag_thresholds|^metric_explain|^problem_candidate_min|^exec_deck_other_bucket|^exec_view_min_cell|^wan_sla_require_contract_evidence)/, 'kpi', 'medium'],
  [/^(field_|site_local_calendar)/, 'field', 'medium'],
  [/^(meraki_|opmanager_|opm_|meridian_|sdp_api_|analytics_|sla_wan_config|teams_sla_rules|ppm_jira_|ppm_azdo_|ppm_mpp_|ppm_mspdi|ppm_xer|connector_health|sharepoint_|engagement_digest_hour|publish_metric_keys|wan_)/, 'integrations', 'medium'],
  [/(commitment|handoff|decision|obligations|controls_register|^pir_|problem_candidates|^insp_|^a01_|^a10_|action_aging|shift_handover|incubation|mywork|value_scoreboard|workspace_profiles|^weekly_report_due|weekly_report_nudges|weekly_report_minutes|^schedule_)/, 'governance', 'medium'],
  [/^(ppm_|portfolio_|roadmap_|benefit_|stale_plan)/, 'ppm', 'medium'],
  [/^(backup_|restore_|ux_event_telemetry|ai_commentary|policy_center_enabled)/, 'operations', 'medium'],
  [/^(ui_|exec_view_|exec_pack_|dashboard_|chart_annotations|hygiene_|scoreboard_|report_drift_banner|alert_group_by_rule|alert_quiet_hours)/, 'interface', 'low'],
];
const EXCLUDE = {
  wan_poll_last_run: 'runtime state written by the WAN poller (last run timestamp), not a policy',
  wan_poll_first_run: 'runtime state: when WAN monitoring began (availability denominator), written by the poller, not a policy',
  teams_sla_last_run: 'runtime state written by the Teams SLA poller (last run timestamp), not a policy',
};
// Values a consumer accepts, read from the consumer code (cited) — never guessed.
const ALLOWED = {
  site_codes_from_registry: ['0', '1', 'shadow'],                         // routes/policies.js PUT /api/governance/site-codes
  authz_capability_mode: ['off', 'shadow', 'enforce'],                    // services/reportConfig.js C-17 comment
  dashkey_scope_mode: ['open', 'shadow', 'restrict'],                     // services/dashKeyScope.js (E-S02)
  helpdesk_sla_definition: ['flag', 'due_vs_resolved'],                   // services/slaDefinition.js
  sla_headline_definition: ['closed_only', 'incl_open'],                  // public/lib/slaDual.js
  exec_payload_zero_policy: ['keep_server', 'browser_wins'],              // services/reportPayload.js
  site_score_published_model: ['legacy', 'programme', 'operational'],     // services/publishedSiteScore.js
  meraki_missing_policy: ['down', 'unknown'],                             // tools/meraki/sync-wan.js
  asset_amount_parser: ['legacy', 'locale'],                              // services/currency.js
  ppm_alloc_unspecified: ['full_time', 'unknown'],                        // services/governanceStore.js F-PRODUCT-09
  report_revert_policy: ['site_editor', 'second_person'],                 // services/reportSubmissionPolicy.js
  exec_view_lang: ['en', 'fr'],                                           // services/execMiSummary.js
  exec_view_change_formula: ['status', 'deck', 'itsm'],                   // services/execSummary.js CHANGE_FORMULAS
  exec_view_mi_detail: ['full', 'summarized_only', 'none'],               // services/execSummary.js MI_DETAIL_MODES
  ui_week_labels: ['legacy', 'explicit'],                                 // public/lib/weekLabels.js (D-03)
};

function classify(key) {
  for (const [re, category, risk] of RULES) if (re.test(key)) return category ? { category, risk } : null;
  return { category: 'operations', risk: 'medium' };
}
function gpCategory(p) {
  if (p.area === 'freshness') return 'data';
  if (p.area === 'reports' || p.area === 'publication') return 'reporting';
  if (p.area === 'calendar') return 'field';
  return 'governance';
}

function sources() {
  const RC = require(path.join(ROOT, 'services', 'reportConfig'));
  const GP = require(path.join(ROOT, 'services', 'governancePolicy'));
  return { RC, GP, rcKeys: RC.KEYS, gpParams: GP.PARAMS };
}

function readFile(file = FILE) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

/** Missing / stale / unexplained entries of a catalogue object against the code. */
function check(cat, src = sources()) {
  const keys = (cat && cat.keys) || {}, excluded = (cat && cat.excluded) || {};
  const missing = [], stale = [], noReason = [];
  const known = new Set();
  for (const k of src.rcKeys) { known.add(k); if (!keys[k] && !excluded[k]) missing.push(k); }
  for (const p of src.gpParams) { known.add(p.key); if (!keys[p.key] && !excluded[p.key]) missing.push(p.key); }
  for (const k of Object.keys(keys)) if (!known.has(k)) stale.push(k);
  for (const [k, why] of Object.entries(excluded)) { if (!known.has(k)) stale.push(k); if (String(why || '').trim().length < 10) noReason.push(k); }
  const badCat = Object.entries(keys).filter(([, e]) => !(cat.categories || {})[e.category]).map(([k]) => k);
  // N-R4-1: strict_value / strict_direction only on a four-eyes key; a direction is higher|lower; a strict value must be
  // one of the values the consumer accepts (when the catalogue lists them)
  const badStrict = Object.entries(keys).filter(([, e]) => {
    const hasV = e.strict_value != null, hasD = e.strict_direction != null;
    if (!hasV && !hasD) return false;
    if (!e.four_eyes || (hasV && hasD)) return true;
    if (hasD && !['higher', 'lower'].includes(e.strict_direction)) return true;
    if (hasV && Array.isArray(e.allowed) && !e.allowed.map(String).includes(String(e.strict_value))) return true;
    return false;
  }).map(([k]) => k);
  // N-R7-1 (P11 round 7): every numeric four-eyes key with a strict_direction must declare its reader's range, and the
  // file must say exactly what services/policyRanges.js says (min, max, integer) — the readers use that table.
  const R = require(path.join(ROOT, 'services', 'policyRanges')).RANGES;
  const badRange = [];
  for (const [k, e] of Object.entries(keys)) {
    const r = R[k];
    if (e.four_eyes && e.strict_direction && !r) { badRange.push(`${k}: strict_direction without a range in services/policyRanges.js`); continue; }
    if (r && (e.min !== r.min || e.max !== r.max || !!e.integer !== !!r.integer)) badRange.push(`${k}: catalogue min/max/integer ${e.min}/${e.max}/${!!e.integer} ≠ services/policyRanges.js ${r.min}/${r.max}/${!!r.integer}`);
  }
  for (const k of Object.keys(R)) if (!keys[k]) badRange.push(`${k}: range declared but no catalogue entry`);
  return { missing, stale, noReason, badCat, badStrict, badRange };
}

function bootstrap(cat, src = sources()) {
  cat.keys = cat.keys || {}; cat.excluded = cat.excluded || {};
  let added = 0;
  for (const k of src.rcKeys) {
    if (cat.keys[k] || cat.excluded[k]) continue;
    if (EXCLUDE[k]) { cat.excluded[k] = EXCLUDE[k]; added++; continue; }
    const c = classify(k);
    const secret = src.RC._SECRET_BLANK_KEEP.has(k);
    const e = { category: c.category, risk: secret ? 'high' : c.risk, four_eyes: !secret && c.risk === 'high' };
    if (ALLOWED[k]) e.allowed = ALLOWED[k];
    cat.keys[k] = e; added++;
  }
  for (const p of src.gpParams) {
    if (cat.keys[p.key] || cat.excluded[p.key]) continue;
    // governance policies carry their own two-person rule (protected relaxations) in services/governancePolicy.js
    cat.keys[p.key] = { category: gpCategory(p), risk: p.protected ? 'high' : 'medium', four_eyes: false };
    added++;
  }
  const sortObj = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  cat.keys = sortObj(cat.keys); cat.excluded = sortObj(cat.excluded);
  return added;
}

/** One line per key (keeps the hand-maintained file reviewable in diffs). */
function serialize(cat) {
  const head = { ...cat }; delete head.keys; delete head.excluded;
  const lines = ['{'];
  for (const [k, v] of Object.entries(head)) lines.push(` ${JSON.stringify(k)}: ${JSON.stringify(v, null, 1).replace(/\n\s*/g, ' ')},`);
  const block = (name, obj, last) => {
    lines.push(` ${JSON.stringify(name)}: {`);
    const ks = Object.keys(obj);
    ks.forEach((k, i) => lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(obj[k])}${i < ks.length - 1 ? ',' : ''}`));
    lines.push(` }${last ? '' : ','}`);
  };
  block('excluded', cat.excluded || {}, false);
  block('keys', cat.keys || {}, true);
  lines.push('}');
  return lines.join('\n') + '\n';
}

module.exports = { RULES, EXCLUDE, ALLOWED, classify, check, bootstrap, serialize, readFile, FILE };

if (require.main === module) {
  const cat = readFile();
  if (process.argv.includes('--bootstrap')) {
    const n = bootstrap(cat);
    fs.writeFileSync(FILE, serialize(cat));
    console.log(`[policy-catalogue] ${n} entr${n === 1 ? 'y' : 'ies'} added — review the diff`);
  }
  const r = check(cat);
  // P11 N-10: the catalogue is runtime data — the update package must carry it (else the center fails closed)
  let notShipped = [];
  try { const M = require(path.join(ROOT, 'tools', 'deploy', 'make-update-package')); notShipped = ['docs/ops/policy-catalogue.json', 'docs/ops/FLAG-REGISTER.json'].filter((f) => !M.RUNTIME_DOCS.has(f)); } catch (_) { notShipped = []; }
  if (notShipped.length) console.log('runtime file not in the update package (tools/deploy/make-update-package.js RUNTIME_DOCS):\n  ' + notShipped.join('\n  '));
  const bad = r.missing.length + r.stale.length + r.noReason.length + r.badCat.length + r.badStrict.length + r.badRange.length + notShipped.length;
  if (r.missing.length) console.log('missing (add an entry or an exclusion with a reason):\n  ' + r.missing.join('\n  '));
  if (r.stale.length) console.log('stale (key no longer in the code):\n  ' + r.stale.join('\n  '));
  if (r.noReason.length) console.log('excluded without a reason:\n  ' + r.noReason.join('\n  '));
  if (r.badCat.length) console.log('unknown category:\n  ' + r.badCat.join('\n  '));
  if (r.badStrict.length) console.log('bad strict_value / strict_direction (four-eyes keys only; higher|lower; within allowed):\n  ' + r.badStrict.join('\n  '));
  if (r.badRange.length) console.log('numeric range out of step with the readers (services/policyRanges.js):\n  ' + r.badRange.join('\n  '));
  if (bad) process.exit(1);
  console.log(`[policy-catalogue] OK — ${Object.keys(cat.keys).length} catalogued, ${Object.keys(cat.excluded).length} excluded with a reason`);
}
