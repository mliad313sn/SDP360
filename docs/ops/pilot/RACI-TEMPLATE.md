# Ownership / RACI template — to be filled in by people (TEMPLATE, nothing decided)

**Generated** by `node tools/agent/raci-seed.js` from the code base — do not edit by hand; `--check` fails when
this file is out of date. Fill the copy kept by the product committee, not this file. **Every R / A / C / I,
data-steward and decision-SLA cell below is deliberately empty**: no name, no decision and no date is written by
the delivery team or an agent. R = responsible, A = accountable (one per row), C = consulted, I = informed.

Sources: the product domains (below), 14 connectors from `docs/sdp360/completion/CONNECTOR-REGISTER.csv`, and
**200 switches whose owner is "to be named"** in `docs/ops/FLAG-REGISTER.md`, grouped into 78 areas.

## 1. Product domains

| Domain | Scope | Data | R | A | C | I | Data steward | Decision SLA |
|---|---|---|---|---|---|---|---|---|
| `helpdesk-kpis` | Helpdesk KPIs (SLA, closure, first reply) | request_records · metric registry · docs/kpi/FORMULA-REFERENCE.md | | | | | | |
| `assets-finance` | Assets, finance and licences | assets · software · depreciation config | | | | | | |
| `meetings` | Meetings, PV and council escalations | md_meetings · md_issues · md_actions | | | | | | |
| `inspections` | IT inspections and corrective actions | insp_inspections · insp_actions | | | | | | |
| `field` | Field app (outbox, offline entries) | field_outbox · system_log field_* | | | | | | |
| `ppm` | Portfolio / PPM and benefits | portfolio tables · roadmap | | | | | | |
| `governance` | Governance: KPI committee, commitments, policies | kpi_policies · commitments · governance policies | | | | | | |
| `access` | Access: roles, grants, SSO, recertification | users · user_roles · access grants | | | | | | |
| `reporting` | Reports and scheduled deliveries | weekly_reports · report_sent_log · schedules | | | | | | |

## 2. Connectors (CONNECTOR-REGISTER)

| Id | Connector | Status | Owner role (register) | R | A | C | I | Data steward | Decision SLA |
|---|---|---|---|---|---|---|---|---|---|
| C01 | Zoho Analytics Plus (ManageEngine Analytics) + Zoho OAuth | ACTIVE | Platform owner | | | | | | |
| C02 | Zoho Survey | ACTIVE | Platform owner | | | | | | |
| C03 | ServiceDesk Plus Cloud REST v3 | ACTIVE (alerts armed OFF) | Service & Support Manager | | | | | | |
| C04 | Microsoft Teams Workflows webhooks | ACTIVE (armed OFF) | Service & Support Manager | | | | | | |
| C05 | SMTP (Office 365) | ACTIVE | Platform owner | | | | | | |
| C06 | Microsoft Entra ID SSO + Graph /me | ACTIVE (mode per config) | Information Security | | | | | | |
| C07 | Cisco Meraki Dashboard API | ACTIVE | Infrastructure owner | | | | | | |
| C08 | ManageEngine OpManager REST | ACTIVE (coverage unmeasured) | Infrastructure owner | | | | | | |
| C09 | Meridian (PMO) | DORMANT | Platform owner | | | | | | |
| C10 | 4MyPeople lookup | CONDITIONAL | Information Security + data owner | | | | | | |
| C11 | AI provider (Anthropic cloud or local OpenAI-compatible) | OFF by default | Information Security | | | | | | |
| C12 | External API / OData / signed views (Power BI, SharePoint consumers) | ACTIVE (per-consumer keys) | Platform owner | | | | | | |
| C13 | Defender, AD and Entra device exports | ACTIVE (manual) | Infrastructure owner | | | | | | |
| C14 | Microsoft Graph — Entra leaver check (users/{id} accountEnabled) | DORMANT (entra_deprovision_enabled 0; needs User.Read.All application consent — human gate 2) | Information Security | | | | | | |

## 3. Switches with no owner yet — 200, by area

| Area | Switches | Count | R | A | C | I | Data steward | Decision SLA |
|---|---|---|---|---|---|---|---|---|
| Environment variables · anthropic | `ANTHROPIC_API_KEY` | 1 | | | | | | |
| Environment variables · audit | `AUDIT_RISK_RETENTION_MONTHS` | 1 | | | | | | |
| Environment variables · bind | `BIND_HOST` | 1 | | | | | | |
| Environment variables · cors | `CORS_EXTRA_ORIGINS` | 1 | | | | | | |
| Environment variables · dash | `DASH_PASS` `DASH_USER` | 2 | | | | | | |
| Environment variables · dashboard | `DASHBOARD_API_KEY` | 1 | | | | | | |
| Environment variables · database | `DATABASE_URL` | 1 | | | | | | |
| Environment variables · debug | `DEBUG` | 1 | | | | | | |
| Environment variables · entra | `ENTRA_CLIENT_ID` `ENTRA_CLIENT_SECRET` `ENTRA_REDIRECT_URI` `ENTRA_TENANT_ID` | 4 | | | | | | |
| Environment variables · exec | `EXEC_PPTX_TIMEOUT_MS` | 1 | | | | | | |
| Environment variables · ext | `EXT_API_RATE_PER_MIN` | 1 | | | | | | |
| Environment variables · fmp | `FMP_API_KEY` `FMP_API_TIMEOUT_MS` `FMP_API_URL` `FMP_CACHE_MS` | 4 | | | | | | |
| Environment variables · local | `LOCAL_LLM_MODEL` `LOCAL_LLM_TIMEOUT` `LOCAL_LLM_URL` | 3 | | | | | | |
| Environment variables · manage | `MANAGE_CMD` `MANAGE_PS1` | 2 | | | | | | |
| Environment variables · node | `NODE_ENV` | 1 | | | | | | |
| Environment variables · org | `ORG_ID` | 1 | | | | | | |
| Environment variables · pg | `PG_POOL_MAX` `PG_URL` | 2 | | | | | | |
| Environment variables · pm2 | `PM2_NAME` | 1 | | | | | | |
| Environment variables · port | `PORT` | 1 | | | | | | |
| Environment variables · report | `REPORT_BROWSER` `REPORT_PDF_TIMEOUT_MS` `REPORT_SEND_TIMEOUT_MS` | 3 | | | | | | |
| Environment variables · require | `REQUIRE_CONFIG_KEY` `REQUIRE_POSTGRES` | 2 | | | | | | |
| Environment variables · sdp | `SDP_ALLOW_PLAINTEXT_SECRETS` `SDP_BACKUP_DIR` `SDP_BACKUP_KEY` `SDP_CONFIG_KEY` `SDP_DATA_DIR` `SDP_QUAL_CFG_TTL_MS` `SDP_SERVICE` `SDP_TEST_NO_RATE_LIMIT` | 8 | | | | | | |
| Environment variables · session | `SESSION_HOURS` | 1 | | | | | | |
| Environment variables · sso | `SSO_BREAKGLASS_USER` `SSO_ENABLED` `SSO_GROUP_MAP` `SSO_MODE` | 4 | | | | | | |
| Environment variables · sync | `SYNC_TRUNCATION_TOLERANCE_PCT` | 1 | | | | | | |
| Environment variables · workspace | `WORKSPACE_ID` | 1 | | | | | | |
| Environment variables · zoho | `ZOHO_CLIENT_ID` `ZOHO_CLIENT_SECRET` `ZOHO_REFRESH_TOKEN` `ZOHO_SURVEY_ANSWERS_VIEW_ID` `ZOHO_SURVEY_ID` `ZOHO_SURVEY_QUESTIONS_VIEW_ID` `ZOHO_SURVEY_VIEW_ID` | 7 | | | | | | |
| Governance policies · calendar | `calendar.skip_weekends` | 1 | | | | | | |
| Governance policies · commitments | `commitments.escalation_enabled` `commitments.exception_max_days` `commitments.serious_due_move_needs_admin` | 3 | | | | | | |
| Governance policies · freshness | `freshness.assets_hours` `freshness.changes_hours` `freshness.helpdesk_hours` `freshness.infra_hours` `freshness.survey_hours` `freshness.wan_hours` | 6 | | | | | | |
| Governance policies · governance | `governance.dual_approval_relaxations` `governance.dual_approval_tightening` `governance.quorum_min` `governance.relaxation_max_days` | 4 | | | | | | |
| Governance policies · handoffs | `handoffs.commitment_ledger` `handoffs.escalation_grace_days` `handoffs.overdue_escalation` `handoffs.proxy_accept` `handoffs.queue_receivers` `handoffs.reason_min` | 6 | | | | | | |
| Governance policies · meetings | `meetings.cancel_reason_min` `meetings.cancel_requires_approval` `meetings.compliance_as_of` `meetings.group_decisions_public` `meetings.minutes_four_eyes` `meetings.missed_grace_hours` `meetings.reopen_reason_min` `meetings.reopen_two_people` | 8 | | | | | | |
| Governance policies · publication | `publication.four_eyes` `publication.override_allowed` `publication.override_reason_min` | 3 | | | | | | |
| Governance policies · reports | `reports.four_eyes` `reports.freshness_gate` `reports.override_allowed` `reports.override_reason_min` `reports.withdraw_reason_min` | 5 | | | | | | |
| report_config keys · alert | `alert_external_enabled` | 1 | | | | | | |
| report_config keys · analytics | `analytics_accounts_url` `analytics_client_id` `analytics_client_secret` `analytics_org_id` `analytics_refresh_token` `analytics_workspace_id` | 6 | | | | | | |
| report_config keys · asset | `asset_depreciation_config` `asset_group_recipients` `asset_group_send_enabled` `asset_new_alert_enabled` `asset_reminder_send_enabled` `asset_replacement_uplift_pct` | 6 | | | | | | |
| report_config keys · backup | `backup_offsite_path` | 1 | | | | | | |
| report_config keys · commitment | `commitment_notify_enabled` | 1 | | | | | | |
| report_config keys · commitments | `commitments_enabled` | 1 | | | | | | |
| report_config keys · default | `default_email_domain` | 1 | | | | | | |
| report_config keys · embed | `embed_frame_ancestors` | 1 | | | | | | |
| report_config keys · engagement | `engagement_digest_hour` `engagement_teams_url` `engagement_webhook_url` | 3 | | | | | | |
| report_config keys · entra | `entra_client_id` `entra_client_secret` `entra_redirect_uri` `entra_tenant_id` | 4 | | | | | | |
| report_config keys · exec | `exec_view_lang` | 1 | | | | | | |
| report_config keys · field | `field_photo_max_kb` | 1 | | | | | | |
| report_config keys · formats | `formats` | 1 | | | | | | |
| report_config keys · from | `from` | 1 | | | | | | |
| report_config keys · group | `group_report_cc` `group_report_to` `group_report_to_confirmed` | 3 | | | | | | |
| report_config keys · handoff | `handoff_notify_enabled` | 1 | | | | | | |
| report_config keys · handoffs | `handoffs_enabled` | 1 | | | | | | |
| report_config keys · hygiene | `hygiene_recipients` `hygiene_send_enabled` | 2 | | | | | | |
| report_config keys · meraki | `meraki_api_key` `meraki_base_url` `meraki_missing_policy` `meraki_org_id` | 4 | | | | | | |
| report_config keys · meridian | `meridian_base_url` `meridian_in_key` `meridian_out_key` | 3 | | | | | | |
| report_config keys · never | `never_send_unconfirmed` | 1 | | | | | | |
| report_config keys · notifications | `notifications_stop` | 1 | | | | | | |
| report_config keys · opm | `opm_availability_view_id` `opm_monitor_patterns` `opm_stale_days` `opm_targets` | 4 | | | | | | |
| report_config keys · opmanager | `opmanager_api_key` `opmanager_base_url` `opmanager_ca_bundle` `opmanager_tls_insecure` | 4 | | | | | | |
| report_config keys · outbound | `outbound_allow_hosts` | 1 | | | | | | |
| report_config keys · ppm | `ppm_azdo_org_url` `ppm_azdo_pat` `ppm_azdo_project` `ppm_jira_api_token` `ppm_jira_base_url` `ppm_jira_user` `ppm_mpp_converter_cmd` | 7 | | | | | | |
| report_config keys · public | `public_base_url` | 1 | | | | | | |
| report_config keys · publish | `publish_cron_enabled` `publish_excel_recipients` `publish_metric_keys` `publish_webhook_url` | 4 | | | | | | |
| report_config keys · reconcile | `reconcile_recent_days` | 1 | | | | | | |
| report_config keys · reply | `reply_to` | 1 | | | | | | |
| report_config keys · scoreboard | `scoreboard_send_enabled` | 1 | | | | | | |
| report_config keys · sdp | `sdp_api_accounts_url` `sdp_api_base_url` `sdp_api_client_id` `sdp_api_client_secret` `sdp_api_open_filter` `sdp_api_refresh_token` `sdp_api_write_enabled` | 7 | | | | | | |
| report_config keys · sharepoint | `sharepoint_client_id` `sharepoint_client_secret` `sharepoint_list_id` `sharepoint_site_id` `sharepoint_tenant_id` | 5 | | | | | | |
| report_config keys · sla | `sla_wan_config` | 1 | | | | | | |
| report_config keys · smtp | `smtp_host` `smtp_pass` `smtp_port` `smtp_secure` `smtp_user` | 5 | | | | | | |
| report_config keys · sso | `sso_breakglass_user` `sso_group_map` `sso_mode` | 3 | | | | | | |
| report_config keys · sync | `sync_alert_enabled` `sync_alert_recipients` `sync_alert_teams_url` `sync_truncation_tolerance_pct` | 4 | | | | | | |
| report_config keys · teams | `teams_sla_channels` `teams_sla_enabled` `teams_sla_last_run` `teams_sla_rules` | 4 | | | | | | |
| report_config keys · tracker | `tracker_engine_cutover` | 1 | | | | | | |
| report_config keys · transport | `transport` | 1 | | | | | | |
| report_config keys · wan | `wan_mos_config` `wan_poll_first_run` `wan_poll_last_run` `wan_quality_thresholds` `wan_timeup_latency_ms` | 5 | | | | | | |
| report_config keys · weekly | `weekly_report_send_enabled` | 1 | | | | | | |
| report_config keys · xof | `xof_usd_rate` | 1 | | | | | | |

## 4. Monthly product committee — agenda skeleton

| # | Item | Input | Decision recorded where |
|---|---|---|---|
| 1 | Open ownership gaps (rows above with an empty A) | this template | committee minutes |
| 2 | Switch requests (default → pilot value) | `docs/ops/pilot/PILOT-PROFILE.md`, `docs/ops/FLAG-REGISTER.md` | committee minutes + Admin ▸ Config journal |
| 3 | KPI definitions and divergences | `docs/kpi/FORMULA-REFERENCE.md` §6 | KPI committee PV (`committee_ref`) |
| 4 | Value table and pilot measures | `node tools/pilot/pilot-metrics.js --value` | committee minutes |
| 5 | Release gates still empty | `docs/sdp360/completion/RELEASE-GATES.md` | the gate row (name, date, version) |
| 6 | Decisions past their decision SLA | the Decision SLA column above | committee minutes |
