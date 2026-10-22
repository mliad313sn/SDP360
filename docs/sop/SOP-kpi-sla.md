# SOP — KPI denominators and incident SLA targets

Moved verbatim from `CLAUDE.md` on 2026-10-22 (SDP-DASH-2.0 step 5, lot 5.5). `CLAUDE.md` is now an index; edit THIS file.

---

### KPI denominator doctrine — ITSM standard (added 2026-06-02)

**For any percentage KPI that gates a verdict** (SLA compliance, Reopen Rate, FRT compliance, Change Success Rate), the dashboard uses the **ITSM industry-standard denominator** rather than the AP-canonical "/total" denominator. See `FORMULA_RECONCILIATION.md` §6 for the four documented divergences (D1–D4) and the rationale.

When adding or modifying a percentage KPI, default to:

```
Reopen Rate            = reopened-of-closed / closed         (NOT /total)
Resolution SLA %       = (closed AND not overdue) / closed   (NOT /total)
First Response SLA %   = (responded AND not violated) / responded  (NOT /total)
Change Success Rate    = successful / executed               (executed = success + failed + backed_out;
                                                              cancelled + rejected EXCLUDED)
```

The verdict-only denominator pattern is implemented uniformly across:
- `reports-db.js` aggregate helpers (getCalendarMonthlyHelpdesk, getMonthlyHelpdeskHistory, getSlaTrendDB, getSlaByCategoryDB, getRequestMetrics, _aggregateHelpdesk6MoFromRaw)
- `public/executive.html` + `public/executive-report.html` (KPI tiles + AI snapshot + PPTX slide builder)
- `public/index.html` (Res SLA + 1st Reply SLA tiles + technician table)
- `executive-new-report.js` (server-side PPTX generator)
- `server.js /api/reports/helpdesk-charts` route

If you introduce a new surface that displays one of these KPIs, follow the existing helper or replicate the closed/responded-only denominator pattern. **Do not regress to /total.**

---


## Incident SLA Configuration (Zoho Desk)

### Priority → P-Label mapping (used in dashboard & PPTX)

| Zoho Priority | P-Label | SLA Name in Zoho |
|---------------|---------|------------------|
| Critical | **P1** | Critical SLA for Incident |
| High | **P2** | High SLA for Incidents |
| Medium / Normal | **P3** | Medium SLA for Incidents |
| Low | **P4** | Low SLA for Incidents |

> Code reference: `extract_incidents_ytd.js` line 126 — `'critical' → 'P1'`, `'high' → 'P2'`

**Important** (2026-06-04): `request_records` does NOT have an explicit
priority column for major incidents. The priority lives inside
`udf_json` under varying keys (`Priority` / `priority` / `Severity`).
**Two server functions resolve this** — keep both in sync:

| Function | File | Used by |
|---|---|---|
| `_majorIncidents()` | `services/reportPayload.js` | render.py PPTX (Group IT Report) |
| `getMajorIncidentsHistory()` | `reports-db.js` | `/api/data/major-incidents` (browser tile + register) |

Both follow the same fallback chain when `udf_json` is missing the
field: `Priority → priority → Severity → severity → UDF:Priority →
UDF:Severity → (impact === 'Enterprise' ? 'Critical' : 'High')`.
Without the fallback in `getMajorIncidentsHistory()`, the browser's
P1/P2 tiles silently returned **0 even when downtime > 0** — caught
2026-06-04 on May 2026 review (0 P1 + 0 P2 + 123h downtime).
`getMajorIncidentsHistory()` now also computes a normalised `P-Label`
field (`P1`/`P2`/`P3`/`P4`) so the browser doesn't have to redo the
string-matching dance.

---

### SLA Targets by Site

All sites share identical **Resolution Time** and **P4** targets.  
Sites differ only in **Response Time** for P1–P3.

#### Standard Profile — MANA, LONDON, EXPLORATION, HOUNDE, ITY, KALANA, LAFIGUE, **TANDA**

| Priority | Response Time | Resolution Time |
|----------|--------------|-----------------|
| P1 / Critical | **30 min** | 2 hours |
| P2 / High | **1 hour** | 4 hours |
| P3 / Medium | **4 hours** | 1 day |
| P4 / Low | 1 day | 5 days |

#### Enhanced Profile — Dakar, Ouaga, Sabodala

| Priority | Response Time | Resolution Time |
|----------|--------------|-----------------|
| P1 / Critical | **15 min** | 2 hours |
| P2 / High | **30 min** | 4 hours |
| P3 / Medium | **2 hours** | 1 day |
| P4 / Low | 1 day | 5 days |

#### Abidjan (Intermediate Profile)

| Priority | Response Time | Resolution Time |
|----------|--------------|-----------------|
| P1 / Critical | **30 min** | 2 hours |
| P2 / High | **1 hour** | 4 hours |
| P3 / Medium | **2 hours** | 1 day |
| P4 / Low | 1 day | 5 days |

---

### Full Site × Priority Matrix

| Site | P1 Response | P2 Response | P3 Response | P4 Response | P1 Res. | P2 Res. | P3 Res. | P4 Res. |
|------|-------------|-------------|-------------|-------------|---------|---------|---------|---------|
| MANA | 30 min | 1 h | 4 h | 1 day | 2 h | 4 h | 1 day | 5 days |
| LONDON | 30 min | 1 h | 4 h | 1 day | 2 h | 4 h | 1 day | 5 days |
| EXPLORATION | 30 min | 1 h | 4 h | 1 day | 2 h | 4 h | 1 day | 5 days |
| HOUNDE | 30 min | 1 h | 4 h | 1 day | 2 h | 4 h | 1 day | 5 days |
| ITY | 30 min | 1 h | 4 h | 1 day | 2 h | 4 h | 1 day | 5 days |
| KALANA | 30 min | 1 h | 4 h | 1 day | 2 h | 4 h | 1 day | 5 days |
| LAFIGUE | 30 min | 1 h | 4 h | 1 day | 2 h | 4 h | 1 day | 5 days |
| TANDA | 30 min | 1 h | 4 h | 1 day | 2 h | 4 h | 1 day | 5 days |
| ABIDJAN | 30 min | 1 h | **2 h** | 1 day | 2 h | 4 h | 1 day | 5 days |
| Dakar | **15 min** | **30 min** | **2 h** | 1 day | 2 h | 4 h | 1 day | 5 days |
| Ouaga | **15 min** | **30 min** | **2 h** | 1 day | 2 h | 4 h | 1 day | 5 days |
| Sabodala | **15 min** | **30 min** | **2 h** | 1 day | 2 h | 4 h | 1 day | 5 days |

> **Bold** = tighter than Standard Profile. Resolution times are identical across all sites.

---
