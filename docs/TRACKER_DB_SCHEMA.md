# IT Activity Tracker — Database Schema & Architecture

**Purpose**: Hand-off document for a Claude session to ramp up on the
Endeavour Mining IT Activity Tracker — what it tracks, the SQLite
schema, the in-memory shape of state, and the RBAC rules around
mutation. Self-contained: paste this whole document into a new Claude
session and you have enough to navigate / extend the tracker without
opening the codebase first.

---

## 1. What the tracker does

The IT Activity Tracker is a per-site, per-month operating-KPI scorecard
for the Endeavour Mining IT operations team. Each of **11 sites** (Mana,
Houndé, Lafigué, Ity, Sabodala, Abidjan, Dakar, Kalana, Exploration,
Ouagadougou, Tanda) self-reports against **31 activities** grouped under
**4 pillars** (Network Infra, Business Partner, Risk & Compliance,
Manage People). Inputs are filled monthly (12 values per activity per
year per site) and rolled up into an Activity Score, Pillar Score, Site
Score, Fleet Score.

The tracker has its own SQLite database (`tracker.db`) separate from
the helpdesk DB (`reports.db`), the meetings DB (`meetings.db`), and the
inspection DB (`inspection.db`).

---

## 2. SQLite schema (`tracker.db`)

Created at boot via `_initSchema` in `tracker-db.js`. WAL journal mode +
foreign_keys=ON.

### 2.1 `tracker_config` (single-row global config)

```sql
CREATE TABLE IF NOT EXISTS tracker_config (
  id                  INTEGER PRIMARY KEY DEFAULT 1,
  activities_json     TEXT    NOT NULL DEFAULT '[]',
  pillar_weights_json TEXT    NOT NULL DEFAULT '{}',
  active_sites_json   TEXT    NOT NULL DEFAULT '[]',
  years_json          TEXT    NOT NULL DEFAULT '[]',
  current_month       INTEGER NOT NULL DEFAULT 4,
  updated_at          TEXT    DEFAULT (datetime('now'))
);
```

| Column | Shape | Purpose |
|---|---|---|
| `id` | always 1 | Singleton row. Hard-coded PK. |
| `activities_json` | `Activity[]` JSON | Master list of 31 activities (see §4). |
| `pillar_weights_json` | `{pillar: weight}` | Default: P1=0.30 · P2=0.35 · P3=0.20 · P4=0.15. Sum = 1.00. |
| `active_sites_json` | `string[]` | Which site codes are active *this year*. Default: 5 mines (MGO, HGO, SML, ITY, SGO). |
| `years_json` | `number[]` | All tracked years. Default `[2026]`. |
| `current_month` | 1..12 | Default month the UI lands on. Updates as the calendar moves. |

### 2.2 `tracker_targets` (per site × activity)

```sql
CREATE TABLE IF NOT EXISTS tracker_targets (
  site        TEXT    NOT NULL,           -- site code (MGO, HGO, ...)
  activity_ix INTEGER NOT NULL,           -- 0-based index into activities array
  target      TEXT    NOT NULL DEFAULT '0',
  active      INTEGER NOT NULL DEFAULT 0, -- 0 | 1
  updated_at  TEXT    DEFAULT (datetime('now')),
  PRIMARY KEY (site, activity_ix)
);
```

| Column | Shape | Purpose |
|---|---|---|
| `site` | tracker code | 'MGO', 'HGO', 'SML', 'ITY', 'SGO', 'ABJ', 'DKR', 'KLN', 'EXP', 'EDV', 'TND' |
| `activity_ix` | 0..30 | Position of the activity in `tracker_config.activities_json` |
| `target` | TEXT | Stored as text because targets can be **either** a number (e.g. `52` weekly IT meetings/year) **or** the literal string `'TRUE/FALSE'` for BOOLEAN activities. |
| `active` | 0 \| 1 | If 0, the activity is hidden in the UI + skipped in scoring for that site. |

### 2.3 `tracker_inputs` (the actuals)

```sql
CREATE TABLE IF NOT EXISTS tracker_inputs (
  year        INTEGER NOT NULL,
  site        TEXT    NOT NULL,
  activity_ix INTEGER NOT NULL,
  months_json TEXT    NOT NULL DEFAULT '[0,0,0,0,0,0,0,0,0,0,0,0]',
  updated_at  TEXT    DEFAULT (datetime('now')),
  PRIMARY KEY (year, site, activity_ix)
);
```

| Column | Shape | Purpose |
|---|---|---|
| `year` | 4-digit year | One row per `(year, site, activity)`. |
| `site` | tracker code | Same set as tracker_targets. |
| `activity_ix` | 0..30 | Aligned with the activities array index. |
| `months_json` | `[12]` JSON array | Index 0 = January, 11 = December. Values are: integers (COUNT/CURRENCY/RATING), 0/1 (BOOLEAN per month), or % (PERCENT). For MILESTONE: phase number reached. |

---

## 3. Sites catalog (hard-coded in `tracker-init.json`)

11 site codes + display names + brand colors:

| Code | Name | Country | Color |
|---|---|---|---|
| `MGO` | Mana | BF | `#0D9488` teal |
| `HGO` | Houndé | BF | `#D97706` amber |
| `SML` | Lafigué | CI | `#7C3AED` violet |
| `ITY` | Ity | CI | `#B8860B` ochre |
| `SGO` | Sabodala | SN | `#2563EB` blue |
| `ABJ` | Abidjan | CI | `#6366F1` indigo |
| `DKR` | Dakar | SN | `#0891B2` cyan |
| `KLN` | Kalana | ML | `#DC2626` red |
| `EXP` | Exploration | multi | `#65A30D` lime |
| `EDV` | Ouagadougou-EDV1 | BF | `#9333EA` purple |
| `TND` | Tanda | CI | `#EF631A` orange |

Default `active_sites` (5 producing mines): `MGO, HGO, SML, ITY, SGO`.

The `SITE_MAP` constant in `tracker-db.js` translates the `site_name`
field on the dashboard's `users` table into a tracker site code — used
to scope `saveTracker(D, userSite)` writes (see §7).

---

## 4. Activities catalog (31 activities, 4 pillars)

Each activity in `activities_json` is a JSON object:

```json
{
  "id":     1,
  "num":    1,
  "pillar": "P1-Network Infrast",
  "name":   "Link 1 Upgrade",
  "kpi":    "BOOLEAN",
  "weight": 0.12,
  "start":  1,
  "end":    12,
  "shared": false
}
```

| Field | Type | Meaning |
|---|---|---|
| `id` | int | Stable identifier |
| `num` | int | Display number (some legacy numbers were skipped — e.g. 11 jumps to 12) |
| `pillar` | string | One of: `P1-Network Infrast`, `P2-Business Partner`, `P3-Risk & Compliance`, `P4-Manage People` |
| `name` | string | Human label |
| `kpi` | string | `BOOLEAN` \| `COUNT` \| `PERCENT` \| `MILESTONE` \| `CURRENCY` \| `RATING` (see §6) |
| `weight` | 0..1 | Within-pillar weight. Sum per pillar should = 1.00. |
| `start`, `end` | 1..12 | Active window (months). Used by the Roadmap view + scoring (months outside are skipped). |
| `shared` | bool | If true, all sites share one value (group-level KPI, not per-site). |

### Pillar breakdown

| Pillar | Default weight | # activities |
|---|---|---|
| P1-Network Infrast | 30% | 10 |
| P2-Business Partner | 35% | 9 |
| P3-Risk & Compliance | 20% | 9 |
| P4-Manage People | 15% | 3 |
| **Total** | **100%** | **31** |

(Weights within each pillar normalise to 1.00 — engine details in §6.)

### Activity list — abridged

P1 (Network Infra) — Link 1 Upgrade · Link 2 Upgrade · Bandwidth Dynamic Allocation · Distribution Layer Standardization · Local Infrastructure Monitoring · Radio Monitoring · Radio Upgrade · Coverage & Capacity Improvement · Resilience & DC Standardization · Centralized Fire Suppression.

P2 (Business Partner) — Weekly IT Meeting · Monthly/Quarterly Cost Review · Monthly Department Meeting · Business Department Incubation · Toolbox & Awareness Campaigns · IT Achievements Communication · End-User Satisfaction Survey · Stakeholder Management Workshops · IT Project/Initiatives.

P3 (Risk & Compliance) — Monthly Risks & MI Review · Quarterly Backup/Restore Test · Monthly Changes Review · Bi-Weekly CAB · Daily Check · Monthly Inspection · VFL Visible Felt Leadership · Weekly Hazards Reporting · Monthly Access Review.

P4 (Manage People) — Monthly Mentoring · Quarterly People Assessment · Mid-Year & Yearly Review.

The full canonical list lives in `tracker-init.json` (top-level `activities` array).

---

## 5. The in-memory D object (frontend state)

`loadTracker()` (server-side) and the React App (frontend) both work
with a single state object `D` of this shape:

```typescript
type D = {
  sites:        ['MGO', 'HGO', ...];          // all 11 codes
  siteNames:    { MGO: 'Mana', ... };
  siteColors:   { MGO: '#0D9488', ... };
  activeSites:  ['MGO', 'HGO', 'SML', 'ITY', 'SGO'];   // current scope
  currentMonth: 1..12;
  year:         2026;
  years:        [2026];
  activities:   Activity[];                            // 31 entries
  pillarWeights:{ 'P1-Network Infrast': 0.30, ... };

  // PER-SITE TARGETS — indexed by site code
  targets: {
    MGO: [{ target: 'TRUE/FALSE' | number, active: bool }, ...31],
    HGO: [...31],
    // ...
  };

  // PER-SITE PER-YEAR INPUTS — 12 months per (year, site, activity_ix)
  inputs: {
    2026: {
      MGO: [
        /* activity_ix=0 */ [0,0,1,0,0,0,0,0,0,0,0,0],  // Jan..Dec
        /* activity_ix=1 */ [0,0,0,1,0,0,0,0,0,0,0,0],
        // ...31 arrays of 12
      ],
      HGO: [...]
    }
  };
};
```

Everything else (scoring, roadmap, heatmap) is derived from this `D`
object by pure functions in `public/activity-tracker/engine.js`.

---

## 6. KPI types & scoring (the engine)

`engine.js` (frontend) and `tracker-pptx.js` (server-side PPTX generator)
both implement the same scoring rules:

### Per-activity score

| KPI type | Rule | RAG threshold |
|---|---|---|
| `BOOLEAN` | Sum of true months in `[start..end]`. | GREEN if ≥ 1 in window, AMBER if ≥ 0.5, RED otherwise (only if window has ended) |
| `COUNT` | Sum of months in `[start..end]`. Compared to target. | GREEN if ≥ 100% of target, AMBER if ≥ 75%, RED otherwise |
| `PERCENT` | Average of non-zero months. | GREEN if ≥ target%, AMBER if ≥ 75%, RED below |
| `MILESTONE` | Max phase reached in window. | GREEN if complete, AMBER if in-progress, RED if no activity & window ended |
| `CURRENCY` | actual / target. | Same thresholds as COUNT |
| `RATING` | Average of non-zero months / target. | Same thresholds as PERCENT |

### Per-pillar score (weighted average within pillar)

```
pillar_score = Σ (activity_score × activity_weight) for active activities in pillar
             ÷ Σ (activity_weight) for active activities in pillar
```

Activities marked `active=false` for that site are excluded both from
the numerator and denominator — that's the "effective weights" model.

### Per-site score (weighted average across pillars)

```
site_score = Σ (pillar_score × pillar_weight)
```

Default pillar weights: P1=30%, P2=35%, P3=20%, P4=15%. These are
configurable via `tracker_config.pillar_weights_json`.

### Fleet score (across active sites)

```
fleet_score = Σ site_score for site in activeSites ÷ count(activeSites)
```

---

## 7. RBAC for mutation (`saveTracker`)

`saveTracker(D, userSite)` — server-side write path with role enforcement.

| Role | userSite arg | What's saved |
|---|---|---|
| `super_admin`, `executive` | `null` | Everything: config (activities, pillarWeights, activeSites, years, currentMonth) + targets + inputs |
| `tracker-admin` | their site code | Inputs only, scoped to their own site. Config + targets unchanged. |
| `editor`, `viewer` | n/a | Server-side gate refuses the write. |

The site-scoping is enforced at line 266 of `tracker-db.js`:

```javascript
if (userSite && site !== userSite) continue;
```

The route handler (`server.js:/api/tracker/save`) resolves the user's
`site_name` → tracker code via `siteNameToCode()` and passes it as
`userSite`.

---

## 8. API surface (`/api/tracker/*`)

All routes guarded by `requireReportSession` (session cookie +
`x-report-token` header). Body parser limit: 5 MB on `/save`.

| Method · Path | Role | Purpose |
|---|---|---|
| `GET /load` | any | Returns the full D object |
| `POST /save` | tracker-admin (own site) / executive+ (any) | Persist D. Scope auto-applied based on user. |
| `POST /export` | admin+ | Returns 2-slide PPTX (LAYOUT_16x9, 10" × 5.625") of the strategy roadmap |
| `POST /reset` | super_admin or tracker-admin | Wipe + re-seed from `tracker-init.json`. Backs up first. |
| `POST /delete-year` | super_admin or tracker-admin | Drop one year + its inputs. Backs up first. |
| `POST /preview-delete-year` | same | Cascade preview before confirming a delete |

---

## 9. Key files & their roles

| File | Role |
|---|---|
| `tracker-db.js` | SQLite layer — schema, CRUD, RBAC, seeding |
| `tracker-init.json` | Default seed (11 sites · 31 activities · default targets · default 2026 inputs) |
| `tracker-pptx.js` | Server-side 2-slide PPTX generator (LAYOUT_16x9 = 10" × 5.625") |
| `public/activity-tracker.html` | React shell entry point (~60 lines, CSP-exempt) |
| `public/activity-tracker/engine.js` | Pure-function scoring engine — copy on `window.TR` |
| `public/activity-tracker/api.js` | `/api/tracker/*` fetch wrappers — `window.TRApi` |
| `public/activity-tracker/App.jsx` | React app — 7 tabs (Dashboard, Scoring, Input, Heatmap, Tracker Setup, Targets, Roadmap), all modals |
| `public/activity-tracker/styles.css` | Brand-token-driven page styles |
| `public/tracker-icons/*.png` | 8 PNG icons embedded in PPTX (logo, 4 pillar icons, green/amber RAG) |

---

## 10. The 7 React tabs (frontend UX)

| Tab | Phase | What it does |
|---|---|---|
| **Dashboard** | Hero | Overall % + Trend, Pillar Health, Site Leaderboard, 4 KPI charts |
| **Scoring** | Per-site | Activity breakdown grouped by pillar. Shows effective weight when redistribution kicked in. |
| **Input** | Per-site editable | 12-month grid. Current month highlighted. Debounced auto-save (800 ms) + explicit Save. |
| **Heatmap** | Cross-site | Site × activity RAG matrix with pillar band header |
| **Tracker Setup** | Config | Pillars (with weights), Active sites, Activities (with M1-M12 window). All edits go through confirm + redistribute modals. Also: + Year button. |
| **Targets** | Per-site | Target value + active toggle per activity. iOS-style toggles. Bulk "All on / All off" per pillar. |
| **Roadmap** | 12-month Gantt | Bars positioned by activity start/end. Two vertical lines: solid orange = selected period, dashed grey = today. RAG-colored bars. |

---

## 11. Auto-save model

The React App calls `engine.si2(D, ...)` to mutate `D` in place. The
child component then calls `onMutate()` which:

1. Sets `dirty = true` on App state
2. Bumps a `mutationCounter` counter

The autosave `useEffect` watches `[mutationCounter, dirty, roles.CAN_SAVE]`
and debounces 800 ms before firing `handleSave()`. Concurrent saves are
protected via a `lastSaveRef` tag — only the freshest one updates UI
state. The explicit Save button bypasses the debounce.

Toolbar sync states:

```
idle  →  saving  →  synced (1.8 s)  →  idle
              ↘  fail (sticky until next change)
```

---

## 12. Common pitfalls

| Pitfall | Why |
|---|---|
| **Engine drift between frontend + PPTX** | `engine.js` (browser) and `tracker-pptx.js` (server) BOTH implement scoring. When changing a KPI rule or RAG threshold, update BOTH files or the live page and the exported PPTX disagree. |
| **Stale `activity_ix` after pillar/activity delete** | Deleting an activity must `splice()` it out of `D.activities`, every `D.targets[site]` array AND every `D.inputs[yr][site]` array. Don't regress to `Array.filter()` which leaves parallel arrays unchanged. |
| **CSP for JSX-at-runtime pages** | The React tracker uses Babel + React via CDN (in-browser JSX = needs 'unsafe-eval'). `server.js` has a path-scoped CSP override that grants `unsafe-eval` + unpkg.com only on `/activity-tracker.html`, `/activity-tracker/*`, `/dashboard-preview/*`, `/design-system/*`. Other pages get the strict CSP. |
| **`LAYOUT_16x9` vs `LAYOUT_WIDE`** | The TRACKER PPTX uses `LAYOUT_16x9` (10" × 5.625"). Most OTHER project PPTX use `LAYOUT_WIDE` (13.33" × 7.5"). Always verify `sldSz cx` after generating: 9144000 = 10", 12192000 = 13.33". |
| **`tracker-icons/` missing on server** | The PPTX embeds 8 icon PNGs. If the folder isn't deployed, the server logs `null` images silently — slides build but with broken images. xcopy `public/tracker-icons/` to prod before pm2 reload. |
| **Admin saving other site's data** | `saveTracker(D, userSite)` silently skips inputs for sites other than userSite. This is intended RBAC. Don't error — silently skip. |
| **`fixComboChartAxes` not applied to combo slides** | Without it, the file opens in LibreOffice but not PowerPoint. The tracker PPTX is text + bar/line only — no combo charts — so the function isn't needed here. But if you ADD a combo chart, pipe through it. |

---

## 13. Endeavour Mining brand palette (relevant tokens)

```
--edv-navy    : #1B3050   (sidebar, header bg)
--edv-blue    : #145FAE   (primary CTAs)
--edv-orange  : #E87722   (active tabs, accents)
--edv-red     : #D90038   (HIGH severity, brand)
--edv-green   : #1B9A3A   (OK, success)
--edv-slate   : #3A4A60   (headers, table heads)
--edv-amber   : #D97706   (warnings)
--edv-purple  : #7C3AED   (escalations / Council)
```

The frontend imports `public/_tokens.css` which defines all of these as
CSS custom properties. The PPTX generator (`tracker-pptx.js`) has them
hard-coded in a `C` object mirroring CLAUDE.md's PPTX color constants.

---

## 14. How to extend the tracker

### Add an activity
1. Insert into `tracker-init.json` `activities[]` at the right pillar.
2. Update existing pillar's weights so they still sum to 1.00.
3. Run `POST /api/tracker/reset` (super_admin) or do an ALTER-pattern migration in `tracker-db.js`.
4. **Recompute every `targets` entry** — `tracker_targets` rows are
   indexed by `activity_ix`, so inserting in the middle shifts every
   row after it. Easier path: append to the end (use the next
   available index).
5. Add to `D.inputs[year][site]` arrays — append an empty `[0]*12`.

### Add a site
1. Append to `INIT.sites`, `INIT.siteNames`, `INIT.siteColors`.
2. Add a row to `SITE_MAP` so the role gate can resolve the user's
   `site_name` to the new tracker code.
3. Reset or run a one-off seed for the new site's targets + inputs.

### Add a new KPI type
1. Add the scoring logic in BOTH `engine.js` (frontend) AND
   `tracker-pptx.js` (server PPTX).
2. Update the Targets tab UI in `App.jsx` so it knows how to render the
   target editor (number input vs phase enum vs TRUE/FALSE).
3. Update the Input tab so the editor accepts the new value shape.

---

## 15. Sample `D.inputs` for one site (MGO, 2026, first 5 activities)

```json
{
  "MGO": [
    [0,0,1,0,0,0,0,0,0,0,0,0],   // activity_ix=0  → "Link 1 Upgrade" — completed March
    [0,0,0,1,0,0,0,0,0,0,0,0],   // activity_ix=1  → "Link 2 Upgrade" — completed April
    [0,0,0,0,0,0,0,0,0,0,0,0],   // activity_ix=2  → "Bandwidth Allocation" — not yet
    [0,0,0,0,0,0,0,0,0,0,0,0],   // activity_ix=3  → "Distribution Layer" — not yet
    [1,0,0,0,0,0,0,0,0,0,0,0]    // activity_ix=4  → "Local Infra Monitoring" — Jan
  ]
}
```

KPI type for each is in `activities[ix].kpi`. Index 4 is COUNT (monitoring
events), so the value `1` is one event in January.

---

**End of handoff document**. Last refreshed: 2026-06-03. If this doc
drifts from the live code, `tracker-db.js` + `tracker-init.json` are
the canonical source.
