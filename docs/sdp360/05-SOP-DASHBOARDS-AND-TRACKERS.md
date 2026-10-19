# 05 — SOP: Creating, Validating and Publishing Trackers & Dashboards · UX/UI Standards

## 1. Purpose and applicability
Applies to anyone authoring a tracker, dashboard, KPI definition or RAG policy in SDP360, and to the Committee reviewing them. Templates live in `docs/sdp360/templates/`.

## 2. SOP-T — New site tracker

| Step | Who | What | Evidence |
|---|---|---|---|
| T1 Intake | Requester | file RFI kind `tracker` (`templates/RFI-TEMPLATE.md`): problem, who enters data, how often, what decision it informs | RFI ref |
| T2 Triage | Committee | score (02 §6.1); assign sponsor seat; confirm no existing tracker covers it | `DEC-` id |
| T3 Draft | Author (`tracker-editor`) | Tracker Builder from template (`TRACKER-DEFINITION-TEMPLATE.json`); canonical site codes; each item: KPI type, weight, target, start/end, **source binding where data exists** | draft saved (validates) |
| T4 Dry run | Author + 1 technician | load one month of real or realistic entries; check RAG distribution is informative (not all GREEN / all RED) | screenshot in RFI |
| T5 Review | Committee (Review Board) | checklist 02 §6.3; naming; targets per unit; month-lock rule | minutes |
| T6 Publish | `tracker-admin` | publish → version 1; announce on Help ▸ Recent updates (EN + FR) | version row |
| T7 Operate | Units | enter by the 5th of the following month; bound items auto-fill | entries |
| T8 Re-certify | Author + Committee | every January (yearly trackers) or every 6 months: still useful? targets right? retire or new version | DEC |

**Rules.** One tracker = one purpose; ≤ 6 groups, ≤ 12 items per group; names say what is counted ("Department meetings held", not "Meetings"); never a hand-typed count for something the platform already counts; a changed weight or target mid-year requires a new version and a note on the dashboards consuming it.

## 3. SOP-D — New dashboard

| Step | Who | What |
|---|---|---|
| D1 Intake | Requester | RFI kind `widget`/`dashboard`: audience, decision it supports, device, refresh needed |
| D2 Metrics first | Data Eng | every number needed exists in `metric_registry`; missing → RFI kind `metric` with `KPI-DEFINITION-TEMPLATE.md` (blocks D3) |
| D3 Compose | Author | Dashboard Builder from template (`DASHBOARD-DEFINITION-TEMPLATE.json`); ≤ 12 widgets desktop, ≤ 8 field; KPI tiles top-left, trend below, tables last |
| D4 Device check | Author | preview at 1366 and 360 px; `field` must pass readiness |
| D5 Review | Committee | checklist 02 §6.4; subtitle shows formula + window; "as of" stamp; `NA` states |
| D6 Publish | Chair / `tracker-admin` | version 1; link from module tabs; announce |
| D7 Re-certify | Owner | every 6 months; unused (no views 90 days per `*_viewed` log) → retire |

## 4. UX / UI layout standards

### 4.1 Common (desktop and field)
- **Shell & tokens**: all pages use `_shell.js`, `_tokens.css`, `module-tabs.js`; colours only from `public/brand/brand-tokens.js`; RAG colours are the token set `--rag-green/-amber/-red/-na` (never ad-hoc hex).
- **Hierarchy**: page title → filters bar (site, window) → KPI row → charts → tables → footnotes ("data as of", formulas).
- **Numbers**: integer counts without decimals; percentages one decimal; currency with thousands separator and currency code; never "0" for missing — show "n/a" with reason.
- **RAG**: colour **and** label/icon (colour-blind safe); chip next to the value, not as the background of a whole card.
- **Typography**: body ≥ 14 px desktop, ≥ 16 px field; one display font (brand), tabular numerals in tables.
- **Language**: English UI; FR term in tooltip when a site term is standard (PV, AMDEC).
- **Interaction**: no inline `onclick` in new pages (CSP); every action with a side-effect confirms with the reason prompt pattern of `statusTransfer.ask()`.
- **Accessibility**: contrast ≥ 4.5:1, keyboard reachable, focus visible, charts with a table alternative.

### 4.2 Desktop (1366–1920 px)
- 12-column grid, 16 px gutters, max content width 1600 px.
- KPI tile 3×2 cells: label, value, RAG chip, delta vs previous window, subtitle "formula · window".
- Trend charts span ≥ 6 columns; max 4 series; legend top; y-axis starts at 0 for counts.
- Tables: sticky header, ≤ 25 rows per page, right-aligned numbers, filters above.

### 4.3 Field devices (360–768 px, 2G/3G, gloves, sunlight)
- Single column stacking; touch targets ≥ 44 px; high-contrast theme by default; no images or decorative patterns.
- ≤ 8 widgets; tables ≤ 10 rows; heatmaps forbidden (use `ragGrid`); charts full-width.
- Capture forms: one question per screen for checklists, large toggles, camera button primary, offline indicator and outbox count always visible, "saved locally" confirmation.
- Every screen shows "data as of" and works from cache when offline (G5, G7).

### 4.4 Executive outputs (PPTX / PDF / SharePoint)
- One message per slide; headline sentence states the conclusion; at most one chart + one table per slide; brand template (`public/brand/exec-pptx`).
- Same numbers as the dashboard (engine export) with the same "as of"; footnote with formula keys.

## 5. Validation checklist (copy into the RFI before review)

```
[ ] Definition validates (no errors)                 [ ] Canonical site codes only
[ ] Every number is a registered metric              [ ] RAG policy named and justified
[ ] Formula + window visible on each KPI             [ ] NA behaviour defined
[ ] Device preview attached (desktop / field)        [ ] Owner + re-certification date set
[ ] Dry run reviewed by a field technician           [ ] Help page / announcement drafted (EN+FR)
```

## 6. Publishing & change control
- Draft → review → published → retired; publish creates an immutable version; definitions are never edited in place once published.
- A change to a published KPI formula = new key + deprecation notice ≥ 1 month; dashboards referencing the deprecated key show a badge.
- Production deployment of code follows the CAB change process; publishing a definition does **not** (it is data), but is logged in `system_log` with the `DEC-` id.

## 7. House rules inherited from the platform (binding)

| Rule | Origin |
|---|---|
| Never compare `user.site_id === x`; use `services/userSites.js` (`hasSite`, `inScope`) | 2026-10-05 multi-site editors |
| Upsert by id; never delete + reinsert (race → duplicates) | 2026-09-06 audit F2, 2026-09-11 row-lock fix |
| Recompute scores from summed counters; never average scores | tracker / scoreboard design |
| Never invent a date or a value ("never synced" instead of 0) | asset freshness rule |
| Transfer statuses (`demand`, `helpdesk_ticket`, `cancelled`) require a justification; `helpdesk_ticket` requires a numeric SDP ticket — `public/lib/statusTransfer.js` is the single rule | 2026-10-16 |
| A new terminal status must join `StatusTransfer.DONE` **and** every SQL closed-status list | 2026-10-16 |
| A PV is unique per site × department × month; a Business Incubation session is a distinct record | 2026-09-06 audit F1 |
| Secrets are write-only in APIs, encrypted at rest, never logged; pollers never throw and never overlap | Teams SLA, configSecrets |
| Admin settings routes are super_admin only; IT Review is executive only | 2026-08-16 / 08-31 |
| PG placeholders: a bare `?` in `? IS NULL` is untypable → `CAST(? AS TEXT)` | 2026-10-16 |
| All PPTX pass `fixComboChartAxes()` before download | pptxgenjs 3.12 axis bug |
| Month lock: current month + previous until the 5th; super_admin beyond | `trackerMonthLock.js` |
