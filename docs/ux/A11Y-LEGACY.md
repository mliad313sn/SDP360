# Static accessibility floor — all pages (F-UX-10)

**Generated** by `node tools/agent/a11y-legacy.js --write` from `tests/fixtures/a11y-legacy-baseline.json` — do not edit by hand.
`tests/a11y-legacy-ratchet.test.js` fails when a page gets WORSE than this table; a lower count passes and should be
locked in with `--write`. This is a string check (no browser, no assistive technology) and **not** a WCAG
conformance statement — that is the accessibility lead's call after a manual audit.

Columns: missing `<html lang>` · missing viewport · no skip link (own or the shell's) · no `<main>` · form controls without a
label / aria-label / title · images without `alt` · positive `tabindex` · inline `on…=` handlers · no live status region.

| Page | lang | viewport | skip_link | main | unlabelled_control | img_no_alt | positive_tabindex | inline_handler | status_region | total |
|---|---|---|---|---|---|---|---|---|---|---|
| access.html | · | · | · | · | 20 | · | · | · | · | 20 |
| activity-tracker.html | · | · | · | 1 | · | · | · | · | 1 | 2 |
| analytics.html | · | · | · | 1 | 2 | · | · | 17 | 1 | 21 |
| assets-finance.html | · | 1 | 1 | 1 | · | · | · | · | 1 | 4 |
| assets-hygiene.html | · | 1 | 1 | 1 | · | · | · | · | 1 | 4 |
| assets.html | · | · | · | 1 | 6 | · | · | · | 1 | 8 |
| cockpit.html | · | · | · | · | · | · | · | · | · | 0 |
| commitments.html | · | · | · | 1 | 15 | · | · | · | 1 | 17 |
| coverage.html | · | · | · | · | 17 | · | · | · | · | 17 |
| dashboard-composer.html | · | · | · | · | · | · | · | · | · | 0 |
| dashboards.html | · | · | · | · | · | · | · | · | · | 0 |
| data-quality.html | · | · | · | · | · | · | · | · | · | 0 |
| exec-view.html | · | · | 1 | · | · | · | · | · | · | 1 |
| executive-report.html | · | · | · | 1 | 10 | · | · | 58 | 1 | 70 |
| executive.html | · | · | · | 1 | 10 | · | · | 75 | 1 | 87 |
| handoffs.html | · | · | · | · | · | · | · | · | · | 0 |
| help.html | · | · | · | 1 | · | · | · | 2 | 1 | 4 |
| home.html | · | · | · | · | · | · | · | · | · | 0 |
| index.html | · | · | · | 1 | 7 | · | · | 56 | 1 | 65 |
| infra-health.html | · | · | · | 1 | · | · | · | · | 1 | 2 |
| inspection-actions.html | · | · | · | 1 | 6 | · | · | · | 1 | 8 |
| inspection.html | · | · | · | 1 | 35 | · | · | 59 | 1 | 96 |
| inspections.html | · | · | · | 1 | · | · | · | 1 | 1 | 3 |
| integrations.html | · | · | · | · | · | · | · | · | · | 0 |
| it-review.html | · | · | · | 1 | · | · | · | · | 1 | 2 |
| itsm-integrations-plan.html | · | · | 1 | 1 | · | · | · | · | 1 | 3 |
| itsm-roadmap.html | · | · | 1 | 1 | 25 | · | · | · | · | 27 |
| kpi-builder.html | · | · | · | · | 26 | · | · | · | · | 26 |
| login.html | · | · | 1 | 1 | 2 | 2 | · | · | 1 | 7 |
| meeting.html | · | · | · | 1 | 56 | · | · | · | 1 | 58 |
| meetings-actions.html | · | · | · | 1 | 7 | · | · | · | 1 | 9 |
| meetings-compliance.html | · | · | · | 1 | 1 | · | · | · | 1 | 3 |
| meetings-council.html | · | · | · | 1 | 5 | · | · | · | 1 | 7 |
| meetings-import.html | · | · | · | 1 | 3 | · | · | · | 1 | 5 |
| meetings-insights.html | · | · | · | 1 | 3 | · | · | · | 1 | 5 |
| meetings-issues.html | · | · | · | 1 | 10 | · | · | · | 1 | 12 |
| meetings-progress.html | · | · | · | 1 | 3 | · | · | · | 1 | 5 |
| meetings-setup.html | · | · | · | 1 | · | · | · | · | · | 1 |
| meetings-unsigned.html | · | · | · | 1 | 1 | · | · | · | 1 | 3 |
| meetings.html | · | · | · | 1 | 6 | · | · | · | 1 | 8 |
| no-access.html | · | · | 1 | · | · | · | · | · | 1 | 2 |
| notifications.html | · | · | · | · | · | · | · | · | · | 0 |
| obligations.html | · | · | · | · | · | · | · | · | · | 0 |
| policies.html | · | · | · | · | · | · | · | · | · | 0 |
| portfolio.html | · | · | · | · | · | · | · | · | · | 0 |
| project.html | · | · | · | · | · | · | · | · | · | 0 |
| report-studio.html | · | · | · | · | · | · | · | · | · | 0 |
| reports.html | · | · | · | 1 | 255 | · | · | 263 | 1 | 520 |
| rfi.html | · | · | · | · | · | · | · | · | · | 0 |
| site-actions.html | · | · | · | 1 | 4 | · | · | · | 1 | 6 |
| site-awareness.html | · | · | · | 1 | · | · | · | · | 1 | 2 |
| site-report.html | · | · | 1 | · | · | · | · | · | 1 | 2 |
| system-logs.html | · | · | · | 1 | · | · | · | · | 1 | 2 |
| tracker-builder.html | · | · | · | · | · | · | · | · | · | 0 |
| trackers.html | · | · | · | · | · | · | · | · | · | 0 |
| wan.html | · | · | · | 1 | 7 | · | · | · | · | 8 |
| field/index.html | · | · | · | · | · | · | · | · | · | 0 |
| **all (57 pages)** | 0 | 2 | 8 | 34 | 542 | 2 | 0 | 531 | 33 | 1152 |
