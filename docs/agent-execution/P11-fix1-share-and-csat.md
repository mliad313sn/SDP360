# P11 fix lot 1 — group report share (F1) and unmeasured CSAT on the Group IT deck (F-01)

AI work (Claude), branch `qual/p11-fix1`, base `ede32e44`. Two P1 defects reported by the P11 AI qualification panel
(security seat finding F1, data seat finding F-01). Defect fixes, shipped ON (no switch). No human gate filled.

## F1 — a site editor could publish a group-wide report run to an anonymous link

**Cause.** `routes/engagement.js` (`POST /api/engagement/share`, report_run branch) only checked the site when
`run.site_id != null`; a group-wide run (`site_id NULL`, e.g. an `executive`-audience pack) passed for every editor.
`routes/reportStudio.js` `visibleRun()` (and the `GET /api/report-studio/runs` list, via `reportStore.listRuns`
keeping `site_id == null` rows for every site filter) let any session read published group runs, whatever the
template audience. Contradicts `docs/ops/AUTHZ-MATRIX.md` (share = "admin, editor — userSites": a site-less run has
no site in an editor's scope).

**Fix (narrows only).**
- Share: a site-less run can be shared by the admin tier only (403 for editors). Site runs: unchanged rule.
- `/share/<token>`: a report_run link to a site-less run is served only if its creator still holds the admin tier
  (role read from `user_roles`); a link minted by an editor before this fix now answers 404 (no manual revocation needed).
- In-app read (`GET /api/report-studio/runs/:id[.fmt]` and the runs list): a non-author reads a published site-less run
  only when the template audience is `council` and the account holds `committee-member`. Executive packs stay with
  authors (admin tier / report-author). Authors and site runs unchanged.

**Test.** `tests/report-run-group-share.smoke.test.js` (5) — the panel's repro turned into a regression test:
editor/viewer share of exec + council group runs → 403; editor share of own-site run → 200 and served; admin share of
group run → 200 and served; pre-fix editor link → 404 at view time; viewer/editor read of group runs (single, `.html`,
list) → 403/absent; committee member reads the council run, not the exec run. Without the fix: 3 of 5 fail
(share 200, link 200, read 200).

**Authz outcome snapshot.** `tests/authz-outcomes.smoke.test.js` passes unchanged — its seed has no site-less published
run, so no recorded outcome row changed; snapshot NOT regenerated (zero rows changed). Route matrices
(`authz-matrix-json`, `authz-route-matrix`) unchanged: no middleware changed.

## F-01 — unmeasured CSAT printed as 0 % with a below-target verdict

**Cause.** `tools/exec-pptx/render.py` replaces every None with a default (`csat_pct: 0`, `csat_avg_score: 0.0`,
`nps_proxy: 0`) and CSAT was in neither null list of `kpi_fmt.py`; the server never computes CSAT, so a None always
means "no survey figure". Slide 7 printed "0%", "80.0pp below target", "AVG SURVEY SCORE 0.0%", "Last known CSAT was 0%".

**Fix.** `kpi_fmt.SURVEY_KPIS = (csat_pct, csat_avg_score, nps_proxy)`; `survey_null_kpis(K)` (taken before the
defaults) joins `K['_null_set']`. Slide 7: CSAT tile "—", caption "not measured this month", grey, no verdict; AVG
SURVEY SCORE "—"; NPS tile shown when NPS is measured (0 included) instead of only when non-zero; commentary never
quotes an unmeasured CSAT/average. A measured value (0 % included) renders exactly as before.

**Inverse bug.** `public/executive-report.html` deck payload: `csat.csatPct || null` (and `nps`, `prevCsatPct`,
`prevNps`) turned a measured 0 into "not measured" → `?? null`.

**Test.** `tests/exec-pptx-csat-null.test.js` (5): nulls → no "0%", no "below target", no "0.0%", no "Last known
CSAT", em dash + "not measured"; absent keys same; measured 0 % with responses → "0%" and "80.0pp below target",
average "20.0%"; measured 89.4/NPS +85 unchanged; static check that the browser keeps a measured 0. Without the fix:
3 of 5 fail (null case printed exactly the panel's text). Python libs present, tests not skipped.

## Commands (targeted only — full suite not re-run, per pack rules)

| Command | Result |
|---|---|
| new F1 test, fix / no fix | 5/5 pass · 2 pass 3 fail |
| new F-01 test + `exec-pptx-python`, fix / no fix | 7/7 pass · 2 pass 3 fail |
| `report-studio-routes.smoke`, `engagement-routes.smoke`, `export-share-boundary.smoke`, `authz-outcomes.smoke`, `report-release.smoke` | 23 pass, 0 fail |
| `exec-deck-payload`, `exec-pack-portfolio`, `exec-payload-null`, `figure-parity-five-surfaces` | 26 pass, 0 fail |
| `authz-matrix-json`, `authz-route-matrix`, `readme-truth`, `test-runner-guard` | 25 pass, 0 fail |
| `node tools/agent/inventory.js` (+ `--strict`, `--check`) | regenerated, up to date |
| `npx eslint .` | clean |

## Remaining / human
- Existing share links to group runs created by non-admins die at view time; nothing to revoke by hand.
- Whether a `council` group pack should also be readable by other governance roles (e.g. `kpi-committee`) is a
  policy question for InfoSec/committee — today's fix keeps it to `committee-member` + authors (narrowest).
- F-01 severity (P0 candidate) ruling remains with a human reviewer; slide 7 is now honest either way.
