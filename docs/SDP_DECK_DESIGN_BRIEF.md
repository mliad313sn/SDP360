# SDP Dashboard — Status Update Deck
## Design Brief for Claude Designer

> **Goal of this document**: give a designer (human or AI) everything needed to take `EM_SDP_Dashboard_SharePoint_2026.pptx` from a functional v1 to a polished, professionally animated final deck — without further questions to the project owner.

---

## 1. Project context in 30 seconds

Endeavour Mining built an internal IT operations dashboard called **SDP Dashboard**. It consolidates ticket data, activity tracking, field inspections, and meeting governance for 11 sites across West Africa.

This deck reports the platform's status to the **CIO and CFO** in a 15-minute briefing, then hosts on the **company SharePoint** as the canonical reference for the project.

The deck already exists as a structurally complete .pptx. Your job is to **polish the visuals + add professional motion**, not to restructure or rewrite.

---

## 2. Audience & tone

| | What they care about | What to emphasise visually |
|---|---|---|
| **CIO** | Governance, on-prem footprint, security, recovery, audit trail | Architecture diagram on slide 5 · Resilience grid on slide 10 · Backup/restore message |
| **CFO** | Value delivered, cost-to-run, ROI, headcount story | Volume numbers on slide 7 (24,867 tickets) · "One-click reports" message · Roadmap as menu (slide 11) |

**Tone**: confident, factual, editorial. **Not**: marketing-promotional. **Not**: tech-jargon-heavy. The platform speaks for itself; the deck reports the facts in clean, magazine-style layouts.

**Anti-pattern**: do not turn this into a generic "digital transformation journey" deck with stock photography of handshakes and growth arrows. The Endeavour brand voice is operational, grounded, photo-realistic.

---

## 3. Visual reference — Endeavour editorial style

The deck's visual vocabulary mirrors the **Endeavour Mining SharePoint corporate landing pages** and the **internal news article style** (e.g. the "One Hour Safety Stoppage" article). Key patterns to replicate:

### Typography hierarchy

| Element | Style | Where it lands in our deck |
|---|---|---|
| Slide titles | Slate-navy `#3A4A60`, mixed-case, large weight, ~32-40pt | Title bar of every content slide |
| Signature callouts | **Orange `#EF631A`, UPPERCASE**, letter-spaced, modest size | The "one phrase per slide" highlight — like "SAFETY IS NOT NEGOTIABLE" on the SharePoint article |
| Body copy | Dark grey `#475569`, ~12-14pt, generous line height (1.4-1.5) | Editorial paragraphs |
| Pillar tags / small labels | Orange uppercase, 8-9pt, letter-spaced | Module pillar codes, eyebrows |

### Layout patterns

- **Editorial card grids** — white cards on white/light background, accent border at the top (alternating orange `#EF631A` and slate `#3A4A60`), title in slate, body in muted grey
- **Cover and closing slides** — full slate-navy background, white type, orange uppercase callout
- **Architecture / diagram slides** — white background, slate boxes, orange connectors
- **News-style hero callouts** — large solid orange rectangles with bold white uppercase text overlay (the safety video thumbnail pattern)

### Reference artefacts

In the package alongside this brief:
- `screenshots/` — four real dashboard captures to place in slides 7-9 and 12
- `brand/edv-logo-white.png` and `brand/edv-logo.png` — official mark variants
- The SharePoint screenshot included as reference for the editorial pattern

---

## 4. Brand colour values

| Token | Hex | Purpose |
|---|---|---|
| Slate dark | `#2F3A4A` | Cover background, divider slides, closing slide |
| Slate primary | `#3A4A60` | Slide titles, secondary accents |
| Slate muted | `#475569` | Body copy |
| Slate light | `#6B7280` | Captions, footers |
| **Orange (signature)** | `#EF631A` | Callouts, signature lines, accent borders, eyebrows |
| Blue (secondary) | `#145FAE` | Architecture diagram elements, secondary accents |
| Teal (occasional) | `#0F766E` | Pillar tag accents (P4) |
| Card background | `#F4F5F7` | Soft fill for cards on white slides |
| White | `#FFFFFF` | Content slide background |

**Orange usage rule** — the orange `#EF631A` is the **signature accent**. Use it sparingly and consistently: one prominent uppercase callout per slide (the "signature line"), accent borders at the tops of editorial cards, eyebrows on cover/closing slides. Avoid using it for body copy or in large blocks.

---

## 5. Typography

| Where | Font | Notes |
|---|---|---|
| Headlines, titles | **Franklin Gothic Medium** (or Libre Franklin if Franklin Gothic isn't available) | Endeavour corporate font |
| Body, captions | Same family, regular weight | Match the family |
| Fallback | Calibri | Currently used in v1 — broadly available, near-Franklin-Gothic feel. Acceptable if licensing prevents Franklin Gothic embed. |

If Franklin Gothic is licensed for this project, **embed it in the .pptx file** so SharePoint renders consistently.

---

## 6. Slide-by-slide intent

For each slide: the **key takeaway**, the **animation suggestion**, and any **content notes** the designer should respect.

### Slide 1 — Cover
- **Takeaway**: this is a status update for CIO + CFO; tone is confident, not promotional
- **Animation**: slow fade-in on title (1.5s), then small upward translate on the orange divider line (0.5s after title)
- **Content note**: presenter name + date are placeholders — leave clearly editable
- **Hold time**: 5-7 seconds before any input

### Slide 2 — The context (survey numbers)
- **Takeaway**: 70/69/75 — IT delivers solid work given constraints, but below industry
- **Animation**: title fades in, then the orange callout band **slides in from the left** (signature move, 0.6s). Body paragraphs fade up in two beats (intro paragraph first, second paragraph 0.4s later)
- **Content note**: the numbers in the orange callout should remain editable (different survey years will have different figures)

### Slide 3 — Five truths from the field
- **Takeaway**: five concrete pain points users named — sets up slide 4
- **Animation**: cards **cascade in from left to right** (each card 0.15s after the previous, total ~0.75s)
- **Content note**: five cards in one row; if the layout feels cramped, breaking into 3+2 is acceptable but keep the editorial card style consistent

### Slide 4 — The strategic answer (4 pillars)
- **Takeaway**: the strategy already had the right frame; survey sharpened priorities
- **Animation**: the four pillar cards **flip in from top-to-bottom** in a 2×2 grid (top row first, bottom row 0.3s after). Each card flips on its own X-axis (subtle, 0.4s).
- **Content note**: pillar weights (30/35/20/15%) are real data — preserve them

### Slide 5 — Platform at a glance (architecture)
- **Takeaway**: on-prem, end-to-end, no external dependency for core platform
- **Animation**: three architecture boxes appear left → middle → right. Orange connector arrows draw in between them (line wipe animation). Total sequence ~1.5s
- **Content note**: the diagram is the SLIDE — give it space. The text below is supporting context, not the focus

### Slide 6 — Module map (8 modules)
- **Takeaway**: eight modules, one portal, organised by pillar
- **Animation**: cards reveal in a **3D stagger**, top-left to bottom-right, ~0.1s offset between each. Total ~0.8s
- **Content note**: 4 columns × 2 rows. If a designer prefers 2×4 vertical layout, that's acceptable

### Slide 7 — Operations & Reporting spotlight
- **Takeaway**: real-time KPIs + one-click monthly reports
- **Animation**: text panel slides in from left; screenshot (Helpdesk Operations Center) fades in on the right
- **Screenshot placement**: `screenshots/01-helpdesk-operations-center.png` — full-bleed on the right two-thirds of the slide, drop shadow at 25% opacity, 6px corner radius
- **Caption suggestion** (small text below screenshot): *Helpdesk Operations Center — May 2026 · 24,867 tickets · 85.2% Reply SLA · 93.7% Resolution SLA*

### Slide 8 — Field Operations spotlight
- **Takeaway**: paper replaced; inspections on phones; bilingual; offline-safe
- **Animation**: text panel slides in from left; two side-by-side screenshots (Tracker + Inspection) fade in with a 0.2s delay between them
- **Screenshot placement**: 
   - `screenshots/02-activity-tracker-dashboard.png` — left half
   - `screenshots/03-it-inspection-checklist.png` — right half (or below if vertical layout works better)
- **Caption suggestion**: *Activity Tracker (Houndé 70% top performer · Ity 50% watch) · Inspection form (EN/FR bilingual, 17 categories, 173 items)*

### Slide 9 — Governance spotlight
- **Takeaway**: site IT → Council, one thread, structured
- **Animation**: text panel slides in from left; screenshot fades in on the right
- **Screenshot placement**: `screenshots/04-meetings-decisions.png` — right two-thirds
- **Caption suggestion**: *Meetings module · Four-level engagement structure · Department Meetings → IT Survey → Mine IT Council*
- **Note for designer**: the meetings KPI strip shows zeros — this is intentional ("the platform is live; adoption starts next") and supports the closing slide. Do not retouch the screenshot to hide the zeros.

### Slide 10 — Built right (resilience grid)
- **Takeaway**: data sovereignty + recoverable by design
- **Animation**: six callout cards reveal in a **wave pattern** (top-left to bottom-right diagonal, 0.08s stagger). Each card has a subtle elevation lift (3D shadow grows) on reveal
- **Content note**: each card is a label + body; no decorative icons needed unless the designer wants to add minimal monoline icons in orange

### Slide 11 — Roadmap (3 timeframes)
- **Takeaway**: modular by design; next iterations slot in without re-platforming
- **Animation**: column headers appear first (Near / Mid / Long), then the items within each column cascade down (0.1s each)
- **Content note**: keep the three-column structure; do not collapse to a single list

### Slide 12 — Closing
- **Takeaway**: the platform is here, adoption is next
- **Animation**: the big orange "**THE WORK NOW IS ADOPTION**" callout fades in slowly (1.2s) and **stays held**. The three supporting lines below appear one by one (0.4s each)
- **Hold time**: 8+ seconds for the room to absorb. Don't auto-advance.

---

## 7. Transitions (between slides)

Recommend **Morph transition** for these slide pairs (PowerPoint matches shapes with the same name and animates between them):

| Pair | Why Morph |
|---|---|
| 2 → 3 | Orange callout repositions; title shifts; cards expand from nothing |
| 3 → 4 | The 5 cards collapse, 4 pillar cards expand in their place |
| 5 → 6 | Architecture boxes morph into the module grid layout |
| 9 → 10 | Spotlight pattern morphs to the 6-cell resilience grid |
| 11 → 12 | The 3-column roadmap collapses; the closing slate fills in |

For non-Morph transitions, use **Fade through Black** (0.5s) — keeps the editorial feel.

**Avoid**: Push, Cover, Reveal, Box, Wipe, Cube, Origami — too flashy for a CIO/CFO briefing.

---

## 8. Animation principles (overall)

| Principle | Application |
|---|---|
| **Subtle, not flashy** | Every animation under 0.6s unless it's a deliberate "hold" moment (cover, closing) |
| **Editorial pacing** | Animations should feel like a magazine page turning, not a tech demo |
| **One signature movement per slide** | The orange callout band is the consistent signature (slides in, fades in, or wipes in — same direction across the deck) |
| **No infinite loops** | All animations resolve to a static state — no ambient motion that would distract during Q&A |
| **Speaker-paced** | Animations advance on click, not auto. CIO/CFO presentation = presenter controls timing |

---

## 9. Screenshot polish

When placing the four screenshots:

1. **Standardise aspect**: crop to 16:9 if possible (many of the captures are wider than they are tall — good for slide layouts)
2. **Drop shadow**: 25% opacity, 4px blur, 2px Y offset (subtle, not chunky)
3. **Corner radius**: 6-8px (matches the dashboard's own card corners)
4. **Optional**: very faint slate-navy hairline border at 30% opacity (1px) for definition against white slide background

Do NOT:
- Add browser chrome (tabs, address bars) — the captures are already clean
- Tilt or perspective-transform the screenshots — keep them flat
- Add decorative frames or device mockups (phone bezels, laptop frames) — they distract from the data

---

## 10. Output expectations

Deliver back:

1. **`EM_SDP_Dashboard_SharePoint_2026_FINAL.pptx`** — animated, polished, with embedded screenshots
2. **`EM_SDP_Dashboard_SharePoint_2026_FINAL.mp4`** (optional) — 16:9 1080p video render at ~24 fps for SharePoint video tile embedding
3. **Optional thumbnail**: a single hero image at 1920×1080 for SharePoint listing thumbnail (suggested: a layered composition of slide 1 cover + a small overlay of the Helpdesk Operations Center screenshot)

---

## 11. Do's and don'ts checklist

✅ **Do**:
- Preserve all the text content verbatim (it's been reviewed)
- Match the editorial card style consistently across all slides
- Use Morph transitions where suggested
- Embed Franklin Gothic if licensed
- Keep the orange `#EF631A` as the signature accent
- Make placeholder text on slide 1 (presenter name + date) clearly editable
- Honour the empty-state of slide 9's Meetings KPIs

❌ **Don't**:
- Restructure the slide order
- Add stock photography (handshakes, mountains, growth arrows, abstract tech swirls)
- Use Comic Sans, Papyrus, or any decorative font
- Animate decorative elements (the deck is editorial, not motion-graphic)
- Add background music
- Auto-advance slides
- Use gradients or glassmorphism — the editorial style is flat colour
- Reach for the dashboard URL (`itops-dashboard.edv-ops.com`) — it's behind corporate auth; everything you need is in the package

---

## 12. Reference files in this package

```
SDP_Dashboard_Designer_Package/
  ├── EM_SDP_Dashboard_SharePoint_2026.pptx       ← starting point
  ├── DESIGN_BRIEF.md                              ← this document
  ├── screenshots/
  │     ├── 01-helpdesk-operations-center.png
  │     ├── 02-activity-tracker-dashboard.png
  │     ├── 03-it-inspection-checklist.png
  │     └── 04-meetings-decisions.png
  ├── brand/
  │     ├── edv-logo-white.png  (for slate-navy backgrounds)
  │     └── edv-logo.png         (for white backgrounds)
  └── reference/
        └── sharepoint-editorial-style.png         (the safety-article reference)
```

---

## 13. Quick contact for clarifications

If during the work you have specific questions:

- **Content questions** (wording, data accuracy): pause and surface them — do not invent or paraphrase technical claims
- **Visual questions** (a layout you're uncertain about): propose your interpretation in the .pptx as a comment, the project owner reviews
- **Animation questions** (a transition that didn't work in PowerPoint): document in a note, fall back to Fade through Black

---

## 14. Summary

This deck reports on a real platform that took ~250 commits to build. The visuals should match that substance — confident, editorial, honest. Avoid the temptation to over-design. The audience is two senior executives who care about what was built, not how shiny the deck looks.

**Your role: make this deck feel inevitable.** Not impressive — inevitable. The platform exists, the strategy was right, the numbers are real, the next conversation is about adoption. Every visual choice should serve that arc.

Endeavour's safety article ends with **"SAFETY IS NOT NEGOTIABLE"** in orange uppercase. This deck's equivalent — its final, dominant message — is **"THE WORK NOW IS ADOPTION."** Make sure the room leaves with that line in their heads.

---

*Prepared by Endeavour Mining IT · For external designer engagement · Version 1.0*
