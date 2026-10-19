---
name: group-it-monthly-report
description: Produces the Endeavour Mining "Group IT Operations" monthly report PPTX for any month. Use this skill whenever the user uploads or references a monthly folder (e.g. April, May, June ...) containing the four canonical CSV/asset files and asks to "produce / build / generate / make" the Group IT Report, the Monthly Operation Report, the Group Deck Operation Report, or the Group IT-OPS deck. The deliverable is an 11-slide branded PPTX in the user's working folder that combines helpdesk, change management, major incidents, and IT Activity Tracker views.
---

# Group IT Monthly Operations Report — Skill

This skill builds the 11-slide Endeavour Mining "Group IT Report" PPTX from the monthly SDP exports plus the IT Activity Tracker. It encodes everything we learned over the April 2026 build so future months can be produced with one prompt.

## Inputs (drop these in `Monthly-Reports/<MonthName>/`)

The folder must be named after the month being reported (`April`, `May`, `June`, ...). Inside, the skill expects exactly:

1. **`Request-all-time.csv`** — full SDP ticket export covering ALL months. The skill filters in-place to the reporting month + Operations groups. (Older naming `Operation_tickets-<Month>-<Year>.csv` is also accepted as a pre-filtered alternative.)
2. **`Request-Major-Incidents.csv`** — SDP export filtered on Request Type = "Major Incident". May include historical incidents; the skill filters on Created Time within the reporting month.
3. **`all-changes.csv`** — SDP "All Changes" export. Filter by Created Time for the reporting month; fields used: `Change Type` (Standard / Major / Emergency), `Status`, `Group`, `Subject`, `Change Description`, `Site`.
4. **`Zoho_Survey_Full_content_GPT.csv`** — Zoho survey aggregation export with response-level CSAT/NPS. Renamed in May 2026 (was `Full_Zoho_Survey_Aggregation_Query_Clde_all-time.csv`). Date format `'05 May, 2026 16:32:52'` (note the comma after the month — use `format='%d %b, %Y %H:%M:%S'`). Dedupe by `r.Response ID`. Columns: `r.Result ID, r.Response ID, r.Survey ID, s.Survey Name, r.Survey Sent on, r.Survey Responded on, r.Overall Score, r.Average Rating, r.NPS, r.Request ID, r.Request Display ID, r.User ID, CSAT Category, NPS Category, Comment, Comment Question, Rating Answer, NPS Answer`. **CRITICAL — `r.Average Rating` is on a 0-10 scale** (Zoho doubles 1-5 stars: 1★=2, 2★=4, 3★=6, 4★=8, 5★=10). The Analytics SQL CASE WHEN statement must use 0-10 thresholds — see "CSAT Classification Bug & Fix" below. The classification stored in the file's `CSAT Category` column may be wrong; **always re-derive locally** using the corrected logic.
5. **`Group IT-OPS_template.pptx`** — original template (kept as fallback reference; the skill rebuilds from scratch using the brand color scheme, NOT by editing this template).
6. **`EM Banner 1.jpg`** — bottom banner artwork (full-width).
7. **`left_corner.png`** — bottom-right corner accent (slide number is overlaid as editable text).
8. `IT_Ops_Strategy_<MonYear>.pptx` (optional) — when the user clicks "Generate 3-Slide PPTX" in the Activity Tracker (`https://itops-dashboard.edv-ops.com/activity-tracker.html` → Export → period = target month → 5 active sites checked), the export downloads as a 3-slide PPTX. Either embed full-bleed (height 7.18") OR rebuild from scratch using the chart-data scrape (preferred — see below).

If any input is missing, ask the user via `AskUserQuestion` rather than guessing.

## Output

`Monthly-Reports/<MonthName>/Group_IT_Operations_Report_<MonthName>_<Year>.pptx` — 16:9 widescreen, 11 slides.

## Slide Map

| # | Title | Content |
|---|---|---|
| 1 | GROUP IT REPORT — `<Month> <Year>` | **Original Endeavour template cover** (Africa-shaped photo cutout, orange left, LSE/TSX/OTCQX footer). Title + period + branding only — no data |
| 2 | 5. Operations: Summary | **Original Endeavour template** (Mohamed photo + Goal banner + 3-column Progress / Issues+Risks / Activities for next period + Strategic KPIs table + Legend). All template visuals preserved; data + meeting-note follow-ups populated for the reporting month |
| 3 | Helpdesk Executive Overview — At a Glance | 12 KPI tiles, each with a **MoM delta pill** in the top-right corner (light-bg palette); bottom commentary band. **No separate light "At a Glance" stats cover** between slides 2 and 3 — this slide already serves that role |
| 4 | Helpdesk 12-Month Trend | Volume bar chart (Inbound vs Closed), **FRT SLA + Res. SLA tiles side-by-side**, SLA Compliance line chart |
| 5 | Distribution & Channel | Category bars (Apr vs Mar) + **E-Mail vs Web Form trend line** with April highlighted, two channel-pct tiles below |
| 6 | SLA & Ageing | Open Ticket Ageing by Group, "Why blocked" panel, Critical Ageing top sites |
| 7 | CSAT & Voice | Survey donut, CSAT/NPS cards, Top Pain Points |
| 8 | Change Management | Donut by type, 6 KPI tiles, **Emergency change description box** (CHG-ID, site, subject, status), bottom commentary |
| 9 | Major Incidents | P1/P2/Total tiles, per-incident detail boxes (badge + site + subject + detail + lessons) |
| 10 | IT Ops Strategy Roadmap | Full-bleed embed of `refs_hi-1.jpg` from the Activity Tracker export |
| 11 | Site Summaries | Full-bleed embed of `refs_hi-2.jpg` from the Activity Tracker export |

Slides 2–11 carry the **EM Banner 1** at the bottom and the **left_corner accent with the slide number** in the bottom-right (slide 1 is intentionally banner-free).

## Brand Palette (do not improvise)

```
ORANGE   #E87722    NAVY     #1A3A5F    DARK_NAVY #0E2B4F
BLUE     #2E5C8A    GREEN    #2E8540    AMBER     #F59E0B
RED      #DC2626    GRAY     #6B7280    WHITE     #FFFFFF
```

Delta pills:
- **Light backgrounds** (slide 3 tiles): light-green/red/gray pill bg with bold dark text.
- **Dark backgrounds** (slide 1 cover panel): deep-green/maroon/navy pill bg with light text. The helper `delta_pill(slide, x, y, text, kind=, dark_bg=)` handles both.

Direction-of-good per metric:
| Metric | Good = | Notes |
|---|---|---|
| Total Tickets | neutral | volume swing, mark `neutral` |
| Closed / Closure rate | up | fewer closures = `bad` |
| SLA Compliance, FRT SLA, FCR | up | |
| Open Backlog, Avg Resolution, SLA Violations | down | |
| Major Incidents, Emergency Changes | down | |
| Support Groups | up/neutral | |
| FCR Rate vs old template | use `method Δ` neutral pill — old "94.9%" was a different definition |

## Delivery Rule — verify the destination file actually updated

After every edit, the working copy in `/outputs/Group_IT_Operations_Report_<Month>_<Year>_FINAL.pptx` MUST be copied to `Monthly-Reports/<Month>/Group_IT_Operations_Report_<Month>_<Year>_FINAL.pptx` AND the destination's modification timestamp must be verified to have updated. The user only sees their workspace folder — the /outputs copy is invisible to them. Forgetting the final copy step results in the user opening a stale deck even though my preview screenshots show correct content.

Always run after every save:
```
cp /outputs/.../FINAL.pptx /Monthly-Reports/<Month>/.../FINAL.pptx
ls -la /Monthly-Reports/<Month>/.../FINAL.pptx     # confirm fresh timestamp
sha1sum /outputs/.../FINAL.pptx /Monthly-Reports/<Month>/.../FINAL.pptx   # confirm content match
```

## Cardinal Rule — ALWAYS refresh data, NEVER hard-code from prior months

**The deck design and slide schema stay the same; the data and narratives are re-derived every single time.** Do not copy any number, percentage, mention count, ticket title, incident description, change description, theme label, or commentary phrase from a previous month's output. Every value on every slide must trace back to a fresh ingest of the current month's source files (CSVs + meeting-notes DOCX + live dashboard scrape + survey free-text). If a value can't be derived from data, flag it explicitly to the user — don't fall back to a placeholder.

**Examples of what this rule means in practice:**
- Slide 1 cover: month/year from the folder name, NEVER hard-coded.
- Slide 2 narrative bullets (Progress / Issues+Risks / Activities): re-derived from this-month CSV deltas + meeting-notes themes — even single phrases like "MTN Lafigué link" or "Toolbox Meetings rolled out" must originate from the current docx, not a prior month's slide.
- Slide 3 KPI tiles + delta pills: each tile's value AND its MoM-delta direction recomputed from current vs prior-month KPI snapshot.
- Slide 4-6 charts: regenerated with current numbers; trend series should include prior 11 months from a real history file (or be explicitly noted as illustrative).
- **Slide 7 pain points: derive top-3 themes from the actual survey CSV's `Answer Text` + `Answer Comment` columns** — see "Pain-Points Routine" below. Never reuse the previous month's themes or counts.
- Slide 8 Emergency-change box: subject + site + status + description from the current `all-changes.csv`, never reused.
- Slide 9 incident detail boxes: each one rebuilt from the current `Request-Major-Incidents.csv` (1–N boxes; box height auto-adjusts).
- Slide 10/11: scraped fresh from `https://itops-dashboard.edv-ops.com/activity-tracker.html` for the target month.
- All commentary bands at the bottom of each slide: paragraphs re-written from the current numbers.

## Slide-2 Authoring Rules (locked May 2026 by user)

Slide 2 keeps the **original Endeavour template layout verbatim** — Mohamed's photo, the title "5. Operations: Summary", the Goal banner, the Legend at the bottom, the table structure. The patcher only updates the data cells:

| Cell / Section | Rule | Source |
|---|---|---|
| Title "5. Operations: Summary" | **CONSTANT** | Template |
| Mohamed Diagne — name, role, photo | **CONSTANT** | Template |
| Reporting Month | Month name only (e.g. "April") | Folder name |
| Financial Year | Year only (e.g. "2026") | Constant per fiscal year |
| Headcount (inc Contract) | Manual | Mohamed (annual) |
| **Project Health pills** (Overall Status / Schedule / Risk / Budget / Resource) | **MANUAL — leave at prior deck's values** | Mohamed sets each month |
| Goal banner text | **CONSTANT** | Template |
| **Progress since last period** | **DATA-DERIVED** | Helpdesk KPIs + meeting-notes themes (Toolbox / Tooling rollouts) + Change-governance summary |
| **Issues / Risks / Comment** | **DATA-DERIVED** | Major Incidents list + meeting-notes vendor issues (MTN/Orange/Acronis/fiber) + FRT/SLA gap + Open Backlog top sites + recurring-incident themes + recruitment |
| **Activities for next period** | **DATA-DERIVED — option (c)** | Keep 5 fixed strategic theme NAMES (4MP V2 Launch & Adoption / Operational Reporting / IT Governance / Audit & Compliance / Workforce Planning); replace each `:<description>` with a 1-sentence current-month status pulled from the meeting-notes follow-up tasks |
| KPIs table — 4 deliverable names | **CONSTANT** (Strategic IT Roadmap / Control Framework Transfer / Skills Matrix APPS Adoption / Infrastructure Standardization Oversight) | Template |
| KPIs table — Owner / End date | **CONSTANT** (Mohamed / H1- or H2-Year) | Template |
| **KPIs table — RAG dot color** | **MANUAL — leave at prior deck's value** | Mohamed sets each month |
| **KPIs table — Comments column** | **CARRY-FORWARD + DELTA — option (i)** | Read each cell's existing text from prior month's deck → append `" <Month>: <one data-derived sentence about current progress>"` → Mohamed edits as needed |
| Legend (G/A/R squares + labels) | **CONSTANT** | Template |

**Patcher implementation notes:**
- Don't call `cell.text_frame.text = ...` directly — it strips font formatting. Instead update each existing run's `.text` attribute, preserving font size / color / bold.
- For previously-empty cells (e.g. the Infrastructure Standardization Comments was blank in the template), copy paragraph formatting from a populated sibling cell (e.g. Skills Matrix Comments) before writing the new text.
- See `_skill_assets/slide_2_patcher.py` for the full reference implementation.

**Workflow each month:**
1. Start from a copy of the previous month's delivered deck (carries forward template visuals + KPI Comments + RAG dots + Project Health pills).
2. Run the slide-2 patcher with current-month KPIs + meeting-notes follow-ups → updates Reporting Month, Progress, Issues, Activities, and appends new delta sentences to KPI Comments.
3. Open in PowerPoint; Mohamed reviews and edits Project Health pills, KPI RAG dots, and any KPI Comment phrasing.

## Slide-3 KPI Tiles (locked May 2026)

Slide 3 carries an **11-tile** grid (3 rows × 4 cols, with row 2 col 4 intentionally blank):

| Row | Cols | Tiles |
|---|---|---|
| 1 | 4 | TOTAL TICKETS · CLOSED TICKETS · SLA COMPLIANCE (Res) · OPEN BACKLOG |
| 2 | 3 | FCR RATE · FRT SLA · AVG RESOLUTION · *(blank)* |
| 3 | 4 | CHANGES (NEW) · EMERGENCY CHANGES · MAJOR INCIDENTS · SUPPORT GROUPS |

**SLA VIOLATIONS tile was removed in May 2026** — the value duplicated `100 - SLA Compliance` and was redundant for executives. Do NOT reintroduce it.

**FCR Rate formula (corrected May 2026):**
```
FCR Rate = 100% − (count(ReOpened == 'Yes') / total tickets × 100)
```
The previous derivation from the `FCR Marked` column produced ~18% (wrong — that flag is rarely set in SDP). The new formula treats FCR as the proportion of tickets that were resolved without ever being reopened, which matches the dashboard's historical pattern (≈95-99%) and aligns with the executive-report skill. Apply this formula when generating `kpis.json`:
```python
fcr_rate = round(100 - ((ops['ReOpened']=='Yes').sum())/len(ops)*100, 1)
```

The FCR tile uses the GREEN accent + green delta pill (FCR is a "higher is better" metric).

## Zoho Survey Schema — verified May 2026

**4 surveys exist; only one is the active Helpdesk feed:**

| Survey ID | Name | Volume | Active for Helpdesk? |
|---|---|---|---|
| 1140928000000006001 | EDV Self-Service Portal UAT | 2 responses | No — dormant |
| 1140928000000107033 | Endeavour Mining One IT Support Survey (legacy) | 771 | No — superseded |
| **1140928000001649017** | **Endeavour Mining One IT Support Survey (ACTIVE)** | **1,936** | **YES — this is the one to read for Helpdesk CSAT** |
| 1140928000003457009 | ERP Customer Satisfaction | 177 | Different scope (ERP, not Helpdesk) |

**Question types in use (13 questions across all 4 surveys):**
- `star_rating` — 2 questions (Helpdesk legacy + active CSAT). Score 1-5 stars; **Zoho doubles into Avg Rating 0-10**.
- `likert_rating` — 1 question (ERP). Score 1-5; same doubling rule.
- `single_choice` — 7 questions (UAT only, dormant). Scores 1-5 mapping. **Includes one "recommend" question, but tagged as single_choice, NOT nps** — so Zoho doesn't aggregate it into `r."NPS"`.
- `textarea` — 3 questions (all Helpdesk + ERP). Free-text comments — these are what feed slide 7's Pain Points + Praise.
- `single_drop_down` — 1 question (ERP "Was it easy to contact us?"). Binary 0/100.
- **`nps` — 0 questions.** No survey uses this type. **This is why `r."NPS"` is always NULL — the survey form simply doesn't ask the question with the right type.**

**To enable Real NPS measurement** (locked-in recommendation, not speculation):
1. Open the active Helpdesk Survey form (Survey ID `1140928000001649017`) in Zoho.
2. Add a new question: **"How likely are you to recommend our IT support to a colleague? (0-10)"**.
3. Set Question **Type = `nps`** (critical — NOT star_rating, NOT single_choice).
4. Save and publish. New responses will populate `r."NPS"` 0-10.
5. The existing NPS-Category SQL CASE block (Promoter ≥9 / Passive 7-8 / Detractor 0-6) starts working automatically — no SQL change needed.

**Verified from raw tables:**
- `Zoho_Surveys.csv` (4 rows) — all 4 active survey IDs above
- `Zoho_Survey_Questions.csv` (13 rows) — question catalogue, no `nps` type
- `Zoho_Survey_Answers.csv` (5,188 rows) — all per-question scores; star_rating scores are 1-5 confirming doubling
- `Zoho_Survey_Results.csv` (2,886 rows) — `NPS` column NULL for every row across every survey
- `Zoho_Survey_Custom_Variable.csv` (2,886 rows) — only carries `result_id` mapping, no extra signal

These 5 raw tables should be re-exported and dropped in `Monthly-Reports/<Month>/` whenever the survey schema is in question. The aggregated `Zoho_Survey_Full_content_GPT.csv` is enough for monthly KPIs but doesn't reveal the form-level configuration.

## Canonical Analytics Plus Query (May 2026 — locked-in)

The corrected, parser-clean SQL query that produces `Zoho_Survey_Full_content_GPT.csv` is now saved in Analytics Plus. **Source-of-truth: re-export from this saved query whenever new survey data is needed.** Do NOT hand-edit the CSV; re-run the query so the typo fix, scale correction, and Helpdesk-only filter all stay locked in:

```sql
SELECT
    r."Result ID", r."Response ID", r."Survey ID", s."Survey Name",
    r."Survey Sent on", r."Survey Responded on",
    r."Overall Score", r."Total Rating", r."Average Rating",
    r."Request ID", r."Request Display ID",
    MAX(CASE WHEN q."Type" = 'star_rating' THEN a."Score" END) AS "Star Rating (1-5)",
    CASE
        WHEN MAX(CASE WHEN q."Type" = 'star_rating' THEN a."Score" END) >= 4    THEN 'Satisfied'
        WHEN MAX(CASE WHEN q."Type" = 'star_rating' THEN a."Score" END) = 3     THEN 'Neutral'
        WHEN MAX(CASE WHEN q."Type" = 'star_rating' THEN a."Score" END) IN (1,2) THEN 'Dissatisfied'
        ELSE 'No Rating'
    END AS "CSAT Class",
    MAX(CASE WHEN q."Type" = 'textarea' THEN a."Text" END) AS "Voice Comment"
FROM "Zoho Survey Results" r
LEFT JOIN "Zoho Surveys"          s ON r."Survey ID"  = s."Survey ID"
LEFT JOIN "Zoho Survey Answers"   a ON r."Result ID"  = a."Result ID"
LEFT JOIN "Zoho Survey Questions" q ON a."Question ID" = q."Question ID"
WHERE r."Survey ID" = '1140928000001649017'
GROUP BY r."Result ID", r."Response ID", r."Survey ID", s."Survey Name",
         r."Survey Sent on", r."Survey Responded on",
         r."Overall Score", r."Total Rating", r."Average Rating",
         r."Request ID", r."Request Display ID"
ORDER BY r."Survey Responded on" DESC;
```

Why this version is the canonical one:
- **Flat — no subquery wrapper** (Analytics Plus parser rejects `subquery_alias."col"` references with "Invalid column" error).
- **Helpdesk-only filter at SQL level** (`Survey ID = '1140928000001649017'`). Slide 7 doesn't need any further filtering.
- **CSAT classification at SQL level** using raw `a."Score"` (1-5 scale) — bypasses both the `Average Rating` 0-10 mismatch AND the pre-April aggregator unreliability in one stroke.
- **No Custom Variable join** — that table is long/key-value with only `result_id` as label, so it adds no useful columns; `Request ID` / `Request Display ID` on Survey Results are the SDP link.
- **Question-type literals confirmed** from `Zoho_Survey_Questions.csv`: rating = `'star_rating'`, comment = `'textarea'`.

**Export quirk — column-name prefixes.** Analytics Plus's CSV export prefixes table-aliased columns with `r.` and `s.` (e.g. `r.Result ID`, `s.Survey Name`). The build script must strip these on load:

```python
df = pd.read_csv("Zoho_Survey_Full_content_GPT.csv")
df.columns = [c.replace("r.", "").replace("s.", "") for c in df.columns]
```

The `Star Rating (1-5)`, `CSAT Class`, and `Voice Comment` columns come through un-prefixed (no alias in source) — only the `r.*` / `s.*` ones need stripping.

## CSAT Pipeline — Two-Layer Bug (May 2026, fully diagnosed)

The CSAT data pipeline has TWO independent issues that must both be fixed:

**Layer 1 — `r."Average Rating"` aggregator was unreliable before April 2026.**
Across the 728 Helpdesk responses Jan-Apr 2026, only 153 (21%) have `Average Rating` populated despite 712 having an actual `star_rating` answer Score in `Zoho_Survey_Answers`. The aggregator started populating reliably only in April. **Trusting `Average Rating` makes Jan/Feb/Mar look like CSAT was "not measured" when in fact users WERE rating — Zoho just wasn't aggregating.**

**Layer 2 — CSAT classification thresholds tuned for the wrong scale.** Even when `Average Rating` IS populated, it's on a 0-10 scale (Zoho doubles 1-5 stars), not 1-5. So the original SQL `WHEN >= 4` mis-classifies 4 (=2★ Dissat) and 6 (=3★ Neutral) as Satisfied; the `=3 → Neutral` branch never fires because Average Rating is always even.

**The robust fix — derive CSAT from raw `Zoho_Survey_Answers.Score` directly (1-5 scale, no doubling):**

| Score | Stars | CSAT Category |
|---|---|---|
| 0 | (skipped/no answer) | **No Rating** |
| 1 | 1★ | **Dissatisfied** |
| 2 | 2★ | **Dissatisfied** |
| 3 | 3★ | **Neutral** |
| 4 | 4★ | **Satisfied** |
| 5 | 5★ | **Satisfied** |

Apply by joining `Zoho_Survey_Answers` to `Zoho_Survey_Questions` on `Question ID` and filtering `q."Type" IN ('star_rating','likert_rating')`. The full corrected SQL lives in the engagement Excel **SQL Fix** tab.

**Always do this in pandas before reporting:**
```python
def csat_from_score(s):
    if pd.isna(s) or s == 0: return 'No Rating'
    if s >= 4: return 'Satisfied'
    if s == 3: return 'Neutral'
    if 1 <= s <= 2: return 'Dissatisfied'
    return 'No Rating'
# Join answers (Question ID = active Helpdesk CSAT q) to results, filter by month, then categorize.
```

**Verified Helpdesk-only Jan-Apr 2026 CSAT (rated-only %):**
- Jan: 89.7% (175/195 rated · 11 dissat · 9 neutral)
- Feb: 91.2% (135/148 rated · 4 dissat · 9 neutral)
- Mar: 91.7% (165/180 rated · 5 dissat · 10 neutral)
- Apr: **87.2%** (130/149 rated · 12 dissat · 7 neutral) — **April is the lowest of the 4 months**, not the first reading

**Slide 7 must be Helpdesk-only.** The Aggregated `Zoho_Survey_Full_content_GPT.csv` mixes Helpdesk (1140928000001649017) + ERP (1140928000003457009). For the IT Operations report, filter to the active Helpdesk Survey ID — that's the audience.

## CSAT Classification Bug & Fix (May 2026)

**Discovery (May 2026):** The Analytics-Plus SQL classifies `r."Average Rating"` as if it were on a 1-5 scale, but the column is actually on a **0-10 scale** (Zoho doubles each 1-5 star into a 0-10 score; observed values are 2, 4, 6, 8, 10).

The original (buggy) SQL CASE block:
```sql
CASE
  WHEN r."Average Rating" >= 4 THEN 'Satisfied'
  WHEN r."Average Rating" = 3 THEN 'Neutral'
  WHEN r."Average Rating" < 3 AND r."Average Rating" IS NOT NULL THEN 'Dissatisfied'
  ELSE 'No Rating'
END
```

Wrongly catches:
- Avg Rating = 4 (real value = 2★ Dissatisfied) → mis-tagged Satisfied
- Avg Rating = 6 (real value = 3★ Neutral) → mis-tagged Satisfied
- Avg Rating = 3 → never matches (Avg Rating is always even on this scale, so the Neutral bucket never fires)

**Corrected SQL CASE block:**
```sql
CASE
  WHEN r."Average Rating" >= 8 THEN 'Satisfied'        -- 4★ or 5★
  WHEN r."Average Rating" = 6  THEN 'Neutral'          -- 3★
  WHEN r."Average Rating" < 6
   AND r."Average Rating" IS NOT NULL THEN 'Dissatisfied'  -- 1★ or 2★
  ELSE 'No Rating'
END AS "CSAT Category"
```

**Range-based alternative** (more robust if surveys have multiple rating questions producing odd-value averages):
```sql
CASE
  WHEN r."Average Rating" >= 8 THEN 'Satisfied'
  WHEN r."Average Rating" >= 5 AND r."Average Rating" < 8 THEN 'Neutral'
  WHEN r."Average Rating" < 5
   AND r."Average Rating" IS NOT NULL THEN 'Dissatisfied'
  ELSE 'No Rating'
END AS "CSAT Category"
```

**Exec-slide language guardrails:**
- Do NOT print phrases like "CSAT corrected for 0-10 scale" or "Avg Rating mis-classified" on slides. That kind of internal data-quality history is for the engagement Excel / SQL Fix tab / SKILL.md — not for the executive deck. The deck just shows the corrected number; how we got there stays internal.
- Do NOT claim "Real NPS not measured — add a 0-10 recommend question to the form" without first inspecting `Zoho Survey Questions`. The fact that `r."NPS"` is always NULL has at least three possible causes: (a) no recommend question in any survey form, (b) the question exists but isn't tagged `Type='nps'` so Zoho doesn't aggregate it, (c) data-pipeline issue. Until the Questions table is inspected, soften the slide to "Real NPS not currently captured — investigation underway with Analytics team to confirm whether a recommend question is needed or already in scope."

**Until the Analytics admin applies the fix**, ALWAYS re-derive CSAT locally in pandas — never trust the file's `CSAT Category` column:
```python
def csat_corrected(r):
    if pd.isna(r): return 'No Rating'
    if r >= 8: return 'Satisfied'   # 4★ or 5★
    if r == 6: return 'Neutral'     # 3★
    if r < 6:  return 'Dissatisfied'# 1★ or 2★
    return 'No Rating'
sv['CSAT Corrected'] = sv['r.Average Rating'].apply(csat_corrected)
```

**Impact on April 2026** (211 responses):
- Buggy SQL:    191 Satisfied / 0 Neutral / 17 Dissatisfied / 12 No Rating → CSAT 90.5%
- Corrected:    177 Satisfied / **9 Neutral** / 13 Dissatisfied / 12 No Rating → CSAT **83.9%** (-6.6pp)

The 9 hidden Neutrals (3★ ratings) are now visible — they're the prime audience for next-tier improvements.

**Slide 7 must use 4 donut slices** (Satisfied / Neutral / Dissatisfied / No Rating) and the corrected CSAT% headline. Caption format: `"April survey · {N} responses · {satisfied} satisfied · {neutral} neutral"`.

## Slide 7 Layout (locked May 2026)

Slide 7 has a 4-block right-column layout:

```
┌─────────────────┐  ┌─────────┬─────────┬─────────┐
│                 │  │ CSAT %  │ Avg Sc. │ NPS-Pxy │   (3 KPI tiles, narrow + short)
│  Survey Donut   │  └─────────┴─────────┴─────────┘
│  (4 slices)     │  ┌──────────────┬──────────────┐
│  Sat / Neutral  │  │ TOP PAIN     │ TOP PRAISE   │   (Pain | Praise side-by-side)
│  Dissat / NoR   │  │ POINTS       │ (verbatim    │
│  with legend    │  │ (verbatim    │  themes from │
│                 │  │  themes from │  Satisfied)  │
│                 │  │  Dissat)     │              │
└─────────────────┘  └──────────────┴──────────────┘
[Bottom commentary band]
```

The 3 tiles use the COMPACT spec (h=1.5", w=2.55" each, value font 32pt). Pain + Praise blocks are 2.85" tall, side by side. Slide 7's third tile is the **NPS-Proxy** (replaces the older Avg-Score-only design once a Praise block is needed; both can coexist when the layout has room).

**Slide 7 NPS-Proxy tile** — Formula:
```
NPS-Proxy (rated-only) = (Satisfied − Dissatisfied) / (Total − No Rating) × 100
```
Use the **rated-only** denominator — it isolates voters from non-voters and is the more honest framing. Always label as **"NPS-PROXY (CSAT-derived)"** with a sub-line `"Real NPS not measured — no recommend question"`. This is NOT real NPS; real NPS would require a 0-10 "How likely to recommend" question to be added to the Zoho form.

April 2026 reference values (corrected logic, rated-only):
- 4-month range: +0 (Jan/Feb) → +50 (Mar) → **+82 (Apr)** — strong upward signal in rated-only proxy as the survey form's CSAT classification became active.

For an alternative all-respondents framing (lower number, dilutes by including No-Rating voters): `(Sat − Dissat)/Total × 100` — Apr = +77.7. Show both in the engagement Excel; show only rated-only on slide 7 (cleaner exec read).

## Praise-Points Routine (slide 7 right block, mirror of Pain Points)

Same pipeline as the Pain-Points routine but **inverted scope** to surface positive themes:

1. Filter survey CSV to current month + **Satisfied** (CSAT_C='Satisfied' under corrected logic).
2. Pull `Comment` and `Answer Text` substantive free-text. Filter trivial tokens. Dedupe.
3. Categorize via these positive-keyword theme regexes:
   - **Helpful / Supportive Team** — `\bhelp`, `support`, `appreci`, `thank`, `merci`, `reliable`, `team`, named persons (David, Jean Marc, Carlos, etc.)
   - **Speed / Responsiveness** — `rapide`, `quick`, `prompt`, `fast`, `réactivité`, `timely`, `immediately`
   - **Effective Resolution** — `résolv`, `resolved`, `fixed`, `effica`, `properly`, `completed`, `réglé`, `nailed`, `sorted`
   - **Excellent / High Quality** — `excellent`, `fantastic`, `formidable`, `great`, `good job`, `appreciated`
   - Anything else → **Other Positive**
4. Rank by count, take top 3.
5. Render in the right-column "TOP PRAISE" block: number badge + theme + "(N mentions) — first verbatim quote ≤ 90 chars". All badges GREEN.
6. Caption: `"April · {N} satisfied verbatim comments analysed"` where {N} = total substantive comments.

April 2026 reference: 51 substantive comments, top 3 = Helpful/Supportive 15 · Excellent/Quality 12 · Speed 12.

## Pain-Points Routine (slide 7)

Drop the placeholder approach. Every month, do this:

1. Load `Full_Zoho_Survey_Aggregation_Query_Clde_all-time.csv`.
2. Filter by `zr.Survey Responded on` to the reporting month (date format `'%d %b, %Y %H:%M:%S'`).
3. Subset to **Dissatisfied / Very Dissatisfied** responses (`CSAT Category`).
4. Pull substantive free-text from `Answer Text` and `Answer Comment` columns. Filter out trivial tokens (numeric ratings 1-5; "Yes/No/RAS/OK/Excellent"; strings shorter than 5 chars). Dedupe.
5. Categorize via keyword regex into 5 canonical themes (extend if new themes emerge):
   - **Long-running / Unresolved** — keywords: pending, not resolved, three months, toujours pas, haven't received, etc.
   - **No Solution / Persistent Issue** — persiste, every time, pas de solution
   - **Communication / Proof of Action** — no indication, proof, feedback, directed us
   - **Equipment / Hardware Delivery** — adapter, laptop replace, my data, données
   - **Access / Account / Password** — password, access, compte, accès
   - Anything that doesn't match → **Generic Dissatisfaction**
6. Rank themes by mention count (descending). Take top 3.
7. Render slide 7's "Top Pain Points" with **theme name + "(N mentions) — first verbatim quote (≤ 90 chars)"** for each. Caption above the list reads `TOP PAIN POINTS (April survey · {N} dissatisfied responses analysed)` — `{N}` is the actual unique-Dissatisfied count for the month.

The function `_derive_pain_points()` in `build_group_it_report.py` does this end-to-end. **Never short-circuit it with a hard-coded list.**

## Update Routine (when files are refreshed mid-cycle)

Whenever the user says **"the files have been updated"**, **"new data uploaded"**, **"refresh the report"**, or drops new CSV/DOCX inputs into `Monthly-Reports/<Month>/`, run this full refresh routine — do NOT just regenerate the slides that obviously change. The whole deck must be re-derived from the new data because content lives across many slides.

**Routine — execute every time:**

1. **Re-ingest every source file** that exists in the folder, in this order:
   - `Request-all-time.csv` (or `Operation_tickets-<Month>-<Year>.csv` if pre-filtered) → re-filter to the reporting month + Operations groups → recompute Total / Closed / Closure rate / Open backlog / Avg-resolution / FCR / FRT / per-group breakdown / category breakdown / channel mix / **per-group ageing buckets**.
   - `Request-Major-Incidents.csv` → filter on Created Time within the reporting month → list all incidents (subject, site, priority, status). **A new incident often appears on a refresh** (April was 2→3); always re-derive `mi_total`, `mi_critical`, `mi_high` and re-write slide 9's incident detail boxes.
   - `all-changes.csv` → filter to the month → recompute counts by Change Type and Status → **always re-extract the Emergency change description** (subject, site, group, priority, change description).
   - `Full_Zoho_Survey_Aggregation_Query_Clde_all-time.csv` → filter to the month, dedupe by `zr.Response ID` → CSAT counts, avg overall score, NPS (or "not measured" if all rows are `No NPS`).
   - **Meeting-notes DOCX** (e.g. `Generated by AI_April_2026_meeting_notes.docx`) → read with `python-docx`, scan for: new vendor/operational issues (MTN/Orange links, Acronis VMs, fiber cuts), new tooling rollouts (toolbox meetings, CSV-import dashboards), and any recurring-incident themes. **Surface these on slide 2 Issues/Risks/Comments** alongside the data-derived items.

2. **Cross-check against the live dashboard**:
   - Open `https://itops-dashboard.edv-ops.com/index.html`, switch to Monthly view, set Period = target month, click the **Operations** preset. Confirm Inbound / Closed / Resolution-SLA / FRT / Time-to-Assign / First-Reply / Resolution-Time / Closing-Time / Open-ageing-count match the CSV-derived KPIs. The dashboard is the source of truth — if it disagrees, use its values (it pulls fresher data via proxy and recomputes breach from raw `Resolved Time > Due By Time`).
   - Open `https://itops-dashboard.edv-ops.com/activity-tracker.html`, switch Period to the target month, scrape the Chart.instances data for the strategy roadmap and site summaries (slides 10-11). Click Export → "Generate 3-Slide PPTX" if a fresh export PPTX is needed.

3. **Refresh ALL slides that depend on the changed data** — do not skip any:
   - Slide 1 (cover): big stats + MoM delta pills (vs prior month).
   - Slide 2 (Operations Summary): **Progress column** + **Issues / Risks / Comments column** — both must reflect current numbers AND meeting-note follow-ups (vendor issues, recurring-incident themes, new tooling, recruitment status). The Strategic-KPIs table at the bottom rarely changes mid-month but verify owner/end-date/RAG/comments are still correct.
   - Slide 3 (Executive Overview): all 12 KPI tiles + their MoM delta pills + bottom commentary.
   - Slide 4 (12-Month Trend): regenerate the volume bar chart and SLA line chart with the new April values; update FRT/Res SLA tiles and commentary.
   - Slide 5 (Distribution & Channel): regenerate the category bars and the E-Mail/Web Form trend line; update channel-percentage tiles.
   - Slide 6 (SLA & Ageing): regenerate the per-group ageing chart; update top-sites panel and bottom commentary with current backlog counts.
   - Slide 7 (CSAT & Voice): use real survey numbers — if the new month's responses contain `No NPS`, switch the second tile from "NPS" to "Avg Survey Score" and note that NPS questions weren't included. Pain-points list can be inferred from dissatisfied-rated tickets or kept as a representative sample.
   - Slide 8 (Change Management): donut + 6 KPI tiles + Emergency-change description box + bottom commentary.
   - Slide 9 (Major Incidents): one detail box per incident (badge color = Critical RED / High AMBER / Normal BLUE). When the list grows past 2 items, shrink box height to 1.0" and gap to 0.10" so 3 boxes fit cleanly above the commentary band. Update the bottom commentary to reflect the new count.
   - Slide 10 (Strategy Roadmap): big stat cards (Green/Amber/Red counts, Avg Score, MoM Δ) + Site Performance bar chart (Apr vs Mar) + RAG Distribution by Pillar.
   - Slide 11 (Site Summaries): pillar-delta header strip + 5 site cards (score, MoM Δ, G/A/R counts, site notes citing the newly-RED / newly-GREEN items from the tracker commentary) + General Review bullets.

4. **Verify visually** — render the whole deck, read each slide image, fix any clipping/overlap before delivering.

5. **Deliver and clean up** — drop the new PPTX in `Monthly-Reports/<Month>/`, remove all `rs*.jpg` / `_check*.jpg` preview files. Update the `_skill_assets/build_group_it_report.py` so subsequent re-runs reproduce the same deck.

**Trigger phrases to recognize for the routine:** "the files have been updated", "I have uploaded the following", "new data", "refresh the report", "redo with the new files", "tickets have been updated", "please update for <Month>". Do NOT just regenerate the obviously-affected slides — slide 2's Issues/Risks/Comments and the meeting-note follow-ups are the easiest to forget.

## Step-by-Step Process

1. **Ingest** the folder — list it; confirm the four core files are present.
2. **Compute KPIs** with `pandas` and write to `kpis.json`:
   - Filter `Operation_tickets` to the reporting month (it should already be) and compute: total, closed, closure_rate, open_backlog (`not in ['Closed','Cancelled']`), `sla_compliance` from `Overdue Status` (`No / (No+Yes)`), `frt_sla` from `First Response Overdue Status`, `fcr_rate` from `FCR Marked`, `avg_res_days` from Created→Resolved, channel mix from `Mode`, category mix, group counts, ageing buckets.
   - Filter `Major-Incidents` by `Created Time` month → `mi_total`, `mi_critical` (`Priority='Critical'`), `mi_high` (`Priority='High'`).
   - Filter `all-changes.csv` by `Created Time` month → `changes_total`, `changes_type` dict, `changes_status` dict, plus the **Emergency change details** (subject, site, group, priority, description) — surface as `emergency_change_description` for slide 8.
3. **Generate charts** (matplotlib, brand colors) into `charts/`:
   - `c1_volume_trend.png` — 12-month inbound vs closed bar chart (April highlighted in orange).
   - `c2_sla_trend.png` — 12-month Res. SLA + FRT SLA line chart with 90% target line.
   - `c3_categories.png` — top categories Apr vs Mar horizontal bars.
   - `c4b_channel_trend.png` — **line chart**: E-Mail % vs Web Form % over 12 months with bold callout pills on the April points (this is what the user explicitly asked for — replaces the older `c4_channel.png` bar chart).
   - `c5_ageing.png` — Open Ticket Ageing by Group, stacked horizontal bars.
   - `c6_changes_donut.png` — donut by Change Type.
   - `c7_survey.png` — survey responses donut (placeholder until April Zoho survey is exported).
4. **Activity-Tracker exports for slides 10/11**: ask the user to either upload `IT_Ops_Strategy_<Month><Year>.pptx` or open Claude in Chrome at `https://itops-dashboard.edv-ops.com/activity-tracker.html`, switch the Period dropdown to the target month, and let the skill scrape the chart data via `Chart.instances` JS. If a PPTX is provided, export it to PDF, render at 200 DPI, and embed as `refs_hi-1.jpg` / `refs_hi-2.jpg`.
5. **Build the PPTX** by running `build_group_it_report.py`. The script is idempotent: same inputs always produce the same deck. It uses helper functions `add_rect`, `add_text`, `add_multi_text`, `header_band`, `footer_bar`, `kpi_tile`, `delta_pill`, `cover_stat`.
6. **Verify visually**: convert to PDF with `soffice`, render slides at 100 DPI with `pdftoppm`, read each slide image, fix any clipping or overlap before delivering.
7. **Deliver** the final PPTX into `Monthly-Reports/<MonthName>/Group_IT_Operations_Report_<MonthName>_<Year>.pptx` and emit a `[View …](computer://…)` link.
8. **Clean up** intermediate render images (`rs*.jpg`, `rslide*.jpg`, `refs-*.jpg`) so the folder retains only the inputs + the final PPTX. Use `mcp__cowork__allow_cowork_file_delete` first if rm fails.

## Footer Layout (canonical — locked in by user adjustment)

The bottom-of-slide layout was tuned by the user on the April 2026 slide 3 and is now the default for every body slide (2 – 11). All three elements live on the **background z-order** (inserted at `spTree[2]`):

| Element | x (in) | y (in) | width (in) | height (in) | Notes |
|---|---|---|---|---|---|
| EM Banner 1 (full-width image) | 0.000 | 7.350 | 13.333 | 0.150 | Thinner than original; sits flush at bottom |
| Left-corner accent (PNG) | 12.473 | 7.180 | 0.850 | 0.160 | Trimmed; aligns with banner top edge |
| Slide number text-box (foreground) | 12.373 | 7.157 | 0.750 | 0.236 | Calibri 14pt bold white, right-aligned, vertical-center |

Slide 1 (cover) intentionally has no footer — it's full bleed.

**Slides 10 and 11** (Activity Tracker exports) require special handling: the full-bleed embed must be **shrunk to height 7.18"** (not 7.50") so the banner area at the bottom is exposed and the corner accent + slide number are not hidden under the image. Then call `footer_bar(s, 10)` / `footer_bar(s, 11)` so they get the same banner + corner + number treatment as every other body slide. The 7.18" image height also preserves the "Source: IT Ops Objectives Tracker" line at the bottom of the export.

**Slide 2** (Operations Summary): the Strategic KPIs table can creep into the footer area if it has 4+ rows. Keep `ky = Inches(5.10)` and `row_h = Inches(0.30)` — with 4 rows that lands the table at y≈6.80, leaving a clean 0.38" gap before the corner image at y=7.18. If you add a 5th row, raise `ky` further or shrink `row_h` to keep the bottom edge ≤ 6.95.

When generating future months' decks, do not reintroduce the original 0.300"-tall banner / 0.550"-tall corner. The `footer_bar()` helper in `build_group_it_report.py` encodes these exact dimensions.

## Pitfalls Learned

- **The Edit tool truncates this file silently when long blocks contain unicode (em-dashes, ✓, ⚠, →).** Prefer Python `str.replace` via `mcp__workspace__bash` for surgical edits to `build_group_it_report.py`. After every Edit, `wc -l` the file and run the build immediately to detect truncation.
- **SLA Breach column has text not booleans for closed tickets.** Use `Overdue Status` for the SLA-compliance KPI, not `SLA Breach`.
- **Resolution SLA must follow the dashboard's `isResOverdue` algorithm exactly** (verified against https://itops-dashboard.edv-ops.com/index.html source). Order of precedence: (1) cancelled tickets are NEVER overdue; (2) for closed/resolved tickets with both `Due By Time` and `Resolved Time` set, breach = `Resolved Time > Due By Time` — recomputed from raw timestamps, not from the stale `Overdue Status` flag; (3) only fall back to the `Overdue Status` field for open tickets. Denominator = tickets in CLOSED_STATUSES = `{closed, resolved, confirmed resolution, confirm resolution, cancelled}`. Use the live dashboard value as the source of truth (e.g. April 2026: 90.2%, not the 87% computed from a stale CSV export).
- **Operations group filter is exactly 12 groups** (from `localStorage.grpTeams.ops` in the dashboard): Abidjan IT Agents, Exploration BF Support, Exploration CI Support, Exploration IT Support, Hounde IT Agents, ITY IT Agents, Kalana IT Agents, Lafigue IT Agents, Mana IT Agent, Ouaga IT Agents, Sabodala IT Agents, **Tanda IT Agents** (often missed). Note: the older `IT_HELPDESK_GROUPS` constant in the JS only has 11 — Tanda is added via the localStorage preset.
- **FCR methodology has changed** between the dashboard's "94.9%" and the raw `FCR Marked` flag. Always show "method Δ" rather than a numeric MoM delta on slide 3.
- **Emergency changes:** always surface the actual subject/site/CHG-ID on slide 8 (Lafigué SML disk-space upgrade in April was CHG-254). Generic "1 emergency" is not enough.
- **Activity Tracker dashboard scrape:** `Chart.instances` exposes site scores, RAG distribution, and pillar scores as plain arrays — use them rather than parsing the DOM. Switching the Period dropdown via `form_input` triggers re-render and may hang the page; budget for an extra wait cycle.

## Live Activity Tracker Scrape — canonical procedure (May 2026)

The `IT_Ops_Strategy_<Month><Year>.pptx` export drifts because users keep grading activities after pressing Export. The deck must therefore be refreshed from the **live** dashboard right before delivery, not from the static export. Procedure:

**Step 0 — Confirm Claude-in-Chrome is connected before assuming.** The dashboard is on a LAN-only IP (`10.225.99.173:3456`), unreachable from any Anthropic-side proxy. Always ask the user: *"Can you open `https://itops-dashboard.edv-ops.com/activity-tracker.html` and confirm Claude in Chrome is connected to that tab?"* — wait for confirmation. Don't silently retry navigate or assume.

**Step 1 — Navigate + verify charts are live.**
```js
// Run via mcp__Claude_in_Chrome__javascript_tool
JSON.stringify({url:location.href,hasChart:typeof Chart!=='undefined',chartCount:Chart.instances?Object.keys(Chart.instances).length:0})
```
Expect `chartCount: 6`. If 0, the page hasn't loaded yet — `wait` 4–8s then retry.

**Step 2 — Confirm the Period selector is on the target month BEFORE scraping.** The dropdown often defaults to the previous month. Set it explicitly:
```js
(()=>{const sel=document.querySelectorAll('select.sel')[1];sel.value='4';sel.dispatchEvent(new Event('change',{bubbles:true}));return sel.value;})()
```
The four `select.sel` dropdowns are: `[0]` Year (2026), `[1]` **Month (1–12)**, `[2]` View, `[3]` … . Index 1 is the one that matters. After changing, `wait` 3–4s for charts to re-render.

**Step 3 — Dump all 6 charts in one shot.**
```js
JSON.stringify(Object.values(Chart.instances).map((c,i)=>({i,canvasId:c.canvas&&c.canvas.id,type:c.config.type,labels:c.data.labels,datasets:c.data.datasets.map(d=>({label:d.label,data:d.data}))})))
```
Canvas IDs are `c0`–`c5`. Mapping (verified Apr 2026):
- `c0` line — site trend Jan→Apr per site
- `c1` bar — Site Performance Apr (per-site score)
- `c2` grouped bar — Pillar score by site (4 pillars × 5 sites)
- `c3` stacked bar — RAG distribution by Pillar (G/A/R per pillar)
- `c4` stacked bar — RAG distribution by Site (G/A/R per site)
- `c5` doughnut — Total RAG (G/A/R fleet-wide)

**Step 4 — For pillar MoM deltas, scrape March separately.** Switch month to 3, dump again, switch back to 4. Compute per-pillar fleet means as the simple average of the 5 site scores; weighted fleet avg uses pillar weights `NI 30% / BP 35% / RC 20% / PD 15%`.

**Step 5 — Cross-validate against the visible KPI tiles.** The page innerText snippet `"63%\nFleet Avg\n58\nGreen\n38\nAmber\n41\nRed\n42%\nOn Target\n77%\nActive"` should match the doughnut + your weighted-mean computation. If they don't match within 1pp, your month selector probably didn't actually re-render — re-scrape.

### Replacing chart pictures in the deck — DO NOT use stale indices

The first time this routine ran in May 2026, the chart-replacement code used `slide.shapes[idx]` after a previous remove call. Removing a shape shifts every subsequent index down by 1, so the "second" replace targeted the **Source: line textbox** instead of the right-hand chart. Symptom: a thin colored stripe between the charts and the bottom EM banner.

**Robust pattern — find pictures by position, never by index, and resolve all targets BEFORE the first deletion:**
```python
def find_pic_by_pos(slide, x_in, y_in, tol=0.1):
    for sh in slide.shapes:
        if sh.shape_type == 13:  # PICTURE
            if abs(sh.left/914400 - x_in) < tol and abs(sh.top/914400 - y_in) < tol:
                return sh
    return None

left_pic  = find_pic_by_pos(s10, 0.40, 3.10)
right_pic = find_pic_by_pos(s10, 6.85, 3.10)
# Capture box dimensions BEFORE deleting either:
def replace_pic(slide, pic, path):
    x,y,w,h = pic.left, pic.top, pic.width, pic.height
    pic._element.getparent().remove(pic._element)
    slide.shapes.add_picture(path, x, y, w, h)
replace_pic(s10, left_pic,  "slide10_site_perf.png")
replace_pic(s10, right_pic, "slide10_rag_pillar.png")
```

### Chart-image aspect ratio must match the picture frame

Slide 10 picture frames are 6.20"×3.50" and 6.10"×3.50" (≈1.77:1). Save matplotlib figures with `figsize=(6.20, 3.50)` or `(6.10, 3.50)` at `dpi=200`. Mismatched aspects (e.g. `figsize=(7,4)` = 1.75:1 vs frame 1.77:1) cause pixel-level stretch artifacts in LibreOffice rendering — usually invisible in PowerPoint itself but visible in PDF exports.

### Multi-paragraph text frames — use python-pptx native API, not raw lxml

The "General Review" textbox on slide 11 has 4 lines with mixed icon/body run formatting. Editing via `etree.SubElement(txBody, qn("a:p"))` produced paragraphs that LibreOffice failed to render. Use the native API:
```python
from pptx.enum.text import PP_ALIGN
tf = box.text_frame; tf.clear()
for i, (icon, color, body) in enumerate(lines):
    p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
    p.alignment = PP_ALIGN.LEFT     # explicit — cleared paragraphs sometimes inherit center
    r1 = p.add_run(); r1.text = icon; r1.font.color.rgb = color; r1.font.bold = True
    r2 = p.add_run(); r2.text = body; r2.font.color.rgb = CHARCOAL; r2.font.bold = True
```
Without explicit `p.alignment = PP_ALIGN.LEFT`, the first paragraph after `tf.clear()` inherits centered alignment from the cleared paragraph properties, while subsequent `add_paragraph()` lines default to left — producing the visible misalignment seen in v4d.

## Asking the user for browser / connector access

Before any procedure that depends on Claude-in-Chrome, the SDP dashboard, the executive-report dashboard, or any other LAN-IP service, **ask the user explicitly** rather than silently retrying:

- *"I need the live `activity-tracker.html` data for slide 10/11. Can you open `https://itops-dashboard.edv-ops.com/activity-tracker.html` in Chrome and confirm Claude in Chrome is connected? I'll then scrape via `Chart.instances`."*
- *"To verify the SLA against the dashboard, please open `https://itops-dashboard.edv-ops.com/index.html` and switch to Monthly view for the target month."*
- *"For the executive pain-points, I need `/api/survey/voice?month=YYYY-MM`. Can you open the dashboard so I can hit that endpoint via Chrome MCP?"*

Same applies to MCP connectors (Slack/Asana/Notion/etc.) — if a needed tool isn't already authorized, prompt the user to authorize before attempting work that depends on it. Don't pretend the data is unavailable when the real fix is a one-click connect.
- **Reference exports beat hand-built charts** for slides 10 and 11. If the user provides `IT_Ops_Strategy_*.pptx`, embed it full-bleed (numbers always match the canonical tracker view).
- **Slide 1 has no footer banner by design** — the cover spans full bleed.
- **Asset paths:** the build script expects `em_banner.jpg`, `left_corner.png`, `refs_hi-1.jpg`, `refs_hi-2.jpg`, and the `charts/` folder in the working directory. Copy assets into the working directory before running.

## Next Run (May → next month, etc.)

When the user says "build the report for <Month>" or drops files in `Monthly-Reports/<Month>/`:

1. Read `SKILL.md` (this file).
2. Run the data ingest and chart generation against the new month's CSVs.
3. Reuse `build_group_it_report.py` from `_skill_assets/`. Only inputs change — the script does not need editing for normal months.
4. If the IT Activity Tracker schema changes (new pillars, renamed sites), update the slide-10/11 commentary block.
5. Verify and deliver.

## Reference Run — April 2026 (delivered values, dashboard-canonical)

These values are the canonical "as delivered" April 2026 numbers — useful as sanity checks for next month's deltas:

- Total tickets 1,472 (-8% MoM) · Closed 1,302 (88.5% closure, -18% MoM) · Open backlog 226 (flat MoM)
- **Resolution SLA 90.2% (+2.4pp MoM — first time on target)** · FRT SLA 74.3% (+1.2pp MoM) · FCR 17.7% (method Δ vs old dashboard) · Avg Resolution 1d (-1d MoM) · SLA Violations 9.8%
- Time to Assign 19h (-5h) · First Reply 16h (-2h) · Closing Time 2d (-1d)
- Channel: E-Mail 70.7% · Web Form 28.3% · Live Chat 0.6%
- Major Incidents 2 (1 P1 Hounde power outage, 1 P2 Sabodala Feb-MI follow-up)
- Changes 22 (15 Standard / 6 Major / 1 Emergency = CHG-254 SML Mining-VM disk space)
- Activity Tracker fleet avg 42% (-12pp MoM) · Green 30 / Amber 54 / Red 65 · MGO leading 55% · SGO lagging 31%

⚠ **Note on SLA**: my initial direct CSV computation gave 87.6%; the dashboard shows 90.2%. The 2.6pp gap is because the dashboard recomputes breach from `Resolved Time > Due By Time` (raw timestamps) rather than trusting the `Overdue Status` flag — and pulls fresher data via its proxy. **Always cross-check against the live dashboard at https://itops-dashboard.edv-ops.com/index.html** before publishing.
