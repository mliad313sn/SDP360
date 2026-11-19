# ADR-P09 — Run the static checks on every merge (PROPOSED)

Status: **PROPOSED** by the agent (AI), 2026-11-19. Engineering-only, reversible. Adoption = a human merge-policy choice.

## Context

Two static checks were red at `e8900a7` (French coverage of `project.html`, colour-literal ratchet). Each came from a
merge that ran its own targeted tests and a hand-picked list of neighbours: W2-UI added colour literals to a new lib
file, W3 added untranslated strings to a page that W4 later declared translated, W4 added literals to two pages. No
single merge was wrong against what it ran; the combination was.

## Decision (proposed)

Before the targeted tests of any merge, run the database-free static set over the whole tree:
`tests/i18n-coverage.test.js`, `tests/ui-design-ratchet.test.js`, `tests/a11y-static.test.js`,
`tests/a11y-legacy-ratchet.test.js`, `tests/csp-*.test.js` (static ones), `tests/inventory-strict.test.js`,
`tests/p09-adoption-kit.test.js`, `node tools/agent/ui-inventory.js --check`. They take seconds and need no PostgreSQL,
so the parallel-run constraint (no full suite per lot) does not apply to them.

## Consequences

- A lot that touches a page shared with another lot learns at merge time, not in the next full run.
- Lot agents keep running only targeted database tests; the orchestrator keeps the full suite.
- Not done in this lot: wiring the list into `tools/test/run-all.js` or CI (owned by the orchestrator / P01).
