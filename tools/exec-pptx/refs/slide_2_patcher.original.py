"""
slide_2_patcher.py — Update slide 2 (5. Operations: Summary) for each new month.

Apply this AFTER you start from a copy of the previous month's deck.
The slide-2 layout = original Endeavour template, must be preserved verbatim.
This patcher only updates the data-driven cells.

CONFIRMED RULES (locked May 2026 by user — Aziz):
  1. Title text "5. Operations: Summary" — CONSTANT, do not change.
  2. Mohamed Diagne photo / name / role — CONSTANT.
  3. Goal banner text — CONSTANT.
  4. Legend block (Green / Amber / Red squares + labels) — CONSTANT.
  5. Reporting Month cell — month name only ("April", "May", ...) — derived from folder name.
  6. Financial Year — year only ("2026").
  7. Headcount (inc Contract) — currently 7 (manual; ask Mohamed each year).
  8. Project Health pills (Overall Status / Schedule / Risk / Budget / Resource) — MANUAL.
     Mohamed sets these each month based on his judgement. Patcher leaves whatever
     was on the previous deck.
  9. Progress since last period — DATA-DERIVED. Build from:
       - Helpdesk KPIs (tickets / closure / Res-SLA / FRT / pp deltas vs prior month)
       - Toolbox / tooling rollouts (from meeting notes)
       - Active strategic threads (4MP V2 status, Reporting Automation status)
       - Change governance one-liner (count + breakdown + Emergency CHG-ID)
 10. Issues / Risks / Comment — DATA-DERIVED. Build from:
       - Major Incidents (count + sites)
       - Vendor / link issues from meeting notes (MTN, Orange, etc.)
       - FRT/SLA gap call-out
       - Open backlog top sites
       - Recurring-incident themes (Acronis, fiber, backup, etc.)
       - Recruitment status
 11. Activities for next period — DATA-DERIVED, OPTION (C):
       Keep the FIVE strategic theme NAMES constant year-to-year:
         (1) 4MP V2 Launch & Adoption
         (2) Operational Reporting
         (3) IT Governance
         (4) Audit & Compliance
         (5) Workforce Planning
       Replace each ":<description>" with a 1-sentence current-month status
       pulled from the meeting-notes follow-up tasks.
 12. KPIs table:
       - Deliverable names (4 rows) — CONSTANT.
       - Owner / End date — CONSTANT (Mohamed / H1-2026 or H2-2026).
       - RAG dot color — MANUAL (Mohamed sets).
       - Comments column — CARRY-FORWARD + DELTA:
           Read each cell's existing text from prior month's deck.
           Append " April: <one data-derived sentence>" describing current-month progress.
           Mohamed edits as needed.

API:
    patch_slide2(prev_pptx_path, output_pptx_path, month_name, kpis_dict, meeting_notes_followups)
        - prev_pptx_path: path to last month's delivered deck (carries forward template + KPI comments)
        - output_pptx_path: where to save the patched copy
        - month_name: "April", "May", ...
        - kpis_dict: parsed kpis.json (used for Progress + Issues bullets)
        - meeting_notes_followups: list of follow-up themes from current-month DOCX

Implementation details:
    - Uses python-pptx text-run replacement; preserves all formatting (font, size, color).
    - For empty cells (e.g. Infrastructure Standardization Comments was empty in template),
      copy paragraph formatting from a sibling cell (e.g. Skills Matrix cell) before writing.
    - DO NOT call .text = ... directly on table cells — it loses font formatting; instead
      manipulate the existing run's .text attribute.
"""
