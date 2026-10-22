# Module — IT Inspections

Moved verbatim from `CLAUDE.md` on 2026-10-22 (SDP-DASH-2.0 step 5, lot 5.5). `CLAUDE.md` is now an index; edit THIS file.

---

## IT Inspection Module (v1)

Site-IT inspection tooling for the mining + office sites. Mirrors the
Activity Tracker pattern (own SQLite file, `*-db.js`, `*-pptx.js`,
`*-init.json`) and is fully additive — no migrations touch `tracker.db`,
`reports.db`, or any existing table.

### Architecture overview

```
Browser (inspection.html — form, voice, camera, signature pad)
  ↓ debounced POST /api/inspection/save  (auto-sync + offline queue)
  ↓ GET  /api/inspection/lookups          (form hydration)

Browser (inspections.html — list + KPI tiles + trend + filters)
  ↓ GET /api/inspection/list?site=&from=&to=&risk=&status=
  ↓ GET /api/inspection/aggregate
  ↓ POST /api/inspection/aggregate/export  (rollup PPTX)

Server (server.js, ~line 4380)
  ↓ inspection-db.js → inspection.db (SQLite, 7 tables prefix insp_*)
  ↓ inspection-pptx.js (LAYOUT_WIDE, 13.33" × 7.5", text-only)
```

### Key files

| File | Purpose |
|------|---------|
| `inspection-init.json` | Seed: 10 sites, 26 areas, 6 types, **17 categories (173 checklist items)** — `srv` (Servers & Hypervisor) and `sto` (Storage & Datastores) added 2026-05-23, inserted between `net` and `rack` |
| `inspection-db.js` | Schema + CRUD + cross-site write guard + aggregate roll-ups |
| `inspection-pptx.js` | `generateInspectionPptx(rec, lookups)` + `generateAggregatePptx(payload, lookups)` |
| `public/inspection.html` | Form (port of `IT_Inspection_SDP.html`) with EDV brand + server-sync overlay |
| `public/inspections.html` | List/dashboard with filters + KPI tiles + monthly trend |

### SQLite schema (`inspection.db`)

```sql
insp_sites        (code, name_en, name_fr, country, site_type, display_order, active)
insp_areas        (code, name_en, name_fr, area_group, display_order, active)
insp_types        (code, label_en, label_fr, display_order)
insp_inspections  (id, label, inspection_date, inspection_time, inspection_type,
                   site_code, area_code, area_text, specific_location,
                   inspector_name, inspector_role, accompanied_by,
                   weather, last_inspection_date, scope,
                   overall_risk, operational_impact,
                   key_observations, positive_findings, distribution,
                   state_json,                          -- full state blob (round-trip safe)
                   status, created_by, created_at, updated_at, submitted_at)
insp_findings     (id, inspection_id, category, item_index, item_code,
                   item_text_en, item_text_fr,         -- denormalised → reports survive form edits
                   status, notes; UNIQUE(inspection_id, category, item_index))
insp_actions      (id, inspection_id, ord, description, linked_item, priority,
                   owner, due_date, status, notes, created_at, updated_at, closed_at)
insp_photos       (id, inspection_id, finding_key, action_id, caption,
                   mime_type, data_b64, size_bytes, created_at)
insp_signatures   (inspection_id, signer_type, signer_name, signer_date,
                   signature_b64, signed_at; PK (inspection_id, signer_type))
```

First-run auto-seeds the three lookup tables from `inspection-init.json`. Reset via
`POST /api/inspection/reset` (super_admin only).

### API surface — `/api/inspection/*`

All require `requireReportSession` (session cookie + `x-report-token` header).

| Method · Path | Min role | Purpose |
|---|---|---|
| `GET /lookups` | any | `{ sites, areas, types, statuses, categories, priorityMap, siteAliases }` — one call hydrates the form |
| `GET /list?...` | viewer+ | Paginated headers, filters: `site`, `from`, `to`, `risk`, `status`, `limit`, `offset` |
| `GET /aggregate?...` | viewer+ | KPI roll-up for dashboard tiles |
| `GET /:id` | viewer+ | Full record (header + findings + actions + photos + signatures + state blob) |
| `POST /save` | editor (own site) / admin+ (any site) | Upsert; cross-site writes throw 403 |
| `DELETE /:id` | executive+ | Cascading delete |
| `POST /:id/export` | admin+ | Single-inspection PPTX (4 slides) |
| `POST /aggregate/export` | executive+ | Roll-up PPTX (4 slides) |
| `POST /reset` | super_admin | Wipe + re-seed lookup tables (does not touch inspection rows) |

`/save` and `/aggregate/export` accept a 30 MB JSON body (photos +
signatures are base64 PNG inline). Everything else stays inside the
default `jsonBody` 2 MB limit.

### Site code authority

The inspection form uses its own code table (SGO / HGO / MGO / SMI / SML
/ KGO + DKR / ABJ / OUA / OTH). For cross-module lookups, the loaded
`siteAliases` object maps inspection codes to tracker codes where they
differ:

```
SMI → ITY     (Ity uses SMI in form, ITY in tracker)
KGO → KLN     (Kalana uses KGO in form, KLN in tracker)
OUA → EDV     (Ouagadougou uses OUA in form, EDV in tracker)
```

Server-side `inspectionDb.siteNameToCode(siteName)` maps the `site_name`
column from `users` → inspection code (e.g. `'KALANA' → 'KGO'`). Used by
the route handler to scope writes for editor-role users.

### Save model — Local + manual "Save now" + Submit (chosen 2026-05-24)

**Keystrokes save to localStorage ONLY. Server POSTs fire only when the
user explicitly clicks "Save now" in the toolbar OR submits the
inspection.** This replaced the original debounced auto-sync model
after field feedback that (a) empty/half-filled drafts were appearing
on the dashboard the moment someone opened the form, and (b) field
users wanted explicit control over when their work hit the server
(satellite/cellular at remote sites is unreliable; pushing on every
keystroke wasted bandwidth and sometimes synced half-formed records).

| Action | localStorage | Server (`/api/inspection/save`) |
|---|---|---|
| Keystroke / blur on any field | ✓ (via `orig.apply` in patched `saveCurrent`) | ✗ |
| Click **Save now** in toolbar | (same) | ✓ via `forceSyncNow()` |
| Click **Submit** | (same — `state.status='submitted'`) | ✓ via `forceSyncNow()` chained from `confirmSubmit` |
| Click **Re-open** (admin+) | (same — `state.status='draft'`) | ✓ via `forceSyncNow()` chained from `reopenInspection` |
| Offline queue drain | — | ✓ on boot + after every successful `forceSyncNow` |

Offline queue: if `forceSyncNow` fails (no connectivity, server 5xx),
the inspection id is pushed onto `em_insp_sync_queue` in localStorage.
The queue drains on the next successful `forceSyncNow`, and on every
page boot. A toolbar pill shows depth so the inspector knows there's
unsynced work.

The base64 photo + signature blobs ride inside `state` so a single
`/save` round-trip carries everything. No multipart, no S3 — keeps the
on-prem deploy story simple.

#### Toolbar status indicator

The `#saveStatus` element reflects sync state in real time:

| Situation | Indicator text | CSS class |
|---|---|---|
| Local save, not yet on server (empty draft) | `✓ Saved locally HH:MM` | (no class) |
| Local save, not yet on server (meaningful content) | `✓ Saved locally HH:MM · click Save now or Submit to sync` | (no class) |
| Local save, already on server but dirty since | `✓ Saved locally HH:MM · click Save now to sync` | (no class) |
| Save now / Submit succeeded | `✓ Saved (local + server HH:MM)` | `.saved.server-ok` (green, **bold**) |
| Save now / Submit failed | `✓ Saved locally · ⚠ Server queued` | `.server-fail` (amber, **bold**) |

On failure, a toast surfaces the actual error message
(`Cross-site save blocked: …`, `Inspection is submitted …`, HTTP-code
details, etc.) — no rate-limiting needed since the user explicitly
asked for the save.

#### Console diagnostics

```js
__inspectionSync.lastServerError   // null when healthy, message when not
__inspectionSync.queueDepth        // current offline queue length
__inspectionSync.localDirty        // true when there are local edits not yet pushed
__inspectionSync.forceSave()       // manual server POST (same as Save now), returns promise
__inspectionSync.flushQueue()      // drain the offline queue
```

#### Server-side audit log (grep-friendly)

```
[Inspection] save ok id=… user=… site=… status=draft items=N actions=N photos=N size=NN.NMB
[Inspection] DELETE id=… user=… site=… prior_status=…
```

Confirm via `pm2 logs endeavour-dashboard --lines 200 --nostream | findstr Inspection`.

Because server POSTs now only happen on explicit user action, the log
volume drops dramatically — one save per inspector per inspection
during fieldwork, instead of one per keystroke debounced.

### Voice dictation — idempotent transcript builder

Web Speech API (`webkitSpeechRecognition` in Chrome/Edge) calls
Google's cloud speech service. On flaky networks (satellite / cellular
at remote mine sites) it can emit the **same `isFinal=true` chunk
twice** when the stream re-segments mid-phrase. The old code used an
incremental accumulator (`_recBaseText += finals`) which doubled
transcripts ("the truck broke down the truck broke down").

The patched implementation tracks three separate buffers:
- `_recInitialText` — textarea content at session start (never mutated)
- `_recCommittedFinal` — finals from previously-ended sessions in this
  dictation (committed in `r.onend` before the continuous-mode auto-restart)
- `_recCurrentFinal` — finals from the CURRENT live session; **rebuilt
  from scratch on every `onresult` event** from the full `e.results`
  array (NOT incremental — that's the key)

Composed value = `initial + committed + current`. Duplicate `isFinal`
emissions collapse to the same value instead of doubling. Cross-session
boundaries (the `onend → r.start()` continuous-mode trick that
preserves text across natural pauses) handled by committing
`_recCurrentFinal → _recCommittedFinal` before the restart.

`_buildRecognizer` + the two `toggleDictation*` entry points are the
only places this state lives. All three buffers reset in
`_stopDictation()` and in each `toggleDictation*` entry.

### PPTX canvas

13.33" × 7.5" (LAYOUT_WIDE). Every panel uses `x=0.3, w=12.73`. No
charts — tables and rectangles only — so the deck opens cleanly in both
PowerPoint and LibreOffice without piping through `fixComboChartAxes`.

Slide 1 = Cover + KPI strip (6 statuses) + context cards.
Slide 2 = Critical / Major findings table (status, code, item, notes).
Slide 3 = Corrective actions table (priority, linked, description, owner, due, status).
Slide 4 = Observations + signatures (embeds base64 PNGs).

The aggregate variant uses the same canvas: cover + 6-tile findings-by-status,
inspections-in-scope table, findings distribution bars, monthly trend bars.

### Status & priority

```
status (per finding):  ok · minor · major · critical · opp · na
priority (per action): Critical · High · Medium · Low
status → priority map: { critical:'Critical', major:'High', minor:'Medium', opp:'Low' }
```

The form's `wireChecklistEvents()` auto-seeds an action when a finding
flips to minor/major/critical/opp (handled in the legacy script — keep
that logic untouched on future edits).

### Brand surface used

| Concern | Tokens |
|---|---|
| Palette | `--edv-orange` (CTA + active states), `--edv-blue` (links + Opportunity), `--edv-green` (OK), `--edv-red` (Major), `--color-warning` (amber Minor/Moderate), `--edv-slate` (table headers) |
| Typography | `--font-sans` from `_tokens.css` (Libre Franklin) |
| Icons | `brand/icons.js` — `clipboard-check` (nav), `camera`, `mic`. Also: `plus`, `download`, `refresh-cw`, `check`, `cloud-off` |
| Components | `.edv-empty-state` is available but unused — wire it for the no-results states if needed |

The form page **keeps its inline `:root` block** but maps every legacy
variable (`--bg`, `--accent`, etc.) onto the EDV tokens. That lets the
2 500-line embedded stylesheet stay untouched while picking up the
unified palette — change the alias map at the top of the inline `<style>`
to re-skin in one place.

### Known pitfalls

| Pitfall | Rule |
|---------|------|
| `inspection.db` missing on server | First request to `/api/inspection/lookups` auto-creates + seeds. Safe to delete to force re-seed. |
| Photo body too large (HTTP 413) | The `/api/inspection/save` route uses a dedicated 30 MB `express.json` parser. If a future change touches that route, keep the `inspectionJsonBody` parser ahead of the global `jsonBody`. |
| Cross-site save 403 | Editor-role users are scoped to their `site_id` via `inspectionDb.siteNameToCode()`. `_userInspectionSite()` in `server.js` returns null for admin+ → unrestricted. |
| Static-served HTML out-of-date | `inspection.html` + `inspections.html` are in `_htmlCache` at boot (server.js line 807). Edits require `pm2 reload`. |
| Lookups out of sync with form | The form's hard-coded `<option>` lists are the offline fallback. `hydrateLookups()` replaces them when online — keep both in step or the offline UX desyncs from the DB. |
| Tracker code vs inspection code drift | Inspection module owns its own codes (SGO/HGO/MGO/SMI/SML/KGO + DKR/ABJ/OUA). Don't reuse tracker's `siteNameToCode` for inspection writes — use `inspectionDb.siteNameToCode`. |
| Aggregate export filter mismatch | The `POST /aggregate/export` body must wrap filters as `{ filters: {...} }`. Mismatched casing/keys silently exports an empty deck. |
| **CATEGORIES list lives in TWO places** | `inspection-init.json → categories` AND `public/inspection.html` line 1454+ inline `const CATEGORIES`. Both must be edited together or findings save fine but reports/PPTX lose item text (the JSON drives `_findItemDef` denorm; the HTML drives form rendering). 17 categories as of 2026-05-23. |
| **"Save flow doesn't seem to persist"** | **Expected behaviour under the 2026-05-24 save model**: keystrokes save to localStorage ONLY. Server POSTs happen only on **Save now** or **Submit**. The toolbar says `✓ Saved locally HH:MM · click Save now or Submit to sync` until the user explicitly pushes. The dashboard will be empty until then. If user reports their **Save now** / **Submit** clicks aren't reaching the server: check toolbar amber state, `__inspectionSync.lastServerError` in console, and `pm2 logs ... \| findstr Inspection`. Most likely culprit is cross-site write block (editor's `site_id` doesn't match the form's site selection) or a 413 (state blob too large). |
| **Voice dictation duplicates words** | Web Speech API double-emits `isFinal` chunks on flaky networks. Fixed 2026-05-23 by rebuilding the current-session transcript idempotently on every `onresult` event (NOT incremental accumulation). If a future change touches `r.onresult` in `inspection.html`: keep `_recCurrentFinal` as a from-scratch rebuild, NEVER use `+=`. Same pattern applies to any other Web Speech consumer. |
| **`window.state` is undefined — top-level `let` is NOT on window** | Critical scoping trap in `inspection.html` (and any classic script). The body script declares `let state = {...}` and `let currentId = null` at top level. In **classic mode**, top-level `let` / `const` bindings go into the **script lexical environment** — shared across all classic scripts on the page via BARE name lookups, but **NOT exposed as `window.*` properties**. Only `var` and function declarations get aliased onto window. The overlay script that wraps `saveCurrent` referenced `window.state` / `window.currentId` (which are undefined) and silently bailed out of every server POST. The patched saveCurrent then SHOWED the green "✓ Saved" indicator (from the body script's autosave, which uses bare `state` — that works) while nothing reached the database. Symptom: field user reports "I saved but the dashboard is empty". Fixed 2026-05-24 by switching the overlay to bare `state` / `currentId` references which resolve through the global lexical env to the body script's `let` bindings. Any future overlay added to `inspection.html` (or any other classic-script page) must use bare references, NOT `window.*`, when reading variables declared with `let` / `const`. |
| **HTTP 413 Payload Too Large on `/api/inspection/save`** | The state blob in `inspection.html` carries every photo as a base64 JPEG inline in `state.items[key].photos[]`. A heavily-documented inspection (60-80% of the 173 items addressed with 1-3 photos each) can land in the 30-60 MB range. The previous `inspectionJsonBody` limit was `30mb`, which rejected these requests with Express's default 413 page. Symptom (post-scoping-fix above): the toolbar toast says `Server save failed: save HTTP 413 — <html><pre>Payload Too Large</pre>… — data is safe locally, will retry`. **Fix 2026-05-24**: bumped to `100mb` (`server.js:4461`). Also added a `size=NN.NMB` field to the `[Inspection] save ok …` audit log so we can spot inspections that are creeping toward the cap. Longer-term improvement: the form should chunk photos onto a dedicated `/api/inspection/:id/photo` endpoint so the state blob stays small — separate change. |
| **Photos/signatures now live on the FILESYSTEM, not in SQLite (2026-06-21)** | Inspection photos + signatures were stored as base64 **twice** — inline in `state_json` AND in `insp_photos.data_b64` / `insp_signatures.signature_b64` — bloating inspection.db to tens of MB per record. Now externalized to `<DATA_DIR>/blobs/inspection/<id>/…` via `services/blobStore.js`. **The save/load contract is unchanged** (transparent): `saveInspection` strips inline `data:` URLs out of `state` (replacing them with `__blob` refs) and writes files before the tx; `getInspection` re-inflates so `rec.state.*.dataUrl` (frontend hydrate path) AND `rec.photos[].data_b64` / `rec.signatures` (PPTX path) look exactly as before. **Dual-read**: legacy rows with inline b64 and no `file_ref` pass through untouched, so old + new coexist — no migration required for correctness. `deleteInspection` removes the blob dir. Locked by `tests/inspection-blobs.test.js` (round-trip + DB-slimmed + legacy + delete). Backlog shrink (optional): `node tools/migrate-inspection-blobs.js` (backup-first, idempotent, preserves `updated_at`). `data/blobs/` is gitignored (under `data/`) and NOT deployed. **`md_meeting_attachments` was left alone** — it has no write path and no frontend caller (dormant table). Rule: any new blob field goes through `blobStore`, never a new `*_b64` column. |
| **Empty draft rows on the dashboard** | After fixing the scoping + 413 bugs, the dashboard started showing empty draft rows (no site / no area / no inspector) every time someone opened `inspection.html` and clicked around. Cause: `init()` auto-creates a fresh inspection ID on every page load; any keystroke triggered the autosave debounce → the patched `saveCurrent` POSTed the empty state to the DB. **Initial fix 2026-05-24**: added `_stateIsMeaningful(state, id)` check before the debounced server POST. **Definitive fix 2026-05-24 (later)**: changed the save model entirely to **Local + manual Save now + Submit** — keystrokes now save to localStorage only and never auto-promote to the server. See §"Save model" above. The `_stateIsMeaningful` / `_promotedIds` machinery is retained: it gates the toolbar status hint ("click Save now or Submit to sync") and tracks which inspections have ever hit the server, but the patched `saveCurrent` no longer does a debounced POST. Server pushes flow only through `forceSyncNow()` (Save now button + Submit). |
| **No Delete UI for inspections** | The legacy form's `deleteInspection()` only wiped localStorage — never called the server's DELETE route — and the dashboard had no Delete button at all. Combined with the empty-draft autosave problem above, this left admins unable to clean up the backlog. **Fix 2026-05-24**: (a) relaxed `DELETE /api/inspection/:id` from `requireExecutiveOrSuperAdmin` to `requireAdmin` (admin / executive / super_admin) + added a per-delete audit log line; (b) extended the form's `deleteInspection()` to call the server DELETE before clearing localStorage (with a tolerant fallback if the row was never promoted to the server — 404 treated as success); (c) added a per-row `✕ Delete` button on the dashboard table for admin+ users, with destructive-confirmation prompt that highlights when the inspection is in submitted / closed state. |

---
