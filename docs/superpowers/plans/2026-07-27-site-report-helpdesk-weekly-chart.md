# Site Report — Weekly Volume + Resolution-SLA Trend Chart (demande 1) — Plan

**Goal:** The site report's HELPDESK block gains a weekly trend chart — the last 6
ISO weeks (ending at the report's as-of): grouped Inbound/Closed bars + a
resolution-SLA-missed % line — built from the SAME `request_records` data as the
block's own KPIs.

**Architecture:** A new `helpdeskWeekly` deps binder computes 6 ISO-week windows
and calls the existing `getSiteHelpdeskWindow` per week; `siteReportData` carries
`helpdesk_weekly`; `site-report.js` renders a Chart.js combo in the helpdesk
section. No new DB reader. First-reply SLA is NOT shown (request_records carries
resolution SLA only — flagged, not faked).

---

### Task 1: `helpdeskWeekly` binder + ISO-week helper + siteReport wiring

**Files:** `services/siteReportDeps.js` (binder + `_lastIsoWeeks`/`_isoWeek` helpers), `services/siteReport.js` (`_safe` call + include `helpdesk_weekly`); Test `tests/site-report-helpdesk-weekly.test.js`.

- [ ] Test: `_lastIsoWeeks('2026-07-24', 6)` → 6 entries, Monday-aligned, ascending, last week contains 2026-07-24, each `{year,week,from,to,label}` with `label='W## YYYY'` + ISO `from`≤`to`. And the `helpdeskWeekly` binder (via `buildSiteReportDeps` stub) → one row per week `{label, inbound, closed, overdue, missed_pct}`, `missed_pct = round(overdue/inbound*100,1)` or null when inbound=0; null when the site is unresolved. And `siteReportData` carries `helpdesk_weekly` (null when the binder is absent).
- [ ] Run → FAIL.
- [ ] Implement `_isoWeek(date)` (standard ISO 8601 week number, UTC) + `_lastIsoWeeks(asOfIso, n)` (Monday of asOf's week, step back n-1) + the `helpdeskWeekly` binder (resolve→site_id, loop weeks, `getSiteHelpdeskWindow` per week, map). `siteReport.js`: `_safe(() => deps.helpdeskWeekly ? … : null, null, 'helpdeskWeekly')` + add `helpdesk_weekly` to the return.
- [ ] Run → PASS. await-precedence green. Commit.

### Task 2: `site-report.js` weekly chart in the helpdesk section

**Files:** `public/site-report.js`, `public/site-report.html` (a `<canvas>` if a host isn't creatable inline).

- [ ] `renderHelpdesk` (or a sibling) renders a Chart.js combo below the category bar chart: labels = week labels; datasets = Inbound (bars), Closed (bars), Res. SLA missed % (line, `yAxisID:'pct'`, secondary axis 0–100, `spanGaps:false` for null weeks). A short caption states the window + the resolution-SLA-only caveat. Empty/absent `helpdesk_weekly` → the chart host is hidden (no empty canvas), like the category chart's guard. Destroy-on-rerender (unique canvas id).
- [ ] Syntax-check inline JS / `new Function` on `site-report.js` → 0 errors. Commit.

### Task 3: regression + browser + docs + finish

**Files:** `CLAUDE.md`.

- [ ] `node --test` new + `site-report*` suites + `report-template-*` goldens (unaffected — email carries no chart) + `await-precedence` → green.
- [ ] Browser: open a site report with helpdesk data → the weekly combo renders (inbound/closed bars + res-SLA-missed% line, last 6 weeks) below the categories; a site with no helpdesk data → chart hidden; numbers reconcile with the block KPIs.
- [ ] Update `CLAUDE.md`; commit; merge to `main`; build ZIP.
