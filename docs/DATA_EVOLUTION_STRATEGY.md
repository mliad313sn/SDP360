# SDP Dashboard — Data Evolution Strategy

**Drafted**: 2026-06-05
**Status**: Discussion document — not yet implemented
**Audience**: Technical decision-makers (CIO/IT Manager) + architects
considering the next 2-3 years of the platform.

---

## TL;DR — the three questions answered

1. **What were our initial assumptions?**
   "Small dataset · single host · single tenant · text-first · one
   SQLite file per module · soft FKs across modules · inline base64
   blobs · scheduled Zoho sync into local cache."
   These held for the first 12 months. Some are starting to crack.

2. **Where will we hit walls?**
   Memory cache of all request_records (already fragile at 50k rows),
   inline base64 photos in inspection.db (6-8 GB projected), single-
   writer concurrency on the hottest tables, lack of cross-DB joins
   forcing N round-trips per report, no failover.

3. **How hard would migration to PostgreSQL be?**
   Module by module, between **EASY** (2-3 days for Tracker + Risk
   Register + Group Presets) and **HARD** (3-4 weeks for reports.db
   with the full helpdesk read path). Total: ~6-8 weeks for a clean
   end-to-end migration, with each phase deployable independently.

---

## 1 · Quantitative audit of the current state

### 1.1 Database sizes (dev box, June 2026 — prod is larger)

| DB             | Tables | Indices | Rough prod size  | Largest table          | Hot read path? |
|----------------|--------|---------|------------------|------------------------|----------------|
| reports.db     | 20+    | ~15     | ~300-800 MB est. | request_records (50k+) | YES — every Helpdesk page load |
| tracker.db     | 3      | 1       | < 5 MB           | tracker_inputs         | No — once on Tracker page load |
| inspection.db  | 8      | 6       | ~1-3 GB (photos) | insp_photos            | No — only on inspection open |
| meetings.db    | 17     | 11      | 5-50 MB          | md_issues              | Medium — Meetings dashboard |

**Note**: prod data sizes inferred from CLAUDE.md hints (e.g., "51 700-row
Zoho fetch", "memory leak with `_rawCache`", "60-80 MB per inspection"
state blob). The dev DBs are mostly empty stubs.

### 1.2 Growth rates (per year, projected)

| Table                  | Today (est) | +1 yr     | +3 yr      | Limiting factor at scale     |
|------------------------|-------------|-----------|------------|------------------------------|
| `request_records`      | ~50k rows   | 100k      | 250k+      | In-memory `_rawCache` (Node heap) |
| `survey_results`       | ~5k         | 12k       | 40k        | None concerning              |
| `survey_answers`       | ~25k        | 60k       | 200k       | None concerning              |
| `change_records`       | ~3k         | 7k        | 20k        | None concerning              |
| `cab_approvals`        | ~10k        | 25k       | 75k        | None concerning              |
| `audit_log`            | varies      | 50k+/year | 200k+      | Pagination performance       |
| `insp_photos.data_b64` | varies      | 1-3 GB    | 6-9 GB     | **VACUUM time + backup size** |
| `insp_inspections`     | ~50-100     | 300       | 1k         | None                         |
| `md_meetings`          | ~100        | 500       | 2k         | None                         |
| `md_issues`            | ~500        | 3k        | 12k        | None                         |
| `tracker_inputs`       | ~341 rows*  | ~700      | ~2k        | None                         |

*Tracker: 11 sites × 31 activities × N years. Doubles per year added.

### 1.3 What's "hot" right now

Hot path = read on every page load, latency-sensitive:

- **`request_records`** read on Helpdesk + Reports + Executive +
  Analytics + Executive Report. Cached in Node `_rawCache` to avoid
  re-querying. Already triggers OOM at the default 2 GB heap (see
  CLAUDE.md pitfall about `max-old-space-size=4096`).
- **`change_records` + `cab_approvals`** read on Executive (Tab 4) +
  Executive Report.
- **`survey_results` + `survey_answers`** read on Executive (Voice of
  Customer) + Executive Report. Slower than tickets but lower volume.
- **`tracker_config` + `tracker_inputs`** read only on Activity
  Tracker page load. Small, fast.
- **`md_meetings` + `md_issues`** read on Meetings list + Insights.
  Manageable.
- **`insp_inspections` (header only)** read on Inspections list. The
  full `state_json` is only read on open.

### 1.4 Concurrency reality

SQLite (WAL mode) supports concurrent readers + ONE writer at a time.

| Scenario | Today's reality | Future risk |
|---|---|---|
| 2 users save a tracker input simultaneously | One queues briefly, both succeed | Fine even at 100 concurrent users |
| Zoho sync writes `request_records` while user reads dashboard | Reader uses snapshot, no conflict | Fine |
| 5 users submit inspections (30-60 MB blob each) at the same time | First one wins the writer lock; others wait ~5-15 sec | Becomes annoying past 20 concurrent inspection saves |
| Background re-index of `request_records` triggered by hourly sync | Read latency briefly spikes | Could cause user-visible UI freeze at >200k rows |

---

## 2 · Initial assumptions (inferred from the code)

These are reverse-engineered from how the codebase is structured.

| # | Assumption made early | How it shows up | Cost as we grow |
|---|---|---|---|
| 1 | "Small dataset, single host" | better-sqlite3 sync API used everywhere on the request thread | Each query blocks the Node event loop. Fine at 1ms, problematic at 100ms |
| 2 | "One DB per module, soft FKs" | Each module owns its `*.db` file, cross-DB joins done in JS | Easy to develop, but N+1 round-trips on any cross-module report |
| 3 | "Inline base64 for photos/signatures" | `insp_photos.data_b64`, `insp_signatures.signature_b64`, `md_meeting_attachments.data_b64` | Simple round-trip, but VACUUM gets slow + backups balloon |
| 4 | "Schema migrations via idempotent `ALTER TABLE` blocks" | reports-db.js has many `try { db.exec('ALTER TABLE ... ADD COLUMN ...') } catch(e) {}` | Works fine for additive migrations; can't safely rename/drop columns |
| 5 | "Zoho is the source of truth — cache it locally" | `zoho-sync.js` fetches CSV exports hourly, upserts into local tables | Stays correct; cost is the full table scan on Zoho side |
| 6 | "JSON columns when shape doesn't matter" | `state_json`, `udf_json`, `chart_data`, `comments_metrics` etc. | Flexible, but every read needs `json_extract` — slower than native columns |
| 7 | "Lookup tables are bilingual (EN/FR)" | Every `md_*` and `insp_*` lookup has `name_en` + `name_fr` | Good — adding new languages is just adding columns or a translation table |
| 8 | "Cross-DB site code mapping in JavaScript" | Each module has its own `SITE_MAP` + `siteNameToCode()` | Repetitive, easy to drift between modules. Already a documented pitfall |
| 9 | "Backup via VACUUM INTO snapshots" | `db-backup.js` for tracker/inspection/meetings | Slow on large DBs (esp. inspection with photos), needs scheduling |
| 10 | "PM2 single instance, no failover" | `pm2 start server.js --name endeavour-dashboard` | Acceptable for internal tool, problematic for 24/7 mission-critical |

---

## 3 · Pressure points expected in the next 2-3 years

### 3.1 The `_rawCache` Node heap (already fragile)

CLAUDE.md already documents the workaround: `--max-old-space-size=4096`.
Beyond 200-300k tickets, this 4 GB ceiling will also be reached, and
the strategy "load all rows into memory once per server lifetime"
starts breaking down.

**Symptom expected**: PM2 restarts increase, browser shows "Connecting
to data proxy..." more often, hourly syncs take longer.

**Fix today**: bump heap to 8 GB, accept the OOM trade-off.
**Long-term fix**: stop caching the full dataset in memory — query the
DB on demand with proper indices.

### 3.2 Inline base64 photos in `insp_photos`

At ~25-30 MB per inspection (after the 2026-05-25 photo compression
fix) and 50-100 inspections per month, the DB grows ~2 GB/month from
photos alone.

**Symptom expected**:
- `VACUUM INTO` backups take longer (currently fast, eventually 30-60 sec)
- Disk space pressure on prod
- `inspectionDb.getInspection(id)` slows down (TEXT column reads scale linearly with size)

**Fix today**: monitor disk space, increase compression aggressiveness.
**Long-term fix**: move photos to **filesystem blobs** (`/data/inspection-photos/`)
or **S3-compatible object storage** (MinIO on-prem) with the DB
storing only the path. ~80% size reduction on the DB.

### 3.3 Cross-DB join cost on reports

Every Executive Report / Group IT Report does ~5-8 cross-DB lookups
(users in reports.db, projects in tracker.db, recent inspections in
inspection.db, recent meetings in meetings.db). Currently OK because
each individual query is sub-millisecond. With 200k tickets and 10k
inspections, individual queries get to 50-100ms, and total report
generation goes from 1 sec → 5-10 sec.

**Symptom expected**: report builder feels slow, PPTX export 502s
become more frequent.

**Fix today**: pre-compute monthly aggregates.
**Long-term fix**: consolidate into a single DB (Postgres) where you
can JOIN across all module data in one query.

### 3.4 No partitioning on `request_records`

Queries like "tickets created in May 2026" already use the
`idx_rr_created` index, so they're fast today. At 1M+ rows, even
indexed range queries get to 50ms+ for full month scans, and
write-time index maintenance gets slower.

**Symptom expected**: hourly sync takes 30-60 sec instead of 5-10 sec.

**Fix today**: no action.
**Long-term fix**: time-partition the table (one partition per quarter
in Postgres), or move historical data to a `request_records_archive`
table after N months.

### 3.5 Schema drift between modules

Currently every module has its own `siteNameToCode()` map (tracker uses
`KLN` for Kalana, inspection uses `KGO`, etc.). Adding a new site requires
4 updates across 4 files. Already a documented pitfall.

**Symptom expected**: missing site appears as "no data" silently on one
module, gets flagged weeks later.

**Fix today**: when adding a site, search-and-update all `SITE_MAP`
blocks.
**Long-term fix**: single canonical sites table in a shared DB.

### 3.6 No failover / no replication

The whole stack runs on one Windows Server (the SDP-Dashboard host).
If it goes down, the entire IT dashboard goes with it. Backup recovery
takes ~30 min to spin up on a different box.

**Symptom expected**: any planned outage (Windows update, hardware
maintenance) requires a maintenance window.

**Fix today**: document the recovery process (`docs/DB_RECOVERY.md`).
**Long-term fix**: hot-standby replica (Postgres streaming replication
or MariaDB Galera cluster) with automatic failover.

---

## 4 · Three evolution paths

### Path A — Incremental within SQLite (Cheapest)

**Effort**: 2-3 weeks total, spread over months.
**Risk**: Low — additive changes only.
**Ceiling**: 200-500k tickets, 10-50 GB total. ~5 more years of growth.

What we do:
1. **Move photos out of inspection.db** → filesystem `/data/inspection-photos/<inspection_id>/<n>.jpg` with the DB storing only `path` instead of `data_b64`. Cut inspection.db size by ~80%.
2. **Stop preloading `_rawCache`** → query directly with proper indices and short response times.
3. **Add monthly aggregates table** for the helpdesk hot path → `request_records_monthly` (one row per month × site × group) updated by the hourly sync.
4. **Single canonical sites table** in reports.db → drop the per-module `SITE_MAP` constants, look up live.
5. **Audit log retention policy** → trim audit rows older than 2 years to keep DB lean.
6. **Backup automation** with rotation (daily, keep 7 + 4 weekly + 12 monthly).

**Output**: same architecture, much more headroom. Bought 5 more years.

### Path B — Hybrid: PostgreSQL for hot data + keep SQLite for cold modules

**Effort**: 6-8 weeks.
**Risk**: Medium — coexistence of two engines requires careful auth + connection management.
**Ceiling**: Multi-million rows on the hot side, no real ceiling on cold side.

What we do:
1. Install **PostgreSQL 16** on prod (Windows installer or Docker).
2. Migrate **reports.db only** to Postgres. All Zoho-synced data + reports + auth + sessions.
3. Keep **tracker.db, inspection.db, meetings.db** on SQLite (low-write, low-read modules).
4. Replace `better-sqlite3` calls in `reports-db.js` with `pg` (the Node Postgres client).
5. Replace in-memory `_rawCache` with on-demand Postgres queries (Postgres handles 50k-row aggregations in <100ms easily).
6. Update Zoho sync to write to Postgres instead.
7. Keep the soft FK pattern: tracker/inspection/meetings still reference Postgres users via JS lookups.

**Pros**:
- Hot data benefits from Postgres (concurrent writers, partitioning, full-text search, materialized views, JSON ops are faster).
- Cold modules stay simple — no migration cost.
- Cross-module queries that combine reports + tracker/inspection still need 2 round-trips, but no worse than today.

**Cons**:
- Operationally heavier: 2 DBs to back up, 2 connection pools, 2 auth contexts.
- Requires Postgres admin skill on the team.

**Output**: ~10× headroom on the hot path, same simplicity on the rest.

### Path C — Full migration to PostgreSQL, single DB

**Effort**: 10-14 weeks.
**Risk**: Medium-high — large surface area, but the modules are well-isolated so phased migration is possible.
**Ceiling**: None of practical concern.

What we do:
1. Install Postgres on prod.
2. Migrate ALL 4 DBs into one Postgres DB with schema namespaces:
   - `reports` schema: today's reports.db
   - `tracker` schema: today's tracker.db
   - `inspection` schema: today's inspection.db
   - `meetings` schema: today's meetings.db
3. Single canonical `reports.sites` + drop module-specific SITE_MAPs.
4. Real cross-schema FKs (e.g. `inspection.inspections.created_by → reports.users.id`).
5. Migrate photos to filesystem/S3 in the same shot.
6. Use Postgres's **MERGE** or **INSERT ... ON CONFLICT** for Zoho upserts (same pattern as today).
7. Postgres **logical replication** to a hot-standby for failover.

**Pros**:
- One DB to operate, one connection pool, one backup process.
- Full SQL JOINs across modules → reports get much faster + simpler.
- Modern tooling: pgAdmin, Datagrip, Grafana, PowerBI all speak Postgres natively.
- Built-in time partitioning for `request_records`.
- Materialized views for executive dashboards = sub-second loads.
- Logical replication = real HA story.

**Cons**:
- Highest upfront cost.
- Schema-namespace approach is non-standard for SQLite developers, requires teaching.
- Need to rewrite EVERY data access call (every `*-db.js` module).

**Output**: production-grade architecture. Bought 10+ years.

---

## 5 · Per-module migration difficulty matrix

If we go down Path B or C, here's the bill of materials per module.

### 5.1 Migration difficulty per module

| Module / DB | Tables | LOC (data access) | Inline base64? | JSON columns | Cross-DB refs | **Migration difficulty** |
|---|---|---|---|---|---|---|
| `tracker.db` | 3 | ~400 (tracker-db.js) | No | 4 (JSON arrays) | 1 soft FK to users | **🟢 EASY — 2-3 days** |
| `rr_site_aliases` + `dashboard_preset_groups` | 2 | ~200 | No | No | None | **🟢 EASY — 1 day** |
| `meetings.db` | 17 | ~1400 (meetings-db.js) | Rare attachments | None | 2 soft FK to users + inspection codes | **🟡 MEDIUM — 5-7 days** |
| `inspection.db` | 8 | ~900 (inspection-db.js) | YES — photos + sigs | state_json blob | 1 soft FK to users | **🟠 MEDIUM-HARD — 7-10 days** (photos migration is the big task) |
| `reports.db` Auth (users, sites, sessions, user_roles) | 4 | ~500 (auth fns in reports-db.js) | No | Some details JSON | Referenced by EVERY module | **🟡 MEDIUM — 5-7 days** but blocking — must be done first |
| `reports.db` Reports + KPIs (weekly/monthly/objectives/lights/actions/audit) | 9 | ~800 | No | Several JSON cols | None | **🟡 MEDIUM — 5-7 days** |
| `reports.db` Zoho-synced (`request_records`, `change_records`, `cab_approvals`, `survey_*`, `sync_metadata`) | 6 | ~1500 (reports-db.js + zoho-sync.js) | No | `udf_json`, `comments_*` | Hot read path — UI everywhere | **🔴 HARD — 15-20 days** |

**Total** for Path C (full migration): **~40-60 days** = 8-12 weeks
if done sequentially by one engineer.

### 5.2 What makes each difficulty tier

| Tier | Characteristics |
|---|---|
| 🟢 EASY | Schema is small, columns are flat, no cross-DB refs, well-isolated module, can be migrated in a single PR with smoke test |
| 🟡 MEDIUM | Larger schema or has JSON columns or has soft FKs to other modules. Needs care to keep refs intact during transition |
| 🟠 MEDIUM-HARD | Has inline blobs that should move to filesystem, or has a hot read path that needs benchmarking after migration |
| 🔴 HARD | Touches the hottest UI surfaces, has hundreds of inline call sites across the codebase, schema migrations need bidirectional compatibility (old code keeps working while new code rolls out) |

### 5.3 Recommended order

Always migrate **users + sites + sessions** FIRST. Everything else
depends on these tables.

```
Phase 0:  Set up Postgres + connection pool + auth library     1 week
Phase 1:  Migrate auth (users + sessions + user_roles)         1 week
Phase 2:  Migrate small add-ons (RR aliases + Group Presets)   3 days
Phase 3:  Migrate tracker.db                                   3 days
Phase 4:  Migrate meetings.db                                  1 week
Phase 5:  Migrate inspection.db (incl. photos to filesystem)   2 weeks
Phase 6:  Migrate reports/KPIs schema                          1 week
Phase 7:  Migrate Zoho data + hot read path                    3 weeks
Phase 8:  Decommission SQLite files + cleanup                  3 days
```

Each phase deployable independently. The application can run with
a mixed backend (some modules on Postgres, others still on SQLite)
during the transition — that's the value of the modular shape.

---

## 6 · Target architecture (recommended: Path B → C)

```
                  ┌──────────────────────────────────────────┐
                  │           PostgreSQL 16 (prod)           │
                  │  schemas: reports, tracker, inspection,  │
                  │            meetings                      │
                  │                                          │
                  │  - real cross-schema FKs                 │
                  │  - logical replication → hot standby     │
                  │  - time-partitioned request_records      │
                  │  - materialized views for executive KPIs │
                  └──────────────────────────────────────────┘
                                  ▲
                                  │ pg (node-postgres + connection pool)
                                  │
                  ┌───────────────┴──────────────────────────┐
                  │            Node.js + PM2                 │
                  │  - same Express routes                   │
                  │  - data access via thin per-module       │
                  │    repositories (no in-memory cache for  │
                  │    hot data; relies on Postgres caching) │
                  └──────────────────────────────────────────┘
                                  ▲
                                  │ HTTPS via IIS reverse proxy
                                  │ (URL-versioned assets, etc.)
                                  ▼
                  ┌──────────────────────────────────────────┐
                  │            Browser clients               │
                  └──────────────────────────────────────────┘

   ┌──────────────────────────────────────────────────────────┐
   │            On-prem object storage (MinIO or               │
   │            Windows file share)                            │
   │  /inspection-photos/<inspection_id>/<n>.jpg              │
   │  /meeting-attachments/<meeting_id>/<filename>            │
   │  /signatures/<inspection_id>/<role>.png                  │
   └──────────────────────────────────────────────────────────┘
```

---

## 7 · Recommendation

**Short-term (next 3 months)**: Path A — incremental SQLite cleanup.

Cheap, low-risk, buys time. Specifically:
1. Move inspection photos to filesystem blobs (~3 days work, ~80% DB size cut).
2. Stop preloading `_rawCache` (~2 days work, removes OOM risk).
3. Single canonical sites table in reports.db (~2 days work, removes drift footgun).

**Medium-term (6-12 months)**: Path B — Postgres for hot data.

When the team is ready and there's a budget/window:
4. Stand up Postgres on prod (1 week incl. install + backup config).
5. Migrate reports.db → Postgres (~4 weeks incl. testing).
6. Keep tracker/inspection/meetings on SQLite — they're stable and small.

**Long-term (1-2 years)**: Path C if the platform succeeds.

If we add 5+ new modules (CMDB, asset management, KB, vendor SLAs)
and the data volume keeps growing, do the full unification under one
Postgres instance.

**Trigger for accelerating**: any of these means "stop kicking the can":
- Request_records > 300k rows
- Inspection.db > 5 GB
- Helpdesk page load p95 > 3 seconds
- 2+ "the dashboard is down" incidents in a quarter
- Need for a hot-standby / DR site

---

## 8 · Open questions for the architect / decision-maker

1. **Hot-standby requirement?** If yes, Path B becomes "Path B + replica" and adds ~1 week.
2. **On-prem only or cloud?** Postgres cloud (Azure Database for PostgreSQL) is operationally cheaper than self-hosted. But sovereignty concerns for ITSM data (mentioned re: Mistral Nemo local LLM choice) probably mandate on-prem.
3. **Multi-tenant?** Today the platform is single-tenant (Endeavour Mining). If we ever offer it to another mining group, multi-tenancy adds a schema-per-tenant or row-level-tenant_id pattern. Cleaner on Postgres than SQLite.
4. **Reporting tool?** PowerBI / Tableau / Metabase / Superset can connect directly to Postgres. Today they would have to read SQLite files via a custom data source — major friction.
5. **Schema versioning tool?** Today we use idempotent `ALTER TABLE` blocks. With Postgres we'd adopt **Flyway** or **node-pg-migrate** for proper versioned migrations.

---

## 9 · Per-module future-additions impact

If we add new modules (e.g., **CMDB**, **Knowledge Base**, **Vendor Management**), the questions are:

| New module | Best fit (today) | Best fit (Path B) | Best fit (Path C) |
|---|---|---|---|
| CMDB (asset DB linked to tickets) | Own SQLite or join reports.db | Postgres `cmdb` schema | Postgres `cmdb` schema (clean) |
| Knowledge Base (text articles + tags) | Own SQLite — text-heavy is fine | Postgres for full-text search | Postgres `kb` schema with `tsvector` columns |
| Vendor SLA tracking | Reuse `change_records`-like table in own SQLite | Postgres `vendors` schema | Postgres `vendors` schema |
| Cost allocation per site | Cross-module reads — heavy | Postgres for fast multi-schema joins | Same |
| Workforce / shift planning | Own SQLite is fine | Same | Same |
| Real-time event stream (alerts) | Not viable — SQLite is poll-only | Postgres LISTEN/NOTIFY | Same |
| Postmortem / RCA module | Own SQLite — narrative text | Postgres for full-text RCA search across years | Same |

**Rule of thumb**:
- Modules that are **mostly read by their own UI** (Tracker, Inspections, Meetings) → SQLite is fine indefinitely
- Modules that are **read by reports / cross-cut other modules** → Postgres after Path B
- Modules that need **real-time** or **full-text search** → Postgres from day one

---

## 10 · Backup + recovery posture (current vs target)

| Aspect | Today (SQLite) | After Path B (PG + SQLite) | After Path C (PG only) |
|---|---|---|---|
| Backup method | `VACUUM INTO` per DB | `pg_dump` + SQLite `VACUUM INTO` | `pg_dump` + pgBaseBackup + WAL archiving |
| Backup frequency | Manual/cron | Postgres daily WAL + SQLite weekly | Postgres continuous WAL + daily base |
| Recovery time | ~30 min restore + reindex | ~15 min for Postgres, instant for SQLite | ~5 min from latest base + WAL replay |
| Point-in-time recovery | No (snapshot-only) | Yes for Postgres data | Yes for everything |
| Hot standby | No | Optional (Postgres streaming replica) | Recommended (Postgres logical or streaming) |
| Documented runbook | YES — `docs/DB_RECOVERY.md` | Needs Postgres section added | Single unified runbook |

---

## 11 · Pragmatic next steps (if we say "yes, evolve")

Even before committing to Path B/C, do these zero-cost things THIS quarter:

1. **Measure prod DB sizes** monthly. Add a `pm2 logs` line at boot:
   ```js
   console.log('[boot] DB sizes:',
     fs.statSync('reports.db').size,
     fs.statSync('tracker.db').size,
     fs.statSync('inspection.db').size,
     fs.statSync('meetings.db').size);
   ```
   Lets us see growth curves.
2. **Track read latency** per route in pm2 logs. Already partially done.
3. **Stop new modules from adding new SQLite files**. Anything new goes into reports.db (or wait for Path B). One fewer DB to migrate later.
4. **Single canonical site list in reports.db**. Drop the per-module `SITE_MAP`. (Path A item #4 — pull forward.)
5. **Move inspection photos to filesystem**. (Path A item #1 — pull forward; biggest immediate win.)

---

## 12 · Cost / value summary

| Option | Effort | Maintenance cost | Headroom bought | Risk |
|---|---|---|---|---|
| Status quo | 0 | Low | 1-2 years | High (OOM, runaway DBs) |
| Path A (incremental SQLite) | 2-3 weeks | Same as today | +3-5 years | Very low |
| Path B (PG for hot, SQLite for cold) | 6-8 weeks | Slightly higher (2 engines) | 5-10 years | Low-medium |
| Path C (full Postgres) | 10-14 weeks | Lower (1 engine, mature ecosystem) | 10+ years, easy multi-tenant | Medium |

**Personal recommendation**: do Path A within the next quarter (mandatory),
plan Path B for the year after, defer Path C until Path B is felt as
limiting.

---

*End of DATA_EVOLUTION_STRATEGY.md — 2026-06-05*
*This document is a discussion draft, NOT a commitment to ship anything.*
*Decisions should be made by the IT Director / CIO / Architecture Lead.*
