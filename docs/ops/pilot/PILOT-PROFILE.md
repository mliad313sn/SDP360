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
| `ui_i18n_pages` | built | `0` | `1` | Owner (D-2) | A-09, C-26 |
| `ui_lang_default` | built | `` (empty) | `fr` | Owner (D-2) | A-09 |
| `ui_role_landing` | built | `0` | `1` | Owner (UI policy) | A-10 |
| `ui_nav_profile` | built | `full` | `lean` (proposal — re-decide from the T1–T8 sessions) | Owner (D-6) | A-21 |
| `ui_deck_builder_roles` | built (menu entry, page gate and the page's routes since C-28) | `super_admin` | `super_admin,report-author` (PO delegated decision P12, reversible) | Owner (D-6) | A-21, C-28 |
| `ui_exec_nav` | built | `full` | `consolidated` (PO delegated decision P1, reversible — re-examine after 30 days of `page_viewed`) | Owner (D-6) | C-28 |
| `ui_week_labels` | built | `legacy` | `explicit` (proposal — ISO helpdesk charts say "ISO W37 (7–13 Sep)", report rows carry their Sun→Sat range) | Owner (UI policy) | D-03 |
| `ui_kpi_base_line` | built | `0` | `1` (proposal — show the base population under each KPI value) | Owner (UI policy) | E-V03 |
| `ui_kpi_sample_size` | built | `0` | `1` (proposal — warnings only appear once the KPI committee adopts a `min_sample`) | KPI committee | E-K02 |
| `ui_small_multiples` | built | `0` | `1` (proposal — after a browser review of the widget) | Owner (UI policy) | E-V09 |
| `dashboard_red_action_links` | built | `0` | `1` (proposal — only with `commitments_enabled=1`; no action is ever created automatically) | Owner (UI policy) + PMO | E-K03 |
| `metric_explain_enabled` | built | `0` | `1` (proposal — read-only; counts by site, ratios as numerator / denominator; the note never asserts a cause) | KPI committee | E-K04 |
| `chart_annotations_enabled` | built | `0` | `1` (proposal — after a browser review; notes are human-entered with a mandatory source) | Owner (UI policy) | E-V08 |
| `ui_url_filters` | built | `0` | `1` (proposal — shareable Analytics links; filters only, never a data value) | Owner (UI policy) | E-U02 |
| `ui_nav_active_from_url` | built | `0` | `1` (proposal — pages whose `data-current` names no menu entry get their active entry from the address; visibility unchanged) | Owner (UI policy) | F-UX-02 |
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
| `exec_deck_other_bucket` | built | `0` | `1` (PO decision P4: "Other (n)" on every top-N deck chart, Normal changes as their own slice) | Reporting owner (PO P4) | C-16 |
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
| `authz_capability_mode` | built | `off` | `shadow` (log divergences only; `enforce` acts only on `authz_enforce_caps` — route-by-route plan in `docs/agent-execution/C-17.md`) | Security owner | C-17 |
| `authz_enforce_caps` | built | `` (empty = nothing enforced) | PROPOSITION: empty during the pilot; after two shadow weeks without unexplained divergences (`tools/security/authz-divergence-report.js`), low-risk reads first (`review.read`, `analytics.data.read`, `tracker.read`) with mode `enforce`; a listed capability can only refuse, critical ones are ignored while C-18 grants are off | Security owner | E-S01 |
| `access_require_approval` | built | `0` | `1` once the approver rule and the requires_request list are decided (break-glass stays possible, logged risk=1) | Security owner + Owner (approver matrix) | C-18 |
| `access_grant_expiry_job` | built | `0` | `1` (ends expired grants nightly; a role held before the grant or by another live grant stays) | Security owner | C-18 |
| `access_recert_enabled` | built | `0` | PROPOSITION: `1` once the Security owner schedules the first campaign (site managers answer their lines; the subject never answers their own) | Security owner + site managers | E-S03 |
| `access_recert_apply` | built | `0` | PROPOSITION: `0` for the first campaign (revoke answers recorded only, reviewed by the Security owner); `1` only after that review | Security owner | E-S03 |
| `access_recert_orphan_days` | built | `90` | PROPOSITION: N to be chosen by the Security owner (an account with no sign-in evidence is listed as UNKNOWN, never as idle) | Security owner | E-S03 |
| `entra_deprovision_enabled` | built | `0` | PROPOSITION: `1` (dry run) only after the tenant administrator decides on the Graph `User.Read.All` application consent (gate 2); read the dry-run list on TEST first | Information Security + tenant administrator | E-S04 |
| `entra_deprovision_apply` | built | `0` | PROPOSITION: `0` until a dry run has been reviewed and the revocation delay measured on TEST; then `1` | Information Security | E-S04 |
| `access_approver_policy` | built | `{"platform_roles":["admin","executive","super_admin","tracker-admin","audit-viewer"],"platform_approver_role":"super_admin","site_approver_role":"admin","site_approver_must_hold_site":true}` | the default (PO decision R7, encoded 2026-11-05): platform roles by a super_admin, other roles by an admin-tier user holding the site; never the requester, subject or their deputy | Security owner + Owner | C-19 |
| `qualification_check_enabled` | built | `0` | `0` until each site's HSE owner has recorded and verified the evidence; then `1` per requirement (evidence only — SDP360 never grants a physical authorisation) | HSE owner + Security owner | C-19 |
| `qualification_requirements` | built | `{}` | `{}` — which capability needs which kind (e.g. `field.capture` → `site-induction`) is a human decision | HSE owner | C-19 |
| `shift_handover_enabled` | built | `0` | `1` on the pilot site once the incoming / outgoing people of each shift are on the duty roster (handover must be accepted by the incoming person; never automatic) | Site IT lead + Owner | C-21 |
| `shift_handover_flag_hours` | built | `8` | `8` (a handover still pending after this many hours is flagged on the page) | Site IT lead | C-21 |
| `auth_account_throttle_enabled` | built | `0` | `1` (per-account failed sign-in cap on top of the per-IP limiter; note a deliberate lock-out of a named account is possible for its window) | Security owner | SEC-01 |
| `auth_account_throttle_max` | built | `10` | `10` failed sign-ins per account per window | Security owner | SEC-01 |
| `auth_account_throttle_window_min` | built | `15` | `15` minutes | Security owner | SEC-01 |
| `auth_pbkdf2_iterations` | built | `100000` | PROPOSITION: `100000` (today, nothing rehashed) until a crypto review names the target (e.g. 210000, OWASP 2023 for PBKDF2-SHA512); a higher value rehashes each user once at their next successful password sign-in and costs that much more CPU per sign-in (see docs/agent-execution/E-W2-RDB.md for the measured time) | Security owner | E-S05 |
| `emergency_access_enabled` | built | `0` | `1` once the super_admins who may grant and review are named (a super_admin, never the beneficiary, max 24 h, review within 2 working days by another super_admin — PO decision R7; never waives a qualification) | Security owner + Owner | C-22 |
| `emergency_access_max_hours` | built | `24` | `24` (hard cap; may only be lowered) | Security owner | C-22 |
| `kpi_policy_enforced` | built | `0` | `0` until the KPI committee has ADOPTED a resolution-SLA policy on `/kpi-builder.html` (two different members: author ≠ adopter, with the session reference) and read the shadow comparison; then `1` (the Helpdesk tile, ranking and trend follow the adopted version) | KPI committee + Owner | C-31 |
| `site_code_shared_block` | built | `0` | `1` once the data owner has given each shared code to one site (Assafo/Tanda → tracker `TND`, AM-01) — while `0` both editors keep writing the same scope; `1` refuses a scoped editor's tracker / meetings / inspection save under a code two active sites share (409 naming the sites, page banner), never picks an owner | Data owner + Owner | D-01 |
| `site_codes_from_registry` | built | `0` | PROPOSITION: `shadow` (E-D01 double read — hard maps keep answering, every registry divergence is logged once a day in System Logs ▸ governance) for at least two weeks, then `1` only by the committee (gate 10) | Data owner + KPI committee | DEC-4, E-D01 |
| `sync_drift_alerts` | built | `0` | PROPOSITION: `1` once each flow has an owner (drift is already computed and shown in `/api/sync/health` at `0`; `1` sends it through the sync alert path, once per 24 h per job) | Ops + data owner per flow | E-D04 |
| `sync_drift_drop_pct` | built | `50` | PROPOSITION: `50` (last run below 50 % of the rolling median = `drop`) — to be set per flow by its owner | Ops + data owner per flow | E-D04 |
| `sync_drift_spike_pct` | built | `300` | PROPOSITION: `300` (last run above 300 % of the median = `spike`) | Ops + data owner per flow | E-D04 |
| `sync_drift_duplicates_pct` | built | `10` | PROPOSITION: `10` (duplicates above 10 % of the last run's rows) | Ops + data owner per flow | E-D04 |
| `incubation_rfi_link_enabled` | built | `0` | `1` on the pilot site once the PMO accepts incubation-born RFIs in the queue (the RFI score stays provisional: incubation scoring criteria are a human decision) | PMO + Owner | E-I04 |
| `obligations_include_decisions` | built | `0` | `1` (the site obligations view then counts the site's open governance decisions; the visible total of a site can grow) | Committee + Owner | E-G02 |
| `agenda_cron_enabled` | built | `0` | `1` (the Monday job prepares a DRAFT agenda per cadence due that week; nothing is sent, the secretary still prepares the session) | Committee | E-G03 |
| `controls_register_enabled` | built | `0` | `1` once GRC names who adopts controls (the four seeded controls stay `candidate` until a person adopts them with a reason; frequencies and testers are GRC decisions) | GRC owner + Security owner | E-G04 |
| `site_local_calendar` | built | `0` | `0` while every reporting site is UTC+0; `1` only when a non-UTC site (e.g. the London office) is reported and its time zone (`sites.time_zone`, else from its country) is confirmed — the calendar-month helpdesk figures, the monthly Top-10, the site-report window (weekly chart) and the 6-month history move (WAN SLA keeps its own calendar) | Owner + Finance (month-end figures) | D-07, E-D03 |
| `problem_candidates_enabled` | built | `0` | `1` on the pilot site once a problem owner is named (candidates are listed with "causality not validated"; promoting one creates a commitment whose owner a person chooses; ServiceDesk Plus Problem records are not synced) | Problem owner + Owner | E-I02 |
| `problem_candidate_min` | built | `` (empty) | PROPOSITION: none — the recurrence threshold (incidents of one category × sub-category on a site in the window) is a human decision; empty = no candidate is computed | Problem owner + KPI committee | E-I02 |
| `pir_reviews_enabled` | built | `0` | `1` once the Incident manager names who signs a post-incident review and the business sponsor per major incident (the sign-off is a recorded human act by someone other than the author; nothing is sent) | Incident manager + business sponsor | E-I03 |
| `insp_repeat_findings` | built | `0` | `1` once the inspection owner sets the window below (the inspections dashboard then lists items rated minor / major / critical in at least 2 of a site's last N submitted inspections) | Infrastructure / inspection owner | E-I06 |
| `insp_repeat_window` | built | `` (empty) | PROPOSITION: none — N (how many of a site's last submitted inspections are compared) is a human decision; empty = nothing computed | Infrastructure / inspection owner | E-I06 |
| `insp_action_verify_enabled` | built | `0` | `1` once the inspection owner confirms that Critical and High corrective actions need an independent check (a closed one reads "awaiting verification" until a person who did not close it verifies it) | Infrastructure / inspection owner + GRC | E-I06 |
| `field_outbox_resolve_enabled` | built | `0` | `0` until the real-device sessions (E-F04, audit F-01) show how often field entries get stuck — otherwise an admin repair becomes the normal path (X-§7-01); then `1` (admin tier may `mark_rejected` or `release` a stuck entry; a ticket / action is released only after checking SDP, with a reason; every resolution is a risk row in System Logs; nothing is applied server-side). The read-only list `GET /api/field/admin/outbox` has no switch | PO + site IT | E-F01 |
| `field_review_step` | built | `0` | `1` on the pilot site after one session shows it does not slow the technician (a one-screen summary — site, items, findings, photos, offline note — before an inspection is queued; « Corriger » queues nothing) | PO / adoption lead | E-F03 |
| `field_task_timing` | built | `0` | `1` for the pilot window to take a BASELINE (active time form open → queued, pauses > 2 min excluded, user id + role tier only; median / p75 per site × kind × week in `tools/pilot/pilot-metrics.js`). No target is set — targets come only after the baseline (PILOT-MEASUREMENT.md) | PO / adoption lead | E-F03 |
| `a01_missing_due_date` | built | `0` | `1` (proposal — a serious commitment without a due date or approved exception is then escalated as A01, like a missing owner) | Commitments owner (D-04) | E-R02 |
| `a10_gate_lead_days` | built | `` (empty) | a number of days, e.g. `10` (proposal — the armed ppm-alerts job then reminds the project owner and committee before the next stage gate; empty = off) | Committee | E-R02 |
| `delivery_failure_alert_enabled` | built | `0` | `1` once `sync_alert_recipients` (or the Teams URL) names who receives sync alerts (D-13) — the failed deliveries are already listed on System Logs either way | Platform owner (D-13) | E-R04 |
| `schedule_reminders_enabled` | built | `0` | `1` on the pilot site once the lead days are decided (in-app reminder to the site's editors before a scheduled PV / incubation session, cadence meeting or inspection) | Site coordination owner | E-R06 |
| `schedule_reminder_lead_days` | built | `` (empty) | e.g. `3` (proposal — empty = no reminder even when armed) | Site coordination owner | E-R06 |
| `schedule_inspection_interval_days` | built | `` (empty) | e.g. `90` if a quarterly inspection rhythm is adopted (proposal; empty = inspections are not reminded) | Infrastructure / GRC owner | E-R06 |
| `alert_group_by_rule` | built | `0` | `1` (proposal — the e-mail digest shows one line per alert rule listing its sites instead of one line per site) | Owner (alerting policy) | E-R07 |
| `alert_quiet_hours` | built | `` (empty) | e.g. `22:00-06:00` UTC (proposal — non-critical in-app firings wait until the window ends; critical ones are never deferred) | Owner (alerting policy) | E-R07 |
| `ppm_capacity_view` | built | `0` | `1` once the PMO accepts the team-load reading (capacity per site × week, conflicts sorted by excess then duration, suggestions are proposals only; a task reassignment then needs a reason — it is traced in `ppm_events` at `0` too). What "availability" means for a team stays undefined until a capacity owner signs `docs/ops/CAPACITY-DATA-CONTRACT.md` | PMO + capacity owner (to be named) | E-P03 |
| `ppm_budget_periods_enabled` | built | `0` | `1` once Finance agrees the period grid (month × currency × baseline / actual / forecast, EAC = actual to date + remaining forecast per currency, never across currencies; a change or a variance vs the baseline needs a justification and is hash-chained in `ppm_events`). Every view says "not certified" until Finance certifies the figures; who may approve a budget stays a Finance decision | Finance + PMO | E-P04 |
| `benefit_owner_link_enabled` | built | `0` | `1` once the PMO wants benefit owners named as users (the free-text owner stays; "My work" then lists the person's benefits whose review date is reached — in-app only, nothing is e-mailed). The linked owner can never verify their own benefit | PMO | E-P05 |
| `ppm_raci_enabled` | built | `0` | `1` when the PMO wants responsibilities per task on the project page (R / A / C / I per person, exactly one A per task — a matrix without it is refused; CSV export; every change is a `ppm_events` row) | PMO | E-P06 |
| `ppm_templates_enabled` | built | `0` | `1` once the PMO names who validates templates (a template is the STRUCTURE only — task names, WBS, durations, milestone names; no people, dates or money; `draft` until another committee member approves it; only an approved template creates a project) | PMO (template validation is a human act) | E-P06 |
| `ppm_annual_pack_enabled` | built | `0` | `1` before the annual planning committee (the XLSX pack is a DRAFT on every sheet: projects of the year, per-currency budget roll-up under the money rule, capacity summary, provisional RFI scores; the envelope column stays UNKNOWN until Finance enters it — envelopes and arbitration are human decisions) | CIO + PMO + Finance | E-P08 |
| `dashkey_scope_mode` | built | `open` | `shadow` first (an unlisted key-only route still answers and logs `dashkey_scope_would_refuse`); `restrict` (401) only after every consumer in `tools/security/dashkey-consumers.js` is named and listed. A browser request is never affected | Integration owner + Security owner | E-S02 |
| `dashkey_allowed_routes` | built | `` | the routes the named consumers really call (from the consumer report), e.g. `GET /api/ping, GET /api/data/*` — PROPOSITION, no list approved | Integration owner + Security owner | E-S02 |
| `ui_inject_dash_key` | built | `1` | `0` (pages no longer receive `window.__ak`; every data call rides the session cookie — proven by `tests/api-key-injection.smoke.test.js` (g)) after one browser pass on the TEST instance | Security owner | E-S02 |
| `ui_feedback_enabled` | built | `0` | `1` on the pilot once B-05 (RACI) names who answers feedback — a Feedback button in the header (problem / idea / question, page auto-filled, ≤ 2 000 characters, named or anonymous: anonymous keeps only role tier + site), triage in `/api/feedback` (admin tier), the answer shown on Home ▸ My work; no notification sent, no AI reads the text | PO | E-B07 |
| `ai_commentary_stale_block` | built | `0` | `1` once an AI provider is switched on (today `AI_PROVIDER=off`, so the switch changes nothing) — a report run whose sources are stale or never synced keeps its deterministic text with the reason, instead of an AI commentary written on old data; the deck builder's `/api/ai/analyze` also returns `verification` (offending numbers) when the page sends `facts` (metadata, no switch) | Owner (AI) + KPI committee | E-B08 |
| `ui_data_quality_page` | built | `0` | `1` for the admin tier once a data steward per source is named — a read-only board (Configure ▸ Data quality) of freshness, content drift, duplicates per sync job and hygiene completeness, money coverage, site-code disagreements per site, plus unmapped Risk-Register labels; every unreadable signal shows UNKNOWN; the two warn lines (80 % / 50 %) are PROPOSITIONS | Data owner | E-D07 |

Not in this table because they are not top-level `report_config` keys:

- A-23 (built) — `paused_statuses` (default `[]`) and `dedup_mode` (default `once`) live **inside** the existing
  `teams_sla_rules` JSON; decided by the helpdesk lead.
- E-G03 (built) — governance **policy** `governance.quorum_min` (Admin ▸ Governance policies, per site), not a
  `report_config` key: default empty = not defined (minutes print "quorum not defined", never "quorate"); the
  value (how many present) is the committee's decision.
- C-03 (built) — governance **policy** `governance.skip_inactive_holders` (Admin ▸ Governance policies, platform
  only, protected), not a `report_config` key: default `false` (today: a deactivated or site-less role holder or
  deputy still counts as coverage and still receives escalations); recommended pilot value `true`; decided by the
  owner (access policy).
- C-21 (built) — governance **policy** `handoffs.queue_receivers` (Admin ▸ Governance policies, per site), not a
  `report_config` key: default `false` (today: an escalation goes to the named role holder and their deputy);
  `true` → it goes first to the people on duty now for `site-it-support` on that site (duty roster, C-20), and to the
  named person only when nobody is on duty. Recommended pilot value `true` only once the site roster is entered;
  decided by the site IT lead. Scoped deputies (migration 060) have no switch: a deputy without a scope behaves
  exactly as before.
- A-28 (built) — `.env` switches, not `report_config`; decided by the security owner, all default to today:
  `SDP_CSP_REPORT_ONLY` (unset = no report-only header, no `/api/security/csp-report`),
  `SDP_CONFIG_BOX_VERSION` (default `2`; `3` = new secrets sealed as `enc:v3`), `SDP_PDF_SANDBOX`
  (unset = PDF render keeps `--no-sandbox`).

- C-09 (built) — **always-on internal telemetry, no switch**: the shell posts one `page_viewed` event per page load;
  the server keeps one system_log row per user × page × day (`services/viewLog.js` gate) with the user id and role tier
  only (no name, e-mail or IP). Nothing a user sees changes. Read-only report: Admin ▸ System Logs ▸ Page usage
  (`GET /api/ux/page-usage?days=30`, super_admin). It feeds the exec-surfaces keep/merge decision
  (`docs/ux/EXEC-PAGES-MATRIX.md`). Every switch of this profile is also listed in `docs/ops/FLAG-REGISTER.md`.

When a goal lands, change its rows from `planned` to `built`; the test then holds the default to the code.
