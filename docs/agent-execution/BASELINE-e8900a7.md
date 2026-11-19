# BASELINE — e8900a7 (P01 "One baseline, one truth")

Prepared by an AI agent (P01 lot, branch `qual/p01-baseline`). **This is not an independent review.** No behaviour change;
nothing was pushed, merged, deleted or renamed. Every command below is for a human operator to run.

## 1. SHA and line of work

| Item | Value |
|---|---|
| Lot base | `e8900a714c17cdbbd54629de194c79121ae60421` (2026-11-19 11:23 UTC) |
| Remote default branch (`git ls-remote --symref origin HEAD`) | `claude/sdp-dashboard-analysis-55b1oy` = the **trunk (working line)** |
| Trunk head when measured | `cd4078b` (e8900a7 + P10 gate dossiers + handoff notes; no runtime code) |
| Review baseline in the prompt pack | `80a0340` (13 Nov) — HEAD moved: 12 commits to e8900a7 (W3 governance, W4 enterprise/connectors, fixes) |
| `package.json` version | `2.0.0-alpha.14` (tag `v2.0.0-alpha.14` exists on origin) |
| `main` on origin | **does not exist** |

## 2. Branch map (origin, after an unshallow `git fetch`, read-only)

Ahead/behind = `git rev-list --left-right --count <trunk>...<branch>` (left = commits only on the trunk).

| Branch | Trunk-only / branch-only | Merge base | Last commit | Reading |
|---|---|---|---|---|
| `claude/sdp-dashboard-analysis-55b1oy` | 0 / 0 | — | 2026-11-19 | trunk |
| `claude/sdp360-consolidation` | 621 / **0** | `776262c` (its tip) | 2026-11-02 | fully merged into the trunk — archive |
| `claude/confident-pascal-03veex` | 741 / 1245 | **none** (unrelated history) | 2026-10-28 | the inherited SDP-Dashboard v1 history; holds the two missing source files (§4) |
| `dependabot/github_actions/*` (5) | 2 / 1 | `94265ac` | 2026-11-18 | open Dependabot PRs #13, #14, #15, #17, #18 |
| `dependabot/npm_and_yarn/{globals,nodemailer,pg,playwright}` (4) | 2 / 1 | `94265ac` | 2026-11-18 | open Dependabot PRs #16, #19, #20, #21 |
| `dependabot/npm_and_yarn/pptxgenjs-4.0.1` | 517 / 1 | `3d4a9de` | 2026-11-04 | stale (based on an old head, major version bump) — needs a rebase or close (PR #9) |

### Proposed trunk (human commands — NOT executed)

```bash
# 1. create main from the trunk head and protect it (owner of mliad313sn/SDP360)
git fetch origin
git push origin origin/claude/sdp-dashboard-analysis-55b1oy:refs/heads/main
gh api -X PATCH repos/mliad313sn/SDP360 -f default_branch=main
gh api -X PUT repos/mliad313sn/SDP360/branches/main/protection --input - <<'JSON'
{"required_status_checks":{"strict":true,"contexts":["ci"]},"enforce_admins":true,
 "required_pull_request_reviews":{"required_approving_review_count":1},"restrictions":null,
 "allow_force_pushes":false,"allow_deletions":false}
JSON
# (replace "ci" by the exact check names shown on a green PR)

# 2. archive the merged and the unrelated agent branches as tags, then delete the branches
git push origin origin/claude/sdp360-consolidation:refs/tags/archive/sdp360-consolidation
git push origin origin/claude/confident-pascal-03veex:refs/tags/archive/confident-pascal-03veex
git push origin --delete claude/sdp360-consolidation claude/confident-pascal-03veex

# 3. retarget Dependabot to main (.github/dependabot.yml: target-branch: main) and close PR #9 (stale pptxgenjs)
# 4. after main is the default: update TRUNK in tests/rules-trunk-branch.test.js and the rules/truth docs in one commit
```

## 3. Rules drift — corrected

`.claude/rules/SDP360_BOUNDARIES.md`, `TRUTH-MATRIX.md`, `MASTER-PLAN.md`, `RELEASE-RUNBOOK-2026-10-29.md` and
`docs/agent-execution/README.md` named `claude/sdp360-consolidation`; they now name the trunk (and `main` as the
proposed protected trunk). New test `tests/rules-trunk-branch.test.js` (3) fails when `.claude/**` or those completion
documents name any other branch; it failed (2 of 3) before the document fix. Dated historical records (committee
reviews, audits, handoffs, CHANGELOG, `release-dossier` human-gate facts) still mention the old branch on purpose — they
record what was true when written.

## 4. Missing source (boot integrity)

`require()` targets absent from `git ls-files` (runtime code; comment-only usage examples excluded):

| File | Required by | Effect | Routes answering 503 while absent |
|---|---|---|---|
| `generate-site-monthly-pptx.js` | `server.js` (try/catch) | boot survives, module `undefined` | `GET /api/reports/monthly/:site_id/:year/:month/site-template/pptx` |
| `executive-new-report.js` | `server.js` (try/catch) | boot survives, module `undefined` | `POST /api/executive-new-pptx` |

Both were last present at `8007aea^` (1124 and 1383 lines) on the unrelated branch `claude/confident-pascal-03veex`;
`8007aea` (2026-07-13, "docs(spec): installer — …") deleted them. `.gitignore` still says both are live and tracked.
**Not recreated.** New test `tests/boot-integrity.test.js` (2) pins the list: a new missing require fails, a returning
file fails until the list is cleaned, and each known-missing module must stay inside `try {}` with its routes answering 503.

**Owner action:** supply the two files (or decide to retire the two routes). `git show 8007aea^:generate-site-monthly-pptx.js`
recovers the July copy, but whether it is the version production runs is for the owner to confirm.

## 5. Installed build `2.0.0-alpha.16+review.1`

- Known: PLAN-F says it is installed somewhere and in no branch. Verified: no branch or tag on origin carries a version
  above `2.0.0-alpha.14`.
- Rebuilt natively (REBUILD-SPEC R1–R8): present at e8900a7 — `services/workspaceProfiles.js`, `routes/workspace.js`,
  `public/workspace-settings.html` (R1/R2, migration `078_user_workspace_prefs`), `tools/demo/` (R6),
  `services/sync/manualTrigger.js` + fenced lease (R8, `tests/sync-write-fence.test.js`), workbench (R5, migration
  `085_ppm_workbench`). Migration 079 was never used.
- A human must supply: the review.1 artifact (or a written statement that it is abandoned), where it is installed, and
  whether any data was written by its migrations 078/079 — if that instance's database is ever restored onto head, its
  078 would collide with head's `078_user_workspace_prefs`.

## 6. Counts

README now carries a block generated by `node tools/agent/inventory.js` (`--check` also fails on a stale README) and owned
by `tests/readme-truth.test.js`. At this commit: 62 pages, 753 routes (209 still in `server.js`), 33 jobs, 102 migration
files, 810 test files, 5,318 tests expected by `tests/.suite-manifest.json`. The prose figures were corrected
(~5 100 → ~5 300 tests, ~50 → ~60 pages).

## 7. Full suite

**Not re-run by this lot** (ten agents share the disk; the preamble forbids it). Orchestrator's latest full run, at
`06f2cf2` (before the connectors work), command `node tools/test/run-all.js`:
**5,311 tests — 5,298 pass, 3 fail, 10 skipped.**

| Failing test | Cause | Owner |
|---|---|---|
| `ui-design-ratchet` "no page exceeds its design budget" | hex literals over budget: `portfolio.html` 75 > 74, `project.html` 87 > 79, `public/lib/ganttV2.js` 4 > 0 (reproduced here) | P09 |
| `i18n-coverage` "project.html every static text has a French entry" | new static strings without French entries (e.g. "Simplified") (reproduced here) | P09 |
| `sync-write-fence` "R8 hole 4 … answers 409 and writes nothing" | **flake, fixed here**: the test slept a fixed 50 ms after a fire-and-forget manual run, then read its `sync_runs` row; under a loaded suite the run had not finished. Now it polls (≤ 10 s) for the run row created after the call. Proof: with a 300 ms job delay injected, the old test fails and the new one passes; 3 consecutive isolated runs 10/10. | P01 (done) |

Skips (10): `prod-snapshot/`-dependent tests in `review-data` and `site-window-readers` (TRUTH-MATRIX).

Targeted runs by this lot (all green): `readme-truth`, `agent-inventory`, `inventory-strict`, `inventory-reachability`,
`release-dossier`, `boot-integrity`, `rules-trunk-branch`, `sync-write-fence` (×3). TRUTH-MATRIX evidence commands
re-run: secret scan (history: 3 known findings), licence inventory (unchanged), restore rehearsal 100k rows (12/12 PASS).

## 8. Human actions needed

1. Create and protect `main`; archive the two `claude/*` branches; retarget Dependabot; close PR #9 (§2 commands).
2. Supply `generate-site-monthly-pptx.js` and `executive-new-report.js`, or decide to retire their two routes (§4).
3. State the fate of the installed `2.0.0-alpha.16+review.1` build and its database (§5).
4. EX-01: rotation and history decision for the three credential-shaped commits (unchanged, already a gate).
