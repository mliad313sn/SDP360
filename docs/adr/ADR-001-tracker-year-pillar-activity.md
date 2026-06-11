# ADR-001 — Tracker schema: bind pillars to years and activities to pillars

**Status**: ✅ **Accepted**
**Date drafted**: 2026-06-09
**Date accepted**: 2026-06-09
**Author**: Claude (drafted with the project owner)
**Approved by**: samaziz679 (project owner / repository maintainer)
**Supersedes**: none (first ADR in this project)
**Related**:
  - `docs/DATA_ARCHITECTURE.md` §2 — current tracker schema
  - `docs/DATA_EVOLUTION_STRATEGY.md` Path A — broader cleanup roadmap
  - `docs/TRACKER_DB_SCHEMA.md` — module deep-dive
  - Commit `cc245cf` — Palier 1 prerequisite (added `getActivityCode` helper)

---

## 1 · Context

### 1.1 Problem statement

The Activity Tracker module persists its entire structural configuration
in a **single row** of `tracker_config` (id = 1), with all variable parts
stored as JSON blobs:

```sql
CREATE TABLE tracker_config (
  id                  INTEGER PRIMARY KEY DEFAULT 1,
  activities_json     TEXT NOT NULL DEFAULT '[]',
  pillar_weights_json TEXT NOT NULL DEFAULT '{}',
  active_sites_json   TEXT NOT NULL DEFAULT '[]',
  years_json          TEXT NOT NULL DEFAULT '[]',
  current_month       INTEGER NOT NULL DEFAULT 4,
  updated_at          TEXT DEFAULT (datetime('now'))
);
```

Activities reference their parent pillar by **name string** ("1-Network
Infrast"). `tracker_targets` and `tracker_inputs` reference activities by
their **positional index** (`activity_ix`) within the `activities_json`
array.

This shape has **three structural defects** that get worse as the program
spans multiple years:

#### Defect 1 — No temporal isolation of pillars or activities
The pillar weights and activity list live in **one global singleton row**
with no `year` dimension. Consequences:

- If pillar P1 weighs 30% in 2025 and is changed to 35% in 2026, **all
  historical 2025 reports recompute with 35%**. Past scores become
  retroactively wrong every time the config changes.
- If an activity is dropped from the 2026 program, it must be physically
  removed from `activities_json` — which also erases the ability to
  view what was being measured in 2024 / 2025.
- The dashboard cannot answer "what did Network Infrastructure mean in
  Q3 2025?" because the schema captures only the current truth.

#### Defect 2 — `activity_ix` is a positional reference
Children (`tracker_targets`, `tracker_inputs`) refer to activities by
their **index** in the JSON array, not by a stable identifier. Reordering
or splicing the array silently misaligns all child rows.

CLAUDE.md already documents this as a footgun:
> *"Deleting an activity must `splice()` it out of `D.activities`, every
> `D.targets[s]` array AND every `D.inputs[yr][s]` array — otherwise the
> engine's activity_ix lookups misalign and rows shift. Don't regress to
> `Array.filter()` which leaves the parallel arrays unchanged."*

The correctness depends entirely on **application-level discipline**.
One mistake in the delete code = silent data corruption.

#### Defect 3 — Pillar is a free-text string per activity
Each activity carries its pillar as a duplicated string:

```json
{ "name": "Backup verification", "pillar": "1-Network Infrast", ... }
```

Renaming a pillar requires updating it manually in every activity that
references it. No referential integrity, no canonical pillar catalogue.

### 1.2 Why now

Three triggers came together:

1. A peer reviewer flagged the year-vs-pillar coupling as a structural
   problem (acknowledged by both the project owner and this ADR's author).
2. The 2026 program contains pillars and activities that differ
   materially from 2025; we are currently making this work by physically
   editing the singleton, but it means **2025 history is lost** every
   time we adjust.
3. Palier 1 (commit `cc245cf`) introduced the `getActivityCode()` helper
   and exposed `D.activities[i].code` — this is the **prerequisite** for
   moving to ID-based references. The refactor described in this ADR is
   the natural follow-on.

### 1.3 Out of scope

This ADR proposes a schema change to **`tracker.db` only**. It does NOT:

- Migrate the four DBs to PostgreSQL (that's Path B/C in
  `DATA_EVOLUTION_STRATEGY.md`).
- Refactor `inspection.db` or `meetings.db` (their issues are different).
- Replace `tracker_config` cleanup-only fields (`current_month`,
  `active_sites_json`) — those stay where they are.

---

## 2 · Decision drivers

| Driver | Priority | Why |
|---|---|---|
| Historical integrity (frozen past scores) | 🔴 Critical | Operations leadership relies on year-over-year comparisons |
| No silent data corruption on activity reorder/delete | 🔴 Critical | Already a documented footgun |
| Per-year pillar evolution | 🟠 High | 2026 program already differs from 2025 |
| Backwards compatibility during rollout | 🟠 High | Tracker is used daily, no maintenance window available |
| Minimal blast radius on App.jsx and PPTX renderer | 🟡 Medium | These are the consumers; changing them costs design + QA |
| Future PowerBI / external reporting | 🟡 Medium | A normalised schema is easier to query |

---

## 3 · Options considered

### Option 0 — Status quo (do nothing)

Keep the singleton `tracker_config` and rely on application discipline.

**Pros**:
- Zero engineering cost.
- No risk of regression.

**Cons**:
- All three defects persist indefinitely.
- Historical scores remain falsifiable.
- Each new year amplifies the problem.

**Verdict**: ❌ Rejected. Not a real option — the problem worsens with
every year of operation.

### Option 1 — JSON enrichment in the existing singleton

Keep `tracker_config` as a singleton but restructure `years_json` from
a flat list `[2025, 2026]` into a nested structure:

```json
{
  "years": [
    { "year": 2025, "pillars": [...], "activities": [...] },
    { "year": 2026, "pillars": [...], "activities": [...] }
  ]
}
```

**Pros**:
- No schema change at all — only the JSON blob's internal shape.
- Quick to implement (~2 days).

**Cons**:
- Still un-queryable from SQL (`json_extract` chains).
- Still no FK integrity (referential consistency is application-level).
- Activity index is still positional within each year's array.
- No improvement for future external reporting tools.
- Just defers the real fix.

**Verdict**: ❌ Rejected. Solves the historical-truth problem but keeps
the fragility. It would cost a refactor now and another one later.

### Option 2 — Normalised tables (RECOMMENDED)

Introduce three new SQLite tables that make the hierarchy explicit:

```sql
CREATE TABLE tracker_years (
  year       INTEGER PRIMARY KEY,
  active     INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE tracker_pillars (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  year          INTEGER NOT NULL,
  code          TEXT NOT NULL,              -- 'P1', 'P2', 'P3', 'P4'
  name          TEXT NOT NULL,              -- 'Network Infrastructure'
  weight        REAL NOT NULL,              -- 0.30
  display_order INTEGER DEFAULT 0,
  active        INTEGER DEFAULT 1,
  FOREIGN KEY (year) REFERENCES tracker_years(year) ON DELETE CASCADE,
  UNIQUE (year, code)
);

CREATE TABLE tracker_activities (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pillar_id     INTEGER NOT NULL,
  code          TEXT NOT NULL,              -- stable identifier (from Palier 1 helper)
  name          TEXT NOT NULL,
  kpi_type      TEXT NOT NULL,              -- BOOLEAN | PERCENT | MILESTONE | ...
  start_month   INTEGER,                    -- 1..12
  end_month     INTEGER,                    -- 1..12
  display_order INTEGER DEFAULT 0,
  active        INTEGER DEFAULT 1,
  FOREIGN KEY (pillar_id) REFERENCES tracker_pillars(id) ON DELETE CASCADE
);
CREATE INDEX ix_track_act_pillar ON tracker_activities(pillar_id);
```

`tracker_targets` and `tracker_inputs` will gain a new column
`activity_id INTEGER` (FK → `tracker_activities.id`) while keeping the
legacy `activity_ix` column populated during the transition.

**Pros**:
- Real referential integrity (FK ON DELETE CASCADE).
- Per-year pillars and activities — historical truth is preserved
  forever.
- Activity ID is stable across reorders and deletes.
- Native SQL JOINs replace JSON extracts.
- Compatible with future external tools (PowerBI, Metabase) without
  custom JSON parsing.
- Compatible with Palier 1's `getActivityCode()` (which produces the
  code value to seed `tracker_activities.code`).

**Cons**:
- 5-7 days of engineering work (schema + data migration + 4 code paths).
- Requires a dual-write transition phase to avoid downtime.
- Touches several consumer files (App.jsx, engine.js, tracker-pptx.js,
  services/reportPayload.js, tools/exec-pptx/render.py).

**Verdict**: ✅ **Recommended.** The cost is real but bounded, and the
benefit is permanent.

### Option 3 — Defer until PostgreSQL migration (Path B/C)

Skip the SQLite refactor and do this work as part of the eventual
PostgreSQL migration described in `DATA_EVOLUTION_STRATEGY.md`.

**Pros**:
- Avoids touching SQLite twice (refactor now + migration later).
- Postgres has better support for temporal columns and partitioning.

**Cons**:
- PostgreSQL migration has no committed timeline (could be 12+ months).
- During those months, every year of program data accumulates the
  defects described above.
- Pretends "we'll do it right later" while actively making the situation
  worse year-on-year.

**Verdict**: ❌ Rejected unless Postgres migration is approved with a
**firm Q3/Q4 2026 timeline**. Otherwise, do Option 2 now.

---

## 4 · Decision

**Adopt Option 2** (normalised SQLite tables) with a **5-phase dual-write
migration** to preserve continuous availability.

The decision is informed by:
- Palier 1 has already shipped the prerequisite (`getActivityCode` helper).
- The tracker is critical to monthly operations reviews — downtime is
  not acceptable, hence the dual-write phase.
- PostgreSQL migration has no committed date (per
  `DATA_EVOLUTION_STRATEGY.md` §7 — Path B is "medium-term, 6-12 months
  from now", Path C is "long-term, 1-2 years").

---

## 5 · Migration plan (5 phases)

> **Execution log (updated 2026-06-11)**
>
> | Phase | Shipped | Commits | Notes |
> |---|---|---|---|
> | Phase 0 — normalised schema + backfill | ✅ 2026-06-09 prod | `909dade` | Backfill: 2 years, 14 pillars, 62 activities, 341 targets, 651 inputs |
> | Phase 1 — dual-write/delete/wipe + audit | ✅ 2026-06-09 prod | `50fe8fd` + audit fixes `510d160`/`d5ad098`/`0cb5540` | AUDIT PASSED on prod; 11 historical residuals classified benign |
> | Phase 2 — switchable reads + shadow | ✅ 2026-06-11 prod | `2c07e85` + `dbc5c6f` | `TRACKER_READ_SOURCE=new` live; shadow (now new→legacy) stays armed |
> | Phase 3 — App.jsx consumes activity_id | ⏳ not started | — | |
> | Phase 4 — decommission legacy singleton | ⏳ not started | — | Gate: 4 weeks of Phase 3 stability |
>
> **Amendment 2026-06-11 — observation window shortened (J+7 → J+2).**
> The ADR planned one week of shadow observation before switching
> reads. The project owner advanced the switch to day 2 because:
> (a) byte-identical parity between the two backends was proven on
> BOTH dev and prod data at J0 (11/11 fields MATCH including the
> activities array after the 4 legacy-field columns were added);
> (b) two days of real production usage produced zero `shadow diff`
> log lines; (c) rollback is a 30-second env-var flip; and (d) the
> shadow remains armed post-switch in the inverse direction
> (new→legacy), so any divergence introduced later still gets logged.
> Post-switch smoke test passed: tracker UI values identical,
> input save/reload round-trip OK, no shadow diff.

### Phase 0 — Implementation on dev box (1-2 days)

- Create the three new tables in `tracker-db.js` `_initSchema()`
  (additive — `CREATE TABLE IF NOT EXISTS`).
- Add `activity_id` column to `tracker_targets` and `tracker_inputs`
  (additive — `ALTER TABLE ... ADD COLUMN ... NULL`).
- Write `_backfillFromLegacy()` — reads `tracker_config` singleton,
  populates `tracker_years` / `tracker_pillars` / `tracker_activities`,
  back-fills `activity_id` in targets and inputs using the
  `getActivityCode()` mapping from Palier 1.
- Idempotent: re-running the backfill skips rows already present.

**Deliverable**: code committed to `main`, deployed to dev box, tested
with the real `tracker.db` from prod backup.

### Phase 1 — Deploy with dual-write (1 day deploy + 1 week observation)

- Deploy the new schema to prod (additive, zero risk).
- `saveTracker()` writes to BOTH the legacy singleton AND the new
  tables (idempotent via INSERT OR REPLACE).
- `loadTracker()` reads from the **legacy** singleton (no behaviour
  change for App.jsx).
- Add boot-time diagnostic: log the row counts of the new tables for
  monitoring.

**Acceptance criteria**: after one week of normal usage, the new tables
must remain in sync with the legacy singleton. A nightly diff script
(`_audit_tracker_dualwrite.cmd`) verifies parity.

**Rollback**: drop the new tables, revert the code. The legacy
singleton has continued to be the source of truth — no data is lost.

### Phase 2 — Switch reads to new schema (1 day deploy + 1 week observation)

- `loadTracker()` now reads from the new tables, joins to assemble the
  `D` object that App.jsx expects.
- The shape returned to App.jsx is **identical** — the React app and the
  PPTX renderers do not need to change in this phase.
- `saveTracker()` continues to dual-write (legacy + new) for safety.

**Acceptance criteria**: dashboards render identically to Phase 1 for
one full week. Monthly review uses the dashboard live without
discrepancies.

**Rollback**: flip `loadTracker()` back to reading the legacy singleton.

### Phase 3 — App.jsx + engine.js consume the new shape (3-5 days)

- App.jsx reads `D.activities[].id` and `D.pillars[].id` (new) instead
  of relying on array indices.
- engine.js uses activity_id internally (still derives display from name
  / pillar / kpi_type — same calculations).
- PPTX renderers (`tracker-pptx.js`, `tools/exec-pptx/render.py`) updated
  in the same release.
- `saveTracker()` continues dual-write (legacy preserved for emergency
  rollback).

**Acceptance criteria**: PPTX export of the current month matches
byte-for-byte the previous version's output (excluding timestamps).

**Rollback**: revert App.jsx + engine.js + pptx renderers. Legacy
singleton still up to date.

### Phase 4 — Decommission legacy singleton (1 day, scheduled)

- After 4 weeks of Phase 3 stability with no incidents:
  - `saveTracker()` stops writing to `tracker_config` singleton.
  - `tracker_config` is renamed `tracker_config_legacy` and marked
    read-only.
  - A boot warning logs if anyone tries to read it.

**Final state**: the legacy schema is preserved (for forensics) but
no longer the source of truth. If a serious bug is found in the new
schema, restore from backup (`_backup_prod.cmd` snapshots include
`tracker.db`) and re-enable the legacy code from git history.

---

## 6 · Consequences

### Positive

- **Historical truth is frozen**: changing pillar weights or activity
  definitions in 2026 leaves 2025 reports untouched.
- **Activity_id is stable**: reordering or deleting activities cannot
  silently corrupt `tracker_inputs`.
- **Native SQL queries**: external reporting tools (PowerBI, Metabase,
  ad-hoc SQL) can JOIN against `tracker_pillars` and `tracker_activities`
  directly.
- **CLAUDE.md pitfall removed**: the "Stale activity_ix after pillar/
  activity delete" footgun goes away — the FK CASCADE handles it.
- **Foundation for the next ADRs**: similar refactors for
  `infra_kpi_catalog` (already a catalogue, needs FK on `infra_kpis`)
  and `insp_categories` (already a catalogue, needs FK on `insp_findings`)
  follow the same pattern documented here.

### Negative

- **5-7 days of engineering work** distributed over ~7-9 weeks (because
  of dual-write observation windows).
- **Backup size grows** during dual-write (both schemas populated).
  Negligible — tracker.db is < 5 MB even at full load.
- **More moving parts during transition**: 2 code paths to maintain for
  4-6 weeks before Phase 4.

### Neutral

- **Future Postgres migration is easier, not harder**: the normalised
  shape ports trivially. If we eventually do Path B/C, the
  `tracker_*` tables map 1:1 to Postgres tables.

---

## 7 · Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Dual-write goes out of sync | Medium | High | Nightly diff script `_audit_tracker_dualwrite.cmd` flags any discrepancy within 24h |
| Phase 2 read switch breaks PPTX | Low | Medium | Phase 2 keeps the same `D` shape — PPTX renderer is not yet touched |
| App.jsx Phase 3 breaks user input | Medium | High | Phase 3 deploys after dev-box smoke test on a full inspection cycle |
| Decision to deprecate legacy too early | Low | High | Phase 4 requires 4 weeks of Phase 3 stability before decommissioning |
| Backup snapshot does not include `tracker.db` | None | — | `_backup_prod.cmd` already snapshots all 4 DBs (verified 2026-06-05) |

---

## 8 · Acceptance criteria for this ADR

This ADR is considered **accepted** when:

- [x] The project owner (samaziz679) signs off in writing. ✅ 2026-06-09 — accepted as drafted, no amendments requested.
- [ ] A Phase 0 timeline is committed (target: within the next 2 weeks).
- [ ] The dual-write diff script is reviewed and approved as a Phase 1
      gate. (To be created during Phase 0.)
- [ ] The Phase 4 trigger (4 weeks stability) is acknowledged as binding.

**Acceptance note (2026-06-09)**: project owner approved the ADR as
drafted, including the recommended Option 2 (normalised tables with
5-phase dual-write migration). Implementation start date and IT
Director / external architect counter-signature remain open items but
do NOT block Phase 0 from being scheduled.

---

## 8.5 · Addendum 2026-06-09 — Phase 0 deletion-drift policy

**Context**: A peer reviewer pointed out that Phase 0 (`_backfillFromLegacy`)
is strictly **additive** — `INSERT OR IGNORE` and `UPDATE` on drift, but
never `DELETE`. Consequence: while the new tables auto-sync on ADD
operations (year, pillar, activity, weight changes) at the next boot /
lazy load, they NEVER auto-sync on DELETE operations.

Specifically:
- User deletes year 2027 via the Tracker Setup UI → legacy
  (`tracker_config.years_json`, `tracker_inputs`) is cleaned immediately.
- The new tables (`tracker_years`, `tracker_pillars`, `tracker_activities`)
  retain ghost rows for 2027 indefinitely.
- This drift has **zero impact on runtime** today (loadTracker still
  reads legacy), but it pollutes the new tables for any future
  feature that JOINs against them.

**Three options considered** (2026-06-09 review):

| Option | Description | Trade-off |
|---|---|---|
| A — Defer to Phase 1 | Do not delete years/pillars/activities until Phase 1 ships dual-delete (deleteTrackerYear updates both schemas atomically). Tolerate the no-op state in the meantime. | Cleanest. No operator burden. Slight risk: forgetting to defer. |
| B — Manual cleanup post-delete | Operator runs a hand-crafted SQL script after each UI delete to wipe ghost rows in the new schema. | Avoids feature work but requires discipline + audit trail. |
| C — Tolerate drift permanently | Ignore. Phase 1 will eventually clean things up via a one-shot reconciliation. | Lowest cost, highest risk of forgetting. |

**Decision (2026-06-09)**: **Option A.** Until Phase 1 ships:
- Document the deferral in CLAUDE.md Known Pitfalls so any future
  session is aware.
- Operators avoid Tracker Setup → delete operations on years, pillars,
  or activities.
- If a delete is unavoidable, follow the manual cleanup procedure
  documented in the conversation log (and to be migrated into a
  dedicated runbook if it happens twice).

This decision lifts a hard requirement on Phase 1: **Phase 1 MUST
handle DELETE propagation before being declared complete.** Without it,
the deferred deletes pile up and the new tables become unreliable.

## 9 · Open questions

1. **Should `current_month` and `active_sites_json` also be normalised?**
   They live in `tracker_config` too. Recommendation: leave them in
   `tracker_config` as singletons (they don't have the year-dimension
   problem). Out of scope for this ADR.
2. **Are 2024 reports needed at all?** If we only care about
   2025-onwards historical truth, backfill can start at 2025 (smaller
   migration). Decision needed from operations leadership.
3. **Does the IT Council want to review pillar weight history?** If yes,
   we should add a small read-only UI (Phase 5 — separate ADR).
4. **Naming**: `tracker_pillars` vs `tracker_year_pillars` — the latter
   is more explicit but verbose. Current preference: `tracker_pillars`
   with `(year, code)` UNIQUE constraint, year visible in every query.

---

## 10 · References

- Project memory: `CLAUDE.md` — section "Activity Tracker rebuild" + Known Pitfalls
- Schema reference: `docs/DATA_ARCHITECTURE.md` §2
- Evolution context: `docs/DATA_EVOLUTION_STRATEGY.md` Path A §11
- Module deep-dive: `docs/TRACKER_DB_SCHEMA.md`
- Prerequisite work: commit `cc245cf` (Palier 1 — `getActivityCode` helper)
- Tracker engine (browser): `public/activity-tracker/engine.js`
- Tracker engine (server, PPTX): `tracker-pptx.js`
- Tracker DB layer: `tracker-db.js`

---

*This ADR is a living document. Amend with a new sub-ADR (ADR-001a) if
significant changes are needed during implementation.*
