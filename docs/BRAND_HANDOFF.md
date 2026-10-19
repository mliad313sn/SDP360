# Brand Design System — Developer Handoff

> Companion to merge commit `9882318` (Phase 1 of the EDV brand-system rollout
> for the IT Operations Dashboard). This document is the developer's reference
> for using the new tokens, icons, and components when building or modifying
> any page in `public/`.

---

## Overview

The dashboard previously rendered with ad-hoc colour hex codes, emoji icons
(🛠 📋 📊 ⚡ ⬇ 📡 etc.), and inconsistent typography per page. A team member
flagged the emoji as "Claudy" — chat-bot signature creep into a corporate
IT tool. Phase 1 of this rollout replaces that with:

1. A single design-token source (`_tokens.css` + JS mirror `brand-tokens.js`)
2. A Lucide-style monochrome icon library that any page can consume
3. Branded login hero, header nav, and empty-state patterns
4. Hooks for the Goldy mascot (assets pending from the EDV brand pack)
5. A migration path for the existing PPTX generators

Visual identity sourced from **EDV Group Brand Guidelines — July 2022** (slides
9–15: palette + typography + tints).

---

## Layout

The dashboard is a desktop-first internal IT tool. Most user-facing pages render
inside a fixed-width shell (~1200–1600 px content area). No mobile-specific
breakpoints in scope for Phase 1 — the dashboard is consumed on corporate
laptops via RDP-style sessions or directly from a domain-joined workstation.

| Breakpoint | Behaviour |
|---|---|
| ≥ 1024 px | Default — full nav, full KPI grid |
| 768 – 1024 px | Components still render; tables scroll horizontally |
| < 768 px | Out of scope. Login page card is centred and remains usable; data-heavy pages are not optimised |

---

## Design Tokens Used

The canonical source is `public/_tokens.css`. Node-side code (PPTX generators)
imports the mirror at `public/brand/brand-tokens.js`. The two files must agree
— a future build step should validate.

### Colour palette

| Token | Value | Usage |
|---|---|---|
| `--edv-orange` | `#EF631A` | Primary CTAs, brand accent bar, focus rings |
| `--edv-orange-dark` | `#CA6419` | Button hover |
| `--edv-orange-75` | `#F79853` | Accent gradients (login top bar) |
| `--edv-blue` | `#145FAE` | Secondary action, links, informational |
| `--edv-yellow` | `#FFCD18` | Branded surfaces only (banners) — **never** for status text (fails AA contrast on white) |
| `--edv-green` | `#1B9A3A` | RAG green, success badges |
| `--edv-slate` | `#3A4A60` | Header background, body bg gradient stop |
| `--edv-grey` | `#524F4E` | Body text, dark UI elements |
| `--edv-red` | `#D90038` | RAG red, danger banners |
| `--color-warning` | `#D97706` | Status warning text (amber that meets AA on white — used INSTEAD of `--edv-yellow` for legible text) |
| `--color-text` | `var(--edv-grey)` | Default body text |
| `--color-text-muted` | `#7B7B7B` | Secondary text, captions |
| `--color-border` | `#E2E5EA` | UI borders, table rules |

Plus 75 % / 50 % tints for each primary colour (`--edv-orange-75`, `--edv-blue-50`, etc.) and a +20 %-black variant (`--edv-orange-dark`, `--edv-blue-dark`, etc.) for hover/active states.

### Typography

| Token | Value | Usage |
|---|---|---|
| `--font-sans` | `'Libre Franklin', 'Franklin Gothic', system-ui, …` | Body, default UI |
| `--font-display` | `'Libre Franklin', 'Franklin Gothic', sans-serif` | Headings, hero type |
| `--font-mono` | `'DM Mono', 'JetBrains Mono', ui-monospace, …` | Code, timestamps |

**Type stack:**

- `Franklin Gothic` listed first for hosts with the licenced WOFF2 installed.
- `Libre Franklin` (Google Fonts) is the open-source equivalent and is loaded by every page (`<link href="…Libre+Franklin…">`). Identical proportions; ~95 % visual match.
- `system-ui` / `Segoe UI` is the safety net.

The licenced Franklin Gothic WOFF2 is **not yet in the repo** — drop in `public/brand/fonts/` and add an `@font-face` declaration in `_tokens.css` when available.

### Spacing scale (4 pt grid)

`--space-1` 4 px · `--space-2` 8 px · `--space-3` 12 px · `--space-4` 16 px · `--space-5` 20 px · `--space-6` 24 px · `--space-8` 32 px · `--space-10` 40 px · `--space-12` 48 px · `--space-16` 64 px.

### Radius

`--radius-sm` 4 px (chips) · `--radius-md` 6 px (buttons, inputs) · `--radius-lg` 10 px (cards) · `--radius-xl` 14 px (hero panels, login card) · `--radius-pill` 9999 px.

### Shadow

`--shadow-sm` (table borders) · `--shadow-md` (cards) · `--shadow-lg` (modals) · `--shadow-xl` (login card, popovers).

### Motion

`--motion-fast` 120 ms · `--motion-base` 180 ms · `--motion-slow` 280 ms · `--ease-standard` `cubic-bezier(.2, 0, .2, 1)`.

---

## Components

### 1. Brand icon library (`public/brand/icons.js` + `icons.css`)

Lucide-style monochrome line icons. 30+ icons covering nav, actions, states, and domain-specific concepts.

**Loaded via:** `<script nonce="%%CSP_NONCE%%" src="brand/icons.js"></script>` (placed BEFORE `_shell.js`).

#### Available icons

| Category | Names |
|---|---|
| Nav | `headset`, `file-text`, `trending-up`, `gauge`, `line-chart`, `target`, `presentation`, `sliders`, `book-open` |
| Actions | `zap`, `download`, `upload`, `save`, `refresh-cw`, `copy`, `edit`, `trash`, `plus`, `x`, `check`, `chevron-down`, `chevron-right` |
| State | `cloud-off`, `wifi-off`, `alert-circle`, `alert-triangle`, `info`, `lightbulb` |
| Domain | `bar-chart-3`, `users`, `user`, `calendar`, `clock`, `filter`, `search`, `log-out`, `shield`, `shield-check` |

#### Usage patterns

| Context | Markup | Notes |
|---|---|---|
| Static HTML | `<i class="icon icon-zap"></i>` | Auto-hydrated by `icons.js` on DOMContentLoaded |
| Dynamic JS | `btn.innerHTML = EDV_ICONS.html('zap') + ' Force Sync'` | Use when replacing button text after a state change |
| Template literal | `` `${EDV_ICONS.html('download')} Export CSV` `` | Same |

#### Size modifiers

| Class | Width |
|---|---|
| `.icon` (default) | `1em` — scales with surrounding text |
| `.icon-sm` | `0.85em` |
| `.icon-md` | `1.15em` |
| `.icon-lg` | `1.5em` |
| `.icon-xl` | `2em` |
| `.icon-2xl` | `3em` |

#### Tint modifiers

`.icon-tint-success`, `.icon-tint-warning`, `.icon-tint-danger`, `.icon-tint-info`, `.icon-tint-muted`, `.icon-tint-orange` — override the inherited text colour for status indicators.

#### What to keep as text (NOT replace with icons)

The brand README explicitly preserves these — they're BMP characters that render at text size and aren't "Claudy":

- ✓ ✕ (checkmarks / crosses in tables)
- ⚠ (warning text marker)
- ✏ (inline edit affordance)
- 🟢 🟡 🔴 (RAG status — replacing loses the colour semantic)
- 😊 😟 (CSAT emoticons — emotional indicators are contextually right)

### 2. Login page hero (`public/login.html`)

Visual upgrade over the prior plain card:

| Element | Spec |
|---|---|
| Body background | `radial-gradient(circle at 20% 0%, rgba(239,99,26,.08), transparent 55%), linear-gradient(135deg, #3A4A60 0%, #2A3445 100%)` |
| Card | `bg #FFF`, `radius var(--radius-xl)`, `padding 48px 48px 36px`, `shadow var(--shadow-xl)`, `max-width 440px` |
| Card top accent bar | 4 px tall, `linear-gradient(90deg, var(--edv-orange) 0%, var(--edv-orange-75) 100%)` |
| Logo plinth | 104 × 104, `radius-xl`, slate bg, EDV white logomark at 72 % size, subtle orange `rgba(239,99,26,.18)` ring outside the border-radius |
| Wordmark eyebrow | "ENDEAVOUR MINING" — `font-display`, `13 px`, `weight 600`, `letter-spacing .18em`, uppercase, muted grey |
| Wordmark display | "IT Operations Dashboard" — `font-display`, `26 px`, `weight 800`, slate colour, `letter-spacing -0.01em` |
| Subtitle | "Welcome back. Sign in to continue." — sentence case, body weight |
| Goldy mascot | `<img src="brand/goldy/welcome-safety.png" onerror="this.parentElement.style.display='none'">` — appears above the card when the PNG ships; gracefully hides itself until then |
| Sign In button | Orange, `radius-md`, `padding 13px`, `font-weight 700`, hover: 1 px lift + soft orange shadow + arrow "→" animates in |
| Footer | Tracked uppercase, hairline divider above |

### 3. Header navigation (`public/_shell.js` + `_shell.css`)

Single source of truth for the top nav across every page that loads `_shell.js`.

| Nav item | Icon | Route | Roles |
|---|---|---|---|
| Operations | `headset` | `index.html` | any |
| Reports | `file-text` | `reports.html` | any |
| Performance (parent) | `trending-up` | dropdown → first accessible | any |
| └─ Executive Scorecard | `gauge` | `executive.html` | executive+ |
| └─ Analytics | `line-chart` | `analytics.html` | admin+ |
| └─ Activity Tracker | `target` | `activity-tracker.html` | any |
| Deck Builder | `presentation` | `executive-report.html` | report-author / executive |
| Admin | `sliders` | `reports.html#admin` | admin+ |
| Help | `book-open` | `help.html` (new tab) | any |

Icons render at 17 px in the main nav, 16 px in dropdowns (`.shell-nav-icon svg { width: 17px }`). Colour inherits from the parent (`currentColor`), so active-tab orange highlight just works without per-icon overrides.

### 4. Empty-state component (`public/brand/components.css`)

For "no data" / "offline" / "session expired" moments. Three variants.

```html
<div class="edv-empty-state">
  <img class="edv-goldy edv-goldy-md"
       src="brand/goldy/welcome-safety.png"
       onerror="this.style.display='none'" alt="">
  <h3 class="edv-empty-state__title">Nothing to show yet</h3>
  <p  class="edv-empty-state__body">Tickets will appear once the sync runs.</p>
  <button class="edv-empty-state__action">Refresh</button>
</div>
```

Variants: `.edv-empty-state--error` (title in red) · `.edv-empty-state--success` (title in green).

### 5. Hero panel (`.edv-hero`)

Large welcome surface — for executive page headers, post-login splash, monthly-report covers. Slate gradient background, white text, display type, optional Goldy on the right.

### 6. Section divider (`.edv-section-divider`)

Hairline rule + optional Goldy in the centre — for chapter breaks on long pages like `help.html`.

### 7. Goldy badge (`.edv-goldy-badge`)

Small pill with a 28 px circular Goldy avatar + label — useful inline in tooltips or status chips.

---

## States and Interactions

| Element | State | Behaviour |
|---|---|---|
| Sign In button | Default | Solid orange + soft orange shadow |
| Sign In button | Hover | `transform: translateY(-1px)`, deeper shadow, "→" arrow fades in |
| Sign In button | Active | `transform: translateY(0)` (returns to baseline) |
| Sign In button | Disabled | Grey, no transform, no shadow |
| Sign In button | Loading | Spinner replaces text |
| Login input | Default | 1.5 px border `--color-border` |
| Login input | Focus | Border → `--edv-orange`, 3 px ring `rgba(239,99,26,.15)` |
| Nav tab | Default | Muted text + small icon |
| Nav tab | Hover | Lightens to full text colour |
| Nav tab | Active | Orange/teal indicator bar below (page-dependent), icon picks up active colour via `currentColor` |
| Icon (raw) | Default | Inherits parent text colour, 1 em size |
| Icon (in `.icon-tint-*`) | Default | Locked to semantic colour token |
| Empty-state | Asset present | Goldy renders above title |
| Empty-state | Asset missing | `<img>` hides itself via `onerror`, layout collapses gracefully |

---

## Responsive Behaviour

Phase 1 focuses on desktop. The login page is the only surface explicitly tested for ≤ 768 px (centered card with 24 px viewport padding).

| Breakpoint | Login | Index / Reports / Executive |
|---|---|---|
| ≥ 1024 px | Card centered, 440 px max | Default desktop layout |
| 768 – 1024 px | Same | Tables scroll horizontally, KPI tiles wrap |
| < 768 px | Card fills viewport with `padding: 24px` | Not optimised — users on phones reported very rarely. Out of scope for Phase 1. |

---

## Edge Cases

| Case | Behaviour |
|---|---|
| **Goldy PNG missing** | `<img onerror="…">` hides the element; surrounding layout collapses cleanly. No console error. |
| **Franklin Gothic WOFF2 missing** | Falls back to Libre Franklin (loaded from Google Fonts on every page). ~95 % visual identical. |
| **`dashboard-shared.js` failed to load** | Pages have local fallback definitions for `xRows()` and `isResOverdue()` so they still render; canonical names are still callable. |
| **`brand/icons.js` failed to load** | `_shell.js` uses an inline stub returning empty strings — header nav renders text labels only, no icons. |
| **Empty data set** | Use `.edv-empty-state` markup with the `welcome-safety` Goldy pose and clear next-action copy. |
| **Long usernames / site names** | All text containers use `word-break` / overflow scrolling. No fixed-width labels in user-facing components. |
| **Unicode mascot** | Goldy is the only mascot — no ad-hoc emoji avatars permitted in new components. |

---

## Animation / Motion

| Element | Trigger | Animation | Duration | Easing |
|---|---|---|---|---|
| Sign In button | Hover | `translateY(-1px)` + shadow ramp + arrow fade-in | `var(--motion-base)` 180 ms | `var(--ease-standard)` |
| Sign In button | Active | `translateY(0)` | `var(--motion-fast)` 120 ms | `var(--ease-standard)` |
| Inputs | Focus | Border colour + ring grow | `var(--motion-base)` 180 ms | `var(--ease-standard)` |
| Spinner | Loading | `rotate(360deg)` | 700 ms linear infinite | — |
| Header nav active highlight | Tab change | Indicator slides into place | `var(--motion-fast)` 120 ms | linear |

No page-load animations (would slow perceived performance on a data-heavy dashboard). No scroll-linked animation.

---

## Accessibility Notes

| Concern | How it's handled |
|---|---|
| Icon labels | Icons used as decoration carry `aria-hidden="true"`. Icon-only buttons (e.g. group config gear) have `aria-label`. |
| Focus visibility | All interactive elements show a 3 px orange focus ring (`box-shadow: 0 0 0 3px rgba(239,99,26,.15)`). |
| Colour contrast | Body text `#524F4E` on `#FFF` passes AA. Orange `#EF631A` text on white passes AA only at ≥ 18 pt or bold — used for buttons (always bold) and never for plain body text. **Yellow `#FFCD18` fails AA against white in any size — use `--color-warning` (`#D97706`) for warning text.** |
| Keyboard | Tab order follows DOM order. Login form: username → password → Sign In. Nav: left-to-right across the bar. Dropdowns open on click of the caret or Enter on the parent. |
| Screen reader | Decorative SVG icons have `aria-hidden="true"` and no descriptive text. Buttons have plain text labels alongside the icon — icon does not stand in for label. |
| Reduced motion | Not yet honoured. Add `@media (prefers-reduced-motion: reduce)` rules in a follow-up if needed. |

---

## Migration Patterns (for future page updates)

When touching any HTML page in `public/`:

### Pattern 1 — Replace an emoji with an icon

| Find | Replace with |
|---|---|
| `<button>⚡ Force Sync</button>` | `<button><i class="icon icon-zap"></i>Force Sync</button>` |
| `<h3>📊 Group:</h3>` | `<h3><i class="icon icon-users"></i>Group:</h3>` |
| In JS: `btn.textContent = '⬇ Export CSV';` | `btn.innerHTML = (window.EDV_ICONS ? window.EDV_ICONS.html('download') : '') + ' Export CSV';` |

### Pattern 2 — Replace a hardcoded hex with a token

| Find | Replace with |
|---|---|
| `style="color:#EF631A"` | `style="color:var(--edv-orange)"` |
| `style="background:#3A4A60"` | `style="background:var(--edv-slate)"` |
| In `const C = { orange:'E87722', … }` (PPTX) | `const { C, EDV } = require('./public/brand/brand-tokens');` |

### Pattern 3 — Replace a generic empty state with `.edv-empty-state`

Wrap the messaging div in the markup pattern from §"Components → 4. Empty-state". When the Goldy PNGs ship, the empty state automatically lights up.

---

## Asset Dependencies (still pending)

| Asset | Path | Source | Effect when missing |
|---|---|---|---|
| Goldy "welcome-safety" PNG | `public/brand/goldy/welcome-safety.png` | EDV intranet brand pack | Login mascot hidden; layout unchanged |
| Goldy "academy" PNG | `public/brand/goldy/academy.png` | Same | Help section dividers fall back to a plain rule |
| Goldy "4ps-values" PNG | `public/brand/goldy/4ps-values.png` | Same | Executive hero panels still render without mascot |
| Goldy "recruiting" PNG | `public/brand/goldy/recruiting.png` | Same | Admin/Add User screen unbranded |
| Goldy "security" PNG | `public/brand/goldy/security.png` | Same | 401/403 pages plain (would otherwise show security pose) |
| Franklin Gothic WOFF2 | `public/brand/fonts/franklin-gothic.woff2` | Brand team licence | Libre Franklin (Google Fonts) substitutes — ~95 % visual match |

Drop assets into the named paths and they're picked up automatically on next page load. No code change required.

---

## What's NOT in Phase 1 (deliberately deferred)

| Item | Why deferred | Track as |
|---|---|---|
| Per-PPTX-slide colour migration from `C.*` (legacy) to `EDV.*` (brand) | Visual change to deliverables; needs per-slide review with stakeholders | Phase 2 ticket |
| Mass replacement of remaining ~150 functional emoji (✓ ⚠ ✏ etc.) | These are BMP characters, not Claudy. Replacing them risks losing visual semantics for status / RAG indicators | Out of scope |
| Mobile-optimised layouts | Dashboard is desktop-first; mobile usage is rare | Future enhancement |
| Dark mode | No business request | Future enhancement |
| `prefers-reduced-motion` handling | Phase 2 polish | Phase 2 ticket |
| Goldy renders in PPTX section dividers | Asset-blocked + per-slide design pass | Phase 3 |

---

## Files Touched in this Rollout

```
NEW
  public/brand/brand-tokens.js       — JS mirror of _tokens.css for PPTX
  public/brand/components.css        — .edv-empty-state, .edv-hero, .edv-section-divider
  public/brand/icons.js              — Lucide-style icon library
  public/brand/icons.css             — .icon class system + size + tint modifiers
  public/brand/README.md             — usage guide
  public/brand/goldy/.gitkeep        — placeholder for the 5 mascot PNGs
  public/brand/fonts/.gitkeep        — placeholder for Franklin Gothic WOFF2
  docs/BRAND_HANDOFF.md              — this document

UPDATED
  public/_shell.js                   — header nav uses SVG icons via EDV_ICONS
  public/_shell.css                  — .shell-nav-icon SVG sizing rules
  public/login.html                  — branded hero + gradient bg + display type
  public/index.html                  — button icons; consumes shared lib helpers
  public/executive.html              — phantom groups removed, ITY/Kalana added,
                                       avgResolveDays aligned with AP/index,
                                       Chart.js defer removed
  public/executive-report.html       — local isResOverdue removed (drift fix)
  public/reports.html                — emoji → SVG icons (~22 replacements)
  public/activity-tracker.html       — tab icons + Save/Reset buttons
  public/analytics.html              — icon library wired in
  public/lib/dashboard-shared.js     — adds canonical isResOverdue + xRows
  reports-weekly-pptx.js             — imports palette from brand-tokens.js
  reports-monthly-pptx.js            — same migration
```

Total: 7 new + 12 updated = 19 files in merge commit `9882318`.

---

## Build / Deploy

No new dependencies, no build step. Static files only. Deploy via the existing pattern:

```cmd
:: From dev laptop cmd.exe
_deploy.cmd

:: From prod via RDP (necessary because _htmlCache holds the 6 main HTML files in memory)
pm2 reload endeavour-dashboard --update-env
```

---

## Versioning & Update Protocol

When a brand value changes (palette shift, new typography, new icon, etc.):

1. Update `_tokens.css` (web side).
2. Update `brand-tokens.js` (Node side) with the **same** value.
3. Update any reference in this document.
4. Single commit, all files. Don't let them drift.

When adding an icon to the library:

1. Find the SVG path data on `lucide.dev` (MIT licensed).
2. Add to `LIB = { … }` in `brand/icons.js` with the lucide name.
3. Optional: add a CSS-only `mask-image` class to `brand/icons.css` for static usage.
4. Document in §"Components → 1. Brand icon library" of this file.

---

## Contact

For brand-asset delivery (Goldy PNGs, Franklin Gothic WOFF2): EDV Brand Team.
For dashboard code questions: SDP Dashboard team (per `CLAUDE.md`).

---

*Document version 1.0 — corresponds to merge commit `9882318` on `claude/busy-kirch-2a4176`. Update version + date on every revision.*
