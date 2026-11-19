# ADR-P03 — Switch activation in lots (AI decision, engineering only)

Status: **AI decision on the tooling; every lot, keep and retire entry is PROPOSED** · 2026-11-19 · prompt-pack P03.
Reviewer: none yet — this record was written by an AI agent and is **not** an independent review.

## Context

The register (`docs/ops/FLAG-REGISTER.json`, regenerated at this base) lists **152 dark switches**: 148
`report_config` keys whose default leaves a behaviour off, 3 frozen deployment lots and 1 nested arm. The count grew
since the review (148) with the W3/W4 PPM work. None has a complete decision record (`flag-decisions.json` items: 0).

## Decision (reversible, engineering)

1. **One plan file, agent-authored, human-decided**: `docs/ops/switch-lots.json` holds the proposal (lots, keep groups
   with a reason, retire list, extra and soft dependencies, expiry N). It never carries owner, canary site, dates,
   thresholds or a numeric rollback trigger; the validator refuses a lot that does, and refuses any status other than
   `PROPOSED`. Human decisions stay in `docs/ops/flag-decisions.json`.
2. **One generator + checker**: `tools/agent/switch-lots.js` reads the register and the code (which files read each
   key, which tables those files name, which routes they declare, whether a job reads it), derives hard dependencies
   from the register text plus the plan's extras, detects cycles and orphans, checks lot order, and writes
   `docs/ops/SWITCH-LOTS.md` (plan, dossiers, keep, retire, graph, overlaps). `--check` is pinned by
   `tests/switch-lots.test.js`, so a new dark switch that nobody classifies fails the suite.
3. **Lots by user journey, at most 10**: 13 lots, 111 switches. L01 daily work and L02 PMO reading are the suggested
   first two (the prompt's suggestion, marked PROPOSED).
4. **Forcing switches in tests without touching data**: `tools/test/force-switches.js` is a `--require` preload that
   overrides `reportConfig.DEFAULTS` in memory, only inside a `node --test` child, never with `NODE_ENV=production` or
   `SDP_TEST_PG_URL` set, and refuses unknown keys. A test that writes its own value still wins.
5. **Rollback rehearsal**: `tests/switch-lots-rollback.test.js` sets each lot on then back to default on the file's
   throwaway database and checks every other table's row count + content digest is unchanged.
6. **Expiry**: `expiryViolations()` + `tests/switch-expiry.test.js`. Opt-in per entry (`pilot_on_since`,
   `lifecycle_decision: keep|remove`) in the human sidecar; N is null (not armed) until the owner sets it.

## Not decided here (human)

Owners, canary sites, dates, thresholds, rollback triggers, the order of lots in production, every activation, every
retirement, the reclassification of the 5 "not a switch" entries, and the keep decision for the 4 sends already armed
in production.

## Consequences / limits

- Table and route overlap is a **file-level approximation** (a file that reads a key and names a table in SQL);
  hub files and hub tables are excluded and listed. It points at where pairwise tests are needed; it does not prove
  two switches interact.
- Hard dependencies come from text the register already carries; a dependency nobody wrote down is invisible.
- The per-lot runs here are **targeted** (tests naming the lot's switches + the authorization/RBAC set). The full
  suite per lot, the browser journeys, the P02 probe and the data-parity check under real use remain for the
  orchestrator / a human on the TEST instance.
