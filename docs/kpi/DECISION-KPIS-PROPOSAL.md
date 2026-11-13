# Two decision KPIs — proposal pack for the KPI committee (E08)

> **PROPOSITION, not adopted.** This pack was prepared by an AI agent (plan F, goal F-DATA-11). It proposes two
> CANDIDATES; it selects nothing. Which KPIs become decision KPIs, the decision each one drives, the decider,
> the thresholds and the minimum sample are decisions of the KPI committee (chair) with the Service & Support
> Manager. Every "to be decided" below is left empty on purpose. Fixture figures are fictitious and labelled.

A decision KPI is a figure that a named role reads at a fixed moment to take a named decision. A candidate is
proposed only when the platform can show the SAME figure on every surface, with its window, its source state and
what is not known about it.

## Candidate 1 — `helpdesk.resolution_sla_pct` (per site, calendar month)

| Item | Content |
|---|---|
| Decision it could support (proposal) | escalate to the OLA owner, or review staffing, at a site whose resolution SLA stays under its target |
| Decider role | to be decided (KPI committee) |
| Moment | to be decided (proposal: the monthly service review) |
| Definition | `services/metricRegistry.js:38` (`M('helpdesk.resolution_sla_pct'`) — (closed AND NOT overdue) / closed × 100 |
| Reader | `services/metricRegistry.js:162` (`async 'helpdesk.calendar_month'`) → `reports-db.js:2979` (`sla_res_pct:   slaClosed > 0`) |
| Window | calendar month of ticket creation; a running month is flagged partial (`services/metricRegistry.js:303` (`function dataState(v, rec, win, now)`)) |
| Denominator | closed tickets with an SLA rule, cancelled excluded. Declared in `services/metricRegistry.js:289` (`'helpdesk.resolution_sla_pct': { field: 'sla_res_den'`); `reports-db.getCalendarMonthlyHelpdesk` returns it since G4-CI (null when there is no base, never 0), so the tile shows "n = … closed tickets" and the low-sample guard can fire (evidence F-G4-CI) |
| Scope | the site's helpdesk groups (`sites.zoho_group`); a site without a group is not measured (null, never 0) |
| Freshness | job `zoho.requests`, limit 3 h — `services/publishGate.js:17` (`helpdesk: [['zoho.requests', 3]]`); a stale or never-synced source withdraws the colour on every surface |
| Threshold | none proposed. The colour today comes from the RAG policy `sla-percent`; a per-site target is a committee decision (`kpi_targets`) |
| Coverage today | not measured here: no production or dev data was read. On the labelled fixture of the parity harness, 1 of 2 sites is measured |
| Parity proof | `tests/figure-parity-five-surfaces.test.js` (viewer, dashboard CSV, metric API, external API, report run), `tests/report-figures-parity.test.js` (Group IT deck), `tests/sla-definition-parity.test.js` |
| Red figure → action | `tests/red-action-links.test.js` (E-K03, behind its switch) |
| Open divergences — BLOCKING | DV-01 (which "missed" rule), DV-02 (cancelled tickets), DV-03 (tickets with no SLA rule) in `docs/kpi/FORMULA-REFERENCE.md`. Until the committee settles them, the screen of the helpdesk page and this figure can differ |
| Certification | not certified — KPI Committee approval not recorded |

## Candidate 2 — `inspection.overdue_actions` (per site, as of today)

| Item | Content |
|---|---|
| Decision it could support (proposal) | escalate a site's overdue corrective actions at the monthly Mine IT Council |
| Decider role | to be decided (KPI committee) |
| Moment | to be decided (proposal: the monthly council) |
| Definition | `services/metricRegistry.js:59` (`M('inspection.overdue_actions'`) — open corrective actions whose due date is before today |
| Reader | `services/metricRegistry.js:191` (`async 'inspection.aggregate_site'`) → `inspection-db.js:945` (`overdue_actions: overdue     ? overdue.n     : 0`) |
| Window | current state (no period); two exports taken on different days can differ — the as-of date is printed |
| Denominator | none: a count. No ratio, so no denominator dispute |
| Scope | the site's inspection code; a site without an inspection code is not measured (null, never 0) |
| Freshness | typed into the application: no sync job. Freshness is not tracked; the dashboard CSV writes `NO_SYNC_JOB` |
| Threshold | none proposed, and no RAG policy is attached (the figure has no colour today) |
| Coverage today | not measured here. On the labelled fixture of the parity harness, 1 of 2 sites is measured |
| Parity proof | `tests/figure-parity-five-surfaces.test.js` |
| Red figure → action | no colour today, so E-K03 does not apply until a threshold is decided; the action register is `inspection-actions.html` |
| Open divergences | none listed in `docs/kpi/FORMULA-REFERENCE.md` |
| Limits to know | a count is not comparable between a site with 3 inspections and a site with 30; an action without a due date is never overdue |
| Certification | not certified — KPI Committee approval not recorded |

## Not proposed today, and why

| Figure | Reason |
|---|---|
| WAN availability | the registry reader ignored the window and the sub-site (finding N1, goal F-DATA-02 in another bundle); propose again once that is merged and the Meraki source is collected |
| Programme site score / composite | two models that disagree by design (DV-10), not certified (D-01..D-03), reader not wired on the shipped surfaces (finding N2) |
| Change success rate | three definitions in use (DV-06) |

## What the platform provides for the review

- A draft dashboard `decision-kpis` with the two candidates: `services/dashboardSeeds.js:101` (`const DECISION_KPIS = {`). It is
  created only when `dashboard_decision_kpis_seed` is set to `1`, as an unpublished draft; publishing it follows the
  usual four-eyes rule.
- The parity harness resolves both keys: `tests/figure-parity-five-surfaces.test.js:30` (`const KEYS = [`).
- The definition drawer on the tile (`ui_kpi_definition_drawer`, off by default) shows formula, window, denominator,
  source job and the certification text.

## Left for the committee (nothing below is filled by the agent)

| Question | Candidate 1 | Candidate 2 |
|---|---|---|
| Retained as a decision KPI? | | |
| Decision it drives, in one sentence | | |
| Decider (role) and moment | | |
| Threshold / target and its source | | |
| Minimum sample below which the figure is not compared | | |
| Owner role of the definition | | |
| Minutes reference and date | | |
