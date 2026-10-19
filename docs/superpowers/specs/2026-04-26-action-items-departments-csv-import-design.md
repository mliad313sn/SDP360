# Action Items — Departments + Comment + CSV Bulk Import

**Status**: Approved by user (overall design), pending spec review and implementation plan
**Date**: 2026-04-26
**Touches**: `reports-db.js`, `server.js`, `public/reports.html`, `reports-weekly-pptx.js`, `reports-monthly-pptx.js`, `reports-pptx.js` (verify wiring)

---

## 1. Motivation

Site IT admins currently track weekly action items with five fields (task, priority, due date, owner, status). Two gaps surfaced from operational use:

1. **No way to attribute an action to the business department it serves** (Mining, Finance, etc.). Without that, leadership reports cannot answer "which departments are driving most of our action backlog?" and follow-up routing is ambiguous.
2. **No way to record context** ("why is this on hold?", "blocked by vendor", "approved by GM"). Comments live only in PowerPoint slide notes, never in the system of record.
3. **No bulk entry**. Sites with 30+ actions in a week type each one by hand, or copy-paste from a CSV row by row. This is the single largest data-entry friction point for the weekly process.

This design adds a **Department** (mandatory, dropdown) and **Comment** (optional, multiline) field to action items, plus a **CSV import** flow with a downloadable template.

## 2. Locked-in decisions (from brainstorming)

| # | Question | Decision |
|---|----------|----------|
| 1 | Department type | Editable dropdown, seeded with 10 values, super_admin can add/edit. **Mandatory** on save. |
| 2 | Comment field | Multiline textarea, optional, dashboard-only (not in PPTX) |
| 3 | CSV import behavior | **Append** (new rows added below existing). User reviews and deletes duplicates before saving. |
| 4 | CSV format | English headers (A1) + forgiving parser for enums and dates (B3) |
| 5 | CSV validation | Lenient with row-level error report (skip bad rows, import good ones, show what was skipped) |
| 6 | Existing rows | Leave NULL, render as `—`. New saves require department on **all visible rows** (Strict). |
| 7 | Architecture | Hybrid (Option 3): client parses CSV, server validates enums regardless of source |

### Default departments (seed)
1. Mining
2. Technical Service
3. Processing
4. Maintenance
5. Supply Chain
6. Security
7. Finance
8. Human Resource
9. Social performance
10. General Manager

## 3. Data model

### 3.1 New columns on `action_items`

```sql
ALTER TABLE action_items ADD COLUMN department TEXT;     -- nullable in DB
ALTER TABLE action_items ADD COLUMN comment    TEXT;     -- always optional
```

- Both nullable in the DB so historical rows survive the migration unchanged.
- `department` is enforced as **NOT NULL by the server-side validator**, not a DB constraint. This gives the "legacy rows display as `—`, but new saves require a department" behavior.

### 3.2 New table `action_departments`

```sql
CREATE TABLE IF NOT EXISTS action_departments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  sort_order INTEGER DEFAULT 0,
  active     INTEGER DEFAULT 1,           -- 0 = soft-deleted
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);
```

### 3.3 Seed on first run

Same `db.exec(SEED_SQL)` block that creates the table inserts the 10 defaults only when the table is empty:

```sql
INSERT INTO action_departments (name, sort_order)
SELECT name, sort_order FROM (VALUES
  ('Mining', 1), ('Technical Service', 2), ('Processing', 3), ('Maintenance', 4),
  ('Supply Chain', 5), ('Security', 6), ('Finance', 7), ('Human Resource', 8),
  ('Social performance', 9), ('General Manager', 10)
) AS s(name, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM action_departments);
```

### 3.4 Soft-delete and rename semantics

- **Disable**: sets `active=0`. Department disappears from new dropdowns; historical action_items keep the disabled name as their stored TEXT (no FK relationship).
- **Reactivate**: sets `active=1`. The same row appears again in the dropdown.
- **Rename**: `UPDATE action_departments SET name=...`. **Existing action_items keep the old name** because their `department` column is a TEXT snapshot, not a join. If retroactive rename is needed in the future, it's a separate migration.
- **Delete duplicates from a future POST**: if an admin POSTs a name that matches an existing inactive department (case-insensitive trim), the server reactivates that row instead of failing on the UNIQUE constraint.

## 4. Departments admin (CRUD)

### 4.1 UI placement

A new card on the Admin page (`#page-admin` in `reports.html`), placed **below** the existing **Sites — Zoho Group Mapping** card.

Card title: `🏷 Departments — Action Item Categories`
Subtitle: "Departments shown in the action items dropdown."
Top-right button: `+ New Department`

Table columns: `# | Name | Order | Status | Actions (✏ Edit | ⊘ Disable / ↻ Enable)`

### 4.2 Edit modal

Mirrors the existing User modal pattern. Fields:
- `name` (required, unique case-insensitive trim, max 60 chars)
- `sort_order` (integer, default = current count + 1)
- `active` (checkbox, default true)

### 4.3 RBAC

| Role | List active | List all | Create | Update | Disable / Enable |
|------|:-----------:|:--------:|:------:|:------:|:----------------:|
| viewer | ✓ | — | — | — | — |
| editor | ✓ | — | — | — | — |
| admin | ✓ | — | — | — | — |
| executive | ✓ | ✓ | ✓ | ✓ | ✓ |
| super_admin | ✓ | ✓ | ✓ | ✓ | ✓ |

The `GET` endpoint returning **only active** is callable by any authenticated session because the action-items dropdown needs it. Admin views (with `?include_inactive=1`) and all mutations require executive or super_admin.

### 4.4 Endpoints

| Method | Path | Auth | Body / query | Response |
|--------|------|------|--------------|----------|
| `GET`  | `/api/reports/departments` | session | `?include_inactive=1` | `[{id,name,sort_order,active}]` |
| `POST` | `/api/reports/departments` | exec+ | `{name, sort_order?}` | `{id, ...}` |
| `PUT`  | `/api/reports/departments/:id` | exec+ | `{name?, sort_order?, active?}` | `{ok:true}` |
| `DELETE` | `/api/reports/departments/:id` | exec+ | — | `{ok:true}` (soft-delete) |

### 4.5 Audit logging

Every mutation writes a row to the existing `audit_log` table:
- `action`: one of `department_created`, `department_updated`, `department_disabled`, `department_enabled`
- `details` JSON: `{name, before?, after?}`

## 5. Action items UI changes (weekly + monthly)

### 5.1 Weekly table layout

In `public/reports.html` Section 3 (line ~588). Two new columns inserted; existing widths rebalanced.

| Column | Old % | New % | Notes |
|--------|------:|------:|-------|
| Task / Action | 35 | 24 | Slight squeeze; still the widest |
| **Department** | — | **12** | New `<select>` |
| Priority | 11 | 9 | |
| Due Date | 14 | 11 | |
| Owner | 18 | 13 | |
| Status | 13 | 11 | |
| **Comment** | — | **15** | New — preview + expand |
| ✕ remove | 5 | 5 | unchanged |

### 5.2 Department cell

`<select>` populated from cached `_departmentList` (loaded once on page open via `loadDepartmentList()`, which mirrors the existing `loadTechnicianList()`). For **legacy rows** with `department === null || ''`, the first `<option>` is `— Select —` with disabled `value=""`. When user picks a real department, that placeholder becomes unselectable.

**Client-side blocks before server hit** (defense in depth, friendlier UX):
- On clicking `💾 Save Action Items`, `collectActions()` (or a new `validateActionsBeforeSave()` wrapper) iterates rows. Any row with empty department triggers a toast: `❌ N row(s) missing department — please select one before saving.` plus a red border on the offending `<select>` cells. The PUT is **not** sent.
- Server-side validation (Section 9.1) is still enforced as defense — if a malformed payload reaches the endpoint somehow, it's rejected with 400 + row indices. The toast for the server-side error path mirrors the client-side wording, so users see the same message regardless.

### 5.3 Comment cell

Click-to-expand pattern — each visible action `<tr class="action-row">` is paired with a hidden sibling `<tr class="action-comment-row" style="display:none">` that spans the full table width and contains a `<textarea rows="3" maxlength="2000">`.

Behavior:
- Cell renders 1-line preview (max ~40 chars + `…`) plus a `📝` icon at the right.
- Click cell → toggle sibling row to display, focus textarea.
- Click outside / Esc / `Done` button → collapse, update preview.
- Empty comment → preview shows muted "Add comment…" placeholder.

### 5.4 `addActionRow(a)` — extended

```js
a = a || {
  task: '', priority: 'Medium', due_date: '', owner: '', status: 'open',
  department: '', comment: ''
};
```

Adds: department `<select>`, comment cell (preview + icon), sibling comment row containing the `<textarea>`.

### 5.5 `collectActions()` — extended

Reads `department` from the new `<select>` and `comment` from the sibling row's `<textarea>`.

### 5.6 Monthly editor

`renderMonthlyActions` (line ~3259) gets the same two columns added in the same way.

The monthly **auto-merge** lives inside `getMonthlyEdits` in `reports-db.js` (line ~1640) — it builds `actionsRaw` from each week's `action_items` rows. Two changes required there:

1. The inner `SELECT * FROM action_items` (line ~1669) already returns the new columns once the schema is migrated, **but the JS that copies fields into `actionsRaw` (line ~1670-1677) is an explicit list and silently drops anything not enumerated**. Update the copy to include `department` and `comment`.
2. Dedup key (line ~1701) currently is `task + '||' + owner` (lowercased + trimmed). **Keep this key unchanged** — adding department or comment to the key would fragment dedup (a single action with a corrected typo in the comment would appear twice). Same-task-same-owner rows from later weeks already overwrite earlier ones, so the dedup'd row carries the latest week's department + comment.

### 5.7 CSS additions (~15 lines)

- `.action-comment-row td` (full-width container)
- `.action-comment-row textarea` (height, font, border)
- `.action-comment-preview` (muted color, single-line ellipsis)
- `.action-comment-icon` (small button)

## 6. CSV import + template export

### 6.1 Button placement

In Section 3 of `reports.html`, immediately after the existing "Import all from previous week" button (the green-rectangle area in the user's screenshot):

```html
<button class="btn btn-secondary btn-sm btn-add-row" onclick="addActionRow()">+ Add Action</button>
<button class="btn btn-secondary btn-sm" onclick="carryOverActions()" style="margin-left:10px">↩ Import all (except closed) from previous week</button>
<button class="btn btn-secondary btn-sm" onclick="downloadActionsTemplate()" style="margin-left:10px">⬇ CSV Template</button>
<button class="btn btn-secondary btn-sm" onclick="document.getElementById('actions-csv-file').click()" style="margin-left:6px">⬆ Import CSV</button>
<input type="file" id="actions-csv-file" accept=".csv,text/csv" style="display:none" onchange="onActionsCsvSelected(event)">
```

### 6.2 Template download

`downloadActionsTemplate()` is pure client-side. It builds a CSV string in memory and triggers a download as `action-items-template.csv`:

```csv
task,department,priority,due_date,owner,status,comment
"Replace failed UPS in server room","Technical Service","High","2026-05-15","Jean Doe","open","Sample comment"
"Verify backup runs weekly","General Manager","Medium","2026-05-30","Marie Diallo","in_progress","Pending vendor confirmation"
"Document network rack labeling","Technical Service","Low","","","open",""
```

A small ℹ help link beside the template button opens a modal listing allowed enum values + the live list of active departments fetched via `/api/reports/departments`.

### 6.3 Import flow

`onActionsCsvSelected(event)`:

1. `FileReader.readAsText()` (UTF-8). Reject if file > 200 KB.
2. Strip UTF-8 BOM if present (handles Excel Windows saves).
3. Parse via `parseActionsCsv(text, deptList)` (Section 7).
4. Validate. Produce `{ok: [...], errors: [{row, reason}]}`.
5. Show confirmation modal:
   ```
   ✓ N rows ready to append
   ⚠ M rows skipped (see list)
   Currently X actions in this week's table.
   After import: X+N actions.

   Skipped rows:
     Row 5  — Unknown department 'Logistics'
     Row 12 — Invalid date '32/13/2026'
     Row 23 — Empty task field

   [Cancel]  [Append N rows]
   ```
6. On confirm: each `ok` row → `addActionRow(row)` (just like the existing carry-over flow). User reviews, deletes duplicates, clicks `💾 Save Action Items` to persist via existing `PUT /api/reports/:id/actions`.
7. The skipped-rows list is duplicated into a banner above the table that persists until dismissed.

**Note** — the same staging behavior applies to the **carry-over** flow already in place. After importing CSV rows or carrying-over previous-week rows, any imported row with an empty department (e.g. legacy rows brought forward) blocks the save until the user picks a department for it. Section 5.2 covers the client-side validation that handles this uniformly.

**No new server endpoint for CSV.** The existing PUT endpoint (with new validation, Section 9) is the single write path.

## 7. CSV parser format spec

### 7.1 Header row

- Required canonical names (any order): `task`, `department`, `priority`, `due_date`, `owner`, `status`
- Optional: `comment`
- Case-insensitive, trimmed, with French/English synonym tolerance:

| Canonical | Also accepted |
|-----------|---------------|
| `task` | `Task`, `Action`, `Tâche`, `Task / Action` |
| `department` | `Department`, `Dept`, `Département` |
| `priority` | `Priority`, `Priorité` |
| `due_date` | `Due Date`, `Due`, `Échéance`, `Date` |
| `owner` | `Owner`, `Assignee`, `Responsable` |
| `status` | `Status`, `Statut`, `State` |
| `comment` | `Comment`, `Comments`, `Note`, `Notes`, `Commentaire` |

- Missing required column → reject the whole file with `❌ Missing required column "X". Re-download the template.`
- Extra columns → ignored silently (forward-compat).

### 7.2 Row parsing

Small purpose-built parser, ~60 LOC, RFC 4180-ish:
- Split by lines but respect double-quoted fields (may contain commas or newlines).
- `""` inside a quoted field = literal quote.
- Trim outer whitespace on unquoted fields; preserve whitespace inside quoted fields.
- Empty trailing rows ignored.
- Max **5000 data rows**; reject if exceeded.

### 7.3 Per-field validation and normalization

| Field | Rule | If invalid → |
|-------|------|--------------|
| `task` | Required, non-empty after trim, max 500 chars | Skip row, error |
| `department` | Required, must match an active department (case-insensitive trim). Normalize to canonical casing. | Skip row, error |
| `priority` | Optional. Default `Medium`. Accepts `High/Medium/Low/H/M/L/Haute/Moyenne/Basse` (case-insensitive) | Non-empty unparseable → skip row |
| `due_date` | Optional. Empty → NULL. Accepts `YYYY-MM-DD`, unambiguous DMY/MDY. | Ambiguous or invalid → skip row |
| `owner` | Optional. Free text, max 100 chars | Truncate at 100 |
| `status` | Optional. Default `open`. Accepts `open/in_progress/on_hold/closed/cancelled` and common variants/French | Unparseable → skip row |
| `comment` | Optional. Max 2000 chars | Truncate |

**Normalization happens entirely client-side at parse time.** The CSV parser produces canonical English values (`open`, `in_progress`, `Medium`, etc.) before posting. The server-side validator (Section 9.1) accepts **only canonical English values** — it does not need to handle French variants or case normalization. This keeps server logic simple and gives a single source of truth for canonical names.

### 7.4 Date format detection

1. Match `^\d{4}-\d{2}-\d{2}$` → ISO. Validate via `new Date()` and round-trip check.
2. Match `^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$`:
   - First slot > 12 → DD/MM/YYYY (or DD-MM-YYYY)
   - Second slot > 12 → MM/DD/YYYY
   - Both ≤ 12 → **ambiguous** → skip with explicit error
3. Anything else → invalid.

Deliberately rejects ambiguous DMY/MDY rather than guessing.

### 7.5 Output

```js
{
  ok:     [ { task, department, priority, due_date, owner, status, comment }, ... ],
  errors: [ { row: 5, reason: "unknown department 'Logistics'" }, ... ]
}
```

`row` is 1-indexed CSV file row number (header = row 1, first data row = row 2).

### 7.6 Location

A single self-contained pure function `parseActionsCsv(text, deptList)` defined in `reports.html` next to `addActionRow`.

## 8. PPTX export changes

### 8.1 Files affected

Per CLAUDE.md duplication rule:
- `reports-weekly-pptx.js` — both `slideActionItems` (weekly) and `slideMonthlyActionsV2` (monthly)
- `reports-monthly-pptx.js` — `slideMonthlyActionsV2` only
- `reports-pptx.js` — **verify wiring first**. Per CLAUDE.md it is "older variant, not listed in canonical Key Files; verify it's still wired into a route, button, or scheduled job before treating it as live; otherwise delete it rather than maintaining a third copy." Implementation step: grep `server.js` and any `.bat` for `reports-pptx`. If wired, update. If not, surface to the user as a separate PR/decision.

### 8.2 Weekly action slide (`slideActionItems`, line ~547)

Current widths (sum 12.73"): `Task: 7.53 | Priority: 1.2 | Due Date: 1.4 | Owner: 1.4 | Status: 1.2`

New widths (sum 12.73"): `Task: 6.13 | Department: 1.4 | Priority: 1.2 | Due Date: 1.4 | Owner: 1.4 | Status: 1.2`

- Task loses 1.4" but still has 6.13" — comfortable for descriptions.
- Department column inserted between Task and Priority. Header `Department`, cells aligned center, fontSize **10** (one notch smaller than 11 for readability with longer names like "Social performance"). Color `C.darkGrey`. No bold.
- Cells render `a.department || '—'` (legacy NULL → em-dash, never break).
- All other columns unchanged.

### 8.3 Monthly action slide (`slideMonthlyActionsV2`, line ~1269)

Current widths (sum 12.73"): `Week: 1.2 | Task: 6.93 | Priority: 1.0 | Due Date: 1.1 | Owner: 1.3 | Status: 1.2`

New widths (sum 12.73"): `Week: 1.2 | Task: 5.53 | Department: 1.4 | Priority: 1.0 | Due Date: 1.1 | Owner: 1.3 | Status: 1.2`

- Department column inserted between **Task and Priority** (same position as in the weekly slide).
- Department width = 1.4" — matches the weekly slide for visual consistency.
- Task absorbs the loss (6.93" → 5.53"). Still the widest column.
- Existing fontSize is 9 → Department uses fontSize **8** for the body cells (header stays 9 for legibility, matching the existing pattern).
- Cell renders `a.department || '—'` (legacy NULL → em-dash).

### 8.3.1 Pre-existing subtitle violation — fix in the same change

`slideMonthlyActionsV2` currently calls `addTitle(slide, ..., 'All Weeks Combined')` on line 1271, which **violates** the CLAUDE.md rule: "Always `addTitle(slide, 'Title', null)` — never pass a subtitle". This is a pre-existing bug, not something this design introduces. Since we're editing this slide anyway, the implementation plan **must change line 1271 to `addTitle(slide, '6. Actions & Follow-ups — ${monthLabel}', null)`** (and apply the same fix in the duplicates in `reports-monthly-pptx.js` and `reports-pptx.js` if wired). All three sibling monthly slides (`slideMonthlyLightsV2` line 1198, etc.) likely have similar violations — those are **out of scope** for this change but should be flagged as follow-up.

### 8.4 Comment column

**NOT added** to either slide (Q2 decision — comment stays dashboard-only). Row heights unchanged.

### 8.5 Sanity checks vs CLAUDE.md PPTX rules

- ✓ Content width 12.73", x=0.3
- ✓ Weekly title: `addTitle(slide, '4. Action Items & Follow-ups', null)` (already compliant)
- Monthly title: **currently non-compliant** (passes subtitle); fixed by this change per Section 8.3.1
- ✓ No new emoji introduced
- ✓ No interaction with helpdesk KPI strip geometry

## 9. Server-side validation (defense in depth)

### 9.1 `PUT /api/reports/:id/actions` — extended

```js
const VALID_PRIORITY = new Set(['High', 'Medium', 'Low']);
const VALID_STATUS   = new Set(['open', 'in_progress', 'on_hold', 'closed', 'cancelled']);

const activeDepts = new Set(rdb.listDepartments({ active: true }).map(d => d.name));

const errors = [];
const cleaned = items.map((a, i) => {
  if (!a.task || !String(a.task).trim()) errors.push({ i, reason: 'empty task' });
  if (!a.department || !activeDepts.has(a.department))
    errors.push({ i, reason: `unknown or missing department '${a.department || ''}'` });
  if (a.priority && !VALID_PRIORITY.has(a.priority))
    errors.push({ i, reason: `invalid priority '${a.priority}'` });
  if (a.status && !VALID_STATUS.has(a.status))
    errors.push({ i, reason: `invalid status '${a.status}'` });
  if (a.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(a.due_date))
    errors.push({ i, reason: 'due_date must be YYYY-MM-DD' });
  if (a.comment && String(a.comment).length > 2000)
    a.comment = String(a.comment).slice(0, 2000);
  return a;
});
if (errors.length) return res.status(400).json({ error: 'validation', details: errors });

rdb.saveActionItems(id, cleaned);
```

### 9.2 Strict policy for legacy NULL departments

Server enforces non-null `department` on **every** row in the save payload. Legacy rows with NULL show "— Select —" in the UI; user must replace before save. If they don't, server returns 400 with row indices. Forces hygiene over time.

(Rejected the "grandfathered" alternative — detecting unmodified legacy rows requires versioning and is hard to implement cleanly. Strict is simpler and the user opts into the policy by editing.)

### 9.3 `saveActionItems` — extended

```js
const saveActionItems = db.transaction((report_id, items) => {
  db.prepare(`DELETE FROM action_items WHERE report_id=?`).run(report_id);
  const ins = db.prepare(`
    INSERT INTO action_items
      (report_id, task, priority, due_date, owner, status, department, comment, sort_order)
    VALUES (?,?,?,?,?,?,?,?,?)
  `);
  items.forEach((a, i) => ins.run(
    report_id,
    a.task,
    a.priority || 'Medium',
    a.due_date || null,
    a.owner    || null,
    a.status   || 'open',
    a.department || null,
    a.comment    || null,
    i
  ));
});
```

**`getReport()` (line ~557)** automatically picks up the new columns because it does `SELECT * FROM action_items`. ✓

**`getMonthlyEdits()` (line ~1640)** — the inner SQL is `SELECT *` (line ~1669) which returns the new columns, **but** the JS code immediately copies fields into `actionsRaw` using an explicit object literal (line ~1670-1677). That literal **must** be extended to include `department` and `comment`. Without this, monthly auto-merge silently drops both fields.

### 9.4 Carry-over and read functions — explicit columns to extend

The following functions in `reports-db.js` use explicit-column SELECTs and need `department, comment` added to their SELECT lists:

| Function | Line (approx) | Current SELECT |
|----------|---------------|----------------|
| `getPreviousWeekOpenActions` | 644 | `task, priority, due_date, owner, status, sort_order` |
| `getActionsForReport` | 680 | `task, priority, due_date, owner, status, sort_order` |

Plus the JS field copy in `getMonthlyEdits` covered in 9.3 above.

No structural change — only the column lists.

### 9.5 Departments CRUD validation

- Name: required, trimmed, max 60 chars, unique case-insensitive.
- POST collision with **inactive** existing row of same name → reactivate that row instead of failing on UNIQUE.
- DELETE is always soft (`active=0`). Hard-delete is not exposed.
- Audit-log every mutation.

## 10. Backward compatibility

| Concern | Behavior |
|---------|----------|
| Existing action_items in DB | Load and display unchanged. `department` column is added as nullable. Legacy rows render `—` in UI and PPTX. |
| Reports submitted before this change | Untouched. Read paths work without modification because new columns are nullable. |
| Editing a legacy report | Saving forces all rows to have a department (Strict). User picks one; row stays at the same `sort_order`. |
| Carry-over from a legacy week | Old rows arrive with NULL department; user picks one before saving. |
| PPTX of a legacy report | Renders `—` in the new Department column. No layout breakage. |
| API consumers (none known external) | The existing PUT endpoint still accepts the same shape; it now also accepts `department` and `comment`. Old clients posting without `department` get 400. |

## 11. Testing

### 11.1 Manual checklist

| # | Test | Expected |
|---|------|----------|
| 1 | Apply migration to a backup of live `reports.db` | Schema matches; all reports load without error |
| 2 | Department CRUD — create, edit, disable, reactivate | All work; audit_log rows present |
| 3 | RBAC — `editor` POSTs department | 403 |
| 4 | RBAC — `executive` POSTs department | 200 |
| 5 | Action save with valid department | 200 |
| 6 | Action save with unknown department | 400 with row indices |
| 7 | Action save with NULL department | 400 with row indices |
| 8 | Edit a legacy report (NULL departments) without picking | 400 |
| 9 | CSV import — happy path 5 rows | 5 rows appended to UI |
| 10 | CSV import — partial errors | Modal shows skipped count + reasons; good rows imported |
| 11 | CSV import — missing `task` column | Whole file rejected |
| 12 | CSV import — ambiguous date `04/05/2026` | Skip with explicit error |
| 13 | CSV import — UTF-8 BOM + non-ASCII department | Imports cleanly |
| 14 | CSV import — file > 200 KB | Rejected |
| 15 | CSV template download | File contains 7 columns + 3 sample rows; opens in Excel |
| 16 | PPTX weekly with department | Column appears, `Social performance` doesn't truncate |
| 17 | PPTX weekly legacy report | Department renders as `—` |
| 18 | PPTX monthly with department | Column appears at fontSize 8 |
| 19 | Carry-over with department + comment | Both arrive in the new week |
| 20 | Monthly editor with department + comment | Both visible and editable |

### 11.2 Verification commands

After changes:
```bash
node -e "require('./reports-db.js')"            # syntax check
node -e "require('./reports-weekly-pptx.js')"
node -e "require('./reports-monthly-pptx.js')"
```

### 11.3 PowerPoint vs LibreOffice

Per CLAUDE.md, PPTX rendering must be verified in **PowerPoint** specifically (LibreOffice can mask issues that PowerPoint reveals). Implementation plan must include opening at least one weekly + one monthly export in PowerPoint.

## 12. Rollout / deployment

### 12.1 Local → production

Per CLAUDE.md deployment process:

```cmd
xcopy "C:\Users\Admin\Documents\SDP-Dashboard\reports-db.js" "C:\Apps\SDP-Dashboard\" /Y
xcopy "C:\Users\Admin\Documents\SDP-Dashboard\server.js" "C:\Apps\SDP-Dashboard\" /Y
xcopy "C:\Users\Admin\Documents\SDP-Dashboard\public\reports.html" "C:\Apps\SDP-Dashboard\public\" /Y
xcopy "C:\Users\Admin\Documents\SDP-Dashboard\reports-weekly-pptx.js" "C:\Apps\SDP-Dashboard\" /Y
xcopy "C:\Users\Admin\Documents\SDP-Dashboard\reports-monthly-pptx.js" "C:\Apps\SDP-Dashboard\" /Y
:: reports-pptx.js — only if verified still wired

pm2 reload endeavour-dashboard
```

### 12.2 First-run behavior on the production server

- On `pm2 reload`, the new `db.exec(SEED_SQL)` runs:
  - `ALTER TABLE action_items ADD COLUMN department TEXT` — succeeds (column doesn't exist)
  - Same for `comment`
  - `CREATE TABLE IF NOT EXISTS action_departments` — creates the table
  - The seed `INSERT ... WHERE NOT EXISTS` — populates the 10 defaults
- All idempotent. Re-running the same migration is safe.

### 12.3 Backup plan

Before deploying:
```cmd
copy "C:\Apps\SDP-Dashboard\data\reports.db" "C:\Apps\SDP-Dashboard\data\reports-backup-2026-04-26.db"
```

If something goes wrong, revert files (xcopy older versions), restore the backup DB, `pm2 reload`. The migration only adds nullable columns and a new table — even if we revert code, the schema additions are no-ops for the old code.

### 12.4 Rollback criteria

Roll back if any of:
- Existing reports fail to load or display blank
- PPTX exports fail or render with overlapping columns
- Departments dropdown empty (seed didn't run)
- 500 errors on PUT /api/reports/:id/actions

## 13. Out of scope (intentionally not in this design)

- Per-department reporting / KPI rollup ("Mining has 12 open actions across all sites"). Once department data exists, this becomes a future report.
- Comment edit history. Comments are last-write-wins like the rest of the action fields.
- Department dependencies (e.g., owner suggestions per department). Owners stay free-text with the existing technician autocomplete.
- Translation of department names. Names are stored as one canonical value; UI shows them as-is.
- CSV **export** of current actions. The "Export template" button is the only export; live actions can already be PPTX-exported.
- Bulk department reassignment. If a department needs renaming retroactively, a future migration handles it.

## 14. Open questions before implementation

1. **`reports-pptx.js` wiring**: confirm whether it's still referenced anywhere. The implementation plan will start by grepping `server.js` + `*.bat` + `package.json` for `reports-pptx`. If unused, the implementation plan will recommend deletion (as CLAUDE.md suggests) rather than maintaining a third copy.
2. **Audit log table name**: spec assumes the existing audit table is named `audit_log`. Implementation plan will verify the actual name from `reports-db.js` (line ~310 area where it's defined) and adjust.
3. **`listDepartments` placement**: this design adds a `listDepartments(opts)` function in `reports-db.js`. The implementation plan should match the file's existing function-export style.
