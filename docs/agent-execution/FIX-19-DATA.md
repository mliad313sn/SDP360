# P11 round 5 — fix lot fix/p11-r5-data (data / KPI)

AI-authored engineering evidence — not an independent human review. No approval, signature, production readiness or
field acceptance is claimed. Base `0e97838e`. Findings from `/home/user/qual/out/r5-data-kpi.md` (repros
`/tmp/claude-0/p11attack-r5/drill.js`, `risk.js`, `ddl.js`). All new tests are in `tests/p11-r5-data-fixes.test.js`
(14); every one was run and seen FAILING before the fix (14/14 fail), passing after (14/14 pass). PostgreSQL 16 test
cluster (the PG17 target is still not verified).

| Finding | Sev | Cause | Fix | Regression test |
|---|---|---|---|---|
| F-21 Lot 3 KPI card / standard-report count ≠ the list its link opens | P2 | cards and reports counted inside the filtered set, but the page merges the link patch with `Object.assign` and so REPLACED an active key of the same name | ONE rule, written in `services/ppm/portfolioRegister.js`: each card and report carries `drill`, the exact patch its link merges, and its count is computed on that merged state. A list key the card narrows (priority, decision_required) is INTERSECTED with the active selection; an empty intersection = no link and a count of 0. The report slot is a single choice: a report link selects its report in place of the active one (other filters stay) and its count uses that choice. The page now uses `r.drill` for report links | F-21 ×3 (reviewer repros: priority=low + Critical/high card; report=on_hold + "without owners" link; every card × report × 8 active filter states) |
| F-23 three "high risk" definitions | P2 | Lot 3 register + step-8 `riskView`: inherent P×I ≥ 6, any kind, null score → 0 → "low"; Lot 4 alerts: same severity but kind risk only; Lot 6: residual first, null → unknown | `services/ppm/riskExposure.js` is the ONE rule: `effective(r)` (residual when both residual scores are known, else inherent; null when unknown) and `isHigh(r)` (open, kind risk / issue — assumptions excluded — effective level high / critical). Used by the Lot 3 register (`high_risks`, report `high_risk`), the Lot 4 alert `high_risk` and `portfolioEvidence.riskView` / `portfolioSummary.high_risks` (step-8 summary, portfolio deck). `riskView` severity = effective level (critical → 'high'), null when unknown; `exposure` = inherent score or null | F-23 ×4 (3×3 inherent → 1×1 residual = not high on register, alerts and Lot 6; 1×1 → 3×3 residual = high everywhere; null score = null; issue counts / assumption does not everywhere) |
| F-22 partial data shown as a verdict | P3 | sums / levels over the known part only | (a) Lot 6 demand: a dated line without average FTE is counted in its cells (`unknown_lines`, `partial`); such a cell reads `NA` (utilisation null) unless the known lines alone are already over capacity (RED is then certain); the page shows "≥ x (+n ?)". (b) Risk rollup: `unknown`, `partial`, `level_at_least`; `level` is null when unknown-score risks sit next to a known low / medium, kept when the known top is high / critical (a known alarm is never hidden); portfolio totals put such a project under `unknown`; the page shows "≥ level · n risk(s) with an unknown score". (c) Group Home worst sites: `measured` / `unmeasured` travel with the verdict, the line reads "no site in red or amber (1 measured · 10 not measured)"; all unmeasured stays "—". (d) Lot 3 Data-quality card: `scope` = `with_budget_checks` / `without_budget_checks`, rendered under the card (EN / FR) | F-22 ×4; `tests/adoption-lotb-home.test.js` updated for the new `worstSites` shape |
| F-24 site-view tooltip claims dictionary parity; group grid helpdesk cell = overdue ÷ created | P3 | the monthly dictionary reader is flag-only; the fleet cell counted open / cancelled flagged tickets | tooltip (EN / FR) now states the rule: the dictionary's monthly Resolution SLA always counts the SDP overdue flag, so the two agree only under the `flag` rule (the dictionary reader is NOT changed: `helpdesk_sla_definition` is a committee switch, G06). The fleet cell now uses `services/siteHelpdeskSla.fleetCell` over the window reader's `res_sla_den` / `res_sla_missed` (closed-only doctrine, configured mode passed through); value "missed/closed"; nothing closed → na. Same bands as before (< 5 % / < 15 % missed), now on closed tickets — display only, PROPOSED. Column legend updated | F-24 ×2 |
| F-25 destructive-DDL detector misses quoted dynamic SQL, DROP DOMAIN, DROP OWNED | P3 | tokens kept the leading quote (`'DROP`); DOMAIN / OWNED not listed | quotes and `(` become separators before tokenising; DOMAIN and OWNED added. All 110 shipped scripts still classify non-destructive | F-25 ×1 (+ existing `tests/pg-migrate-destructive.test.js`) |

Re-run of the reviewer repros on this tree: `drill.js` — the Critical/high card under priority=low now reads 0 with NO
link (the script merges a null drill, so its "2" is the unfiltered-merge artefact, not a link the page renders);
"without owners" 1 = 1. `risk.js` — risk 1: low / low; risk 2: null / null; register `high_risk` empty, Lot 6 low /
null. `ddl.js` — the three missed variants are now destructive (run-once).

Behaviour changes to note (all on default-off portfolio switches, except the site-awareness fleet grid):
- standard-report counts are now the size of the list the link opens (other filters kept, report slot replaced), no
  longer "inside the active report";
- a high-risk verdict now follows the residual score when both residual scores are set; issues count, assumptions do
  not, on every surface; an unknown score is no longer "low";
- the Vue Groupe helpdesk cell (and so the group Home worst-sites ranking) now colours on closed tickets only.

Left to humans (not decided here): residual vs inherent for the PMO alert rule and the risk level mapping (PROPOSED,
`REGISTRE-DECISIONS-HUMAINES.md`); the fleet helpdesk bands and whether the dictionary monthly reader should honour
`helpdesk_sla_definition` (KPI Committee, G06); capacity thresholds (PMO). Carried P3s F-11, F-12, F-13, F-15, F-06,
F-08 are not in this lot.
