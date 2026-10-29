# ADR-G01 — Node major pinned in one place; skipped tests need an allow-list entry

Status: accepted (technical, reversible) · 2026-10-29 · reviewers: QA lead + SRE personas (G01)

## Context
CI, the release job and the installer used Node 22, but `package.json` said `>=18` and nothing pinned the major.
The suite printed skipped tests by reason but a new skip (for example a PostgreSQL test silently not running) did
not fail the run.

## Decision
1. `.nvmrc` holds the major (22); `package.json` / lockfile `engines` = `>=22 <23`; `tests/node-version-pin.test.js`
   fails if a workflow, the installer's embedded Node or the interpreter running the tests uses another major.
2. `tests/.skip-allowlist.json` lists each allowed skip reason with a maximum count and an owner; `tools/test/guard.js`
   `checkSkips` fails the run for an unlisted reason or a higher count.

## Alternatives
- Volta / `packageManager` field: adds a tool on the Windows server; rejected.
- Fail on any skip: impossible today (prod-snapshot fidelity tests, python renderer) without removing real tests.

## Rollback
Delete `.skip-allowlist.json` checks from `run-all.js`; restore `engines`. No data involved.
