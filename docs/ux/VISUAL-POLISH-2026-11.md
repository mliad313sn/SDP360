# Visual polish 2 — progress file (branch `feat/visual-polish-2`)

AI UX committee review — not user research. This file lets a successor resume: the container restarts about every
40 minutes, so every finished item is committed and noted here.

Reports: `/home/user/ux-committee/{visual,site-coordinator,executive,admin,a11y-fr,ia-value,field}.md`.
How to run one e2e journey: `PG_ADMIN_URL=postgres://sdptest:sdptest-local-only@localhost:5432/postgres SDP_TEST_RUN_ID=polish2
E2E_ARTIFACT_DIR=/tmp/claude-0/polish2-e2e node --test --test-force-exit --test-concurrency=1 tests/e2e/<spec>` (start PostgreSQL first).

## Priority 1 — trunk e2e red after the first polish merge

| Journey | Cause | Fix | State |
|---|---|---|---|
| T7 French help | the shell help entry is now the contextual "?" (`help.html#chapter`), no bare `a[href="help.html"]` | spec follows the new entry (`a.shell-help`, anchor asserted) | green |
| V1 viewport | legacy bodies wrapped in `<main class="edv-main">` (display:contents, no box) — the helper skipped it and found nothing | `tests/e2e/fixtures/layout.js` steps INTO a display:contents element; the 6 known 320 px overflows fixed, allow-list emptied (ceiling 0) | see below |
| UAT S1, S2, S7, S8 | to diagnose | | pending |

## Priority 2 — committee findings

(filled as items land)
