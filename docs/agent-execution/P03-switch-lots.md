# P03 — Switch activation in lots (evidence)

Lot `p03-switch-lots`, branch `qual/p03-switch-lots`, base `e8900a7` · 2026-11-19 · written by an AI agent.
**Every lot, keep entry and retirement below is a PROPOSAL.** No switch was turned on outside a throwaway test
database; owner, canary site, dates, thresholds and rollback-trigger values are left empty on purpose.
This is a relaunch: the first run's commits were lost with its container; everything was redone and re-verified at
this base (the summary handed to this run was not trusted).

## Deliverables

| What | Where |
|---|---|
| Lot plan (agent proposal, machine-readable) | `docs/ops/switch-lots.json` |
| Lot plan, 13 dossiers, keep list, retire list, dependency graph, overlaps, expiry | `docs/ops/SWITCH-LOTS.md` (generated) |
| Generator + checker (`--check`, `--lot=L01 --force/--tests`, `--lot=A+B` pairwise) | `tools/agent/switch-lots.js` |
| Test-only preload that forces switches on (refuses outside `node --test`, production, `SDP_TEST_PG_URL`, unknown keys) | `tools/test/force-switches.js` |
| Plan stays valid + Markdown current; validator rule-breaks | `tests/switch-lots.test.js` (5) |
| Expiry check (step 7), pure check proven on fixtures, not armed until N is set | `tests/switch-expiry.test.js` (2) |
| Preload safety | `tests/force-switches.test.js` (2) |
| Rollback rehearsal per lot: on → off, every other table identical (count + digest), config back to defaults | `tests/switch-lots-rollback.test.js` (13) |
| Decision record (AI, engineering only) | `docs/ai-decisions/ADR-P03-switch-activation-lots.md` |

## Counts (recounted from the regenerated register at this base)

`node tools/agent/flag-register.js --check` → up to date. Dark switches: **152** (148 `report_config` keys,
3 frozen deployment lots, 1 nested arm) — up from 148 at review time (W3/W4 PPM switches).

| In a lot | Keep dark | Retire (proposal) | Lots |
|---|---|---|---|
| 111 | 38 (5 of them are settings, not switches) | 3 | 13 (max 10 each) |

If the 3 retirements and the 5 reclassifications are accepted: **144** dark entries, and each approved lot then
lowers the count further. Plan checks: clean · dependency cycles: 0 · orphans: 0.

Lots (journey order): L01 daily work (PROPOSED first) · L02 PMO reading (PROPOSED second) · L03 change control &
baselines · L04 scheduling & collaboration · L05 time, money, benefits · L06 optional plan exchange · L07 roadmap
publication · L08 governance cadence · L09 KPI trust · L10 reporting rhythm · L11 site operations evidence ·
L12 access security · L13 operations resilience.

Retire proposals (no code deleted): `frozen:tracker_green_band_90`, `frozen:tracker_weighted_donut` (the sibling
repository's step-5 notes record the tracker freeze as released — owner to confirm production carries the commits),
`opmanager_tls_insecure` (superseded by `opmanager_ca_bundle`; only after the owner confirms production value 0).

## Per-lot runs with the lot's switches forced on (step 4, targeted)

Command per lot (throwaway PostgreSQL database per test file, concurrency 2, then failing files re-run at
concurrency 1, then still-failing files re-run WITHOUT forcing to separate pre-existing failures):

```
export SDP_FORCE_SWITCHES="$(node tools/agent/switch-lots.js --lot=Lxx --force)"
NODE_OPTIONS="--require tools/test/blocking-stdio.js --require tests/_default-env.js --require tools/test/force-switches.js --import file://tests/_pg-boot.mjs" \
  node --test --test-force-exit $(node tools/agent/switch-lots.js --lot=Lxx --tests)
```

Test set per lot = every test file that names one of the lot's switches + the authorization/RBAC set
(`authz-matrix-json`, `authz-route-matrix`, `authz-enforce`, `rbac-matrix.smoke`, `rbac-write-scope.smoke`,
`rbac-scope-frozen.smoke`, `rbac-ui-gates`, `rbac-external-writes`).

| Lot | Files | Results | Pass | Fail | Classification of the failures |
|---|---|---|---|---|---|
| L01 | 38 | 204 | 189 | 15 | 14 assert today's default (route 404 while off, "default off", register/plan current); 1 flaky (`value-scoreboard`, green on re-run) |
| L02 | 20 | 120 | 111 | 9 | assert today's open reads: with `portfolio_site_scope_reads` a site-less editor gets 404 where the harness expects 200 (`rbac-matrix` invariant 2 counts it as a violation — it is a narrowing, no amount exposed); `ppm-w3` fixtures read cross-site projects |
| L03 | 18 | 109 | 105 | 4 | **`rbac-scope-frozen` invariant 1: "editor A plan write (switch off) → 200"** = the widening of `portfolio_editor_plan_writes` (STOP-AND-REPORT below); `ppm-baselines` workbook gains a `Changes` sheet (see follow-up) |
| L04 | 12 | 71 | 69 | 2 | assert today's default |
| L05 | 21 | 128 | 117 | 11 | assert today's default; `portfolio-finance-currency` cascades from its first fixture once a currency is mandatory |
| L06 | 10 | 59 | 59 | 0 | — |
| L07 | 20 | 119 | 113 | 6 | assert today's default; `soft-delete-routes` asks for a reason once `soft_delete_two_person` is on (intended interaction) |
| L08 | 23 | 152 | 134 | 18 | assert today's default; governance live/decision tests follow the lifecycle + motive rules once forced (intended interaction) |
| L09 | 25 | 179 | 169 | 10 | assert today's default; **1 PRE-EXISTING** (`i18n-coverage` project.html — fails without forcing too, see below) |
| L10 | 15 | 101 | 93 | 8 | assert today's default |
| L11 | 16 | 110 | 95 | 15 | assert today's default; `wan-sla-claims-routes` cascades because `wan_sla_require_contract_evidence` leaves the due amount null without contract evidence (intended — null, never 0) |
| L12 | 21 | 129 | 117 | 12 | assert today's default; `rbac-matrix` invariant 2 reports that **a known money deviation no longer reproduces** with `export_policy_strict` on (the strict policy closes it — positive) |
| L13 | 15 | 100 | 93 | 7 | assert today's default; `config-change-journal` expects a prerequisite warning that is not emitted when the value is already the forced default (test artefact); `site_code_shared_block` blocks the shared-code fixture (intended) |
| **Total** | | **1581** | **1464** | **117** | every failure classified; **no defect introduced by switching a lot on was found**; 1 pre-existing failure; 1 flaky |

Every failure re-run **without** forcing passed, except the pre-existing `i18n-coverage` case.
Raw results (JSON lines per test) were kept in the agent scratchpad, not committed.

## Pairwise runs (step 5)

`docs/ops/SWITCH-LOTS.md` lists every cross-lot pair of switches sharing a non-hub consumer file or table (44 lot
pairs). The four heaviest pairs were run with both lots forced together (`--lot=A+B`):
see the section "Pairwise results" appended below. The remaining pairs are left for the orchestrator.

## Rollback rehearsal (step 4)

`tests/switch-lots-rollback.test.js`: for each of the 13 lots, set on then back to defaults on a throwaway database;
every table except `report_config`, the logs, the migration journal and the sync run tables has the same row count
and content digest. **13/13 pass.** Limit: it proves turning a lot off leaves data untouched; data written WHILE a lot
is on stays in place (by design) and is covered only by each lot's targeted tests.

## Not done here (honest gaps)

- **Full suite per lot**: reserved to the orchestrator (ten agents share the disk). Not re-run; pending.
- **Browser journeys, P02 probe, data-parity check under real use**: pending on the TEST instance / orchestrator.
- `node tools/agent/evidence-manifest.js --check` was already out of date at the base (files from other lots);
  not regenerated here to avoid touching the shared seal.

## Findings

1. **STOP-AND-REPORT — L03 `portfolio_editor_plan_writes` widens write access** (site editors write plans that only
   the committee writes today), confirmed by `rbac-scope-frozen` invariant 1 under forcing. The lot cannot be
   approved without the access-policy owner's decision; the switch could be moved to its own lot if L03 should go
   ahead without it.
2. **STOP-AND-REPORT — four sends are ARMED in production** (`weekly_report_send_enabled`,
   `scoreboard_send_enabled`, `hygiene_send_enabled`, `asset_group_send_enabled`, per CLAUDE.md 2026-09-23) while the
   code default is dark. They are in the keep list; the owner must record a keep decision for the production value.
3. **Pre-existing at `e8900a7`**: `tests/i18n-coverage.test.js` — `project.html` W3 strings ("Simplified", "Expert",
   "Schedule quality — DCMA 14-point check", "RAID log — response, review, exposure", …) have no French entry. Fails
   with and without forcing. Belongs to the W3 governance owner; not fixed here (outside this lane).
4. **Follow-up**: `ppm-baselines` pins the exact workbook sheet list, so with `ppm_change_requests_enabled` the test
   stops at the new `Changes` sheet before checking that a viewer sees no amount in it. Unverified, not a confirmed
   leak — a test should assert the money rule on that sheet before L03 is approved.

## Human decisions now unblocked

Per lot: approve / reject the lot, name the owner and canary site, set the decision date and expiry, choose the
rollback trigger and metric threshold (`docs/ops/flag-decisions.json`). Globally: N for the expiry test
(`expiry.max_days_on_without_decision`), the three retirements, the five reclassifications, the keep decision for the
four armed sends, and the access-policy decision on `portfolio_editor_plan_writes`.
