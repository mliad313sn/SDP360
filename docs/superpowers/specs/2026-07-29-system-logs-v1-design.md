# System Logs (v1) — Design

**Date:** 2026-07-29
**Status:** Draft for review
**Scope:** SDP Dashboard — new **System Logs** module (security/audit), inspired by the 4MyPeople System Logs module. **Staged hybrid**: v1 = security audit + analytics on curated events; **v2 (out of scope here)** = per-request HTTP access log + Events/reconciliation (5xx, slow queries).

---

## 1. Goal

Give a super-admin a single, filterable, exportable **security audit log** of the SDP Dashboard — *who did what, when, from where* — plus an analytics view of trends and risk events. Today the app has only a **report-scoped** audit (`report_audit` via `logAudit`) and no authentication/identity/config logging at all; security events (logins, admin changes, config saves) are invisible or only in transient pm2 console output.

**Success criteria (v1):**
- Every event in the four instrumented categories lands in one queryable table.
- A super-admin can filter (actor / category / action / risk-only / date range / free-text), page, and export (CSV/JSON).
- An Analytics tab shows totals, risk-event count, distinct actors/IPs, a time series, top actions, most-active actors, activity-by-hour, and top source IPs.
- Logging **never breaks a request** (fire-and-forget, swallowed on error).

**Non-goals (v1):** per-request HTTP access logging on all traffic; DB slow-query / 5xx capture; the "Events & reconciliation" tab (shown disabled, labelled v2). No log-forwarding/SIEM export beyond CSV/JSON.

---

## 2. Approach (chosen: A)

**A — one `system_log` table + a `logEvent` helper (dual-backend), instrument the four categories, and mirror the existing report audit into it with ONE added line in `logAudit`.**

- Single source of truth → a simple single-table reader + analytics.
- Non-invasive: the 11 existing `logAudit` call sites are untouched; `logAudit` gains one line to also `logEvent({category:'report', …})`.
- Rejected: **B** union `system_log` + `report_audit` at read time (reader/pagination complexity across two tables); **C** generalise/rename `report_audit` and migrate all callers (invasive, touches the reports audit UI).

Backend follows the rest of reports.db: sqlite + a `_…Pg` fork, selected by `REPORTS_BACKEND` (prod = postgres). Same dual-backend + `await`-precedence discipline as every other reports.db reader.

---

## 3. Data model — `system_log`

reports.db (sqlite `_initSchema` CREATE + pg `db/postgres/reports/00X_system_log.sql`, execed by `initPgReports`), pg copy via a `tools/pg/copy-reports-*` addition.

| Column | Type | Meaning |
|---|---|---|
| `id` | INTEGER PK (sqlite AUTOINCREMENT-free) / BIGSERIAL-free per house rule | surrogate |
| `ts` | TEXT ISO-8601 (UTC) | event time; TEXT on both backends (house rule — no `::date` casts) |
| `category` | TEXT | `auth` \| `identity` \| `config` \| `report` |
| `action` | TEXT | typed slug (see §5) |
| `actor` | TEXT | username, or `anonymous` (no session), or `system` (cron/automation) |
| `actor_id` | INTEGER NULL | users.id when known |
| `target` | TEXT NULL | affected object (username / report id / config key) |
| `details` | TEXT NULL | JSON string (small; never secrets) |
| `ip` | TEXT NULL | `req.ip` / first `x-forwarded-for` hop (already resolved elsewhere) |
| `risk` | INTEGER NOT NULL DEFAULT 0 | 1 = security-relevant (see §5 risk predicate) |

Indexes: `(ts)`, `(category)`, `(action)`, `(actor)`, `(risk)`. (sqlite: plain indexes; pg: same.)

**Retention:** v1 volume is low (curated events, not per-request), so no aggressive rotation. A future `pruneSystemLog(olderThanDays)` + an admin button is noted as a fast-follow, not built in v1. Nothing auto-deletes in v1.

**PII/secrets rule:** `details` NEVER stores passwords, tokens, session ids, or full request bodies. Config-save events store the **key name(s)** changed, not values (and never `smtp_pass`). Login-failed stores the attempted **username only** (already public-ish), never the password.

---

## 4. Capture — `logEvent`

`reports-db.js` exports `logEvent({ category, action, actor, actor_id, target, details, ip, risk })` — dual-backend, **fire-and-forget**:

- Wrapped so a logging failure is caught and swallowed (a dead log must never 500 a real request); it `console.warn`s once on failure.
- `risk` is derived from `action` via a pure `_isRiskAction(action)` predicate if not passed explicitly, so callers can't forget to flag a security event.
- `ts` server-authoritative (never a client clock).
- `details` is `JSON.stringify`'d if an object.

A tiny `req`→context helper (`_logCtx(req)` → `{actor, actor_id, ip}`) reads `req.reportUser` (username/id) + the already-resolved client IP, defaulting to `anonymous`/null. Used at every call site so instrumentation is one line.

---

## 5. Instrumented events (the four categories)

**auth**
- `login_success` — on successful login (`req.body.username`).
- `login_failed` *(risk)* — on a rejected login attempt (bad password / unknown user / locked). Actor = attempted username or `anonymous`.
- `logout` — on logout.
- `session_killed` *(risk)* — on super-admin force-logout of a session (existing `DELETE /api/reports/sessions/:token`); target = the killed user.

**identity**
- `user_created`, `user_updated`, `user_deleted` *(delete = risk)* — user CRUD in the admin console.
- `user_role_changed` *(risk)*, `user_site_changed` — when role/site changes (privilege change is security-relevant).
- `password_reset` *(risk)* — admin password reset for a user.

**config**
- `config_saved` — target = the config surface (e.g. `report_config`, `smtp`, `group_presets`, `sites`, `departments`, `rr_aliases`, `schedule`, `assets_finance`, `deprec`). details = changed key names (never values).

**report** (mirrored from existing `logAudit`, no re-instrumentation)
- `report_deleted` *(risk)*, `report_edited_infra`, `report_edited_helpdesk`, `report_edited_lights`, `report_edited_actions`, `report_status_changed`, `report_reassigned_week`. `logAudit` maps its `action` → a `report_*` slug and calls `logEvent(category:'report', target: report_id, actor: username, details: {...})`.

**Risk predicate** `_isRiskAction`: the actions tagged *(risk)* above → `login_failed`, `session_killed`, `user_deleted`, `user_role_changed`, `password_reset`, `report_deleted`. Central list so the red "risk events" count is consistent between the table filter and the analytics tile.

*(Optional one-time backfill: copy existing `report_audit` rows into `system_log` at first boot after deploy so history isn't blank. Additive, idempotent by a marker; if skipped, v1 simply starts capturing forward — acceptable, same "can't reconstruct the past" doctrine as reconcile-history.)*

---

## 6. Read path — readers + API (super_admin only)

`reports-db.js` (dual-backend, await-covered):
- `listSystemLog(filters, {limit=50, offset=0})` → rows, newest first. Filters: `actor` (exact/like), `category`, `action`, `risk` (1 = risk only), `from`/`to` (ISO date, `substr(ts,1,10) BETWEEN` — house rule, correct on both backends), `q` (free-text over action/target/details/actor).
- `countSystemLog(filters)` → total for pagination.
- `getSystemLogAnalytics({window})` → `{ totals: {events, risk_events, distinct_actors, distinct_ips}, series[], risk_series[], top_actions[], top_actors[], by_hour[24], top_ips[] }` over `window` (7/30/90 days).

Routes (server.js, `requireReportSession` + super-admin gate; registered ABOVE `/api/reports/:id` to avoid the documented `:id` shadowing):
- `GET /api/reports/system-log` (list + `X-Total-Count` or `{rows,total}`).
- `GET /api/reports/system-log/analytics?window=`.
- `GET /api/reports/system-log/export.csv` and `…/export.json` (UTF-8 BOM + CRLF for CSV, mirroring the existing export helpers).

All four `list` filter params are whitelisted; the readers use parameterised SQL only (no interpolation) — proven un-500-able on SQLi/path-traversal-shaped input, as with the review-data route.

---

## 7. UI — `public/system-logs.html`

Standalone page, **app shell (`#__shell`) + module-tabs** (consistent with the just-landed navigation work), served from `_htmlCache` + a `sendHtmlPage` route.

- **Tab bar (module-tabs, `data-module="system_logs"`):** *Log entries* · *Analytics & trends* · *Events & reconciliation* (disabled, `title="v2"`).
- **Log entries:** filter bar (actor / category / action / risk-only / from / to / search + Clear), total count, paginated table (Date/time · Actor · Category · Action · Target · IP · Risk badge), **Export CSV / JSON** buttons. "Problems only" = risk filter.
- **Analytics & trends:** window selector (7/30/90d) + KPI tiles (Events · Risk events (red) · Distinct actors · Distinct IPs) + Chart.js charts (activity over time, risk over time, top actions, most active actors, activity by hour, top source IPs) — the 4MyPeople layout, brand-styled.
- **Access:** **super_admin only** (rail entry + page gate). *Decision to confirm/revisit: admin read-only could later be a config toggle; v1 is super_admin.* Reached via a nav entry (super-admin-gated) **and** a link from `reports.html#admin`.

RBAC is enforced **server-side** on every route (the page gate is convenience only).

---

## 8. Testing strategy

- **Pure/unit:** `_isRiskAction` predicate (each action → expected risk), `logEvent` detail/JSON coercion, analytics aggregation shape on a seeded in-memory set.
- **Dual-backend readers:** `listSystemLog`/`countSystemLog`/`getSystemLogAnalytics` covered by the auto-discovering `await-precedence` test + a sqlite round-trip test (insert via `logEvent`, read back with filters).
- **Route smoke:** boots the app (sqlite), asserts super_admin gate (403 for lesser roles), filter whitelist un-500-able on hostile input, CSV/JSON export shape.
- **Non-blocking guarantee:** a test that `logEvent` with a broken DB handle does NOT throw to the caller.
- **No golden/PPTX/email impact** — this module touches none of those surfaces.

---

## 9. Deploy notes

- `system_log` table auto-created at boot (sqlite `_initSchema` / pg `initPgReports`), idempotent; no backfill required for correctness.
- `server.js` + `system-logs.html` are server-code / `_htmlCache` surfaces → after the ZIP is applied, `pm2 stop` → wait → `pm2 start` (not reload), then one Ctrl+F5.
- pg schema shipped as a numbered `db/postgres/reports/*.sql` + added to the reports copy tooling.

---

## 10. v2 (documented, not built)

Per-request HTTP access log (route/method/status/latency/actor/IP/request-id on all traffic) → the *Log entries* volume story + the *Events & reconciliation* tab (5xx, access-denied, slow requests, DB slow/errors, top failing routes, slowest endpoints, failed-login clusters, per-request trail reconstruction). Needs: a request-logging middleware, a higher-volume table with **retention/rotation**, and DB-timing capture. Deferred because the write volume + storage + rotation are the heavy part; v1 delivers the security-audit value first.
