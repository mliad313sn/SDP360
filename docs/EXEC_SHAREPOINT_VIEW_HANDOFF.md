# Executive view for SharePoint — design handoff

**For:** the Designer refining the executive IT view
**From:** IT (SDP Dashboard team)
**Date:** 2026-06-15
**Status:** content + delivery mode NOT yet decided — see "Open decisions"

---

## 1. What this is, in one line

A single-screen, read-only **executive snapshot of IT operations**, published to a
SharePoint M365 page so **everyone** (all staff, any device, off the corporate LAN)
can see how IT is performing — without exposing anything sensitive.

It is **not** the full dashboard. The full dashboard (helpdesk, scorecards,
inspections, meetings, activity tracker) lives on an internal LAN-only app. This
is a curated extract pushed outward.

## 2. The starting artifact

Open **`exec-sharepoint-mockup.html`** (same folder) in any browser. That is the
"master visual" — built to the live dashboard's brand. Refine THAT. It is
self-contained (Libre Franklin + Chart.js load from CDN; works with internet).

There is also a cleaner inline version that was shown in the working session; the
HTML file is the canonical one to iterate on.

## 3. Content blocks (and the real data behind each)

Every element maps to data that already exists in the dashboard. Sample numbers in
the mockup are placeholders.

| Block | What it shows | Real source |
|---|---|---|
| 5 KPI tiles | Tickets resolved + closure %, SLA compliance %, Avg resolution time, CSAT %, Major incidents + uptime | Helpdesk DB (`request_records`), CSAT survey, major-incidents |
| Trend chart | 6-month resolved volume (bars) + SLA % (line) | `getHelpdesk6MonthHistory` / monthly aggregates |
| Site status | RAG dot per operating site | Activity Tracker per-site score, or a chosen ops signal |
| IT strategy tracker | Fleet score + 4 pillar scores (Network / Business partner / Risk & compliance / Manage people) | Activity Tracker `tracker.pillars` |
| Highlights / Focus areas | 3 wins + 3 watch-items | Auto-synthesised commentary (already generated for the PPTX deck) |
| "Synced" badge | Freshness timestamp | Set at push time |

## 4. Deliberately EXCLUDED (do not add these)

These exist in the internal dashboard but must **never** appear on an all-staff
SharePoint page:

- Individual technician performance / leaderboards
- Raw customer verbatims / survey comments
- Named major-incident detail (RCA text, people involved)
- Anything ticket-level or person-identifiable

This boundary is enforced in the app today by the `scorecard-viewer` role. Keep the
SharePoint view on the "safe" side of it.

## 5. Brand tokens (match the live dashboard)

```
Navy (header)      #1E293B
Slate (headings)   #3A4A60
Blue (primary)     #145FAE
Orange (accent)    #E87722  /  #EF631A
Red (brand)        #D90038
RAG  green/amber/red   #16A34A / #EF9F27 / #DC2626
Font               Libre Franklin (≈95% match to Franklin Gothic;
                   swap to licensed Franklin Gothic WOFF2 if available)
Card               white, 1px #E2E5EA border, 10–12px radius
KPI tile           left accent bar in the tile's RAG/brand colour
```

## 6. THE FIDELITY QUESTION — read this carefully

> "Will it look identical on SharePoint as the mockup?"

**Honest answer: it depends entirely on the delivery mode, and the two are coupled.**
This is the single most important thing to settle before detailed design.

| Delivery mode | Visual fidelity vs the mockup | Dynamic? | Design implication |
|---|---|---|---|
| **B — image / PDF snapshot** | **100% — pixel-perfect** (it IS the mockup, rendered to an image nightly) | No (refreshed nightly) | Designer has **total freedom**. The master visual = the final result. |
| **A — native SharePoint list + web parts** | **~70–80% — an approximation** | Yes | SharePoint imposes its own theme, fonts, web-part chrome and spacing. Designer must design **within** SharePoint's section/web-part layout, or accept it won't match exactly. Brand font may not apply. |
| **A+ — SPFx custom web part** | **~95–100% AND dynamic** | Yes | A developer ships a custom SharePoint web part that renders this exact HTML with live data from the list. Best of both — but it's a dev project, not just design. |

**Practical guidance for the Designer:**

1. Design the **master visual** mode-agnostically (the HTML file) — it serves all paths.
2. If the org picks **snapshot (B)** → your design ships as-is. Done.
3. If the org picks **native list (A)** → also deliver a **"SharePoint-native" variant**:
   the same content re-expressed with SharePoint's built-in web parts (Hero, Quick
   chart, List with column formatting, Text). Treat the master as the *target*, not a
   contract. Provide JSON column-formatting snippets if you can.
4. If the org funds **SPFx (A+)** → the master visual becomes the literal spec; a dev
   reproduces it pixel-for-pixel with live data.

**Recommendation we're taking into the decision meeting:** start with **B (snapshot)**
to validate content fast and get pixel-perfect brand fidelity, then move to **A** (or
**A+** if fidelity matters enough to fund the web part) once content is frozen.

## 7. Layout / responsive notes

- Target: one screen, readable in ~10 seconds, no scrolling on a desktop/TV.
- Must degrade gracefully to 2-column on tablets and 1-column on phones (the mockup
  already does via the media query).
- Likely also shown on **lobby/TV screens** at sites — design for legibility at distance
  (large KPI numbers, strong RAG colour).

## 8. Open decisions (pending the stakeholder meeting)

1. **Content** — which of the 6 blocks survive? (KPIs / trend / site RAG / tracker /
   highlights). Stakeholders cross items off.
2. **Delivery mode** — B, A, or A+ (drives fidelity, see §6).
3. **Refresh cadence** — daily? hourly? (snapshot = nightly is usually plenty).
4. **Audience confirmation** — all staff, or a named group? (affects SharePoint
   permissions, not the design).

## 9. What we need back from the Designer

- A refined **master visual** (Figma + an updated standalone HTML, or just Figma).
- If native SharePoint is chosen: a **SharePoint-native variant** + column-formatting
  JSON where applicable.
- Light/dark and TV-screen legibility checks.
- Asset list (logo lockup, icon set, the Franklin Gothic font file if licensed).

---

*Questions on the data or what's feasible to pull: IT / SDP Dashboard team.*
*Questions on SharePoint delivery + Azure AD `Sites.Selected` + Boomi: see the
architecture slide from the same session.*
