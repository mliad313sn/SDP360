# P11 round 8 — fix lot fix/p11-r8-field (UX / field seat: F-29, F-30, F-31)

AI-authored engineering evidence — not an independent human review. No approval, signature, production readiness or
field acceptance is claimed, and no human cell of the business-readiness pack was filled. Base `7afb9536` (trunk).
Findings from `/home/user/qual/out/r8-ux-field.md` (F-29 P2, F-30 P3, F-31 P3); repros R8-N1 and R8-N5 from
`/home/user/qual/out/r8-ux-field-attack.test.js`.

**Failing first.** `tests/p11-r8-field-fixes.smoke.test.js` (4) and `tests/p11-r8-field-fixes.test.js` (6) were run with
every product file stashed (code at base): **10/10 failed** — at base the read carried no version (R8-N1 failed on its first assertion; the round-8 repro
output in the review shows the consequence: stale save 200, editor 2's two actions and the comment deleted); R8-N5
answered **401** with PostgreSQL unreachable. With the fix: 10/10 pass.

| Finding | Sev | Fix | Regression test |
|---|---|---|---|
| **F-29** a stale editor's save deleted the actions another editor had added (and their history); whole-inspection last-write-wins | P2 | **Optimistic concurrency.** `GET /api/inspection/:id` now puts `server_version` (inspection `updated_at` to the microsecond, as text) and `known_action_ids` in the form state. `saveInspection` (`inspection-db.js`) strips both (never stored) and, when a version is sent, compares it before any blob write and again under `SELECT … FOR UPDATE` in the transaction: different → typed 409 `CONFLICT`, `reason: inspection_changed`, `server_version` — nothing written. **Server-side protection:** with `known_action_ids`, an unmatched stored action whose id the client never loaded is never deleted by omission — it is kept and returned in `kept_rows` (same path as fix 32's kept rows). A register / phone action update touches `insp_actions` only, so it never makes the form stale. **Form (`public/inspection.html`):** sends both on Save now / Submit / the offline queue (an older local copy sends the ids it holds + removed); after a save it takes `version` and the stored ids from the answer and refreshes a light fingerprint of what it loaded (`base_fp`, stripped server-side). On a 409 it is **not queued** (a retry would be refused for ever): the local copy is kept (`<id>__conflict_backup` in the draft store), the user is asked (EN/FR) and, on OK, the latest version is loaded and **only what the user changed since the load** is reapplied (per field / finding / action against `base_fp`; without `base_fp` every local value). Nothing is re-sent until the user checks and clicks Save now. The offline queue dequeues a 409 and says so (EN/FR). Old callers (no version, no ids) keep today's behaviour. Field app untouched on this path (it only creates inspections; its idempotent replay and 409 handling are unchanged). | smoke: R8-N1 (409, rows + history intact, stale form state not written), unknown row kept without a version, version moves / register comment does not stale / removal by id still deletes / fields never stored; static: `reapplyLocalEdits` keeps the other editor's action, field and finding, reapplies own edits; the form sends/refreshes the fields, never queues a 409, keeps a backup, asks first, French for every new text |
| **F-30 (a)** after the retry cap every entry needed its own Try again | P3 | `public/field/app.js`: **Sync now** calls `flush({force:true, rearm:true})`; `rearmEntry` puts each `server_error` entry back to "will retry" with attempts reset. Coming back online does not re-arm (explicit action only). Refused / conflict entries are never resent automatically; per-entry Try again / Discard kept. | static: `rearmEntry` unit, Sync now wiring, online not re-arming, buttons kept |
| **F-30 (b)** PostgreSQL unreachable → 401 → phone said "Session expired" | P3 | `services/httpError.asUnavailable(e)`: `DB_BUSY` passes; connection errors (`ECONNREFUSED`/`ECONNRESET`/`ETIMEDOUT`/…, SQLSTATE class `08`, `57P01`–`57P03`, `53300`, "Connection terminated unexpectedly") become a typed **`DB_UNAVAILABLE` → 503 `database_unavailable` + Retry-After 5**. Used at every session check that used to swallow the error: the global `/api/` gate and `requireReportSession` (`server.js`) and `services/businessGuard.js`. Any other lookup error keeps its old answer (fail closed: 401 at the gate, 500 in `requireReportSession`). Phone: `database_unavailable` keeps the server's pace (no attempt counted), stops the round, says "still signed in" (EN/FR); bootstrap shows the same instead of the raw code. | smoke: field PUT, `/api/reports/auth/me` and bootstrap → 503 `database_unavailable` with Retry-After under ECONNREFUSED / 57P01; an invalid token still 401; static: retry plan, text + French, classifier unit |
| **F-31** site-awareness rule hard-coded "5"; insufficient cell unexplained; W3 summary cards English-only | P3 | `GET /api/site-awareness/fleet` returns `helpdesk_min_closed` from `kpiRag` policy `helpdesk-fleet-sla` (still PROPOSED, KPI committee); the EN/FR rule text uses `{min}` filled from it (generic wording if absent — never a made-up number). An `insufficient` helpdesk cell says "too few closed tickets to judge" (EN/FR). French entries for the project simplified-view cards, headings and empty states (`public/lib/i18n/project.fr.js`; each label is its own text node so the runtime layer translates it). | static: no literal 5 in the rule, `hdTip` reads the route value, insufficient marker, every card label has French |

Two round-7 assertions were updated because they pinned the old wording (`T('g_hd_tip')` → `hdTip()`, "fewer than 5" →
"fewer than {min}") and one picked the first `uiF` template by position (now by text). `docs/kpi/DECISION-KPIS-PROPOSAL.md`
re-anchored (`inspection-db.js:1190`).

No migration (the version is the existing `updated_at`).

## Tests run (this worktree, PostgreSQL 17 throwaway databases `*fix35*`)

- New: `p11-r8-field-fixes` 6/6, `p11-r8-field-fixes.smoke` 4/4.
- Related: `inspection*`, `pg-inspection`, `field-*`, `session*`, `auth-*` (incl. `auth-db-busy.smoke`),
  `i18n-coverage`, `ui-design-ratchet`, `a11y-*`, `site-awareness*`, `p11-r7-*`, `p11-r6-*`, `business-only*`,
  `soft-delete-insp*`, `cross-site*`, `http*`, `pg-pool-acquire-timeout`, `field-r6-transient-errors`: green after the
  fixes (400 tests in the first sweep, 4 failures fixed — two stale round-7 assertions and a `flushQueue` harness that
  does not define the new helper, guarded with `typeof`).
- Authz outcomes / matrices, `await-precedence`, `monolith-ratchet`, `server-size`, `csp-inline`: 47/47 green, no
  regeneration needed (no route added).
- Inventories regenerated (`ui-inventory`, `inventory` + `--strict`, `evidence-manifest`), suite manifest +10
  (total 6028), `tools/test/guard.js` ok, `kpi-docs-links` / `readme-truth` / inventory tests green, eslint clean.
- E2E journeys (`npm run test:e2e -- --runs=1`, Chromium): 43/43 journeys + 8/8 browser unit tests GREEN.

## Residuals and human decisions left (not decided here)

- `helpdesk-fleet-sla` bands and `min_closed: 5` stay **PROPOSED** — KPI committee (G-12).
- French wording of the new texts (inspection conflict, phone database message, project cards) awaits the French
  glossary validation by a French-speaking coordinator (D-2).
- Field UAT (A2-01…A2-07), pilot rule review (the "one editor per inspection" rule can be relaxed only after human UAT
  of the conflict flow), CAB deployment: human.
- A client older than this form (no version, no ids — e.g. a page cached before the deploy) keeps the old
  last-write-wins behaviour until it reloads the page (assets are versioned, so one reload suffices).
