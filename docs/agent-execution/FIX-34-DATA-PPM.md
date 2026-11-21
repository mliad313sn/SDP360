# P11 round 8 — fix lot fix/p11-r8-data-ppm (PPM + data + security seats)

AI-authored engineering evidence — not an independent human review. No approval, signature, production readiness or
field acceptance is claimed, and no human cell of the business-readiness pack was filled. Base `7afb9536` (trunk).
Findings from `/home/user/qual/out/r8-ppm.md` (R8-1…R8-5, R7-4), `/home/user/qual/out/r8-data-kpi.md` (R8-1…R8-3) and
`/home/user/qual/out/r8-security.md` (N-R8-1, N-R8-2).

**Failing first.** `tests/p11-r8-data-ppm.test.js` (9 tests) and `tests/p11-r8-data-ppm.smoke.test.js` (2 tests) were
written and run against the unchanged code: **9/9 and 2/2 failed** (smoke: stored `{probability:2, impact:2}` for an
unscored risk; Policy Center request status `approved` after a refused apply). With the fix: 11/11 pass.

| Finding | Sev | Fix | Regression test |
|---|---|---|---|
| **PPM R8-1** an unscored risk stored 2 × 2 → project RAG risk GREEN, RAID severity "medium" | P2 | Migration **139** drops `DEFAULT 2` of `portfolio_risks.probability / impact` (no row rewritten). RAID writer (`services/ppm/governanceW3Store.js`) no longer defaults to 2; on update a score field that is SENT (even empty) replaces the stored one (reset to unknown possible), an omitted field keeps it. Readers no longer turn NULL into 0 (`governanceStore.riskRow`, `projectKpis.top_risks` used `Number(null)` = 0). | smoke "R8-1" (both writers → NULL; RAG risk component null; summary lists no score; RAID severity null; omit keeps / empty resets) + unit pins |
| **PPM R8-2 / data R8-1** known high beside an unscored entry: amber with no "at least" marker | P3 | `riskExposure.projectScoreDetail` → `{score, partial, unknown}`; `projectScore` = its `.score` (unchanged values). A known high keeps its score with `partial:true`; a known critical (9, the maximum) is not partial; below high stays null. `projectRag.computeRag` exposes `components.risk.partial` (input `risk_score_partial`, fed by `w3Context`). Rule **PROPOSED** (PMO, with the mapping). | unit "R8-2" ×2 |
| **data R8-2** assumptions-only list scored 0 (green) | P3 | 0 only when an in-scope, non-deleted row exists and none is open; otherwise null like an empty list. `tests/p11-r7-data-fixes.test.js` assertion that pinned the old 0 updated (intended change). | unit "data R8-2" |
| **PPM R8-3 / data R8-3** `raid.exposureTotals` case-sensitive `'open'` | P3 | uses `riskExposure.isOpen`. | unit "R8-3" |
| **PPM R8-4** RAID writer refused `Open` | P3 | status and kind trimmed + lower-cased (same `open | closed` vocabulary as the generic writer). | unit "R8-4"; smoke sends `status:'Open'` |
| **PPM R8-5** RAID create read its id with `MAX(id)` | P3 | `INSERT … RETURNING id`. | smoke (returned id = inserted row) + static pin |
| **R7-4** closure-gate rule shipped as default, PROPOSED | policy | Not changed in code. Registered as **HD-P14** (PMO, AI recommendation only, decision cells empty) in `tools/release/business-readiness.source.js` → `docs/business-readiness/REGISTRE-DECISIONS-HUMAINES.md`. Legacy 2 × 2 rows and the partial rule: **HD-P15**. | `business-readiness` check |
| **N-R8-1** approval whose apply fails left the request `approved`, no journal row | P3 | `policyChangeStore.decide`: an apply error turns the claimed row into **`failed`** (new status) with `apply failed: <cause>` in `decision_reason`, then rethrows; `routes/policyCenter.js` journals `policy_change_failed` (who, from/to, cause). The key is free for a corrected request. Not one transaction: the apply (`setConfig`) owns its own transaction; the claim stays first so a concurrent decision still loses. | smoke "N-R8-1" (reviewer repro: pbkdf2 100000→10000000 filed before the range check, approved by a second super_admin → 400, value unchanged, status `failed`, 1 journal row) + unit |
| **N-R8-2** operator-token comment claimed the key "is the control" | P3 (wording) | `services/operatorTokens.js` comment now states the residual: whoever can read the server `.env` (DB credentials + `SDP_CONFIG_KEY`) can forge a bound token and its event; separation of duties is a human decision (InfoSec, G01 / HD-S04). No behaviour change. | unit "N-R8-2" |

## Migration

- `db/postgres/reports/139_portfolio_risk_unscored_default.sql` — `ALTER COLUMN … DROP DEFAULT` ×2, idempotent, no data
  change → rollback `db/postgres_rollback/139_portfolio_risk_unscored_default_drop.sql` (BEGIN/COMMIT, `SET DEFAULT 2`).
- Listed in `tests/ppm-rollback-scripts.test.js` with a narrow `DEFAULT_ONLY` allowance: its rollback changes a column
  default instead of removing an object; the round trip (forward over rollback = same schema) is still proved.

## Behaviour changes operators must know (AI statement, to be read by humans)

- New risks without a score are **unscored** (shown "—", never in the risk matrix, never green). Existing rows stored as
  2 × 2 before this migration are untouched and **cannot be told apart from a deliberate 2 × 2** — HD-P15 asks the PMO /
  data owners what to do; nothing is rewritten automatically.
- RAID form: an edit by id replaces every field sent, including an empty probability / impact (now "unknown"), like the
  owner / mitigation fields already did.
- A Policy Center request can now end in status `failed`.

## Human decisions left (none filled here)

HD-P14 (closure-gate rule, PMO + G07), HD-P15 (legacy 2 × 2 rows, partial rule — PMO / data owners), the score →
level mapping and derived RAG bands (Comité KPI, G06), InfoSec on where `SDP_CONFIG_KEY` lives (G01 / HD-S04).
