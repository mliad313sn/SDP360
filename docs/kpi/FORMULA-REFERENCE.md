# Formula reference sheet — what the code computes today (for the KPI committee)

> **Status: descriptive, not normative.** This sheet records the formulas **as implemented** on each layer, with the
> code location and the test that pins each pair of layers together. **No formula, threshold or window here is
> approved**; every divergence (§6) is listed for the committee and **none is resolved** by this document.
>
> Citation format: `file:line` (`anchor`) — `tests/kpi-docs-links.test.js` fails when the file is missing, the line
> no longer exists or no longer contains the anchor (line numbers drift: fix the citation, not the code). Every test
> file named here must exist.
>
> Layers: **Screen** (browser computes from raw ticket rows), **API** (server readers behind `/api/metrics`, site
> report, exec summary), **PPTX** (Group IT deck payload), **E-mail** (coordinator monthly site report).
> Versioned contracts live in `kpi_policies` (db 065); this sheet does not show adopted versions.

## 1. Resolution SLA %
| Layer | Numerator | Denominator | Exclusions | Window | Code | Pinned by |
|---|---|---|---|---|---|---|
| Screen (Helpdesk tile, ranking, trend) | closed − missed | closed tickets (`isClosed`) **incl. cancelled** | cancelled never "missed"; optional `excludeCancelled` (adopted policy only) | the page's selected period | `public/lib/dashboard-shared.js:227` (`function resolutionSla(rows, opts)`) | `tests/site-fold-sla-definition.test.js`, `tests/dashboard-shared-sla-rates.test.js` |
| Screen — "missed" rule | due vs resolved, flag fallback (`due_vs_resolved`) | | | | `public/lib/dashboard-shared.js:184` (`function isResOverdue(r)`), default `public/lib/dashboard-shared.js:213` (`var HD_SLA_DEFINITION = 'due_vs_resolved'`) | `tests/sla-definition-parity.test.js` |
| API (calendar-month reader, registry `helpdesk.resolution_sla_pct`) | closed AND `overdue_status = 0` AND not cancelled | closed AND `overdue_status IS NOT NULL` AND **not cancelled** | cancelled and no-SLA (NULL flag) tickets out | calendar month, `created_time` (UTC, or site-local when `site_local_calendar='1'`) | `reports-db.js:2973` (`sla_res_pct:   slaClosed > 0`), exclusions `reports-db.js:2956` (`const NOT_CANCELLED`), registry `services/metricRegistry.js:38` (`M('helpdesk.resolution_sla_pct'`) | `tests/uat-itsm-figures.test.js` |
| API — server "missed" rule (other readers) | | | | | `services/slaDefinition.js:40` (`function resOverdueRow(row, mode)`), default `services/slaDefinition.js:20` (`const DEFAULT_MODE = 'flag'`) | `tests/sla-definition-parity.test.js` |
| A7 — incl. open past target (screen + API + Exec View, beside the closed-only rate, never replacing it unless `sla_headline_definition='incl_open'`) | closed − missed | closed base **+ open & breached** (open, not cancelled, with an SLA rule, flag late OR not on hold and due strictly before as-of = period end or now) | on hold = SLA paused (flag only); due exactly at as-of not breached | same as the row's layer | `public/lib/slaDual.js:64` (`function openResBreached(t, asOfMs)`), SQL `services/slaDefinition.js:72` (`const OPEN_RES_BREACHED_SQL`), reader `reports-db.js:2984` (`sla_res_pct_incl_open: dRes`), Exec View history `reports-db.js:3093` (`'% of SLA Violated (incl. open past target)':`) | `tests/sla-dual.test.js`, `tests/sla-dual-pg.test.js`, `tests/sla-tile-definitions.test.js` |
| PPTX (Group IT deck) | = API calendar reader `sla_res_pct` | | | calendar month | `services/reportPayload.js:128` (`out.sla_compliance = _nullable(cur.sla_res_pct)`) | `tests/report-figures-parity.test.js` |
| E-mail (coordinator monthly) | **no percentage** — a count of created tickets with `overdue_status === 1` (open or closed) | — | — | calendar month | `reports-db.js:1228` (`function _computeSiteHelpdesk(rows)`) | — (no parity test with the % layers) |

## 2. First-reply SLA %
| Layer | Numerator | Denominator | Exclusions | Window | Code | Pinned by |
|---|---|---|---|---|---|---|
| Screen (trend) | responded − flagged late | responded tickets (non-empty `Responded Time`) | none | selected period | `public/lib/dashboard-shared.js:271` (`fr_violated_pct:  pct(frViol, responded)`) | `tests/dashboard-shared-sla-rates.test.js` |
| Screen (technician table) | 1 − late/responded | responded per technician | none | selected period | `public/index.html:1456` (`frSla: e.respondedN > 0`) | — |
| API (calendar reader, registry `helpdesk.first_reply_sla_pct`) | responded AND flag not true/1/yes | responded | none (cancelled kept) | calendar month | `reports-db.js:2974` (`sla_reply_pct: rplyTotal > 0`), `services/metricRegistry.js:39` (`M('helpdesk.first_reply_sla_pct'`) | `tests/uat-itsm-figures.test.js` |
| A7 — incl. open past target | responded − late | responded **+ open, unanswered tickets flagged late** (no first-response due time is synced → flag only) | cancelled never | same | `public/lib/slaDual.js:72` (`function openFrBreached(t)`), SQL `services/slaDefinition.js:74` (`const OPEN_FR_BREACHED_SQL`) | `tests/sla-dual.test.js`, `tests/sla-dual-pg.test.js` |
| PPTX | = API `sla_reply_pct` | | | calendar month | `services/reportPayload.js:129` (`out.frt_sla        = _nullable(cur.sla_reply_pct)`) | `tests/report-figures-parity.test.js` |
| E-mail | not reported | — | — | — | — | — |

## 3. Change success rate
| Layer | Numerator | Denominator | Exclusions | Window | Code | Pinned by |
|---|---|---|---|---|---|---|
| Screen (deck builder, executive report) | success + success with issues (UDF-aware classifier) | successful + partial + failed + backed out + **cancelled** | pending, rework, deferred | report month | `public/executive-report.html:5249` (`function _tallyChanges(rows)`), classifier `public/executive-report.html:5220` (`function _changeOutcome(r)`) | `tests/report-figures-parity.test.js` |
| API — site report / IT Review ("deck" definition, registry `changes.success_pct_deck`) | same classifier, ported | same, **cancelled included** | same | site report: month; IT Review: rolling 90 days | `reports-db.js:1438` (`success_pct: executed ?`), classifier `reports-db.js:1376` (`function _changeOutcome(row)`), registry `services/metricRegistry.js:89` (`changes.success_pct_deck`) | `tests/review-fidelity.test.js` |
| API — ITSM definition (registry `changes.success_pct_itsm`) | same | successful + partial + failed + backed out (**cancelled excluded**) | cancelled, pending | same | `reports-db.js:1442` (`success_pct_itsm: (successful`), `services/metricRegistry.js:90` (`changes.success_pct_itsm`) | — |
| API — status-based (exec summary, roadmap evidence) | `status = Completed` | completed + failed + backed out (status-based, no UDF) | cancelled, rejected | bounded month | `reports-db.js:4936` (`const changeSuccessRate = executed > 0`) | `tests/kpi-change-success.test.js` |
| E-mail (coordinator monthly) | = API deck `success_pct` (`?? null`) | | | report month | `services/siteReport.js:107` (`success_pct: c.success_pct ?? null`), render `services/reportTemplates/coordinator.js:346` (`const pct = c.success_pct === null`) | — |

## 4. Site score (`sbDims`, author's programme model)
| Item | Value as coded | Code | Pinned by |
|---|---|---|---|
| Dimensions | reviews · resolution % · overdue (inverted) · inspections · critical+major findings (inverted) · sign-off %; 0/1/2 points each; score = points ÷ 12 | `services/siteScore.js:22` (`const PT_THRESHOLDS = [`) | `tests/score-fidelity.test.js` |
| RAG | registry policy `site-score` (70 / 45) | `services/siteScore.js:34` (`function rag2(score)`) | `tests/score-fidelity.test.js` |
| Applicability | no data on the window → "non applicable" (no verdict) | `services/siteScore.js:76` (`function hasData(inputs)`) | `tests/score-fidelity.test.js` |
| Window — e-mail / site report | rolling 3 months ending at as-of | `services/scoreWindow.js:12` (`function rollingWindow(asOf, months = 3)`), call `services/siteReportDeps.js:236` (`return computeSiteScore(`) | `tests/score-fidelity.test.js` |
| Window — IT Review page | programme start (2026-04-01, hardcoded in the source model) → as-of | `services/reviewDashboard.js:210` (`const W0 = '2026-04-01'`) | `tests/review-fidelity.test.js` |

## 5. Site composite (author's second model)
| Item | Value as coded | Code | Pinned by |
|---|---|---|---|
| Formula | delivery 40 % + governance 35 % + engagement 25 % − penalties, floored at 0, **no ceiling** | `services/siteComposite.js:103` (`const score = Math.max(0, Math.round(del`) | `tests/composite-fidelity.test.js` |
| Engagement metrics (`cov` = departments ÷ 12, unclamped) | | `services/siteComposite.js:54` (`function eMetrics(site, D, asOf)`) | `tests/composite-fidelity.test.js` |
| Fleet dependency | MTTR index uses the **fleet** median — not per-site isolated | `services/siteComposite.js:83` (`function composite(site, D, asOf)`) | `tests/composite-fidelity.test.js` |
| RAG | registry policy `site-composite` (75 / 55) | `services/siteComposite.js:137` (`function rag(score)`) | `tests/composite-fidelity.test.js` |

## 6. Divergence register (for decision — none resolved here)
| Id | Divergence | Layers | Decision owner |
|---|---|---|---|
| DV-01 | Resolution SLA "missed" rule: `due_vs_resolved` (screen default) vs `flag` (server default, `helpdesk_sla_definition`). They disagree on stale flags. | Screen vs API/PPTX | KPI committee (P8) |
| DV-02 | Cancelled closed tickets: **in** the screen denominator, **out** of the calendar reader's denominator. | Screen vs API/PPTX | KPI committee |
| DV-03 | Tickets with no SLA rule (NULL `overdue_status`): counted in the screen denominator, excluded by the calendar reader. | Screen vs API/PPTX | KPI committee |
| DV-04 | The coordinator e-mail carries an overdue **count** over all created tickets (open included), not the SLA %; no parity test. | E-mail vs others | KPI committee |
| DV-05 | First-reply SLA: no exclusion on any layer, but the screen trend is on the selected period and the API on the calendar month (`created_time` bucket). | Screen vs API | KPI committee |
| DV-06 | Change success — three definitions in use: deck (cancelled in), ITSM (cancelled out), status-based (exec summary). Decision D-01. | Screen/API/E-mail vs exec summary | KPI committee (D-01) |
| DV-07 | Change success window: month on the site report, rolling 90 days on the IT Review panel. | API vs IT Review | KPI committee |
| DV-08 | Corrected by F-DATA-06 (plan F): the server baseline keeps a null rate or duration null (`services/reportPayload.js:88` (`function _safeNum(v, def = 0)`) is now used for counts only) and the deck prints an em dash without a target tick. `fcr_rate` stays under `exec_payload_zero_policy` (A-17). | PPTX vs others | Release manager (deployment window: reporting freeze) |
| DV-09 | Site score window: rolling 3 months (e-mail) vs programme-to-date (IT Review page). | E-mail vs IT Review | model author + KPI committee |
| DV-10 | Two site-scoring models (`sbDims` 70/45 and composite 75/55) give different RAG on the same site, by design of the source model. | IT Review | model author |
| DV-11 | Composite `cov` is not clamped (> 12 departments pushes the score above 100). | IT Review | model author |

## 7. Left for a person
Every row of §6; the adoption of a version per metric in `/kpi-builder.html`; whether to enforce
(`kpi_policy_enforced`).
