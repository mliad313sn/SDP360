# Boss Deck v14 — Missing Slides & Faithful Reproduction — Design

**Date:** 2026-08-06
**Status:** Draft for review
**Author:** IT (with Claude)

## 1. Goal

Reproduce, **faithfully and with live data**, the three slides present in the OPS
manager's final board deck (`Group_IT_Operations_Report_July_2026_v14.pptx`) that
our exec-pptx pipeline does **not** yet generate, plus three enrichments to
existing slides — so that next month's auto-generated deck matches the deck the
board has already seen. Month-over-month **consistency** is the whole point: a
generated deck that diverges from what was presented is worse than none.

## 2. The gap (14 boss slides vs our 14)

Confirmed by slide-by-slide comparison (text + rendered thumbnails):

| Boss slide | Ours | Action |
|---|---|---|
| 1–6, 8–12 | present | none |
| **7 · HELP DESK — Site Impact Analysis** | — | **NEW** |
| **13 · GOVERNANCE — Site Position & Effort Scoreboard** | — | **NEW** |
| **14 · GOVERNANCE — Effort Matrix & Two Moves** | — | **NEW** |
| 2 · Operations Summary — *KPI deliverables table* | partial | **enrich** |
| 6 · Ageing — *Critical Ageing / Top Sites* panel | partial | **enrich** |
| 10 · Major Incidents — *July Register (#IDs)* | partial | **enrich** |

The **charte is already ours**: navy header band + white centred title + left
eyebrow (HELP DESK / ACTIVITY TRACKER / **GOVERNANCE**) + orange date badge, navy
subtitle, white accent cards, navy rounded footer panel, chevron strip + page
box. This is exactly what `render.py`'s `header_band` + footer produce. The 11
shared slides and the charte need **no change**.

## 3. Architecture — `deck` flag + second button (fallback preserved)

Decision (user-approved): **do NOT copy `render.py`.** Add a `deck` selector so
the classic deck stays byte-identical (the golden fingerprint test stays green)
and becomes the guaranteed fallback.

```
executive-report.html
  ├─ [ Export Group IT Report ]         → payload.deck = 'classic'  (unchanged)
  └─ [ Export Group IT Report (v14) ]   → payload.deck = 'v14'      (new button)
        POST /api/reports/exec-pptx  { …payload, deck }
          → services/reportPayload.js build(): when deck==='v14', attach a
            `governance` block + `site_impact` block + enrichment fields; else omit
          → python tools/exec-pptx/render.py  reads K['deck']:
               'classic' (default/missing) → today's 14 slides, UNCHANGED
               'v14'      → same 11 shared + Site Impact + Scoreboard + Effort
                            Matrix inserted at the boss's positions + enrichments
```

**Invariant:** with `deck!=='v14'` (or absent), `build()` emits the exact same
payload and `render.py` runs the exact same code path → `tests/pptx-*golden`
unchanged. The v14 additions are spread-inserted (`...(deck==='v14' ? [x] : [])`)
so a classic payload is byte-identical.

Only ONE endpoint (`/api/reports/exec-pptx`) — the `deck` field routes inside it.
No second endpoint, no second script.

## 4. Fidelity anchor — reproduce the boss's July numbers exactly

The new composers are pinned by tests to reproduce the v14 deck's July figures on
the July dataset:

- Scoreboard: **MGO 100 · SML 75 · SGO 67 · HGO 58 · SMI 58**; group avg **72**;
  Mana GREEN/PASS, others AMBER/FAIL; SML AMBER\* (ground-rules cap).
- Site Impact: Sabodala **44%** of misses / **20%** workload; Ity **99.3%** on
  time / 281 tickets; incident-share fleet avg **10%**.
- Effort Matrix: the `twoMoves()` output per site + roadmap Δ (MGO +2pp, HGO −5pp…).

If a composer disagrees with the deck, the composer is wrong.

## 5. Slide 7 — Site Impact Analysis

**Layout** (eyebrow HELP DESK): subtitle "Which Sites Move the Needle — Resolution
& Incidents, `<Month Year>`". Four accent cards (red/orange/green/navy) →
2 charts → editorial context panel → narrative footer.

**Auto (data)** — new pure `services/deckSiteImpact.js` `buildSiteImpact(perSite,
{fleet})`:
- Per site: `workload_pct` (site tickets / fleet tickets), `miss_pct` (site missed
  resolution-SLA / fleet missed), `ontime_pct` (site on-time / site closed),
  `incident_pct` (site incidents / site tickets). Source: per-site
  `getSiteHelpdeskWindow`-style reader over the report month, by `tech_group`.
- Card auto-selection: **Most stretched** = max `miss_pct`; **Best/PROOF** = max
  `ontime_pct` at ≥ median volume; **THE PRIZE** = fleet on-time Δ vs prev month
  (roadmap-style). "Under dual pressure" = highest `incident_pct`.
- Chart 1 "Missed deadlines vs workload": grouped h-bars (miss% red, workload%
  navy), sorted by miss% desc. Chart 2 "Incidents as share of site tickets":
  v-bars, orange above fleet avg / navy below, fleet-avg dashed line.

**Editorial** (`exec_report_editorial` scope `site_impact`, deterministic defaults
+ editable): the 4 card captions, "July Operating Context" bullets, footer prose.
Defaults auto-derived ("44% of misses — busiest team") but overwritable each month.

## 6. Slide 13 — Site Position & Effort Scoreboard

**Layout** (eyebrow GOVERNANCE): subtitle "League Table — `<window>` · scoring v2".
Left: 11-col table (Rank · Site · Score · Meetings · Capture·Closed · Overdue ·
Inspections · Find·Fix · Sign-off · Incubation · Ground rules · Overall). Right:
"Composite Score / 100" h-bar chart (RAG-coloured, group-avg + GREEN-line
markers). Note line + navy footer bullets.

**Auto** — new pure `services/deckGovernance.js` `buildScoreboard(D, {asOf, window})`
composing per site from the existing readers (meetings-db + inspection-db +
`siteComposite.eMetrics`):
- **Meetings** = PV count in window. **Capture·Closed** = issues-per-meeting ·
  %resolved. **Overdue** = open issues past target. **Inspections** = inspection
  count. **Find·Fix** = findings-per-inspection · % high/critical closed.
  **Sign-off** = `eMetrics.e2`-style %. **Incubation** = incubation count.
  **Ground rules** = PASS iff (≥3 meetings/mo AND ≥1 incubation AND ≥1
  inspection), else FAIL. **Score** = points/12×100. **Overall** RAG =
  GREEN ≥70 / AMBER 45–69 / RED <45, **capped at AMBER\*** when ground rules FAIL.
- Each column's exact formula is pinned to the deck's July values in
  `tests/deck-governance-fidelity.test.js`.

**Editorial**: footer bullets auto-derived (top scorer, find-fix leader, depth
concern) + editable; the scoring-note line is a fixed string from the deck.

## 7. Slide 14 — Effort Matrix & Two Moves

**Layout** (eyebrow GOVERNANCE): three columns. Left "Effort Matrix" bubble
scatter (X = resolution rate %, Y = overdue count, 4 labelled quadrants, bubble
size = meetings, dashed outline if ground rules missed, label = roadmap Δpp).
Middle "Gap to Green" horizontal **stacked** bars (points per dimension, max 12,
GREEN-line at 8.4). Right "Your Two Moves" — 5 site cards (score badge + ①② moves).

**Auto** — `deckGovernance.js` `buildEffortMatrix(D, tracker, {asOf})`:
- Bubbles from `composite()` (`odRate`→resolution proxy, `overdue`, meetings
  count, ground-rules flag) + tracker roadmap Δ per site.
- Gap-to-green = the per-dimension points already computed for the scoreboard.
- Two moves = **`siteComposite.twoMoves(site, D, comp)`** verbatim (our function).

**Editorial**: footer bullets (how-to-read + commentary) + editable; ground-rules
line auto (incubations held per site).

## 8. Enrichments (existing slides)

- **S2 KPI table**: 4 strategic deliverables (Owner/End/RAG/Comments) — new
  editable block on the Operations Summary editor + render in slide 2 (v14 only,
  so classic slide 2 is unchanged).
- **S6 Critical Ageing / Top Sites**: per-site open-volume with <30/30-60/>60d
  split — auto from the ageing reader; a right-hand panel in v14.
- **S9 July Register**: the month's major incidents (#ID · site · cause · window ·
  status) — auto from `getActiveMajorIncidentsForSite`/MI history; a panel in v14.

## 9. Data flow & new files

Governance + site-impact data is **not** in the browser's exec-report context, so
it is gathered **server-side** in `reportPayload.js build()` (like
`_majorIncidents`): load `reviewData.loadReviewData(asOf)` → `D`, call the new
`deckGovernance` + `deckSiteImpact` composers, attach blocks only when
`deck==='v14'`.

| File | Role |
|---|---|
| `services/deckGovernance.js` | PURE `buildScoreboard` + `buildEffortMatrix` (reuse `siteComposite`) |
| `services/deckSiteImpact.js` | PURE `buildSiteImpact` (per-site helpdesk) |
| `services/reportPayload.js` | attach `governance`/`site_impact`/enrichment blocks when `deck==='v14'` |
| `tools/exec-pptx/render.py` | `deck` flag; new `_draw_*` + slide blocks 7/13/14 + enrich |
| `public/executive-report.html` | second "Export (v14)" button → `deck:'v14'`; S2 KPI editor |
| `reports-db.js` (editorial) | new `exec_report_editorial` scopes `site_impact`,`governance` |

## 10. Testing

- `tests/deck-governance-fidelity.test.js` — reproduce the deck's July scoreboard
  numbers exactly (per-column + score + RAG + ground-rules cap).
- `tests/deck-site-impact.test.js` — miss%/workload%/incident% + card selection.
- `tests/deck-v14-render-smoke` — `render.py deck=v14` on a fixture renders the
  full slide set (17) without error; `deck=classic` renders 14.
- `tests/pptx-*golden` — **must stay green** (classic path untouched).
- `tests/await-precedence` — any new dual-backend readers covered.
- LibreOffice visual QA on slides 7/13/14 vs the boss's thumbnails (faithfulness).

## 11. Deploy

`server.js` + `reportPayload.js` (server code) + `executive-report.html`
(`_htmlCache`) → ZIP → `pm2 stop`→wait→`start` (NOT reload). `render.py` copy-only.
Ctrl+F5. Classic button unaffected → zero-risk rollback (just use the old button).

## 12. Scope boundaries / deferred

- The **human narrative** (sick-leave context, specific incident causes, the exact
  card wording) is **editorial**, not invented — deterministic defaults + editable
  fields (decision: "auto-généré déterministe + champs pour le reste").
- Slide 13/14 use the **Apr–Jul programme window** (as the boss's deck does), not
  the report month — stated on-slide.
- No new schema beyond `exec_report_editorial` scopes (already a k/v store).
- Build order: **Governance 13+14 first** (highest fidelity, model exists), then
  Site Impact 7, then the 3 enrichments.
