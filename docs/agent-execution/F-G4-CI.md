# F-G4-CI — red e2e job, SLA denominators, evidence reseal

Branch `goal/g4-ci` (from `55dc67c`). No migration used. `server.js` and `public/reports.html` not touched.
`reports-db.js` edited for goal 2 only (allowed for this lot). No flag added (two defects ship ON, one reader
field is additive). Evidence level: **code+test** — nothing here is browser-checked by a person or accepted.

## Root cause of the red CI job

GitHub run `43227102787`, job `131212977098` ("e2e", step "Browser journeys, twice in a row"), head `55dc67c`.
The job log (read through the GitHub API) shows **pass 1: 40/40 journeys green**, then:

```
tools/test/run-e2e.js:57  … unexpected_external: a.external.unexpected_count …
TypeError: Cannot read properties of undefined (reading 'unexpected_count')
```

1. **Runner crash (cause of the red job).** `run-e2e.js` treated every `*.json` in the artefact directory as a
   journey artefact. The UAT committee helper merged in `3367343` (`tests/e2e/fixtures/uat.js` `finish()`) writes
   `uat-<seat>.json` (`{seat, simulation, results}`, no `journey`, no `external`) into the same directory → the
   first UAT record crashed the runner after pass 1. Pass 2 **never ran in CI**.
2. **Hidden behind it: a product race exposed by pass 2.** With the runner fixed, the first local `--runs=2`
   went red on pass 2: journey **C1** timed out (`page.waitForFunction: Timeout 15000ms exceeded`). `meeting.html`
   enabled the "Stamp signature" buttons before the PV had loaded; a click during the load posted an empty header
   (no site, no edit token), the save failed, the optimistic paint was undone and the signature never landed —
   load-dependent (passes alone, fails on a busy runner). Reproduced deterministically with a 2.5 s delay on
   `GET /api/meetings/:id`: committed page **red** (same timeout), fixed page **green**.

Not a skip, not a retry, not a longer timeout.

## Verdict table

| Goal | Action | Verdict | What changed | Proof |
|---|---|---|---|---|
| 1 (`dda0fb0`) | e2e runner crash | FIXED | `tools/test/e2e-artefacts.js` (pure): journey / uat / other classifier; a UAT record goes to `summary.side_records` (flows by status per run); a journey artefact missing `external`/`page_errors` is a **problem**, never a crash or a silent pass; unparsable JSON is a problem. `run-e2e.js` delegates to it; `perf-baseline.js` skips non-journey artefacts | `tests/e2e-artefacts.test.js` (6) |
| 1 (`dda0fb0`) | C1 stamp-before-load race (product defect, ON) | FIXED | `public/meeting.html`: both stamp buttons start `disabled`, `_pvReady` set and buttons enabled only after `loadLookups()` + `reload()`; a click before that is ignored | `tests/meeting-stamp-guard.test.js` (+1); slow-load reproduction above; `--runs=2` × 2 below |
| 2 (`435ab06`) | F-DATA-07: SLA denominators | FIXED | `reports-db._getCalendarMonthlyHelpdeskPg` returns `sla_res_den` (closed, SLA-bearing, not cancelled) and `sla_reply_den` (responded) — the exact denominators of the two percentages; `null` when there is no base (no ticket, or none in that base), never 0. `metricRegistry` already carried them (`READERS['helpdesk.calendar_month']` + `BASES`), so the tile base, definition drawer, report-pack `n` and the low-sample guard now show "n = … closed tickets" instead of "base not measured". `DECISION-KPIS-PROPOSAL.md` updated; KPI docs re-anchored; METRIC-LINEAGE / METRIC-WIDGET-MAP regenerated | `tests/uat-itsm-figures.test.js` (+1: DB counts, null cases, end-to-end through `registry.resolve` → `base`) |
| 3 | Evidence manifest | FIXED | `node tools/agent/evidence-manifest.js` resealed (it listed 14 unsealed evidence files from waves F1/F2/R1/R2/UAT + this file) | `node tools/agent/evidence-manifest.js --check` → exit 0 |

## Test runs (local, PostgreSQL 16, Chromium headless)

- e2e, exactly as `ci.yml` (`npm run test:e2e -- --runs=2`, `TZ=UTC`, `PG_TESTS_REQUIRED=1`):
  - before the C1 fix (runner fixed): pass 1 40/40, pass 2 39/40 (C1) → RED — this is what CI would have shown.
  - after both fixes: **GREEN twice in a row** — two consecutive `--runs=2` invocations, each 40/40 + 40/40 journeys + 4/4 browser unit tests, 0 problems in `summary.json` (8 UAT side records summarised, not counted as journeys).
- Focused: e2e-artefacts, perf-baseline, e2e-harness, meeting-stamp-guard, ui-design-ratchet, error-shape → 26/26;
  13 test files reading `meeting.html` → 115/115; uat-itsm-figures + kpi-contract-completion + metric-registry-integrity
  + dashboard-sample-size + exec-scorecard-registry-parity + uat-amdec-multinational-data + trust-label + state-badge +
  dashboard-multiples + pptx-meetings-all-decks + kpi-docs-links + await-precedence → green.
- Generators: inventory, flag-register, metric-map, metric-lineage `--check` → up to date.
- Error-shape ratchet unchanged (no `res.status(...).json(` added); no hex literal added.

## Left for a person

- Push the branch and confirm the GitHub "e2e" job is green on the next head (not pushed by this lot).
- C1-style races: other pages that enable an action before their initial fetch were not audited here.
