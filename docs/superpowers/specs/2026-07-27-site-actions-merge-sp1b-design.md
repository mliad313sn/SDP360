# Site Actions — Stable Identity + Cross-Source Merge (SP1b) — Design

**Date:** 2026-07-27
**Branch:** `feat/site-actions-merge` (on top of the merged SP1a)
**Status:** design for review

## Problem

Coordinators have — over months — **retyped by hand** into the weekly report's
"Actions & Follow-ups" things that already exist as a **Meetings** or
**Inspection** action. These are *hidden duplicates*: the same real-world action
in two places, with no link. The SP1a hub shows them twice (once under Report
follow-ups, once under Meetings/Inspections), inflating the open count.

SP1a could not fix this because **`action_items` rows have no stable identity**:
`saveActionItems` does `DELETE`-all-then-`INSERT`-all on every report save
(`reports-db.js:2505-2530`), regenerating every row `id`. Nothing durable can be
pinned to a row.

## Goal

Let a coordinator **merge** a report follow-up into its Meetings/Inspection twin
from the SP1a hub: the local row becomes a **reference** to the origin (single
source of truth — status read + closed at the origin), folds under the origin's
theme, and stops counting as a separate open line. Reversible.

The enabling foundation: give `action_items` a **stable `uid`** and change the
save from destroy-and-recreate to an **upsert keyed by `uid`** so the merge
survives report re-saves (the chosen approach — durable over lighter, per the
2026-07-27 decision).

## Non-goals (deferred)

- **Cross-week lineage dedup** (`carried_from`/`lineage_uid` + the hub showing
  all weeks deduped instead of latest-only) — a small **SP1b-lineage** follow-on;
  the `uid` foundation this ships is exactly what it will build on.
- **SP2** (coordinator email actions-by-theme + hub link) and **SP3** (import
  Meetings/Inspection actions into the report section) — unchanged.

## Schema (additive, both backends)

Three columns on `action_items`, all nullable:

| Column | Type | Meaning |
|---|---|---|
| `uid` | TEXT | Stable per-row id (server-minted, `crypto.randomUUID`). Round-trips through the client. |
| `source` | TEXT | `NULL` = native follow-up; `'meetings'`/`'inspection'` = merged reference. |
| `origin_id` | INTEGER | The `md_actions.id` / `insp_actions.id` this row is merged into. |

- **SQLite**: two—err, three swallow-the-error `ALTER TABLE action_items ADD
  COLUMN …` blocks after `reports-db.js:346` (the established `department`/
  `comment` pattern).
- **PG**: add the three columns to the `003_reports.sql:51-57` CREATE (fresh
  DBs) AND append idempotent `ALTER TABLE action_items ADD COLUMN IF NOT EXISTS …`
  inside `initPgReports()` after the `003_reports.sql` exec (the
  `assets-db.js:44-47` pattern), so existing PG DBs get them.
- **Backfill (one-time, both backends):** at boot, after the ALTERs, `SELECT id
  FROM action_items WHERE uid IS NULL` → `UPDATE … SET uid=? WHERE id=?` with a
  JS-generated uid per row. Small table (weekly reports × ~5 rows). **Required**:
  without it, existing NULL-uid rows break the upsert's delete step
  (`uid NOT IN (…)` never matches NULL), duplicating rows on the first save.

## `saveActionItems` → upsert-by-uid (the hot-path change)

Both forks, in a transaction, replace DELETE-all+INSERT-all with:

1. `incoming = ` rows that carry a `uid`.
2. `DELETE FROM action_items WHERE report_id=? AND uid NOT IN (<incoming uids>)`
   — removes rows the user deleted. Guard the **empty-list** case (`incoming`
   empty → `DELETE … WHERE report_id=?`, i.e. all).
3. For each incoming row **in array order** (`sort_order = i`):
   - has `uid` AND row exists → `UPDATE` the **editable** fields only
     (`task, priority, due_date, owner, status, department, comment, sort_order`).
   - else → `INSERT` with a **freshly minted `uid`** (`sort_order = i`).
4. **`source` / `origin_id` are NEVER written here.** They are written only by
   the merge/unmerge endpoint. This is what makes the merge survive a re-save —
   even from a stale client that never saw the merge.

Golden/test safety (confirmed by the write-path map): no test asserts specific
`action_items.id`; the pg-reports test asserts exact **row counts** + content
round-trip (holds — uid-less rows still insert once); the monthly-PPTX and
weekly-email goldens render action **text** ordered by `sort_order`, not ids or
the new columns → **golden-safe**.

## Reader + route changes

- `validateActionItems` (`server.js:~6300`) — **whitelist `uid`** into `cleaned`
  (it currently drops unknown fields, and `saveActionItems` receives `cleaned`).
  `source`/`origin_id` are NOT accepted from the client (server-owned).
- `getReport().action_items` is `SELECT *` → the new columns flow to the client
  automatically. The **explicit-column** readers must add `uid, source,
  origin_id` to their SELECT: `getActionsForReport` (`2317`/pg `2678`) and
  `getPreviousWeekOpenActions` (`2277`/pg `2660`) — so carry-forward + future
  consumers see them.
- **New readers** (dual-backend): `setActionMerge(uid, {source, origin_id})` →
  `UPDATE action_items SET source=?, origin_id=? WHERE uid=?`; `clearActionMerge(uid)`
  → `SET source=NULL, origin_id=NULL WHERE uid=?`. Both return the affected
  action's `site_id` (via `report_id → weekly_reports.site_id`) for RBAC + a
  `{ok}`.
- **New routes**: `POST /api/reports/action/:uid/merge` (body `{source, origin_id}`)
  + `POST /api/reports/action/:uid/unmerge`. `requireReportSession` + **editor
  role** (matches the report side's existing posture — there is no
  `_userReportSite` helper; report scoping is by the list query + editor role).
  Validate `source ∈ {meetings, inspection}` + `origin_id` positive int → **400**.
  Registered ABOVE any `/api/reports/:id`-style catch-all.

## Hub (SP1a page) changes

- **Fold merged rows away**: `buildSiteActions` includes a report row only when
  `!a.source` (a merged follow-up is a duplicate of an origin already listed
  under Meetings/Inspections). The report `action_items` already carry `source`
  via `getReport`'s `SELECT *`. One-line filter; unit-pinned.
- **Merge affordance** on each report follow-up row in `site-actions.html`:
  a "⇄ same as…" control opens a picker of **that site's Meetings + Inspection
  actions already in the loaded payload** → pick one → `POST …/merge` → reload.
- **Suggested matches**: client-side, from the loaded payload — normalize
  (lowercase, strip punctuation) both titles and rank Meetings/Inspection actions
  by token overlap with the report row's title; highlight likely matches at the
  top of the picker. A hint only — never auto-merges.
- **Undo**: a successful merge shows a toast with **Undo** (calls `…/unmerge`)
  for a few seconds, so an accidental merge — which otherwise makes the row
  vanish from the report group — is recoverable.

## Client `reports.html` changes

- `addActionRow(a)` stashes `tr.dataset.uid = a.uid || ''` (hidden; no visual
  change).
- `collectActions()` adds `uid: tr.dataset.uid || undefined` per row.
- `source`/`origin_id` are **not** round-tripped (server-owned). Merged rows stay
  visible + editable in the report editor as before (the merge only affects the
  hub's dedup + the reference semantics); their status is still theirs until a
  future SP could read-through — out of scope here.

## Testing

- **Unit — upsert** (`tests/action-items-upsert.test.js`, temp sqlite): first
  save mints uids; re-save with same uids UPDATEs in place and **preserves a
  manually-set `source`/`origin_id`**; re-save omitting a row DELETEs it; re-save
  adding a row INSERTs it; empty save clears all. Row counts + uid stability
  asserted.
- **Unit — hub fold**: `buildSiteActions` drops report rows with `source` set.
- **Merge readers + routes** (`tests/site-actions-merge.smoke.test.js`): seed a
  report action (get its uid), `POST …/merge` → the hub payload no longer lists
  it under Report; `POST …/unmerge` → it returns; bad source/origin → 400.
- **Regression**: `tests/pg-reports-reports.test.js`, `tests/pptx-monthly-golden.test.js`,
  `tests/report-template-weekly.test.js`, `await-precedence` — all green,
  goldens **not** regenerated.
- **Browser**: merge a retyped follow-up into its inspection twin → it leaves the
  Report group and the count drops; Undo restores it; a normal report save
  afterwards does not resurrect the duplicate (durability proof).

## Known limitations (flagged)

1. A merged follow-up still shows in the **report editor** (reports.html) as a
   normal row; SP1b only changes the **hub**'s dedup + adds the link. Read-through
   status in the editor is a later refinement.
2. Suggestion matching is lexical (token overlap) — it proposes, the human
   confirms; it will miss paraphrases and is never authoritative.
3. Cross-week lineage dedup is still deferred (SP1b-lineage).
