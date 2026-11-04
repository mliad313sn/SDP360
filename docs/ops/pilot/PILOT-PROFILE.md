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
| `wan_timeup_loss_pct` | built | `100` | `5` (calibration of 2026-09-04) | Network owner | A-18 (pre-existing key; A-18 adds the uncalibrated banner) |
| `opm_rest_concurrency` | planned | `1` | `1` | Ops | A-18 |
| `ui_i18n_pages` | built | `0` | `1` | Owner (D-2) | A-09 |
| `ui_lang_default` | built | `` (empty) | `fr` | Owner (D-2) | A-09 |
| `ui_role_landing` | built | `0` | `1` | Owner (UI policy) | A-10 |
| `ui_nav_profile` | key only — no effect until A-21 | `full` | `lean` | Owner (D-6) | A-21 |
| `ui_deck_builder_roles` | key only — no effect until A-21 | `super_admin` | `super_admin` (widening also needs the page gate) | Owner (D-6) | A-21 |
| `site_score_published_model` | planned | `legacy` | `programme` | Owner (D-1) | A-11 |
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
| `asset_money_certify_display` | planned | `0` | `1` | Finance / IT management | A-16 |
| `asset_money_certify_min_sites` | planned | `3` | `3` | Finance | A-16 |
| `asset_money_certify_min_pct` | planned | `50` | `50` | Finance | A-16 |
| `helpdesk_sla_definition` | built | `flag` | `flag` until the committee chooses (`due_vs_resolved` is the alternative) | KPI committee | A-17 |
| `exec_payload_zero_policy` | built | `keep_server` | `keep_server` until the committee chooses (`browser_wins` is the alternative) | KPI committee | A-17 |
| `soft_delete_enabled` | planned | `0` | `1` | Owner (retention policy) | A-19 |
| `soft_delete_retention_days` | planned | `30` | `30` | Owner (retention policy) | A-19 |
| `soft_delete_purge_enabled` | planned | `0` | `0` (keep everything during the pilot) | Owner (retention policy) | A-19 |
| `meridian_enabled` | planned | `1` | `0` (retire) | Owner (D-5) | A-20 |
| `report_revert_policy` | planned | `site_editor` | `second_person` | Owner (D-3, reverses 2026-10-02) | A-24 |
| `report_reassign_submitted` | planned | `1` | `0` | Owner (D-3) | A-24 |
| `report_drift_banner` | planned | `0` | `1` | Owner (D-3) | A-24 |
| `wan_stale_close_at` | planned | `now` | `last_seen` | Network owner | A-25 |
| `wan_sla_require_contract_evidence` | planned | `0` | `1` once contracts are uploaded | Finance | A-25 |
| `asset_amount_parser` | planned | `legacy` | `locale` | Finance | A-26 |
| `asset_site_currency` | planned | `` (empty = every site XOF) | per-site JSON supplied by Finance | Finance | A-26 |
| `asset_currency_rates` | planned | `` (empty = XOF via `xof_usd_rate`, USD 1) | rates supplied by Finance | Finance | A-26 |
| `asset_cost_outlier_factor` | planned | `10` | `10` | Finance | A-26 |
| `asset_cost_outlier_exclude` | planned | `0` | `0` | Finance | A-26 |
| `ppm_alerts_enabled` | planned | `0` | `0` (dry run first) | Committee | A-27 |
| `ppm_alert_blocked_days` | planned | `5` | `5` | Committee | A-27 |
| `ppm_alert_slip_days` | planned | `10` | `10` | Committee | A-27 |
| `ppm_rebaseline_enabled` | planned | `0` | `1` | Committee | A-27 |
| `ppm_baseline_versions` | planned | `0` | `1` | Committee | A-27 |

Not in this table because they are not top-level `report_config` keys:

- A-23 — `paused_statuses` (default `[]`) and `dedup_mode` (default `once`) live **inside** the existing
  `teams_sla_rules` JSON; decided by the helpdesk lead.
- A-28 — `SDP_CONFIG_BOX_VERSION` (default `2`) and the CSP report-only header are `.env` / code
  switches, not `report_config`; decided by the security owner.

When a goal lands, change its rows from `planned` to `built`; the test then holds the default to the code.
