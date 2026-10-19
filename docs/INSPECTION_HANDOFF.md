# IT Inspection Module — Session Handoff

> **Single-source-of-truth for the inspection-module integration task.**
> After `/clear`, point Claude at this file. It distills the three contexts
> needed to resume: the inspection HTML's data shape, the SDP-Dashboard
> conventions, and the EDV brand system.
>
> Created 2026-05-16. Working branch `claude/busy-kirch-2a4176`.
> Worktree: `C:\Users\Admin\Documents\SDP-Dashboard\.claude\worktrees\busy-kirch-2a4176\`

---

## 0. Task in one paragraph

Integrate `C:\Users\Admin\Documents\Software_hardware\IT_Inspection_SDP.html`
(a self-contained PWA for IT inspections at Endeavour Mining sites) into the
SDP-Dashboard Node.js + Express + better-sqlite3 stack. Mirror the
**Activity Tracker** module pattern exactly (separate db file, `*-db.js`,
`*-pptx.js`, `*-init.json`, dedicated HTML, `/api/<module>/*`, RBAC). Use
EDV brand tokens / icons / components — no new design primitives. Mobile-
responsive because inspectors carry phones onto towers and IDFs.

**This task is NOT about the Pointage Flask app** (`C:\Users\Admin\Documents\Poinge\PointageApp\`).
That was an earlier misread. Pointage is unrelated.

**Goal (user's words):** *"ease IT inspections and reporting"*.

---

## 1. Status — where the work is

- ✅ Inspection HTML data model fully read
- ✅ SDP-Dashboard CLAUDE.md + BRAND_HANDOFF.md context loaded
- ✅ Architecture decided: mirror Activity Tracker pattern
- ✅ Schema designed (8 tables, all `insp_*` prefix, in new `inspection.db`)
- ✅ API surface designed (`/api/inspection/*`)
- ✅ File-set scoped (3 new server files + 2 new HTML files + small updates)
- ⏳ **Awaiting user "go" before any code is written**
- ⏳ Three open questions (see §7)

**Per user spec §1:** read & plan before writing any code. Plan presented;
waiting for confirmation.

---

## 2. SDP-Dashboard environment (must respect)

| Item | Value |
|---|---|
| Stack | Node.js + Express + better-sqlite3 + PM2 on Windows Server |
| PPTX | pptxgenjs |
| Local/dev path | `C:\Users\Admin\Documents\SDP-Dashboard\` |
| Worktree (active) | `.claude\worktrees\busy-kirch-2a4176\` |
| Production share | `Z:\` (SMB-mapped to remote `C:\Apps\SDP-Dashboard\`) |
| Port | 3456 |
| PM2 app name | `endeavour-dashboard` |
| Auth roles | super_admin > executive > admin > editor > viewer |

### Deploy flow

Claude **never** writes to `Z:\` directly (sandbox can't see it).
On every commit, a post-commit hook regenerates `_deploy.cmd` in the
worktree root listing files changed since last successful deploy.
User runs it from cmd.exe — single command:

```cmd
_deploy.cmd                          :: copies changed files to Z:\
pm2 reload endeavour-dashboard       :: run on prod host (RDP)
```

### Cache pitfall

`server.js:798-807` pre-caches main HTML files into `_htmlCache` at boot.
Any new HTML file (`inspection.html`, `inspections.html`) **must** be
added to that cache list, otherwise edits won't appear after deploy
until `pm2 reload`.

### Branch state (as of 2026-05-16)

`claude/busy-kirch-2a4176` is 30+ commits ahead of origin, **not pushed**.
Brand system Phase 1, executive audit, OOM fix, HTTPS migration all
merged. See worktree `CLAUDE.md` for full history.

---

## 3. Inspection HTML — data shape to persist

File: `C:\Users\Admin\Documents\Software_hardware\IT_Inspection_SDP.html`

### Top-level state object

```js
state = {
  meta:       { /* form fields, see below */ },
  items:      { /* keyed by "<cat>__<idx>" */ },
  actions:    [ /* corrective actions */ ],
  signatures: { sig_inspector: <base64 PNG>, sig_site: <base64 PNG> }
}
```

### `state.meta` — flat field IDs (canonical list from line 1989)

```
f_id          f_date        f_time         f_type
f_site        f_area        f_loc          f_inspector
f_role        f_witness     f_weather      f_lastdate
f_scope       f_risk        f_impact       f_obs
f_pos         f_dist        sign_insp_name sign_insp_date
sign_site_name sign_site_date
```

### Site dropdown (line 762-779) — authoritative for seed data

| optgroup | Option text |
|---|---|
| Mine Sites | Sabodala (SGO) — Senegal · Houndé (HGO) — Burkina Faso · Mana (MGO) — Burkina Faso · Ity (SMI) — Côte d'Ivoire · Lafigué (SML) — Côte d'Ivoire · Kalana (KGO) — Mali |
| Regional Offices | Dakar Office · Abidjan Office · Ouagadougou Office |
| Other | Other / Autre |

> **Site code conflict to resolve (open question §7-2):** Activity Tracker's
> `siteNameToCode()` uses HGO/IVO/SKO/WGN/BGO/MAN/LAF/BAN — disagrees on
> Ity (SMI vs IVO) and Sabodala (SGO vs SKO). My recommendation: use the
> form codes (SGO/HGO/MGO/SMI/SML/KGO) and add an alias map in `inspection-db.js`
> for cross-module lookups.

### Area groups (line 786-822) — 6 groups, ~25 areas total

`Server / IT Rooms · Operations · Communications · Underground · Security & Safety · Other`

### Inspection types (line 746-753)

`Routine · Pre-Audit · Post-Incident · Commissioning · Handover · Ad-hoc`

### Item status values (lowercase string in `state.items[k].status`)

`ok · minor · major · critical · opp · na`

### Action shape

```js
{
  desc:     '',                              // long text
  link:     '',                              // e.g. 'FIRE-03' — checklist item code
  priority: 'Critical|High|Medium|Low',
  owner:    '',
  due:      '',                              // YYYY-MM-DD
  status:   'Open|In Progress|Blocked|Closed|Cancelled',
  notes:    ''
}
```

### Status → Priority auto-map (line 1897)

```js
{critical:'Critical', major:'High', minor:'Medium', opp:'Low'}
```

### Checklist categories (16 total — `CATEGORIES` array)

`env · pwr · fire · net · rack · sec · doc · bcp · op · hse · tower · radio · cell · ug · cctv` (+ 1 uncovered — verify by reading the `CATEGORIES` const before coding).

Each `cat.items` is an array of `{ code, label_en, label_fr }`-shaped entries; key in `state.items` is `` `${cat.id}__${idx}` ``.

### Photos

Stored as base64 PNG inside `state.items[key].photos[]`. Each entry is `{ caption, dataUrl }`.

### localStorage keys (offline fallback)

`KEY_INDEX` (list of saved inspection IDs) · `KEY_CURRENT` (active ID) · `KEY_DATA(id)` (full state JSON).

---

## 4. Proposed schema — `inspection.db`, all tables `insp_*`

> **Rule:** additive only. Never touches `tracker.db`, `users.db`, or the
> main SDP-Dashboard DB. Hybrid normalized columns + `state_json` blob so
> a future form revision can't break old records.

```sql
-- Lookups (seeded on first run from inspection-init.json)
CREATE TABLE insp_sites (
  code TEXT PRIMARY KEY, name_en TEXT, name_fr TEXT, country TEXT,
  site_type TEXT DEFAULT 'mine', display_order INTEGER DEFAULT 0, active INTEGER DEFAULT 1
);
CREATE TABLE insp_areas (
  code TEXT PRIMARY KEY, name_en, name_fr, area_group, display_order, active
);
CREATE TABLE insp_types (
  code TEXT PRIMARY KEY, label_en, label_fr, display_order
);

-- Header
CREATE TABLE insp_inspections (
  id TEXT PRIMARY KEY,               -- e.g. INS-2026-00042
  label, inspection_date DATE, inspection_time, inspection_type,
  site_code, area_code, specific_location,
  inspector_name, inspector_role, accompanied_by,
  weather, last_inspection_date, scope,
  overall_risk, operational_impact,
  key_observations, positive_findings, distribution,
  state_json TEXT,                   -- full state blob (round-trip safe)
  status TEXT DEFAULT 'draft',       -- draft|submitted|closed
  created_by INTEGER, created_at, updated_at, submitted_at
);

-- Per-checklist-item
CREATE TABLE insp_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id TEXT, category TEXT, item_index INTEGER, item_code TEXT,
  item_text_en TEXT, item_text_fr TEXT,   -- denormalized → reports survive item-text edits
  status TEXT, notes TEXT,
  UNIQUE(inspection_id, category, item_index),
  FOREIGN KEY (inspection_id) REFERENCES insp_inspections(id) ON DELETE CASCADE
);

-- Corrective actions
CREATE TABLE insp_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id TEXT, ord INTEGER, description TEXT, linked_item TEXT,
  priority TEXT, owner TEXT, due_date DATE,
  status TEXT DEFAULT 'open', notes TEXT,
  created_at, updated_at, closed_at,
  FOREIGN KEY (inspection_id) REFERENCES insp_inspections(id) ON DELETE CASCADE
);

-- Photos (base64 TEXT; nullable FK to either finding or action)
CREATE TABLE insp_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id TEXT, finding_id INTEGER NULL, action_id INTEGER NULL,
  caption TEXT, mime_type TEXT, data_b64 TEXT, size_bytes INTEGER, created_at
);

-- Signatures (composite PK; max 2 per inspection)
CREATE TABLE insp_signatures (
  inspection_id TEXT, signer_type TEXT,  -- 'inspector'|'site'
  signer_name TEXT, signer_date DATE,
  signature_b64 TEXT, signed_at,
  PRIMARY KEY (inspection_id, signer_type),
  FOREIGN KEY (inspection_id) REFERENCES insp_inspections(id) ON DELETE CASCADE
);
```

---

## 5. API surface — `/api/inspection/*` (mounted in `server.js`)

| Method · Path | Auth | Purpose |
|---|---|---|
| `GET  /api/inspection/lookups` | any | `{sites, areas, types}` — one call hydrates form |
| `GET  /api/inspection/list?site=&from=&to=&risk=&status=` | viewer+ | Paginated filter |
| `GET  /api/inspection/:id` | viewer+ | Full record incl. findings/actions/photos/sigs |
| `POST /api/inspection/save` | admin (own site) / executive+ | Upsert; RBAC scopes to user's site |
| `DELETE /api/inspection/:id` | executive+ | Cascading delete |
| `POST /api/inspection/:id/export` | admin+ | Single PPTX |
| `POST /api/inspection/aggregate/export` | executive+ | Roll-up PPTX |
| `POST /api/inspection/reset` | super_admin | Re-seed lookups |

RBAC table identical to Activity Tracker — see worktree `CLAUDE.md` §RBAC.
`siteNameToCode()` helper in `tracker-db.js` re-exported / re-implemented.

---

## 6. Frontend changes

### `public/inspection.html` (adaptation of `IT_Inspection_SDP.html`)

- Replace localStorage-only persistence with `fetch('/api/inspection/save', …)` + offline queue fallback
- Site/area/type dropdowns hydrate from `GET /api/inspection/lookups`
- Load `_shell.js` for unified nav header
- Replace `🎤` `🔍` etc. with `EDV_ICONS.html('mic')`, `EDV_ICONS.html('search')`
- **Keep these as BMP text** per brand policy: ✓ ✕ ⚠ ✏ 🟢🟡🔴 😊😟
- Use `--edv-*` tokens — drop the local `--pri/--sec/--acc` palette
- Mobile-first: 390/412/768 breakpoints, 44×44 touch targets, hamburger
- Camera capture + Web Speech API: existing in source HTML — keep wiring

### `public/inspections.html` (new list/report)

- Filter bar (site / date-range / risk / status)
- KPI tiles: total this month, critical findings this month, overdue actions, sites covered
- Trend chart (Chart.js, already loaded): findings by month
- Click row → `inspection.html?id=<id>`

### `_shell.js` nav — add under **Performance ▾**

| Label | Icon | Route | Roles |
|---|---|---|---|
| Inspections | `clipboard-check` | `inspections.html` | any |

If `clipboard-check` is missing from `brand/icons.js`, add the lucide SVG path.

---

## 7. PPTX export — `inspection-pptx.js`

**Canonical 13.33" × 7.5" canvas** (NOT the tracker's 10" `LAYOUT_16x9`).
Always `x=0.3, w=12.73`. See worktree `CLAUDE.md` §PPTX Canvas.

Slides:
1. Cover + KPI strip (OK / Minor / Major / Critical / Opp / N/A) — 4× `kpiTile` row at y=0.62, second row y=1.12
2. Critical & Major findings table — category, code, item text, notes, photo thumbnails (12.73" wide, dynamic last column per `Dynamic Service Column Pattern`)
3. Open actions table — priority, owner, due, status
4. Signatures + scope/observations — embed base64 PNGs

All text in BMP only — no emoji (`?` rendering risk). If any combo chart, pipe final buffer through `fixComboChartAxes()`.

Use `kpiTile` helper verbatim from `CLAUDE.md` §kpiTile.

---

## 8. EDV Brand surface to consume

Sourced from `docs/BRAND_HANDOFF.md` — these are the existing assets, no new ones needed.

### Tokens (`public/_tokens.css`)

| Concern | Tokens |
|---|---|
| Palette | `--edv-orange #EF631A` (CTA), `--edv-blue #145FAE` (info/links), `--edv-green #1B9A3A` (RAG green), `--edv-red #D90038` (RAG red), `--color-warning #D97706` (amber text, AA-safe), `--edv-slate #3A4A60` (headers), `--edv-grey #524F4E` (body text), `--color-border #E2E5EA` |
| Typography | `--font-sans` and `--font-display` both = `'Libre Franklin', 'Franklin Gothic', system-ui` |
| Spacing | 4-pt grid: `--space-1` 4 px … `--space-16` 64 px |
| Radius | `--radius-sm` 4 · `--radius-md` 6 · `--radius-lg` 10 · `--radius-xl` 14 · `--radius-pill` 9999 |
| Shadow | `--shadow-sm/md/lg/xl` |
| Motion | `--motion-fast` 120 ms · `--motion-base` 180 ms · `--motion-slow` 280 ms · `--ease-standard` `cubic-bezier(.2,0,.2,1)` |

### Icon library — `public/brand/icons.js`

Lucide-style monochrome. Load **before** `_shell.js`:

```html
<script nonce="%%CSP_NONCE%%" src="brand/icons.js"></script>
```

Usage:
- Static HTML: `<i class="icon icon-zap"></i>` (auto-hydrated on DOMContentLoaded)
- Dynamic JS: `btn.innerHTML = EDV_ICONS.html('download') + ' Export'`
- Size: `.icon-sm | .icon | .icon-md | .icon-lg | .icon-xl | .icon-2xl`
- Tint: `.icon-tint-success | -warning | -danger | -info | -muted | -orange`

**Available names** (categorised in BRAND_HANDOFF §Components→Brand icon library):
nav: `headset file-text trending-up gauge line-chart target presentation sliders book-open`
actions: `zap download upload save refresh-cw copy edit trash plus x check chevron-down chevron-right`
state: `cloud-off wifi-off alert-circle alert-triangle info lightbulb`
domain: `bar-chart-3 users user calendar clock filter search log-out shield shield-check`

**Need to add for inspection module:** `clipboard-check`, `camera`, `mic` — grab lucide SVG paths.

### Components — `public/brand/components.css`

- `.edv-empty-state` (+ `--error` `--success` variants) — for no-data / offline / session-expired moments. Includes Goldy hook (PNG hides itself via `onerror`).
- `.edv-hero` — large welcome surface, slate gradient
- `.edv-section-divider` — hairline + optional Goldy
- `.edv-goldy-badge` — 28 px circular avatar pill

### What to KEEP as text (don't replace with icons)

BMP characters that aren't "Claudy":
✓ ✕ ⚠ ✏ 🟢 🟡 🔴 😊 😟

### Brand README locations

- `public/brand/README.md` — full usage guide
- `docs/BRAND_HANDOFF.md` — design-system handoff (the one this distills)

---

## 9. Open items requiring user "go"

1. **Schema approval** — particularly the `state_json` blob alongside denormalized columns
   - *Claude recommendation: keep both. Denormalized for queries/reports; blob for round-trip safety against future form changes.*
2. **Site code authority** — form's (SGO/HGO/MGO/SMI/SML/KGO + DKR/ABJ/OUA) vs tracker's (HGO/IVO/SKO/WGN/BGO/MAN/LAF/BAN + offices)?
   - *Claude recommendation: use form codes + alias map for cross-module lookups.*
3. **PPTX export in v1 or v2?**
   - *Claude recommendation: ship in v1 — same effort once data layer exists.*

---

## 10. Files to be created / touched

```
NEW
  inspection-db.js             — SQLite persistence (mirror tracker-db.js)
  inspection-pptx.js           — PPTX export (canvas 13.33"×7.5")
  inspection-init.json         — seed sites/areas/types/categories
  public/inspection.html       — port of IT_Inspection_SDP.html
  public/inspections.html      — new list/report page
  inspection.db                — auto-created on first start (gitignored)
  docs/INSPECTION_HANDOFF.md   — this file

UPDATED
  server.js                    — mount /api/inspection/* + add to _htmlCache
  public/_shell.js             — add 'Inspections' nav item under Performance ▾
  public/brand/icons.js        — add clipboard-check, camera, mic if absent
  CLAUDE.md                    — add Inspection Module section mirroring Activity Tracker style
```

---

## 11. Build order (one commit per layer)

1. `inspection-init.json` — seed data
2. `inspection-db.js` — schema + CRUD
3. `/api/inspection/*` routes in `server.js`
4. `public/inspection.html` — form with server sync
5. `public/inspections.html` — list/report
6. `_shell.js` nav + icon additions
7. `inspection-pptx.js` + export route
8. `CLAUDE.md` documentation update
9. Mobile-responsive pass on `inspection.html`

Each step uses the existing post-commit hook → `_deploy.cmd` flow.

---

## 12. Explicitly out of scope (v1)

- No changes to existing tables / databases
- No mobile pass for `index.html` / `executive.html` / `reports.html`
- No Goldy PNGs (assets pending from EDV brand team — empty-states degrade cleanly)
- No HTTPS work (CH-273 already shipped)
- No `/tools` launcher page (unified `_shell.js` nav covers it)
- Nothing in the Pointage Flask app
- No PPTX template extraction (build natively in pptxgenjs)

---

## 13. After /clear — exact prompt to use

> *"Resume the inspection module work. Read `docs/INSPECTION_HANDOFF.md`
> for full context, then ask me about the three open items in §9 — or
> just proceed if I've already answered them in this prompt."*

Or if you've already answered §9 questions, just say "go — schema as
proposed, form site codes, ship PPTX in v1" and Claude starts at §11 step 1.

---

*Document version 1.0 — 2026-05-16. Update when scope/schema changes.*
