# Pilot profile — report_config switches of the corrective plan

Version 1 · 2026-11-04 · Source: SDP360 corrective playbook (goals A-01 … B-06) and
`services/reportConfig.js` `DEFAULTS` on the branch that carries this file.

Every switch ships at **today's behaviour** (the "Today" column). The "Recommended pilot value" is the
value the goal *proposes* — **proposed, not approved**: nothing here is a decision. The deciding role
changes a switch in Admin (or with the goal's CLI) on the TEST instance first.

**Status**: `built` = the key is in `DEFAULTS` on this branch (the test `tests/readme-truth.test.js`
checks the default below against the code); `planned` = the goal is not merged yet, the default is the
one its specification fixes. A key missing from `DEFAULTS` is silently dropped by `setConfig`, so a
planned switch cannot be set before its goal lands.

| Key | Status | Today (default) | Recommended pilot value | Who decides | Reference |
|---|---|---|---|---|---|
| `exec_view_mi_detail` | built | `full` | `summarized_only` | Owner (reverses the 2026-07-02 "option a") | A-08 |
| `exec_view_change_formula` | built | `status` | `deck` | KPI committee (D-01) | A-08 |
| `wan_timeup_loss_pct` | built | `100` | `5` (calibration of 2026-09-04) | Network owner | A-18 (pre-existing key; A-18b adds the uncalibrated banner + `tools/meraki/check-timeup-calibration.js`) |
| `opm_rest_concurrency` | built | `1` | `1` | Ops | A-18 (A-18b) |
| `ui_i18n_pages` | built | `0` | `1` | Owner (D-2) | A-09 |
| `ui_lang_default` | built | `` (empty) | `fr` | Owner (D-2) | A-09 |
| `ui_role_landing` | built | `0` | `1` | Owner (UI policy) | A-10 |
| `ui_nav_profile` | built | `full` | `lean` (proposal — re-decide from the T1–T8 sessions) | Owner (D-6) | A-21 |
| `ui_deck_builder_roles` | built (menu entry only) | `super_admin` | `super_admin` (widening also needs the page gate) | Owner (D-6) | A-21 |
| `site_score_published_model` | built | `legacy` | `programme` | Owner (D-1) | A-11 |
| `capacity_enabled` | planned | `0` | `1` | Owner (D-7) | A-13 |
| `capacity_amber_pct` | planned | `85` | `85` | Owner (D-7) | A-13 |
| `capacity_red_pct` | planned | `100` | `100` | Owner (D-7) | A-13 |
| `capacity_alert_weeks` | planned | `2` | `2` | Owner (D-7) | A-13 |
| `capacity_alerts_enabled` | planned | `0` | `0` (armed off during the pilot) | Owner (D-7) | A-13 |
| `capacity_helpdesk_basis` | planned | `resolved` | `resolved` | Helpdesk lead | A-13 |
| `capacity_weeks_back` | planned | `12` | `12` | Ops | A-13 |
| `capacity_weeks_ahead` | planned | `8` | `8` | Ops | A-13 |
| `capacity_workdays_per_week` | planned | `5` | `5` | Ops | A-13 |
| `portfolio_site_scope_reads` | built | `0` | `1` | Owner (access policy) | A-15 |
| `portfolio_editor_plan_writes` | built | `0` | `1` | Owner (access policy) | A-15 |
| `asset_money_certify_display` | built | `0` | `1` | Finance / IT management | A-16 |
| `asset_money_certify_min_sites` | built | `3` | `3` | Finance | A-16 |
| `asset_money_certify_min_pct` | built | `50` | `50` | Finance | A-16 |
| `helpdesk_sla_definition` | built | `flag` | `flag` until the committee chooses (`due_vs_resolved` is the alternative) | KPI committee | A-17 |
| `exec_payload_zero_policy` | built | `keep_server` | `keep_server` until the committee chooses (`browser_wins` is the alternative) | KPI committee | A-17 |
| `soft_delete_enabled` | built | `0` | `1` | Owner (retention policy) | A-19 |
| `soft_delete_retention_days` | built | `30` | `30` | Owner (retention policy) | A-19 |
| `soft_delete_purge_enabled` | built | `0` | `0` (keep everything during the pilot) | Owner (retention policy) | A-19 |
| `meridian_enabled` | built | `1` | `0` (retire) | Owner (D-5) | A-20 |
| `report_revert_policy` | built | `site_editor` | `second_person` | Owner (D-3, reverses 2026-10-02) | A-24 |
| `report_reassign_submitted` | built | `1` | `0` | Owner (D-3) | A-24 |
| `report_drift_banner` | built | `0` | `1` | Owner (D-3) | A-24 |
| `wan_stale_close_at` | built | `now` | `last_seen` | Network owner | A-25 |
| `wan_sla_require_contract_evidence` | built | `0` | `1` once contracts are uploaded | Finance | A-25 |
| `asset_amount_parser` | built | `legacy` | `locale` | Finance | A-26 |
| `asset_site_currency` | built | `` (empty = every site XOF) | per-site JSON supplied by Finance | Finance | A-26 |
| `asset_currency_rates` | built | `` (empty = XOF via `xof_usd_rate`, USD 1) | rates supplied by Finance | Finance | A-26 |
| `asset_cost_outlier_factor` | built | `10` | `10` | Finance | A-26 |
| `asset_cost_outlier_exclude` | built | `0` | `0` | Finance | A-26 |
| `ppm_alerts_enabled` | built | `0` | `0` (dry run first) | Committee | A-27 |
| `ppm_alert_blocked_days` | built | `5` | `5` | Committee | A-27 |
| `ppm_alert_slip_days` | built | `10` | `10` | Committee | A-27 |
| `ppm_rebaseline_enabled` | built | `0` | `1` | Committee | A-27 |
| `ppm_baseline_versions` | built | `0` | `1` | Committee | A-27 |
| `roadmap_redirect_to_portfolio` | built | `0` | `0` during the pilot; `1` only after one clean parity cycle (`tools/governance/roadmap-parity.js`) | PMO + PO (deletion of roadmap data: CAB) | B-09 |

Not in this table because they are not top-level `report_config` keys:

- A-23 (built) — `paused_statuses` (default `[]`) and `dedup_mode` (default `once`) live **inside** the existing
  `teams_sla_rules` JSON; decided by the helpdesk lead.
- C-03 (built) — governance **policy** `governance.skip_inactive_holders` (Admin ▸ Governance policies, platform
  only, protected), not a `report_config` key: default `false` (today: a deactivated or site-less role holder or
  deputy still counts as coverage and still receives escalations); recommended pilot value `true`; decided by the
  owner (access policy).
- A-28 (built) — `.env` switches, not `report_config`; decided by the security owner, all default to today:
  `SDP_CSP_REPORT_ONLY` (unset = no report-only header, no `/api/security/csp-report`),
  `SDP_CONFIG_BOX_VERSION` (default `2`; `3` = new secrets sealed as `enc:v3`), `SDP_PDF_SANDBOX`
  (unset = PDF render keeps `--no-sandbox`).

When a goal lands, change its rows from `planned` to `built`; the test then holds the default to the code.
