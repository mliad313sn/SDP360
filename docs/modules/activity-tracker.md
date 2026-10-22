# Module — IT Activity Tracker

Moved verbatim from `CLAUDE.md` on 2026-10-22 (SDP-DASH-2.0 step 5, lot 5.5). `CLAUDE.md` is now an index; edit THIS file.

---

## IT Activity Tracker Module (v2 — React rebuild, 2026-05-24)

### Architecture Overview

The tracker is a self-contained module sitting alongside the helpdesk dashboard. It does **not** use Zoho data — all inputs are manually entered by site IT admins. The frontend was rebuilt 2026-05-24 to match the `/dashboard-preview/` design system; the calculation engine is unchanged (every formula ported verbatim into `engine.js`).

```
Browser:
  /activity-tracker.html                 entry point (~60 lines, CSP-exempt)
    ↓ activity-tracker/engine.js         window.TR — scoring engine (pure functions)
    ↓ activity-tracker/api.js            window.TRApi — fetch wrappers
    ↓ React + ReactDOM + Babel (CDN)     same pattern as /dashboard-preview/
    ↓ activity-tracker/App.jsx           composition + 7 panels + modals
    ↓ activity-tracker/styles.css        brand-token-driven page styles

  /activity-tracker-legacy.html          snapshot of the previous 779-line page
                                         (fallback URL; can be deleted later)

API (unchanged — same contract pre/post rebuild):
  GET  /api/tracker/load                 returns the full D object
  POST /api/tracker/save                 persists D (RBAC scope enforced server-side)
  POST /api/tracker/export               returns PPTX blob
  POST /api/tracker/reset                wipes + re-seeds (super_admin)

Server:
  tracker-db.js → tracker.db (SQLite)
  tracker-pptx.js → fixComboChartAxes() → Buffer → res.send()
```

### Frontend file layout

| File | Purpose |
|------|---------|
| `public/activity-tracker.html` | Entry point. Loads tokens, brand chrome, Chart.js, engine.js, api.js, React+Babel, App.jsx. **No business logic.** |
| `public/activity-tracker/engine.js` | Direct port of `score / ss / ps2 / fleetStats / execSummary / genCom / effWeights / gi / si2 / gP / gPS / gPC` from the legacy file. Pure functions on `window.TR`. Reads from a passed-in `D`, doesn't touch globals. **Calculation logic is byte-identical to the legacy.** |
| `public/activity-tracker/api.js` | `window.TRApi.{ load, save, reset, exportPptx }`. Thin wrappers around `/api/tracker/*` — same payloads as before. |
| `public/activity-tracker/App.jsx` | The whole React app. ~120 KB of JSX. Contains: Toolbar, Tabs, all 7 panels (Dashboard / Scoring / Input / Heatmap / Tracker Setup / Targets / Roadmap), `Modal` infrastructure, `RedistributeModal`, `ExportModal`. |
| `public/activity-tracker/styles.css` | All page styles. Uses `_tokens.css` brand variables — same surface as `/index.html`, `/executive.html`, `/meetings.html`. |
| ~~`public/activity-tracker-legacy.html`~~ | **Deleted 2026-09-05** (audit) — the legacy fallback is gone; the React tracker is the only tracker. |

### Seven tabs

| Tab | Status | What it does |
|---|---|---|
| **Dashboard** | Phase 2 + 3.5 | Hero (Overall % + Trend) → Pillar Health + Site Leaderboard → Executive commentary → 4 charts. Replaces the old 8-KPI-strip + 11-site-card-grid layout. |
| **Scoring** | Phase 3 | Per-site activity breakdown grouped by pillar. Effective-weight column lights up when redistribution kicked in. |
| **Input** | Phase 3 | 12-month editable grid. Current month highlighted orange. Debounced auto-save (800 ms) on every cell change + explicit Save button forces flush. |
| **Heatmap** | Phase 3 | Site × activity RAG matrix with pillar band header. Hover a column to highlight + show activity name. |
| **Tracker Setup** | Phase 4 | Pillars (with weights), Active sites, Activities (with M1-M12 Window). All edits go through confirm + redistribute modals. |
| **Targets** | Phase 5 | Per-site target value + active toggle per activity. iOS-style toggles. Bulk "All on / All off" per pillar. |
| **Roadmap** | Phase 5 | 12-month Gantt by pillar. Bars positioned by `a.start → a.end`. Two vertical lines: solid orange = selected period, dashed grey = today. RAG-coloured bars. |

### Modal patterns

Two distinct modal scopes coexist (single-modal-visible-at-a-time, no conflict):

1. **`appModal`** in App state — used by toolbar actions (+ Year, Export PPTX). Renders via the generic `<Modal>` component.
2. **`modal`** in SetupPanel state — used by per-pillar / per-activity / toggle-site flows. Same `<Modal>` plus a `<RedistributeModal>` variant for delete-with-redistribute.

The shared `<Modal>` component supports `wide`, custom confirm label, `confirmKind` (`primary` / `danger`), `confirmDisabled`, Escape-to-close, click-outside-to-close.

`<RedistributeModal>` extends `<Modal>` with three strategies — **proportional** (default, splits by existing relative weights), **equal** (even N-way), **custom** (per-row editable input, must total 100% to confirm). A red cascade-warning banner above the strategy chooser surfaces destructive consequences (number of activities / data cells that will be removed) when applicable.

### Auto-save model

Children mutate `D` in place via `engine.si2()`. They then call `onMutate()` which (a) sets `dirty = true` and (b) bumps a `mutationCounter` state. The autosave `useEffect` watches `[mutationCounter, dirty, roles.CAN_SAVE]` and debounces 800 ms before firing `handleSave()`. Concurrent saves are protected via a `lastSaveRef` tag — only the freshest one updates UI state. The explicit Save button bypasses the debounce.

Sync states surfaced in the toolbar:

```
idle  →  saving  →  synced (1.8 s)  →  idle
              ↘  fail (sticky until next change)
```

### SQLite Schema (tracker.db)

Unchanged from the legacy:

```sql
tracker_config   (id=1)   -- activities[], pillarWeights{}, activeSites[], years[], current_month
tracker_targets            -- PRIMARY KEY (site, activity_ix) — target value + active flag
tracker_inputs             -- PRIMARY KEY (year, site, activity_ix) — months_json [12 values]
```

First-run auto-seeds from `tracker-init.json`. Reset via `POST /api/tracker/reset` (super_admin).

### SQLite Schema (tracker.db)

```sql
tracker_config   (id=1)   -- activities[], pillarWeights{}, activeSites[], years[], current_month
tracker_targets            -- PRIMARY KEY (site, activity_ix) — target value + active flag
tracker_inputs             -- PRIMARY KEY (year, site, activity_ix) — months_json [12 values]
```

First-run auto-seeds from `tracker-init.json`. Reset via `POST /api/tracker/reset` (super_admin).

### RBAC Rules

| Role | Load | Save config/targets | Save own inputs | Save all inputs | Export PPTX |
|------|------|---------------------|-----------------|-----------------|-------------|
| viewer / editor / admin / executive (hierarchical role ALONE) | ✓ | — | — | — | admin+ |
| `tracker-editor` (feature role) + a Site on the account | ✓ | — | ✓ (own site only) | — | — |
| `tracker-admin` (feature role) | ✓ | ✓ | ✓ | ✓ | ✓ |
| super_admin | ✓ | ✓ | ✓ | ✓ | ✓ |

**The hierarchical level does NOT grant tracker saves** — `POST /api/tracker/save` is
`requireRole(['super_admin','tracker-admin','tracker-editor'])` (`server.js` ~7201): an Admin or
even an Executive without a tracker-* feature role is **rejected**, and a `tracker-editor` with no
Site gets 403 "no site assigned" (the scope comes from the account's site). Coordinators = `tracker-editor`
+ their site, nothing else (re-verified 2026-09-03 — an earlier version of this table said "admin ✓ own
site", which was wrong). `siteNameToCode()` in `tracker-db.js` maps the account's `site_name` to a tracker
site code (e.g. `'Mana IT Agent' → 'MGO'`, `'HOUNDE' → 'HGO'`).

### Scoring Engine (tracker-pptx.js / activity-tracker/engine.js)

Both use identical logic — changes must be kept in sync. The frontend half lives in `engine.js` (was inline in `activity-tracker.html` before the v2 rebuild). PPTX generation runs server-side via `tracker-pptx.js` and has its own copy of the math.

```
score(D, site, yr, mo)    → per-activity RAG + weighted score contribution
ss(D, site, yr, mo)       → { g, a, r, active, avg, pScores }
ps2(D, site, pillar, yr, mo) → pillar-level weighted average
fleetStats(D, sites, yr, mo) → { avg, best, attainment }
```

KPI type rules:
- `BOOLEAN`  — 0 or 1 cumulative; GREEN ≥ 1, AMBER ≥ 0.5, RED otherwise (if ended)
- `PERCENT`  — avg over active months; GREEN ≥ target%, AMBER ≥ 75%, RED below
- `MILESTONE`— phase/target; GREEN = complete, AMBER = in progress, RED = none & ended
- `CURRENCY` — actual/target; GREEN ≥ 100%, AMBER ≥ 75%, RED below
- `RATING`   — avg of non-zero months / target; same thresholds as PERCENT
- `COUNT` (default) — Σ months ÷ pro-rated annual target (`ann × months-in-window ÷ window`);
  GREEN ≥ 100% of the pro-rated target, AMBER ≥ 75%, RED below. Score is capped at 100%
  (overachievement earns no bonus); shared activities take the FLEET MAX as YTD.

> **⚠ Frozen change on `main`, not in prod (2026-09-04):** the user adopted the management RAG table
> (Green 90–100 / Amber 75–89 / Red < 75) for COUNT/PERCENT/CURRENCY/RATING — commit `c97ae61` moves
> the GREEN threshold **100 % → 90 %** in BOTH twin engines (BOOLEAN/MILESTONE unchanged). Prod still
> runs the 100 % rule until the reporting cycle ends. Whatever you read in prod decks vs `main` tests,
> that is the reason. The `Input` tab also has an **Export CSV** (site matrix + engine YTD/target/score
> per row) — the one-click proof that "sum of the cells == Scoring YTD" (verified 0 mismatch, 5 sites).

### Tracker PPTX — Layout Reference (10" × 5.625" — LAYOUT_16x9)

> CRITICAL: `LAYOUT_16x9` in pptxgenjs = `cx="9144000"` = **10" wide**.  
> `LAYOUT_WIDE` = `cx="12192000"` = **13.33" wide**. Never confuse the two.

**Slide 1 — IT Ops Strategy Roadmap**

| Element | x | y | w | h | Notes |
|---------|---|---|---|---|-------|
| Header navy | 0 | 0 | 10 | 1.30 | `1E293B` |
| Teal accent | 0 | 1.22 | 10 | 0.08 | `0D9488` |
| Logo | 0.50 | 0.22 | 0.42 | 0.42 | `tracker-icons/logo.png` |
| Title text | 1.10 | 0.12 | 7.00 | 0.48 | White bold |
| Month badge | 8.50 | 0.25 | 1.10 | 0.58 | Teal `0D9488` |
| KPI tiles (5) | 0.475/2.325/4.175/6.025/7.875 | 1.52 | 1.65 | 0.80 | Light bg + accent top bar |
| Chart card L | 0.40 | 2.55 | 4.50 | 2.70 | White, border `E2E8F0` |
| Chart card R | 5.10 | 2.55 | 4.50 | 2.70 | White, border `E2E8F0` |
| Footer text | 0.40 | 5.35 | 9.00 | 0.20 | Italic gray `94A3B8` — NO black bar |

KPI tile accent colors: GREEN=`16A34A`, AMBER=`D97706`, RED=`DC2626`, AVG=`0D9488`, BEST Δ=`0EA5E9`

**Slide 2 — Executive Commentary & Site Summaries**

| Element | x | y | w | h | Notes |
|---------|---|---|---|---|-------|
| Header navy | 0 | 0 | 10 | 0.72 | |
| Teal accent | 0 | 0.65 | 10 | 0.07 | |
| Title | 0.50 | 0.12 | 9.00 | 0.42 | |
| Pillar box i | 0.43+i×(pW+0.14) | 0.84 | dynamic | 0.46 | Full-color bg; icon 0.25×0.25 at x+0.09,y+0.11 |
| Section bar | 0.45 | 1.42 | 0.04 | 0.16 | Teal |
| Site card i | 0.37+i×(cW+0.14) | 1.65 | dynamic | 2.55 | White; colored top bar h=0.055 |
| — Site name | cx+0.10 | 1.75 | | 0.24 | Colored bold |
| — Score % | cx+0.10 | 2.15 | 0.65 | 0.28 | Large bold dark |
| — Delta badge | cx+0.78 | 2.54 | 0.62 | 0.20 | Green/red bg pill |
| — G/A/R badges | cx+0.10/0.61/1.12 | 2.49 | 0.45 | 0.19 | Light bg pills |
| — Separator | cx+0.10 | 2.77 | cW−0.20 | 0.01 | `E2E8F0` |
| — Green icon | cx+0.10 | cardY+1.18 | 0.13 | 0.13 | `green-check.png` |
| — Green text | cx+0.26 | cardY+1.18 | | 0.57 | `334155`, shrinkText |
| — Amber icon | cx+0.10 | cardY+1.90 | 0.13 | 0.13 | `amber-warn.png` |
| — Amber text | cx+0.26 | cardY+1.90 | | 0.46 | `D97706`, italic, shrinkText |
| Gen. Review bar | 0.45 | 4.30 | 9.10 | 0.04 | Teal |
| Gen. Review hdg | 0.55 | 4.35 | 3.00 | 0.18 | Bold dark |
| Bullet icon j | 0.55 | 4.57+j×0.19 | 0.11 | 0.11 | green-check / amber-warn2 |
| Bullet text j | 0.74 | 4.56+j×0.19 | 8.60 | 0.17 | Color: `334155` / `D97706` |
| Footer text | 0.40 | 5.38 | 9.00 | 0.16 | Italic gray — NO black bar |

Dynamic width formulas:
```js
// n pillars:  pW = (9.14 - (n-1)*0.14) / n    startX = 0.43
// n sites:   cW = (9.26 - (n-1)*0.14) / n    startX = 0.37
```

### Tracker Icon Files

Extracted from `IT_Ops_Strategy_Mar2026_template.pptx` and stored in `public/tracker-icons/`:

| File | Source | Used for |
|------|--------|---------|
| `logo.png` | template image1 | Slide 1 header logo |
| `pillar1.png` | template image2 | Network Infra pillar icon |
| `pillar2.png` | template image3 | Biz Partnering pillar icon |
| `pillar3.png` | template image4 | Risk & Compliance pillar icon |
| `pillar4.png` | template image5 | People Dev pillar icon |
| `green-check.png` | template image6 | Site commentary positive + GR bullets 1-3 |
| `amber-warn.png` | template image7 | Site commentary action lines |
| `amber-warn2.png` | template image8 | General Review amber bullets |

### Known Pitfalls

| Pitfall | Rule |
|---------|------|
| `LAYOUT_16x9` vs `LAYOUT_WIDE` | Always verify output `sldSz cx`. `9144000`=10", `12192000`=13.33" |
| `tracker-icons/` missing on server | Copy folder before `pm2 reload` — server logs `null` images silently |
| Commentary always generic | Means actuals not yet entered. Check DB `tracker_inputs` has non-zero months |
| `better-sqlite3` binding error | Native module compiled per OS/arch. Rebuild if moving to new server |
| Admin saving other site's data | `saveTracker(D, userSite)` silently skips inputs for other sites — this is correct RBAC |
| `fixComboChartAxes` not applied | Without it, file opens in LibreOffice but not PowerPoint. Always pipe through it |
| **Engine drift between frontend + PPTX** | `engine.js` (browser) and `tracker-pptx.js` (server) both implement the scoring math. When changing a KPI rule or RAG threshold, update BOTH files — otherwise the live page and the exported PPTX disagree. |
| **CSP blocks the React tracker** | `/activity-tracker.html` and `/activity-tracker/*` need `unsafe-eval` + unpkg.com for Babel/React CDN. The path-scoped exception is at `server.js:182`. If the page silently renders blank with a "Refused to evaluate" console error after a server.js edit, that block was probably moved or its path list edited. |
| **Stale activity_ix after pillar/activity delete** | Deleting an activity must `splice()` it out of `D.activities`, every `D.targets[s]` array AND every `D.inputs[yr][s]` array — otherwise the engine's activity_ix lookups misalign and rows shift. The Phase 4 pillar-delete handler does this for every activity under the deleted pillar; activity-delete does it for the single index. Don't regress to `Array.filter()` which leaves the parallel arrays unchanged. |
| **Legacy tracker page — RETIRED 2026-09-05** | `public/activity-tracker-legacy.html` was deleted in the 2026-09-05 audit (the React tracker had been live since 2026-05-24; the legacy page was served via `express.static` with no version injection — a standing violation of the caching principle). Nothing referenced it. If a bookmark 404s, that is why. |

---
