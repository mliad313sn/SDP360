# E-W1-DATA — bundle evidence (expert audit of 5 Nov 2026, plan E)

Branch `goal/w1-data`. Goals in order: E-D01, E-D04, E-D05, E-D06 (merged with E-Q02). No migration.
Everything below is agent work on synthetic or test data only; nothing was run against production data,
nothing is approved, no owner or threshold was chosen.

## Verdict table

| Goal / audit action | Verdict | Proof |
|---|---|---|
| E-D01 — audit D-01 prep / X-DATA-01: split report for codes shared by two active sites | FIXED (tool) | `tools/sites/shared-code-report.js`; `tests/shared-code-report.test.js` (3) — Assafo+Tanda → TND fixture: rows split by writer site, unknowns marked (no writer / several sites / central / account missing), read-only queries only |
| E-D01 — audit D-03 / X-DATA-02: registry observation mode | FIXED (behind switch, default `0`) | `site_codes_from_registry='shadow'` in `services/siteCodeRegistry.js` (`resolve`, `parseMode`); `tests/site-code-shadow.test.js` (5): shadow answers like `0` and logs one divergence, `1` unchanged; `tests/site-code-registry.smoke.test.js` (+1): PUT accepts `shadow` with the same reason / super_admin rule, divergence row written once |
| E-D04 — audit D-06: sync content drift (shadow) | FIXED (shown always, alert behind switch default `0`) | `services/sync/drift.js`; `tests/sync-drift.test.js` (8): <5 runs = unknown, drop / spike / zero_after_history / duplicates_rate on fixtures, thresholds from config, alert not sent at `0`, sent once at `1`; `tests/sync-routes.smoke.test.js` (+1): `drift` field on every job of `/api/sync/health` |
| E-D05 — audit D-07 / K-03 rest / K-06 prep: metric lineage & contract sheet + decision blocks | FIXED (generated doc) | `tools/agent/metric-lineage.js` → `docs/ops/METRIC-LINEAGE.md`; `tests/metric-lineage.test.js` (4): committed file current, `--check` detects stale, every SEED key (52) has a full sheet, the 10 unreferenced keys carry the PENDING block with nothing filled |
| E-D06 + E-Q02 — audit D-08 / Q-01 prep: operator-run anonymiser (one tool) | FIXED (tool, synthetic tests only) | `tools/data/anonymize-snapshot.js`; `tests/anonymize-snapshot.test.js` (6): stable keyed pseudonyms, JSON walker, residual scan, pre-flight refusals, on the fully migrated throwaway DB no source name / e-mail / phone / IP / ticket id survives and counts + cross-table joins are kept, refuses (rollback, exit 2) on a leak in an unknown column, report never prints a value |
| E-D06 — synthetic multi-country reference organisation + readers' shape | FIXED | `tests/fixtures/reference-org/{generate.js,reference-org.json}` (5 countries, 8 sites, XOF + GBP, Europe/London BST edge ticket, every status, partial month to the 10th); `tests/reference-org-shape.test.js` (4): `loadReviewData` 7 arrays + fields, `getSiteHelpdeskWindow` / `getSiteChangesWindow` shape per site, currency map |

## E-D01 — details

- **Report** (`node tools/sites/shared-code-report.js [--out=FILE]`): reads `sites`, `users`, `user_sites`,
  `tracker_inputs_v2`, `tracker_entries`, `md_meetings`, `insp_inspections`, `system_log` inside a
  `BEGIN READ ONLY` transaction, rolled back. Writers are printed as account ids, never user names.
  Writer per table: `tracker_entries.updated_by` (fallback: last `tracker_entries_saved` actor of that tracker),
  `md_meetings.created_by`, `insp_inspections.created_by`. **The legacy activity tracker
  (`tracker_inputs_v2`) records no writer and its save writes no `system_log` row**, so every legacy TND row is
  reported "unknown" — this is the honest answer, not a gap in the tool (see "left for a person").
- **Shadow mode**: the three module lookups (`tracker-db`, `inspection-db`, `meetings-db`) now call
  `siteCodeRegistry.resolve(module, name, hardFn)`. `0` → hard map; `1` → registry then hard map (unchanged);
  `shadow` → hard map, and when the registry holds a different code for that site one `system_log` row
  (`governance` / `site_code_shadow_divergence`, details hard_coded / registry / answered) per day per
  site × module (in-memory dedup, reset at restart — a restart can log a second row the same day).
  `PUT /api/governance/site-codes` accepts `{ mode: 'shadow' }` (or `enabled: 'shadow'`), action
  `site_registry_shadow`. `tools/governance/apply-values` accepts `"shadow"` for this one switch.
- Deviation: the goal's FILES list did not name `tracker-db.js`, `inspection-db.js`, `meetings-db.js`; a double
  read needs the hard answer, which only those modules compute, so each lookup line was changed to call
  `resolve` (one line each, behaviour at `0`/`1` identical).
- PILOT-PROFILE row added for `site_codes_from_registry` (PROPOSITION: `shadow` first); FLAG-REGISTER regenerated.

Left for a person: choosing the owner of TND (gate 9) and applying any split; switching the registry to
`shadow` then `1` (gate 10); deciding whether the legacy tracker save should start recording its writer.

## E-D04 — details

- `computeDrift(runs)` reads the last 10 successful `sync_runs` of a job (new store reader `recentOkRuns`):
  fewer than 5 runs, or a missing row count, is `unknown` with a reason — never `ok`. The median is taken over
  the previous runs (the last run is compared against them). A job that always writes 0 rows stays `ok`.
- `/api/sync/health` adds `drift` to every job (unreadable config → proposed thresholds; unreadable run log →
  `unknown`). The status field and the summary counts are unchanged.
- The hourly sweep in `services/sync/schedule.js` sends drift alerts through the existing alerter senders
  (e-mail / Teams of `sync_alert_*`) ONLY when `sync_drift_alerts = '1'`; dedup 24 h per job in
  `sync_watermarks` (`alert:drift:<job>`), cleared when the job is back to `ok`. Detection never blocks a sync.
- Legacy-wrapped jobs record rows from their summary (`rowsOf`), so their drift is as good as that count.
- New keys (all PROPOSITION, PILOT-PROFILE rows + FLAG-REGISTER regenerated): `sync_drift_alerts` `0`,
  `sync_drift_drop_pct` `50`, `sync_drift_spike_pct` `300`, `sync_drift_duplicates_pct` `10`.

Left for a person: the thresholds and an owner per flow; arming `sync_drift_alerts`.

## E-D05 — details

- One sheet per seed metric: names EN/FR, module, unit, source (reader + field + reader function + code file),
  formula, window kind, RAG policy with its code default thresholds, higher-is-better, owner role, the registry's
  own certification text, consumers (from `tools/agent/metric-map.js`), freshness = sync job + declared window
  (helpdesk / changes / assets / wan — from `governancePolicy.FRESHNESS_SOURCES`), `UNKNOWN` otherwise.
- The contract line states that `metric_registry` has no version column and that the versioned contract is the
  `kpi_policies` row, read at run time — no adopted version is copied into the file.
- The 10 metrics no code names (same list as METRIC-WIDGET-MAP) get "use / archive / reserve — PENDING KPI
  committee" with decision, decider, date and minutes left unfilled.
- Not wired into `tools/agent/evidence-manifest.js` GENERATED list (left as is; the test pins the file).

Left for a person: the KPI committee's decision for each of the 10 pending metrics; certification of every metric.

## E-D06 + E-Q02 — details

- **One tool** (the two goals asked for `tools/data/anonymize-snapshot.js` and `tools/dev/anonymise-snapshot.js`):
  kept the E-D06 path. Deviation from E-Q02's "folder in → folder out": since PO-08 the snapshot is a restored
  **PostgreSQL copy** (`SDP_SNAPSHOT=1 SDP_TEST_PG_URL=…`, see `tests/site-window-readers.test.js`), so the tool
  rewrites that copy in one transaction (`--db` + `--confirm-copy=<exact name>`), refuses the `.env` `PG_URL`
  database, and rolls back (exit 2) when the residual e-mail/phone scan over every text column finds anything.
- Key from `SDP_ANON_KEY` only (16+ chars), never printed or stored; nothing is sent anywhere (only connection:
  `--db`). The report prints table.column + counts, never a value, plus the list of **columns not covered**.
- Coverage is an explicit rule table (`RULES`) for the known PII tables + every `*email*` column; free text in
  a column it does not know is not detectable by a pattern — that is why the data owner reviews the uncovered list.
- `tests/.skip-allowlist.json`: owner text of "no prod-snapshot" now names the tool and the procedure; the
  `max` stays 10 — **no skip was lifted** (lifting needs an approved extract). Procedure: `docs/ops/ANONYMISED-SNAPSHOT.md`.
- The shape test shows today's UTC bucketing: the 23:30 UTC London ticket counts in August although it is
  1 September local time (the local-calendar change is E-D03, another bundle).

Left for a person: running the tool on a restored production copy, reviewing the uncovered columns and approving
(or rejecting) the extract; only then can the ten skips be lifted.
