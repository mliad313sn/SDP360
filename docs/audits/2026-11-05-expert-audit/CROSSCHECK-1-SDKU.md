# Cross-check 1 — expert audit of 5 Nov 2026, chantiers S · D · K · U (+ §1, §3, §4 claims)

Checked by: development agent (AI), 5 Nov 2026, on `goal/xa` head **`d38fa41`** (the audited revision).
Read-only: no product code edited, no test suite run, nothing committed. This file **recommends**; it approves
nothing. Every "HUMAN" line stays open until a named person acts (`.claude/rules/SDP360_BOUNDARIES.md`).

Naming: the audit's ids collide with our own (`D-01…D-10` AMDEC follow-ups, `A-xx`, `B-xx`). In this file
**"audit S-01"** etc. means the audit's backlog action; **"our D-01"** means `docs/agent-execution/D-0102.md` &c.
New goals proposed here are **`E-<chantier><nn>`**. Line numbers are at `d38fa41` and drift — locate by content.

Classes: **DONE** (delivered, proof cited) · **BUILD** (agent can do now, reversible) · **BUILD-SHADOW** (behaviour
proposable behind a `report_config` switch defaulting to today + PILOT-PROFILE row; never claimed approved) ·
**HUMAN** (needs a real person/authority; agent-preparable items listed) · **OUT** (violates boundaries).

---

## 0. §1 / §3 / §4 factual claims (security, data, access)

| Audit claim | Verdict | Proof |
|---|---|---|
| Version 2.0.0-alpha.14; 57 pages; 593 routes, 76 without test reference; 28 jobs, 10 without; 71 migrations; 585 test files | **ACCURATE** | `package.json` `"version": "2.0.0-alpha.14"`; `docs/agent-execution/INVENTORY.md:9-21`; `find db/postgres -name '*.sql' \| wc -l` = 71 |
| 4 135 tests / 0 fail / 11 skipped (10 "no prod-snapshot", 1 python) | **ACCURATE** | G24 dossier §4; `tests/.skip-allowlist.json` (max 10 + 1); skips in `tests/review-data.test.js:11-78`, `tests/site-window-readers.test.js:14,187` |
| 52 metrics, 25 on a widget, 13 in an alert rule, 10 with no direct reference | **ACCURATE** | `docs/ops/METRIC-WIDGET-MAP.md:7` |
| Historical PostgreSQL superuser secret signalled in the repo | **ACCURATE** (value removed from tree in `95984c5`, still in history `92a6a68`, `214c0d1`) | `docs/security/EX-01-CREDENTIAL-INCIDENT.md` §1; SEC-01 F6 |
| IAM: capability model off/shadow, enforce not wired; department scope undefined | **ACCURATE** | `services/authzShadow.js:9,44` (enforce read as shadow); PO decision R4 "no department scoping in the pilot" (`docs/decisions/2026-11-05-PO-DELEGATED-DECISIONS.md:47`); `docs/agent-execution/G02.md:17` |
| Assafo/Tanda share `TND`; detection + refusal behind a switch off | **ACCURATE** | `tracker-db.js:49-51` (`'TANDA':'TND'`, `'ASSAFO':'TND'`); `services/siteCodeShared.js:2-4,20-31`; `site_code_shared_block` default `0` |
| Per-site time zone only on the helpdesk monthly reader, switch off | **ACCURATE** | `reports-db.js:2872-2880` (`getCalendarMonthlyHelpdesk` only); G24 §7 |
| server.js ~7 910 lines; reports.html ~8 936 | **ACCURATE** (7 908 / 8 935) — and server.js is **2 lines under** its budget (`tests/server-size-budget.test.js`, < 7 910): any goal touching it must net-remove lines | `wc -l` |
| Reporting catalogue "1 complete, 13 partial, 2 absent" | **ACCURATE** (A01–A16: 1 implemented, 13 partial, 2 missing) | `docs/sdp360/completion/REPORT-ALERT-CATALOGUE.md` |
| "Outbox idempotent, network tests simulated" (§4 terrain) | ACCURATE (outside this check's scope) | — |
| §3: "tests not re-run locally" | ACCURATE — and also true of this cross-check | — |

---

## (a) Action table

| Audit action | Claim verdict | Class | Proof / notes | Goal |
|---|---|---|---|---|
| **audit S-01** Historical PG secret | ACCURATE | **HUMAN** (rotation per cluster, history decision — gate 1) | EX-01 §3 checklist + §4 options exist; recurrence prevented (`tools/security/secret-scan.js`, CI blocking, `tests/secret-scan.test.js`, `tests/installer-no-stored-password.test.js`). Agent-preparable: a per-cluster **rotation evidence record** (fill-in form: cluster, change ref, date, operator, `pg_hba` reviewed, superuser-login log reviewed) | E-S06 (prep) |
| **audit S-02** 16 key-only routes | ACCURATE (`GET /api/ping` + 15 `GET /api/data/*`, `tests/dashkey-only-routes.smoke.test.js:15-17`; evidence log `dashkey_call`, `server.js:1100-1107`) | **BUILD-SHADOW** + HUMAN (name consumers, dedicated key/quota = integration owner, D-15) | No consumer report exists; no way to narrow without code. See also **X-SEC-01** (the same key is shipped to every signed-in browser) | E-S02 |
| **audit S-03** Department rights | ACCURATE | **HUMAN** (PO R4: no department scope for the pilot; policy = data owners) | No user↔department model exists (users carry site only; departments are labels — G02.md:17). Inventing a rule would hide/expose by guess. Agent-preparable: a **draft object × site × department × role matrix** marked PROPOSITION, listing every table that carries a `department` column and today's effective visibility | E-S06 (prep) |
| **audit S-04** Capability enforce | ACCURATE (`authzShadow.js:9-10,44`; C-17 "enforce plan" steps 1-4) | **BUILD-SHADOW** (per-capability allow-list, empty default) + HUMAN (switch, after 2 clean shadow weeks — R6) | Enforce plan is already written in `docs/agent-execution/C-17.md` §"Enforce plan"; only step 2 is code | E-S01 |
| **audit S-05** Recertification | ACCURATE (C-18 PARTIAL: no campaign, no arrival wizard, no recompute on site change) | **BUILD-SHADOW** + HUMAN (run the campaign, sign) | Requests/approvals/expiry exist (`routes/access.js`, `services/accessStore.js`, `access_grant_expiry_job`). Orphan-account report (no login N days, editor without site, inactive holder) not built | E-S03 |
| **audit S-06** Emergency access | ACCURATE | **DONE** (code: C-22, our D-09 NE-01 played) + HUMAN (name super_admins, TEST drill, R7 reviewer) | `services/emergencyAccess.js`, `tests/emergency-access*.js`; `emergency_access_enabled=0`, max 24 h (can only lower). Agent-preparable: TEST drill script with expected log lines | E-S06 (prep) |
| **audit S-07** Leavers (Entra) | ACCURATE (SEC-01 F7: not built; Graph `User.Read.All` consent = gate 2) | **BUILD-SHADOW** (dry-run job, inert without consent) + HUMAN (tenant decision, revocation delay measured) | Local part DONE: deactivation kills sessions immediately (`tests/access-revocation.smoke.test.js`, G02). Gap: password sign-in + live session of an Entra-disabled user in `SSO_MODE=available/off` | E-S04 |
| **audit S-08** Auth & sessions | ACCURATE (throttle built, off: `auth_account_throttle_enabled=0`; PBKDF2 100 000 hard-coded `reports-db.js:320-321`) | **BUILD-SHADOW** (stored iteration count + rehash on login, target default = 100 000 = today) + HUMAN (throttle activation gate 14, crypto review) | **X-SEC-02**: the hash carries no iteration parameter, so the work factor cannot be raised without a column | E-S05 |
| **audit S-09** Pentest | ACCURATE | **HUMAN** (authorised independent test) | `docs/security/THREAT-MODEL.md`, `docs/ops/AUTHZ-MATRIX.md`, `tools/qa/route-matrix.js` exist as inputs. Agent-preparable: **rules of engagement + scenario list** (API object scope, SSO, field/mobile outbox, exports/share links, key-only routes, emergency access) | E-S06 (prep) |
| **audit S-10** Retention | PARTLY (soft-delete retention switch `soft_delete_*` exists, off — `services/reportConfig.js:244-248`; share links expire/revoke; `slaAlertLog.purge(90)`; evidence `retention_class` column; A16 "no archive event") | **HUMAN** (DPO/legal durations, legal hold) + BUILD (inventory) | Agent-preparable: **retention inventory generated from code** (object type → table → today's behaviour → duration/config key → owner UNKNOWN) | E-S06 |
| **audit D-01** TND | ACCURATE (code DONE as our D-01, behind switch) | **HUMAN** (data owner picks the site — gate 9) + BUILD (reconciliation pack) | Nothing tells the owner *which* existing `TND` rows came from which site. `tracker_entries_saved` events carry the actor (`routes/trackers.js:193`) → a read-only split report is possible | E-D01 |
| **audit D-02** Site master | PARTLY (our D-02: onboarding checklist + fill-plan dry run `services/siteOnboarding.js`; registry already refuses a code used by another site, `routes/policies.js:114-115`) | **BUILD** | Missing: `country` / `time_zone` not editable (`updateSite` takes only `zoho_group, sort_order, active`, `reports-db.js:1612-1615`; time zone is SQL-only — G24 §7); no retire checklist; no single "site master" export | E-D02 |
| **audit D-03** Code migration | ACCURATE (registry `site_codes_from_registry` on/off only, `services/siteCodeRegistry.js:1-8`) | **BUILD-SHADOW** (`shadow` value = double read, log divergences, hard map still answers) + HUMAN (committee switch, gate 10) | `diff()` is static evidence; there is no live double-read | E-D01 |
| **audit D-04** Calendars / TZ | ACCURATE | **BUILD-SHADOW** (extend `site_local_calendar` to the other site-window readers) + HUMAN (gate 8: only if a non-UTC site is reported) | Remaining UTC readers: Top-10 monthly, weekly site-report window, 6-month history (G24 §7). WAN SLA keeps its own GMT service calendar (out of this goal) | E-D02 (field), E-D03 |
| **audit D-05** Multi-currency | PARTLY — code DONE (A-16 `services/moneyCoverage.js`, A-26 per-row gates, our D-06 excluded rows ⇒ not certified, `services/currency.js` unknown currency excluded) | **DONE** (code) + HUMAN (Finance supplies `asset_site_currency`, `asset_currency_rates` — gate 12) | Rates are a single current JSON — no dated history; a historical restatement would move. Noted, not a goal until Finance confirms they need historical rates | — |
| **audit D-06** Source drift | PARTLY (run log rows/duplicates/freshness per job, `services/sync/jobs.js:1-17`, `syncStore.js:52-55`; Zoho truncation guard) | **BUILD-SHADOW** | No expected-volume / anomaly check on content: a sync that writes 10 % of its usual rows is "ok" | E-D04 |
| **audit D-07** Lineage | PARTLY (registry rows carry formula, window, reader, field, source, owner_role, certification — `services/metricRegistry.js:25-30`; consumer map generated) | **BUILD** | No single per-indicator sheet joining both; adopted `kpi_policies` version not shown next to the code formula | E-D05 |
| **audit D-08** Reference dataset | ACCURATE (10 skips) | **HUMAN** (data owner approves an anonymised extract) + BUILD (operator-run anonymiser + synthetic multi-country fixture) | Production data must never reach the agent — the agent writes the tool, an operator runs it | E-D06 |
| **audit D-09** Data-quality board | ACCURATE (signals scattered: sync health, asset hygiene, site-code diff, money coverage, RR unmapped sites) | **BUILD-SHADOW** (read-only page, hidden by switch) | — | E-D07 |
| **audit K-01** KPI committee | ACCURATE (`kpi_policy_enforced=0`; imported rules seeded `proposed`, `db/postgres/reports/065_kpi_policies.sql:6`) | **HUMAN** (members, quorum, gate 11); code DONE (C-31: author ≠ adopter enforced, `committee_ref` required, immutable adopted versions) | Agent-preparable: charter + PV template that maps to `kpi_policy_decisions.committee_ref` | E-K01 |
| **audit K-02** Certify SLA/change/score formulas | PARTLY (parity tests exist: `report-figures-parity`, `site-fold-sla-definition`, `dashboard-shared-sla-rates`, `kpi-policy-engine` reproduces today's SLA rules; score fidelity tests) | **HUMAN** (approval) + BUILD (formula reference sheet) | Divergent windows across layers are documented (CLAUDE.md doctrine) but not in one certifiable sheet | E-K01 |
| **audit K-03** Versioned metric contract | PARTLY → mostly DONE (`kpi_policies`: version, effective_from/to, owner, rationale, min_sample, null_handling 'unknown', immutable when adopted) | **DONE** (versioning) + BUILD (freshness/granularity in the lineage sheet) | `metric_registry` itself has no version column — the policy table is the versioned contract; say so in the sheet | E-D05 |
| **audit K-04** Non-homogeneous comparisons | PARTLY (C-05: partial periods, `previous.comparable=false` when partial — `services/dashboardData.js:142-148`; `partialNote`) | **BUILD-SHADOW** (sample size `n` + "low sample" from an adopted policy's `min_sample`) | No observation count shown; legacy pages (index.html, executive*) not on the renderer | E-K02 |
| **audit K-05** Red KPI → action | ACCURATE (renderer has no link from a red tile/cell to an action; only a separate `actions` widget, `dashboardRender.js:170`) | **BUILD-SHADOW** | `commitment_source_links` (021) already models origin links → no migration | E-K03 |
| **audit K-06** 10 unreferenced metrics | ACCURATE | **HUMAN** (committee: use / archive / reserve) + BUILD (one decision sheet each) | — | E-D05 |
| **audit K-07** Variation explanation | ACCURATE (nothing decomposes a delta) | **BUILD-SHADOW** | Deterministic contribution by site/group/category, "measured — no cause claimed" | E-K04 |
| **audit K-08** Direction notes | PARTLY (editorial stores `exec_view_editorial`, `exec_report_editorial`; deterministic Analyze Lite) | **BUILD-SHADOW** (generated, labelled data note, separate from editorial) | Analyze Lite text is not labelled "generated" in the deck | E-K04 |
| **audit U-01** Real usability test | ACCURATE | **HUMAN** (gate 6) — protocol DONE (`docs/ops/USABILITY-TEST-PROTOCOL.md`, `pilot/T1-T8-SHEET.csv`, `SUS-FORM.md`) + BUILD (scoring tool) | No tool turns the filled sheet into success rate / time / errors / SUS | E-U01 |
| **audit U-02** Five exec surfaces | ACCURATE | **DONE** (prep: C-09 `page_viewed` + `/api/ux/page-usage` `routes/pageUsage.js:50`, `docs/ux/EXEC-PAGES-MATRIX.md`, C-28 `ui_exec_nav`) + HUMAN (decision after 30 days — gate 16) | — | — |
| **audit U-03** Business homes | PARTLY (`public/home.html` "My work", `/api/me/work` `routes/myWork.js:18`) | **HUMAN** (discovery tests first) — later BUILD-SHADOW | Building role homes before U-01 evidence = designing by guess | — (deferred) |
| **audit U-04** Page anatomy | ACCURATE (`pageHead` on 4 of 57 pages: analytics, dashboards, infra-health, wan) | **BUILD** (additive read-only header, C-10 precedent) | index.html / reports.html left out (hot spots) | E-U03 |
| **audit U-05** Filters in URL | ACCURATE (`analytics.html`: no `URLSearchParams`/`replaceState`; index.html neither) | **BUILD-SHADOW** (`ui_url_filters` via `services/uiPolicy` UI_KEYS) | G18 PARTIAL | E-U02 |
| **audit U-06** Fewer forms/confirms | PARTLY (vague; no measured error data) | **HUMAN** first (U-01 evidence to target) | reports.html is the hot spot; no goal until the UAT names the costly steps | — (deferred) |
| **audit U-07** Sub-page navigation | PARTLY — the **29 is overstated** (**X-UX-01**) | **BUILD** (reachability map + dead-end test) | `tools/agent/inventory.js:64,76` counts only `_shell.js` hrefs; ≥ 12 of the 29 are reachable from `public/module-tabs.js` | E-U04 |
| **audit U-08** Screen reader | ACCURATE | **HUMAN** (gate 7) + BUILD (session script) | C-07 static/automatic a11y tests exist | E-U01 |
| **audit U-09** Contextual onboarding | ACCURATE | **BUILD-SHADOW** (P2) — deferred until U-01 names where people stall | — | — (deferred) |
| **audit U-10** FR terminology | PARTLY (glossary PROPOSED; `tests/i18n-shell-charts.test.js` enforces it on `public/lib/i18n/*.fr.js` dictionary keys only) | **HUMAN** (francophone review, gate 17) + BUILD (extend the check to inline `data-lng="fr"` spans) | — | E-U05 |

**Counts (primary class, 37 actions):** DONE 4 (S-06, D-05, K-03, U-02) · BUILD 4 (D-02, D-07, U-04, U-07) ·
BUILD-SHADOW 15 (S-02, S-04, S-05, S-07, S-08, D-03, D-04, D-06, D-09, K-04, K-05, K-07, K-08, U-05, U-09) ·
HUMAN 14 (S-01, S-03, S-09, S-10, D-01, D-08, K-01, K-02, K-06, U-01, U-03, U-06, U-08, U-10) · OUT 0.
Nearly every HUMAN line has an agent-preparable BUILD item (column "Goal").

---

## (b) Findings the audit missed

| Id | Finding | Evidence | Severity | Handled by |
|---|---|---|---|---|
| **X-SEC-01** | The **server-to-server dash key is injected as `window.__ak` into 5 pages for any valid session** (viewer included): `server.js:1341-1342`, pages `executive`, `index`, `analytics`, `reports`, `executive-report` (`server.js:1356-1412`). A signed-in viewer can copy it and call the 16 key-only routes headless (no cookie, no Origin) — the call is logged as actor `dash-key`, not as the user, and keeps working after the user is disabled. The injection looks **redundant**: in a browser the session cookie already passes the gate (`browserContext` → `validateSession`, `server.js:1097-1112`). | code | Medium (aggregates only; attribution + revocation gap) | E-S02 (switch `ui_inject_dash_key`, default `1` = today) |
| **X-SEC-02** | Password hash stores no work factor (`hashPassword` constant 100 000, `reports-db.js:320-321`; no column) — raising PBKDF2 iterations requires a schema change, not a constant edit (would lock every user out). | code | Low (blocks S-08) | E-S05 |
| **X-SEC-03** | `server.js` is at **7 908 / < 7 910**: any security/route goal that adds a line fails `tests/server-size-budget.test.js`. The site CRUD block (`server.js:5781-5860`, ~80 lines) is a natural extraction to free budget. | `wc -l`, budget test | Planning | E-D02 does the extraction first |
| **X-DATA-01** | Shared-code detection (our D-01) names sites but nothing helps the owner **split existing `TND` rows**; once a code is attributed, the other site's history stays under the wrong scope. | `services/siteCodeShared.js` (detect only) | Medium (integrity of Assafo/Tanda history) | E-D01 |
| **X-DATA-02** | The registry switch has no observation mode: turning `site_codes_from_registry` on changes every module lookup at once (no double read). | `services/siteCodeRegistry.js:12-27` | Medium | E-D01 |
| **X-UX-01** | INVENTORY "pages not in navigation: 29" ignores `public/module-tabs.js` (meetings ×9, inspections ×3, site-actions) and in-page links — the audit's U-07 inherits the inflated figure. 6 pages are "role UNKNOWN" (inventory can't read their guard; their APIs are session-gated). | `tools/agent/inventory.js:64,76`; `public/module-tabs.js` hrefs | Low (misleading evidence) | E-U04 |
| **X-DOC-01** | Our own D-xx ids collide with the audit's D-xx (and A/B). Any future table must prefix. | this file | Process | convention adopted here |

---

## (c) Goals, dependencies and hot spots

| Goal | Title | Size | Closes | Switch (default = today) | Files (hot spots in **bold**) | Depends on |
|---|---|---|---|---|---|---|
| E-S01 | Capability enforcement per allow-list | M | audit S-04 | `authz_enforce_caps` (`''`) | `services/authzShadow.js`, `services/reportConfig.js`, `tools/security/authz-divergence-report.js`, tests | — |
| E-S02 | Dash-key consumer inventory, key-only scope, stop shipping the key to browsers | S | audit S-02, X-SEC-01 | `dashkey_scope_mode` (`open`), `dashkey_allowed_routes` (`''`), `ui_inject_dash_key` (`1`) | new `services/dashKeyScope.js`, **`server.js`** (gate + inject lines, net ≤ 0), `tools/security/dashkey-consumers.js`, tests | E-D02 (frees server.js budget) |
| E-S03 | Access recertification campaign + orphan accounts (shadow) | M | audit S-05 | `access_recert_enabled` (`0`), `access_recert_apply` (`0`) | `routes/access.js`, `services/accessStore.js`, new `services/accessRecert.js`, `public/access.html`, new reports migration (number from plan owner) | — |
| E-S04 | Entra leaver dry-run job | S | audit S-07 (code part) | `entra_deprovision_enabled` (`0`), `entra_deprovision_apply` (`0`) | new `services/entraDeprovision.js`, `services/sync/jobs.js`, tests | — (inert without Graph consent) |
| E-S05 | Password work-factor upgrade path | S | audit S-08 (hash part), X-SEC-02 | `auth_pbkdf2_iterations` (`100000`) | **`reports-db.js`** (auth block only), new reports migration, tests | E-D02 / E-D03 (same file — run after) |
| E-S06 | Security human-gate preparation pack | S | prep for audit S-01, S-03, S-06, S-09, S-10 | — (docs + read-only tool) | `docs/security/*` (new), `tools/security/retention-inventory.js`, `docs/ops/RETENTION-INVENTORY.md` | — |
| E-D01 | Shared-code split report + registry shadow double-read | M | audit D-01 (prep), D-03, X-DATA-01/02 | `site_codes_from_registry` gains value `shadow` (default stays `0`) | `services/siteCodeRegistry.js`, new `tools/sites/shared-code-report.js`, tests | — |
| E-D02 | Site master fields (country, time zone) + site routes extraction | M | audit D-02, D-04 (admin field), X-SEC-03 | — (correction of a known limit; editing is super_admin) | **`server.js`** (remove ~80 lines), new `routes/sites.js`, **`reports-db.js`** (`updateSite`), **`public/reports.html`** (site card) | first in the server.js / reports-db.js chain |
| E-D03 | Local calendar for the remaining site-window readers | M | audit D-04 | `site_local_calendar` (`0`, existing) | **`reports-db.js`**, `services/siteTimeZone.js`, tests | E-D02 |
| E-D04 | Sync content-drift detector (shadow) | S | audit D-06 | `sync_drift_alerts` (`0`) | new `services/sync/drift.js`, `routes/sync.js`, `services/sync/alerts.js`, tests | — |
| E-D05 | Metric lineage & contract sheet + decision sheets for the 10 unreferenced metrics | S | audit D-07, K-03 (rest), K-06 (prep) | — (generated doc) | new `tools/agent/metric-lineage.js`, `docs/ops/METRIC-LINEAGE.md`, test | — |
| E-D06 | Operator-run anonymiser + synthetic multi-country fixture | M | audit D-08 (prep) | — (tools/tests only) | new `tools/data/anonymize-snapshot.js`, `tests/fixtures/reference-org/*`, tests | — |
| E-D07 | Data-quality board (read-only, hidden) | M | audit D-09 | `ui_data_quality_page` (`0`) | new `services/dataQuality.js`, new `routes/dataQuality.js`, new `public/data-quality.html`, **`server.js`** (append to existing `_htmlCache` list line, no new line) | E-D04 (drift signal), E-D02 |
| E-K01 | KPI committee charter + formula reference sheet | S | audit K-01, K-02 (prep) | — (docs) | `docs/kpi/` (new) | E-D05 (links to lineage) |
| E-K02 | Sample size and low-sample warning on dashboards | S | audit K-04 | `ui_kpi_sample_size` (`0`) | `services/dashboardData.js`, `public/lib/dashboardRender.js`, tests | — |
| E-K03 | Red KPI → open / create the linked action | M | audit K-05 | `dashboard_red_action_links` (`0`) | `public/lib/dashboardRender.js`, `routes/commitments.js`, `services/commitment*.js`, tests | E-K02 (same renderer) |
| E-K04 | Deterministic variation explanation + labelled data note | M | audit K-07, K-08 | `metric_explain_enabled` (`0`) | new `services/variationExplain.js`, `routes/metrics.js`, tests | — |
| E-U01 | Usability scoring tool + screen-reader session script | S | audit U-01, U-08 (prep) | — (tool/docs) | new `tools/pilot/usability-score.js`, `docs/ops/pilot/SCREEN-READER-SCRIPT.md`, tests | — |
| E-U02 | Analytics filters persisted in the URL | S | audit U-05 (G18) | `ui_url_filters` (`0`) via `services/uiPolicy` | `public/analytics.html`, `services/uiPolicy.js`, tests | — |
| E-U03 | Page header rollout (non-hot pages) | M | audit U-04 | — (additive, C-10 precedent) | `public/{home,site-actions,wan-sla,assets,meetings,inspections}.html`, `public/lib/pageHead.js` (read only), tests | — |
| E-U04 | Page reachability map + dead-end guard | S | audit U-07, X-UX-01 | — (generated doc + test) | `tools/agent/inventory.js`, `docs/agent-execution/INVENTORY.md`, test | — |
| E-U05 | FR glossary check on inline `data-lng="fr"` spans | S | audit U-10 (prep) | — (test only) | `tests/i18n-shell-charts.test.js` or new test, `docs/ux/GLOSSARY-FR.md` (add "à éviter" column, PROPOSITION) | — |

**Hot-spot ordering.** `server.js` (2 lines of budget): **E-D02 → E-S02 → E-D07** (E-D02 extracts the site routes and
frees ~75 lines). `reports-db.js`: **E-D02 → E-D03 → E-S05**. `public/reports.html`: E-D02 only. `public/lib/dashboardRender.js`:
**E-K02 → E-K03**. `services/reportConfig.js` DEFAULTS: E-S01, E-S02, E-S03, E-S04, E-S05, E-D04, E-K02, E-K03, E-K04
each add keys — trivial merge conflicts; append in separate blocks. `public/index.html`: no goal here. New migrations
(E-S03, E-S05): numbers allocated by the plan owner (next free after 066 on reports; check the other modules' series).
Every switch added → one row in `docs/ops/pilot/PILOT-PROFILE.md` and a regenerated `docs/ops/FLAG-REGISTER.md`
(`tests/flag-register.test.js`).

Parallel waves (no shared hot file inside a wave):
- **Wave 1:** E-D02, E-S01, E-S03, E-S04, E-S06, E-D01, E-D04, E-D05, E-D06, E-K02, E-K04, E-U01, E-U02, E-U03, E-U04, E-U05
- **Wave 2:** E-S02, E-D03, E-K01, E-K03
- **Wave 3:** E-S05, E-D07

---

## (d) /goal prompts

Common CONTEXT for every prompt below (paste it with each goal):
> CONTEXT  Expert audit of 5 Nov 2026 (rev `d38fa41`), cross-checked in
> `docs/audits/2026-11-05-expert-audit/CROSSCHECK-1-SDKU.md` (your goal row is in §(c); the claim verification and
> proof for each item you close are in §(a)/§(b) — search the audit id). Audit ids are written "audit S-04" to avoid
> clashing with our own D-xx/A-xx. Line numbers drift: locate by content. `server.js` must stay < 7 910 lines
> (`tests/server-size-budget.test.js`).

Common GUARDRAILS (part of every prompt):
> GUARDRAILS  `.claude/rules/SDP360_BOUNDARIES.md`; PostgreSQL only (no sqlite path — removed by PO-08); no
> new external connector; no fabricated approval, owner, production data, threshold or rate; null = UNKNOWN, never
> 0/green; `httpError.fail` for every error response; await-precedence (`(await f()).x`); every new switch defaults to
> today's behaviour, gets a `PILOT-PROFILE.md` row marked PROPOSITION and a regenerated `FLAG-REGISTER.md`; no
> push/merge, no live-system action.

---

### E-S01 — Capability enforcement per allow-list (audit S-04)

```
/goal — SDP360 / E-S01 Capability enforcement per allow-list
CONTEXT  (common context) + docs/agent-execution/C-17.md §"Enforce plan" step 2 is the specification.
MISSION  Wire `enforce` in services/authzShadow.js ONLY for capabilities listed in a new report_config key
  `authz_enforce_caps` (comma list, default '' = no capability enforced = today). For a listed capability the
  decision of authorizationService.can() answers the request (allow → next, deny → 403 via httpError.fail with
  reason_code, plus one system_log row category 'authz' action 'authz_enforce_denied', actor id only). Unlisted
  capabilities and mode off/shadow behave exactly as today. Refuse (ignore + warn once) a `critical` capability
  in the list while access grants (C-18) are off. Add tools/security/authz-divergence-report.js: reads
  system_log category authz for N days, groups divergences by capability/route, prints a markdown summary
  (no user names) — the input to R6's "2 weeks without unexplained divergences".
METHOD   Failing tests first: (1) mode enforce + empty list = identical answers to shadow on the route matrix;
  (2) a listed low-risk read capability (e.g. review.read) refuses a role the catalogue denies and logs once;
  (3) a listed critical capability is ignored with a warning; (4) off/shadow unchanged. Then code; then neighbours
  authz-route-matrix, capability-registry, access-why.smoke, sec01-route-roles.smoke, flag-register.
DONE     docs/agent-execution/E-S01.md: verdict table (audit S-04 → FIXED-behind-switch/PARTIAL), test names +
  file:line, the report tool's sample output on a throwaway DB. Left for a person: choosing the first capabilities
  and switching mode to enforce (Security owner, after the shadow period).
FILES    services/authzShadow.js, services/reportConfig.js (DEFAULTS), tools/security/authz-divergence-report.js,
  tests/authz-enforce.test.js (+ smoke). Do not touch server.js.
GUARDRAILS  (common guardrails); enforce must never widen access: a listed capability may only refuse what the
  legacy guard would also refuse OR what can() refuses with a logged reason — test it.
```

### E-S02 — Dash-key consumer inventory, key-only scope, no key in browsers (audit S-02, X-SEC-01)

```
/goal — SDP360 / E-S02 Dash-key consumers, key-only scope, stop shipping the key to browsers
CONTEXT  (common context). Run AFTER E-D02 (it frees server.js line budget).
MISSION  (1) tools/security/dashkey-consumers.js: from system_log action 'dashkey_call' over N days, list route ×
  source (IP + user-agent) × days seen → markdown for the integration owner (D-15). (2) New services/dashKeyScope.js
  with report_config `dashkey_scope_mode` = open (default, today) | shadow (log a would-be refusal for a route not in
  `dashkey_allowed_routes`) | restrict (refuse it with 401). Move the existing dashkey_call logging block out of the
  /api/ gate into this service so server.js shrinks. (3) `ui_inject_dash_key` = '1' (today) | '0' = sendHtmlPage no
  longer injects window.__ak; prove every page that used it still loads its data with the session cookie alone.
METHOD   Failing tests first: dashkey-only-routes smoke extended (restrict refuses an unlisted key-only route,
  open/shadow unchanged, shadow logs once/day); api-key-injection smoke extended (switch 0 → no window.__ak even
  with a session; index/analytics/reports/executive/executive-report data calls succeed with the cookie only).
  Run the e2e journeys once with ui_inject_dash_key=0 and record the result.
DONE     docs/agent-execution/E-S02.md (verdict per item, test names, e2e result with the switch at 0, the consumer
  report on a throwaway DB). Left for a person: naming each consumer, a dedicated key/quota per consumer, choosing
  restrict and ui_inject_dash_key=0 (integration owner + Security owner).
FILES    services/dashKeyScope.js (new), server.js (gate + sendHtmlPage lines; net line count ≤ 0),
  services/reportConfig.js, tools/security/dashkey-consumers.js, tests/dashkey-only-routes.smoke.test.js,
  tests/api-key-injection.smoke.test.js.
GUARDRAILS  (common guardrails); the key value is never logged or printed; restrict never applies to a browser
  (cookie/Origin) request.
```

### E-S03 — Access recertification campaign + orphan accounts (audit S-05)

```
/goal — SDP360 / E-S03 Access recertification campaign (shadow)
CONTEXT  (common context) + docs/agent-execution/C-18.md (requests, approvals, grant expiry exist; campaign missing).
MISSION  A super_admin opens a campaign (scope: all or one site); each in-scope account × role × site becomes a
  review line assigned to the approver resolved by services/accessApproverPolicy.js (rule R7, never the subject);
  the approver answers keep / revoke / unknown with a reason; the campaign shows progress and an "orphans" list
  (no login for N days — N from config, active editor without a site, holder of an inactive site, account with a
  role no template grants). `access_recert_enabled` '0' hides the feature; `access_recert_apply` '0' means a revoke
  answer is recorded only — '1' applies it through the existing role-change path with an audit row. Nothing
  auto-revokes.
METHOD   Migration first (number from plan owner, additive, idempotent, PostgreSQL only),
  failing tests (campaign lifecycle, approver ≠ subject, revoke recorded-not-applied at apply=0, applied at 1 with
  audit, orphans list never counts a null last-login as "old" — null = UNKNOWN shown as such), route smoke, then
  the access.html card.
DONE     docs/agent-execution/E-S03.md with verdict table, tests, screenshots-free description of the card. Left for
  a person: running the first campaign, signing it, choosing N and apply=1 (Security owner + site managers).
FILES    db/postgres/reports/0NN_access_recert.sql, services/accessRecert.js (new, pure core), services/accessStore.js,
  routes/access.js, public/access.html, services/reportConfig.js, tests.
GUARDRAILS  (common guardrails); no change to existing grants unless apply=1; no HR connector (decision R9).
```

### E-S04 — Entra leaver dry-run job (audit S-07)

```
/goal — SDP360 / E-S04 Entra leaver dry-run job
CONTEXT  (common context) + SEC-01 F7 (recommended shape: nightly job behind entra_deprovision_enabled='0', inert
  without SSO config, dry-run first). Graph consent (User.Read.All) is human gate 2 — NOT granted.
MISSION  services/entraDeprovision.js: for active local accounts linked to an Entra object (entra_oid), ask Graph
  whether the object is disabled/deleted; produce a dry-run list (account, linked oid, Graph state, would
  deactivate yes/no). Registered in services/sync/jobs.js; does nothing unless `entra_deprovision_enabled`='1' AND
  the SSO settings resolve ready; deactivation (existing user-deactivate path, which already kills sessions) only
  when `entra_deprovision_apply`='1'. A Graph 403/401 = "consent missing" status, never a deactivation. Break-glass
  account never touched.
METHOD   Failing tests with an injected Graph transport stub: disabled user listed, apply=0 changes nothing, apply=1
  deactivates + logs, 403 → consent_missing, break-glass skipped, no SSO config → job skipped. Then code.
DONE     docs/agent-execution/E-S04.md. Left for a person: tenant consent decision, measured revocation delay on TEST.
FILES    services/entraDeprovision.js (new), services/sync/jobs.js, services/reportConfig.js, tests/entra-deprovision.test.js.
GUARDRAILS  (common guardrails); no new permission requested by code; no call at all while the switch is 0.
```

### E-S05 — Password work-factor upgrade path (audit S-08, X-SEC-02)

```
/goal — SDP360 / E-S05 Password work-factor upgrade path
CONTEXT  (common context). Run after E-D02 and E-D03 (same file reports-db.js).
MISSION  Add an additive `password_iterations` column (NULL = 100000, the value every existing hash was made with).
  passwordMatches() uses the stored count; on a successful password login, if the stored count is below
  `auth_pbkdf2_iterations` (default '100000' = today → no rehash), rehash with the target and store it. Unknown-user
  timing stays constant (dummy hash at the target count). Password set/reset paths store the target count.
METHOD   Migration first (number from plan owner), failing tests: legacy row (NULL) still logs in; with target 210000
  a login rehashes once and the next login uses 210000; wrong password never rehashes; default leaves hashes
  untouched; sso-login, login-account-throttle.smoke neighbours green.
DONE     docs/agent-execution/E-S05.md with a measured login time at 100k vs 210k on the sandbox. Left for a person:
  the target value (crypto review), throttle activation (gate 14).
FILES    reports-db.js (auth block only: hashPassword/passwordMatches/createUser/changePassword), new migration,
  services/reportConfig.js, tests/password-work-factor.test.js.
GUARDRAILS  (common guardrails); no forced password reset; no plaintext or hash ever logged.
```

### E-S06 — Security human-gate preparation pack (prep for audit S-01, S-03, S-06, S-09, S-10)

```
/goal — SDP360 / E-S06 Security human-gate preparation pack
CONTEXT  (common context) + docs/security/EX-01-CREDENTIAL-INCIDENT.md, THREAT-MODEL.md, docs/ops/AUTHZ-MATRIX.md,
  docs/agent-execution/C-22.md, D-070910.md, services/softDelete.js, services/reportConfig.js (A-19 block).
MISSION  Write, all marked PROPOSITION / TO BE FILLED BY A PERSON: (1) docs/security/ROTATION-RECORD.md — one row
  per cluster (owner, change ref, date, operator, pg_hba reviewed, superuser-login log reviewed, history decision
  A/B/C) — no value ever; (2) docs/security/PENTEST-SCOPE.md — rules of engagement + scenarios (object-level API
  scope from AUTHZ-MATRIX, SSO, field outbox, exports/share links, key-only routes, emergency access, CSP gaps A-28);
  (3) docs/security/EMERGENCY-ACCESS-DRILL.md — TEST drill steps with the expected system_log rows; (4)
  docs/security/DEPARTMENT-VISIBILITY-DRAFT.md — every table carrying a department column, who can read it today,
  and the questions the data owners must answer (no rule invented; PO R4 recorded); (5)
  tools/security/retention-inventory.js generating docs/ops/RETENTION-INVENTORY.md from code (object → table →
  today's deletion/expiry behaviour → config key → owner UNKNOWN) with --check and a test.
METHOD   Test for the generator first (--check fails when stale; every table listed in softDelete.TABLES appears).
DONE     docs/agent-execution/E-S06.md listing each document and which human gate it serves.
FILES    docs/security/* (new), tools/security/retention-inventory.js, docs/ops/RETENTION-INVENTORY.md,
  tests/retention-inventory.test.js.
GUARDRAILS  (common guardrails); no durations, approvers or legal holds invented — empty cells say UNKNOWN.
```

### E-D01 — Shared-code split report + registry shadow double-read (audit D-01 prep, D-03, X-DATA-01/02)

```
/goal — SDP360 / E-D01 Shared-code split report + registry shadow double-read
CONTEXT  (common context) + docs/agent-execution/D-0102.md, services/siteCodeShared.js, services/siteCodeRegistry.js.
MISSION  (1) tools/sites/shared-code-report.js (read-only, dry run): for each module code shared by ≥ 2 active sites
  (sharedAmong), list the stored rows under it per module (tracker entries by year/activity, meetings/inspection
  rows), and for each the last writer from system_log (tracker_entries_saved, saves) with that writer's site(s) —
  "attributable to site X / unknown". Markdown output for the data owner; never writes. (2) siteCodeRegistry accepts
  `site_codes_from_registry`='shadow': lookups still answer from the hard maps but also compute the registry answer
  and log a divergence (system_log category governance, once/day per site×module); '0' and '1' unchanged.
  PUT /api/governance/site-codes accepts 'shadow' with the same reason rule.
METHOD   Failing tests: report on a fixture with Assafo+Tanda→TND splits rows by writer site and marks unknowns;
  shadow mode answers like '0' and logs a divergence once; '1' unchanged; site-code-onboarding,
  uat-amdec-org-models.smoke neighbours.
DONE     docs/agent-execution/E-D01.md. Left for a person: choosing the owner of TND (gate 9), applying a split,
  switching the registry (gate 10).
FILES    tools/sites/shared-code-report.js (new), services/siteCodeRegistry.js, routes/policies.js (accept value),
  services/reportConfig.js, tests.
GUARDRAILS  (common guardrails); nothing is re-attributed automatically; production data stays on the operator's box.
```

### E-D02 — Site master fields + site routes extraction (audit D-02, D-04 field, X-SEC-03)

```
/goal — SDP360 / E-D02 Site master fields (country, time zone) + site routes extraction
CONTEXT  (common context). FIRST goal on server.js / reports-db.js / reports.html — others wait for it.
MISSION  (1) Move GET/PUT/POST/DELETE /api/reports/sites* (server.js ~5781-5860) verbatim into routes/sites.js
  (factory pattern of routes/inspection.js) — no behaviour change. (2) updateSite accepts `country` (ISO-3166 alpha-2)
  and `time_zone` (validated with Intl.DateTimeFormat; invalid → 400); writes are audited (before/after). (3) The
  site admin card in reports.html shows and edits both, plus the onboarding checklist link. (4) A "site master"
  JSON/CSV export (super_admin) listing id, name, codes per module, country, time zone, currency from
  asset_site_currency, Zoho group, active.
METHOD   Failing tests first: route parity (same status/payload before and after the move — copy existing site route
  smokes), invalid tz 400, valid tz stored and read by site-time-zone; html-pages-before-static, server-size-budget.
DONE     docs/agent-execution/E-D02.md with server.js line count before/after. Left for a person: entering each site's
  real country/time zone (Owner + Finance, gate 8).
FILES    server.js (remove block, add one app.use line), routes/sites.js (new), reports-db.js (updateSite only),
  public/reports.html (site card only), tests.
GUARDRAILS  (common guardrails); no default time zone guessed for any site; a null time zone keeps today's UTC path.
```

### E-D03 — Local calendar for the remaining site-window readers (audit D-04)

```
/goal — SDP360 / E-D03 Local calendar for the remaining site-window readers
CONTEXT  (common context) + docs/agent-execution/D-070910.md (D-07 covers only getCalendarMonthlyHelpdesk).
  After E-D02.
MISSION  Behind the existing `site_local_calendar` ('0' = UTC today), bucket on the site's local date in: the monthly
  Top-10, the weekly site-report window, the 6-month helpdesk history — reusing services/siteTimeZone.js. Each
  response carries the zone used. WAN SLA keeps its own service calendar (out of scope).
METHOD   Failing tests per reader: London (Europe/London, BST) vs Dakar (Africa/Dakar) tickets on a month/week edge
  land in the local bucket at '1' and the UTC bucket at '0'; pg-reports-aggregates, site-time-zone neighbours.
DONE     docs/agent-execution/E-D03.md. Left for a person: gate 8.
FILES    reports-db.js (the three readers), services/siteTimeZone.js, tests.
GUARDRAILS  (common guardrails); switch at '0' must be byte-identical to today (golden/pptx fingerprint green).
```

### E-D04 — Sync content-drift detector (audit D-06)

```
/goal — SDP360 / E-D04 Sync content-drift detector (shadow)
CONTEXT  (common context) + services/sync/{jobs,syncStore,alerts}.js, routes/sync.js.
MISSION  services/sync/drift.js (pure): from the last N successful sync_runs of a job, flag `drop` (rows < X % of the
  rolling median), `spike` (> Y %), `zero_after_history`, `duplicates_rate` above Z %; fewer than 5 runs = UNKNOWN
  (never "ok"). /api/sync/health gains a `drift` field per job. Alerts go out through the existing alert path only
  when `sync_drift_alerts`='1'; thresholds X/Y/Z are config keys marked PROPOSITION.
METHOD   Failing tests (pure core on fixtures, health route smoke field present, alert not sent at '0').
DONE     docs/agent-execution/E-D04.md. Left for a person: thresholds and the owner per flow.
FILES    services/sync/drift.js (new), routes/sync.js, services/sync/alerts.js, services/reportConfig.js, tests.
GUARDRAILS  (common guardrails); detection never blocks or rolls back a sync.
```

### E-D05 — Metric lineage & contract sheet (audit D-07, K-03 rest, K-06 prep)

```
/goal — SDP360 / E-D05 Metric lineage & contract sheet
CONTEXT  (common context) + services/metricRegistry.js SEED, tools/agent/metric-map.js, db 065 kpi_policies.
MISSION  tools/agent/metric-lineage.js → docs/ops/METRIC-LINEAGE.md (generated, --check): one sheet per metric —
  key, names, unit, module, source (reader + field + code file), formula, window kind, RAG policy, higher-is-better,
  owner_role, certification text, consumers (from the metric map), "versioned contract: kpi_policies (adopted version
  read at run time — not in this file)", freshness = the sync job feeding it (from services/sync/jobs.js FRESHNESS)
  or UNKNOWN. For the 10 metrics with no direct reference, a decision block "use / archive / reserve — PENDING KPI
  committee" with no answer filled.
METHOD   Test first: --check stale detection; every SEED key has a sheet; the 10 unreferenced keys carry the pending block.
DONE     docs/agent-execution/E-D05.md.
FILES    tools/agent/metric-lineage.js (new), docs/ops/METRIC-LINEAGE.md, tests/metric-lineage.test.js,
  docs/agent-execution/EVIDENCE-MANIFEST.md regenerated if required.
GUARDRAILS  (common guardrails); no decision, owner name or certification written for the committee.
```

### E-D06 — Operator-run anonymiser + synthetic fixture (audit D-08 prep)

```
/goal — SDP360 / E-D06 Operator-run anonymiser + synthetic multi-country fixture
CONTEXT  (common context) + tests/.skip-allowlist.json ("no prod-snapshot" ×10), tests/review-data.test.js.
MISSION  (1) tools/data/anonymize-snapshot.js: run BY AN OPERATOR on a copy of the databases; replaces people names,
  e-mails, subjects/free text, ticket ids (stable keyed pseudonyms, key from env, never printed), keeps structure,
  dates, statuses, codes, currencies; prints a residual-PII check (regex scan of e-mails/phones) and refuses to finish
  if anything remains. (2) tests/fixtures/reference-org/: a generated synthetic dataset (5 countries, multi-site,
  2 currencies, London BST site, statuses, partial month) + a test exercising review-data / site-window readers'
  SHAPE on it (not fidelity — the 10 skips stay until the data owner approves an anonymised extract).
METHOD   Tests first for the anonymiser on a synthetic DB (no residual e-mail, stable pseudonym, refuses on leak).
DONE     docs/agent-execution/E-D06.md. Left for a person: running the tool on real data and approving the extract.
FILES    tools/data/anonymize-snapshot.js (new), tests/fixtures/reference-org/*, tests/anonymize-snapshot.test.js,
  tests/reference-org-shape.test.js.
GUARDRAILS  (common guardrails); the agent never opens production data; the tool never sends data anywhere.
```

### E-D07 — Data-quality board (audit D-09)

```
/goal — SDP360 / E-D07 Data-quality board (read-only, hidden)
CONTEXT  (common context). After E-D04 (drift signal) and E-D02 (server.js budget).
MISSION  services/dataQuality.js composes existing signals per source × site: freshness and drift (sync health),
  duplicates (sync_runs), asset hygiene completeness, site-code disagreements (registry diff), money coverage,
  unmapped Risk-Register site labels. Each cell = value + status (ok / warn / UNKNOWN) + "where to fix" link.
  routes/dataQuality.js serves GET /api/data-quality (admin tier) and data-quality.html (via deps.sendHtmlPage);
  `ui_data_quality_page`='0' hides the nav entry and returns 404 for the page.
METHOD   Failing tests (pure composition with a missing source → UNKNOWN, route smoke admin 200 / viewer 403,
  switch 0 → 404), then page.
DONE     docs/agent-execution/E-D07.md. Left for a person: stewards per source.
FILES    services/dataQuality.js, routes/dataQuality.js, public/data-quality.html (new), server.js (add the page name
  to the existing _htmlCache list line and the router to an existing app.use line — no new line), tests.
GUARDRAILS  (common guardrails); no score invented for a source with no data.
```

### E-K01 — KPI committee charter + formula reference sheet (audit K-01, K-02 prep)

```
/goal — SDP360 / E-K01 KPI committee charter + formula reference sheet
CONTEXT  (common context) + C-31 (kpi_policies, kpi_policy_decisions.committee_ref), CLAUDE.md "KPI denominator
  doctrine", docs/ux/EXEC-PAGES-MATRIX.md, E-D05 METRIC-LINEAGE.md.
MISSION  docs/kpi/COMMITTEE-CHARTER.md (PROPOSITION: mandate, roles, quorum placeholder, author ≠ adopter — cite the
  code that enforces it, decision record = committee_ref format, publication/effect date) and docs/kpi/PV-TEMPLATE.md;
  docs/kpi/FORMULA-REFERENCE.md: resolution SLA, first-reply SLA, change success, site score (sbDims) and composite —
  numerator, denominator, exclusions, window per layer (screen / API / PPTX / e-mail) with file:line and the parity
  test proving each pair; every divergence listed, none resolved.
METHOD   A doc test that every file:line cited exists and every parity test named exists.
DONE     docs/agent-execution/E-K01.md. Left for a person: members, quorum, adoption (gate 11).
FILES    docs/kpi/* (new), tests/kpi-docs-links.test.js.
GUARDRAILS  (common guardrails); no threshold or formula declared approved.
```

### E-K02 — Sample size and low-sample warning (audit K-04)

```
/goal — SDP360 / E-K02 Sample size and low-sample warning on dashboards
CONTEXT  (common context) + services/dashboardData.js (C-05 partial/comparable), public/lib/dashboardRender.js.
MISSION  Where a reader returns a denominator (closed, responded, applicable findings, tickets), dashboardData adds
  `n` to kpi/ragGrid cells and series points. With `ui_kpi_sample_size`='1' the renderer shows "n = …" and, when an
  ADOPTED kpi_policy for the metric sets min_sample and n < min_sample, "low sample — not comparable" and no
  delta. No adopted policy → no warning (never invent a minimum). '0' renders as today.
METHOD   Failing tests: n present in data; renderer at '0' byte-identical; at '1' shows n; low-sample only with an
  adopted policy; dashboard-time-truth, dashboard-widget-truth, chart-a11y neighbours.
DONE     docs/agent-execution/E-K02.md.
FILES    services/dashboardData.js, public/lib/dashboardRender.js, services/uiPolicy.js (UI key), tests.
GUARDRAILS  (common guardrails).
```

### E-K03 — Red KPI → open / create the linked action (audit K-05)

```
/goal — SDP360 / E-K03 Red KPI → linked action
CONTEXT  (common context) + db 021 commitments / commitment_source_links. After E-K02 (same renderer).
MISSION  With `dashboard_red_action_links`='1', a red kpi tile / ragGrid cell shows "Open actions (k)" (existing open
  commitments linked by commitment_source_links source_system='metric', source_id='<metric>|<site_id>|<window>') and,
  for a user allowed to create commitments on that site, "Create action" opening the existing commitment form
  prefilled (title, site, metric link). The create route refuses a duplicate open link (409 naming it). Grey/UNKNOWN
  cells never offer the link.
METHOD   Failing tests: link source_id format, duplicate refused, site scope enforced (viewer of another site 403),
  UNKNOWN cell has no link, switch 0 unchanged; commitments route smokes.
DONE     docs/agent-execution/E-K03.md.
FILES    public/lib/dashboardRender.js, routes/commitments.js, services/commitment*.js, services/reportConfig.js or
  services/uiPolicy.js, tests.
GUARDRAILS  (common guardrails); no action auto-created; no migration.
```

### E-K04 — Deterministic variation explanation + labelled data note (audit K-07, K-08)

```
/goal — SDP360 / E-K04 Variation explanation + data note
CONTEXT  (common context) + services/metricRegistry.js readers, routes/metrics.js, public/analyze-lite.js.
MISSION  services/variationExplain.js (pure): for an additive count metric between two windows, contribution of each
  site (and category/group where the reader can split) to the delta, sorted, with counts both sides; ratios are
  decomposed into numerator and denominator changes, never "explained". GET /api/metrics/:key/explain?site=&a=&b=
  (site scope as /api/metrics/:key) when `metric_explain_enabled`='1', else 404. A note composer produces one short
  sentence citing the figures, ending "measured change — no cause asserted", labelled data-generated, kept apart
  from editorial fields.
METHOD   Failing tests: contributions sum to the delta; ratio decomposition; null window → UNKNOWN; route scope 403;
  switch 0 → 404.
DONE     docs/agent-execution/E-K04.md.
FILES    services/variationExplain.js (new), routes/metrics.js, services/reportConfig.js, tests.
GUARDRAILS  (common guardrails); no AI call; no causal wording.
```

### E-U01 — Usability scoring tool + screen-reader script (audit U-01, U-08 prep)

```
/goal — SDP360 / E-U01 Usability scoring tool + screen-reader session script
CONTEXT  (common context) + docs/ops/USABILITY-TEST-PROTOCOL.md, docs/ops/pilot/{T1-T8-SHEET.csv,SUS-FORM.md}.
MISSION  tools/pilot/usability-score.js: reads the filled T1–T8 sheet (+ SUS answers CSV) and prints per task ×
  role: completion rate, median time, errors, help given, SUS score per participant and mean; blank cells = UNKNOWN,
  never 0; refuses a sheet whose columns differ. docs/ops/pilot/SCREEN-READER-SCRIPT.md: NVDA/VoiceOver steps per
  journey (charts' data tables, modals, errors, tables) with an empty result column.
METHOD   Tests first on synthetic sheets (blank = UNKNOWN, SUS arithmetic, column mismatch refused).
DONE     docs/agent-execution/E-U01.md. Left for a person: the sessions themselves (gates 6, 7).
FILES    tools/pilot/usability-score.js (new), docs/ops/pilot/SCREEN-READER-SCRIPT.md, tests/usability-score.test.js.
GUARDRAILS  (common guardrails); no participant data in the repo.
```

### E-U02 — Analytics filters persisted in the URL (audit U-05)

```
/goal — SDP360 / E-U02 Analytics filters persisted in the URL
CONTEXT  (common context) + C-01 / G18 PARTIAL, services/uiPolicy.js (UI_KEYS, read by public/auth.js).
MISSION  With `ui_url_filters`='1', analytics.html writes its filters (period, site, group, view) to the query string
  with history.replaceState and restores them on load (unknown/foreign values ignored, never trusted as HTML);
  Back restores the previous state; a Reset clears them. '0' = today. No data value is ever put in the URL.
METHOD   Failing tests (pure parse/serialise helper, unknown values dropped, escape) + one e2e journey reproducing a
  shared URL.
DONE     docs/agent-execution/E-U02.md.
FILES    public/analytics.html, public/lib/urlFilters.js (new), services/uiPolicy.js, tests.
GUARDRAILS  (common guardrails).
```

### E-U03 — Page header rollout on non-hot pages (audit U-04)

```
/goal — SDP360 / E-U03 Page header rollout
CONTEXT  (common context) + C-10 (public/lib/pageHead.js on analytics, dashboards, infra-health, wan).
MISSION  Mount the common header (question, scope, window, freshness, state, primary action) on home, site-actions,
  wan-sla, assets, meetings, inspections. Freshness comes from the page's own data (as-of / sync health); absent =
  "freshness unknown", never "now". index.html and reports.html are out of scope (hot spots — separate goal).
METHOD   Extend tests/page-head.test.js: each page mounts the header with non-empty question and scope; unknown
  freshness says so; module-tabs and shell unaffected.
DONE     docs/agent-execution/E-U03.md with the remaining pages listed.
FILES    the six public/*.html above, tests/page-head.test.js. Do not edit pageHead.js except a defect.
GUARDRAILS  (common guardrails).
```

### E-U04 — Page reachability map + dead-end guard (audit U-07, X-UX-01)

```
/goal — SDP360 / E-U04 Page reachability map
CONTEXT  (common context) + tools/agent/inventory.js (counts only _shell.js hrefs), public/module-tabs.js.
MISSION  inventory.js records for each page its entry points: shell nav, module tab, link from page X, deep-link only
  (allow-listed with a reason, e.g. meeting.html?id=, login, no-access), and its parent/back path. INVENTORY.md
  shows them and the corrected "not reachable" count. A test fails when a page has no entry point and is not
  allow-listed.
METHOD   Test first (fixture page without entry fails; module-tab page counted reachable); regenerate INVENTORY.md.
DONE     docs/agent-execution/E-U04.md with old vs new count.
FILES    tools/agent/inventory.js, docs/agent-execution/INVENTORY.{md,json}, tests/inventory-reachability.test.js.
GUARDRAILS  (common guardrails).
```

### E-U05 — FR glossary check on inline spans (audit U-10 prep)

```
/goal — SDP360 / E-U05 FR glossary check on inline data-lng="fr" spans
CONTEXT  (common context) + docs/ux/GLOSSARY-FR.md (PROPOSED), tests/i18n-shell-charts.test.js.
MISSION  Add an "À éviter" column to the glossary (PROPOSITION, filled only with variants actually found in the code)
  and a test that scans public/*.html data-lng="fr" / data-lng-block="fr" text for those variants, listing file:line.
  Report the current hits in the evidence file; fix only unambiguous inconsistencies (same EN term, two FR
  renderings on one page).
METHOD   Test first on a fixture; then run on the tree.
DONE     docs/agent-execution/E-U05.md with the hit list. Left for a person: francophone validation (gate 17).
FILES    docs/ux/GLOSSARY-FR.md, tests/i18n-inline-glossary.test.js, at most a few FR spans.
GUARDRAILS  (common guardrails); glossary stays PROPOSED.
```
