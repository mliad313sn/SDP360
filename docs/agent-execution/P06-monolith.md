# P06 — Reduce the monolith, keep the stack (round 1 evidence)

Lot `p06-monolith`, branch `qual/p06-monolith`, base `e8900a7`. AI-executed; reviews in this file are AI reviews,
not independent human review. No push, merge, deploy or live system touched.

## Result
| | at base `e8900a7` | after round 1 |
|---|---:|---:|
| `server.js` lines (split count) | 6,915 | 5,716 |
| `server.js` inline route registrations | 207 | 161 |
| `reports-db.js` lines | 5,860 | 5,714 |

## What was done (prompt items)
1. **Map** — `node tools/agent/monolith-map.js` writes `P06-monolith-map.{md,json}`: every inline route (method,
   path, domain, guards on the call line, server.js helpers closed over, tests naming the path) and every
   reports-db export (tables touched, including its `_<name>Pg` implementation; tests calling it), each with the
   number of distinct commits touching its lines in the last 30 days (`git blame`, the collision proxy).
2. **Order** — collision ranking from the map plus size. Round 1 (scope limited by the orchestrator to the 2–4
   highest-collision extractions, nine lots in parallel): the assets block (41 routes, largest block and 5 commits on
   one route in 30 days), the four digest-send routes embedded in it, the backup-schedule routes (inline guard),
   and two reports-db stores. `/api/reports/auth/*` (6 commits/30 d) is next in the ADR's map — not moved this round
   to keep the merge with P02/P07 (security lots editing auth) tractable.
3. **Extractions** — characterization test first, pinned on the inline code (commit `d600fae6`), then the move:
   - `routes/assets.js` (all `/api/assets/*`), `routes/digestSend.js` (4 send routes), `routes/backupSchedule.js`;
     mounted where the blocks sat. Commit `d234f386`.
   - `services/systemLogStore.js`, `services/rateLimitStore.js`, re-exported by reports-db under the same names;
     surface golden pinned first (commit `e60cda9c`), move in `cc59de08`.
4. **Named guards** — `services/namedGuards.js` (`requireMoneyRead`, `canReadMoney`, `requireSuperAdminInline`),
   catalogued in `services/capabilityRegistry.NAMED_GUARDS` (each maps to an existing capability with the same role
   set — `tests/p06-named-guards.test.js`); `tools/agent/authz-walk.js` reads inline named guards.
5. **Ratchet** — `tests/monolith-ratchet.test.js` (server.js lines + inline routes, reports-db.js lines);
   `tests/server-size-budget.test.js` budget lowered 6977 → 5716.
6. **CLAUDE.md** — PROPOSAL only (CLAUDE.md is the owner's project memory and was not modified):
   short rules draft `P06-CLAUDE-md-proposed.md`; `tools/agent/claude-md-split.js --out=<dir>` produces the dated
   archives (`history/<YYYY-MM>.md`, `reference/<slug>.md`; 29 files) and `--check` proves the split lossless
   (`tests/p06-claude-md-split.test.js`). **A human must approve replacing CLAUDE.md.**
   ADR: `docs/ai-decisions/ADR-P06-monolith-module-map.md`.

## Authorisation matrix diff (before → after)
`node tools/agent/authz-diff.js <base authz-matrix.json> docs/ops/authz-matrix.json`:
`0 added · 0 removed · 3 changed · capabilities +0 -0 ~0`. The three changes are `inline_roles: +super_admin` on
`GET /api/admin/backup-schedule`, `POST /api/admin/backup-schedule`, `POST /api/admin/backup-now`: the super_admin
check already existed inside the handler but the walker could not see it (an anonymous closure); it is now a named
guard. Access is unchanged (the characterization golden pins the 403 `{"error":"super_admin only"}` for viewer and
401 for anonymous). Everything else, including every assets route's guard chain and `requireMoneyRead`, is identical.
`AUTHZ-MATRIX.md` changed only on those three rows and its date line. Inventory diffs are file attributions and counts.

## Commands run (targeted only — full suite NOT re-run, per the parallel-lot rule)
- `tests/p06-extraction-characterization.test.js` — 1/1 at base (golden written, then two identical re-runs), 1/1 after.
- `tests/p06-reports-db-surface.test.js` — 1/1 before and after the store move.
- assets/digest/backup group (`assets-*routes*.smoke`, `assets-inventory-usd`, `assets-money-scope`,
  `assets-sync-status`, `assets-usage-log`, `asset-group-route`, `asset-reminders-route`, `reconcile-routes`,
  `weekly-send-route`, `backup-schedule`, `capability-registry`, `await-precedence`, `authz-enforce`) in one
  invocation: 125 pass / 6 fail; the 5 failing files each pass alone (money-scope 7/7, software 7/7, sync-status 3/3,
  hygiene 11/11, inventory-usd 1/1) — concurrency contention when ~19 server-booting files run at once next to nine
  other agents. Flagged for the orchestrator's full run.
- `system-log`, `system-log-routes.smoke`, `rate-limit`, `login-account-throttle.smoke` — 19/19 after the move;
  `retention-inventory` 4/4; `await-precedence` + ratchet + characterization 9/9.
- Final: characterization + surface + named guards + ratchets + both authz matrices + capability registry +
  CLAUDE.md split — 33/33. `tests/p06-claude-md-split.test.js` failed once at first run (pg boot contention), 3/3 on
  three re-runs.
- `npx eslint .` clean; `node tools/agent/inventory.js` and `--strict` regenerated.
- Full suite: not re-run by this lot; cite the orchestrator's latest run.

## What remains
- Next extractions per the ADR map: `routes/auth.js` (highest collision), weekly/monthly report routes, Zoho data
  routes, system-log routes, decks; reports-db `action_items`, identity, helpdesk, sites, WAN stores.
- Other inline helpers still in server.js (`_reportWriteDenial`, `_authorizeSiteWrite`, `_siteCodeReadDenied`,
  `_sitelessWriteDenied`) should become named guards when their routes move.
- CLAUDE.md replacement: waiting on the owner's approval.

## Human decision unblocked
- Approve (or amend) replacing CLAUDE.md with `P06-CLAUDE-md-proposed.md` + generated archives.

## STOP-AND-REPORT
None.
