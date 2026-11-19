# ADR-P06 — Target module map for server.js and reports-db.js (no new technology)

Status: accepted (engineering, reversible) · AI decision, AI-reviewed only · 2026-11-19 · base `e8900a7`

## Context
`server.js` (6,915 lines, 207 inline route registrations) and `reports-db.js` (5,860 lines, 218 exports) are the two
files every parallel bundle edits; merges collide there. Prompt P06 asks to reduce that surface with no behaviour
change and no new technology (no microservices, broker, framework or TypeScript).

## Decision
1. **Stack unchanged.** One Node/Express process, one PostgreSQL database, CommonJS modules. Extraction is a move of
   code, never a rewrite.
2. **Routes** move to `routes/<domain>.js`, a factory `module.exports = (deps) => router` (the pattern of
   `routes/inspection.js`, ADR-004 in `docs/adr/`). The router is mounted in `server.js` **at the exact place the
   block sat**, so route priority is preserved. URLs, middleware chains (names included — the authz walker reads
   them) and JSON shapes do not change.
3. **SQL** for one table family moves to `services/<domain>Store.js`, a factory taking the PostgreSQL handle getter.
   `reports-db.js` builds the store and re-exports every function **under the same name and kind**
   (`tests/p06-reports-db-surface.test.js`), so no caller changes.
4. **Authorisation helpers** that were closures in `server.js` become named guards in `services/namedGuards.js`
   and are catalogued in `services/capabilityRegistry.NAMED_GUARDS`, each mapped onto an existing capability with
   the same role set. The authz walker resolves inline named guards, so a check that used to be invisible to the
   matrix becomes visible (P02 can test it).
5. **Ratchet.** `tests/monolith-ratchet.test.js` holds a line ceiling for both files and an inline-route ceiling for
   `server.js`; each extraction lowers them in the same commit. Raising a ceiling is a reviewed decision.
6. **Proof per extraction:** a characterization test written and pinned against the inline code first (status,
   content-type, content-disposition, body shape, refusal text for every session class), unchanged after the move;
   `tools/agent/authz-diff.js` between the matrices before/after shows no added/removed route and no changed rule
   except a newly *visible* inline check.
7. **Order** = collision history (`node tools/agent/monolith-map.js`: distinct commits per route block / per export
   in the last 30 days, from `git blame`), largest blocks first among equals.

## Target map
| Today | Target module | State |
|---|---|---|
| `/api/assets/*` (41 routes) | `routes/assets.js` | done (P06 round 1) |
| `POST /api/reports/{scoreboard,weekly,asset-group,asset-reminders}/send` | `routes/digestSend.js` | done |
| `/api/admin/backup-*` + `_requireSuperAdminInline` | `routes/backupSchedule.js` + `services/namedGuards.js` | done |
| `requireMoneyRead` / `_canReadMoney` | `services/namedGuards.js` | done |
| system_log code in reports-db | `services/systemLogStore.js` | done |
| rate_limit_hits code in reports-db | `services/rateLimitStore.js` | done |
| `/api/reports/auth/*`, `/api/auth/*` (highest collision: 6 commits/30 d) | `routes/auth.js` | next |
| `/api/reports` core CRUD + `/api/reports/:id/*` sections, monthly, action | `routes/weeklyReports.js`, `routes/monthlyReports.js`, `routes/reportActions.js` | next |
| `/api/data/*`, `/api/metrics/*`, cache, debug | `routes/zohoData.js` | next |
| `/api/reports/system-log*` | `routes/systemLog.js` (store already extracted) | next |
| helpdesk-charts, exec-pptx, executive-new-pptx, save-pptx | `routes/reportsDecks.js` | next |
| reports-db `action_items` family (highest reports-db collision) | `services/actionItemsStore.js` | next |
| reports-db users / sessions / user_roles | `services/identityStore.js` | next |
| reports-db request_records / change_records / cab_approvals / survey_* | `services/helpdeskStore.js` | next |
| reports-db sites / site_module_codes / weeks | `services/sitesStore.js` | next |
| reports-db wan_* | `services/wanStore.js` | next |

## Consequences
- Parallel lots touch `routes/<domain>.js` instead of one 6 kLOC file; conflicts shrink to the domain changed.
- Moved code keeps `require('../…')` paths; any `require('./x')` inside a moved block must be rewritten
  (done mechanically) — a missed one fails at first call, which the characterization test exercises.
- Named guards keep their function name (`requireMoneyRead`), so the matrix's guard column is unchanged.
- Rollback: revert the commit; no data, schema or configuration is involved.
