# Activate-all qualification — every dark switch on (AI evidence, 2026-11-20)

> **AI-produced evidence, not a decision.** Nothing here approves, schedules or performs an activation. Owner, canary
> site, dates, thresholds and rollback triggers stay empty in `docs/ops/flag-decisions.json`; production activation is
> a human operator action. Branch `qual/activate-all` (worktree), merged with trunk `d01d60e2`; nothing pushed.

## 1. What was built

`tools/ops/activate-switches.js` — the operator tool. It re-uses `tools/agent/switch-lots.js` (lots + dependency
graph) — there is no second engine.

| Mode | What it does |
|---|---|
| `--plan [--lots=L01,L02\|all] [--db-url=…] [--json]` | per lot: switches in dependency order, current value (database, or code defaults without `--db-url`), **OUT** (outbound: `send` = e-mail / Teams / webhook / publication, `external_call` = outbound call to another system), **ACC** (`widens` / `narrows` access, with a one-line note), **$** (touches money), prerequisite switches, the human prerequisite text of `services/switchPrereqs.js` |
| `--apply --db-url=… --lots=…` | writes `report_config` in dependency order through `reportConfig.setConfig`, one `system_log` `config_changed` row per key (actor `cli:activate-switches`, `--reason` kept); writes a rollback file **before** the first write (`data/switch-rollbacks/` or `--rollback-dir`; the database password is redacted) |
| `--rollback=FILE --db-url=…` | restores the `from` values in reverse order; a key changed by someone since the activation is left alone and reported (`--force` overrides) |

Safety rules (tested in `tests/activate-switches.test.js`, 5 tests, on a throwaway database):
- `--apply` / `--rollback` refuse without `--db-url`, and refuse when `NODE_ENV=production` unless `--i-am-the-operator`.
- **Outbound switches are always skipped** unless `--include-outbound` is given explicitly.
- A lot is **refused as a whole** when one of its switches needs a prerequisite switch that is off and not applied
  earlier in the same run (e.g. L05 alone is refused: `ppm_evm_enabled` needs `ppm_baseline_versions` from L03; kill
  switches such as `notifications_stop` are never treated as "must be on").
- Keep groups can be addressed as pseudo-lots `K:<group>`; `K:source_system_write` (SDP write — boundary),
  `K:kill_switch` and `K:not_a_switch` are refused whatever the flags; retired / frozen keys are never written.
- Never reads or writes `flag-decisions.json`.
- `--db-url=env` reads `PG_URL` from the environment / the app's `.env` so the password is not on a command line.

Verified end to end on a scratch PostgreSQL database through the CLI (not only the injected-deps test): L01+L02 apply →
20 keys written, 20 journal rows; `NODE_ENV=production` rollback refused; rollback restored 20 keys, 40 journal rows
in total; password absent from the rollback file.

## 2. Full suite with every switch on

Mechanism: `tools/test/force-switches.js` (P03), with `SDP_FORCE_SWITCHES` = **140 keys**: every dark `report_config`
key except `notifications_stop` (kill switch — on is the opposite of activation), the five `not_a_switch` settings,
`opmanager_tls_insecure` (retire list; on disables TLS verification) and `sdp_api_write_enabled` (boundary). On-value
`1`, except `sla_headline_definition=incl_open`. The nested `sla_wan_config.notify.enabled` cannot be forced through
DEFAULTS and was not forced. Forcing changes only in-memory defaults of each test process; a test that writes its own
value still wins.

```
SDP_FORCE_SWITCHES="<140 keys>" NODE_OPTIONS="--require $PWD/tools/test/force-switches.js" node tools/test/run-all.js
[test-guard] files 864/864 · tests 5594 · failed 181 · skipped 10 · floor 5575
```

The 10 skips are the usual "no prod-snapshot" pair. Classification of the 181 failures (method below):

| Class | Count | Meaning |
|---|---|---|
| (a) asserts the default-off behaviour | ≈ 150 | "off by default → 404", "`'1' == '0'`", "ships at today's value", generated docs compared with the in-memory defaults (FLAG-REGISTER, catalogue), golden snapshots of default outcomes (authz-outcomes, p06 characterization), plus cascades inside such files (an early "off" step fails, the later steps lack the rows it would have created) |
| (c) intended interaction between switches | ≈ 30 | one switch narrows or reshapes what another test exercises — see §2.2 |
| (b) real defect when on | **1** | fixed — §2.1 |

Method: (1) the 123 failing files re-run **without** forcing: 693 tests, 689 pass, 4 fail — all 4 were artefacts
staled by this branch's own new files (README size block, `SWITCH-LOTS.md`, two gate-dossier freshness checks);
regenerated, now green. (2) the same files re-run with every switch on **except** 27 access-narrowing / policy switches:
97 failures, 73 match the default-assertion pattern; the remaining 24 were read one by one (all class a or c).
(3) 28 representative failures were bisected to the single switch that causes them (halving the forced set, whole
file re-run each time, failure matched by test name); every one resolved to one documented switch (§2.2).
(4) the run log was scanned for server-side 500s: one switch-only 500 found (§2.1); the other 500s also occur with
the switches off (§2.3).

### 2.1 Defect found and fixed (ships on — defect fix)

| Lot | Defect | Fix |
|---|---|---|
| L01 (`commitments_enabled`) | `GET /api/commitments?site=SGO` and `/api/commitments/metrics?site=SGO` → **500** (`invalid input syntax for type integer: "NaN"`): the read sweep sends a site code, the route passed it to SQL as a number | a `?site=` that is not a site id answers **400** (`routes/commitments.js`); test added to `tests/commitments-routes.smoke.test.js` (failed before, passes after) |

### 2.2 Intended interactions (the switch does what its register text says)

| Culprit switch (bisected) | Effect seen by other suites |
|---|---|
| `portfolio_site_scope_reads` | site-less viewer / editor personas no longer read site projects → 404 (PPM engine, W3 RAG/DCMA, lifecycle witness, RAID, rbac money invariant counts the 404 as a non-403) |
| `portfolio_editor_plan_writes` | site editors gain plan writes (rbac-scope-frozen "switch off" probe expects a deny) — **access widening** |
| `dashboard_red_action_links` | `GET /api/commitments/metric-links` becomes reachable for every session (data still filtered to the caller's sites) — authz-outcomes snapshot reports a widening |
| `export_watermark_enabled` | CSV / XLSX exports carry the watermark (sheet lists, first rows differ) |
| `soft_delete_enabled` + `soft_delete_two_person` | deletes need a reason (`REASON_REQUIRED`) and a second person (202) |
| `decision_motive_required` / `decision_lifecycle_enforced` | decision status changes without a motive → 400; illegal jumps → 409 |
| `access_require_approval` | role changes through Users → 409 until approved |
| `access_recert_apply` | revoke applies instead of recording |
| `roadmap_redirect_to_portfolio` | Roadmap Manager writes → 409 (read-only after publication) |
| `breakglass_timebox_enabled` | break-glass password sign-in needs a reason |
| `finance_currency_required` | writes without a currency refused (`CURRENCY_REQUIRED`), later steps cascade |
| `finance_certification_enabled` | a money benefit is verified by the `finance-verifier` role only (A1 rule) |
| `wan_sla_require_contract_evidence` | claim due amounts stay null without contract evidence |
| `ppm_budget_periods_enabled` | portfolio workbook gains its sheet |
| `kpi_policy_enforced`, `site_codes_from_registry`, `sla_headline_definition`, `site_local_calendar` | committee-policy switches change the published rule (expected; committee decision first) |
| `teams_sla_enabled` | connector health reads `not_configured` instead of `disarmed` (armed, no credentials) |
| `commitments_enabled`, `ppm_change_requests_enabled`, `alert_group_by_rule`, `ppm_alerts_enabled`, `handoff_notify_enabled` | tests that first assert the off state |

### 2.3 Observed, not switch-related (left to a separate fix lot)

500 instead of 4xx on malformed input, present with the switches off too: `GET /api/kpi-policies/:id/diff` without
`against` (NaN bigint), `POST /api/trackers/:key/rollback/<non-number>`, `GET /api/reports/action-departments` (NaN),
`DELETE /api/governance/portfolio/<unknown kind>/:id`, `PUT /api/reports/schedule` with no `report_type`. The suite log
also shows OAuth refresh attempts reaching `accounts.zoho.com` with the smoke tests' dummy credentials ("invalid_client",
"too many requests"): a test-hygiene issue (outbound call from the unit suite), not caused by the switches.

## 3. Status per lot (all switches on, throwaway databases)

| Lot | Status | Outbound (operator must decide) | Access-changing | Money |
|---|---|---|---|---|
| L01 Daily work | works — 1 defect fixed (§2.1) | — | widens: `commitments_enabled` (new write surface) | — |
| L02 PMO reading | works | — | widens: `ppm_project_roles_enabled`; narrows: `portfolio_site_scope_reads` | 3 |
| L03 Change control | works | — | widens: **`portfolio_editor_plan_writes`** | 2 |
| L04 Scheduling | works | — | widens: `ppm_comments_enabled` | 1 |
| L05 Time, money, benefits | works; **needs L03** (`ppm_baseline_versions`) | — | — | 7 |
| L06 Plan exchange | works (pure tests; no live Jira / Azure DevOps) | external_call: `ppm_jira_sync_enabled`, `ppm_azdo_sync_enabled` | — | 1 |
| L07 Roadmap & sensitivity | works; `soft_delete_enabled` before `roadmap_publication_enabled` (tool orders it) | — | widens: `roadmap_audience_publication_enabled` (public links); narrows: 2 | 2 |
| L08 Governance cadence | works; `a01_missing_due_date` needs L01 | — | narrows: `decision_lifecycle_enforced` | — |
| L09 KPI trust | works; `dashboard_red_action_links` needs L01 | — | metric-links reachable (filtered) | 1 |
| L10 Reporting rhythm | works (in-app reminders only) | — | — | — |
| L11 Site evidence | works | — | narrows: `insp_action_verify_enabled` | 3 |
| L12 Access hardening | works | — | widens: `emergency_access_enabled`; narrows: 7 (lock-outs, approvals, 409s) | — |
| L13 Ops resilience | works | send: `sync_drift_alerts`, `delivery_failure_alert_enabled`; external_call: `entra_deprovision_enabled` | narrows: `site_code_shared_block` | — |

No lot is blocked by a defect. Keep groups (not in any lot) were also forced on in the suite run: outbound group,
armed-in-production group, committee policy, external preconditions, irreversible — no defect attributed to them;
they stay outside activation lots by the plan's own reasons (`docs/ops/SWITCH-LOTS.md`).

Browser journeys with every switch on: see §5.

## 5. Browser journeys with every switch on

`node tools/test/run-e2e.js --runs=1` (Chromium, every non-localhost request blocked) with the same 140 forced keys:
**42 journeys, 25 pass, 17 fail**. With the 27 narrowing / policy switches removed: 28 pass, 14 fail (C5 role removal,
I1 access request, X1 exports recover — they collide with `access_require_approval` / the strict export policy and
watermark). The 14 were read one by one:

| Journey | Cause | Class |
|---|---|---|
| UAT S1–S8 (simulations) | their **pass A is defined as "switches off"** and asserts 404 / absent features (`S1-09`, `S2-05/06`, `S3-03…07`, `S4-03/06`, `S5-03/07`, `S6-05`, `S7-05/07`, `S8-06`) | (a) |
| I5 emergency access, I6 shift handover, DENY cross-site | first step asserts the off state (404 / "switch off = today") | (a) |
| T3 field inspection, F1 field network, S6-02 | `field_review_step` adds the review dialog before queuing; the journeys click through without it (`<dialog id="review">` intercepts the click) | (c) |
| DEMO two-site journey | `portfolio_my_projects_default` opens the portfolio on "My projects"; the PMO persona owns no demo project, so the list it waits for is not shown (confirmed with that switch alone) | (c) — UX point for the PMO owner: the committee lands on an empty "My projects" until it picks "All projects" |

No journey failure points to a defect. Journeys that exercise the switched-on behaviour passed (e.g. field
review-step and task-timing browser units, Home queue R2).

## 6. Limits of this evidence

- One full-suite run and one journey run; flakiness not measured (no `--runs=2`).
- The nested `sla_wan_config.notify.enabled` and the excluded keys (§2) were not forced.
- Class (a)/(c) counts are approximate (pattern + reading + 28 bisections); every (c) row names the switch found by
  bisection, but not every one of the ≈ 30 (c) failures was bisected individually.
- No live connector, mailbox, Teams channel, Jira / Azure DevOps or Graph tenant was used; outbound switches are
  qualified only against fakes / disarmed paths.

## 7. Operator commands (proposed; run by a human)

TEST instance first (its own `.env` / `PG_URL`), from the application folder:

```
node tools/ops/activate-switches.js --plan --lots=all --db-url=env
node tools/ops/activate-switches.js --apply --lots=L01 --db-url=env --reason="TEST: lot L01"
#   …browser check of the lot's pages, then the next lot. L05 after L03; L08 and L09 after L01.
node tools/ops/activate-switches.js --apply --lots=L02,L03 --db-url=env --reason="TEST: lots L02-L03"
node tools/ops/activate-switches.js --rollback=data/switch-rollbacks/rollback-<stamp>.json --db-url=env
```

Production, only after the lot's decision record is filled by its owner (NODE_ENV=production makes the operator flag
mandatory):

```
node tools\ops\activate-switches.js --plan --lots=L01 --db-url=env
node tools\ops\activate-switches.js --apply --lots=L01 --db-url=env --i-am-the-operator --reason="<change ref>"
node tools\ops\activate-switches.js --rollback=data\switch-rollbacks\rollback-<stamp>.json --db-url=env --i-am-the-operator
```

Outbound switches (L06 Jira / Azure DevOps, L13 sync drift / delivery-failure alerts / Entra de-provisioning, and the
`K:outbound` / `K:armed_in_production` keep groups) are written only with `--include-outbound`, after a reviewed recipient
list, a dry run and the `notifications_stop` test (register prerequisite). Access-widening switches
(`portfolio_editor_plan_writes`, `commitments_enabled`, `ppm_project_roles_enabled`, `ppm_comments_enabled`,
`roadmap_audience_publication_enabled`, `emergency_access_enabled`) and money switches need their owner's decision first.
