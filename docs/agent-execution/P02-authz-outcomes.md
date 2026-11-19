# P02 — Authorization outcome assurance (evidence + Security gate dossier)

- **Branch:** `qual/p02-authz` · **base:** `e8900a7` · **date:** 2026-11-19 · **author:** AI agent (P02). Every review in
  this file is an AI review, not an independent one.
- **Scope:** QUALIFY. No new module, page, connector or switch. One harness extended (`tests/_rbac-matrix-core.js`).
- Decisions and the two PROPOSED policy items: `docs/ai-decisions/ADR-P02-authz-outcomes.md`.
- **This file does not state that the application has no vulnerability.** It states what was probed, how, and with which
  limits.

## 1. What was delivered

| Item | File(s) |
|---|---|
| Outcome probe (every method of every `/api` route × 23 personas + site-B object rows) | `tests/_rbac-matrix-core.js` (`probeOutcomes`, `checkOutcomeInvariants`, `diffOutcomes`), `tests/authz-outcomes.smoke.test.js` |
| Committed outcome snapshot (reviewed in the diff) | `docs/ops/authz-outcomes.json` — 854 rows (746 routes + 108 `[B]` rows), one character per persona |
| Declared in-handler decision of the 462 session-gated routes without a role guard | `docs/ops/authz-handler-checks.json`, `tools/agent/authz-handler-classify.js`, `tests/authz-handler-checks.test.js` |
| New matrix field `handler_check` (+ totals `handler_checked`, `handler_none`) | `tools/agent/authz-walk.js`, `docs/ops/authz-matrix.json`; `tools/agent/authz-diff.js` flags a removed declared check as a widening |
| Matrix fix: the central site-read guard covers `/api/sites/:siteId/*` (the matrix regexp missed `siteId`) | `tools/agent/authz-walk.js` `CENTRAL_SITE_READ` (2 rows become `site_scoped: true`) |
| Switch narrowing check (6 runs, 5 switches) | `runSwitches` / `compareSwitches` in the core, test 5 of `authz-outcomes.smoke` |
| Money scan of every non-reader 2xx body (JSON, HTML, xlsx, pptx/docx, MSPDI XML, XER) | `probeOutcomes` + test 3 |
| Mutation control (sandbox copy, never committed) | §6 below |

**No application route was changed** (no handler code edited): no P0 found, and the one gap found (P02-F1) needs a policy
choice first. Routes changed = 0; matrix rows changed = 462 (`handler_check` added) + 2 (`site_scoped`).

## 2. Personas (23 columns, in this order)

`anon` · `deact` (viewer A, deactivated after login, token kept) · `revoked` (viewer A, session deleted, token kept) ·
`viewA` · `edNoSite` · `edA` · `edAB` (editor, sites A+B) · 11 feature roles **alone** with site A (`tracker-admin`,
`tracker-editor`, `report-author`, `audit-viewer`, `scorecard-viewer`, `dashboard-publisher`, `committee-member`,
`field-tech`, `finance-viewer`, `kpi-committee`, `finance-verifier`) · `sbizA` · `gbiz` · `admin` · `exec` · `super`.
Site A = Hounde (HGO), site B = Sabodala (SGO). Site-B object ids (report, follow-up, monthly/objectives, PV + action +
issue, inspection + action, portfolio/PPM project, site) are probed for every persona as `<key> [B]`.

Passes per persona (non-refusal cells out of 854): anon 3 · deact 3 · revoked 3 · viewA 291 · edNoSite 279 · edA 316 ·
edAB 384 · feature roles 292-350 (committee-member 350) · sbizA 16 · gbiz 17 · admin 539 · exec 553 · super 663.

## 3. Step 1-2 — in-handler classification

462 routes in scope (gate `session`, no role guard). Classes (a route may carry several): role 246 · site 235 ·
switch 138 · ownership 61 · **none 71**. Static signals cover the handler chain **and** path wrappers (route layers on a path
array / regexp: central site-read guard, meetings read-scope wrapper). 81 entries were read by hand (AI) and marked
`reviewed`; the others carry their static evidence.

Evidence held by `tests/authz-handler-checks.test.js`:
1. coverage — every in-scope route declared, no stale entry, every `none` has a reviewed justification (≥ 20 chars);
2. static — no route with a role / site / ownership / switch signal is declared `none`;
3. runtime — every route declared `none` gives the same outcome class to all 18 active signed-in non-business personas
   in the snapshot (checked on its `[B]` row too).

The 71 `none` routes and their one-line justification are in `docs/ops/authz-handler-checks.json` (`checks: []`). Groups:
Helpdesk / change dashboard data (`/api/data/*`, `/api/cab`, `/api/change`, `/api/requests`) · fleet asset views without
amounts (`/api/assets/{lookups,summary,hygiene,hardware,software,progress,reconcile,depreciation-config,sync-status}`) ·
infrastructure / WAN health reads · reference lists (sites, departments, technicians, people, presets, KPI dictionary,
KPI policies, tracker catalogue, Risk Register mapping) · operational status (sync, cache) · own telemetry (`/api/ux/*`) ·
dev-only debug (404 in production) · **engagement comments (finding P02-F1)**.

Observation (not a defect of this lot): `analytics.html` is page-gated `admin|scorecard-viewer`, but the `/api/data/*`
reads behind it answer every signed-in non-business account (classified `none`, Helpdesk dashboard data, PII-stripped at
fetch). If the page gate is meant as a data boundary, that is a decision for the security owner.

## 4. Step 3-4 — probe results

Command (targeted, never the full suite):

```
export PG_ADMIN_URL=postgres://sdptest:sdptest-local-only@localhost:5432/postgres
NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" \
  node --test --test-force-exit tests/authz-outcomes.smoke.test.js            # AUTHZ_OUTCOMES_UPDATE=1 to regenerate
```

| Run | Result |
|---|---|
| r3 (`AUTHZ_OUTCOMES_UPDATE=1`) | 5/5 pass · 19 592 requests, 0 transport retries · probe 123 s, file 237 s (host load avg 9-24, ten agents) |
| r4 (compare, fresh database) | 5/5 pass — **identical map** (no widening, no narrowing, no added / removed row) |

Invariants (test 2) hold on every row: anonymous, deactivated and revoked → 401/403 on every non-public route; a
deactivated account cannot log in again; business-only → 403 outside the Site Awareness allowlist; every role-guarded
route refuses with 403 each persona its guards refuse (all methods).

Switch runs (test 5) — each switch alone, compared with the baseline (401/403 → pass = widening):

| Switch (value) | Phase | Rows | Requests | Widened | Declared | Narrowed |
|---|---|---|---|---|---|---|
| `portfolio_site_scope_reads` (1) | read | 104 | 1 872 | **0** | 0 | 337 |
| `portfolio_sensitive_projects` (1, site-B project marked sensitive) | read | 104 | 1 872 | **0** | 0 | 313 |
| `authz_capability_mode` (enforce, every capability listed) | read | 99 | 1 782 | **0** | 0 | 0 |
| `portfolio_executive_readonly` (1) | write | 114 | 2 043 | **0** | 0 | 44 |
| `portfolio_editor_plan_writes` (1) | write | 114 | 2 043 | **0** | 36 | 0 |
| `authz_capability_mode` (enforce, every capability listed) | write | 154 | 2 740 | **0** | 0 | 0 |

The 36 declared widenings are the switch's purpose (editor A / A+B on governance plan writes); site-B plan bodies stay
refused (`checkSitePerimeter`, `tests/rbac-scope-frozen.smoke.test.js`). Enforce narrowing 0 is expected while the capability
catalogue mirrors the legacy guards (it can only refuse, and the probe shows it never admits more).

An earlier run showed `authz_capability_mode=enforce` "widening" `GET /api/reports/:id/audit` for editor A on a site-B id.
Root cause: state, not the switch — the write baseline had deleted report B, and the central site-read guard lets a request
for a non-existent report through to the route's own answer. Fixed in the harness (read switches run before any write;
write switches run before the write baseline, without DELETE). Kept here because it shows that a 401/403 baseline cell can
depend on state when the guard looks the object up.

## 5. Step 5 — money

- Sentinel scan: 2 982 non-reader 2xx bodies scanned (JSON, HTML, xlsx sheets, pptx/docx XML parts, MSPDI XML, XER text);
  **0 unexpected leak**. Positive control: 28 money-reader bodies carry the seeded amounts. Unscanned: PDF bodies (none
  served as 2xx to a non-reader in this world).
- Recorded exception still reproducing (`KNOWN_OUTCOME_MONEY`): committee-member reads portfolio amounts on
  `GET /api/governance/portfolio`, `/deck.pptx`, `/project/:id`, `/project/:id/history`, `/report.html` and the PPM
  budget periods. The key-based review scan finds `budget` / `spent` only on those committee-member rows.
- **Committee-member exception:** options A (accept + amend invariant 2) / B (restrict to admin tier + finance-viewer) /
  C (totals only) for the Information Security owner in the ADR. **Not decided.**

## 6. Step 6 — mutation control (sandbox copy `$SCRATCH/p02/sandbox`, never committed)

Script `$SCRATCH/p02/mutate.sh <case>`: copies the pristine file back, applies one `sed`, runs the probe narrowed with
`AUTHZ_OUTCOMES_ONLY` (snapshot comparison on the probed rows, widenings only), restores.

| Case | In-handler check broken | Probe result |
|---|---|---|
| control | none (same five route sets) | 5/5 pass, exit 0 |
| M1 | meetings read-scope wrapper (`_meetingsReadScope`: codes = null) — **site** | exit 1 — `GET /api/meetings/:id [B]`: viewA, edNoSite, edA, feature roles F → A |
| M2 | `_requireSuperAdminInline` (backup schedule) — **role** | exit 1 — `GET /api/admin/backup-schedule`: every non-super persona F → A |
| M3 | value-scoreboard `gate()` super/admin check — **role** | exit 1 — `GET /api/value-scoreboard/rollouts` (and siblings) F → A |
| M4 | governance `canSeeMoney` → true — **money** | exit 1 — test 3: sentinel 987654 in viewer / editor / feature-role bodies |
| M5 | `_reportWriteDenial` site check — **site (write)** | exit 1 — `PUT /api/reports/:id/lights [B]`: edA, edNoSite F → A |

5/5 caught, control clean.

## 7. Other targeted runs

`tests/authz-matrix-json`, `authz-route-matrix` (matrix regenerated with `AUTHZ_MATRIX_UPDATE=1`), `authz-handler-checks`,
`capability-registry`, `authz-enforce`, `rbac-matrix.smoke`, `rbac-mutation.smoke`, `rbac-scope-frozen.smoke`: **49/49
pass**. `readme-truth` + `test-runner-guard`: 7/7. `npx eslint .`: clean. `node tools/agent/inventory.js` regenerated,
`--strict` exit 0. `tests/.suite-manifest.json`: +2 files (5 + 3 tests, total 5 320). **Full suite not re-run by this agent**
(parallel-agent rule) — cite the orchestrator's merge run.

## 8. Limits (stated, not hidden)

- A status class does not see a filtered list (same 200, fewer rows): list scoping stays the job of the cross-site sweeps.
- "V-masked" rows: 45 rows where every active persona gets the same 4xx — the handler refuses input before any check, so
  the probe does not reach the check with an empty body. Four site-B writes were given valid bodies (`B_BODIES`); the rest
  rely on the targeted sweeps.
- `/api/data/*` answers 500 for every signed-in persona in the test world (no Zoho credentials): only the session and
  business gates in front of them are exercised.
- DELETE is not re-probed under switches; the `S` cells (admin tier on backup / reset / sync / send / import-commit) are not
  executed.
- Runtime: ~4 min for the file on a loaded host (≈19 600 requests + ≈12 300 switch requests). If CI time becomes a problem,
  the switch runs are the first thing to split into their own file.

## 9. Findings

- **P0: none found.** (This is not a statement that none exists.)
- **P02-F1 (P2 proposed)** — `GET/POST /api/engagement/comments`: any signed-in non-business account reads and writes
  comments on any `(source_kind, source_ref)`; no source-object check. Options in the ADR; not changed (needs a policy).
- **P02-O1 (robustness, low)** — `DELETE /api/governance/portfolio/:kind/:id` with an unknown kind answers 500 instead
  of 400 for the personas allowed past the committee check.

## 10. Security gate dossier (RELEASE-GATES.md row "Security — access policy CG-01/CG-02, authz matrix")

The gate row stays empty: only Information Security fills it. Evidence a reviewer can replay at this SHA:

1. `docs/ops/authz-matrix.json` (746 API routes, `handler_check` on 462) + `AUTHZ-MATRIX.md`; freshness test
   `tests/authz-matrix-json.test.js`.
2. `docs/ops/authz-outcomes.json` + `tests/authz-outcomes.smoke.test.js` (commands in §4) — two identical runs.
3. `docs/ops/authz-handler-checks.json` + `tests/authz-handler-checks.test.js` (71 `none` routes with reasons).
4. Switch table §4, money §5, mutation control §6.
5. Decisions to take (human): P02-F1 option; committee-member money option (A / B / C); whether the analytics page gate is
   a data boundary (§3 observation).
6. Not covered here and still required by the gate: threat model / findings register (G27), penetration test (E-B05),
   SSO / IdP review, production configuration review.
