# Orchestrator handoff — 2026-11-13 (prompt pack P00–P11)

Read this first to resume. Short on purpose.

## 2026-11-19 — CONTAINER RESET (read first)
The cloud container was replaced while waiting on a usage limit. Lost: `/home/user/fixinst`, all worktrees
`/home/user/w/*`, every local `qual/*` branch (P01–P04, P06–P10 DONE work was never pushed — the preamble forbade
it), the scratchpad, node_modules, the PG cluster contents. Survived: only the remote branch.
Recovery done: checkout is now `/home/user/SDP360` on branch `claude/sdp-dashboard-analysis-55b1oy`;
`npm ci`; `service postgresql start`; role `sdptest` recreated (local-only). Pack + preamble are now IN THE REPO:
`docs/agent-execution/prompt-pack/{prompt-pack.md,preamble.md}` (the assessment docx was not recoverable).
All lots are RELAUNCHED from base `94265ac` (= `11d831a` + handoff notes). The table below lists the previous
results as reference for what each lot found; their SHAs no longer exist.
**New rule: merge + push each lot as soon as it reports** (only the designated branch may be pushed, so that is the
only durable store). Never leave finished work only in a local branch.
Relaunched agent ids (2026-11-19): P01 a1ba43df417509253, P02 a16d92f1476537c9a, P03 aa04c3d3a094e25a1,
P04 a1b5bf21c70f35f4c, P05 a97869d74924ca653 (resumed, base 11d831a), P06 a5c044dc4be11d7f8,
P07 acff067ab54912f98, P08 aac6337a596ce8f15, P09 a6d3fa1430bb26ed5, P10 a1278946d9e25df2a.
MERGED + PUSHED after relaunch (2026-11-19): P10 495c9d7e, P01 2b35374c, P06 dd4b7332, P08 44292164, P07 07f9c65f,
P09 a2f24a5d, P04 67ca975a, P05 61ee2cf2 (+ ceiling reconcile), P02 f8ecd313 (+ classify CLI fix 91be1436),
P03 dca7df89. ALL TEN MERGED. Full suite after merges: 5457 tests, 7 failed (cross-lot drift, fixed in 1004xxx / 88ff0a20
commit "Fix cross-lot drift…"), 19 skipped (container lacked chromium-1248 + python libs: fixed in the container by
symlinking /opt/pw-browsers/*-1243 → *-1248 and pip install matplotlib python-pptx pillow — env only).
Open: authz-outcomes probe flips A↔N on `GET /api/kpi-policies/:id` as viewA (P02 agent a16d92f1476537c9a resumed on
branch qual/p02-fix). CI (runs 344-347) red at the Chromium install step (`npx playwright install --with-deps chromium`)
before any test — infra, investigate if it persists. Next: P11 (frozen SHA, clean-clone AI reviewers).
Orchestrator helpers (ephemeral, recreate if lost): postmerge = take theirs on generated docs, union the manifest,
regen inventory/authz/CSP journeys, commit, regen gate dossiers at the merge sha, commit.
Relaunch prompts = launch prompt + "RELAUNCH" paragraph (summary of the first run); base e8900a7.

## Where things stand
- Working checkout: `/home/user/SDP360` (was `/home/user/fixinst`, local branch `sdp-waves`). Push with
  `git push origin HEAD:claude/sdp-dashboard-analysis-55b1oy` (the GitHub default branch; no `main`).
- Pushed head: `11d831a` (all goal-programme lots + PPM W1–W4 incl. connectors merged).
  After that, local commit `06f2cf2` (Gantt `outline:none` fix) is already in history before `11d831a`.
- Last full suite (at `06f2cf2`, pre-connectors): 5311 tests, 5298 pass, **3 fail**, 10 skipped:
  1. `ui-design-ratchet` (hex literals in portfolio.html / project.html / lib/ganttV2.js) → P09 fixes
  2. `i18n-coverage` project.html (~37 W3 strings + W4 panel) → P09 fixes
  3. `sync-write-fence` "R8 hole 4" flake → fixed in P01 (poll instead of fixed sleep)
- GitHub CI on `11d831a`: **test** and **e2e** jobs red. The unit failures are probably the 3 above (unconfirmed: the log tail shows only PostgreSQL output).
  e2e cause still unknown: local `npm run test:e2e` hit the 900 s timeout (exit 124) with no failure printed, while 10 agents loaded PostgreSQL — inconclusive. Re-run when no agent is running (`timeout 2400`), or read the CI e2e artifact.
  Read that log; a journey failure is likely in W3/W4 project.html changes.

## Prompt-pack lots (agents, worktrees `/home/user/w/<lot>`, branches `qual/<lot>`, base `11d831a`)
Shared rules: `docs/agent-execution/prompt-pack/preamble.md`. Pack: `docs/agent-execution/prompt-pack/prompt-pack.md`. Assessment: `$S/assessment.txt`.
(`$S` = `/tmp/claude-0/-home-user/29383f9d-be53-578b-8518-d98e0b66dcb7/scratchpad` — ephemeral; the pack is also the user upload.)

| Lot | Status | Head | Notes for merge |
|---|---|---|---|
| p01-baseline | DONE | 390e3e1 | rules/TRUTH fixes, boot-integrity + rules-trunk tests, README size block (re-run `node tools/agent/inventory.js` + `--strict` on conflict), fence flake fix |
| p02-authz | DONE | 7151bf4 | no P0; outcome probe 748 routes × 23 personas (snapshot docs/ops/authz-outcomes.json, `AUTHZ_OUTCOMES_UPDATE=1` regenerates — must be refreshed after merging other lots that add routes); handler_check declarations; mutation control 5/5; P02-F1 engagement comments open (P2 proposal); committee money option for security owner |
| p03-switch-lots | DONE | cb0e17f | 152 dark switches → 16 lots (126) + 24 keep + 4 retire proposals; STOP-AND-REPORT: L03 `portfolio_editor_plan_writes` widens access (owner must accept or move it); 4 sends armed in prod need keep decisions |
| p04-ppm-cert | DONE | 04e58be | NOT CERTIFIED (human checks open); re-audit 32+51 impl / 45 partial / 13 missing; 2 defects fixed (calendar-aware engine input, offline queue rebase); interop + witness kits |
| p05-perf | running | — | must drop only its own DB |
| p06-monolith | DONE | 8a8906d | assets (42 routes) + backup schedule (3) extracted; systemLog/rateLimit stores; named guard (3 backup rows now super_admin in matrix); server.js budget 5817; merge LAST; CLAUDE.md split = proposal only |
| p07-security | DONE | 5549dd6 | no P0; `_shell.js` logout inline onclick fixed; 46 pages PROPOSED for `csp_strict_pages` (default stays ''); session-security smoke tests |
| p08-kpi | DONE | 6c0ce4c | KPI dossiers + parity test + unknown-sweep ratchet (after merges run `node tools/kpi/unknown-sweep.js --write` + review); regenerate METRIC-LINEAGE/METRIC-WIDGET-MAP |
| p09-adoption | DONE | 618975b | 2 red static checks fixed (i18n project.html, colour budget); page inventory (63 pages), PROFILE-TASKS + 2 e2e journeys, pilot runbook S1–S10, training pages; recommend a static-suite merge gate |
| p10-gates | DONE | 5f1329a | gate dossiers generator; after all merges run `node tools/release/gate-dossiers.js --sha=<merge sha>` then `tests/gate-dossiers.test.js` |

If an agent died on a usage limit: `SendMessage` to its id with "continue from where you stopped".
Agent ids: P01 afe907dc28bc89f13, P02 a4f095da16d430147, P03 a229a7af7e115eebf, P04 ad489fedbd36e7435,
P05 a97869d74924ca653, P06 a11caae7e6c5ae96e, P07 a2376c39beca91e8f, P08 a48c7c4936f5de846,
P09 a607f52d152a7ab6d, P10 a6e7622e4c184d366.

## Merge procedure (per lot)
1. `bash $S/merge-goal.sh <lot> "<msg>"` expects branch `goal/<lot>`. The prompt-pack branches are `qual/<lot>`,
   so merge manually instead: `git merge --no-ff qual/<lot> -m "Merge <Pxx>: …"`. Then:
   - Conflicts in generated docs (INVENTORY*, README size block, AUTHZ-MATRIX.md, authz-matrix.json, FLAG-REGISTER, CSP-JOURNEYS): take theirs, then regenerate.
   - `tests/.suite-manifest.json`: union the entries and recompute `total` (JSON indent 1).
2. Regenerate:
   - `node tools/agent/inventory.js && node tools/agent/inventory.js --strict`
   - flag register
   - `AUTHZ_MATRIX_UPDATE=1` on `tests/authz-matrix-json.test.js` and `tests/authz-route-matrix.test.js`
   - after the last merge: `node tools/agent/evidence-manifest.js` (stale since W4)
3. `npx eslint .`, targeted tests, commit (footer below), push.
4. Order: P10, P01, P07, then P02/P03/P04/P05/P08/P09 as they land, P06 last, then regenerate P10 dossiers.

Commit footer:
```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WyKJzoJkxxdA63EkAxcCMC
```

## Test commands
```
export PG_ADMIN_URL=postgres://sdptest:sdptest-local-only@localhost:5432/postgres
NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" node --test --test-force-exit <files>
node tools/test/run-all.js > /home/user/suite.log 2>&1     # full suite, ~18 min
```
- **Disk trap:** the full suite creates about 1200 test databases (about 22 GB). The disk allowance is about 39 GB.
  Run `node tools/test/drop-test-dbs.js` after each full suite, but ONLY when no agent or suite is running.
  It saturates PostgreSQL connections, so never run it at the same time as tests.
- If disk fills, PostgreSQL crashes into recovery, and every test file reports "PostgreSQL is required" → all reds are environmental.
- Never put `export` in a `cmd && export … &` chain (it ends up in a background subshell).
- PG down: `pg_ctlcluster 16 main start`.

## After P01–P10 are merged
1. Full suite, then drop the test databases. Push and check CI (GitHub MCP `actions_list` / `get_job_logs`).
2. Regenerate the P10 dossiers at the merge SHA.
3. Launch P11: frozen SHA (local tag only, no push of tags), reviewer agents from a clean clone without `docs/agent-execution/`, and every review labelled AI. The run ends when the report is handed to humans.

## Human decisions collected so far (relay to user)
- Trunk / protected `main` (commands in `BASELINE-11d831a.md` §3).
- Two missing source files (`generate-site-monthly-pptx.js`, `executive-new-report.js`; lead `8007aea^`) or retire 2 routes.
- `review.1` installed-build artifact.
- Secret rotation (EX-01; 3 credential-shaped commits in history).
- CSP strict pages after a report-only week; SSO "only"; pentest rules of engagement and 21 TEST accounts.
- Gate owners (21 dossiers).
- PPM: RAG thresholds, phase model, gate approvers, report recipients, .mpp converter, Jira/Azure DevOps service accounts.
- Every switch stays off until a lot is approved.

## 2026-11-19 15:20 UTC — CI green, P11 launched
- CI run 353 on 7eee8955: test + e2e GREEN (after: e2e fix merge 4651cf33, test timeout 35 min, CSP-JOURNEYS + persona matrix regenerated).
- P11 frozen SHA 7eee8955568c0bcab2a6329f838ee432ffca9fd1, LOCAL tag qual-p11-7eee8955 (not pushed). No merge to the trunk during the run.
- Six AI seats, clean clones /home/user/qual/<seat> (docs/agent-execution removed except gate-dossiers), findings to /home/user/qual/out/<seat>.md:
  security ae0c79a210f9fa62e · data-kpi a3915dc5ae6ee49fe · ppm a394d7d8cfff89615 · operations a461af565cb6faa63 ·
  ux-field a0459067130c16691 · audit a1f0f45fcef94685a. Briefs: /home/user/tools-orch/p11-seats.json (ephemeral; template in this note's history).
- After the seats report: consolidate into docs/agent-execution/P11-readiness-report.md + residual-risk register + per-lot AI recommendation;
  P0/P1 → back to implementation and restart P11 at a new SHA.

## 2026-11-19 19:40 UTC — P11 round 1 done, fixes merged, round 2 launched
- Round 1 report: docs/agent-execution/P11-readiness-report.md (+ seat files in docs/agent-execution/p11/round1-7eee8955/).
- Fixes merged: fix1 (group-run share/read, CSAT null), fix2 (survey+assets truncation guard, /ready probe), fix3 (plan bounds,
  resilient portfolio, EVM AC), fix4 (field outbox 409, action conflicts, SW no /api/ cache), fix5 (commitment four-eyes, todo guard,
  run-scoped DB sweep) + flag-register recursive scan + full-suite drift. CI run 363 GREEN on b2e85cd0.
- Round 2 frozen SHA b2e85cd08860a57526442797ac711e2fc9defc3a (local tag qual-p11-b2e85cd0). Seat outputs: /home/user/qual/out/r2-<seat>.md.
  Agents: security aa10d194af71193b0 · data-kpi affdf8cccfafb8e7c · ppm a63fe916fd46f058e · operations acb4c7d7b3a3cba2a ·
  ux-field a308901ad6e898332 · audit a3bd131a7eb43ddc5. Open human decision from round 1: SEC-F2 committee money.
- PG local: max_connections raised to 400 (env only).
