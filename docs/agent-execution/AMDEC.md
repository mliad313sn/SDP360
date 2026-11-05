# AMDEC committee — agent-executed scenario campaign (5 Nov 2026)

Branch `goal/amdec` (from `sdp-waves`). Report (French): `docs/audits/2026-11-05-amdec/RAPPORT-AMDEC.md`; catalogue
`SCENARIOS.md`; matrix `AMDEC.md`; follow-ups `FOLLOW-UP-GOALS.md`. **Evidence level: code+test on fictitious data. Not
user acceptance; no approval, signature or production readiness is claimed.**

## What was built
- `tests/_uat-world.js` — seeded multinational world (15 sites, 5 countries, XOF/GBP, 21 accounts, 10 organisation models).
- `tests/uat-amdec-org-models.smoke.test.js` (13), `tests/uat-amdec-multinational-data.test.js` (9),
  `tests/uat-amdec-workflows.smoke.test.js` (6); `tests/e2e/u1-multisite-french.spec.js`, `tests/e2e/u2-executive-review.spec.js`
  (mapped in `docs/ops/PERSONA-JOURNEYS.md`). Naming deviation: the runner and `_pg-boot.mjs` only pick `tests/<file>.test.js`,
  so the files are `tests/uat-amdec-*.test.js`, not `tests/uat/*.test.js`.

## Fixes (failing first, then green)
| Mode | Files | Failing-first evidence |
|---|---|---|
| AM-05 unknown-currency money = null | `assets-db.js` (+ `tests/assets-finance-readers.test.js` expectation 0 → null) | DAT-03 `actual: 0, expected: null` |
| AM-06 impossible weeks refused | `reports-db.js` (`zohoWeeksInYear`, export `getISOWeek`), `server.js` ensure route | DAT-05 (weeks 53/99/-1 created reports) |
| AM-01 shared site code reported | `services/siteCodeRegistry.js` | ORG-e3 red with the HEAD version of the file |
| AM-13 report list escaping | `public/reports.html` `loadReportList` | WF-06 red before |

## Test runs
- 45 files (campaign + neighbours): 347 tests, 347 pass, 0 fail, 0 skipped (before WF-06); WF-06 file + i18n-coverage + a11y-static: 65/65.
- `node tools/test/run-e2e.js --runs=1`: 12 journeys + 1 browser unit green, 0 external request.
- `npx eslint` on touched JS: clean. `server.js` 7 903 lines (budget 7 910).

## Left for a person
TND owner (Assafo vs Tanda); SDP label typo; registry switch-on; Site Awareness scope; KPI-threshold owner; currencies/rates;
pilot-user UAT per country/model; screen-reader session; TEST install/restore; CAB; production go/no-go.
