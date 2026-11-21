# P11 round 9 — fix lot fix/p11-r9-ppm (PPM seat + data R9-1)

AI-authored engineering evidence — not an independent human review. No approval, signature, production readiness or
field acceptance is claimed, and no human gate or decision cell was filled. Base `928ca8f0` (trunk). Findings from
`/home/user/qual/out/r9-ppm.md` (R9-1…R9-4) and `/home/user/qual/out/r9-data-kpi.md` (R9-1, the same "partial not
surfaced" residual as PPM R9-4). No route, no migration, no schema change.

**Failing first.** `tests/p11-r9-ppm.test.js` (7 tests) and `tests/p11-r9-ppm.smoke.test.js` (3 tests) were written
and run with the product changes stashed (`git stash push -- services public`): **9/10 failed** — smoke R9-1 stored
`{probability:null, impact:null, owner:'bob'}` after a form-shaped owner edit (the reviewer's A1b–A1f repro, RAG red →
null); smoke R9-2 answered 200 to `probability:0`; R9-3/R9-4 cards had no `unscored_risks` / `high_risks_partial` /
`rag_partial`; the pure merge helper did not exist. The one test passing on the base is the new client helper's own
unit test (the file is new, so it exists in both runs). With the fix: **10/10 pass**.

| Finding | Sev | Fix | Regression test |
|---|---|---|---|
| **R9-1** editing a RAID entry through the shipped form erased probability/impact (RED → UNKNOWN) — regression from fix 34 | P2 | **Store** (`services/ppm/governanceW3Store.js`): an update now **merges** onto the stored entry (`mergeRaidBody`): a field left out **or sent as null keeps** the stored value; only an **explicit clear** resets it — `''` (an input the user emptied) or `clear_score: true` (both scores). Applies to every row and detail field (owner, mitigation, response, review date, % , dependency, amount), so owner/mitigation follow the same rule as the score (the old form overwrote them with blanks). A stored legacy kind/status outside today's vocabulary is not carried in (the writer's default applies, as before). Create is unchanged: no score = NULL (fix 34). **Form** (`public/lib/ppmGovernanceW3.js` + new pure `public/lib/ppmRaidForm.js`): each RAID row has an **Edit** button and typing an id pre-fills the form from the loaded entry; on save only the changed fields travel, an emptied pre-filled field travels as `''`, a new entry sends `null` for empty inputs. | smoke "R9-1" (form body with every key null → 3 × 3 kept, RAG stays **red**, ledger `P3×I3`; omitted keys keep; `''` and `clear_score` clear; create stays NULL) + unit merge / form-helper / page-source pins |
| **R9-2** generic risk writer stored 0 / 5 / −1 and answered 500 on 2.5 | P3 | `services/governanceStore.js` `normalise('risk')`: probability/impact must be a whole number **1..3** (the RAID / `riskExposure.level` scale); `''` / null = unscored. Anything else → `INVALID` / `BAD_SCORE` → 400. | smoke "R9-2" (0, 5, −1, 2.5, 'abc', 4 → 400; '' / null → NULL; '2'/'3' → 2/3) |
| **R9-3** card `high_risks` read 0 beside an open unscored entry | P3 | `projectKpis.projectSummary` cards add `unscored_risks` (open in-scope entries with no effective score) and `high_risks_partial`; `high_risks` keeps the known count. The page shows `≥ N` plus "N unscored — the high count is a lower bound". | unit "R9-3"; smoke "R9-3/R9-4" |
| **R9-4 / data R9-1** `partial` computed in the API but never shown | P3 | cards add `rag_partial` (= `rag.components.risk.partial`); the simplified view renders a "partial — some open risks have no score" marker next to the RAG pill. New strings have French entries in `public/lib/i18n/project.fr.js`; the `.w3-partial` style uses `--color-warning*` tokens (no hex literal). | unit "R9-4"; `tests/i18n-coverage.test.js`, `tests/ui-design-ratchet.test.js` green |

## Evidence

- Related suites (ppm-*, governance*, portfolio*, project*, risk*, p11-r6/r7/r8/r9-*, i18n-coverage, ui-design-ratchet,
  a11y-*, kpi-*, figure-parity*, soft-delete*): **921 tests, 920 pass** on the first run; the single failure was the
  chart inventory missing the new `public/lib/ppmRaidForm.js` → `node tools/agent/ui-inventory.js` regenerated, then
  `readme-truth`, `test-runner-guard`, `ui-design-ratchet`, `kpi-docs-links`, `monolith-ratchet`, `i18n-coverage`:
  105/105 pass. PostgreSQL 16 local cluster (not PG17), run id `fix37`.
- `node tools/kpi/unknown-sweep.js --check` → unjustified 0; `node tools/agent/metric-map.js --check` → up to date;
  `npx eslint` on the changed server/test files → 0 errors (`public/` is outside the lint scope).
- Regenerated: `tests/.suite-manifest.json` (+10, total 6060), `docs/agent-execution/INVENTORY*`, README figures,
  `docs/ux/CHART-INVENTORY.md`, `docs/agent-execution/EVIDENCE-MANIFEST.md`. No route changed → authz matrices untouched.

## Not done / left to humans

- Existing rows: entries whose score was already erased by the R9-1 regression (only possible with
  `ppm_raid_enabled` armed) cannot be restored by code — the ledger `ppm_events` keeps the previous `P×I`; a PMO owner
  would re-enter them. Switches stay at their defaults (off).
- The "partial / lower bound" wording and the risk mapping remain **PROPOSED** (KPI Committee, G-12 / HD-P15).
- Carried, not touched: R1-F4/F5/F6 (levelling perf), R7-4 closure-gate policy, R5-8 coverage evidence set.
- Browser check of the Edit / pre-fill flow and the markers was not run (session-gated page); proven by unit + HTTP tests.
