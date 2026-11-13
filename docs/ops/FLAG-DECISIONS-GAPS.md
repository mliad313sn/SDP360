# Flag decisions — what is still missing before a dark switch can be turned on

**Generated** by `node tools/agent/flag-register.js` from `docs/ops/flag-decisions.json` (hand-maintained) — do not
edit this file; fill the sidecar instead. A dark switch = a behaviour that is OFF today (default `0`, a frozen lot,
or a nested arm whose default is false). Turning one on is a human decision: the fields below are what that decision
must name. The agent fills none of them (no owner, canary site, date or business threshold is ever invented).

Dark switches: **131** · with every decision field filled: **0** · fields: `owner`, `risk`, `dependencies`, `canary_site`, `rollback_trigger`, `success_metric`, `decision_deadline`, `expiry`.

| Switch | Source | Owner role (profile) | Missing decision fields |
|---|---|---|---|
| `a01_missing_due_date` | report_config | Commitments owner (D-04) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `access_grant_expiry_job` | report_config | Security owner | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `access_recert_apply` | report_config | Security owner | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `access_recert_enabled` | report_config | Security owner + site managers | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `access_require_approval` | report_config | Security owner + Owner (approver matrix) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `action_aging_reminders_enabled` | report_config | Service & Support Manager | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `actuals_import_enabled` | report_config | Finance controller + PMO | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `agenda_cron_enabled` | report_config | Committee | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ai_commentary_stale_block` | report_config | Owner (AI) + KPI committee | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `alert_external_enabled` | report_config | to be named | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `alert_group_by_rule` | report_config | Owner (alerting policy) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `asset_cost_outlier_exclude` | report_config | Finance | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `asset_group_send_enabled` | report_config | to be named | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `asset_money_certify_display` | report_config | Finance / IT management | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `asset_new_alert_enabled` | report_config | to be named | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `asset_reminder_send_enabled` | report_config | to be named | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `asset_replacement_uplift_pct` | report_config | to be named | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `auth_account_throttle_enabled` | report_config | Security owner | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `benefit_owner_link_enabled` | report_config | PMO | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `benefit_value_class_enabled` | report_config | Finance + executive sponsor | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `breakglass_timebox_enabled` | report_config | Security owner | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `chart_annotations_enabled` | report_config | Owner (UI policy) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `commitment_notify_enabled` | report_config | to be named | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `commitments_enabled` | report_config | to be named | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `connector_health_page_enabled` | report_config | Owner (UI policy) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `controls_register_enabled` | report_config | GRC owner + Security owner | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `dashboard_decision_kpis_seed` | report_config | KPI committee | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `dashboard_red_action_links` | report_config | Owner (UI policy) + PMO | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `decision_lifecycle_enforced` | report_config | Governance committee chair | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `decision_motive_required` | report_config | Governance committee chair | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `delivery_failure_alert_enabled` | report_config | Platform owner (D-13) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `department_rollup_enabled` | report_config | HR / department heads + Group IT | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `emergency_access_enabled` | report_config | Security owner + Owner | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `entra_deprovision_apply` | report_config | Information Security | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `entra_deprovision_enabled` | report_config | Information Security + tenant administrator | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `exec_deck_other_bucket` | report_config | Reporting owner (PO P4) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `exec_pack_portfolio_slide` | report_config | Committee | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `exec_view_min_cell` | report_config | Owner (reverses Exec View v1) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `export_policy_strict` | report_config | Data owner + Security | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `export_watermark_enabled` | report_config | Security | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `field_outbox_resolve_enabled` | report_config | PO + site IT | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `field_review_step` | report_config | PO / adoption lead | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `field_task_timing` | report_config | PO / adoption lead | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `finance_certification_enabled` | report_config | Finance controller (names the verifier) + Owner | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `finance_currency_required` | report_config | Finance controller | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `group_report_to_confirmed` | report_config | to be named | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `handoff_notify_enabled` | report_config | to be named | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `handoffs_enabled` | report_config | to be named | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `hygiene_send_enabled` | report_config | to be named | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `incubation_rfi_link_enabled` | report_config | PMO + Owner | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `insp_action_verify_enabled` | report_config | Infrastructure / inspection owner + GRC | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `insp_repeat_findings` | report_config | Infrastructure / inspection owner | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `kpi_policy_enforced` | report_config | KPI committee + Owner | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `login_limit_failures_only` | report_config | Security owner | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `metric_explain_enabled` | report_config | KPI committee | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `metric_programme_readers` | report_config | KPI committee + model author | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `mywork_awaiting_me_enabled` | report_config | Product owner | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `notifications_stop` | report_config | to be named | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `obligations_include_decisions` | report_config | Committee + Owner | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `opmanager_tls_insecure` | report_config | to be named | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `pir_reviews_enabled` | report_config | Incident manager + business sponsor | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `portfolio_editor_plan_writes` | report_config | Owner (access policy) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `portfolio_executive_readonly` | report_config | Owner + IAM | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `portfolio_my_projects_default` | report_config | PMO | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `portfolio_sensitive_projects` | report_config | Owner (access policy) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `portfolio_site_scope_reads` | report_config | Owner (access policy) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `portfolio_views_enabled` | report_config | PMO | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ppm_alerts_enabled` | report_config | Committee | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ppm_annual_pack_enabled` | report_config | CIO + PMO + Finance | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ppm_baseline_versions` | report_config | Committee | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ppm_budget_periods_enabled` | report_config | Finance + PMO | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ppm_capacity_view` | report_config | PMO + capacity owner (to be named) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ppm_change_requests_enabled` | report_config | PMO | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ppm_cr_simulation_enabled` | report_config | PMO | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ppm_evm_enabled` | report_config | PMO + Finance | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ppm_gantt_v2_enabled` | report_config | PMO | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ppm_project_team_enabled` | report_config | PMO | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ppm_raci_enabled` | report_config | PMO | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ppm_rebaseline_enabled` | report_config | Committee | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ppm_schedule_engine_v2_ui` | report_config | PMO | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ppm_templates_enabled` | report_config | PMO (template validation is a human act) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ppm_time_entries_enabled` | report_config | PMO + PO | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ppm_timesheet_approval_enabled` | report_config | PMO | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `problem_candidates_enabled` | report_config | Problem owner + Owner | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `publish_cron_enabled` | report_config | to be named | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `qualification_check_enabled` | report_config | HSE owner + Security owner | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `report_drift_banner` | report_config | Owner (D-3) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `restore_drill_full` | report_config | Operations owner | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `roadmap_audience_publication_enabled` | report_config | PMO (publication owner) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `roadmap_publication_enabled` | report_config | Service & Support Manager | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `roadmap_redirect_to_portfolio` | report_config | PMO + PO (deletion of roadmap data: CAB) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `schedule_reminders_enabled` | report_config | Site coordination owner | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `scoreboard_send_enabled` | report_config | to be named | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `sdp_api_write_enabled` | report_config | to be named | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `shift_handover_enabled` | report_config | Site IT lead + Owner | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `site_code_shared_block` | report_config | Data owner + Owner | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `site_codes_from_registry` | report_config | Data owner + KPI committee | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `site_local_calendar` | report_config | Owner + Finance (month-end figures) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `sla_headline_definition` | report_config | KPI committee | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `smtp_secure` | report_config | to be named | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `soft_delete_enabled` | report_config | Owner (retention policy) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `soft_delete_purge_enabled` | report_config | Owner (retention policy) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `soft_delete_two_person` | report_config | Owner (retention policy) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `sync_drift_alerts` | report_config | Ops + data owner per flow | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `teams_sla_enabled` | report_config | to be named | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `tracker_engine_cutover` | report_config | to be named | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ui_data_quality_page` | report_config | Data owner | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ui_exec_charts_v2` | report_config | Executive sponsor + data / BI owner | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ui_feedback_enabled` | report_config | PO | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ui_home_blocks` | report_config | Owner (UI policy) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ui_home_queue` | report_config | Owner (UI policy) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ui_i18n_pages` | report_config | Owner (D-2) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ui_kpi_base_line` | report_config | Owner (UI policy) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ui_kpi_definition_drawer` | report_config | KPI committee | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ui_kpi_sample_size` | report_config | KPI committee | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ui_nav_active_from_url` | report_config | Owner (UI policy) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ui_nav_carry_site` | report_config | Owner (UI policy) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ui_role_landing` | report_config | Owner (UI policy) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ui_small_multiples` | report_config | Owner (UI policy) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ui_url_filters` | report_config | Owner (UI policy) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `ux_event_telemetry` | report_config | Data protection officer + Owner (UI policy) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `value_scoreboard_enabled` | report_config | Owner (UI policy) + KPI committee | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `wan_sla_claims_enabled` | report_config | Finance + Network owner | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `wan_sla_require_contract_evidence` | report_config | Finance | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `weekly_report_nudges_enabled` | report_config | Service & Support Manager | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `weekly_report_send_enabled` | report_config | to be named | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `workspace_profiles_enabled` | report_config | PO | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `frozen:tracker_green_band_90` | frozen_lot | Owner (deployment) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `frozen:tracker_weighted_donut` | frozen_lot | Owner (deployment) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `frozen:installer_safety_parity` | frozen_lot | Owner (deployment) | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
| `sla_wan_config.notify.enabled` | nested_arm | Network owner | owner, risk, dependencies, canary_site, rollback_trigger, success_metric, decision_deadline, expiry |
