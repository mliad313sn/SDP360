# ADR-G05 — a value from a stale or never-synced source keeps its number, loses its colour

Status: accepted (technical, reversible) · 2026-10-29 · reviewers: data architect + risk auditor personas

## Context
`publishGate.freshness` already knew when a source was STALE or UNKNOWN, and dashboards showed a banner, but each
widget still carried its GREEN/AMBER/RED — a source outage could show yesterday's green as today's. Meraki and
OpManager syncs that answered with nothing were recorded as successful runs, so freshness stayed FRESH.

## Decision
- `publishGate.degradeStale` (dashboards) and the `/ext` value tagger set `rag = 'NA'` (grey) when the module's
  source is not FRESH, keep `value` and `as_of`, and expose `rag_if_fresh` + `freshness` for transparency.
- `legacyJob(..., { failOnZero: true })` for `meraki.wan` and `opmanager.availability`: a configured source
  returning zero rows fails the run (retried as transient), so freshness turns STALE. Unconfigured = skip, unchanged.

## Alternatives
- Hide the value: loses information a reader can still use with its date. Rejected.
- Null the value: would turn "measured, but old" into "not measured". Rejected (null = not measured).

## Rollback
Remove the `degradeStale` call and the `failOnZero` options. No schema change.
