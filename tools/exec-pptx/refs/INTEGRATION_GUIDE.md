# IT Operations Monthly Report — Integration Handoff Guide

> **Purpose.** Hand off everything needed to integrate the "Group IT Operations Monthly Report" (currently produced by an assistant from CSVs + browser scraping) as a first-class **button-click feature** inside the existing dashboard at `https://itops-dashboard.edv-ops.com/` (Node.js + Express, Python sub-processes available).
>
> The principle the integration must honour: **the dashboard already holds all the source data with the correct filters.** No more CSV uploads, no more browser scraping. The report becomes a server-side render that pulls from the same internal APIs the dashboard already exposes.

---

## 1. Context

**The deliverable.** A branded 11-slide `.pptx` file named `Group_IT_Operations_Report_<Month>_<Year>.pptx` (16:9 widescreen, Endeavour Mining brand). Audience: CIO + CFO + Mohamed Diagne (IT Operations Mines & Exploration).

**Currently produced by an assistant.** A human (Aziz, SUPER_ADMIN) uploads four SDP / Zoho CSV exports + the assistant scrapes the activity-tracker dashboard via a Chrome extension. Output is hand-delivered to `\Monthly-Reports\<Month>\`.

**Target after integration.** A `POST /api/reports/generate?month=YYYY-MM` route in the dashboard's Node server that:
1. Calls existing internal APIs to assemble a single `report_payload` JSON.
2. Hands that payload to a Python sub-process which renders the PPTX using `python-pptx` + `matplotlib`, starting from the **bundled template** (`Group IT-OPS_template.pptx`, see §11.6 / Annex A).
3. Calls the **Claude API** (Anthropic SDK) for executive footers and Voice-of-Customer theme clustering.
4. Returns the PPTX (or stores it and returns a signed URL).
5. Optionally renders a PDF preview alongside.

This guide gives the receiving session everything it needs: data shapes, slide specs, brand tokens, chart specs, voice/tone, known production pitfalls, an architecture sketch, and the **bundled handoff package** (in `_handoff/` next to this file) with the exact template, brand assets, and reference decks.

**Deployment.** The user has confirmed the dashboard runs Node + Express directly (no Docker). The Anthropic API key is already provisioned — load via `ANTHROPIC_API_KEY` env var.

---

## 2. Current Manual Workflow (what gets eliminated)

| Today | Replacement once integrated |
|---|---|
| User uploads `Request-all-time.csv` (~56 MB SDP export) | Server reads the same data from the dashboard's internal ticket store (whatever the dashboard already queries from Zoho SDP). |
| User uploads `Request-Major-Incidents.csv` | Same store, filter `Request Type = "Major Incident"` AND (`created in month` OR `resolved in month`). |
| User uploads `all-changes.csv` | Server reads the dashboard's existing changes store. |
| User uploads `Zoho_Survey_Full_content_GPT.csv` (175 May rows) | Server hits the Analytics Plus saved query OR the dashboard's `/api/survey/...` endpoint. |
| Assistant scrapes `Chart.instances` from `activity-tracker.html` via Chrome | Server reads the same JSON that the activity-tracker page reads on load (presumably `/api/activity-tracker?month=YYYY-MM` — already implemented since the dashboard renders the same numbers client-side). |
| Assistant hand-crafts commentary | Server passes the assembled payload to an LLM (Claude / GPT) with the voice prompt in §9 below, gets back the per-slide commentary strings, plugs them into the PPTX. |
| Assistant manually re-saves the deck under `\Monthly-Reports\<Month>\` | Server writes to a managed `reports/` directory and emits a download URL. |

The dashboard already has all the data — we just need to expose it via internal HTTP endpoints (or a Node service layer) and pass it to the Python renderer.

---

## 3. Dashboard → Report Data Mapping

The receiving session should enumerate the dashboard's existing network calls (DevTools → Network → XHR) to confirm exact endpoint paths. The shapes below are what the renderer **needs**.

### 3.1 Helpdesk KPI block (drives slides 3, 4, 5, 6)

```ts
// GET /api/helpdesk/kpis?month=2026-05&group=ops
{
  month: "2026-05",
  inbound: 1327,
  closed: 1238,
  closure_rate_pct: 93.3,
  res_sla_pct: 93.0,         // = 100 - dashboard's "Resolution SLA Violated %"
  frt_sla_pct: 86.4,         // = 100 - dashboard's "1st Reply Violated %" tile
  open_backlog: 188,         // dashboard's current "AGEING REPORT" count
  time_to_assign_h: 19,
  first_reply_h: 15,
  res_time_d: 1,
  closing_time_d: 2,
  fcr_pct: 100.0,            // see §5 — formula already implemented in dashboard
  // MoM deltas
  inbound_delta_pct: -9,
  closed_delta_pct: -13,
  closure_delta_pp: 1.0,
  res_sla_delta_pp: 6.3,
  frt_sla_delta_pp: 3.2,
  open_backlog_delta_pct: -21,
  res_time_delta_d: -2,
}
```

### 3.2 12-month volume + SLA trend (slide 4)

```ts
// GET /api/helpdesk/trend?endMonth=2026-05&months=12&group=ops
{
  months: ["Jun 25","Jul 25","Aug 25","Sept 25","Oct 25","Nov 25","Dec 25","Jan 26","Feb 26","Mar 26","Apr 26","May 26"],
  inbound: [945, 996, 918, 1140, 1277, 1471, 1408, 1629, 1398, 1602, 1458, 1327],
  closed:  [944, 995, 918, 1137, 1277, 1468, 1408, 1628, 1397, 1596, 1428, 1238],
  res_sla_compliance_pct: [68.1, 61.4, 63.3, 78.4, 80.7, 72.1, 83.9, 87.8, 87.2, 86.6, 83.6, 91.6],
  frt_sla_compliance_pct: [49.3, 45.9, 50.1, 72.2, 75.6, 65.4, 74.8, 72.6, 78.0, 72.8, 70.2, 79.1],
}
```

These exact arrays are what the dashboard's `cTrend` Chart.js instance receives — query the same backend that feeds the chart.

### 3.3 Category + Channel distribution (slide 5)

```ts
// GET /api/helpdesk/distribution?month=2026-05&group=ops
{
  category_may: {
    "Software and Applications": 310,
    "User Accounts and Access Permissions": 208,
    "IT Infrastructure": 203,
    "Email": 130,
    "Network & Internet Access": 100,
    "IT Hardware and Communication Devices": 97,
    "Hardware and Accessories": 95,
    "Printing Services": 69,
    // ...
  },
  category_apr: { /* same shape, prior month for the comparison bars */ },
  channel_may: { "E-Mail": 879, "Web Form": 429, "Live Chat": 9, "Phone Call": 3, "MS Teams": 2 },
  channel_trend_pct_email:    [88, 90, 88, 87, 87, 85, 84, 84, 82, 80, 65, 70.6, 66.2],  // 13 months, last = current
  channel_trend_pct_web_form: [11,  9, 11, 12, 12, 14, 15, 16, 18, 20, 30, 28.3, 32.3],
}
```

### 3.4 Ageing backlog (slide 6)

```ts
// GET /api/helpdesk/ageing?asOf=now&group=ops
{
  total_open: 188,
  by_bucket: { "0-7d": 76, "8-14d": 29, "15-30d": 32, "31-60d": 29, "60+d": 22 },
  by_group: {
    "Sabodala IT Agents":     { "0-30d": 43, "31-60d": 16, ">60d": 5,  total: 64 },
    "Abidjan IT Agents":      { "0-30d": 23, "31-60d": 9,  ">60d": 12, total: 44 },
    "Lafigue IT Agents":      { "0-30d": 23, "31-60d": 2,  ">60d": 0,  total: 25 },
    "Mana IT Agent":          { "0-30d": 15, "31-60d": 0,  ">60d": 0,  total: 15 },
    "Hounde IT Agents":       { "0-30d": 13, "31-60d": 0,  ">60d": 0,  total: 13 },
    "ITY IT Agents":          { "0-30d": 9,  "31-60d": 0,  ">60d": 0,  total: 9 },
    "Exploration CI Support": { "0-30d": 4,  "31-60d": 1,  ">60d": 2,  total: 7 },
    "Tanda IT Agents":        { "0-30d": 4,  "31-60d": 1,  ">60d": 2,  total: 7 },
    "Exploration IT Support": { "0-30d": 2,  "31-60d": 0,  ">60d": 2,  total: 4 },
    "Ouaga IT Agents":        { "0-30d": 4,  "31-60d": 0,  ">60d": 0,  total: 4 },
    "Exploration BF Support": { "0-30d": 2,  "31-60d": 0,  ">60d": 0,  total: 2 },
  },
  top_pain_reasons: [
    { rank:1, label:"External providers", body:"(data & credit provisioning) — SLA commitments under review by Infra team." },
    { rank:2, label:"Procurement delays", body:"on hardware / software purchases creating pending-approval queues." },
    { rank:3, label:"Site coverage gaps", body:"at Mana / Dakar / Sabodala awaiting recruitment closure." },
  ],
}
```

The pain-reason labels are currently hand-edited monthly — consider letting the operator edit them in an admin UI rather than re-generating them.

### 3.5 Customer Satisfaction / Voice (slide 7)

```ts
// GET /api/survey/csat?month=2026-05&surveyId=1140928000001649017
{
  total_responses: 175,
  satisfied:    144,  // raw star_rating score >= 4
  neutral:       10,  //                     == 3
  dissatisfied:   7,  //                     in (1,2)
  no_rating:     14,  // null / skipped
  csat_pct: 89.4,                  // satisfied / (sat+neu+dis) * 100
  nps_proxy: 85,                   // (sat - dis) / rated * 100
  avg_star: 4.13,                  // mean of 1-5 scores
  voice_themes: {
    pain: [
      { theme:"Long-running / Unresolved", count:3, sample:"'Not yet sorted', 'Not fixed yet', 'issue not resolved'" },
      { theme:"Time to Resolution",        count:2, sample:"'long time from request to resolution', 'took longer than expected'" },
      { theme:"Connection Persistence",    count:1, sample:"'problème de connexion persiste'" },
    ],
    praise: [
      { theme:"Speed / Responsiveness",  count:20, sample:"'Fast response from Isaac', 'very prompt resolution', 'prompt response'" },
      { theme:"Excellent / High Quality",count:15, sample:"'Excellent response time', 'very good, very well appreciated'" },
      { theme:"Helpful / Supportive Team",count:12,sample:"'We appreciate your proactiveness', 'Très bonne initiative'" },
    ],
  }
}
```

**Critical scope rule.** `surveyId` must be the active Helpdesk survey (currently `1140928000001649017`). The Zoho workspace has 4 surveys — the others (ERP CSAT, dormant UAT, legacy) must be excluded. See §16 for the historical bug and SQL fix.

**Voice themes** are derived from the free-text Comment column. Either compute server-side with simple keyword grouping, or call an LLM (Claude Haiku) to cluster the verbatim comments into 3 pain + 3 praise themes per month. The latter produces noticeably better results.

### 3.6 Major Incidents (slide 9)

```ts
// GET /api/major-incidents?month=2026-05&scope=ops
// scope: "ops" = include incidents created in month OR resolved in month
{
  total: 5,
  p1_count: 3,
  p2_count: 2,
  records: [
    { ticket:"307645", site:"ABIDJAN", priority:"Critical",
      created:"2026-05-21", resolved:"2026-05-21",
      title:"Centric Database Server Down",
      detail:"Centric database server unavailable — DR procedure engaged. Restoration confirmed within SLA window. Status: Closed.",
      action:"Investigate root cause; harden VM redundancy and snapshot cadence." },
    { ticket:"307580", site:"LAFIGUE", priority:"Critical",
      created:"2026-05-24", resolved:"2026-05-24",
      title:"GSM & LSI Issue",
      detail:"Combined GSM (mobile network) and LSI (local site infrastructure) outage at Lafigué — site IT triaged and restored.",
      action:"Confirm carrier failover; coordinate with MTN/Orange on resiliency." },
    { ticket:"304487", site:"ABIDJAN", priority:"Critical",
      created:"2026-04-30", resolved:"2026-05-04",
      title:"WiFi / DHCP Core Services Outage",
      detail:"Loss of WiFi, DHCP and adjacent core services at Abidjan — opened 30 Apr, closed 04 May.",
      action:"Reinforce monitoring + redundancy on DHCP/WiFi controllers; review on-call response." },
    { ticket:"307800", site:"LAFIGUE", priority:"High",
      created:"2026-05-30", resolved:"2026-05-30",
      title:"SML-CENT-01 Server Access Issue",
      detail:"Server access intermittent on SML-CENT-01 — restored after configuration verification.",
      action:"Capture root cause in runbook; review access ACLs." },
    { ticket:"303918", site:"SABODALA", priority:"High",
      created:"2026-04-26", resolved:"2026-05-19",
      title:"Service Disruption Follow-up — Server / EDV-WIFI",
      detail:"Long-standing P2 from February — PIR sign-off completed and preventive actions verified.",
      action:"Embed preventive measures in standard runbook; close out audit trail." },
  ],
  tile_subtitle: "Tracked in May (3 new + 2 closed)"  // computed: new = created-in-month, closed = pre-existing closed-in-month
}
```

**Selection rule — important.** A MI belongs on the May deck if **(created in May) OR (resolved in May)**. Filtering on "created in May" alone misses important carry-overs (303918 was created 26 Apr but closed in May; 304487 was created 30 Apr but closed 04 May). The `subtitle` should reflect this honestly: e.g. `"Tracked in May (N new + M closed)"`.

The `detail`, `action`, `title` are usually derived from SDP fields (Subject, Description, Resolution Notes) but often need light editorial polish — feed the raw SDP fields to an LLM with a short style prompt for production quality.

### 3.7 Change Management (slide 8)

```ts
// GET /api/changes?month=2026-05
{
  total: 16,
  by_type: { Standard: 11, Major: 4, Emergency: 1 },
  by_status: { "In Progress": 12, Completed: 4 },
  emergency_records: [
    { id:"CHG-273", subject:"IT Dashboard URL Migration",
      detail:"Move IT Dashboard login from http://10.225.99.173:3456 to https://itops-dashboard.edv-ops.com — production-ready Endeavour SSO.",
      site:"All", group:"EDV InfraOps Support", priority:"High", status:"In Progress" },
  ],
  emergency_rate_pct: 6.2,  // = emergency / total * 100; target < 5%
}
```

### 3.8 IT Activity Tracker (slides 10 + 11)

```ts
// GET /api/activity-tracker?month=2026-05
// (the same payload that the activity-tracker page loads on first render)
{
  overall_score_pct: 65,
  mom_delta_pp: 1,
  green: 48, amber: 42, red: 47,
  on_target_pct: 35,
  activity_engagement_pct: 84,
  best_site: { code:"HGO", score:73 },
  watch_site:{ code:"ITY", score:59 },
  pillars: {
    "Network Infra":     { weight:30, score:56, delta_pp:+9,  g:13, a:20, r:0 },
    "Biz Partnering":    { weight:35, score:70, delta_pp:-2,  g:15, a:9,  r:21 },
    "Risk & Compliance": { weight:20, score:72, delta_pp:-2,  g:16, a:10, r:18 },
    "People Dev":        { weight:15, score:59, delta_pp:-3,  g:4,  a:3,  r:8 },
  },
  sites: [
    { code:"HGO", name:"Houndé",   score:73, delta_pp:+7, g:15, a:7,  r:7,  rank:1, tag:"LEADING" },
    { code:"SML", name:"Lafigué",  score:67, delta_pp:-2, g:8,  a:7,  r:12, rank:2, tag:"STABLE" },
    { code:"MGO", name:"Mana",     score:63, delta_pp:-6, g:9,  a:11, r:9,  rank:3, tag:"DECLINED" },
    { code:"SGO", name:"Sabodala", score:61, delta_pp:+5, g:8,  a:12, r:9,  rank:4, tag:"RECOVERY" },
    { code:"ITY", name:"Ity",      score:59, delta_pp:0,  g:8,  a:5,  r:10, rank:5, tag:"LAGGING" },
  ],
  inactive_sites: ["ABJ","DKR","KLN","EXP","EDV","TND"],
  apr_site_scores: { MGO:72, HGO:66, SML:69, ITY:59, SGO:56 },  // for the May-vs-Apr bar chart
  exec_commentary: [
    "Fleet performance improved by 1pp to 65% (64%→65%). Target attainment: 35%.",
    "Network Infra (30%): fleet avg +9pp — positive momentum.",
    "Systemic gap: Monthly Inspection, Mid Year and Yearly Review RED at all sites — requires coordinated intervention.",
    "Improved: HGO +7pp (66%→73%), SGO +5pp (56%→61%).",
    "Declined: MGO -6pp.",
    // ...
  ],
}
```

Pass these as-is into slides 10 + 11. The dashboard's own activity-tracker page renders the same data, so the endpoint already exists internally.

### 3.9 Slide 2 — Mohamed's narrative (special-case)

Slide 2 (`5. Operations: Summary`) is **never auto-generated**. It's Mohamed's hand-edited slide: Progress / Issues+Risks / Activities-for-next-period bullets + a Strategic KPIs table with RAG dots + Project Health pills. The renderer must:
1. Copy slide 2 verbatim from the previous month's deck.
2. Flip ONLY the `Reporting Month` cell from `April` → `May`.
3. Leave everything else untouched.

Provide an admin UI so Mohamed can edit the bullets / KPI Comments directly in the dashboard before the report is generated, and persist them as the "narrative payload" for that month.

---

## 4. The 11-Slide Layout — Map

| # | Title | Driven by §3 input | Notes |
|---|---|---|---|
| 1 | GROUP IT REPORT — `<Month> <Year>` | none (cover) | Static template + month label |
| 2 | 5. Operations: Summary | §3.9 narrative payload + KPI tiles row | Mohamed-owned, **never auto-rewritten** |
| 3 | Executive Overview — At a Glance (12 KPI tiles) | §3.1 KPIs | Tile order locked — see §8 |
| 4 | Helpdesk Operations — 12-Month Trend | §3.1 + §3.2 | 2 charts + 2 KPI tiles |
| 5 | Distribution & Channel | §3.3 | 2 charts + 2 KPI tiles |
| 6 | SLA & Ageing | §3.4 | Bar chart + 2 callout boxes (yellow Why + pink Critical Top 5) |
| 7 | CSAT & Voice | §3.5 | Donut + 3 KPI tiles + Pain | Praise columns |
| 8 | Change Management | §3.7 | Donut + 6 KPI tiles + Emergency callout |
| 9 | Major Incidents & Escalations | §3.6 | 3 KPI tiles + N incident boxes (N=3-5) |
| 10 | IT Ops Strategy Roadmap | §3.8 | 5 KPI tiles + 2 bar charts |
| 11 | Executive Commentary & Site Summaries | §3.8 | 4 pillar chips + 5 site cards + General Review |

Slides 2–11 all carry the EM Banner at the bottom and the orange/navy chevron corner accent with the slide number overlay. Slide 1 is intentionally banner-free.

---

## 5. KPI Computation Rules (canonical formulas)

The dashboard already implements all of these; the renderer must NOT re-derive them from raw CSV. Use whatever values the dashboard's `/api/helpdesk/kpis` returns. Listed here for verification.

| Metric | Formula | Notes |
|---|---|---|
| Closure rate | `closed / inbound × 100` | |
| Resolution SLA % | `(count where Resolved Time ≤ DueBy Time) / count where (resolved AND due-by present) × 100` | Dashboard uses raw timestamps, NOT the `Overdue Status` flag. The flag is stale because SDP doesn't auto-refresh it. |
| FRT SLA % | `(count where Responded Time ≤ FRT_due) / count × 100` | Computed by the dashboard's proxy; not exposable from CSV alone. |
| FCR Rate | `100 − (count(ReOpened == 'Yes') / total × 100)` | The previous derivation from `FCR Marked` flag produced ~18% (wrong — flag is rarely set in SDP). |
| Avg Resolution (days) | `mean(Resolved Time − Created Time)` over resolved tickets | |
| Open Backlog | `count(status NOT IN [Closed, Resolved, Cancelled, Rejected, Confirm resolution])` as of report date | This is *currently open*, not "created-in-month and still open". |
| Major Incident scope | `(Request Type == "Major Incident") AND (created in month OR resolved in month)` | The OR clause catches carry-overs like 303918 (Apr→May) and 304487 (Apr→May). |
| Emergency Change rate | `emergency_changes / total_changes × 100` | Target <5%. |
| NPS-proxy | `(sat − dis) / (sat + neu + dis) × 100` | Surrogate; replace with true NPS once a Type=`nps` question lands in the active Helpdesk survey form. |
| CSAT class | star_rating in {4,5}=Satisfied, ==3=Neutral, in {1,2}=Dissatisfied, NULL/0=No Rating | Derive from RAW `Score` from `Zoho Survey Answers`, NOT from `Average Rating` (which is 0–10 scale and unreliable pre-April 2026). |

---

## 6. Brand System

### 6.1 Colour palette (RGB hex)

```
ORANGE      #E87722        Primary accent
ORANGE_D    #C85F10        Hover / pressed
NAVY        #1A3A5F        Primary text & header band
DARK_NAVY   #0E2B4F        Slide 1 cover
BLUE        #2E5C8A        Secondary tile / Mar-comparison series
GREEN       #2E8540        RAG green / "good" deltas
AMBER       #F59E0B        RAG amber / warnings
RED         #DC2626        RAG red / "bad" deltas / Critical badge
GRAY        #6B7280        Muted text / Apr-comparison bars
LIGHT_GRAY  #F1F3F6        Card background
LIGHTER_GRAY#F8F9FB        Page background
WHITE       #FFFFFF
CHARCOAL    #333333        Body text
MUTED       #9CA3AF        Footnotes
```

Site palette (slide 10 bar colours, in MGO→SGO order):
```
MGO #0D9488    HGO #D97706    SML #7C3AED    ITY #B8860B    SGO #2563EB
```

### 6.2 Typography

- Primary font: **Calibri** (substitute Carlito if Calibri unavailable on the renderer host).
- Brand-preferred font is **Franklin Gothic** with Calibri as fallback. If Franklin Gothic WOFF2 files become available, switch to it — but verify they're installed on the renderer host first; embedding in `.pptx` is fragile.
- Sizes: headings 14–18pt, KPI tile values 22–32pt, body 9–11pt, footnotes 8pt.

### 6.3 Slide canvas

- 16:9 widescreen (`13.333" × 7.5"`).
- Header band: y=0 to y=1.40, navy fill, white title centred.
- EM Banner image: y=7.35 to y=7.50, full-width.
- Corner accent: x=12.47, y=7.18, w=0.85, h=0.16 — slide number is an editable text box overlaid on the accent.
- Body content area: y=1.55 to y=7.05.

### 6.4 Delta pill component

- Light background (slide 3 KPI tiles): light-green/red/gray pill bg, bold dark text.
- Dark background (slide 1 cover): deep-green/maroon/navy pill bg, light text.
- Helper: `delta_pill(slide, x, y, text, kind=, dark_bg=)`. `kind ∈ { good, bad, neutral, method }`. Use `method` for FCR (because the formula changed; show "method Δ" rather than a numeric delta).

Direction-of-good per metric:

| Metric | Good = | Notes |
|---|---|---|
| Total Tickets | neutral | volume swing; pill stays gray |
| Closed / Closure rate | up | fewer closures = bad |
| SLA Compliance / FRT SLA | up | |
| Open Backlog / Avg Resolution / SLA Violations | down | |
| Major Incidents / Emergency Changes | down | |
| Support Groups | up/neutral | |
| FCR Rate | up | use `method Δ` pill in months where the formula changed |

---

## 7. Chart Specifications

All charts: `matplotlib`, white background, no border, light grid only on the value axis. Save as PNG at the exact target dimensions (see §10 for the picture-frame aspect-ratio rule).

### 7.1 Slide 4 — Volume bars (Inbound vs Closed)

```py
figsize=(8.5, 4.2); dpi=180
- 12 monthly groups, 2 bars per group, width 0.40, gap minimal
- Inbound colour #3B5A8C, Closed colour #2E8540
- LAST month's bars in ORANGE (#E87722) and light-orange (#F59E5C) to highlight current month
- Value label above each bar, 7pt, navy
- Y-axis with minor ticks at 250
- Title "Monthly Volume — Inbound vs Closed", 13pt bold navy
- Legend top-left, frameless
```

### 7.2 Slide 4 — SLA line chart (12 months)

```py
figsize=(5.0, 4.0); dpi=180
- 2 lines: Res. SLA (GREEN, solid, marker 'o') + FRT SLA (BLUE, dashed, marker 's')
- Dotted horizontal line at y=90 (RED, alpha 0.8) labelled "Target 90%"
- Y-axis 30-100
- Value labels above Res. SLA dots, 7pt
- Title "SLA Compliance — 12 Months"
```

### 7.3 Slide 5 — Category horizontal bars (Apr vs May)

```py
figsize=(5.8, 4.2); dpi=180
- Two horizontal bars per category (Apr in #9CA3AF, May in ORANGE)
- 8 top categories sorted by May value descending
- Category labels truncated to 28 chars with ellipsis
- Value labels to the right of each bar
```

### 7.4 Slide 5 — Channel trend line (13 months)

```py
figsize=(5.8, 4.2); dpi=180
- 2 lines: E-Mail % (BLUE, solid, marker 'o') and Web Form % (ORANGE, solid, marker 's')
- BLUE area fill at alpha 0.10 under the E-Mail line
- Last-month value annotated next to its terminal point
```

### 7.5 Slide 6 — Ageing stacked bars (horizontal)

```py
figsize=(6.5, 4.5); dpi=180
- Horizontal stacked bars: 0-30d (GREEN), 31-60d (AMBER), >60d (RED)
- Sort sites by total open descending
- Total label at end of each bar, bold navy
```

### 7.6 Slide 7 — CSAT donut

```py
figsize=(5.0, 4.5); dpi=180
- 4 slices: Satisfied (GREEN), Neutral (AMBER), Dissatisfied (RED), No Rating (GRAY)
- Hole width 0.42, edges white, autopct shown ONLY if slice ≥4%, else hidden
- Inside-slice labels white, 11pt bold
- Title: f"Survey Responses (n={N})"
- Legend below, 2-column, frameless, listing absolute counts
```

### 7.7 Slide 8 — Changes donut

```py
figsize=(5.0, 4.5); dpi=180
- 3 slices: Standard (BLUE), Major (NAVY), Emergency (RED)
- Same hole/style as slide 7
- Legend below, 3-column
```

### 7.8 Slide 10 — Site Performance bars (Apr vs May)

```py
figsize=(6.20, 3.50); dpi=200  # exact aspect of the picture frame
- 5 site groups (MGO HGO SML ITY SGO)
- Apr bars #9CA3AF, May bars in site colours from §6.1
- Apr value 10pt gray above each Apr bar; May value 12pt bold navy
- Y-axis 0-100, title 15pt bold navy
- Subplot_adjust: left=0.08, right=0.98, top=0.90, bottom=0.10
```

### 7.9 Slide 10 — RAG distribution by pillar (stacked bars)

```py
figsize=(6.10, 3.50); dpi=200
- 4 pillars: Network Infra, Biz Partnering, Risk & Compl., People Dev
- Stacked: Green (GREEN) + Amber (AMBER) + Red (RED)
- Y-axis auto-scale to max+5
```

---

## 8. Slide-by-Slide Content Spec

### Slide 1 — Cover

Static template: Endeavour logo top-left on orange ground, Africa-shaped photo cutout, LSE/TMX/OTCQX footer logos. Only thing that changes per month is the `<Month> <Year>` label under "GROUP IT REPORT".

### Slide 2 — Operations Summary (Mohamed)

Copy from previous month's deck; flip only the `Reporting Month` table cell. Do not touch:
- Mohamed's photo, name, role
- Goal banner
- Progress / Issues+Risks / Activities tables
- Strategic KPIs table (deliverables + RAG dots + Comments)
- Legend strip

### Slide 3 — Executive Overview (12 KPI tiles, 3 rows × 4 cols)

| Row | Tiles |
|---|---|
| 1 | Total Tickets · Closed Tickets · SLA Compliance (Res) · Open Backlog |
| 2 | FCR Rate · FRT SLA · Avg Resolution · *(blank — row 2 col 4 is intentionally empty)* |
| 3 | Changes (New) · Emergency Changes · Major Incidents · Support Groups |

Each tile carries: top-left coloured rule, label, value (big), MoM delta pill (top-right), subtitle.

Commentary band at the bottom (8-10 lines, CIO/CFO voice — see §9).

### Slide 4 — 12-Month Trend

- Left: Monthly Volume bar chart (§7.1)
- Right-top: 2 KPI tiles — FRT SLA (red rule) + RES SLA (amber rule), each with target ≥90% caption
- Right-bottom: SLA Compliance line chart (§7.2)
- Commentary band at the bottom

### Slide 5 — Distribution & Channel

- Left: Category horizontal bars (§7.3)
- Right-top: Channel trend line (§7.4)
- Right-bottom: 2 channel-pct tiles (E-Mail / Web Form) with `<N> tickets · +Xpp vs Mar` subtitle
- Commentary band at the bottom

### Slide 6 — SLA & Ageing

- Left: Ageing stacked bars by site group (§7.5)
- Right-top: Yellow callout "WHY IS THE BACKLOG BLOCKED?" — 3 numbered reasons + GREEN engagement footer
- Right-bottom: Pink callout "⚠ CRITICAL AGEING — Top Sites by Open Volume" — 5 bold site lines, each followed by `(<n> <30d, <n> 30-60d, <n> >60d)` in muted gray
- Commentary band at the bottom

### Slide 7 — CSAT & Voice

- Left: Donut (§7.6) with `Survey Responses (n=N)` title and Satisfied/Neutral/Dissatisfied/No Rating legend
- Right: 3 KPI tiles (CSAT %, Avg Survey Score %, NPS-Proxy)
- Below tiles: 2 columns side-by-side — TOP PAIN POINTS (3 numbered themes with mention counts + samples in italic muted gray) and TOP PRAISE (same shape)
- Commentary band at the bottom

### Slide 8 — Change Management

- Left: Donut by type (§7.7)
- Right: 6 KPI tiles in 2×3 grid (TOTAL, EMERGENCY, MAJOR, STANDARD, COMPLETED, IN PROGRESS)
- Below tiles: yellow Emergency callout — title with CHG-ID, then site/group/priority/status one-liner
- Commentary band at the bottom

### Slide 9 — Major Incidents

- Top: 3 KPI tiles (P1, P2, TOTAL) with subtitle `Tracked in <Month> (<n> new + <m> closed)`
- Below: N stacked incident boxes (N=3 to 5), each consisting of:
  - Left badge (1.50" × 0.66"): RED for Critical, AMBER for High; bold white text centred
  - Right body (11.00" × 0.66"): site · date | bold title | one-line detail | "Lessons / Actions:" + one-liner
- Commentary band at the bottom

**Layout safety:** with 5 incidents, box height 0.66", gap 0.04", start y=3.05 — total area = 3.46" → end y=6.51" (commentary starts at 6.55"). Tested in production. With 3 incidents use box height 1.00", gap 0.10".

### Slide 10 — IT Ops Strategy Roadmap

- Top: 5 KPI tiles (GREEN, AMBER, RED, AVG SCORE %, MoM Δ)
- Bottom-left: Site Performance bars (§7.8)
- Bottom-right: RAG by Pillar stacked bars (§7.9)
- Source line at y=6.75: `Source: IT Ops Objectives Tracker — <Month> vs <PrevMonth> <Year>  |  Endeavour Mining PLC`

### Slide 11 — Executive Commentary & Site Summaries

- Top: 4 pillar chips (Network Infra 30% / Biz Partnering 35% / Risk & Compl. 20% / People Dev 15%) coloured navy/orange/purple/yellow, with delta below each
- Middle: 5 site cards (MGO HGO SML ITY SGO), each card has:
  - Coloured header strip with site code + full name
  - Score % (large) + delta chip
  - 3 G/A/R count chips (green / amber / red)
  - 2-line narrative
- Bottom: General Review — 4 bullets, 2 ✓ (GREEN) + 2 ⚠ (AMBER), CIO/CFO voice

---

## 9. Voice & Commentary Style (CIO/CFO audience)

The footers and General Review are not data dumps. They are framed for a CIO + CFO audience reviewing the deck in 90 seconds.

### Rules of thumb

1. **Lead with business impact, not the ticket count.** "May was the strongest operational month of the year" before "1,327 tickets."
2. **Translate operational metrics into business value.** Portal adoption → lower cost-to-serve. DR runbook execution → validated H2 investment. Carrier redundancy → still-open business case.
3. **Use "we" language.** Frame issues as joint decisions, not blame.
4. **Frame negatives as asks, not as problems.** "Recommend GM-level conversation to reset ownership" beats "MGO declined".
5. **Highlight financial / risk implications where genuine.** Don't fabricate them.
6. **Acknowledge process gaps as process gaps, not site issues.** "This is a process issue, not a site issue — proposing a coordinated owner."
7. **Keep it short.** Each footer is 3–6 sentences. The General Review on slide 11 is exactly 4 bullets.
8. **Numbers in context, not standalone.** "+8.4pp month-on-month" not just "+8.4pp".
9. **Name the deliverable, not the underlying ticket.** "We migrated the operational dashboard…" not "CHG-273 changed."
10. **Avoid jargon that doesn't render at the C-suite.** No "Helpdesk", no internal acronyms unless explained inline.

### Sample voice — slide 3 footer

> "May was the strongest operational month of the year. Volume normalised by 9%, closure rate held at 93.3%, and Resolution SLA cleared the 90% target for the first time — 93%, +6.3pp month-on-month. First-response SLA climbed to 86.4% (+3.2pp). Time-to-resolve halved, from 3 days to 1. Three major incidents — all contained, no business interruption beyond the immediate window. We migrated the operational dashboard to a production-grade Endeavour domain (CHG-273), retiring the legacy IP-based link. The standing watch-item is open backlog at 188 tickets — concentrated at Sabodala, Abidjan and Lafigué, driven by procurement and provider lead-times."

### Sample voice — slide 11 General Review

> ✓ Fleet momentum is positive: overall score 65% (+1pp), with Network Infrastructure as the standout pillar (+9pp).
> ✓ Houndé leads the operating sites (+7pp); Sabodala is recovering (+5pp). Both validate the targeted coaching from April.
> ⚠ Mana stepped back -6pp this month, driven by Risk & Compliance (-11pp). Recommended decision: site-level escalation with the Mana GM.
> ⚠ A systemic gap is now visible: Monthly Inspection, Mid-Year and Yearly Review are RED at every site. This is a process issue, not a site issue — proposing a coordinated owner.

### Generating commentary at runtime — Claude API

Use the **Anthropic Node SDK** (`@anthropic-ai/sdk`) — the API key is already provisioned, load it from `ANTHROPIC_API_KEY`. Recommended model: `claude-sonnet-4-6` for production quality, `claude-haiku-4-5-20251001` for lower-cost drafts.

```js
// services/commentaryService.js
const Anthropic = require("@anthropic-ai/sdk");
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const VOICE_RULES = `
You are writing the executive commentary footer for one slide of Endeavour Mining's monthly IT Operations report. Audience: CIO and CFO.

Voice rules:
1. Lead with business impact, not the ticket count.
2. Translate operational metrics into business value (cost-to-serve, DR validation, vendor SLA risk, etc.).
3. Use "we" language; frame issues as joint decisions, not blame.
4. Frame negatives as asks ("Recommended decision: …"), not problems.
5. Highlight genuine financial / risk implications; do not invent them.
6. Acknowledge process gaps as process gaps, not site issues.
7. Output 3–6 sentences. No bullet points unless the slide spec says bullets. No emoji.
8. Numbers in context, not standalone. Never invent or round numbers — use exactly what the payload contains.
9. Do not repeat the slide title.
10. Name deliverables, not internal acronyms ("we migrated the operational dashboard" not "CHG-273 was completed").
`;

async function draftFooter(slideName, payload) {
  const resp = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 400,
    system: VOICE_RULES,
    messages: [{
      role: "user",
      content: `Slide: ${slideName}\n\nPayload (use these exact numbers only):\n${JSON.stringify(payload, null, 2)}\n\nWrite the footer commentary now.`
    }]
  });
  return resp.content[0].text.trim();
}

async function draft(payload) {
  // Generate footers for each slide in parallel
  const [s3, s4, s5, s6, s7, s8, s9] = await Promise.all([
    draftFooter("Executive Overview (slide 3)", payload.kpis),
    draftFooter("12-Month Trend (slide 4)",     { kpis: payload.kpis, trend: payload.trend }),
    draftFooter("Distribution & Channel (slide 5)", payload.distribution),
    draftFooter("SLA & Ageing (slide 6)",       payload.ageing),
    draftFooter("CSAT & Voice (slide 7)",       payload.csat),
    draftFooter("Change Management (slide 8)",  payload.changes),
    draftFooter("Major Incidents (slide 9)",    payload.major_incidents),
  ]);

  // General Review bullets for slide 11 — different shape: 4 lines, 2 ✓ + 2 ⚠
  const s11Review = await draftBullets("Site Summaries General Review (slide 11)", payload.activity_tracker);

  return { slide3:s3, slide4:s4, slide5:s5, slide6:s6, slide7:s7, slide8:s8, slide9:s9, slide11Review:s11Review };
}

async function draftBullets(slideName, payload) {
  const resp = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 400,
    system: VOICE_RULES + "\nFor this slide output EXACTLY 4 lines: 2 starting with '✓' (positives), then 2 starting with '⚠' (watch-items). One sentence per line.",
    messages: [{ role: "user", content: `Slide: ${slideName}\n\nPayload:\n${JSON.stringify(payload, null, 2)}\n\nWrite the 4-bullet General Review now.` }],
  });
  return resp.content[0].text.trim().split("\n").filter(s => s.trim()).slice(0, 4);
}

module.exports = { draft, draftFooter };
```

### Voice-of-Customer theme clustering

The CSAT pain/praise themes (slide 7) are derived from the free-text Comment column. Cluster with the same SDK:

```js
async function clusterVoiceThemes(comments, classLabel) {
  const resp = await client.messages.create({
    model: "claude-haiku-4-5-20251001",   // Haiku is fine for clustering
    max_tokens: 500,
    system: `You are clustering customer feedback comments into 3 themes for an executive deck.
Output strict JSON: [{theme:"...", count:N, sample:"verbatim quote"}, ...] with exactly 3 items.
Themes must be short (2-4 words). Sample must be a verbatim quote from the input (not paraphrased).`,
    messages: [{
      role: "user",
      content: `These are ${classLabel} customer comments from May 2026. Cluster into 3 themes ranked by count.\n\n` + comments.join("\n---\n")
    }],
  });
  return JSON.parse(resp.content[0].text);
}
```

Cache results per month so re-generating the deck doesn't re-spend API tokens. Surface a "Regenerate commentary" button in the admin UI for the operator.

---

## 10. Layout Safety Rules (from production)

Hard-won lessons. Skipping these reintroduces real bugs that hit production.

### 10.1 Picture replacement: never use stale indices

```py
# WRONG — second call targets the wrong shape after first removal
slide.shapes[idx_a].remove()
slide.shapes.add_picture(...)
slide.shapes[idx_b].remove()    # idx_b is now stale; this removes a different shape

# RIGHT — find by absolute position FIRST, then mutate
def find_pic_by_pos(slide, x_in, y_in, tol=0.1):
    for sh in slide.shapes:
        if sh.shape_type == 13 and abs(sh.left/914400 - x_in) < tol and abs(sh.top/914400 - y_in) < tol:
            return sh
    return None

left_pic  = find_pic_by_pos(s10, 0.40, 3.10)
right_pic = find_pic_by_pos(s10, 6.85, 3.10)
# both references captured BEFORE any mutation
for pic, path in [(left_pic, "siteperf.png"), (right_pic, "ragpillar.png")]:
    x, y, w, h = pic.left, pic.top, pic.width, pic.height
    pic._element.getparent().remove(pic._element)
    slide.shapes.add_picture(path, x, y, w, h)
```

### 10.2 Chart-image aspect ratio must match the picture frame

If frame is 6.20"×3.50" (≈1.77:1), matplotlib `figsize` must be `(6.20, 3.50)` at `dpi=200`. Mismatched aspects (e.g. `(7, 4)`) cause pixel-stretch streaks in LibreOffice PDF exports — usually invisible in PowerPoint but visible to anyone who reviews the PDF preview.

### 10.3 Multi-paragraph text frames: use python-pptx native API

```py
# WRONG — raw lxml SubElement(qn("a:p")) makes paragraphs LibreOffice fails to render
# RIGHT
from pptx.enum.text import PP_ALIGN
tf = box.text_frame; tf.clear()
for i, (icon, color, body) in enumerate(lines):
    p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
    p.alignment = PP_ALIGN.LEFT     # explicit; first paragraph after clear() inherits centered alignment otherwise
    r1 = p.add_run(); r1.text = icon; r1.font.bold = True; r1.font.color.rgb = color
    r2 = p.add_run(); r2.text = body
```

### 10.4 Cell formatting: preserve the first run's font

Tables on slide 2 use specific font/size/color per cell. When updating a cell's text, capture the first run's font properties first, then clear and rewrite:

```py
def set_cell_text(cell, new_text):
    tf = cell.text_frame
    p0 = tf.paragraphs[0]
    fr = p0.runs[0] if p0.runs else None
    f0 = capture_font(fr) if fr else default_font
    align = p0.alignment
    tf.clear()
    p = tf.paragraphs[0]; p.alignment = align
    r = p.add_run(); r.text = new_text
    apply_font(r, f0)
```

### 10.5 Same string appears in multiple places

Several values appear identically across slides (e.g. "+5pp" appears once on the HGO card and once on the SGO card). When replacing by exact-text match, use **position-based lookup** instead:

```py
# Find delta chips by their y-coordinate row (y=3.33 on slide 11), sorted by x
delta_chips = [sh for sh in s11.shapes if sh.has_text_frame and abs(sh.top - Inches(3.33)) < Emu(50000)
               and sh.text_frame.text.strip().endswith("pp")]
delta_chips.sort(key=lambda s: s.left)
# Now they're in MGO HGO SML ITY SGO order — index unambiguously
```

### 10.6 Variable-count incident layout

3-incident layout: box h=1.00", gap=0.10", start y=3.20.
4-incident layout: box h=0.82", gap=0.05", start y=3.05.
5-incident layout: box h=0.66", gap=0.04", start y=3.05.

Inside each box, compress font sizes proportionally so the meta + title + detail + lessons row fit in `h - 0.04"` of vertical content.

### 10.7 Slide 2 untouchable

The Mohamed slide is a hand-edited deliverable. The renderer must copy slide-2 XML verbatim from the previous month and **only** flip the `Reporting Month` cell. Touching anything else regresses the deck.

### 10.8 Deck file rename / lock

When the user has the file open in PowerPoint, writes to the destination path fail silently. Always:
1. Write to a sibling path (e.g. `*_v<N+1>.pptx`).
2. Verify the file size + sha1 changed.
3. Surface the new filename in the response.

---

## 11. Implementation Plan

### 11.1 Server layout

```
/dashboard
  /server                    # existing Node + Express app
    /routes
      reports.js             # NEW — POST /api/reports/generate
    /services
      reportPayload.js       # NEW — assembles the §3 payload from internal APIs
      commentaryService.js   # NEW — calls LLM for §9 footers
    /python                  # NEW — invoked as sub-process
      render_report.py       # entry: reads payload JSON on stdin, writes PPTX to stdout or to a path arg
      brand.py               # brand tokens, dimensions, helpers (set_text, find_pic_by_pos, etc.)
      slides/
        slide1.py            # cover
        slide2.py            # carry-forward from prev month
        slide3.py            # KPI tiles
        slide4.py            # trend
        slide5.py            # distribution
        slide6.py            # ageing
        slide7.py            # CSAT
        slide8.py            # changes
        slide9.py            # major incidents
        slide10.py           # tracker roadmap
        slide11.py           # site summaries
      charts/
        s4_volume.py
        s4_sla.py
        s5_category.py
        s5_channel.py
        s6_ageing.py
        s7_donut.py
        s8_changes.py
        s10_siteperf.py
        s10_ragpillar.py
      assets/
        em_banner.jpg
        em_logo.png
        left_corner.png
        cover_africa_photo.jpg
  /reports                   # generated PPTX outputs (gitignored)
```

### 11.2 Endpoint flow

```ts
// POST /api/reports/generate
// body: { month: "2026-05", group?: "ops", regenerateCommentary?: true }
async function generateReport(req, res) {
  const { month, group = "ops" } = req.body;

  // 1. Build the payload from internal services
  const payload = await reportPayload.build({ month, group });

  // 2. Optionally call LLM for fresh commentary
  if (req.body.regenerateCommentary) {
    payload.commentary = await commentaryService.draft(payload);
  } else {
    payload.commentary = await commentaryService.loadDraft(month);  // operator-edited via admin UI
  }

  // 3. Hand to Python renderer
  const outPath = `/reports/Group_IT_Operations_Report_${monthName(month)}_${year(month)}.pptx`;
  await spawnPython("python/render_report.py", {
    payload: JSON.stringify(payload),
    out: outPath,
    prevDeck: await findPreviousMonthDeck(month),  // for slide 2 carry-forward
  });

  // 4. Render PDF preview alongside
  await spawnPython("python/render_pdf.py", { in: outPath });

  // 5. Return URLs
  res.json({
    pptxUrl: signUrl(outPath),
    pdfUrl: signUrl(outPath.replace(".pptx", ".pdf")),
    payloadDebug: payload,  // omit in production; useful in staging
  });
}
```

### 11.3 Python sub-process contract

```py
# render_report.py
import sys, json
from pptx import Presentation
from slides import slide1, slide2, slide3, ..., slide11
from brand import save_to

payload = json.loads(sys.stdin.read() if not sys.argv[1] else open(sys.argv[1]).read())
prev_deck_path = sys.argv[2]
out_path = sys.argv[3]

prs = Presentation()  # or load a template
slide1.build(prs, payload)
slide2.carry_forward(prs, prev_deck_path, payload["month_name"])  # NEVER auto-rewrite
slide3.build(prs, payload["kpis"])
slide4.build(prs, payload["kpis"], payload["trend"])
slide5.build(prs, payload["distribution"])
slide6.build(prs, payload["ageing"])
slide7.build(prs, payload["csat"])
slide8.build(prs, payload["changes"])
slide9.build(prs, payload["major_incidents"])
slide10.build(prs, payload["activity_tracker"])
slide11.build(prs, payload["activity_tracker"])
save_to(prs, out_path)
```

Each slide module exposes a `build(prs, slide_data, commentary)` function. Keep them isolated so unit tests can render one slide at a time.

### 11.4 PDF preview

`libreoffice --headless --convert-to pdf` is the simplest path; runs in ~5s per deck. Caveat: occasional rendering quirks (gradient fills, complex tables) — verify the PDF preview matches the PPTX in your CI before relying on it.

### 11.6 Bundled template + brand assets

The receiving session must use the **exact** Endeavour template that's in production today. The handoff package next to this guide (`_handoff/`) contains:

| File | Purpose |
|---|---|
| `Group IT-OPS_template.pptx` | Original Endeavour template — slide 1 cover artwork + slide 2 layout (Mohamed's Operations Summary). Treat as **golden source** — slide 2 is copy-forward each month; slide 1 only the month label changes. |
| `Group_IT_Operations_Report_April_2026_FINAL_v4.pptx` | Reference April build — use as the prev-month deck input for May's slide-2 carry-forward. After May ships, May becomes prev-month for June. |
| `Group_IT_Operations_Report_May_2026.pptx` | Latest production build (May 2026). Use as the visual reference for slides 3-11 layout. |
| `EM Banner 1.jpg` | Bottom-bar EM brand artwork (orange/yellow/blue chevron pattern). Width 13.33", height 0.15". Position y=7.35 on every slide except slide 1. |
| `left_corner.png` | Bottom-right corner accent for the slide number overlay. Position x=12.47, y=7.18, w=0.85, h=0.16. |
| `kpis-april.json`, `kpis-may.json` | Concrete payload examples — matches §3 shape. Use for unit testing the renderer. |

These files live alongside this guide in `Monthly-Reports/_handoff/` and should be vendored into the dashboard repo at `server/python/assets/` and `server/python/templates/`.

**Important:** Do NOT regenerate the cover or slide-2 layout from scratch with `python-pptx` — the existing template carries the Africa-shaped photo cutout, LSE/TMX/OTCQX logos, Mohamed's photo + Strategic KPIs table, and other pixel-perfect template elements that are tedious to rebuild and easy to regress. Load the template, mutate only what changes monthly.

### 11.5 Operator admin UI (slide 2 narrative + commentary)

Add a "Narrative" tab on the dashboard where Mohamed can paste / edit Progress / Issues+Risks / Activities-for-next-period bullets, the Strategic KPIs table comments, and Project Health pills per month. Persist as `slide2_narrative_<YYYY-MM>` records. The renderer reads from there rather than carrying-forward verbatim where the operator has edited the current month.

Optionally let the operator also override individual slide footers (the LLM-generated commentary) before the deck is finalised.

---

## 12. Suggested Architecture (full picture)

```
                                ┌─────────────────────────────┐
                                │  Existing dashboard frontend │
                                │   (activity-tracker.html,    │
                                │    index.html, etc.)         │
                                └──────────────┬──────────────┘
                                               │  triggers
                                               ▼
                                ┌─────────────────────────────┐
                                │  POST /api/reports/generate  │
                                │   (Node + Express, NEW)      │
                                └──────────────┬──────────────┘
                                               │
                  ┌────────────────────────────┼────────────────────────────────┐
                  │                            │                                │
                  ▼                            ▼                                ▼
        ┌──────────────────┐         ┌──────────────────┐            ┌──────────────────┐
        │ reportPayload.js  │         │ commentaryService.js│         │  python subprocess │
        │  • /api/helpdesk/* │         │  • Claude API      │         │   render_report.py │
        │  • /api/changes   │         │  • voice rules     │         │   • python-pptx    │
        │  • /api/MI        │         │  • caches drafts   │         │   • matplotlib     │
        │  • /api/survey    │         └──────────────────┘            │   • PIL            │
        │  • /api/AT        │                                          └──────────┬───────┘
        └──────────────────┘                                                     │
                  │                                                              ▼
                  │                                                  ┌──────────────────┐
                  └─────────────────────────────────────────────────►│  /reports/*.pptx  │
                                                                     │  /reports/*.pdf   │
                                                                     └──────────┬───────┘
                                                                                │
                                                                                ▼
                                                                  Signed S3 URL / download link
```

Add an `/api/reports/preview?month=...` GET that returns the cached payload + auto-generated commentary so the operator can review before triggering the actual `generate` call.

---

## 13. API Design Sketch

```
GET  /api/reports/preview?month=2026-05
  → 200 { payload, commentaryDraft }                # operator review

POST /api/reports/commentary?month=2026-05
  body: { slide3: "…", slide4: "…", … }
  → 200 { saved: true }                              # operator overrides

POST /api/reports/generate
  body: { month: "2026-05", group: "ops" }
  → 200 { pptxUrl, pdfUrl, generatedAt }

GET  /api/reports/history?limit=12
  → 200 { reports: [{ month, generatedAt, pptxUrl, pdfUrl }, …] }
```

### Error contracts

```
400 { error: "month must be YYYY-MM" }
404 { error: "no previous month deck found for slide 2 carry-forward" }
409 { error: "report for 2026-05 already generated; pass force=true to overwrite" }
422 { error: "payload missing required field: activity_tracker.sites" }
500 { error: "python renderer failed", traceback: "…" }
```

---

## 14. Sample Code Snippets

### 14.1 Node — assembling the payload

```js
// services/reportPayload.js
const helpdesk = require("./helpdeskService");
const changes = require("./changesService");
const mi = require("./majorIncidentsService");
const survey = require("./surveyService");
const tracker = require("./activityTrackerService");

async function build({ month, group }) {
  const [kpis, trend, distribution, ageing, miBlock, changesBlock, csatBlock, trackerBlock] =
    await Promise.all([
      helpdesk.kpis({ month, group }),
      helpdesk.trend({ endMonth: month, months: 12, group }),
      helpdesk.distribution({ month, group }),
      helpdesk.ageing({ asOf: "now", group }),
      mi.list({ month, scope: group }),    // selection: created in month OR resolved in month
      changes.list({ month }),
      survey.csat({ month, surveyId: "1140928000001649017" }),
      tracker.snapshot({ month }),
    ]);

  return {
    month,
    monthName: new Date(month + "-01").toLocaleString("en", { month: "long" }),
    year: parseInt(month.split("-")[0]),
    kpis, trend, distribution, ageing,
    major_incidents: miBlock,
    changes: changesBlock,
    csat: csatBlock,
    activity_tracker: trackerBlock,
  };
}

module.exports = { build };
```

### 14.2 Python — slide 3 KPI tile factory

```py
# slides/slide3.py
from pptx.util import Inches, Pt
from brand import NAVY, GRAY, add_tile, add_delta_pill

TILE_LAYOUT = [
    # (x, y, label, key, subtitle_template, delta_key, delta_kind)
    (0.40, 1.55, "TOTAL TICKETS",     "total",        "Created in {month}", "total_delta_pct",   "neutral"),
    (3.55, 1.55, "CLOSED TICKETS",    "closed",       "{closure_rate}% closure rate", "closed_delta_pct", "good_up"),
    (6.70, 1.55, "SLA COMPLIANCE (RES)","res_sla_pct","Target ≥ 90% {check}",  "res_sla_delta_pp",  "good_up_pp"),
    (9.85, 1.55, "OPEN BACKLOG",      "open_backlog", "Active open tickets",   "open_backlog_delta_pct", "good_down"),

    (0.40, 3.20, "FCR RATE",          "fcr_pct",      "First Contact Resolution",  None, "method"),
    (3.55, 3.20, "FRT SLA",           "frt_sla_pct",  "Target ≥ 90% {check}",      "frt_sla_delta_pp",  "good_up_pp"),
    (6.70, 3.20, "AVG RESOLUTION",    "res_time_d",   "MTTR — all tickets",        "res_time_delta_d", "good_down"),
    # (9.85, 3.20) — intentionally blank

    (0.40, 4.85, "CHANGES (NEW)",     "changes_total","Created this period",       "changes_delta",    "neutral"),
    (3.55, 4.85, "EMERGENCY CHANGES", "emergency_changes","{emergency_rate}% — Target < 5% {check}", "emergency_delta", "good_down"),
    (6.70, 4.85, "MAJOR INCIDENTS",   "mi_total",     "{p1} P1 · {p2} P2",         "mi_delta",         "good_down"),
    (9.85, 4.85, "SUPPORT GROUPS",    "active_groups","Active in {month}",         "groups_delta",     "neutral"),
]

def build(prs, payload):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    # header band, banner, corner accent — see brand.py
    add_header(slide, "Executive Overview", payload["month_name"])

    for x, y, label, key, subtitle_tpl, delta_key, delta_kind in TILE_LAYOUT:
        add_tile(slide,
                 x=Inches(x), y=Inches(y),
                 label=label,
                 value=payload[key],
                 subtitle=subtitle_tpl.format(**payload),
                 delta=payload.get(delta_key),
                 delta_kind=delta_kind)

    # commentary band at the bottom
    add_commentary_band(slide, payload["commentary"]["slide3"])
```

### 14.3 Python — calling matplotlib for slide 4 chart

```py
# charts/s4_volume.py
import matplotlib.pyplot as plt
import numpy as np
from brand import NAVY, ORANGE

def render(months, inbound, closed, out_path):
    fig, ax = plt.subplots(figsize=(8.5, 4.2), dpi=180)
    x = np.arange(len(months)); w = 0.40
    b1 = ax.bar(x-w/2, inbound, w, label="Inbound", color="#3B5A8C", edgecolor="white")
    b2 = ax.bar(x+w/2, closed,  w, label="Closed",  color="#2E8540", edgecolor="white")
    b1[-1].set_color(ORANGE); b2[-1].set_color("#F59E5C")
    ax.set_xticks(x); ax.set_xticklabels(months, fontsize=9)
    ax.set_title("Monthly Volume — Inbound vs Closed", fontsize=13, fontweight="bold", color=NAVY, pad=10)
    ax.spines[['top','right']].set_visible(False)
    ax.grid(axis='y', alpha=0.25, linestyle='--')
    for r, v in zip(b1, inbound): ax.text(r.get_x()+r.get_width()/2, v+25, f"{v:,}", ha='center', fontsize=7, color="#1F3357")
    for r, v in zip(b2, closed):  ax.text(r.get_x()+r.get_width()/2, v+25, f"{v:,}", ha='center', fontsize=7, color="#1F3357")
    ax.legend(loc='upper left', frameon=False, fontsize=10)
    plt.tight_layout()
    plt.savefig(out_path, dpi=180, facecolor="white")
    plt.close()
```

### 14.4 Slide 2 carry-forward (XML deep-copy)

```py
# slides/slide2.py
import copy
from lxml import etree
from pptx import Presentation

def carry_forward(prs, prev_deck_path, current_month_name):
    """Replace prs.slides[1] content with prev deck's slide 2 XML, flipping only Reporting Month."""
    src_prs = Presentation(prev_deck_path)
    src_s2 = src_prs.slides[1]
    dst_s2 = prs.slides[1]

    dst_spTree = dst_s2.shapes._spTree
    for child in list(dst_spTree):
        if etree.QName(child).localname in ('sp','pic','graphicFrame','grpSp'):
            dst_spTree.remove(child)

    src_spTree = src_s2.shapes._spTree
    for child in src_spTree:
        if etree.QName(child).localname in ('sp','pic','graphicFrame','grpSp'):
            dst_spTree.append(copy.deepcopy(child))

    # Map image relationships
    relid_map = {}
    for r_id, rel in src_s2.part.rels.items():
        if rel.reltype.endswith("/image"):
            new_rid = dst_s2.part.relate_to(rel.target_part, rel.reltype)
            relid_map[r_id] = new_rid
    for blip in dst_spTree.iter('{http://schemas.openxmlformats.org/drawingml/2006/main}blip'):
        embed = blip.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed')
        if embed in relid_map:
            blip.set('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed', relid_map[embed])

    # Flip the Reporting Month cell only
    for sh in dst_s2.shapes:
        if sh.has_table:
            for row in sh.table.rows:
                for cell in row.cells:
                    if cell.text.strip() in ("January","February","March","April","May","June",
                                              "July","August","September","October","November","December"):
                        set_cell_text(cell, current_month_name)
```

---

## 15. Test Cases & Acceptance Criteria

For the receiving session to verify the integration end-to-end:

| Test | Pass criteria |
|---|---|
| `POST /api/reports/generate { month:"2026-05" }` | 200 with `pptxUrl` and `pdfUrl`. PPTX has exactly 11 slides. PDF renders without errors. |
| Slide 1 | Cover shows `May 2026` under "GROUP IT REPORT". |
| Slide 2 | Matches the previous month's slide 2 byte-for-byte EXCEPT the Reporting Month cell. |
| Slide 3 | 12 tiles, 3 rows × 4 cols, row-2-col-4 blank. KPI values exactly match `/api/helpdesk/kpis`. Each non-zero delta has a coloured pill in the correct direction. |
| Slide 4 | Chart has 12 monthly bars; last month is highlighted ORANGE. SLA line ends at the most recent month with a value label. FRT and Res tiles populated. |
| Slide 5 | Category bars sort May descending. Channel trend has 13 points, last month annotated. |
| Slide 6 | Ageing bars sorted by total desc. WHY yellow callout has 3 numbered reasons + GREEN engagement footer. CRITICAL pink callout has top 5 sites with breakdown lines. |
| Slide 7 | Donut shows `n=<total>`. Pain/Praise columns have 3 items each. NPS-proxy matches formula. |
| Slide 8 | Donut percentages match `by_type` payload. Emergency callout shows the CHG-ID, subject, status. |
| Slide 9 | N incident boxes (3 ≤ N ≤ 5). Each box shows site · date · title · detail · lessons. Tile counts (P1, P2, Total) match. Subtitle shows `Tracked in <Month> (X new + Y closed)`. |
| Slide 10 | Site Performance bar chart compares prev-vs-current month with site colour palette. RAG stacked bars sum to total counts per pillar. |
| Slide 11 | 4 pillar chips with correct weights and deltas. 5 site cards in score-rank order. General Review has exactly 4 bullets (2 ✓ + 2 ⚠). |
| Aspect ratio | All chart images match their picture-frame aspect within 0.01. No stretch artifacts in the PDF preview. |
| Performance | Full generation < 30s on a single core; < 10s if charts are cached. |
| Idempotency | Calling generate twice for the same month produces byte-identical PPTX (modulo embedded timestamp metadata). |

---

## 16. Known Gotchas (from production runs)

These bit us in real builds. Encode them as tests so they can't regress.

1. **CSAT 0-10 scale bug.** The Zoho `Average Rating` column is on 0-10 (Zoho doubles each 1-5 star). Classifying with thresholds tuned for 1-5 mis-tags 4→Satisfied (actually 2★ Dissatisfied) and silently never matches the 3-star Neutral case. **Fix:** always re-derive CSAT from the raw `Score` column of `Zoho_Survey_Answers`. See §3.5 → `Star Rating (1-5)`.

2. **CSAT aggregator unreliable pre-April 2026.** Of 728 Helpdesk responses Jan–Apr, only ~21% had `Average Rating` populated. Don't trust `Average Rating` historically — re-derive from raw answer Score.

3. **Helpdesk vs ERP scope mixing.** The Zoho workspace has 4 surveys. Only `1140928000001649017` is the active Helpdesk survey. The default aggregation mixes Helpdesk + ERP + dormant UAT, which inflates n and confuses the C-suite. Hard-code the filter on the survey-service endpoint.

4. **MI selection rule = created OR resolved in month.** Filtering only on `created in month` misses important carry-overs:
   - 303918 (Sabodala Feb-MI follow-up): created 26 Apr 2026, closed 19 May 2026 — belongs on May deck.
   - 304487 (Abidjan WiFi/DHCP): created 30 Apr 2026, closed 04 May 2026 — also belongs on May deck.
   The TOTAL tile subtitle should honestly read `"Tracked in <Month> (<new> new + <closed> closed)"`.

5. **FRT SLA not in CSV.** First-Response-Time SLA is computed by the dashboard's proxy against FRT due-by times the SDP CSV doesn't export. **Don't try to fake it from response-vs-create timing** — pull from the dashboard endpoint that already has it.

6. **FCR formula changed.** Old derivation from `FCR Marked` flag → ~18% (wrong; flag rarely set). Correct formula: `100 − reopened%`. Treat the prior values as a method change, not a regression — use the `method Δ` pill on slide 3.

7. **Pillar weighted-mean for Activity Tracker.** Fleet avg is `0.30·NI + 0.35·BP + 0.20·RC + 0.15·PD`, not a simple mean of the 5 sites. The Activity Tracker dashboard does this server-side; preserve those weights in the payload.

8. **Operations group list.** The dashboard's "Operations preset" filters to 13 groups (not the 12 I had in the assistant's hard-coded list). Let the dashboard own the canonical group list and pass it through.

9. **MoM deltas need the previous month's values, not the current minus current.** Cache the prior month's KPI snapshot at generation time so the delta arithmetic doesn't drift if data changes after the fact.

10. **`/api/survey/voice` (or equivalent) exists.** The executive-report.html page uses it to surface pain points. Reuse that endpoint rather than re-aggregating verbatims in the renderer.

11. **Slide 1 banner.** Slide 1 is intentionally banner-free (full-bleed cover). Don't blindly apply the footer to every slide.

12. **`localStorage` does not exist on the server.** The dashboard frontend persists week-picker / preset choices in `localStorage`; the server must take those as request parameters, not infer from a cookie.

13. **Dashboard URL migration.** The legacy dashboard at `http://10.225.99.173:3456` was retired by CHG-273. The new production URL is `https://itops-dashboard.edv-ops.com`. Make all renderer references env-driven, not hard-coded.

---

## 17. Reference Sources Used to Build This Guide

All of the following are real production artefacts; the receiving session can use them as reference implementations:

- `Monthly-Reports/_skill_assets/SKILL.md` — the assistant's working playbook for monthly builds. Contains additional context on slide-2 patcher, KPI Comments rules, and the full SQL fix for Zoho aggregation.
- `Monthly-Reports/April/Group_IT_Operations_Report_April_2026_FINAL_v4.pptx` — golden reference deck (the April build that everything since has been compared against).
- `Monthly-Reports/May/Group_IT_Operations_Report_May_2026.pptx` — most recent build; verify all slides against the May data in §3.
- `Monthly-Reports/April/kpis.json` and `Monthly-Reports/May/kpis.json` (in the generation working directory) — concrete payload examples.

Hand these over together with this guide. The receiving session should be able to scaffold the renderer in 1–2 days and integrate with the existing dashboard endpoints in another 2–3.

---

*End of guide.*
