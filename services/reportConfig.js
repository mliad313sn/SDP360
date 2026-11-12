'use strict';
// Delivery settings for the reporting suite — key/value in report_config.
// sqlite + PG fork via the same _h(db) resolver used by groupPresets.js.

const DEFAULTS = {
  exec_view_lang: 'en',                 // language of the AI incident summaries on the public page (en|fr)
  // A-09a — shared UI-policy channel (services/uiPolicy.js → /api/reports/auth/me → window.__uiPolicy).
  // Every value reproduces today's behaviour; switched by tools/reports/set-ui-policy.js.
  ui_lang_default: '',                  // ''=saved choice else browser language · 'fr'|'en' first-visit default
  ui_i18n_pages: '0',                   // '1' activates the French dictionaries of the coordinator pages
  ui_role_landing: '0', ui_nav_profile: 'full', ui_deck_builder_roles: 'super_admin',
  ui_exec_nav: 'full',                  // C-28 (PO P1) 'consolidated' = Executive menu = Home + IT Review
  ui_kpi_base_line: '0',                // E-V03 '1' = KPI tiles show their base population ("n = 142 closed" / "base not measured")
  ui_kpi_sample_size: '0',              // E-K02 '1' = "n = …" on tiles/grid cells + low-sample warning from an ADOPTED kpi_policy
  ui_url_filters: '0',                  // E-U02 '1' = Analytics filters written to / restored from the URL (Reset clears)
  ui_kpi_definition_drawer: '0',        // F-DATA-07 '1' = "Definition" drawer on KPI tiles (formula, window, denominator, source job, certification)
  dashboard_decision_kpis_seed: '0',    // F-DATA-11 '1' = the two candidate decision KPIs are saved as a DRAFT dashboard `decision-kpis` (never published by code)
  ui_small_multiples: '0',              // E-V09 '1' = the `multiples` widget type (one panel per metric) is creatable
  csp_strict_pages: '',                 // F-ARCH-06 comma list of extra pages served with the nonce-only script-src ('' = today: login, Exec View, share links)
  ui_feedback_enabled: '0',             // E-B07 '1' = Feedback button in the shell + /api/feedback (else 404)
  ui_data_quality_page: '0',            // E-D07 '1' = Data quality board in the nav + data-quality.html (else 404)
  chart_annotations_enabled: '0',       // E-V08 '1' = human-entered chart annotations (marker + legend on dashboard trends; source mandatory)
  ui_week_labels: 'legacy',             // D-03 'explicit' = ISO charts say "ISO W37 (7–13 Sep)", Zoho labels carry their range
  // A-08 — Exec View (public page) switches; both defaults reproduce today's output.
  // full = subject/RCA/CA public, per the 2026-07-02 decision ("option a");
  // summarized_only = generic title + AI-condensed RCA/CA only; none = generic title, no RCA/CA.
  exec_view_mi_detail: 'full',
  // status = completed/(completed+failed) by SDP status (today); deck = _computeSiteChanges
  // success_pct (cancelled in denominator); itsm = success_pct_itsm. Official formula = KPI D-01 (open).
  exec_view_change_formula: 'status',
  // A-24 — PROPOSED D-3 (reverses the 2026-10-02 decision; NOT approved): every default reproduces today.
  // site_editor = any editor of the report's site / admin tier may revert a submitted report (today);
  // second_person = the submitter never reverts their own submission, another admin-tier user must,
  // with a reason. report_reassign_submitted '0' refuses moving a SUBMITTED report to another week.
  // report_drift_banner '1' shows a red band when the figures no longer match the submission hash.
  report_revert_policy: 'site_editor', report_reassign_submitted: '1', report_drift_banner: '0',
  transport: 'smtp',
  smtp_host: '', smtp_port: '587', smtp_secure: '0', smtp_user: '', smtp_pass: '',
  from: '', reply_to: '',
  default_email_domain: 'edv-ops.com',
  // Public origin of this dashboard (e.g. https://itops-dashboard.edv-ops.com),
  // used to turn e-mail figures into links the reader can act on. EMPTY BY
  // DEFAULT and every consumer must degrade to plain text: a guessed or stale
  // origin produces dead links in an e-mail that has already left the building,
  // which is worse than no link. No trailing slash — consumers append '/…'.
  public_base_url: '',
  formats: 'html,pdf',
  never_send_unconfirmed: '1',
  group_report_to: '', group_report_cc: '', group_report_to_confirmed: '0',
  hygiene_recipients: '', hygiene_send_enabled: '0',
  // Scheduled per-coordinator operational scoreboard email — armed OFF by
  // default. Arm flag ONLY (recipients come from the coordinator directory, not
  // a config list). Must live in DEFAULTS so setConfig's KEYS filter accepts it.
  scoreboard_send_enabled: '0',
  tracker_engine_cutover: '0',    // Step 7 — '1' once the generic engine is the reference for the IT Activity Tracker (legacy tables read-only)
  // Scheduled per-coordinator WEEKLY report email — armed OFF by default. Arm
  // flag ONLY (recipients come from the coordinator directory, not a config
  // list). Must live in DEFAULTS so setConfig's KEYS filter accepts it.
  weekly_report_send_enabled: '0',
  // Scheduled monthly "Assets — Groupe" management digest — armed OFF by default.
  // A GROUP sender (like hygiene): arm flag + a recipients comma-list (no directory).
  // Both must live in DEFAULTS so setConfig's KEYS filter accepts the admin's write
  // (else silently dropped and the digest is permanently inert).
  asset_group_send_enabled: '0',
  asset_group_recipients: '',
  // Asset engagement reminders (2026-09-18) — both armed OFF. Recipients come from
  // the directory (asset manager, coordinator in copy). Must live in DEFAULTS or
  // setConfig's KEYS filter silently drops the admin's write.
  asset_reminder_send_enabled: '0',
  asset_new_alert_enabled: '0',
  // Fenêtre « vu récemment » de la réconciliation AD/Entra, en jours. Il n'existe
  // pas de bonne valeur universelle — un site à rotation lente voudra 60, une
  // campagne de déploiement 7 — et la valeur retenue est affichée dans l'en-tête
  // du rapport : un seuil implicite rend deux rapports incomparables.
  // DOIT figurer ici ou setConfig filtre la clé sur KEYS.includes(k) et l'écriture
  // de l'admin disparaît sans erreur.
  reconcile_recent_days: '30',
  xof_usd_rate: '0.00165',
  // Annual replacement-price uplift (%) for the investment forecast — 0 = like-for-like.
  // Must live in DEFAULTS so setConfig's KEYS filter accepts the admin's write.
  asset_replacement_uplift_pct: '0',
  // A-16 — Assets money certification. PROPOSED policy, NOT approved (owner:
  // Finance / IT management): a money figure is "certified" only when ≥ min_sites
  // sites have eligible assets (purchase cost > 0) AND eligible ≥ min_pct % of the
  // assets in scope. The fields are always computed and returned; display '0'
  // (default) = today's UI and exports unchanged, '1' = show the "Non certifié"
  // band + per-site coverage table + a Certification export sheet.
  asset_money_certify_display: '0',
  asset_money_certify_min_sites: '3',
  asset_money_certify_min_pct: '50',
  // A-26 — asset money parsing + per-site currency. PROPOSED (owner: Finance), NOT
  // approved; every default is today's behaviour: legacy parser, empty map = every
  // asset site XOF at xof_usd_rate, empty rates = {XOF: xof_usd_rate, USD: 1},
  // outliers listed (factor 10 × median of product type + currency) but still summed.
  asset_amount_parser: 'legacy',
  asset_site_currency: '',
  asset_currency_rates: '',
  asset_cost_outlier_factor: '10',
  asset_cost_outlier_exclude: '0',
  // Asset depreciation policy (JSON) — the computed-book-value reader resolves a
  // method/useful-life/salvage per product_type from this. Must live in DEFAULTS
  // so setConfig's KEYS filter accepts the admin's write (else silently dropped).
  asset_depreciation_config: JSON.stringify(require('./depreciation').DEFAULT_DEPRECIATION_CONFIG),
  // ── F2a: Entra SSO (admin-configurable; resolved by services/ssoSettings.js as
  //    DB ?? .env ?? default). entra_client_secret is redacted on GET and blank-kept
  //    on save, exactly like smtp_pass. Must live in DEFAULTS or setConfig drops them.
  sso_mode: '', entra_tenant_id: '', entra_client_id: '', entra_client_secret: '',
  entra_redirect_uri: '', sso_breakglass_user: '', sso_group_map: '',
  // ── F1: Meridian PMO federation. base_url + two API keys. out_key = SDP presents
  //    it to Meridian (sync + link read-back); in_key = SDP requires it inbound on
  //    /api/actions/open. Both keys are secrets: redacted on GET, blank-kept on save
  //    like smtp_pass / entra_client_secret. Must live here or setConfig drops them.
  meridian_base_url: '', meridian_out_key: '', meridian_in_key: '',
  // PROPOSED D-5 kill switch (A-20 phase 1, repo decision D-07, NOT approved) — 0 = retired:
  //    /api/actions/open + /api/meridian/sync answer 404, the nightly job skips "disabled",
  //    the Site Actions badge and the admin form disappear. '1' = today's behaviour.
  meridian_enabled: '1',
  // ── OPManager infra availability (V1a). The Analytics Plus view id OPS reads via
  //    fetchView; per-family availability targets (JSON); staleness threshold (days).
  //    Non-secret. Must live here or setConfig's KEYS filter silently drops them.
  opm_availability_view_id: '',
  opm_targets: JSON.stringify({ lan: 99, wifi: 98, wan: 98, servers: 99 }),
  opm_stale_days: '9',
  // Comma-separated substrings that identify the OpManager monitoring servers
  // themselves (remote probes + central). These devices are EXCLUDED from the
  // business availability pools, and their own downtime flags the affected site's
  // period as a monitoring blind spot. Case-insensitive substring match on device key.
  opm_monitor_patterns: 'opma,abj-spm-000',
  // ── Meraki Dashboard API (V1b — WAN availability & quality). api_key is a SECRET
  //    (redacted on GET, blank-kept on save like smtp_pass); org_id + base_url are not.
  //    missing_policy is the calibration output ('down'|'unknown', §7) — MUST live here
  //    or setConfig's KEYS filter silently drops the calibrated value.
  meraki_api_key: '', meraki_org_id: '',
  meraki_base_url: 'https://api.meraki.com/api/v1',
  meraki_missing_policy: 'down',
  // ── OpManager REST API (V1b-B — LAN/WLAN/Servers device availability). api_key is a
  //    SECRET (redact/blank-keep/super_admin); base_url points at the on-prem server;
  //    tls_insecure='1' tolerates its self-signed cert — E4: default '0' (verified). The
  //    internal CA goes in ca_bundle (PEM, SECRET: redact/blank-keep/super_admin) and is
  //    passed as `ca:` to the https agent, so verification works with a private CA.
  opmanager_base_url: '', opmanager_api_key: '', opmanager_tls_insecure: '0', opmanager_ca_bundle: '',
  // A-18b — parallel reads of getDeviceCompleteDetails in the OpManager REST collector.
  //    '1' = today's sequential loop; >1 = a bounded pool (capped at 8). Speed only: same rows.
  opm_rest_concurrency: '1',
  // ── WAN SLA / ISP chargeback (V1c). The tier/circuit policy (JSON) that the SLA
  //    engine + credit reader resolve per (site_id, sub_site, uplink). Seeded as a
  //    JSON string (like asset_depreciation_config). Must live here or setConfig's
  //    KEYS filter silently drops the admin's write and the module stays inert.
  sla_wan_config: JSON.stringify(require('./slaWanConfig').DEFAULT_SLA_WAN_CONFIG),
  // Heartbeat: the WAN outage poller stamps its last-run ISO timestamp here. WAN Health uses
  // it to know monitoring is live → a circuit with no outages reads 100% (not '—'); if unset
  // (poller never ran), event-based availability is '—' rather than a fabricated 100%.
  wan_poll_last_run: '',
  wan_poll_first_run: '',   // when WAN monitoring began — availability denominator is clamped to it
  // Quality-weighted availability thresholds — LEGACY min-model, superseded by wan_mos_config below.
  wan_quality_thresholds: '{"loss":{"good":1,"bad":7},"latency":{"good":100,"bad":400},"jitter":{"good":30,"bad":100}}',
  // WAN Quality = ITU-T G.107 "E-model": loss/latency/jitter → R-factor (0-100, the "Qualité %") → MOS
  // (1..4.5). Defaults are G.711 wired. codec_loss_factor: R lost per 1% loss (G.711 2.5 / G.729 ~4);
  // advantage_factor: 0 wired, 10-20 for satellite/VSAT tolerance.
  wan_mos_config: '{"r0":93.2,"codec_loss_factor":2.5,"jitter_buffer_factor":2,"base_delay_ms":10,"advantage_factor":0}',
  // "% Time Up" down-thresholds (approximate Meraki's Summary Report, which counts high-loss /
  // timeout samples as down — NOT only 100% loss). loss_pct = an interval with loss ≥ this is
  // down (default 100 = the plain loss<100 rule); latency_ms = an interval slower than this is
  // down (blank = no latency cap). Tune loss_pct down (~15-25) to land on Meraki's % Time Up.
  wan_timeup_loss_pct: '100',
  wan_timeup_latency_ms: '',
  // A-25 — WAN SLA review/credits. Both defaults reproduce today's output (except the explicit
  //    "unknown" label the poller now puts on stale-closed rows, which the engine already excluded).
  //    wan_stale_close_at: where the 24 h stale-open guard ends a row — 'now' (the poll time, today)
  //    or 'last_seen' (the last poll that SAW the uplink down; also drops "unknown" rows from the
  //    24/7 availability). wan_sla_require_contract_evidence: '0' = credit amounts shown whenever the
  //    circuit has an MRC (today); '1' = amount null + amount_reason "not certified" unless the
  //    circuit's contract was reviewed by a second super_admin and its MRC matches the config.
  wan_stale_close_at: 'now',
  wan_sla_require_contract_evidence: '0',
  // ── Teams SLA alerts (2026-10-03) — tools/teams/poll-sla.js, every 5 min. Disarmed by default.
  //    The SDP Cloud API is read with a Zoho OAuth self-client (scope SDPOnDemand.requests.READ):
  //    client_secret + refresh_token are SECRETS. teams_sla_channels = JSON [{group, url}] — a
  //    Workflows webhook URL lets anyone post in the channel, so the whole blob is a SECRET too
  //    (redacted on GET, blank-kept, encrypted at rest); the dedicated /api/teams-sla routes
  //    expose only which groups are mapped. teams_sla_rules = JSON (services/teamsSla.DEFAULT_RULES).
  teams_sla_enabled: '0', teams_sla_rules: '', teams_sla_channels: '', teams_sla_last_run: '',
  sdp_api_base_url: 'https://oneitsupport.endeavourmining.com/app/itdesk/api/v3',
  sdp_api_accounts_url: 'https://accounts.zoho.com',
  sdp_api_client_id: '', sdp_api_client_secret: '', sdp_api_refresh_token: '',
  sdp_api_open_filter: 'Open_System',
  // Step 10 — quick action "SDP ticket from a finding": OFF until the CAB approves the CREATE scope.
  sdp_api_write_enabled: '0', field_photo_max_kb: '300',
  // E-F01 — admin resolution of a stuck field outbox entry (mark_rejected / release). OFF = the route answers 404.
  field_outbox_resolve_enabled: '0',
  // E-F03 — field review step before queueing an inspection / task timing (form open → queued). Both OFF = today.
  field_review_step: '0', field_task_timing: '0',
  // ── Zoho Analytics connection (helpdesk data), editable in Admin ▸ Intégration API ▸ Analytics
  //    (2026-10-04). BLANK = use .env (ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN /
  //    WORKSPACE_ID / ORG_ID) — services/analyticsSettings resolves database → .env → default.
  analytics_client_id: '', analytics_client_secret: '', analytics_refresh_token: '',
  analytics_workspace_id: '', analytics_org_id: '', analytics_accounts_url: '',
  // 2027 Goal 02 — canonical commitments (routes/commitments.js, hub badge). OFF = no behaviour change.
  commitments_enabled: '0',
  metric_explain_enabled: '0',          // E-K04 '1' = GET /api/metrics/:key/explain (deterministic change description, no cause asserted)
  dashboard_red_action_links: '0',     // E-K03 '1' = a RED kpi tile / ragGrid cell offers "Open actions (k)" + "Create action" (needs commitments_enabled)
  // G-22 — interdepartmental handoffs (routes/handoffs.js). OFF = every route 404. Notifications are a
  // separate switch, also OFF: who is told about a handoff is decision D-04's, not the code's.
  handoffs_enabled: '0',
  handoff_notify_enabled: '0',
  commitment_notify_enabled: '0',
  // A-15 — PROPOSED portfolio access policy (an owner decision, not approved): '1' = a non-committee reader sees
  // only the projects of their sites + group-level ones; '1' = site editors / the owner maintain the plan
  // (tasks, milestones, risks, deliverables) of their site projects. '0' = today (all read, committee writes).
  portfolio_site_scope_reads: '0',
  portfolio_editor_plan_writes: '0',
  // A-27 — PROPOSED PPM governance policy (not approved): '0' = today. ppm_baseline_versions '1' = the approval gate
  // writes a baseline version; ppm_rebaseline_enabled '1' = the committee re-baseline action exists (404 while '0');
  // ppm_alerts_enabled '1' = the nightly A11 exception job notifies in-app (while '0' it is a dry run).
  ppm_baseline_versions: '0',
  ppm_rebaseline_enabled: '0',
  ppm_alerts_enabled: '0',
  ppm_alert_blocked_days: '5',
  ppm_alert_slip_days: '10',
  // E-P03 (audit P-03) — PROPOSED: '1' shows capacity per site × week + sorted conflicts (GET /api/governance/ppm/capacity,
  // 404 while '0') and makes a reason REQUIRED to reassign a task. The reassignment is traced in ppm_events either way.
  ppm_capacity_view: '0',
  // F-PRODUCT-09 (gap E07) — PROPOSED: what a NEW task stores when the caller does not send allocation_pct.
  // 'full_time' (today) = the column default 100 %; 'unknown' = NULL (shown "unknown", never summed). Existing rows are
  // never changed. The convention is a PMO decision.
  ppm_alloc_unspecified: 'full_time',
  // E-P04 (audit P-04) — PROPOSED: '1' = budget per period (baseline / actual / forecast per month × currency, EAC per
  // currency, justification on a change or a variance) on the project page; 404 while '0'. Not certified by Finance.
  ppm_budget_periods_enabled: '0',
  // E-P05 (audit P-05) — PROPOSED: '1' = a benefit may be linked to a user (owner_user_id, the free-text owner stays) and
  // "My work" lists the benefits that person owns whose review date is reached (in-app only). The linked owner never
  // verifies their own benefit (SELF_REVIEW) — that rule holds whenever a link exists.
  benefit_owner_link_enabled: '0',
  // F-PRODUCT-03 + F-DATA-09 (gap E09) — PROPOSED: '1' = a benefit carries a value class (realised cash / cost-avoidance
  // ESTIMATE / productivity time / risk reduction / other; empty = unclassified), a measurement basis (observed /
  // estimated avoidance), baseline and measurement periods, a method note and a source. The project page then shows
  // observed, estimated and validated values in separate columns, with totals per class (never across). '0' = today's
  // form; the fields are ignored on write. The classes accepted at a benefits review are a Finance / sponsor decision.
  benefit_value_class_enabled: '0',
  // F-PRODUCT-04 — PROPOSED policy: a role name (e.g. 'finance-viewer') = a MONEY benefit is verified only by a holder
  // of that role (held exactly), who is neither the entrant nor the linked owner; refusal code VERIFIER_ROLE. '' (today)
  // = any other person with plan-write. No role is granted by this key; a name nobody holds blocks money verification.
  benefit_money_verifier_role: '',
  // F-DATA-10 — PROPOSED: '1' = a project amount (budget / spent) or a money benefit written WITHOUT a currency is refused
  // (CURRENCY_REQUIRED). '0' (today) = accepted, but no longer silently: the project is flagged currency_defaulted, the
  // ledger note says so, the caller gets a warning and the views say "default, not confirmed". The rule itself is a
  // Finance decision (docs/ops/FINANCE-CURRENCY-RULES.md).
  finance_currency_required: '0',
  // E-P06 (audit P-06) — PROPOSED: '1' = RACI tab on the project page (task × person, exactly one A per task, CSV export);
  // ppm_templates_enabled '1' = save a project's STRUCTURE as a template (no people, dates or money), approved by another
  // committee member before it can create a project. Both 404 while '0'.
  ppm_raci_enabled: '0',
  ppm_templates_enabled: '0',
  // E-P08 (catalogue R16) — PROPOSED: '1' = the annual planning DRAFT pack (XLSX, every sheet "DRAFT — not approved",
  // per-currency budget roll-up under the money rule, envelope UNKNOWN until Finance enters it); 404 while '0'.
  ppm_annual_pack_enabled: '0',
  // F-PRODUCT-06 (committee 12 Nov 2026, N6 / E08) — PROPOSED: '0' = today (a decision's status moves freely between
  // open / in_progress / done / cancelled). '1' = services/decisionLifecycle applies: a site moves open ↔ in_progress and
  // its "done" is stored as awaiting_confirmation until the committee confirms; cancel / reopen need a reason; an illegal
  // jump is refused (409). The status history (ppm_events, entity 'decision') is written either way.
  decision_lifecycle_enforced: '0',
  // F-PRODUCT-05 (committee 12 Nov 2026, N9) — PROPOSED: '1' = GET /api/governance/department-rollup counts commitments,
  // handoffs, report actions and PV issues per crosswalked department (migration 082; a value without a pair stays
  // "unmapped", never merged). '0' = today: no roll-up (404). The crosswalk list and the --check tool read either way.
  department_rollup_enabled: '0',
  // F-PRODUCT-07 (committee 12 Nov 2026, C22 / N11) — PROPOSED: '1' = GET /api/me/work carries `awaiting_me` and Home shows
  // "Awaiting me": commitments I review, handoffs waiting for my acceptance, benefits I may verify, decisions I own due
  // within 7 days, PVs I am named to sign. '0' = today: no such block. A source that cannot be read is null, never 0.
  mywork_awaiting_me_enabled: '0',
  site_codes_from_registry: '0',   // DEC-4 — '1' = site_module_codes wins over the modules' hard-coded maps (diff first: GET /api/governance/site-codes); 'shadow' (E-D01) = hard maps answer, divergences logged once/day   // ADR-006 — in-app notice to the escalation-matrix target of a new A01 / A02 (off = ledger only, as before)
  site_code_shared_block: '0',   // D-01 (AM-01) — '1' = refuse a scoped editor's tracker/meetings/inspection save under a code two active sites share (409, never picks an owner)
  // R1-PROFILES (REBUILD-SPEC R1/R2) — '1' = presentation profiles + workspace-settings.html + /api/workspace/* (else 404).
  // Presentation only: a profile never grants a page, a role or a site (tests/workspace-profiles-grants-nothing).
  workspace_profiles_enabled: '0',
};
// ── Sync alerting (Step 1). Recipients = comma list of e-mail addresses; teams_url = a
//    Workflows webhook (SECRET, blank-keep). Nothing is sent while both are empty.
DEFAULTS.sync_alert_enabled = '1';
DEFAULTS.sync_alert_recipients = '';
DEFAULTS.sync_alert_teams_url = '';
DEFAULTS.sync_truncation_tolerance_pct = '20';
// ── E-D04 (audit D-06) — sync content drift. '0' = drift is computed and shown in /api/sync/health but no alert
//    is sent (today); '1' = sent through the sync alert path. The three thresholds are PROPOSITIONS (no owner yet).
DEFAULTS.sync_drift_alerts = '0';
DEFAULTS.sync_drift_drop_pct = '50';
DEFAULTS.sync_drift_spike_pct = '300';
DEFAULTS.sync_drift_duplicates_pct = '10';
// ── M4 (2026-10-21) — outbound URL guard (services/safeUrl.js). Comma-separated hosts
//    (exact or `*.suffix`) that may be targeted even when they resolve to a private address —
//    the on-prem OpManager, an internal relay. Non-secret. Must live here or setConfig drops it.
DEFAULTS.outbound_allow_hosts = '';
// ── E11 — off-site copy of every verified dump (UNC or local path; '' = local only; S3 out of scope).
//    Not a secret (a path), but super_admin-only like the rest of /api/reports/config.
DEFAULTS.backup_offsite_path = '';
// ── F-ARCH-05 — full-service restore drill. restore_drill_full '0' = the monthly drill stays
//    database-only (today); '1' adds files + keys + timing. restore_rto_minutes '' = no recovery-time
//    target set → the timing step reads UNKNOWN (never "met"); the value is the operations owner's.
DEFAULTS.restore_drill_full = '0';
DEFAULTS.restore_rto_minutes = '';
// ── Step 9 — engagement + external publishing. Teams / webhook URLs let anyone post → SECRETS
//    (blank-keep, encrypted). SharePoint: Graph client-credentials app (client_secret = SECRET).
//    publish_metric_keys = comma list of KPI keys the connectors + the OData Values default to.
Object.assign(DEFAULTS, { alert_external_enabled: '0', notifications_stop: '0', engagement_teams_url: '', engagement_webhook_url: '', engagement_digest_hour: '7', embed_frame_ancestors: '',
  publish_metric_keys: 'helpdesk.resolution_sla_pct,helpdesk.first_reply_sla_pct,inspection.conformity_pct,meetings.engagement_score,assets.completeness_pct,tracker.site_score_pct',
  publish_excel_recipients: '', publish_webhook_url: '', publish_cron_enabled: '0',
  sharepoint_tenant_id: '', sharepoint_client_id: '', sharepoint_client_secret: '', sharepoint_site_id: '', sharepoint_list_id: '' });

// ── A-17b — PROPOSED KPI switches (KPI committee, not approved). Defaults = today.
//    helpdesk_sla_definition: 'flag' (stored Overdue Status) | 'due_vs_resolved' (browser rule) — only
//    getMonthlyHelpdeskHistory (Exec View) consumes it (services/slaDefinition.js).
//    exec_payload_zero_policy: 'keep_server' (2026-06-04 behaviour) | 'browser_wins' (Group IT deck merge).
DEFAULTS.helpdesk_sla_definition = 'flag';
DEFAULTS.exec_payload_zero_policy = 'keep_server';
// ── C-16 — PO decision P4 (2026-11-05): exec_deck_other_bucket '0' (today: top-N charts silently truncated,
//    Normal changes folded into Standard on the Group IT deck) | '1' ("Other (k)" bucket on every truncated
//    chart + Normal as its own change-type slice; totals always intact). services/reportPayload.js.
DEFAULTS.exec_deck_other_bucket = '0';

// ── A-11 — PROPOSED D-1 switch (repo decision D-03 "reference site score", OPEN — not approved).
//    legacy = each e-mail keeps its model (coordinator: programme score; scoreboard: composite);
//    programme | operational = one published verdict per site (services/publishedSiteScore.js).
DEFAULTS.site_score_published_model = 'legacy';

// ── A-19 — PROPOSED retention policy (not a D-item; not approved). Defaults = today (hard delete, no purge).
//    soft_delete_enabled '1' → inspections / PVs / portfolio nodes / cadences are stamped deleted_at instead of
//    removed, restorable by the admin tier within soft_delete_retention_days; soft_delete_purge_enabled '1' arms
//    the nightly softdelete.purge job (hard-deletes stamped rows older than the retention). services/softDelete.js.
Object.assign(DEFAULTS, { soft_delete_enabled: '0', soft_delete_retention_days: '30', soft_delete_purge_enabled: '0' });

// ── B-09 — Roadmap Manager → portfolio single source. '0' = today (the Roadmap Manager stays editable);
//    '1' = itsm-roadmap.html turns READ-ONLY with a link to the portfolio, and the roadmap write routes answer
//    409. Nothing is ever deleted (deletion of roadmap_* rows is a CAB decision). Decision: redirect only after
//    one parity cycle (tools/governance/roadmap-parity.js) — PMO + PO.
DEFAULTS.roadmap_redirect_to_portfolio = '0';

// ── R2-WORKBENCH (REBUILD-SPEC R5, migration 085) — PROPOSED, '0' = today (the routes answer 404, no tab / panel).
//    ppm_project_team_enabled '1' → a Team panel on the project page (named members, role, optional user link and
//    allocation to the project); a task whose allocation is UNKNOWN then reads its owner's member allocation in the
//    conflicts and the capacity view (a known allocation is never overridden; no member = today's figures).
DEFAULTS.ppm_project_team_enabled = '0';
//    ppm_time_entries_enabled '1' → time entries per task (who, day, hours 0..24) on the Plan tab; planned effort vs
//    actual hours vs variance (no entry = unknown, never 0); the workbook Tasks sheet gains actual_hours.
DEFAULTS.ppm_time_entries_enabled = '0';
//    ppm_change_requests_enabled '1' → native change requests on the project page (Changes tab): proposed → assessed
//    → approved | rejected → applied; the author never decides; applying a dates impact uses the committee re-baseline.
DEFAULTS.ppm_change_requests_enabled = '0';
//    portfolio_views_enabled '1' → the portfolio page offers Timeline · List · Board (?view= in the URL); the board is
//    read-only columns by stage (a stage moves only through the gated project page). '0' = today's single timeline.
DEFAULTS.portfolio_views_enabled = '0';
//    roadmap_publication_enabled '1' → the Roadmap Manager page offers a controlled "Publish to portfolio": dry run with a
//    duplicates report (refused at apply unless skip_duplicates=1), parity shown after the apply, an EXPLICIT archive
//    (read-only) gesture recorded in ppm_events, and a soft-delete rollback. '0' = the migration API exactly as today.
DEFAULTS.roadmap_publication_enabled = '0';

// ── SEC-01 — per-ACCOUNT login throttle (services/accountThrottle.js). '0' = today: only the per-IP limiter
//    (10 attempts / 15 min per address). '1' → more than auth_account_throttle_max FAILED sign-ins against one
//    account within auth_account_throttle_window_min answer 429 (password not even checked); a success clears it.
Object.assign(DEFAULTS, { auth_account_throttle_enabled: '0', auth_account_throttle_max: '10', auth_account_throttle_window_min: '15' });
// ── E-S05 — PBKDF2 work factor for NEW password hashes (users.password_iterations stores each hash's own count;
//    NULL = 100000). '100000' = today: nothing is rehashed. A higher value rehashes a user once, at their next
//    successful password login; lowering it never downgrades a stored hash. Values < 100000 or invalid → 100000.
DEFAULTS.auth_pbkdf2_iterations = '100000';

// ── C-17 — capability catalogue switch. off = today (legacy role guards only). shadow = the evaluator
//    (services/authorizationService.can) runs beside every role guard and logs divergences to system_log
//    category 'authz'. enforce = shadow, except for the capabilities listed in authz_enforce_caps (E-S01).
DEFAULTS.authz_capability_mode = 'off';
// E-S01 (audit S-04) — comma list of capability ids that mode `enforce` answers from the capability evaluator.
// '' = today (nothing enforced). A listed capability can only REFUSE (403 + system_log authz_enforce_denied);
// an allow still goes through the legacy guard. critical capabilities are ignored while C-18 grants are off.
DEFAULTS.authz_enforce_caps = '';
// E-S02 (audit S-02, X-SEC-01) — the x-dash-key ALONE (server-to-server). open = today (any route the gate
// lets through); shadow = an unlisted route still answers but writes 'dashkey_scope_would_refuse' (once a day per
// route × source); restrict = 401. dashkey_allowed_routes: "METHOD /api/path" or "/api/path", trailing * = prefix.
// A browser request (cookie or Origin) is never affected. ui_inject_dash_key '1' = today (window.__ak in pages
// served with a session); '0' = no key in pages, the session cookie carries every call (services/dashKeyScope.js).
Object.assign(DEFAULTS, { dashkey_scope_mode: 'open', dashkey_allowed_routes: '', ui_inject_dash_key: '1' });
// E-B08 (audit B-08) — '0' = today (the AI commentary is generated whatever the source freshness). '1' = when a model
// would be called and any source feeding the run's figures is stale / never synced (publication's freshness gate),
// the run keeps its deterministic text with error 'sources stale — AI commentary not generated' (system_log row).
DEFAULTS.ai_commentary_stale_block = '0';
// C-18 (G39/G40/G50) — access requests. '0' = today: Admin ▸ Users adds any role directly; no grant ever expires
// by itself. access_require_approval '1' → adding a role marked requires_request needs an APPROVED request
// (super_admin break-glass with a reason, logged risk=1). access_grant_expiry_job '1' → the nightly job
// access.grant_expiry ends expired grants and activates approved requests whose start day has come.
DEFAULTS.access_require_approval = '0';
DEFAULTS.access_grant_expiry_job = '0';
// E-S03 (audit S-05) — access recertification campaigns (migration 068). '0' = today: no campaign routes (404),
// no card on access.html. '1' → a super_admin opens a campaign; each account × role / site line is answered
// keep / revoke / unknown (with a reason) by its R7 approver, never the subject. access_recert_apply '0' = a revoke
// answer is RECORDED only; '1' applies it through the role-change path with an identity log row. Nothing auto-revokes.
// access_recert_orphan_days = N for the "no sign-in for N days" orphan list (a missing sign-in is UNKNOWN, never old).
// E-S04 (audit S-07) — Entra leaver job access.entra_deprovision (nightly). '0' = today: the job self-skips and
// makes no Graph call at all. '1' (and SSO ready) → lists active local accounts whose linked Entra object is
// disabled or deleted (dry run). entra_deprovision_apply '1' → also deactivates them (Admin ▸ Users path, which
// ends their sessions); the break-glass account is never touched; a Graph 401/403 = consent missing, nothing done.
DEFAULTS.entra_deprovision_enabled = '0';
DEFAULTS.entra_deprovision_apply = '0';
DEFAULTS.access_recert_enabled = '0';
DEFAULTS.access_recert_apply = '0';
DEFAULTS.access_recert_orphan_days = '90';
// C-19 (G41/G43, PO decisions R7/R8/R10). access_approver_policy = WHO decides an access request (editable JSON;
// unreadable → the same default): platform roles (admin, executive, super_admin, tracker-admin, audit-viewer) by a
// super_admin; any other role by an admin-tier user holding the site(s) — never the requester, subject or their
// deputy (services/accessApproverPolicy.js + sodPolicy.js). qualification_check_enabled '0' = today: qualification
// evidence is recorded and shown but never refuses anything; '1' → a capability that declares required kinds
// (catalogue prereq, or qualification_requirements = {"field.capture": ["site-induction"]}) is refused while the
// person's evidence is missing, expired or not verified. Evidence only — SDP360 never grants a physical authorisation.
DEFAULTS.access_approver_policy = JSON.stringify(require('./accessApproverPolicy').DEFAULT_POLICY);
DEFAULTS.qualification_check_enabled = '0';
DEFAULTS.qualification_requirements = '{}';

// C-21 (G47) — shift handover with explicit acceptance (migration 062). '0' = today: no shift handover routes
// (404) and no Handover section on coverage.html. '1' → the outgoing person records the open items and names the
// incoming person, who must accept or refuse (with a reason); never accepted automatically. A handover still
// pending after shift_handover_flag_hours hours is FLAGGED on the page (not accepted, not escalated by itself).
DEFAULTS.shift_handover_enabled = '0';
DEFAULTS.shift_handover_flag_hours = '8';
// C-22 (G49, PO decision R7) — emergency (break-glass) access, migration 063. '0' = today: no emergency routes
// (404), no Emergency section, a C-18 break-glass stays a plain logged direct edit. '1' → a super_admin who is not
// the beneficiary grants a role / site for at most emergency_access_max_hours (hard cap 24 h; a value above is
// read as 24) with a reason; logged risk=1; a post-review is due within 2 working days by another super_admin;
// a qualification prerequisite is never waived. The access.emergency_expiry job ends it at its hour.
DEFAULTS.emergency_access_enabled = '0';
DEFAULTS.emergency_access_max_hours = '24';

// C-31 — KPI Policy Builder (migration 065). '0' = today: every screen computes as it does now; the builder only
// stores, validates and shadow-compares policies. '1' → the Helpdesk page's resolution-SLA tile, ranking and trend
// read the committee-ADOPTED policy of helpdesk.resolution_sla_pct (no adopted policy = today's rule).
DEFAULTS.kpi_policy_enforced = '0';
// D-07 (AMDEC AM-08) — per-site local calendar (migration 066, sites.time_zone; NULL = the country's zone). '0' = today:
// every helpdesk month is bucketed on UTC dates. '1' → the calendar-month helpdesk reader (getCalendarMonthlyHelpdesk)
// buckets a site's tickets on its LOCAL date (a London ticket at 00:30 BST on 1 Sept counts in September). Other
// readers stay UTC for now (follow-up). Only matters for a non-UTC site (all West-African sites are UTC+0).
DEFAULTS.site_local_calendar = '0';
// ── Plan E / W1-GOV switches (defaults = today) ──────────────────────────────────────────────
// ── E-I04 (audit I-04) — '1' = a Business Incubation session can raise ONE RFI (POST /api/governance/rfi/from-meeting/:id)
//    and the session → RFI → project lineage is shown; '0' (default, today) = those routes 404, no button.
DEFAULTS.incubation_rfi_link_enabled = '0';
// ── E-G02 (audit G-02) — '1' = the site obligations view also lists the site's open governance decisions (once:
//    under the commitment or session action they produced); '0' (default, today) = decisions are not read.
DEFAULTS.obligations_include_decisions = '0';
// ── E-G03 (catalogue A13) — '1' = the weekly job governance.agenda_drafts compiles the exception-only agenda of every
//    cadence due this week as a DRAFT on the cadence (nothing is sent, no session is created); '0' (default) = on demand only.
DEFAULTS.agenda_cron_enabled = '0';
// ── E-G04 (audit G-04) — '1' = the control register (risk → control → test → exception) on Admin ▸ Governance policies;
//    controls are seeded as CANDIDATES only (adoption is a GRC decision). '0' (default) = the routes 404, no panel.
DEFAULTS.controls_register_enabled = '0';
// ── Plan E / W2-ITSM switches (defaults = today) ──────────────────────────────────────────────
// ── E-I02 (audit I-02) — '1' = GET /api/commitments/problem-candidates lists recurring-incident CANDIDATES (site ×
//    category × sub-category, causality not validated) and a person may promote one to a commitment; '0' = 404.
//    problem_candidate_min = the recurrence threshold (empty = no candidate at all — no threshold invented here).
DEFAULTS.problem_candidates_enabled = '0';
DEFAULTS.problem_candidate_min = '';
// ── E-I03 (catalogue R15) — '1' = a post-incident (PIR) review record per major incident under /api/commitments/pir
//    (decisions, before/after recurrence counts, linked commitments, sign-off by someone other than the author);
//    '0' (default, today) = those routes 404, no panel.
DEFAULTS.pir_reviews_enabled = '0';
// ── E-I06 (audit I-06, catalogue R06) — insp_repeat_findings '1' = the inspections dashboard lists repeat findings
//    (same site × item rated minor/major/critical in ≥ 2 of the site's last insp_repeat_window submitted inspections;
//    empty window = nothing computed). insp_action_verify_enabled '1' = a closed Critical / High corrective action
//    reads "awaiting verification" until a person who did NOT close it verifies it. '0' (default) = today.
DEFAULTS.insp_repeat_findings = '0';
DEFAULTS.insp_repeat_window = '';
DEFAULTS.insp_action_verify_enabled = '0';
// ── Plan E / W2-REP switches (defaults = today) ──────────────────────────────────────────────
// ── E-R02 (catalogue A01) — '1' = a serious commitment with no due date (and no approved exception) also raises A01;
//    '0' (default, today) = only a missing accountable owner raises A01.
DEFAULTS.a01_missing_due_date = '0';
// ── E-R02 (catalogue A10) — days before a project's next stage gate (approval → start date, in progress → end date)
//    at which the nightly ppm-alerts job (armed by ppm_alerts_enabled) raises an in-app reminder. '' (default) = off.
DEFAULTS.a10_gate_lead_days = '';
// ── E-R04 (audit R-04) — '1' = report-delivery failures (report_sent_log fail, failed publish runs) are also alerted
//    through the sync-alert path (sync_alert_* recipients / Teams); '0' (default) = listed on System Logs, not sent.
DEFAULTS.delivery_failure_alert_enabled = '0';
// ── E-R06 (catalogue A05) — '1' = the daily engagement.schedule_reminders job writes in-app reminders to the site's
//    editors before a scheduled PV / incubation session, cadence meeting or (with an interval) site inspection;
//    '0' (default, today) = no reminder. Lead days and inspection interval: '' = off (policy, not decided).
DEFAULTS.schedule_reminders_enabled = '0';
DEFAULTS.schedule_reminder_lead_days = '';
DEFAULTS.schedule_inspection_interval_days = '';
// ── E-R07 (audit R-07) — sober alerting. alert_group_by_rule '1' = the e-mail digest folds one rule's alert notifications
//    into ONE line listing the sites; '0' (default) = one line per notification (today). alert_quiet_hours "HH:MM-HH:MM"
//    (UTC) = non-critical in-app firings inside the window are deferred until it ends; '' (default) = no quiet window.
DEFAULTS.alert_group_by_rule = '0';
DEFAULTS.alert_quiet_hours = '';
// F-DATA-03 — the two programme metrics of the registry (programme.site_score, programme.composite) are wired
// through services/metricDeps.js. '0' (default) = today: not computed, shown as "—". '1' = computed on dashboards,
// agendas, /api/metrics and /ext/v1 — NOT certified (D-01 / D-02 / D-03 pending): a KPI-committee decision.
DEFAULTS.metric_programme_readers = '0';

const KEYS = Object.keys(DEFAULTS);

// Secrets that the GET handler redacts to '' — a Save that doesn't retype them must
// NOT wipe the stored value (blank = keep). Any new secret-shaped key joins this set.
const _SECRET_BLANK_KEEP = new Set([
  'smtp_pass', 'entra_client_secret', 'meridian_out_key', 'meridian_in_key', 'meraki_api_key', 'opmanager_api_key', 'opmanager_ca_bundle',
  'sdp_api_client_secret', 'sdp_api_refresh_token', 'teams_sla_channels',
  'analytics_client_secret', 'analytics_refresh_token',
  'engagement_teams_url', 'engagement_webhook_url', 'publish_webhook_url', 'sharepoint_client_secret',
  'sync_alert_teams_url',
]);

function _h(db) {
  const rdb = require('../reports-db');
  return { H: rdb.pgHandle(), isPg: true };
}


// A-13 (audit 2026-09-24) — the six secret-shaped values are encrypted at rest when
// SDP_CONFIG_KEY is set, so a database dump (or a restore point) no longer hands whoever
// holds it the SSO client secret. With no key, everything below is a no-op and the
// behaviour is byte-identical to before: nobody is locked out of SMTP by a deploy that
// forgot to set a variable.
const _secrets = require('./configSecrets');
const _keyOf = (opts) => {
  if (opts && 'key' in opts) return opts.key ? _secrets.keyFrom(opts.key) : null;
  return _secrets.envKey();
};

function _fold(rows, key) {
  const out = { ...DEFAULTS };
  rows.forEach(r => {
    if (!_SECRET_BLANK_KEEP.has(r.key)) { out[r.key] = r.value; return; }
    const plain = _secrets.decryptValue(r.value, key, { keyName: r.key });   // A-28b: v3 boxes are bound to their key name
    if (plain === null) {
      // An encrypted value we cannot open. Returning the box would make nodemailer or the
      // SSO handshake fail with an error nobody can read, so it reads as "not configured"
      // and says why, once, in the log.
      console.warn(`[report-config] ${r.key} is encrypted but SDP_CONFIG_KEY is missing or wrong — read as empty.`);
      out[r.key] = '';
      return;
    }
    out[r.key] = plain;
  });
  return out;
}
function getConfig(db, opts) {
  const key = _keyOf(opts);
  const { H, isPg } = _h(db);
  return (async () => _fold(await H.prepare('SELECT key, value FROM report_config').all(), key))();
}

const _UPSERT = `INSERT INTO report_config (key, value, updated_at, updated_by)
  VALUES (?, ?, {NOW}, ?)
  ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by`;
function setConfig(db, patch, user, opts) {
  const _key = _keyOf(opts);
  // A blank smtp_pass means "keep the existing password" — the GET handler
  // redacts it to '', so a Save that doesn't retype it must NOT wipe the stored value.
  const clean = Object.entries(patch || {})
    .filter(([k]) => KEYS.includes(k))
    .filter(([k, v]) => !(_SECRET_BLANK_KEEP.has(k) && String(v) === ''))
    // Encrypt on the way in, and only the secret-shaped keys: a host or a port stays
    // legible so an operator can still read the table when something is wrong.
    .map(([k, v]) => [k, _SECRET_BLANK_KEEP.has(k) ? _secrets.encryptValue(String(v), _key, { keyName: k }) : v]);
  const { H, isPg } = _h(db);
  return (async () => {
    await H.runTransaction(async () => {
      for (const [k, v] of clean) await H.prepare(_UPSERT.replace('{NOW}', 'now()')).run(k, String(v), user || 'unknown');
    });
    return getConfig(db, opts);
  })();
}

module.exports = { DEFAULTS, KEYS, _SECRET_BLANK_KEEP, getConfig, setConfig };
