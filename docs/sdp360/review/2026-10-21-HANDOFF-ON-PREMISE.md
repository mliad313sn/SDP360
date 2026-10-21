# SDP360 — On-premise handoff (2026-10-21)

Branch: `claude/sdp-dashboard-analysis-55b1oy` (pushed, HEAD `ebc5432` + this file).
Get it on the on-prem box:

```cmd
git fetch origin claude/sdp-dashboard-analysis-55b1oy
git checkout claude/sdp-dashboard-analysis-55b1oy
npm ci
```

## 1. What is done

- Plan `docs/sdp360/08` steps 2–10 (migrator, metrics registry, security/SSO, installer v2,
  design system + exec space, tracker builder, cockpit/portfolio/RFI, reports IA, offline field PWA).
- Remediation wave 1: C1, C2, E1, E2, E3, E4, E5, E6, E11, M4, M7, M9; M12 started (M12-a only).
- 2027 Goal 01 (truth register) and Goal 02 (commitments, flag `commitments_enabled='0'`).
- Last verified tests: commitment + restore-drill suites 21/21 on sqlite + PG.
  **Full suite NOT re-run since the last merge.**

## 2. What remains (in this order)

1. **G8.6 — DONE and merged** (`tests/test-runner-guard.test.js`, `tools/test/`, `npm test` now
   prints `[test-guard] files N/N · tests T · failed F`). In the cloud worktree it reported
   **94 failures / 2724 tests, identical on 3 runs** — failing tests NOT yet identified; part of them
   are expected worktree-only noise (no `.env`, `.git` is a file). Re-measure on-premise in the main checkout.
2. **Full suite green** on sqlite and PG (`PG_TESTS_REQUIRED=1`): `npm test > n.log 2>&1` then
   `findstr /B "not ok" n.log`, fix each real failure.
3. **2027 Goal 03** — native portfolio, routines, 5-dimension site dashboard (absorbs E9).
4. **2027 Goal 04** — catalogue R01–R16, rules A01–A16.
5. **2027 Goal 05** — connectors (OpManager only for infra), measured value.
6. **Wave 2:** E7, E8, E10, M5, M6, M13, M16, M17.
7. **Wave 3:** M1, M2, M3, M8, M10, M11, M12 (rest), M14, M15, M18, M19, M20, F1.

Specs: `docs/sdp360/review/2026-10-20-PLAN-DE-REMEDIATION-PROMPTS.md` (one section per fiche)
and `docs/sdp360/2027/briefs/2026-10-21-MASTER-GOAL-2027.md` (Goals 03–05).

## 3. Human actions (not code)

- Decide the ~30 open rows in `docs/sdp360/review/DECISIONS-EN-ATTENTE.md`.
- Verify CI action SHAs (`gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`) — written from memory.
- Replace placeholder `tools/manifest-public.pem` with the real public key of `SIGNING_MANIFEST_KEY`.
- Provide the Authenticode certificate (`SIGNING_CERT_PFX_BASE64`) and check `SIGNING.txt` on first release.
- Set `SDP_BACKUP_KEY` (≥16 chars) and `backup_offsite_path`.
- Deploy (ZIP → `_apply_on_prod.cmd` → `_pm2_restart_prod.cmd` → `mark-deployed.cmd`) and browser-test.

## 4. Test command

```cmd
set DASH_USER=admin
set DASH_PASS=TestPassword1234!
set TZ=UTC
set PG_ADMIN_URL=postgres://postgres:<pwd>@localhost:5432/postgres
set PG_TESTS_REQUIRED=1
node --test --test-force-exit tests/*.test.js
```
Read the `skipped` line: non-zero is not a pass.

---

## 5. Prompt to paste into Claude Code on-premise

```text
You are continuing the SDP360 programme in this repo, branch claude/sdp-dashboard-analysis-55b1oy.
Read CLAUDE.md, then docs/sdp360/review/2026-10-21-HANDOFF-ON-PREMISE.md, then
docs/sdp360/review/2026-10-20-PLAN-DE-REMEDIATION-PROMPTS.md and
docs/sdp360/2027/briefs/2026-10-21-MASTER-GOAL-2027.md.

Work through section 2 of the handoff IN ORDER, one item at a time:
1. G8.6 is done (test-runner guard). Run `npm test > n.log 2>&1` in the main checkout; the cloud
   run showed 94 failures of 2724 (not yet identified). List them (`not ok` lines) and get the full suite green on sqlite AND PostgreSQL
   with PG_TESTS_REQUIRED=1, fixing real failures (never skip/disable a test).
2. Then Goals 03, 04, 05, then wave 2, then wave 3 fiches, each exactly as its spec section says.

Rules for every item:
- Follow the fiche's acceptance criteria; write the tests first (sqlite + PG fork where a db is touched).
- Never block on a question: take the recommended assumption behind a reversible flag
  (default off for new behaviour) and add a row to docs/sdp360/review/DECISIONS-EN-ATTENTE.md.
- Respect CLAUDE.md pitfalls (await-precedence, null-not-zero, _htmlCache + sendHtmlPage for new pages,
  admin panels' 4 surfaces, secrets redact/blank-keep, site scope via services/userSites.js).
- Keep tests/await-precedence.test.js and the PPTX/e-mail goldens green; never regenerate a golden to pass.
- After each item: run its tests + the full suite, update CHANGELOG and help.html (EN+FR) when
  user-visible, commit with a clear message, and report what changed and what is still open.
- Do not deploy and do not open a pull request unless I ask.
Start with item 1 now.
```
