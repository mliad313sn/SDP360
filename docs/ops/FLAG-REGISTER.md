# Flag register — every behaviour switch, its default and its rollback

**Generated** by `node tools/agent/flag-register.js` — do not edit by hand; `--check` fails when this file is
out of date (`tests/flag-register.test.js`). Every default below **is today's behaviour**: changing one is a
decision of the named owner (PILOT-PROFILE "Who decides"); "to be named" means no owner is recorded yet.
Recommended values are **proposals, not approvals**. Secrets are listed by name only — never a value.

Rollback, by source: **report_config** → set the key back to its default in Admin ▸ Config (the `ui_*` keys:
`node tools/reports/set-ui-policy.js`, dry run first); **governance policy** → Admin ▸ Governance policies
(protected rules need two people to relax); **environment** → restore the `.env` line, then pm2 stop → start.

Always-on internal telemetry (no switch, nothing a user sees): `page_viewed` (C-09) — one system_log row per
user × page × day, user id + role tier only; report at Admin ▸ System Logs ▸ Page usage.

## 1. report_config keys (180) — services/reportConfig.js DEFAULTS

| Key | Default (today) | Kind | Owner | Recommended pilot value | Reference |
|---|---|---|---|---|---|
| `access_approver_policy` | `{"platform_roles":["admin","executive","super_admin","tra…` | setting | Security owner + Owner | the default (PO decision R7, encoded 2026-11-05): platform roles by a super_admin, other roles by an admin-tier user holding the site; never the requester, subject or their deputy | C-19 |
| `access_grant_expiry_job` | `0` | setting | Security owner | `1` (ends expired grants nightly; a role held before the grant or by another live grant stays) | C-18 |
| `access_recert_apply` | `0` | setting | Security owner | PROPOSITION: `0` for the first campaign (revoke answers recorded only, reviewed by the Security owner); `1` only after that review | E-S03 |
| `access_recert_enabled` | `0` | arm switch | Security owner + site managers | PROPOSITION: `1` once the Security owner schedules the first campaign (site managers answer their lines; the subject never answers their own) | E-S03 |
| `access_recert_orphan_days` | `90` | setting | Security owner | PROPOSITION: N to be chosen by the Security owner (an account with no sign-in evidence is listed as UNKNOWN, never as idle) | E-S03 |
| `access_require_approval` | `0` | setting | Security owner + Owner (approver matrix) | `1` once the approver rule and the requires_request list are decided (break-glass stays possible, logged risk=1) | C-18 |
| `agenda_cron_enabled` | `0` | arm switch | Committee | `1` (the Monday job prepares a DRAFT agenda per cadence due that week; nothing is sent, the secretary still prepares the session) | E-G03 |
| `alert_external_enabled` | `0` | arm switch | to be named | — | — |
| `analytics_accounts_url` | `` | setting | to be named | — | — |
| `analytics_client_id` | `` | setting | to be named | — | — |
| `analytics_client_secret` | (secret — not shown) | secret | to be named | — | — |
| `analytics_org_id` | `` | setting | to be named | — | — |
| `analytics_refresh_token` | (secret — not shown) | secret | to be named | — | — |
| `analytics_workspace_id` | `` | setting | to be named | — | — |
| `asset_amount_parser` | `legacy` | setting | Finance | `locale` | A-26 |
| `asset_cost_outlier_exclude` | `0` | setting | Finance | `0` | A-26 |
| `asset_cost_outlier_factor` | `10` | setting | Finance | `10` | A-26 |
| `asset_currency_rates` | `` | setting | Finance | rates supplied by Finance | A-26 |
| `asset_depreciation_config` | `{"default":{"method":"straight_line","useful_life_months"…` | setting | to be named | — | — |
| `asset_group_recipients` | `` | setting | to be named | — | — |
| `asset_group_send_enabled` | `0` | arm switch | to be named | — | — |
| `asset_money_certify_display` | `0` | setting | Finance / IT management | `1` | A-16 |
| `asset_money_certify_min_pct` | `50` | setting | Finance | `50` | A-16 |
| `asset_money_certify_min_sites` | `3` | setting | Finance | `3` | A-16 |
| `asset_new_alert_enabled` | `0` | arm switch | to be named | — | — |
| `asset_reminder_send_enabled` | `0` | arm switch | to be named | — | — |
| `asset_replacement_uplift_pct` | `0` | setting | to be named | — | — |
| `asset_site_currency` | `` | setting | Finance | per-site JSON supplied by Finance | A-26 |
| `auth_account_throttle_enabled` | `0` | arm switch | Security owner | `1` (per-account failed sign-in cap on top of the per-IP limiter; note a deliberate lock-out of a named account is possible for its window) | SEC-01 |
| `auth_account_throttle_max` | `10` | setting | Security owner | `10` failed sign-ins per account per window | SEC-01 |
| `auth_account_throttle_window_min` | `15` | setting | Security owner | `15` minutes | SEC-01 |
| `authz_capability_mode` | `off` | setting | Security owner | `shadow` (log divergences only; `enforce` acts only on `authz_enforce_caps` — route-by-route plan in `docs/agent-execution/C-17.md`) | C-17 |
| `authz_enforce_caps` | `` | setting | Security owner | PROPOSITION: empty during the pilot; after two shadow weeks without unexplained divergences (`tools/security/authz-divergence-report.js`), low-risk reads first (`review.read`, `analytics.data.read`, `tracker.read`) with mode `enforce`; a listed capability can only refuse, critical ones are ignored while C-18 grants are off | E-S01 |
| `backup_offsite_path` | `` | setting | to be named | — | — |
| `commitment_notify_enabled` | `0` | arm switch | to be named | — | — |
| `commitments_enabled` | `0` | arm switch | to be named | — | — |
| `controls_register_enabled` | `0` | arm switch | GRC owner + Security owner | `1` once GRC names who adopts controls (the four seeded controls stay `candidate` until a person adopts them with a reason; frequencies and testers are GRC decisions) | E-G04 |
| `dashkey_allowed_routes` | `` | setting | Integration owner + Security owner | the routes the named consumers really call (from the consumer report), e.g. `GET /api/ping, GET /api/data/*` — PROPOSITION, no list approved | E-S02 |
| `dashkey_scope_mode` | `open` | setting | Integration owner + Security owner | `shadow` first (an unlisted key-only route still answers and logs `dashkey_scope_would_refuse`); `restrict` (401) only after every consumer in `tools/security/dashkey-consumers.js` is named and listed. A browser request is never affected | E-S02 |
| `default_email_domain` | `edv-ops.com` | setting | to be named | — | — |
| `embed_frame_ancestors` | `` | setting | to be named | — | — |
| `emergency_access_enabled` | `0` | arm switch | Security owner + Owner | `1` once the super_admins who may grant and review are named (a super_admin, never the beneficiary, max 24 h, review within 2 working days by another super_admin — PO decision R7; never waives a qualification) | C-22 |
| `emergency_access_max_hours` | `24` | setting | Security owner | `24` (hard cap; may only be lowered) | C-22 |
| `engagement_digest_hour` | `7` | setting | to be named | — | — |
| `engagement_teams_url` | (secret — not shown) | secret | to be named | — | — |
| `engagement_webhook_url` | (secret — not shown) | secret | to be named | — | — |
| `entra_client_id` | `` | setting | to be named | — | — |
| `entra_client_secret` | (secret — not shown) | secret | to be named | — | — |
| `entra_deprovision_apply` | `0` | setting | Information Security | PROPOSITION: `0` until a dry run has been reviewed and the revocation delay measured on TEST; then `1` | E-S04 |
| `entra_deprovision_enabled` | `0` | arm switch | Information Security + tenant administrator | PROPOSITION: `1` (dry run) only after the tenant administrator decides on the Graph `User.Read.All` application consent (gate 2); read the dry-run list on TEST first | E-S04 |
| `entra_redirect_uri` | `` | setting | to be named | — | — |
| `entra_tenant_id` | `` | setting | to be named | — | — |
| `exec_deck_other_bucket` | `0` | setting | Reporting owner (PO P4) | `1` (PO decision P4: "Other (n)" on every top-N deck chart, Normal changes as their own slice) | C-16 |
| `exec_payload_zero_policy` | `keep_server` | setting | KPI committee | `keep_server` until the committee chooses (`browser_wins` is the alternative) | A-17 |
| `exec_view_change_formula` | `status` | setting | KPI committee (D-01) | `deck` | A-08 |
| `exec_view_lang` | `en` | setting | to be named | — | — |
| `exec_view_mi_detail` | `full` | setting | Owner (reverses the 2026-07-02 "option a") | `summarized_only` | A-08 |
| `field_outbox_resolve_enabled` | `0` | arm switch | PO + site IT | `0` until the real-device sessions (E-F04, audit F-01) show how often field entries get stuck — otherwise an admin repair becomes the normal path (X-§7-01); then `1` (admin tier may `mark_rejected` or `release` a stuck entry; a ticket / action is released only after checking SDP, with a reason; every resolution is a risk row in System Logs; nothing is applied server-side). The read-only list `GET /api/field/admin/outbox` has no switch | E-F01 |
| `field_photo_max_kb` | `300` | setting | to be named | — | — |
| `field_review_step` | `0` | setting | PO / adoption lead | `1` on the pilot site after one session shows it does not slow the technician (a one-screen summary — site, items, findings, photos, offline note — before an inspection is queued; « Corriger » queues nothing) | E-F03 |
| `field_task_timing` | `0` | setting | PO / adoption lead | `1` for the pilot window to take a BASELINE (active time form open → queued, pauses > 2 min excluded, user id + role tier only; median / p75 per site × kind × week in `tools/pilot/pilot-metrics.js`). No target is set — targets come only after the baseline (PILOT-MEASUREMENT.md) | E-F03 |
| `formats` | `html,pdf` | setting | to be named | — | — |
| `from` | `` | setting | to be named | — | — |
| `group_report_cc` | `` | setting | to be named | — | — |
| `group_report_to` | `` | setting | to be named | — | — |
| `group_report_to_confirmed` | `0` | setting | to be named | — | — |
| `handoff_notify_enabled` | `0` | arm switch | to be named | — | — |
| `handoffs_enabled` | `0` | arm switch | to be named | — | — |
| `helpdesk_sla_definition` | `flag` | setting | KPI committee | `flag` until the committee chooses (`due_vs_resolved` is the alternative) | A-17 |
| `hygiene_recipients` | `` | setting | to be named | — | — |
| `hygiene_send_enabled` | `0` | arm switch | to be named | — | — |
| `incubation_rfi_link_enabled` | `0` | arm switch | PMO + Owner | `1` on the pilot site once the PMO accepts incubation-born RFIs in the queue (the RFI score stays provisional: incubation scoring criteria are a human decision) | E-I04 |
| `kpi_policy_enforced` | `0` | setting | KPI committee + Owner | `0` until the KPI committee has ADOPTED a resolution-SLA policy on `/kpi-builder.html` (two different members: author ≠ adopter, with the session reference) and read the shadow comparison; then `1` (the Helpdesk tile, ranking and trend follow the adopted version) | C-31 |
| `meraki_api_key` | (secret — not shown) | secret | to be named | — | — |
| `meraki_base_url` | `https://api.meraki.com/api/v1` | setting | to be named | — | — |
| `meraki_missing_policy` | `down` | setting | to be named | — | — |
| `meraki_org_id` | `` | setting | to be named | — | — |
| `meridian_base_url` | `` | setting | to be named | — | — |
| `meridian_enabled` | `1` | arm switch | Owner (D-5) | `0` (retire) | A-20 |
| `meridian_in_key` | (secret — not shown) | secret | to be named | — | — |
| `meridian_out_key` | (secret — not shown) | secret | to be named | — | — |
| `never_send_unconfirmed` | `1` | setting | to be named | — | — |
| `notifications_stop` | `0` | setting | to be named | — | — |
| `obligations_include_decisions` | `0` | setting | Committee + Owner | `1` (the site obligations view then counts the site's open governance decisions; the visible total of a site can grow) | E-G02 |
| `opm_availability_view_id` | `` | setting | to be named | — | — |
| `opm_monitor_patterns` | `opma,abj-spm-000` | setting | to be named | — | — |
| `opm_rest_concurrency` | `1` | setting | Ops | `1` | A-18 (A-18b) |
| `opm_stale_days` | `9` | setting | to be named | — | — |
| `opm_targets` | `{"lan":99,"wifi":98,"wan":98,"servers":99}` | setting | to be named | — | — |
| `opmanager_api_key` | (secret — not shown) | secret | to be named | — | — |
| `opmanager_base_url` | `` | setting | to be named | — | — |
| `opmanager_ca_bundle` | (secret — not shown) | secret | to be named | — | — |
| `opmanager_tls_insecure` | `0` | setting | to be named | — | — |
| `outbound_allow_hosts` | `` | setting | to be named | — | — |
| `portfolio_editor_plan_writes` | `0` | setting | Owner (access policy) | `1` | A-15 |
| `portfolio_site_scope_reads` | `0` | setting | Owner (access policy) | `1` | A-15 |
| `ppm_alert_blocked_days` | `5` | setting | Committee | `5` | A-27 |
| `ppm_alert_slip_days` | `10` | setting | Committee | `10` | A-27 |
| `ppm_alerts_enabled` | `0` | arm switch | Committee | `0` (dry run first) | A-27 |
| `ppm_baseline_versions` | `0` | setting | Committee | `1` | A-27 |
| `ppm_rebaseline_enabled` | `0` | arm switch | Committee | `1` | A-27 |
| `public_base_url` | `` | setting | to be named | — | — |
| `publish_cron_enabled` | `0` | arm switch | to be named | — | — |
| `publish_excel_recipients` | `` | setting | to be named | — | — |
| `publish_metric_keys` | `helpdesk.resolution_sla_pct,helpdesk.first_reply_sla_pct,…` | setting | to be named | — | — |
| `publish_webhook_url` | (secret — not shown) | secret | to be named | — | — |
| `qualification_check_enabled` | `0` | arm switch | HSE owner + Security owner | `0` until each site's HSE owner has recorded and verified the evidence; then `1` per requirement (evidence only — SDP360 never grants a physical authorisation) | C-19 |
| `qualification_requirements` | `{}` | setting | HSE owner | `{}` — which capability needs which kind (e.g. `field.capture` → `site-induction`) is a human decision | C-19 |
| `reconcile_recent_days` | `30` | setting | to be named | — | — |
| `reply_to` | `` | setting | to be named | — | — |
| `report_drift_banner` | `0` | setting | Owner (D-3) | `1` | A-24 |
| `report_reassign_submitted` | `1` | setting | Owner (D-3) | `0` | A-24 |
| `report_revert_policy` | `site_editor` | setting | Owner (D-3, reverses 2026-10-02) | `second_person` | A-24 |
| `roadmap_redirect_to_portfolio` | `0` | setting | PMO + PO (deletion of roadmap data: CAB) | `0` during the pilot; `1` only after one clean parity cycle (`tools/governance/roadmap-parity.js`) | B-09 |
| `scoreboard_send_enabled` | `0` | arm switch | to be named | — | — |
| `sdp_api_accounts_url` | `https://accounts.zoho.com` | setting | to be named | — | — |
| `sdp_api_base_url` | `https://oneitsupport.endeavourmining.com/app/itdesk/api/v3` | setting | to be named | — | — |
| `sdp_api_client_id` | `` | setting | to be named | — | — |
| `sdp_api_client_secret` | (secret — not shown) | secret | to be named | — | — |
| `sdp_api_open_filter` | `Open_System` | setting | to be named | — | — |
| `sdp_api_refresh_token` | (secret — not shown) | secret | to be named | — | — |
| `sdp_api_write_enabled` | `0` | arm switch | to be named | — | — |
| `sharepoint_client_id` | `` | setting | to be named | — | — |
| `sharepoint_client_secret` | (secret — not shown) | secret | to be named | — | — |
| `sharepoint_list_id` | `` | setting | to be named | — | — |
| `sharepoint_site_id` | `` | setting | to be named | — | — |
| `sharepoint_tenant_id` | `` | setting | to be named | — | — |
| `shift_handover_enabled` | `0` | arm switch | Site IT lead + Owner | `1` on the pilot site once the incoming / outgoing people of each shift are on the duty roster (handover must be accepted by the incoming person; never automatic) | C-21 |
| `shift_handover_flag_hours` | `8` | setting | Site IT lead | `8` (a handover still pending after this many hours is flagged on the page) | C-21 |
| `site_code_shared_block` | `0` | setting | Data owner + Owner | `1` once the data owner has given each shared code to one site (Assafo/Tanda → tracker `TND`, AM-01) — while `0` both editors keep writing the same scope; `1` refuses a scoped editor's tracker / meetings / inspection save under a code two active sites share (409 naming the sites, page banner), never picks an owner | D-01 |
| `site_codes_from_registry` | `0` | setting | Data owner + KPI committee | PROPOSITION: `shadow` (E-D01 double read — hard maps keep answering, every registry divergence is logged once a day in System Logs ▸ governance) for at least two weeks, then `1` only by the committee (gate 10) | DEC-4, E-D01 |
| `site_local_calendar` | `0` | setting | Owner + Finance (month-end figures) | `0` while every reporting site is UTC+0; `1` only when a non-UTC site (e.g. the London office) is reported and its time zone (`sites.time_zone`, else from its country) is confirmed — only the calendar-month helpdesk figures move | D-07 |
| `site_score_published_model` | `legacy` | setting | Owner (D-1) | `programme` | A-11 |
| `sla_wan_config` | `{"notify":{"enabled":false,"trigger_minutes":15,"from_nam…` | setting | to be named | — | — |
| `smtp_host` | `` | setting | to be named | — | — |
| `smtp_pass` | (secret — not shown) | secret | to be named | — | — |
| `smtp_port` | `587` | setting | to be named | — | — |
| `smtp_secure` | `0` | setting | to be named | — | — |
| `smtp_user` | `` | setting | to be named | — | — |
| `soft_delete_enabled` | `0` | arm switch | Owner (retention policy) | `1` | A-19 |
| `soft_delete_purge_enabled` | `0` | arm switch | Owner (retention policy) | `0` (keep everything during the pilot) | A-19 |
| `soft_delete_retention_days` | `30` | setting | Owner (retention policy) | `30` | A-19 |
| `sso_breakglass_user` | `` | setting | to be named | — | — |
| `sso_group_map` | `` | setting | to be named | — | — |
| `sso_mode` | `` | setting | to be named | — | — |
| `sync_alert_enabled` | `1` | arm switch | to be named | — | — |
| `sync_alert_recipients` | `` | setting | to be named | — | — |
| `sync_alert_teams_url` | (secret — not shown) | secret | to be named | — | — |
| `sync_drift_alerts` | `0` | setting | Ops + data owner per flow | PROPOSITION: `1` once each flow has an owner (drift is already computed and shown in `/api/sync/health` at `0`; `1` sends it through the sync alert path, once per 24 h per job) | E-D04 |
| `sync_drift_drop_pct` | `50` | setting | Ops + data owner per flow | PROPOSITION: `50` (last run below 50 % of the rolling median = `drop`) — to be set per flow by its owner | E-D04 |
| `sync_drift_duplicates_pct` | `10` | setting | Ops + data owner per flow | PROPOSITION: `10` (duplicates above 10 % of the last run's rows) | E-D04 |
| `sync_drift_spike_pct` | `300` | setting | Ops + data owner per flow | PROPOSITION: `300` (last run above 300 % of the median = `spike`) | E-D04 |
| `sync_truncation_tolerance_pct` | `20` | setting | to be named | — | — |
| `teams_sla_channels` | (secret — not shown) | secret | to be named | — | — |
| `teams_sla_enabled` | `0` | arm switch | to be named | — | — |
| `teams_sla_last_run` | `` | setting | to be named | — | — |
| `teams_sla_rules` | `` | setting | to be named | — | — |
| `tracker_engine_cutover` | `0` | setting | to be named | — | — |
| `transport` | `smtp` | setting | to be named | — | — |
| `ui_deck_builder_roles` | `super_admin` | ui policy | Owner (D-6) | `super_admin,report-author` (PO delegated decision P12, reversible) | A-21, C-28 |
| `ui_exec_nav` | `full` | ui policy | Owner (D-6) | `consolidated` (PO delegated decision P1, reversible — re-examine after 30 days of `page_viewed`) | C-28 |
| `ui_i18n_pages` | `0` | ui policy | Owner (D-2) | `1` | A-09, C-26 |
| `ui_inject_dash_key` | (secret — not shown) | secret | Security owner | `0` (pages no longer receive `window.__ak`; every data call rides the session cookie — proven by `tests/api-key-injection.smoke.test.js` (g)) after one browser pass on the TEST instance | E-S02 |
| `ui_kpi_base_line` | `0` | ui policy | Owner (UI policy) | `1` (proposal — show the base population under each KPI value) | E-V03 |
| `ui_kpi_sample_size` | `0` | ui policy | KPI committee | `1` (proposal — warnings only appear once the KPI committee adopts a `min_sample`) | E-K02 |
| `ui_lang_default` | `` | ui policy | Owner (D-2) | `fr` | A-09 |
| `ui_nav_profile` | `full` | ui policy | Owner (D-6) | `lean` (proposal — re-decide from the T1–T8 sessions) | A-21 |
| `ui_role_landing` | `0` | ui policy | Owner (UI policy) | `1` | A-10 |
| `ui_small_multiples` | `0` | ui policy | Owner (UI policy) | `1` (proposal — after a browser review of the widget) | E-V09 |
| `ui_week_labels` | `legacy` | ui policy | Owner (UI policy) | `explicit` (proposal — ISO helpdesk charts say "ISO W37 (7–13 Sep)", report rows carry their Sun→Sat range) | D-03 |
| `wan_mos_config` | `{"r0":93.2,"codec_loss_factor":2.5,"jitter_buffer_factor"…` | setting | to be named | — | — |
| `wan_poll_first_run` | `` | setting | to be named | — | — |
| `wan_poll_last_run` | `` | setting | to be named | — | — |
| `wan_quality_thresholds` | `{"loss":{"good":1,"bad":7},"latency":{"good":100,"bad":40…` | setting | to be named | — | — |
| `wan_sla_require_contract_evidence` | `0` | setting | Finance | `1` once contracts are uploaded | A-25 |
| `wan_stale_close_at` | `now` | setting | Network owner | `last_seen` | A-25 |
| `wan_timeup_latency_ms` | `` | setting | to be named | — | — |
| `wan_timeup_loss_pct` | `100` | setting | Network owner | `5` (calibration of 2026-09-04) | A-18 (pre-existing key; A-18b adds the uncalibrated banner + `tools/meraki/check-timeup-calibration.js`) |
| `weekly_report_send_enabled` | `0` | arm switch | to be named | — | — |
| `xof_usd_rate` | `0.00165` | setting | to be named | — | — |

## 2. Planned switches (9) — named in PILOT-PROFILE, not yet in DEFAULTS on this branch

| Key | Status | Default its goal fixes | Owner | Reference |
|---|---|---|---|---|
| `capacity_alert_weeks` | planned | `2` | Owner (D-7) | A-13 |
| `capacity_alerts_enabled` | planned | `0` | Owner (D-7) | A-13 |
| `capacity_amber_pct` | planned | `85` | Owner (D-7) | A-13 |
| `capacity_enabled` | planned | `0` | Owner (D-7) | A-13 |
| `capacity_helpdesk_basis` | planned | `resolved` | Helpdesk lead | A-13 |
| `capacity_red_pct` | planned | `100` | Owner (D-7) | A-13 |
| `capacity_weeks_ahead` | planned | `8` | Ops | A-13 |
| `capacity_weeks_back` | planned | `12` | Ops | A-13 |
| `capacity_workdays_per_week` | planned | `5` | Ops | A-13 |

## 3. Governance policies (37) — services/governancePolicy.js PARAMS

| Key | Default (today) | Type | Protected | Site-scoped | Owner |
|---|---|---|---|---|---|
| `calendar.skip_weekends` | `false` | bool | yes | yes | to be named |
| `commitments.escalation_enabled` | `true` | bool | yes | yes | to be named |
| `commitments.exception_max_days` | `90` | int | yes | yes | to be named |
| `commitments.serious_due_move_needs_admin` | `true` | bool | yes | yes | to be named |
| `freshness.assets_hours` | `30` | number | yes | no | to be named |
| `freshness.changes_hours` | `3` | number | yes | no | to be named |
| `freshness.helpdesk_hours` | `3` | number | yes | no | to be named |
| `freshness.infra_hours` | `30` | number | yes | no | to be named |
| `freshness.survey_hours` | `3` | number | yes | no | to be named |
| `freshness.wan_hours` | `30` | number | yes | no | to be named |
| `governance.dual_approval_relaxations` | `true` | bool | yes | no | to be named |
| `governance.dual_approval_tightening` | `false` | bool | yes | no | to be named |
| `governance.quorum_min` | `null` | int | yes | yes | to be named |
| `governance.relaxation_max_days` | `90` | int | yes | no | to be named |
| `governance.skip_inactive_holders` | `false` | bool | yes | no | Owner (access policy) |
| `handoffs.commitment_ledger` | `false` | bool | no | yes | to be named |
| `handoffs.escalation_grace_days` | `0` | int | yes | yes | to be named |
| `handoffs.overdue_escalation` | `true` | bool | yes | yes | to be named |
| `handoffs.proxy_accept` | `false` | bool | yes | yes | to be named |
| `handoffs.queue_receivers` | `false` | bool | no | yes | to be named |
| `handoffs.reason_min` | `5` | int | yes | yes | to be named |
| `meetings.cancel_reason_min` | `5` | int | yes | yes | to be named |
| `meetings.cancel_requires_approval` | `true` | bool | yes | yes | to be named |
| `meetings.compliance_as_of` | `false` | bool | no | yes | to be named |
| `meetings.group_decisions_public` | `true` | bool | yes | no | to be named |
| `meetings.minutes_four_eyes` | `true` | bool | yes | yes | to be named |
| `meetings.missed_grace_hours` | `48` | number | yes | yes | to be named |
| `meetings.reopen_reason_min` | `10` | int | yes | yes | to be named |
| `meetings.reopen_two_people` | `false` | bool | yes | yes | to be named |
| `publication.four_eyes` | `true` | bool | yes | yes | to be named |
| `publication.override_allowed` | `true` | bool | yes | yes | to be named |
| `publication.override_reason_min` | `10` | int | yes | yes | to be named |
| `reports.four_eyes` | `true` | bool | yes | yes | to be named |
| `reports.freshness_gate` | `true` | bool | yes | yes | to be named |
| `reports.override_allowed` | `true` | bool | yes | yes | to be named |
| `reports.override_reason_min` | `10` | int | yes | yes | to be named |
| `reports.withdraw_reason_min` | `5` | int | yes | yes | to be named |

## 4. Environment variables (62) — read in *.js, services/, routes/

| Variable | Kind | Default when unset | Owner | Read in |
|---|---|---|---|---|
| `AI_PROVIDER` | switch | off (no AI call) | Owner | server.js |
| `ANTHROPIC_API_KEY` | secret | (secret — not shown) | to be named | server.js |
| `AUDIT_RISK_RETENTION_MONTHS` | setting | see the reading file | to be named | reports-db.js |
| `BIND_HOST` | setting | see the reading file | to be named | services/netBinding.js |
| `CORS_EXTRA_ORIGINS` | setting | see the reading file | to be named | services/netBinding.js |
| `DASHBOARD_API_KEY` | secret | (secret — not shown) | to be named | services/apiKey.js |
| `DASH_PASS` | secret | (secret — not shown) | to be named | reports-db.js, server.js |
| `DASH_USER` | setting | see the reading file | to be named | reports-db.js, server.js |
| `DATABASE_URL` | setting | see the reading file | to be named | assets-db.js, inspection-db.js, meetings-db.js, reports-db.js (+3) |
| `DEBUG` | setting | see the reading file | to be named | services/dashboardData.js |
| `ENTRA_CLIENT_ID` | setting | see the reading file | to be named | services/ssoSettings.js |
| `ENTRA_CLIENT_SECRET` | secret | (secret — not shown) | to be named | services/ssoSettings.js |
| `ENTRA_REDIRECT_URI` | setting | see the reading file | to be named | services/ssoSettings.js |
| `ENTRA_TENANT_ID` | setting | see the reading file | to be named | services/ssoSettings.js |
| `EXEC_PPTX_TIMEOUT_MS` | setting | see the reading file | to be named | server.js |
| `EXT_API_RATE_PER_MIN` | setting | see the reading file | to be named | routes/extApi.js |
| `FMP_API_KEY` | secret | (secret — not shown) | to be named | server.js, services/fmpClient.js |
| `FMP_API_TIMEOUT_MS` | setting | see the reading file | to be named | services/fmpClient.js |
| `FMP_API_URL` | setting | see the reading file | to be named | services/fmpClient.js |
| `FMP_CACHE_MS` | setting | see the reading file | to be named | routes/fourmypeople.js |
| `LOCAL_LLM_MODEL` | setting | see the reading file | to be named | server.js |
| `LOCAL_LLM_TIMEOUT` | setting | see the reading file | to be named | server.js |
| `LOCAL_LLM_URL` | setting | see the reading file | to be named | server.js |
| `MANAGE_CMD` | setting | see the reading file | to be named | services/backupSchedule.js |
| `MANAGE_PS1` | setting | see the reading file | to be named | services/backupSchedule.js |
| `NODE_ENV` | setting | see the reading file | to be named | server.js, services/apiKey.js, services/configSecrets.js |
| `ORG_ID` | setting | see the reading file | to be named | server.js |
| `PG_POOL_MAX` | setting | see the reading file | to be named | services/pgDb.js |
| `PG_URL` | setting | see the reading file | to be named | assets-db.js, inspection-db.js, meetings-db.js, reports-db.js (+4) |
| `PM2_NAME` | setting | see the reading file | to be named | services/serviceControl.js |
| `PORT` | setting | see the reading file | to be named | server.js |
| `REPORT_BROWSER` | setting | see the reading file | to be named | services/reportRender.js |
| `REPORT_PDF_TIMEOUT_MS` | setting | see the reading file | to be named | services/reportRender.js |
| `REPORT_SEND_TIMEOUT_MS` | setting | see the reading file | to be named | server.js |
| `REQUIRE_CONFIG_KEY` | setting | see the reading file | to be named | services/backendGuard.js |
| `REQUIRE_POSTGRES` | setting | see the reading file | to be named | server.js, services/backendGuard.js |
| `SDP_ALLOW_PLAINTEXT_SECRETS` | switch | see the reading file | to be named | services/configSecrets.js |
| `SDP_BACKUP_DIR` | switch | see the reading file | to be named | services/backupSchedule.js |
| `SDP_BACKUP_KEY` | secret | (secret — not shown) | to be named | services/backup.js, services/dbRestore.js |
| `SDP_CONFIG_BOX_VERSION` | switch | unset = 2 (`enc:v2`) | Security owner | services/configSecrets.js |
| `SDP_CONFIG_KEY` | secret | (secret — not shown) | to be named | services/backendGuard.js, services/configSecrets.js |
| `SDP_CSP_REPORT_ONLY` | switch | unset (no report-only header, no /api/security/csp-report) | Security owner | services/cspReport.js |
| `SDP_DATA_DIR` | switch | see the reading file | to be named | assets-db.js, inspection-db.js, meetings-db.js, reports-db.js (+3) |
| `SDP_PDF_SANDBOX` | switch | unset (PDF render keeps --no-sandbox) | Security owner | services/reportRender.js |
| `SDP_QUAL_CFG_TTL_MS` | switch | see the reading file | to be named | services/qualificationStore.js |
| `SDP_SERVICE` | switch | see the reading file | to be named | services/serviceControl.js |
| `SDP_TEST_NO_RATE_LIMIT` | switch | see the reading file | to be named | server.js |
| `SESSION_COOKIE_SECURE` | switch | unset | Security owner | server.js |
| `SESSION_HOURS` | setting | see the reading file | to be named | reports-db.js |
| `SSO_BREAKGLASS_USER` | setting | see the reading file | to be named | services/ssoSettings.js |
| `SSO_ENABLED` | switch | see the reading file | to be named | services/ssoSettings.js |
| `SSO_GROUP_MAP` | setting | see the reading file | to be named | services/ssoSettings.js |
| `SSO_MODE` | setting | see the reading file | to be named | services/ssoSettings.js |
| `SYNC_TRUNCATION_TOLERANCE_PCT` | setting | see the reading file | to be named | zoho-sync.js |
| `WORKSPACE_ID` | setting | see the reading file | to be named | server.js |
| `ZOHO_CLIENT_ID` | setting | see the reading file | to be named | server.js |
| `ZOHO_CLIENT_SECRET` | secret | (secret — not shown) | to be named | server.js, services/analyticsSettings.js |
| `ZOHO_REFRESH_TOKEN` | secret | (secret — not shown) | to be named | server.js |
| `ZOHO_SURVEY_ANSWERS_VIEW_ID` | setting | see the reading file | to be named | routes/survey.js |
| `ZOHO_SURVEY_ID` | setting | see the reading file | to be named | server.js |
| `ZOHO_SURVEY_QUESTIONS_VIEW_ID` | setting | see the reading file | to be named | routes/survey.js |
| `ZOHO_SURVEY_VIEW_ID` | setting | see the reading file | to be named | server.js |
