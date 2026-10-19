# 01 — Strategic Master Document: Platform Vision, Architectural Blueprint, Data Ingestion Pipeline

## 1. Vision

**SDP360 is the single operational picture of IT for every mine site, from the technician's phone to the executive deck.** It ingests what ServiceDesk Plus and the monitoring stack already know, lets sites record what no system knows (meetings, inspections, field activity), and turns both into one set of governed KPIs that anyone can assemble into a tracker or a dashboard without a developer.

Three outcomes define success:

1. **Field teams spend minutes, not hours, on reporting.** Weekly site input ≤ 20 min; inspection capture works offline on a phone; one tap raises an SDP ticket from a finding.
2. **One number has one definition.** A KPI shown in a tracker, a dashboard, a PPTX and a Teams card is computed by the same registered reader under the same RAG policy, versioned and owned by the Expert Review Committee.
3. **Reporting is automatic.** Weekly/monthly site and executive packs are generated, scheduled and distributed by the platform; humans add commentary, not data.

### 1.1 Guiding principles (binding on every design decision)

| # | Principle | Consequence |
|---|---|---|
| G1 | **Integrated data is read-only.** SDP is the system of record for tickets, changes, assets. | SDP360 never edits mirrored rows; corrections go back to SDP (ticket) — the platform may *link* and *annotate*. |
| G2 | **Native data has one owner and one key.** | Every native entity has a site FK to the canonical `sites` table and an actor; no entity is identified by position or by a free-text label. |
| G3 | **A KPI is data, not code.** | Formula text, window, RAG policy and reader id live in `metric_registry`; code only implements readers. Changing a threshold is an RFI, not a commit. |
| G4 | **Scores are recomputed from counters, never averaged from scores.** (inherited house rule) | Aggregations re-sum the underlying counts for the window; the platform never averages percentages. |
| G5 | **Never invent a date or a value.** (inherited: "Parc jamais synchronisé") | Missing data renders as *not applicable / never synced*, never as 0, never as RED. |
| G6 | **Everything that runs on a schedule runs through the sync runner.** | Lock, retry, watermark, empty guard, run log, scrubbed errors — no bespoke cron body. |
| G7 | **Field first.** | Any screen a technician uses must pass the field-readiness rule (`dashboardWidgets.fieldReadiness`) and work on a 2G/3G link with intermittent connectivity. |
| G8 | **Secrets never leave the vault.** | Write-only secret endpoints, encrypted at rest with a KDF-derived key, scrubbed from logs and run rows. |

## 2. Target architecture

### 2.1 Logical blueprint

```
┌──────────────────────────── Presentation ─────────────────────────────┐
│ Desktop web (shell + modules)   Field PWA (offline queue)   Exports    │
│ Dynamic Dashboard renderer      Tracker Builder UI          PPTX/XLSX │
│                                                             Mail/Teams│
└──────────────────────────────▲─────────────────────────────▲──────────┘
                               │ JSON (metric keys, definitions)       │
┌──────────────────────────────┴─────────────────────────────┴──────────┐
│                        Application services (Node)                     │
│  Metric Registry & Readers │ Tracker Engine │ Dashboard Engine │ RBAC  │
│  Report composer & scheduler │ Alert rules │ RFI register │ Audit log │
└──────────────▲──────────────────────────────▲──────────────────────────┘
               │ reads                        │ writes (native)
┌──────────────┴───────────────┐  ┌───────────┴───────────────────────────┐
│  Integrated mirror (ro)      │  │  Native store                          │
│  request_records, changes,   │  │  reports, action_items, md_*, insp_*,  │
│  cab, survey, assets, infra, │  │  tracker_definitions/entries, roadmap, │
│  wan snapshots & outages     │  │  dashboards, metric_registry, rfi      │
└──────────────▲───────────────┘  └────────────────────────────────────────┘
               │ sync runner (lock · retry · watermark · dedup · empty-guard · run log)
┌──────────────┴─────────────────────────────────────────────────────────┐
│  Connectors: Zoho Analytics Plus (CSV) · SDP Cloud API v3 · OpManager · │
│              Meraki · 4MyPeople · (Meridian, dormant)                    │
└─────────────────────────────────────────────────────────────────────────┘
                 PostgreSQL 17 `sdp_dashboard` — one DB, logical areas by prefix
```

### 2.2 Physical decisions

| Topic | Decision | Rationale |
|---|---|---|
| Database | PostgreSQL 17 only (complete the cutover, retire SQLite forks module by module, keep SQLite for tests only) | one engine, deterministic KPI readers, backups, replication |
| Process | Node 22 LTS, single Express app, routes extracted per module (`routes/`), one cron registry file | continuity with inherited code; monolith → modular monolith, not micro-services |
| Front-end | keep plain-HTML pages on the shared shell; introduce **one** build step (esbuild) for the field PWA and the two React apps | end in-browser Babel; PWA needs a service-worker bundle |
| Hosting | Windows/IIS/PM2 stays supported (installer); Docker image maintained for dev/CI | production reality of the sites |
| Observability | `sync_runs` + `system_log` + `/api/health/*`; Teams card on `sync_failed` ≥ 2 consecutive | reuse the existing Teams webhook path |
| Identity | Entra SSO (existing) + local accounts; RBAC through `userSites.js`; add `field-tech` role | technicians need capture rights without report-editing rights |

## 3. Unified data model

### 3.1 Canonical entities

```
sites ──┬── site_module_codes (module, code)        ← ONE place for every vocabulary (tracker, meetings, meraki, opmanager, sdp group, AD OU, risk register)
        ├── users ── user_sites ── user_roles
        ├── weekly_reports ── infra_kpis / lights / action_items(uid, lineage, status_changed_at)
        ├── md_meetings ── md_issues ── md_actions
        ├── insp_inspections ── insp_findings ── insp_actions ── insp_photos (→ blob store)
        ├── tracker_definitions ── tracker_definition_versions ── tracker_entries / tracker_unit_targets
        ├── dashboard_definitions ── dashboard_definition_versions
        └── rfi_requests

metric_registry (key, formula, window_kind, rag_policy → kpi_rag_policies, reader)
request_records · change_records · cab_approvals · survey_* · assets_* · infra_metric_snapshots · wan_* (integrated, read-only)
sync_runs · sync_watermarks · sync_locks · system_log · sla_alert_log
```

### 3.2 Bridging SDP fields to native entities (schema mapping)

| SDP / Zoho field (view) | Mirror column | Native join | Transformation |
|---|---|---|---|
| Request `id` | `request_records.request_id` | `action_items.helpdesk_ticket`, `md_actions.helpdesk_ticket`, `insp_actions.ticket_ref` | numeric only (`statusTransfer.normalizeTicket`) |
| `Technician Group` / `tech_group` | `request_records.tech_group` | `sites.zoho_group` → `sites.id` | token split on `,`; unmatched → `null` (G5), never guessed |
| `Site` (asset views, free text) | `assets.site_label` | `site_module_codes(module='assets')` | replace `scoreboardAliases.js` hard-coded map by table rows |
| `Status` | `request_records.status` | SLA pause set (`On Hold`, `Awaiting Reply`, `Approval pending`, `PO Raised`, `Pending Verification`); terminal set (`Closed`, `Resolved`, `Cancelled`, `Rejected`, `Completed`) | status sets stored in `report_config`, owned by committee |
| `Created Time`, `Resolved Time`, `Last Updated Time` | ISO text | window readers | `Last Updated Time` is the **delta watermark** |
| `Is Overdue`, `Responded Time` | booleans / ISO | Resolution SLA %, First-reply SLA % | formulas D1–D4 (`FORMULA_RECONCILIATION.md`) registered as metric rows |
| Change `Type`, `Status` | `change_records.*` | Change success % | `Completed ÷ (Completed+Failed+Backout)`; Normal counted in Standard bucket (documented divergence) |
| Survey score | `survey_results.score` | CSAT % | bands 90/70 → policy `sla-percent` |
| OpManager device → site | `infra_metric_snapshots.site_id` | `site_module_codes(module='opmanager')` | group name map |
| Meraki network → site/sub-site | `wan_subsite_networks` | `sites.id` | explicit mapping table, unmapped skipped |
| 4MyPeople employee | live | `users.email` | no storage (PII) |

### 3.3 Reconciliation rules

1. **Natural key wins.** Every mirror table has a UNIQUE natural key; writes are `INSERT … ON CONFLICT DO UPDATE`; `DO NOTHING` without a constraint is forbidden (inherited bug class).
2. **Deletions are soft and guarded.** A row missing from the live set is marked `deleted_at` only when the fetch passed the empty-fetch guard *and* returned ≥ 90 % of the previous row count; otherwise the run fails and alerts.
3. **Native references to integrated rows are by id, validated at save time**, and survive deletion (the referenced ticket may close/cancel; the link is historical).
4. **Site is resolved once, at ingestion**, into `site_id`; UI never re-resolves names.

## 4. Data ingestion pipeline

### 4.1 Job lifecycle (implemented: `services/sync/syncRunner.js`)

```
acquireLock(job) ─no─► skip (event sync_skipped_overlap)
      │yes
read watermark ─► fetch({watermark, attempt}) ─► rows
      │                      │ transient error → back-off (2s·2^n ± 20 %, Retry-After honoured, ≤ 60 s, ≤ 4 attempts)
      │                      │ permanent error → fail fast
empty-fetch guard (0 rows after a populated run → refuse, retry, fail) 
      │
dedupe(natural key, last occurrence wins; unkeyed rows dropped)
      │
apply({rows}) in ONE transaction  ─► upserted / deleted counts
      │
setWatermark(nextWatermark) · finishRun(ok) · event sync_ok
      │ on failure: finishRun(error, scrubbed) · system_log(category sync, risk 1) · Teams card after 2 consecutive failures
releaseLock(job)
```

### 4.2 Per-source strategy

| Source | Mode today | Target mode | Watermark | Cadence |
|---|---|---|---|---|
| Zoho requests | full CSV hourly | full CSV but **delta applied** (`deltaSince(rows, wm, 'Last Updated Time')`); full reconcile nightly only | max `Last Updated Time` | `*/30` (cheaper apply allows more frequent pulls within quota) |
| Zoho changes/CAB/survey | full hourly | same as requests | per view | hourly |
| Zoho assets | DELETE+INSERT daily | upsert by PK + soft-delete under guard | none (daily snapshot) | daily 04:30 |
| SDP Cloud API v3 | open-ticket poll `*/5` | add `/requests` delta by `last_updated_time` for near-real-time SLA cards; the CSV stays the reporting source | `last_updated_time` | `*/5` |
| OpManager | daily snapshot | unchanged, through runner; apiKey moved to header where API allows, TLS verified with internal CA (`docs/INTERNAL_TLS_SETUP.md`) | week id | daily 05:10 |
| Meraki | events `*/5` + nightly backfill | unchanged, through runner **with 429 back-off** | event id / timestamp | `*/5` |
| Meridian | dormant | leave; do not extend | — | — |

### 4.3 Failure handling, monitoring, retention

- `sync_runs` keeps 90 days; `/api/sync/health` exposes `last_ok`, `last_error`, `errors`, `stale_hours`; the admin page shows a per-job tile (RAG: ok < 2× cadence, amber < 4×, red beyond or any error).
- Alerting reuses the Teams SLA webhook infrastructure: card on 2 consecutive failures or staleness red; one card per job per day.
- Nightly `pg_dump` (already in runbook, not done) scheduled through the same runner so its outcome is visible in the same place.

### 4.4 Offline capability for field technicians (Phase 3 design)

- **Field PWA** (`public/field/`, esbuild bundle, service worker, IndexedDB).
- **Outbox pattern:** every capture (inspection, finding, photo, tracker entry, quick action) is written locally with a client-generated UUID and `captured_at`, queued, and synced when online through idempotent `PUT /api/field/outbox/:uuid`. The server dedupes by UUID; conflicts are resolved *last-writer-wins per field* with the server copy kept in `*_updates` history.
- **Photos** are compressed client-side (≤ 300 KB), uploaded in chunks, stored in the blob store (`services/blobStore.js`) — never inline base64 (inherited pressure point).
- **Low-bandwidth mode:** metric payloads are pre-aggregated per site; dashboards for `audience: field` are capped at 8 widgets, charts ≥ 6 columns stacked full-width, tables paged ≤ 10 rows.
- **Read cache:** the technician's site dashboard and open-actions list are cached for 24 h with a "data as of" stamp (G5: never a silent empty state).

## 5. Security and compliance posture

- Secrets: mandatory `SDP_CONFIG_KEY` in production, key derived with scrypt, migration script re-encrypts existing values; OpManager/Meraki keys never in URLs or logs (`scrub()` applied to every run row).
- Transport: TLS end-to-end (IIS 443 → Node over loopback), internal CA for OpManager (`rejectUnauthorized:true`).
- AuthZ: every write route checks `userSites.inScope`; new `field-tech` role may write captures for its sites only.
- Audit: every definition change (tracker, dashboard, metric, RAG policy) is versioned and logged with the approving RFI reference.
- Data protection: PII columns stripped at ingestion (existing `stripPiiColumns`); 4MyPeople data never persisted.

## 6. Non-functional targets

| Metric | Target |
|---|---|
| KPI freshness (SDP → dashboard) | ≤ 35 min (P1), ≤ 10 min for open-ticket SLA cards (P4) |
| Sync success rate | ≥ 99 % of scheduled runs per month |
| Weekly report input time per site | ≤ 20 min |
| Field capture on 3G | form usable offline; sync of 1 inspection with 10 photos ≤ 2 min at 1 Mbit/s |
| Dashboard load (site, LAN) | ≤ 2 s P95 |
| Test suite | green in CI on every push; new code ≥ 90 % statement coverage |
| Recovery | nightly dump, RPO 24 h (P1) → streaming replica, RPO 15 min (P4) |
