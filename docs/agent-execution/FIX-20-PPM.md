# P11 round 5 — fix lot fix/p11-r5-ppm (PPM / portfolio Lots 5–6)

AI-authored engineering evidence — not an independent human review. No approval, signature, production readiness or
field acceptance is claimed. Base `0e97838e`. Findings from `/home/user/qual/out/r5-ppm.md` (repros
`/tmp/r5ppm/tests/r5attack{,3}.smoke.test.js`) and two notes of the security seat (`/home/user/qual/out/r5-security.md`
N-R5-3, N-R5-4). Every new test was run and seen FAILING with the product changes stashed (8 failures), passing after.
All touched behaviour sits behind switches that stay `'0'` by default; no switch default was changed.

| Finding | Sev | Cause | Fix | Regression test |
|---|---|---|---|---|
| R5-1a loop through soft delete + restore | P2 | `allEdges()` ignored edges of a soft-deleted project; restore never re-checked | the loop check of `saveDependency` reads `allEdges({ includeDeletedProjects: true })`: the edges of a restorable project still count, so the closing link is refused (409 `DEP_CYCLE`) while the project is in the bin and a restore can never close a loop. Display / cycle report keep reading live edges only | `tests/portfolio-r5-ppm.smoke.test.js` (R5-1a) |
| R5-1b two opposite links at once | P2 | read graph + insert in one READ COMMITTED tx without a lock (write skew) | `pg_advisory_xact_lock(hashtext('ppm:project-dependency-graph'))` at the start of the `saveDependency` transaction — one writer at a time on the graph | same file (R5-1b, 20 parallel rounds: always one 200 + one 409) |
| R5-2 / N-R5-3 business-case freeze bypass | P2 | `currency` not frozen; `freezeRefusal` checked only CR status + project | `currency` joins `FROZEN_FIELDS` and no change request unlocks it (a CR carries no exchange basis → committee re-baseline); a CR is **single use** (its first edit leaves the `business_case_change` ledger row, a second use → 409 `CHANGE_REQUEST_USED`); the budget is **value-bound**: new budget = old budget + `impact_budget`, CR currency = project currency, a CR with no budget impact does not unlock the budget (409 `CHANGE_REQUEST_SCOPE`). The project update runs in one transaction with an advisory lock on the CR id, so two concurrent edits naming one CR cannot both use it | `tests/portfolio-lot5-pure.test.js` (+1), `tests/portfolio-lot5.smoke.test.js` (freeze test extended: USD→XOF with/without CR, 9 000 000 / 3 000 / charter reuse, +100 then 999 999 / 5, other-currency CR, text-only CR, concurrent pair) |
| R5-3 partial capacity view shown GREEN | P2 | demand of readable projects only vs the one group-wide `ppm_capacity_fte` | `partialCapacity()` in `routes/governancePortfolioPhase2.js`: when the reader cannot see every live project carrying demand, the capacity comparison is made against an unknown capacity (rag `NA`, utilisation null) and the response carries `partial: true` + `partial_note` ("capacity is group-wide"). Same for the scenario route. Readers who see all demand keep the group verdict (`partial: false`) | `tests/portfolio-r5-ppm.smoke.test.js` (R5-3) |
| R5-5 demand window > 60 months silently cut | P3 | `monthsOf` capped at `MAX_MONTHS`, nothing reported | `normalise` refuses a window over 60 months (400 `DEMAND_WINDOW`); a line stored before the rule is placed on its first 60 months and listed in a new `truncated` array of `monthlyLoad` | `tests/portfolio-phase2-pure.test.js` (+1), smoke R5-3 |
| R5-6 document version race / orphan blob / case | P3 | blob written before the INSERT, no lock, case-sensitive MAX(version) | advisory lock per (project, type, lower(title)) + `lower(title)` in the version query (same grouping as `latestFirst`); blob removed (`blobStore.removeRef`, path-guarded) when the transaction fails | `tests/portfolio-r5-ppm.smoke.test.js` (R5-6: 3 parallel uploads → v1/v2/v3, one file per row) |
| R5-6 money-document title visible to non-amount readers | P3 | `PD.view` served the title | title masked (`title: null`, `title_masked: true`) for a restricted (money) document; the page shows "restricted (amounts)"; the document type stays | `tests/portfolio-phase2-pure.test.js`, `tests/portfolio-phase2.smoke.test.js` |
| N-R5-4 hidden predecessor id exposed | P3 | `SD.view` returned the raw `predecessor_project_id` | `predecessor_project_id: null` when the reader cannot read the predecessor (`predecessor_readable:false` keeps saying one is there); the page prints "a project you cannot read" (EN/FR) instead of `#id` | `tests/portfolio-phase2-pure.test.js` (+1), `tests/portfolio-phase2.smoke.test.js` (site-scope test) |
| R5-7 freeze / DQ gate switches not four-eyes | P3 | catalogue classification | `ppm_business_case_freeze_enabled` and `ppm_dq_gate_enforced` → `four_eyes: true`, `strict_value: '1'`, risk high in `docs/ops/policy-catalogue.json` (turning either control OFF needs a second super_admin while the Policy Center is on). Engineering classification, PROPOSED | `node tools/agent/policy-catalogue.js` OK, `tests/policy-center-*` |

Not done: R1-F4 levelling performance (out of scope by instruction); R5-4 (Lot 3 drill counts) and the risk/partial
verdict work belong to fix 19.

Residuals noticed, not fixed here:
- The `document_added` ledger note still carries the document title; whoever reads the project ledger sees it.
- The per-project demand view still colours one project's load against the group capacity (a project-share reading,
  not a portfolio verdict).
- Projects soft-deleted before this change whose closing link was already created (a loop present in data) are not
  repaired automatically; `GET /api/governance/ppm/portfolio/dependencies` reports any loop.

Human decisions left (PROPOSED here, not approved):
- KPI Committee / PMO: the frozen-field list, the rule "a change request is used once and unlocks the budget only by
  its approved `impact_budget`", and "no change request re-denominates an approved business case".
- Policy owners: the four-eyes classification of the two PPM switches.
- Product: whether a partial capacity view should instead show group totals without project ids.

Changed authz rows: none (no route added or removed). Migrations: none.
