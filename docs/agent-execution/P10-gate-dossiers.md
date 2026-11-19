# P10 — Evidence dossier per human gate

Prepared by an AI agent (prompt pack P10, lot `p10-gates`, base `e8900a7`; dossiers generated at target `23a31d11`). An AI panel is not an independent review.
**No decision cell was filled.** Every row of `docs/sdp360/completion/RELEASE-GATES.md` stays empty, which that file
defines as NO-GO.

## What was built

| Item | Path |
|---|---|
| One source (FR + EN text, evidence list, dependencies, blocking class) | `tools/release/gate-dossiers.source.js` |
| Generator / freshness check | `tools/release/gate-dossiers.js` (`--sha=<sha>`, `--check`) |
| 21 dossiers × 2 languages | `docs/agent-execution/gate-dossiers/{en,fr}/Gxx-*.md` |
| Index, dependency order, critical path to the pilot | `docs/agent-execution/gate-dossiers/INDEX.md` |
| Manifest (target SHA, content hash + last commit/date of every cited file, awaited globs) | `docs/agent-execution/gate-dossiers/manifest.json` |
| Staleness test (6 tests, incl. a mutation control) | `tests/gate-dossiers.test.js` |

Each dossier has the six sections the prompt asks for: question in the approver's words, evidence with the command
that regenerates it and its last-change commit/date, what is not evidenced and why, options including "not now",
residual risks, and what the approver must supply.

## Critical path to a two-site pilot GO/NO-GO

`G19` QA/CI → `G01` access policy → `G03` CAB (dependencies, PostgreSQL-only) → `G02` threat model + EX-01 rotation →
`G05` backup/restore → `G12` data owner → `G11` pilot sites + field UAT → `G21` business witness project.
Gates G07, G08, G09, G13, G14 block the pilot only if their feature is in the pilot scope. G04, G06, G10, G15, G17,
G18, G20 block general deployment only; G16 blocks distribution outside Endeavour only. These classes and
dependencies are AI proposals for the committee to correct, not decisions.

## Evidence awaited from the parallel lots

The source names the files each lot is expected to deliver (`docs/agent-execution/P0x-*.md`,
`docs/ops/authz-outcomes.json`). At `e8900a7` none exists, so every dossier marks them "awaited". When a lot is merged,
the test fails (awaited evidence changed, or a cited file such as `docs/ops/authz-matrix.json` changed) until the
dossiers are regenerated:

```
node tools/release/gate-dossiers.js --sha=<merge sha>
node --test --test-force-exit tests/gate-dossiers.test.js
```

| Lot | Feeds gates |
|---|---|
| P01 baseline | G03, G19 |
| P02 authz outcome probe | G01, G18 |
| P03 switch lots | G07, G08, G09 |
| P04 PPM certification | G14, G15, G21 |
| P05 performance | G20 |
| P07 security closure | G02, G18 |
| P08 KPI certification | G06 |
| P09 adoption / pilot kit | G11, G15 |

## Commands run (results)

- `node tools/release/gate-dossiers.js --sha=e8900a7` → 42 dossiers + index + manifest.
- `node tools/release/gate-dossiers.js --check` → fresh; after appending a line to `docs/ops/SLO-PROPOSAL.md` → STALE
  naming that file (exit 1); reverted → fresh.
- `node --test tests/gate-dossiers.test.js` (preamble NODE_OPTIONS) → 6 pass, 0 fail.
- `npx eslint` on the three new JS files → clean.
- `node tools/agent/inventory.js` and `--strict` → regenerated (test file count 808 → 809).
- Full suite: not re-run (parallel-lot rule). Latest orchestrator run recorded in
  `HANDOFF-2026-11-13-orchestrator.md`: 5311 tests, 3 failures, 10 skipped — cited as not green in G19.

## Human decisions now prepared (not taken)

The 21 gate owners can each decide from one dossier. The pilot cannot start before the eight gates on the critical
path are signed by the roles named in RELEASE-GATES.md.
