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

## 1. report_config keys (234) — services/reportConfig.js DEFAULTS

Prerequisites (E-A07, services/switchPrereqs.js) are WARNINGS in plain words, never approvals: the config PUT
answer and the `set-ui-policy.js` dry run repeat them when the switch is moved to its switched-on value.

| Key | Default (today) | Kind | Owner | Recommended pilot value | Reference | Prerequisites |
|---|---|---|---|---|---|---|
| `a01_missing_due_date` | `0` | setting | Commitments owner (D-04) | `1` (proposal — a serious commitment without a due date or approved exception is then escalated as A01, like a missing owner) | E-R02 | — |
| `a10_gate_lead_days` | `` | setting | Committee | a number of days, e.g. `10` (proposal — the armed ppm-alerts job then reminds the project owner and committee before the next stage gate; empty = off) | E-R02 | — |
| `access_approver_policy` | `{"platform_roles":["admin","executive","super_admin","tra…` | setting | Security owner + Owner | the default (PO decision R7, encoded 2026-11-05): platform roles by a super_admin, other roles by an admin-tier user holding the site; never the requester, subject or their deputy | C-19 | — |
| `access_grant_expiry_job` | `0` | setting | Security owner | `1` (ends expired grants nightly; a role held before the grant or by another live grant stays) | C-18 | — |
| `access_recert_apply` | `0` | setting | Security owner | PROPOSITION: `0` for the first campaign (revoke answers recorded only, reviewed by the Security owner); `1` only after that review | E-S03 | — |
| `access_recert_enabled` | `0` | arm switch | Security owner + site managers | PROPOSITION: `1` once the Security owner schedules the first campaign (site managers answer their lines; the subject never answers their own) | E-S03 | — |
| `access_recert_orphan_days` | `90` | setting | Security owner | PROPOSITION: N to be chosen by the Security owner (an account with no sign-in evidence is listed as UNKNOWN, never as idle) | E-S03 | — |
| `access_require_approval` | `0` | setting | Security owner + Owner (approver matrix) | `1` once the approver rule and the requires_request list are decided (break-glass stays possible, logged risk=1) | C-18 | — |
| `agenda_cron_enabled` | `0` | arm switch | Committee | `1` (the Monday job prepares a DRAFT agenda per cadence due that week; nothing is sent, the secretary still prepares the session) | E-G03 | — |
| `ai_commentary_stale_block` | `0` | setting | Owner (AI) + KPI committee | `1` once an AI provider is switched on (today `AI_PROVIDER=off`, so the switch changes nothing) — a report run whose sources are stale or never synced keeps its deterministic text with the reason, instead of an AI commentary written on old data; the deck builder's `/api/ai/analyze` also returns `verification` (offending numbers) when the page sends `facts` (metadata, no switch) | E-B08 | Sync freshness thresholds reviewed, so a "stale" verdict means what the readers expect. |
| `alert_external_enabled` | `0` | arm switch | to be named | — | — | A reviewed list of senders and recipients, a dry run, habilitations, and the stop switch (notifications_stop) tested. |
| `alert_group_by_rule` | `0` | setting | Owner (alerting policy) | `1` (proposal — the e-mail digest shows one line per alert rule listing its sites instead of one line per site) | E-R07 | — |
| `alert_quiet_hours` | `` | setting | Owner (alerting policy) | e.g. `22:00-06:00` UTC (proposal — non-critical in-app firings wait until the window ends; critical ones are never deferred) | E-R07 | — |
| `analytics_accounts_url` | `` | setting | to be named | — | — | — |
| `analytics_client_id` | `` | setting | to be named | — | — | — |
| `analytics_client_secret` | (secret — not shown) | secret | to be named | — | — | — |
| `analytics_org_id` | `` | setting | to be named | — | — | — |
| `analytics_refresh_token` | (secret — not shown) | secret | to be named | — | — | — |
| `analytics_workspace_id` | `` | setting | to be named | — | — | — |
| `asset_amount_parser` | `legacy` | setting | Finance | `locale` | A-26 | — |
| `asset_cost_outlier_exclude` | `0` | setting | Finance | `0` | A-26 | — |
| `asset_cost_outlier_factor` | `10` | setting | Finance | `10` | A-26 | — |
| `asset_currency_rates` | `` | setting | Finance | rates supplied by Finance | A-26 | — |
| `asset_depreciation_config` | `{"default":{"method":"straight_line","useful_life_months"…` | setting | to be named | — | — | — |
| `asset_group_recipients` | `` | setting | to be named | — | — | — |
| `asset_group_send_enabled` | `0` | arm switch | to be named | — | — | — |
| `asset_money_certify_display` | `0` | setting | Finance / IT management | `1` | A-16 | — |
| `asset_money_certify_min_pct` | `50` | setting | Finance | `50` | A-16 | — |
| `asset_money_certify_min_sites` | `3` | setting | Finance | `3` | A-16 | — |
| `asset_new_alert_enabled` | `0` | arm switch | to be named | — | — | — |
| `asset_reminder_send_enabled` | `0` | arm switch | to be named | — | — | — |
| `asset_replacement_uplift_pct` | `0` | setting | to be named | — | — | — |
| `asset_site_currency` | `` | setting | Finance | per-site JSON supplied by Finance | A-26 | — |
| `auth_account_throttle_enabled` | `0` | arm switch | Security owner | `1` (per-account failed sign-in cap on top of the per-IP limiter; note a deliberate lock-out of a named account is possible for its window) | SEC-01 | — |
| `auth_account_throttle_max` | `10` | setting | Security owner | `10` failed sign-ins per account per window | SEC-01 | — |
| `auth_account_throttle_window_min` | `15` | setting | Security owner | `15` minutes | SEC-01 | — |
| `auth_pbkdf2_iterations` | `100000` | setting | Security owner | PROPOSITION: `100000` (today, nothing rehashed) until a crypto review names the target (e.g. 210000, OWASP 2023 for PBKDF2-SHA512); a higher value rehashes each user once at their next successful password sign-in and costs that much more CPU per sign-in (see docs/agent-execution/E-W2-RDB.md for the measured time) | E-S05 | — |
| `authz_capability_mode` | `off` | setting | Security owner | `shadow` (log divergences only; `enforce` acts only on `authz_enforce_caps` — route-by-route plan in `docs/agent-execution/C-17.md`) | C-17 | Enforce is wired only for the capabilities in authz_enforce_caps: resolve every shadow divergence (tools/security/authz-divergence-report.js) and add negative API tests first. |
| `authz_enforce_caps` | `` | setting | Security owner | PROPOSITION: empty during the pilot; after two shadow weeks without unexplained divergences (`tools/security/authz-divergence-report.js`), low-risk reads first (`review.read`, `analytics.data.read`, `tracker.read`) with mode `enforce`; a listed capability can only refuse, critical ones are ignored while C-18 grants are off | E-S01 | — |
| `backup_offsite_path` | `` | setting | to be named | — | — | — |
| `benefit_money_verifier_role` | `` | setting | Finance controller | a role name such as `finance-viewer` once the Finance owner adopts the rule (a money benefit is then verified only by a holder of that role who is neither the person who entered the value nor the linked owner — refusal `VERIFIER_ROLE`; the role required is stamped on the verification; no role is granted by this key, and a name nobody holds blocks every money verification) | F-PRODUCT-04 | — |
| `benefit_owner_link_enabled` | `0` | arm switch | PMO | `1` once the PMO wants benefit owners named as users (the free-text owner stays; "My work" then lists the person's benefits whose review date is reached — in-app only, nothing is e-mailed). The linked owner can never verify their own benefit | E-P05 | — |
| `benefit_value_class_enabled` | `0` | arm switch | Finance + executive sponsor | `1` once Finance and the sponsor agree the classes used at a benefits review (value class, observed / estimated basis, baseline and measurement periods, method note, source; the project page then separates observed, estimated and validated values and totals them per class and currency / unit, never across). No class is set by default; "validated" is only derived from a verification by the holder of the required role (`benefit_money_verifier_role`) | F-PRODUCT-03 / F-DATA-09 | — |
| `chart_annotations_enabled` | `0` | arm switch | Owner (UI policy) | `1` (proposal — after a browser review; notes are human-entered with a mandatory source) | E-V08 | — |
| `commitment_notify_enabled` | `0` | arm switch | to be named | — | — | — |
| `commitments_enabled` | `0` | arm switch | to be named | — | — | — |
| `controls_register_enabled` | `0` | arm switch | GRC owner + Security owner | `1` once GRC names who adopts controls (the four seeded controls stay `candidate` until a person adopts them with a reason; frequencies and testers are GRC decisions) | E-G04 | — |
| `csp_strict_pages` | `` | setting | Security owner | keep empty until a page is listed as enforceable in `docs/security/CSP-JOURNEYS.md` (no inline script, no inline handler) AND a report-only run (`SDP_CSP_REPORT_ONLY=1`) shows no violation for it; then add it here, one journey at a time, e.g. `/access.html` — a comma list of pages served with the nonce-only `script-src` (applies within 30 s, no restart; emptying it returns to today). It can only make a page stricter: no script origin is ever added — PROPOSITION, no page approved | F-ARCH-06 | — |
| `dashboard_decision_kpis_seed` | `0` | setting | KPI committee | `0` until the KPI committee has chosen its two decision KPIs (`1` only creates an unpublished draft of the two candidates) | F-DATA-11 | — |
| `dashboard_red_action_links` | `0` | setting | Owner (UI policy) + PMO | `1` (proposal — only with `commitments_enabled=1`; no action is ever created automatically) | E-K03 | — |
| `dashkey_allowed_routes` | `` | setting | Integration owner + Security owner | the routes the named consumers really call (from the consumer report), e.g. `GET /api/ping, GET /api/data/*` — PROPOSITION, no list approved | E-S02 | — |
| `dashkey_scope_mode` | `open` | setting | Integration owner + Security owner | `shadow` first (an unlisted key-only route still answers and logs `dashkey_scope_would_refuse`); `restrict` (401) only after every consumer in `tools/security/dashkey-consumers.js` is named and listed. A browser request is never affected | E-S02 | Every key-only consumer named and listed in dashkey_allowed_routes (tools/security/dashkey-consumers.js), after a shadow period. |
| `decision_lifecycle_enforced` | `0` | setting | Governance committee chair | `1` once the governance committee chair accepts the rule (PROPOSED: a site moves a decision `open` ↔ `in_progress` and proposes completion — its `done` is stored as `awaiting_confirmation` until the committee confirms; cancelling and reopening are committee acts with a reason; an illegal jump is refused, 409). The status history with actor and reason is recorded at `0` too | F-PRODUCT-06 | — |
| `default_email_domain` | `edv-ops.com` | setting | to be named | — | — | — |
| `delivery_failure_alert_enabled` | `0` | arm switch | Platform owner (D-13) | `1` once `sync_alert_recipients` (or the Teams URL) names who receives sync alerts (D-13) — the failed deliveries are already listed on System Logs either way | E-R04 | — |
| `department_rollup_enabled` | `0` | arm switch | HR / department heads + Group IT | `1` only after HR / the department heads and Group IT have reviewed the crosswalk (`node tools/governance/department-crosswalk.js --check`; five exact pairs are PROPOSED, every other value is left alone — Process, Mill / Plant and Processing are not merged). At `1` the committee reads counts per crosswalked department (`GET /api/governance/department-rollup`); a value without a pair stays "unmapped". No stored label is renamed and no user gets a department | F-PRODUCT-05 | — |
| `embed_frame_ancestors` | `` | setting | to be named | — | — | — |
| `emergency_access_enabled` | `0` | arm switch | Security owner + Owner | `1` once the super_admins who may grant and review are named (a super_admin, never the beneficiary, max 24 h, review within 2 working days by another super_admin — PO decision R7; never waives a qualification) | C-22 | — |
| `emergency_access_max_hours` | `24` | setting | Security owner | `24` (hard cap; may only be lowered) | C-22 | — |
| `engagement_digest_hour` | `7` | setting | to be named | — | — | — |
| `engagement_teams_url` | (secret — not shown) | secret | to be named | — | — | — |
| `engagement_webhook_url` | (secret — not shown) | secret | to be named | — | — | — |
| `entra_client_id` | `` | setting | to be named | — | — | — |
| `entra_client_secret` | (secret — not shown) | secret | to be named | — | — | — |
| `entra_deprovision_apply` | `0` | setting | Information Security | PROPOSITION: `0` until a dry run has been reviewed and the revocation delay measured on TEST; then `1` | E-S04 | — |
| `entra_deprovision_enabled` | `0` | arm switch | Information Security + tenant administrator | PROPOSITION: `1` (dry run) only after the tenant administrator decides on the Graph `User.Read.All` application consent (gate 2); read the dry-run list on TEST first | E-S04 | — |
| `entra_redirect_uri` | `` | setting | to be named | — | — | — |
| `entra_tenant_id` | `` | setting | to be named | — | — | — |
| `exec_deck_other_bucket` | `0` | setting | Reporting owner (PO P4) | `1` (PO decision P4: "Other (n)" on every top-N deck chart, Normal changes as their own slice) | C-16 | — |
| `exec_payload_zero_policy` | `keep_server` | setting | KPI committee | `keep_server` until the committee chooses (`browser_wins` is the alternative) | A-17 | — |
| `exec_view_change_formula` | `status` | setting | KPI committee (D-01) | `deck` | A-08 | — |
| `exec_view_lang` | `en` | setting | to be named | — | — | — |
| `exec_view_mi_detail` | `full` | setting | Owner (reverses the 2026-07-02 "option a") | `summarized_only` | A-08 | — |
| `field_outbox_resolve_enabled` | `0` | arm switch | PO + site IT | `0` until the real-device sessions (E-F04, audit F-01) show how often field entries get stuck — otherwise an admin repair becomes the normal path (X-§7-01); then `1` (admin tier may `mark_rejected` or `release` a stuck entry; a ticket / action is released only after checking SDP, with a reason; every resolution is a risk row in System Logs; nothing is applied server-side). The read-only list `GET /api/field/admin/outbox` has no switch | E-F01 | Real-device field sessions (E-F04) must first show how often entries get stuck. |
| `field_photo_max_kb` | `300` | setting | to be named | — | — | — |
| `field_review_step` | `0` | setting | PO / adoption lead | `1` on the pilot site after one session shows it does not slow the technician (a one-screen summary — site, items, findings, photos, offline note — before an inspection is queued; « Corriger » queues nothing) | E-F03 | — |
| `field_task_timing` | `0` | setting | PO / adoption lead | `1` for the pilot window to take a BASELINE (active time form open → queued, pauses > 2 min excluded, user id + role tier only; median / p75 per site × kind × week in `tools/pilot/pilot-metrics.js`). No target is set — targets come only after the baseline (PILOT-MEASUREMENT.md) | E-F03 | — |
| `finance_currency_required` | `0` | setting | Finance controller | `1` once Finance requires a stated currency on every amount (a project budget / spent or a money benefit written without a currency is then refused, `CURRENCY_REQUIRED`). At `0` the write is accepted but flagged: "default, not confirmed" on the portfolio and project pages, `currency_defaulted=true` in the ledger note, a warning in the answer. Rules per money path: `docs/ops/FINANCE-CURRENCY-RULES.md` | F-DATA-10 | — |
| `formats` | `html,pdf` | setting | to be named | — | — | — |
| `from` | `` | setting | to be named | — | — | — |
| `group_report_cc` | `` | setting | to be named | — | — | — |
| `group_report_to` | `` | setting | to be named | — | — | — |
| `group_report_to_confirmed` | `0` | setting | to be named | — | — | — |
| `handoff_notify_enabled` | `0` | arm switch | to be named | — | — | A reviewed recipient list and one dry run before any notification leaves the server. |
| `handoffs_enabled` | `0` | arm switch | to be named | — | — | — |
| `helpdesk_sla_definition` | `flag` | setting | KPI committee | `flag` until the committee chooses (`due_vs_resolved` is the alternative) | A-17 | — |
| `hygiene_recipients` | `` | setting | to be named | — | — | — |
| `hygiene_send_enabled` | `0` | arm switch | to be named | — | — | — |
| `incubation_rfi_link_enabled` | `0` | arm switch | PMO + Owner | `1` on the pilot site once the PMO accepts incubation-born RFIs in the queue (the RFI score stays provisional: incubation scoring criteria are a human decision) | E-I04 | — |
| `insp_action_verify_enabled` | `0` | arm switch | Infrastructure / inspection owner + GRC | `1` once the inspection owner confirms that Critical and High corrective actions need an independent check (a closed one reads "awaiting verification" until a person who did not close it verifies it) | E-I06 | — |
| `insp_repeat_findings` | `0` | setting | Infrastructure / inspection owner | `1` once the inspection owner sets the window below (the inspections dashboard then lists items rated minor / major / critical in at least 2 of a site's last N submitted inspections) | E-I06 | — |
| `insp_repeat_window` | `` | setting | Infrastructure / inspection owner | PROPOSITION: none — N (how many of a site's last submitted inspections are compared) is a human decision; empty = nothing computed | E-I06 | — |
| `kpi_policy_enforced` | `0` | setting | KPI committee + Owner | `0` until the KPI committee has ADOPTED a resolution-SLA policy on `/kpi-builder.html` (two different members: author ≠ adopter, with the session reference) and read the shadow comparison; then `1` (the Helpdesk tile, ranking and trend follow the adopted version) | C-31 | An ADOPTED kpi_policy (committee decision), a read shadow comparison and a check of every surface (screen, API, PPTX, e-mail); keep history and rollback. |
| `login_limit_failures_only` | `0` | setting | Security owner | PROPOSITION: `1` once the Security owner accepts it (only FAILED sign-ins count per address + login name, 10 / 15 min, a success clears that pair; 50 failures / 15 min per address; the per-account failure throttle is forced on) — fixes the lock-out of a site seen behind one address | UAT-OI-02 | — |
| `meraki_api_key` | (secret — not shown) | secret | to be named | — | — | — |
| `meraki_base_url` | `https://api.meraki.com/api/v1` | setting | to be named | — | — | — |
| `meraki_missing_policy` | `down` | setting | to be named | — | — | — |
| `meraki_org_id` | `` | setting | to be named | — | — | — |
| `meridian_base_url` | `` | setting | to be named | — | — | — |
| `meridian_enabled` | `1` | arm switch | Owner (D-5) | `0` (retire) | A-20 | — |
| `meridian_in_key` | (secret — not shown) | secret | to be named | — | — | — |
| `meridian_out_key` | (secret — not shown) | secret | to be named | — | — | — |
| `metric_explain_enabled` | `0` | arm switch | KPI committee | `1` (proposal — read-only; counts by site, ratios as numerator / denominator; the note never asserts a cause) | E-K04 | — |
| `metric_programme_readers` | `0` | setting | KPI committee + model author | `0` until the KPI committee and the model author decide (`1` computes `programme.site_score` / `programme.composite` on dashboards, agendas, `/api/metrics`, `/ext/v1` — not certified, D-01..D-03) | F-DATA-03 | — |
| `mywork_awaiting_me_enabled` | `0` | arm switch | Product owner | `1` on the pilot once the product owner has compared it with the review.1 validation queue (one queue, not two). Home ▸ My work then shows "Awaiting me": commitments I review (named reviewer or role holder, never my own work), handoffs waiting for my acceptance, benefits I may verify (never the one I entered or own), decisions I own due within 7 days, PVs I am named to sign. Only items the person can already open; a source that cannot be read shows "not measured"; nothing is e-mailed | F-PRODUCT-07 | — |
| `never_send_unconfirmed` | `1` | setting | to be named | — | — | — |
| `notifications_stop` | `0` | setting | to be named | — | — | — |
| `obligations_include_decisions` | `0` | setting | Committee + Owner | `1` (the site obligations view then counts the site's open governance decisions; the visible total of a site can grow) | E-G02 | — |
| `opm_availability_view_id` | `` | setting | to be named | — | — | — |
| `opm_monitor_patterns` | `opma,abj-spm-000` | setting | to be named | — | — | — |
| `opm_rest_concurrency` | `1` | setting | Ops | `1` | A-18 (A-18b) | — |
| `opm_stale_days` | `9` | setting | to be named | — | — | — |
| `opm_targets` | `{"lan":99,"wifi":98,"wan":98,"servers":99}` | setting | to be named | — | — | — |
| `opmanager_api_key` | (secret — not shown) | secret | to be named | — | — | — |
| `opmanager_base_url` | `` | setting | to be named | — | — | — |
| `opmanager_ca_bundle` | (secret — not shown) | secret | to be named | — | — | — |
| `opmanager_tls_insecure` | `0` | setting | to be named | — | — | — |
| `outbound_allow_hosts` | `` | setting | to be named | — | — | — |
| `pir_reviews_enabled` | `0` | arm switch | Incident manager + business sponsor | `1` once the Incident manager names who signs a post-incident review and the business sponsor per major incident (the sign-off is a recorded human act by someone other than the author; nothing is sent) | E-I03 | — |
| `portfolio_editor_plan_writes` | `0` | setting | Owner (access policy) | `1` | A-15 | — |
| `portfolio_site_scope_reads` | `0` | setting | Owner (access policy) | `1` | A-15 | — |
| `portfolio_views_enabled` | `0` | arm switch | PMO | `1` once the PMO wants the portfolio read as a list or a board as well as the timeline (view switch Timeline · List · Board kept in the address `?view=`; List = the table view promoted out of its fold; Board = one read-only column per stage — a card opens the project page, a stage still moves only through its gate). Nothing is written by these views | R2-WB-05 | — |
| `ppm_alert_blocked_days` | `5` | setting | Committee | `5` | A-27 | — |
| `ppm_alert_slip_days` | `10` | setting | Committee | `10` | A-27 | — |
| `ppm_alerts_enabled` | `0` | arm switch | Committee | `0` (dry run first) | A-27 | — |
| `ppm_alloc_unspecified` | `full_time` | setting | PMO | `unknown` if the PMO decides that a task created without an allocation is "not known" rather than full time (a NEW task then stores NULL — shown "unknown", never summed; existing rows are never changed; `node tools/governance/alloc-audit.js` lists legacy values outside 0–100 and says whether the range CHECK of migration 080 is present) | F-PRODUCT-09 | — |
| `ppm_annual_pack_enabled` | `0` | arm switch | CIO + PMO + Finance | `1` before the annual planning committee (the XLSX pack is a DRAFT on every sheet: projects of the year, per-currency budget roll-up under the money rule, capacity summary, provisional RFI scores; the envelope column stays UNKNOWN until Finance enters it — envelopes and arbitration are human decisions) | E-P08 | — |
| `ppm_baseline_versions` | `0` | setting | Committee | `1` | A-27 | — |
| `ppm_budget_periods_enabled` | `0` | arm switch | Finance + PMO | `1` once Finance agrees the period grid (month × currency × baseline / actual / forecast, EAC = actual to date + remaining forecast per currency, never across currencies; a change or a variance vs the baseline needs a justification and is hash-chained in `ppm_events`). Every view says "not certified" until Finance certifies the figures; who may approve a budget stays a Finance decision. While on, the portfolio workbook (`/portfolio/workbook.xlsx`) also carries a "Budget periods" sheet for a money reader (one row per project × month × currency × kind, no cross-currency total — R2-WB-03); the deck does not | E-P04 | — |
| `ppm_capacity_view` | `0` | setting | PMO + capacity owner (to be named) | `1` once the PMO accepts the team-load reading (capacity per site × week, conflicts sorted by excess then duration, suggestions are proposals only; a task reassignment then needs a reason — it is traced in `ppm_events` at `0` too). What "availability" means for a team stays undefined until a capacity owner signs `docs/ops/CAPACITY-DATA-CONTRACT.md` | E-P03 | — |
| `ppm_change_requests_enabled` | `0` | arm switch | PMO | `1` once the PMO adopts a change-control step on projects (Changes tab: title, reason, dates impact in days, money impact with its currency — visible to money readers only; proposed → assessed → approved / rejected by the committee, never by the author → applied; applying a dates impact re-baselines through the committee re-baseline, so `ppm_rebaseline_enabled` must be on; every step is a `ppm_events` row; the workbook gains a "Changes" sheet). Who sits on the change board is a PMO decision | R2-WB-01 | — |
| `ppm_project_team_enabled` | `0` | arm switch | PMO | `1` once the PMO wants a named team per project (Team panel on the project Overview: member name, role, optional link to a user account, allocation to the project, optional window; the task owner field then offers the members — free text still accepted, no existing owner is migrated). A task whose allocation is UNKNOWN then reads its owner's member allocation in the conflicts and the capacity view; a known allocation is never overridden. Every change is a `ppm_events` row | R2-WB-04 | — |
| `ppm_raci_enabled` | `0` | arm switch | PMO | `1` when the PMO wants responsibilities per task on the project page (R / A / C / I per person, exactly one A per task — a matrix without it is refused; CSV export; every change is a `ppm_events` row) | E-P06 | — |
| `ppm_rebaseline_enabled` | `0` | arm switch | Committee | `1` | A-27 | — |
| `ppm_templates_enabled` | `0` | arm switch | PMO (template validation is a human act) | `1` once the PMO names who validates templates (a template is the STRUCTURE only — task names, WBS, durations, milestone names; no people, dates or money; `draft` until another committee member approves it; only an approved template creates a project) | E-P06 | — |
| `ppm_time_entries_enabled` | `0` | arm switch | PMO + PO | `1` once the PMO wants actual hours per task (Plan tab: time entries — person, day, hours 0..24, note — and planned effort vs actual hours vs variance; a task without any entry reads "—" (unknown), never 0; the workbook Tasks sheet gains `actual_hours`). Recording is the plan-write rule; whether a person may record their OWN time on a project they only read is a PO decision (not built). Every entry is a `ppm_events` row | R2-WB-02 | — |
| `problem_candidate_min` | `` | setting | Problem owner + KPI committee | PROPOSITION: none — the recurrence threshold (incidents of one category × sub-category on a site in the window) is a human decision; empty = no candidate is computed | E-I02 | — |
| `problem_candidates_enabled` | `0` | arm switch | Problem owner + Owner | `1` on the pilot site once a problem owner is named (candidates are listed with "causality not validated"; promoting one creates a commitment whose owner a person chooses; ServiceDesk Plus Problem records are not synced) | E-I02 | — |
| `public_base_url` | `` | setting | to be named | — | — | — |
| `publish_cron_enabled` | `0` | arm switch | to be named | — | — | — |
| `publish_excel_recipients` | `` | setting | to be named | — | — | — |
| `publish_metric_keys` | `helpdesk.resolution_sla_pct,helpdesk.first_reply_sla_pct,…` | setting | to be named | — | — | — |
| `publish_webhook_url` | (secret — not shown) | secret | to be named | — | — | — |
| `qualification_check_enabled` | `0` | arm switch | HSE owner + Security owner | `0` until each site's HSE owner has recorded and verified the evidence; then `1` per requirement (evidence only — SDP360 never grants a physical authorisation) | C-19 | — |
| `qualification_requirements` | `{}` | setting | HSE owner | `{}` — which capability needs which kind (e.g. `field.capture` → `site-induction`) is a human decision | C-19 | — |
| `reconcile_recent_days` | `30` | setting | to be named | — | — | — |
| `reply_to` | `` | setting | to be named | — | — | — |
| `report_drift_banner` | `0` | setting | Owner (D-3) | `1` | A-24 | — |
| `report_reassign_submitted` | `1` | setting | Owner (D-3) | `0` | A-24 | — |
| `report_revert_policy` | `site_editor` | setting | Owner (D-3, reverses 2026-10-02) | `second_person` | A-24 | — |
| `restore_drill_full` | `0` | setting | Operations owner | `1` on the TEST instance once a backup copy of `data/blobs` exists (`SDP_BLOB_BACKUP_DIR`) and both keys are set — proposal | F-ARCH-05 | — |
| `restore_rto_minutes` | `` | setting | Operations owner (RTO/RPO) | the recovery-time target in minutes — **not proposed here**: empty reads UNKNOWN, never "met" | F-ARCH-05 | — |
| `roadmap_publication_enabled` | `0` | arm switch | Service & Support Manager | `1` once the Service & Support Manager wants to publish the Roadmap Manager into the portfolio from the page (dry run → duplicates listed and refused unless explicitly left out → apply → parity shown → a separate, explicit archive gesture turns Roadmap Manager read-only). Rollback = soft delete of the migrated programme (needs `soft_delete_enabled`); Roadmap Manager rows are never deleted | R2-WB-06 | — |
| `roadmap_redirect_to_portfolio` | `0` | setting | PMO + PO (deletion of roadmap data: CAB) | `0` during the pilot; `1` only after one clean parity cycle (`tools/governance/roadmap-parity.js`) | B-09 | — |
| `schedule_inspection_interval_days` | `` | setting | Infrastructure / GRC owner | e.g. `90` if a quarterly inspection rhythm is adopted (proposal; empty = inspections are not reminded) | E-R06 | — |
| `schedule_reminder_lead_days` | `` | setting | Site coordination owner | e.g. `3` (proposal — empty = no reminder even when armed) | E-R06 | — |
| `schedule_reminders_enabled` | `0` | arm switch | Site coordination owner | `1` on the pilot site once the lead days are decided (in-app reminder to the site's editors before a scheduled PV / incubation session, cadence meeting or inspection) | E-R06 | — |
| `scoreboard_send_enabled` | `0` | arm switch | to be named | — | — | — |
| `sdp_api_accounts_url` | `https://accounts.zoho.com` | setting | to be named | — | — | — |
| `sdp_api_base_url` | `https://oneitsupport.endeavourmining.com/app/itdesk/api/v3` | setting | to be named | — | — | — |
| `sdp_api_client_id` | `` | setting | to be named | — | — | — |
| `sdp_api_client_secret` | (secret — not shown) | secret | to be named | — | — | — |
| `sdp_api_open_filter` | `Open_System` | setting | to be named | — | — | — |
| `sdp_api_refresh_token` | (secret — not shown) | secret | to be named | — | — | — |
| `sdp_api_write_enabled` | `0` | arm switch | to be named | — | — | — |
| `sharepoint_client_id` | `` | setting | to be named | — | — | — |
| `sharepoint_client_secret` | (secret — not shown) | secret | to be named | — | — | — |
| `sharepoint_list_id` | `` | setting | to be named | — | — | — |
| `sharepoint_site_id` | `` | setting | to be named | — | — | — |
| `sharepoint_tenant_id` | `` | setting | to be named | — | — | — |
| `shift_handover_enabled` | `0` | arm switch | Site IT lead + Owner | `1` on the pilot site once the incoming / outgoing people of each shift are on the duty roster (handover must be accepted by the incoming person; never automatic) | C-21 | — |
| `shift_handover_flag_hours` | `8` | setting | Site IT lead | `8` (a handover still pending after this many hours is flagged on the page) | C-21 | — |
| `site_code_shared_block` | `0` | setting | Data owner + Owner | `1` once the data owner has given each shared code to one site (Assafo/Tanda → tracker `TND`, AM-01) — while `0` both editors keep writing the same scope; `1` refuses a scoped editor's tracker / meetings / inspection save under a code two active sites share (409 naming the sites, page banner), never picks an owner | D-01 | Decide who owns each shared site code (e.g. TND) and correct the data first; then test the controlled 409 and the editors' rights. |
| `site_codes_from_registry` | `0` | setting | Data owner + KPI committee | PROPOSITION: `shadow` (E-D01 double read — hard maps keep answering, every registry divergence is logged once a day in System Logs ▸ governance) for at least two weeks, then `1` only by the committee (gate 10) | DEC-4, E-D01 | — |
| `site_local_calendar` | `0` | setting | Owner + Finance (month-end figures) | `0` while every reporting site is UTC+0; `1` only when a non-UTC site (e.g. the London office) is reported and its time zone (`sites.time_zone`, else from its country) is confirmed — the calendar-month helpdesk figures, the monthly Top-10, the site-report window (weekly chart) and the 6-month history move (WAN SLA keeps its own calendar) | D-07, E-D03 | — |
| `site_score_published_model` | `legacy` | setting | Owner (D-1) | `programme` | A-11 | — |
| `sla_wan_config` | `{"notify":{"enabled":false,"trigger_minutes":15,"from_nam…` | setting | to be named | — | — | — |
| `smtp_host` | `` | setting | to be named | — | — | — |
| `smtp_pass` | (secret — not shown) | secret | to be named | — | — | — |
| `smtp_port` | `587` | setting | to be named | — | — | — |
| `smtp_secure` | `0` | setting | to be named | — | — | — |
| `smtp_user` | `` | setting | to be named | — | — | — |
| `soft_delete_enabled` | `0` | arm switch | Owner (retention policy) | `1` | A-19 | — |
| `soft_delete_purge_enabled` | `0` | arm switch | Owner (retention policy) | `0` (keep everything during the pilot) | A-19 | — |
| `soft_delete_retention_days` | `30` | setting | Owner (retention policy) | `30` | A-19 | — |
| `sso_breakglass_user` | `` | setting | to be named | — | — | — |
| `sso_group_map` | `` | setting | to be named | — | — | — |
| `sso_mode` | `` | setting | to be named | — | — | — |
| `sync_alert_enabled` | `1` | arm switch | to be named | — | — | — |
| `sync_alert_recipients` | `` | setting | to be named | — | — | — |
| `sync_alert_teams_url` | (secret — not shown) | secret | to be named | — | — | — |
| `sync_drift_alerts` | `0` | setting | Ops + data owner per flow | PROPOSITION: `1` once each flow has an owner (drift is already computed and shown in `/api/sync/health` at `0`; `1` sends it through the sync alert path, once per 24 h per job) | E-D04 | — |
| `sync_drift_drop_pct` | `50` | setting | Ops + data owner per flow | PROPOSITION: `50` (last run below 50 % of the rolling median = `drop`) — to be set per flow by its owner | E-D04 | — |
| `sync_drift_duplicates_pct` | `10` | setting | Ops + data owner per flow | PROPOSITION: `10` (duplicates above 10 % of the last run's rows) | E-D04 | — |
| `sync_drift_spike_pct` | `300` | setting | Ops + data owner per flow | PROPOSITION: `300` (last run above 300 % of the median = `spike`) | E-D04 | — |
| `sync_truncation_tolerance_pct` | `20` | setting | to be named | — | — | — |
| `teams_sla_channels` | (secret — not shown) | secret | to be named | — | — | — |
| `teams_sla_enabled` | `0` | arm switch | to be named | — | — | — |
| `teams_sla_last_run` | `` | setting | to be named | — | — | — |
| `teams_sla_rules` | `` | setting | to be named | — | — | — |
| `tracker_engine_cutover` | `0` | setting | to be named | — | — | — |
| `transport` | `smtp` | setting | to be named | — | — | — |
| `ui_data_quality_page` | `0` | ui policy | Data owner | `1` for the admin tier once a data steward per source is named — a read-only board (Configure ▸ Data quality) of freshness, content drift, duplicates per sync job and hygiene completeness, money coverage, site-code disagreements per site, plus unmapped Risk-Register labels; every unreadable signal shows UNKNOWN; the two warn lines (80 % / 50 %) are PROPOSITIONS | E-D07 | A data steward per source to act on the board. |
| `ui_deck_builder_roles` | `super_admin` | ui policy | Owner (D-6) | `super_admin,report-author` (PO delegated decision P12, reversible) | A-21, C-28 | — |
| `ui_exec_charts_v2` | `0` | ui policy | Executive sponsor + data / BI owner | `0` until a browser review of the Executive Scorecard with the executive sponsor and the data / BI owner (decision D5) — same figures, small multiples instead of dual axes, bars instead of rings | F-UX-12 | — |
| `ui_exec_nav` | `full` | ui policy | Owner (D-6) | `consolidated` (PO delegated decision P1, reversible — re-examine after 30 days of `page_viewed`) | C-28 | — |
| `ui_feedback_enabled` | `0` | ui policy | PO | `1` on the pilot once B-05 (RACI) names who answers feedback — a Feedback button in the header (problem / idea / question, page auto-filled, ≤ 2 000 characters, named or anonymous: anonymous keeps only role tier + site), triage in `/api/feedback` (admin tier), the answer shown on Home ▸ My work; no notification sent, no AI reads the text | E-B07 | Someone named to answer feedback (B-05 RACI) before the button is shown. |
| `ui_home_blocks` | `0` | ui policy | Owner (UI policy) | `1` (proposal — after a browser review: per-block states and per-card reload on Home; never shows a figure the server did not send) | F-UX-09 | — |
| `ui_home_queue` | `0` | ui policy | Owner (UI policy) | `1` (proposal — after a browser review in EN and FR at 320 px: Home shows one queue of the person's own work read from the existing per-site readers (meeting / inspection actions, report follow-ups, commitments, "Awaiting me"), each source with its own state available / unknown / stale / partial / denied, 12 sites and 150 items at most, register link when no exact page exists; grants nothing — every reader keeps its own site check) | R2-QUEUE (R3) | — |
| `ui_i18n_pages` | `0` | ui policy | Owner (D-2) | `1` | A-09, C-26 | — |
| `ui_inject_dash_key` | (secret — not shown) | secret | Security owner | `0` (pages no longer receive `window.__ak`; every data call rides the session cookie — proven by `tests/api-key-injection.smoke.test.js` (g)) after one browser pass on the TEST instance | E-S02 | One browser pass on the TEST instance of every page that used window.__ak. |
| `ui_kpi_base_line` | `0` | ui policy | Owner (UI policy) | `1` (proposal — show the base population under each KPI value) | E-V03 | — |
| `ui_kpi_definition_drawer` | `0` | ui policy | KPI committee | `1` (proposal — the tile then shows formula, window, denominator, source job and the certification text; nothing is certified by showing it) | F-DATA-07 | — |
| `ui_kpi_sample_size` | `0` | ui policy | KPI committee | `1` (proposal — warnings only appear once the KPI committee adopts a `min_sample`) | E-K02 | — |
| `ui_lang_default` | `` | ui policy | Owner (D-2) | `fr` | A-09 | — |
| `ui_nav_active_from_url` | `0` | ui policy | Owner (UI policy) | `1` (proposal — pages whose `data-current` names no menu entry get their active entry from the address; R2-QUEUE extends it: an address naming an entry by `?key=` / `#fragment` wins over the page's static attribute, and an in-page `#` change moves it; exactly one `aria-current` per navigation landmark; visibility unchanged) | F-UX-02 · R2-QUEUE (R4) | — |
| `ui_nav_carry_site` | `0` | ui policy | Owner (UI policy) | `1` (proposal — when the address carries `?site=CODE`, menu / finder / workspace links to the four site-aware pages carry it; the page still checks the right) | R2-QUEUE (R4) | — |
| `ui_nav_profile` | `full` | ui policy | Owner (D-6) | `lean` (proposal — re-decide from the T1–T8 sessions) | A-21 | — |
| `ui_role_landing` | `0` | ui policy | Owner (UI policy) | `1` | A-10 | — |
| `ui_small_multiples` | `0` | ui policy | Owner (UI policy) | `1` (proposal — after a browser review of the widget) | E-V09 | — |
| `ui_url_filters` | `0` | ui policy | Owner (UI policy) | `1` (proposal — shareable Analytics links; filters only, never a data value) | E-U02 | — |
| `ui_week_labels` | `legacy` | ui policy | Owner (UI policy) | `explicit` (proposal — ISO helpdesk charts say "ISO W37 (7–13 Sep)", report rows carry their Sun→Sat range) | D-03 | — |
| `ux_event_telemetry` | `0` | setting | Data protection officer + Owner (UI policy) | `0` until the privacy notice and retention are agreed (decision D3); then `1` for the pilot cohort — counts export / drill / action / first-click events, user id + role tier only | F-UX-06 | — |
| `wan_mos_config` | `{"r0":93.2,"codec_loss_factor":2.5,"jitter_buffer_factor"…` | setting | to be named | — | — | — |
| `wan_poll_first_run` | `` | setting | to be named | — | — | — |
| `wan_poll_last_run` | `` | setting | to be named | — | — | — |
| `wan_quality_thresholds` | `{"loss":{"good":1,"bad":7},"latency":{"good":100,"bad":40…` | setting | to be named | — | — | — |
| `wan_sla_require_contract_evidence` | `0` | setting | Finance | `1` once contracts are uploaded | A-25 | — |
| `wan_stale_close_at` | `now` | setting | Network owner | `last_seen` | A-25 | — |
| `wan_timeup_latency_ms` | `` | setting | to be named | — | — | — |
| `wan_timeup_loss_pct` | `100` | setting | Network owner | `5` (calibration of 2026-09-04) | A-18 (pre-existing key; A-18b adds the uncalibrated banner + `tools/meraki/check-timeup-calibration.js`) | — |
| `weekly_report_send_enabled` | `0` | arm switch | to be named | — | — | — |
| `workspace_profiles_enabled` | `0` | arm switch | PO | `1` for the pilot cohort once the PO confirms the 11 profiles and their first destinations — presentation profiles (REBUILD-SPEC R1) + `workspace-settings.html` (R2: profile among those the roles allow, destination order / hidden, density, default site among the person's own sites), stored per user (migration 078); a profile NEVER grants a page, a role or a site (tested); a business-only account is offered only the business profile; the login landing and Home are not rewired here (R2-QUEUE) | R1-PROFILES | — |
| `xof_usd_rate` | `0.00165` | setting | to be named | — | — | — |

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
| `SDP_DATA_DIR` | switch | see the reading file | to be named | assets-db.js, inspection-db.js, meetings-db.js, reports-db.js (+4) |
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
