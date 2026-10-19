# Activity Tracker Dashboard — Redesign Brief

> Status: design preview live at `public/dashboard-preview.html`. This
> document captures the brief in three forms — (1) a self-contained
> prompt you can paste into Claude Design / v0 / similar AI design
> tools, (2) a tighter component spec for a designer working in Figma,
> and (3) the rationale + open questions so reviewers have context.

---

## 1. AI design tool prompt (copy-paste)

> Paste this into Claude Design, v0, Lovable, Figma AI, or similar. It
> describes the layout, brand, components, and behaviour without
> assuming any prior context.

```
Design a single-page executive dashboard called "IT Activity Tracker —
Executive Pulse" for a multi-site mining IT organisation (Endeavour
Mining). Audience: Operations managers + senior leadership reviewing
monthly performance. Goal: tell the story of "how are we doing this
month, where do we lead, where do we lag, what needs attention?" in
under 10 seconds at a glance.

CONTEXT
- The page is one of 7 tabs in a larger dashboard. Other tabs (Scoring,
  Input, Heatmap, Activities, Targets) are kept as power-user views;
  this brief is only the Dashboard tab.
- Period control: a Month + Year selector lives at the top right
  (already implemented — do not redesign it).
- Data driving the page: 31 activities organised in 4 pillars (P1
  Network Infrastructure 30%, P2 Business Partnering 35%, P3 Risk &
  Compliance 20%, P4 People Management 15%), tracked across 10–12
  sites (currently 5 active: HGO Houndé, MGO Mana, SML Lafigué, ITY
  Ity, SGO Sabodala). Each activity has a monthly score; sites have
  an overall weighted score.

LAYOUT — exactly four stacked sections, full-width container max 1280px

  ┌─────────────────────────────────────────────────────────────┐
  │  HEADLINE        big number + delta + 6-month sparkline      │
  ├─────────────────────────────────────────────────────────────┤
  │  PILLAR HEALTH      |     SITE LEADERBOARD                   │
  │  4 stacked rows     |     active sites first, then faded    │
  │  with progress      |     inactive ones                     │
  ├─────────────────────────────────────────────────────────────┤
  │  WATCHLIST          5–9 items with site code, activity ref,  │
  │                     short reason, "Open" link                │
  ├─────────────────────────────────────────────────────────────┤
  │  DRILL-DOWN STRIP   3 cards: Scoring, Roadmap Gantt, Heatmap │
  └─────────────────────────────────────────────────────────────┘

SECTION 1 — HEADLINE
- Dark gradient card (slate #1E293B to #0F172A), white text, rounded
  14 px, 26 px padding.
- Left half: big score "62%" at 64 px font-weight 800, with a delta
  pill "▼ 6 pp" in red-tint background. Below: small sub-line:
  "31% of activities on target · 82% showing progress · Best HGO 69%
  · Watch ITY 50%".
- Right half: a 6-month area sparkline in mint-green (#86EFAC), with
  month labels Dec→May underneath. Last point on the line gets a
  highlighted dot.

SECTION 2 — TWO COLUMNS
- Left card "Pillar Health": 4 rows, one per pillar. Each row =
  [coloured 44 px badge with "P1" / "P2" / ...] + [pillar name +
  small caption "weight % · active sites"] + [linear progress bar
  with gradient fill] + [right-aligned score + small delta below].
  Pillar colours: P1 #145FAE blue, P2 #EF631A orange, P3 #7C3AED
  purple, P4 #0D9488 teal.
- Right card "Site Leaderboard": rows sorted best-to-worst.
  Each row = [3-letter site code in bold mono] + [site name + small
  country] + [progress bar in site colour, red if <55%] +
  [score%] + [delta pill ▲ ▼ —].
  Inactive sites listed below a "X sites inactive" separator, faded
  at 42% opacity.

SECTION 3 — WATCHLIST
- White card, 18 px padding. Header: "Needs attention this month"
  with a red count pill (e.g. "9").
- Rows: [coloured dot — red or amber] + [mono scope tag like
  "ITY · P1-7"] + [activity name + small caption with reason + owner]
  + ["Open ›" outlined button].
- Footer: count summary + link "Open Scoring view filtered to
  red/amber →".

SECTION 4 — DRILL-DOWN STRIP
- 3 equal cards in a row: Scoring · Roadmap Gantt (NEW badge) · Heatmap.
- Each card: small emoji/icon in tinted square + title + one-line
  description. Hover: subtle lift + shadow.

BRAND
- Primary: #EF631A (Endeavour orange — used for CTA, "new" badges,
  the active tab underline).
- Secondary: #145FAE (Endeavour blue — links and Opportunity status).
- Slate headers: #3A4A60.
- Background page: #F4F6F7. Card background: #FFFFFF.
- Borders: #E2E5EA. Subtle dividers: #EEF0F3.
- Status colours: green #1B9A3A, amber #D97706, red #D90038.

TYPOGRAPHY
- Font family: 'Libre Franklin', 'Franklin Gothic', system-ui.
- Section headings: 12 px uppercase 1.1 px tracking, weight 700.
- Body: 13 px, weight 500 default.
- Numbers: tabular-nums, JetBrains Mono for code-like tags.

INTERACTION
- Everything is read-only on this view. Clicking watchlist rows
  deep-links into the Scoring tab pre-filtered to that site +
  activity. Drill-down cards link to other tabs. Tab selector at
  top swaps the whole panel.

DELIVERABLES
- Desktop layout (1280 px) and mobile layout (≤ 720 px collapsing
  to single column, headline keeps its trend below the score).
- Use the brand colours and typography above exactly.
- Light theme only.
```

---

## 2. Component spec — for a designer working in Figma

If a designer is taking this into Figma rather than asking an AI tool to render it, give them this tighter spec.

### Tokens

| Token | Value |
|---|---|
| `color/background` | `#F4F6F7` |
| `color/surface` | `#FFFFFF` |
| `color/border` | `#E2E5EA` |
| `color/border-subtle` | `#EEF0F3` |
| `color/text/primary` | `#1F2A33` |
| `color/text/secondary` | `#3A4452` |
| `color/text/muted` | `#6B7785` |
| `color/edv/orange` | `#EF631A` |
| `color/edv/orange-700` | `#C04E10` |
| `color/edv/blue` | `#145FAE` |
| `color/edv/slate` | `#3A4A60` |
| `color/rag/green` | `#1B9A3A` |
| `color/rag/amber` | `#D97706` |
| `color/rag/red` | `#D90038` |
| `color/pillar/p1` | `#145FAE` |
| `color/pillar/p2` | `#EF631A` |
| `color/pillar/p3` | `#7C3AED` |
| `color/pillar/p4` | `#0D9488` |
| `font/sans` | Libre Franklin |
| `font/mono` | JetBrains Mono |
| `radius/sm` | 4 px |
| `radius/md` | 8 px |
| `radius/lg` | 12 px |
| `radius/xl` | 14 px |
| `shadow/card` | `0 1px 2px rgba(15, 42, 77, 0.04)` |
| `shadow/headline` | `0 6px 24px rgba(15, 23, 42, 0.18)` |

### Components to build in Figma

1. **`Card / Default`** — white surface, 1 px border, 12 px radius, 18 px padding, optional header slot (12 px uppercase title + 11 px muted sub).
2. **`Card / Headline`** — dark slate gradient, 14 px radius, 26 px padding, 2-column variant (score + delta + sub-line | trend label + sparkline + month labels).
3. **`Pillar Row`** — 56 / flex / 78 px grid. Slot 1: 44 × 44 pillar badge with pillar code. Slot 2: name (13 px 600) + caption (11 px muted) + 8 px progress bar with linear gradient. Slot 3: right-aligned 18 px score + 10 px delta caption.
4. **`Leaderboard Row`** — 52 / flex / 70 / 60 px grid. Slot 1: 3-letter code (mono 13 px bold). Slot 2: site name + 6 px progress bar (red if score < 55%). Slot 3: score (14 px 700 tabular). Slot 4: delta pill (▲ ▼ —).
5. **`Watchlist Row`** — 28 / 96 / flex / auto grid. Slot 1: 10 px RAG dot. Slot 2: mono scope tag with site chip. Slot 3: activity name (13 px 500) + reason caption (11 px muted). Slot 4: "Open ›" outlined button.
6. **`Drill-down Card`** — horizontal layout, 36 × 36 icon square + title + 12 px description.
7. **`Delta Pill`** — 3 states: up (green tint), down (red tint), flat (grey tint). Tabular numerals.
8. **`Tab`** — text button, 600 weight, 13 px, 12 / 18 px padding. Active state: 3 px bottom border in orange.

### Page composition

- 1280 px container, 24 px page padding, 20 px gap between sections.
- Section order: tab strip → headline → two-column (pillar + leaderboard) → watchlist → drill-down strip → footer.
- Mobile: two-column collapses to stacked; headline retains side-by-side but reduces font sizes.

---

## 3. Rationale (the "why" — for reviewers)

### What we're solving
The current dashboard shows: eight equal-weight KPI tiles, ten site cards with cryptic `9 / 11 / 9` numbers, an executive summary sentence that's easy to skip, and six small charts. The story is buried.

### The new structure
1. **Headline first** — one number, one delta, one trend. Story in 2 seconds.
2. **Pillars over sites** — leadership asks "are we OK on Network?" before "is Sabodala OK?". The pillar block puts the strategic dimension first.
3. **Leaderboard second** — the site comparison is real and useful, but it's a *second-order* read. Ranks them best to worst, with a clear inactive-site separator.
4. **Watchlist explicit** — converts the dashboard from a *report* into a *to-do list*. The off-target activities that already exist in the data finally get a surface.
5. **Power-user views unchanged** — Scoring, Heatmap, Input, Activities, Targets stay exactly as today. Drill-down strip at the bottom routes users there.

### What we explicitly removed
- The "8 KPI tiles" row. The same numbers appear, but contextualised inside the headline and the pillar/leaderboard sections.
- The 6 small charts at the bottom. The information they carried (RAG distribution, site G/A/R, target attainment) is now in the pillar progress bars and the leaderboard. Optional R4: bring back as drill-downs *inside* each card.

### What we explicitly added
- The **Watchlist** — generated from existing `score()` output by filtering `rg === 'RED' || 'AMBER'`. No new data needed.
- The **Roadmap Gantt** as a sibling tab — not part of the dashboard, but the natural answer to "show me what's happening over the year".

### Open questions for the meeting
1. **Pillars-first vs Sites-first.** Some leadership audiences want sites first. The mockup defaults to pillars-first; happy to swap.
2. **Watchlist size.** 5-9 items? 3? Top-10? Determined by `max( red_count, 5 )`?
3. **Drill-down strip placement.** Bottom of dashboard, or in the tab bar itself?
4. **What survives from the current 6 charts?** Score Trend, Target Attainment, RAG Distribution, Pillar Deep-dive, Site avg, Site G/A/R. Could keep none, some, or all as collapsible drill-downs.

### Phased rollout
- **R1** ship Headline + Pillar Health + Leaderboard, keep old 6 charts below
- **R2** add Watchlist with click-through to Scoring filtered
- **R3** rewrite Timeline tab as Gantt
- **R4** retire old 6 charts after a week's usage confirms they're not missed

---

## 4. Files in this redesign

| File | Status | Purpose |
|---|---|---|
| `public/dashboard-preview.html` | ✅ Committed | Pixel-rendered static mockup. Open in any browser. |
| `docs/DASHBOARD_REDESIGN_BRIEF.md` | ✅ Committed (this file) | Source-of-truth brief — prompt, spec, rationale |
| `public/activity-tracker.html` | Untouched | Live dashboard. To be updated in R1–R4 if proposal is approved. |
