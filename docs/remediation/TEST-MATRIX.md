# TEST-MATRIX (M00 Phase 0)

| Test ID | Layer | Scenario | Command | Env | Exit | Result |
|---|---|---|---|---|---|---|
| T-M01-001 | unit+smoke | declared suite, no .env | `npm test` | Linux/Node 22/sqlite | 1 | 2392 pass / 62 fail (61 env) / 105 skip |
| T-M01-002 | unit+smoke | declared suite, DASH_USER/PASS set | `DASH_USER=… DASH_PASS=… npm test` | same | 1 | 2438 pass / 1 fail (esbuild pruned by `--omit=dev`, resolved by `npm ci`) / 2 cancelled / 109 skip |
| T-M01-003 | static | syntax + eslint | `npm run lint` | same | 0 | pass |
| T-M01-004 | SCA | npm audit high | `npm run audit` | same | 0 | 0 vulns after lockfile fix |
| T-M01-005 | pg parity | ~105 pg tests | `PG_TESTS_REQUIRED=1 npm test` | needs PostgreSQL | — | **BLOCKED** (no PG) |
| T-M01-006 | browser E2E | shell/persona smoke | — | needs approved browser target | — | **NOT RUN** |
| T-M02-001 | smoke | every `/api` route anonymous → 401/403 except PUBLIC list | `node --test --test-force-exit tests/route-authz.smoke.test.js` | sqlite | 0 | pass (pre-existing test) |
| T-M02-002 | smoke | dash key not injected for anonymous / forged session; still injected for valid session | `node --test --test-force-exit tests/dashkey-injection.smoke.test.js` | sqlite | 0 | 18/18 pass; 12/18 fail on base `758a996` |
| T-M02-003 | probe | route × {none, dashkey, viewer} matrix | `SDP_TEST_NO_RATE_LIMIT=1 node tools/qa/route-matrix.js out.json` | sqlite | 0 | RBAC-MATRIX.md |
| T-M01-007 | unit+smoke | declared suite with NO .env (run 2) | `npm test` | Linux/Node 22/sqlite | 0 fail | 2612 tests · 2501 pass · 0 fail · 2 cancelled (fixed after, 10/10) · 109 skip (PG/snapshot) |
| T-M02-004 | smoke | dash key alone reaches only the 19 known legacy routes; new key-only route fails | `node --test --test-force-exit tests/dashkey-injection.smoke.test.js` | sqlite | 0 | 19/19 pass; verified to fail when an entry is removed |
| T-M02-005 | smoke | object-ID substitution: site-A editor vs site-B meetings action/issue/sign/delete + inspection action/delete/export; positive control on own site | `node --test --test-force-exit tests/cross-site-object-writes.smoke.test.js` | sqlite | 0 | 5/5 pass; mutation (site check removed from meetings action update) → fails |
| T-M06-001 | smoke | site-business + group-business sessions: full GET sweep ⊆ allowlist; writes 403; Zoho fleet readers refused; mixed-role account unaffected | `node --test --test-force-exit tests/business-only-boundary.smoke.test.js` | sqlite | 0 | 5/5 pass; 4 fail without the guard |
| T-M01-008 | unit+smoke | declared suite after run 7 | `npm test` | sqlite | 0 fail | 2630 · 2521 pass · 0 fail · 109 skip |
