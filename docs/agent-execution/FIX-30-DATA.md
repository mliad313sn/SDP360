# P11 round 7 — fix lot fix/p11-r7-data (data-kpi seat F-29/F-30/F-31 + PPM seat R7-1/R7-2/R7-3)

AI-authored engineering evidence — not an independent human review. No approval, signature, production readiness or
field acceptance is claimed. Base `7ea49070` (the round-7 frozen SHA). Findings from the round-7 data-kpi and PPM AI
reviews (kept outside the repository). Every new test was run against the old `services/`, `routes/`, `public/`
(`git stash push -- services routes public`) and seen FAILING (10 of 10: 9 in `tests/p11-r7-data-fixes.test.js`,
1 in `tests/p11-r7-ppm.smoke.test.js`), then passing after the fix.

## Findings fixed

| Finding | Sev | Fix | Regression test |
|---|---|---|---|
| F-29 project RAG risk input = inherent max P×I with its own bands (amber > 5, red > 8); residual ignored; an unscored risk read 0 ("no risk", green) | P2 | `services/ppm/riskExposure.js`: `pairScore`, `effectiveScore` (residual first, same precedence as `effective`), `projectScore` (highest effective score of an open risk/issue; **null** when no open entry has a known score, or when an unknown sits beside known entries that are not high/critical; 0 only when rows exist and none is open), `SCORE_MIN` + `RAG_THRESHOLDS` derived from the one mapping (critical → red, high → amber). `projectKpis.riskScore` delegates to `projectScore`; `projectRag.DEFAULT_THRESHOLDS.risk_score` IS `RE.RAG_THRESHOLDS` (no second literal). `portfolioEvidence.riskView` exposure via `pairScore` (value unchanged). The numbers 8/5 are unchanged — the input changes (residual first, unknown = null). Still behind `ppm_project_rag_enabled` (default off) | `p11-r7-data-fixes` F-29 ×4: residual 1×1 under inherent 3×3 → green; residual 3×3 → red; RAG red/amber ⇔ `isHigh`; unscored → null (component NA); unknown + known low → null; known high never hidden; guard extended (literal `red_enter`/`amber_enter` on `risk_score`, local `Math.max(P×I)`, `Number(probability)*Number(impact)`), with a self-test that the r7 shapes are caught |
| F-30 / R7-3 card "active risks 0 · high 1" (active = kind risk only; high = risks + issues); `riskScore`, `top_risks`, `raid.review_overdue` strict `status === 'open'` | P3 | `projectSummary` active = `RE.isOpen && RE.inScope` (risks + issues, assumptions out) — same population as `isHigh`, so high ⊆ active; labels "Active risks + issues · high" (`public/lib/ppmGovernanceW3.js`) and "Open risks + issues / high" (`services/ppm/projectReport.js`). `top_risks`, `raid.review_overdue`, `portfolioDeck` RAID slide and the governance HTML risk list (`routes/governance.js`) use the shared case-insensitive `isOpen`; `top_risks.score` = effective score | F-30 ×2 (issue-only → 1·1; legacy `Open` row counted everywhere; `Mitigated` out; fuzz high ≤ active; no strict filter left in the four files). `ppm-w3-pure` card parity updated: active 2 → 3 (the open issue now counts — intended) |
| F-31 Vue Groupe: helpdesk cell red on its CLOSED band (20/20 missed) did not cap the site overall; a 1-ticket closed base read green | P3 | `services/siteHelpdeskSla.fleetCell`: `cap` = the cell's own red/amber, whichever band produced it; a closed base below `min_closed` is shown (`value`) but not judged (`insufficient: true`, `min_closed`) → `na` unless the open band is bad. `min_closed: 5` added to kpiRag policy `helpdesk-fleet-sla` — **PROPOSED (G06)**, chosen as the smallest base on which one miss is ≥ 20 % (an AI engineering default, not a committee decision). Route passes `insufficient`; page tooltip EN/FR says it; FORMULA-REFERENCE §1 updated (and one citation re-anchored, `routes/siteAwareness.js:165 → :166`) | F-31 ×2 (20/20 missed → cell red, cap red, overall red; amber caps amber; 1/4 closed → na; 5 closed → judged; r6 case "1 closed + 40 open overdue" still red) |
| R7-1 project demand: a shared cell where this project alone already exceeds capacity read NA, `load.over` 0 | P3 | `routes/governancePortfolioPhase2.js` project demand: a cell already RED on this project's own known demand keeps RED (`own_demand_over_capacity: true`); `load.over` recomputed after the greying | smoke R7-1 (P1 2.0 FTE vs cap 1.5, shared with P2 → RED, over 1) |
| R7-2 per-cell `shared_with_other_projects` told a site-scoped reader that an unreadable project demands a skill in a month | P3 | the flag is returned only when the reader can read every project carrying demand (`readable(req)` covers all `demandProjectIds`); otherwise no per-cell flag, every cell without a certain RED gets no colour (solo or shared — indistinguishable, so nothing leaks), and a neutral response-level `view_partial` + note (as `/portfolio/capacity`). No other project's name, id or figure is returned | smoke R7-2 (site viewer: 404 on P2; no flag in any cell; P2 never named; certain RED kept; solo cell NA; `view_partial`) |

## Policy item (not changed)

- **R7-4** — the closure-gate behaviour introduced with r6 F-27 (an open high ISSUE blocks closure; a recorded residual
  low/medium releases a high inherent risk) is a business rule. It is now labelled **PROPOSED** at its source
  (`services/governanceStore.js`, `gateCounts` comment) for the KPI Committee (G-12) / closure policy (D-04), together
  with the evidence a residual score requires. The rule itself was not changed.

## Behaviour changes to note

- Project RAG (when `ppm_project_rag_enabled` is armed): a mitigated risk no longer reds the project; an open risk with
  no score gives a grey risk component instead of green. Thresholds remain PROPOSED (`ppm_rag_thresholds`).
- Project card: "active" now counts open issues too (label changed).
- Vue Groupe: a site whose closed tickets mostly breached SLA is capped amber/red overall; a site with 1–4 closed tickets
  in the window gets a grey helpdesk cell (unless open overdue). Bands, minimum base and cap rule PROPOSED (G06).
- Project demand panel, partial readers: no colour except a certain RED (previously solo cells kept a colour).

## Checks run (this worktree, PostgreSQL 17, `SDP_TEST_RUN_ID=fix30`)

- New tests failing-first (10/10 red on the stashed old code) then green.
- Related suites: `ppm-*`, `portfolio*`, `governance*`, `site-awareness*`, `risk*`, `kpi-*`, `figure-parity*`, `p11-*`
  (126 files, 742 tests) — 741 pass, 1 fail (a stale doc citation, fixed, then re-run green); plus 23 further files that
  import the changed modules, `authz-outcomes(.lots-on).smoke`, `kpi-docs-links`, `ppm-w3-pure` — 250/250. Authorization
  outcome snapshots unchanged.
- `npx eslint .` clean; `tools/kpi/unknown-sweep.js --check`, `tools/agent/metric-map.js --check` clean.
- `tests/.suite-manifest.json` +10 (5 979 → 5 989).

## Human decisions left

- KPI Committee (G06 / G-12): `helpdesk-fleet-sla` bands, `min_closed` 5 and the cap-on-any-band rule; residual vs
  inherent for the project RAG and the `risk_score` bands; the closure-gate rule (R7-4).
- PMO: `ppm_rag_thresholds`, risk score → level mapping (PROPOSED in `riskExposure.js`).
