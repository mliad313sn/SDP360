# PV stamp auto-save + Issues Log inline edits — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** (Lot 1) Stamping a signature on a PV persists it — and the timestamp becomes server-authoritative. (Lot 2) The Issues Log gains a champion filter and per-row status change.

**Branch:** `feat/pv-stamp-and-issues-inline` (from `main`).

## Verified substrate (checked directly — do not re-derive)
- `public/meeting.html:1303-1310` — both stamp handlers ONLY mutate `state.header.*_signed_at` + the DOM input. **No network call.** Fields: `dept_head_signed_at` / `site_it_signed_at` (note: `site_it_`, NOT `site_it_lead_`).
- `public/meeting.html:1198` — `async function save(opts = {})` POSTs the FULL state (`{id, header, projects, issues, actions}`) to `/api/meetings/save`, sets `state.id` from the response.
- `meetings-db.js:769-771` — the save maps `submitted_at: h.submitted_at || (status submitted/signed ? <server now> : null)` — **the server already computes timestamps here**; mirror that pattern. `:795-796` — `COALESCE(dept_head_signed_at, @dept_head_signed_at)` on UPDATE → **first write wins, a signature is immutable**.
- **`signoff` is a SCORED dimension** ([siteScore.js:28](services/siteScore.js:28), G≥70/A30) read from exactly those two columns ([reviewDashboard.js:221-223](services/reviewDashboard.js:221)) — an unsaved stamp silently lowers the site's programme score. This is the defect being fixed.
- `meetings-db.js:1059-1085 addIssueUpdate(issueId, opts)` — inside ONE transaction: inserts the `md_issue_updates` audit row AND `UPDATE md_issues SET status=…, closed_at=… ` when `status_change` differs (terminal = resolved/cancelled stamps `closed_at`). Also handles `escalate_change`. **Lot 2 needs no new DB work.**
- `server.js:7129-7167` — `POST /api/meetings/issues/:id/update`, body `{ body, status_change, escalate_change }`; requires `editor`+; 403 if the issue's site ≠ the user's scoped site; 403 if the parent meeting is `closed` (for site-scoped users).

---

## Lot 1 — Stamp persists + server-authoritative timestamp

**Files:** Modify `public/meeting.html`, `meetings-db.js`; Test `tests/meetings-signature-stamp.test.js`.

- [ ] **Step 1 — failing test** (`tests/meetings-signature-stamp.test.js`). Copy a meetings-db test harness (throwaway sqlite via `SDP_DATA_DIR`). Assert:
  - Save a meeting whose header carries `dept_head_signed_at: '2020-01-01 00:00:00'` (a bogus client clock) → the STORED value is **NOT** the client string; it is a server-generated timestamp (assert it starts with the current year / parses to within a few minutes of now).
  - Re-save the same meeting with a DIFFERENT signature string → the stored value is **unchanged** (COALESCE first-write-wins / immutability holds).
  - Saving with `dept_head_signed_at: null` (never stamped) → stored stays null.
  - Same three for `site_it_signed_at`.
  Run → FAIL.
- [ ] **Step 2** FAIL. **Step 3 — implement:**
  - `meetings-db.js` (sqlite path ~769-771 **and the pg fork** — find `_saveMeetingPg`/the pg header mapping and apply the identical change): when the incoming header carries a truthy signature value, substitute the SERVER's own timestamp: `dept_head_signed_at: h.dept_head_signed_at ? <server now> : null` (same for `site_it_signed_at`), mirroring the `submitted_at` line. Combined with the existing COALESCE, a re-save never rewrites an existing signature, and a first stamp lands with server time.
  - `public/meeting.html:1303-1310`: each stamp handler becomes async — disable the button, set the field locally (immediate feedback), `await save()`, then **re-read the authoritative value from the server** and repaint both signature inputs (reuse the page's existing load/fetch path for the meeting; if `save()` doesn't return the header, `GET /api/meetings/:id` and repaint). **On failure: revert the local field to its previous value** and show the error banner — the UI must never show a stamp that isn't stored. Re-enable the button in `finally`.
- [ ] **Step 4** PASS + `node --test --test-force-exit tests/meetings-*.test.js` green + `node -e "new Function(require('fs').readFileSync('meetings-db.js','utf8'))"`.
- [ ] **Step 5 — commit:** `fix(meetings): stamping a signature saves the PV + server-authoritative timestamp`.

## Lot 2 — Issues Log: champion filter + inline status change

**Files:** Modify `public/meetings-issues.html`. Browser-verify.

- [ ] **Step 1 — champion filter.** Add an `All champions` `<select id="fltChampion">` next to the existing filters. Populate from the DISTINCT non-empty `champion` values of the loaded issues, sorted (accent-aware `localeCompare`), rebuilt whenever the list reloads. Filtering is client-side like the other filters (match the page's existing filter mechanism — READ how site/department/category/severity/status filter the rows and mirror it exactly). The free-text search already covers champion; this adds exact selection.
- [ ] **Step 2 — inline status change.** Replace the read-only status badge cell with a `<select>` of the statuses (from the page's existing status lookup) defaulting to the row's current status. On change:
  - POST `/api/meetings/issues/<id>/update` with `{ status_change: <new> }` (the endpoint writes the audit row AND the issue status atomically — no comment required; the audit records who/when/transition).
  - On success: update the row's state in the local model, re-render that row's badge/select, and **refresh the KPI tiles** (total / high / open / escalated / overdue change with status).
  - On failure: revert the select to the previous value and surface the server's message (403 for a site outside the user's scope, or a closed parent meeting).
  - **Per-row RBAC:** disable the select when the current user cannot edit that row — `window.__userHasRole('admin')` (or higher) → all rows editable; otherwise only rows whose site matches the user's site. READ how the page/`auth.js` exposes the user's site (`window.__authUser`) and mirror the pattern used elsewhere. A disabled control must look disabled (title explains why). The server remains the enforcement point; this only avoids dead clicks.
- [ ] **Step 3 — VERIFY IN BROWSER (mandatory).** `preview_start`, admin session, **restart (stop+start — `meetings-issues.html` is `_htmlCache`'d)**, open `/meetings-issues.html`:
  - The champion dropdown lists real champions and narrows the table; combines with the other filters.
  - Changing a row's status persists (reload the page → the new status is still there), the KPI tiles update, and the audit is recorded (open the parent PV → the issue's audit thread shows the transition).
  - A failure path surfaces a readable message rather than silently reverting.
  - Zero console errors. Screenshot.
- [ ] **Step 4 — commit:** `feat(meetings): Issues Log champion filter + inline status change (audited)`.

## Lot 3 — Regression + CLAUDE.md + finish
- [ ] Full meetings suite + `await-precedence` green.
- [ ] CLAUDE.md: Current-State entry + pitfall rows — (a) stamping a signature MUST persist (an unsaved stamp silently lowers the scored `signoff` dimension) and the timestamp is server-authoritative (the UI label already promised "server time" while the code used the browser clock); (b) the Issues Log status control MUST go through `POST /api/meetings/issues/:id/update` (audit + status in one tx), never a direct write, and must be per-row RBAC-disabled.
- [ ] Commit, merge to `main`, rebuild the deploy ZIP.

## Done criteria
- [ ] Stamping persists the PV; the stored timestamp is server-generated; a re-save never rewrites it; a failed save reverts the UI.
- [ ] Issues Log filters by champion and changes status inline with the audit trail intact + per-row RBAC; browser-verified.
- [ ] Suites green; CLAUDE.md updated; merged + packaged.
