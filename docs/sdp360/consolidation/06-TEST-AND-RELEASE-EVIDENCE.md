# 06 — Test and release evidence

Runner: `npm test` → `tools/test/run-all.js` (force-exit + blocking stdio + per-file reporter + census against
`tests/.suite-manifest.json`). Every run prints `[test-guard] files a/b · tests n · failed f · skipped s · floor m`
and one line per skip reason. A run **fails** when: any test fails, a file reports nothing, a listed file is gone,
a file reports fewer tests than its manifest entry, or a test file is not in the manifest.
Adding tests: run a green suite with `npm test -- --update-manifest` and commit the manifest diff (reviewed).

| Date | SHA | Env | Command | Files | Tests | Fail | Skip (reasons) |
|---|---|---|---|---|---|---|---|
| 2026-10-28 | `fb78494` (2.0 base) | Linux, Node 22.22.0, no .env | `npm test` | 377/377 | 2706 | **64** (env: DASH_USER/DASH_PASS) | 102 |
| 2026-10-28 | `645f940` | same | `npm test` ×2 | 377/377 | 2744 | 0 | 106 (78 no pg · 18 PG unreachable · 9 snapshot · 1 python) |
| 2026-10-28 | `645f940` | + PG 16 | `PG_ADMIN_URL=… PG_TESTS_REQUIRED=1 npm test` | 377/377 | 2744 | 0 | 11 (10 snapshot · 1 python) |
| 2026-10-28 | `efd92e9` | + PG 16 | idem | 380/380 | 2762 | 0 | 11 |
| 2026-10-28 | `9e7d5f1` | + PG 16 | idem | 380/380 | 2762 | 0 | 11 |
| 2026-10-28 | `9e7d5f1` | no PG | `npm test` | 380/380 | 2762 | 0 | 106 |

Other gates at `9e7d5f1`: `npm audit --omit=dev --audit-level=high` → 0; `npm run build:check` → fresh;
`node db/migrate.js --apply` ×2 on an empty PG 16 db → 27 then 0. Not available here: browser E2E, Windows/IIS,
PG 17, real endpoints, signed artefact verification (D-12).

## Release status

**NO-GO** for production (by design of this goal: no deployment, no merge into the default branch without
explicit human authorization). Release gates are tracked in [09](09-DELIVERY-STATUS.md).
