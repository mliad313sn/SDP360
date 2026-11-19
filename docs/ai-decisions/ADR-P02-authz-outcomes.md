# ADR — P02: authorization outcome assurance (probe, declared in-handler checks, switch narrowing)

- **Status:** accepted for the sandbox (engineering choices, AI-made). The two policy items at the end are **PROPOSED** for
  the Information Security owner — nothing is decided here.
- **Date:** 2026-11-19 · **Branch:** `qual/p02-authz` (base `e8900a7`) · **Prompt:** P02 of `docs/agent-execution/prompt-pack/prompt-pack.md`
- **Reviewer:** AI only. This is not an independent review.

## Context
`docs/ops/authz-matrix.json` predicts the outcome of the ~262 routes whose rule is a role guard. For the ~460 session-gated
routes without a role guard the decision is taken inside the handler (or a store / path wrapper it calls), so the matrix
could not say who gets in. P02 asks for the outcome of every method of every route for every persona, a declared
expectation for the in-handler routes, a proof that no authorization switch widens access, a money scan of every 2xx body,
and a mutation control.

## Decisions
1. **One harness, extended.** Everything lives in `tests/_rbac-matrix-core.js` (`probeOutcomes`, `diffOutcomes`,
   `checkOutcomeInvariants`, `runSwitches`, `compareSwitches`) and is driven by `tests/authz-outcomes.smoke.test.js`.
   `bootWorld({ outcome: true })` adds the 10 extra personas; the 13 canonical personas are reused unchanged.
2. **Outcome = HTTP status class, frozen in a snapshot.** Codes `A` 2xx/3xx · `V` other 4xx · `E` 5xx · `T` timeout ·
   `U` 401 · `F` 403 · `N` 404 · `S` not executed. Refusal = U F N, pass = A V E T. The committed
   `docs/ops/authz-outcomes.json` (one route per line, one character per persona) is reviewed in the diff like the matrix.
   A refusal that becomes a pass fails as a WIDENING; a pass that becomes a refusal fails as drift (regenerate after review:
   `AUTHZ_OUTCOMES_UPDATE=1`). A status class cannot see a filtered list (fewer rows, same 200): list narrowing by site is
   covered by the existing sweeps (`cross-site-read-sweep`, `rbac-scope-frozen`), not by this probe.
3. **Determinism over speed.** GETs run concurrently; every write runs strictly in sequence in a fixed order (DELETE last),
   personas in column order, because a write by one persona changes what the next request finds. Transport errors /
   timeouts are retried twice (they are not outcomes). Two consecutive full runs must produce the same map.
4. **Unsafe execution is not performed for admitted admin-tier personas** (backup, reset, sync, send, import commit):
   recorded `S`. Every other persona is still probed on those routes and must be refused. Session-ending routes use a
   throwaway token so the persona keeps its session.
5. **Site-B object ids** are substituted for the routes that address a site object (reports, follow-ups, monthly /
   objectives, meetings + their actions / issues, inspections + actions, portfolio / PPM projects, sites) and probed as
   `<key> [B]` rows. Four writes that validate input before their site check get a valid body (`B_BODIES`), otherwise
   every persona would stop at 400 and the site check would never be reached.
6. **Declared in-handler check = a separate reviewed file merged into the matrix.** `docs/ops/authz-handler-checks.json`
   classifies each session-gated route without a role guard as `role` / `site` / `ownership` / `switch` (several allowed)
   or `none` (empty list + one-line justification). `tools/agent/authz-walk.js buildMatrix` copies it into each row as
   `handler_check`; `tools/agent/authz-diff.js` treats a removed declared check as a widening. The draft comes from static
   signals of the handler chain **including path wrappers** (route layers registered on a path array / regexp such as the
   central site-read guard and the meetings read-scope wrapper); entries that needed human-style reading are marked
   `"reviewed": true, "reviewed_by": "AI (P02)"`. `tests/authz-handler-checks.test.js` holds it to two pieces of
   evidence: a route with a static role / site / ownership / switch signal may not be declared `none`, and a route
   declared `none` must give every active signed-in non-business persona the same outcome class in the snapshot.
7. **Switch narrowing check.** Each authorization switch (`portfolio_site_scope_reads`, `portfolio_sensitive_projects`,
   `portfolio_executive_readonly`, `portfolio_editor_plan_writes`, `authz_capability_mode=enforce` with every capability
   listed) is turned on alone, the routes it can affect are re-probed, and every cell that was 401/403 at baseline and
   passes with the switch on fails — except the switch's declared purpose (`portfolio_editor_plan_writes`: editor A / A+B
   on governance plan writes; site-B bodies stay refused, `checkSitePerimeter`). 404 baseline cells are skipped. Read
   switches run right after the GET baseline; write switches run before the write baseline and skip DELETE so the
   fixtures survive (DELETE under a switch is not re-probed — stated limit). The capability evaluator caches its policy
   30 s: the run resets it, otherwise the enforce run would silently test `off`.
8. **Money scan.** Every GET 2xx body served to a persona outside admin tier + finance-viewer is scanned for the seeded
   amount sentinels — JSON / HTML / text, `.xlsx` (sheet CSV), `.pptx` / `.docx` (XML parts), MSPDI XML and P6 XER (text).
   PDF bodies are listed as unscanned. A positive control requires the money readers to see the sentinels. A key-based
   scan (money-named key with a non-zero number) is printed for review, not failed. The committee-member exception
   (invariant 2) is an explicit expected deviation that must keep reproducing until the policy is decided.
9. **Mutation control in a sandbox copy only** (`$SCRATCH/p02/sandbox`, never committed): five in-handler checks broken one
   at a time, the probe (narrowed with `AUTHZ_OUTCOMES_ONLY`) must fail for each. Evidence in
   `docs/agent-execution/P02-authz-outcomes.md`.

## PROPOSED — for the Information Security owner (not decided)
- **P02-F1 — engagement comments.** `GET/POST /api/engagement/comments` read and write comments on any
  `(source_kind, source_ref)` for any signed-in non-business account; there is no check that the caller may read the source
  object (a notification of another site, a report run, a dashboard). Severity proposed: P2 (internal accounts only, no
  amounts, business-only accounts locked). Options: (a) accept and document; (b) authorise each comment through the reader
  of its source kind (notification → recipient, report run → `visibleRun`, dashboard → `loadVisible`); (c) restrict both
  routes to the recipient of the originating notification. Recommendation: (b), behind a switch whose default is today.
- **Committee-member and money (GAP-MATRIX invariant 2).** Today `canSeeMoney = isCommittee || finance-viewer`
  (`routes/governance.js`), so a committee-member without finance-viewer reads portfolio budgets, decks, history and budget
  periods; asset money (G-11) is not affected. Options: (A) **accept** — amend invariant 2 to "admin tier + finance-viewer,
  plus committee-member for portfolio amounts", record the reason (the committee arbitrates budgets); (B) **restrict** —
  `canSeeMoney = admin tier || finance-viewer`, committees that need amounts get finance-viewer explicitly;
  (C) **aggregate only** — committee-member sees programme / portfolio totals but not per-project lines and exports.
  The probe pins today's behaviour (`KNOWN_OUTCOME_MONEY`, `KNOWN_MONEY_DEVIATIONS`); whichever option is chosen, those
  lists and this ADR are updated in the same change.
