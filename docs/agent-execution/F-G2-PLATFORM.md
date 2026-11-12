# F-G2-PLATFORM — Express 5 + dotenv 18 (2026-11-12, branch `goal/g2-platform`)

Agent execution evidence. Nothing is pushed or merged; every change waits for a person's review and CI.
Context: `docs/agent-execution/F-F1-OPS.md` and `DEPS-TRIAGE.md` (#6, #8) deferred both bumps.

## Verdicts

| Goal / audit action | Verdict | What changed | Test proof |
|---|---|---|---|
| 1a. Read-scope guards rely on `req.query` mutation (SECURITY under Express 5) | **FIXED** | `routes/meetings.js`, `routes/inspection.js`: the guard sets `req.scopedSites`; list handlers read `_listSite(req)` (scoped sites, else the validated `?site=`). Never written back to `req.query`. | `tests/read-scope-express5.smoke.test.js` serves the real app with an Express-5-style `req.query` getter: **2/5 fail before the fix** (meetings list leaked `MGO,SGO`; inspection list leaked site B), 5/5 after |
| 1b. Inline-regex route rejected by path-to-regexp v8 | **FIXED** | `routes/reportStudio.js`: `/runs/:id.:fmt` + a `knownFormat` check (`next('route')` for an unknown suffix, same fall-through as before); still behind `requireReportSession` (AUTHZ-MATRIX row updated) | `tests/express5-route-syntax.test.js` (static scan of every route literal; self-test flags the old form); report-studio + report-release smokes green |
| 2. express 4.22.3 → 5.3.0 | **FIXED (taken)** | Two further silent failures found by running the suite on Express 5: (a) `app._router` is gone → the authz shadow/enforce instrument wrapped **no guard** (capability enforcement failed open; `access-why` E-S01 red) and every route walker/boundary test saw an empty table → `services/routerStack.js` (Express 4 + 5) used by `services/authzShadow.js`, `tools/agent/authz-walk.js`, `tools/qa/route-matrix.js` and 8 tests; (b) body-parser 2 leaves `req.body` undefined on a body-less request → handlers destructuring it 500 → `services/bodyDefault.js` in front of the global JSON parser (same `server.js` line, no new line) | `tests/router-stack.test.js` (real app: every tagged guard instrumented); `tests/body-default.test.js` (a bare POST returned 500 on Express 5 without the shim); full suite on Express 5: first run 25 failures → 0 |
| 3. dotenv 16.6.1 → 18.0.10 | **FIXED (taken)** | `quiet: true` at all 42 shipped `config()` calls (`server.js`, `db/migrate.js`, `tools/**`) | `tests/dotenv-quiet.test.js` (every shipped load is quiet; the installed dotenv prints nothing and still loads — without `quiet` it prints `◇ injected env`); `reports-cli-dotenv`, `boot-config`, `backend-guard` green |
| 4. Licence inventory + DEPS-TRIAGE | **FIXED** | `docs/sdp360/completion/LICENCE-INVENTORY.csv` regenerated; DEPS-TRIAGE gains a G2 execution section; INVENTORY / INVENTORY-STRICT / AUTHZ-MATRIX regenerated | `licence-inventory`, `agent-inventory`, `inventory-strict`, `authz-route-matrix` green |

## Test runs (PostgreSQL 16 local, `PG_ADMIN_URL` throwaway role, not committed)

- Full suite (`node tools/test/run-all.js`) on Express 5 + dotenv 18, final state: **729 files, 4878 tests, 0 failed, 10 skipped** ("no prod-snapshot", pre-existing).
- E2E journeys (`node tools/test/run-e2e.js`, run on Express 5 before the `bodyDefault` change): **40/40 pass**; browser unit tests run separately: **4/4**.
- Ratchets: error-shape, server-size budget (6995 ≤ 6996), flag-register, authz-route-matrix green. Test DBs dropped.

## Deviations

- Lockfile: the express 5 bump also hoists `debug@4`/`ms` (nested copies under eslint, agent-base, https-proxy-agent removed) — a consequence of express 5's dependency tree, no other package changed version.
- `tools/agent/authz-walk.js`, `tools/qa/route-matrix.js`, `services/authzShadow.js` and 8 route-walking tests were touched (not listed in the goal) because Express 5 removed `app._router`; without it enforcement fails open.

## Items left for a person

1. **`tools/test/run-e2e.js` crashes after a green run** (`a.external` undefined): the UAT specs write `uat-s*.json` (different shape) into the artefact directory, and the summary loop reads them as journey artefacts. Pre-existing since the UAT-F merge, unrelated to Express; the journeys themselves passed 40/40. Owner: e2e harness.
2. Re-run the e2e job in CI on the final commit (the local e2e run predates the `bodyDefault` one-line change).
3. CI + review of both bumps; first days in prod: watch pm2 logs for 500s on body-less POSTs and for `authz_enforce_denied` volumes (the instrument now actually wraps on Express 5 — it already did on Express 4).
4. The legacy `ops/legacy-scripts/_stage_palier2_*.cmd` echo a `require('dotenv').config()` hint without `quiet` — documentation only, out of scope.
