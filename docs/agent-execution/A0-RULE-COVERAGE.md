# A0 — rule → test coverage map

Every documented access rule (docs/ops/AUTHZ-MATRIX.md, docs/ops/PORTFOLIO-ACCESS-MATRIX.md, the RBAC rule of
2026-10-02 in CLAUDE.md, invariants 1-8 of the A0 goal) mapped to at least one test. "A0" = added by this goal;
other entries are pre-existing tests the A0 suite relies on (named, not re-implemented). The expected side of every
A0 runtime check is the **committed** `docs/ops/authz-matrix.json`, not the live router.

## 1. Route × role (AUTHZ-MATRIX — 644 routes, 237 role-guarded, 17 guard classes (`requireRole` counted once — 10 role sets), 30 capabilities)

| Rule | Test |
|---|---|
| Every /api route is guarded, public with a reason, or behind the global gate | `tests/authz-route-matrix.test.js`; A0 `tests/authz-matrix-json.test.js` "self-consistent" |
| Every role guard maps to a catalogued capability (C-17) | `tests/capability-registry.test.js`; A0 `authz-matrix-json` "self-consistent" |
| The committed matrix equals the live router (a guard change without regeneration fails) | A0 `authz-matrix-json` "equals a fresh walk" |
| Each of the 17 guard classes (`requireSuperAdmin` ×70, `requireAdmin` ×27, `requireSuper` ×21, `requireCommittee` ×18, `requireMoneyRead` ×13, `requireBuilder` ×12, `requirePublisher` ×8, `requireAdminTier` ×8, `requireField` ×7, `requireExecutiveOrSuperAdmin` ×6, `requireRole(...)` ×10 role sets, `requireKpiCommittee` ×6, `requireDeckBuilder` ×4, `_syslogGate` ×4, `requireAuthor` ×3, `requireSuperTier` ×3, `requireFieldAdmin` ×2) refuses (403) every persona it must, on every method | A0 `tests/rbac-matrix.smoke.test.js` "route × role" — 2 554 deny probes, 13 personas; the test asserts every guard class AND every capability received ≥1 deny probe |
| The narrowest admitted persona passes the guard (no over-blocking) | A0 `rbac-matrix` "route × role" allow side (≥ 60 GET probes, not refused by the guard's own 403) |
| Session required on every non-public route | A0 `rbac-matrix` "session rule" (every non-public /api route, anonymous) |
| Role hierarchy super_admin > executive > admin > editor > viewer; feature roles orthogonal | implied by the expectations (computed with the original `userHasRole`) of A0 `rbac-matrix`; `tests/business-roles.test.js` |
| report-author is NOT implied by super_admin (4 deck routes) | A0 `rbac-matrix` (super persona expected to be denied there — the committed matrix records it) |

## 2. Invariants of the goal

| # | Invariant | Tests |
|---|---|---|
| 1 | Site perimeter: editor only own site(s); admin tier all; no-site account reads/writes nothing site-scoped | A0 `tests/rbac-scope-frozen.smoke.test.js` "site perimeter" (reports write/read/list, follow-ups, monthly edits, objectives, PV new/by-id/action/issue/delete, inspection new/by-id/action/delete, portfolio plan writes with switch off/on, tracker cell of another site); `tests/audit-report-write-auth.smoke.test.js`, `tests/rbac-write-scope.smoke.test.js`, `tests/cross-site-object-writes.smoke.test.js`, `tests/multi-site-editor.smoke.test.js` (extra sites), `tests/tracker-save-site-scope.smoke.test.js`, `tests/inspection-site-scope.smoke.test.js`, `tests/portfolio-access-parity.smoke.test.js` (read/write switches) |
| 2 | Amounts only to admin tier + finance-viewer (UI / exports / API) | A0 `rbac-matrix` "amounts" (asset inventory JSON columns, 6 money routes/exports, portfolio detail/list/report.html budget, budget periods) + static check in `authz-matrix-json`; `tests/portfolio-access-parity.smoke.test.js` (deck.pptx / workbook.xlsx content); `tests/rbac-ui-gates.test.js` A15 (UI). **Known deviation**: committee-member reads portfolio amounts — explicit expected-fail list `KNOWN_MONEY_DEVIATIONS` (policy decision pending) |
| 3 | Métier-only accounts: 403 everywhere except Site Awareness (+ auth / workspace me/prefs) | A0 `rbac-matrix` "métier lock" (every route × every method × site-business and group-business) + static check in `authz-matrix-json`; `tests/business-only-boundary.smoke.test.js` (bogus header next to the cookie) |
| 5 | Submitted reports frozen; closed tracker months frozen (current + previous until the 5th) | A0 `rbac-scope-frozen` "frozen periods" (editor/admin/executive 403, super_admin 200; tracker-editor closed month kept, current month saved, `closed_blocked` reported); `tests/tracker-month-lock.test.js` (the 5th-of-month rule, Jan/Feb year boundary), `tests/audit-report-write-auth.smoke.test.js` |
| 6 | Server-side timestamps; separation of duties | A0 `rbac-scope-frozen` "server-side timestamps" (PV signature); `tests/meetings-signature-stamp.test.js`; SoD: `tests/kpi-policy-routes.smoke.test.js` (author cannot adopt), `tests/access-routes.smoke.test.js` (self-approval refused), `tests/emergency-access.smoke.test.js` (reason required, self-grant refused, second super_admin reviews), `tests/audit-report-write-auth.smoke.test.js` A-24 second_person revert with reason |
| 7 | No route or job writes to SDP / Meraki / OpManager unless armed | A0 `tests/rbac-external-writes.test.js` (static: clients' write verbs, the single gated `createRequest` caller, switch checked before arming, default OFF, closed list of outbound-write files; runtime: recording transport); `tests/field-routes.smoke.test.js` (ticket rejected while disabled) |
| 8 | Presentation (workspace profiles / blocks) never grants a right | A0 `rbac-matrix` "workspace" (4 personas × eligible + privileged profiles, decision snapshot of every role-guarded / money / site-scoped GET unchanged, roles unchanged); `tests/workspace-profiles-grants-nothing.smoke.test.js` (forged row) |

## 3. "A deliberate rule break fails CI"

`tests/rbac-mutation.smoke.test.js` (in `npm test`) breaks each rule in-process and asserts detection:
M1 role engine → true · M2 one guard removed (runtime AND matrix freshness) · M3 métier lock off · M4 site perimeter
off · M5 report freeze off · M6 tracker month lock off · M7 amounts unmasked; then proves the checks are clean again.

## 4. Not covered here (residual)

- **Role menus** (`public/_shell.js` NAV): presentation only; the server is the enforcement point (invariant 8 proves a
  presentation change grants nothing). UI gates are pinned by `tests/rbac-ui-gates.test.js` and `tests/exec-nav-consolidated.test.js`; no generated menu × role test.
- **Handler-level role checks on routes without a guard** (`inline_roles` column, e.g. `DELETE /api/reports/sessions/:token`):
  listed in the matrix and diffed per release, exercised only where an A0 or existing test names them.
- **Allow side on writes**: the generated sweep runs handlers only for GET (writes are deny-side only, to stay side-effect free);
  write allow-paths are covered by the explicit positive controls of `rbac-scope-frozen`.
