# ADR — P05: performance budgets, SLI readings and two measured fixes

- **Status:** accepted (engineering, sandbox — AI decision). Budgets and SLO targets **PROPOSED**, not approved.
- **Date:** 2026-11-19 · **Lot:** p05-perf · Evidence: `docs/agent-execution/P05-performance.md`

## Context
P05 asks for measured latency at a declared scale, fixes of measured bottlenecks only, budgets per route class
in CI (warn mode, switch to blocking), 30-day SLI readings and restore timing. The owner has declared no scale.

## Decisions
1. **Dataset = the 100 000-ticket rehearsal set** on one throwaway database (`sdp_test_p05perf`), driven by a new
   `tools/test/scale-run.js` (prepare / env / plans / restore / drop, throwaway-name guard). Said in every result.
2. **Server and load harness in separate processes**; soak shortened to 15 min (shared sandbox), stated.
3. **Harness fixes** (`tools/test/load.js`): the login token now arrives only in the `report_token` cookie, so the
   harness reads `Set-Cookie` (it failed to sign in before); pool saturation is sampled from `pg_stat_activity`
   (`--pg-stat-url`) because the server exposes no pool gauge; steps are grouped into budget classes.
4. **Two fixes, both measured, both ON (defect fixes, no switch):** the calendar-month helpdesk reader in one
   scan (FILTER aggregates, values pinned by a test captured from the old reader) and the all-sites monthly deck
   reading sites concurrently. 22 s → 3.6 s.
5. **Not changed, reported:** decks run in the request process (degrade every other route under load), the
   14.6 MB helpdesk payload, the non-sargable `created_time::date` predicate (index / rewrite = DBA). Each is a
   design or schema choice beyond "fix the measured bottleneck", and P06 owns the server.js refactor.
6. **Budgets = `docs/ops/perf-budgets.json`**, status PROPOSED, `approved_by`/`approved_at` null. Rule: vision
   figure where one exists, else control-run p95 rounded up with headroom. CI step in warn mode; the repository
   variable `PERF_BUDGETS_BLOCKING=1` makes it blocking (a CI variable, not a `report_config` switch: it governs
   the build, not the product).
7. **SLIs = `sli_30d` on `/api/health/deps`** (existing admin-tier endpoint, no new route). Readings the database
   keeps are read over 30 days; two readings the database cannot keep (sign-in 5xx, `SELECT 1` latency) use an
   in-process counter whose window is stated as "since server start". Availability and disk history are `null`
   with the reason. No colour, no threshold.

## Left for a person
Declaring the production scale; approving or changing each budget and setting `PERF_BUDGETS_BLOCKING`; SLO
targets, error budgets and paging; choosing and wiring the external `/ready` probe; RTO/RPO targets; a 1 h+ soak
and a production-like run on approved staging (Windows Server, Node 24, PostgreSQL 17); the DBA decision on the
`created_time` predicate / index; the design decision on moving deck generation off the request process.
