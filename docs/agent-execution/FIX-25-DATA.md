# P11 round 6 — fix lot fix/p11-r6-data (data-kpi seat + PPM seat extras)

AI-authored engineering evidence — not an independent human review. No approval, signature, production readiness or
field acceptance is claimed. Base `8de524a7` (round-6 confirmation launched at `e82d95ba`). Findings from the round-6
data-kpi file and the PPM extras (R6-1, R6-4, R5-8) sent by the coordinator (AI reviews, kept outside the repository).
Every new test in `tests/p11-r6-data-fixes.test.js` was run against the old services/routes (stash) and seen FAILING
(11 of 12; the 12th pins the unchanged classification of the shipped migrations), then passing after the fix.

## Findings fixed

| Finding | Sev | Fix | Regression test |
|---|---|---|---|
| F-26 Vue Groupe helpdesk cell green on a one-ticket closed base while 40 of 50 tickets are open and overdue (regression of fix 19) | P2 | `services/siteHelpdeskSla.fleetCell`: the RATE stays the closed-only Resolution SLA; the COLOUR is the worst of the closed band (missed ÷ closed) and the open band (open-and-overdue ÷ created). Nothing closed but open overdue → open band alone (never green); nothing closed, nothing overdue → `na`. `open_overdue` rides in the cell (page shows "· N open overdue", EN/FR, tooltip); an amber/red open band sets `cap`, honoured by the overall rollup (`services/siteAwarenessFleet.rollupRag`, extracted from the route) so the site's overall colour, the KPI strip and the Lot B "Sites needing attention" list (reads `overall_rag`) see it. Bands = new kpiRag policy `helpdesk-fleet-sla` (green ≥ 0.95, amber ≥ 0.85 = the former < 5 % / < 15 % cut-offs, applied with exact integer comparison) — **PROPOSED, G06** | `p11-r6-data-fixes` F-26 ×3 (1 closed/40 open = red + overall red + listed; round-5 cases unchanged; boundaries; route/page wiring) |
| F-27 project page card and stage-gate count kept inherent P×I ≥ 6, risks only | P2 | `projectKpis.projectSummary` high_risks = `riskExposure.isHigh` over all rows; `governanceStore.gateCounts` selects residual columns + kind/status and filters with `isHigh`; `portfolioDeck` tile uses `isHigh`; `raid.view` severity comes from `riskExposure.level` (no own threshold) | `p11-r6-data-fixes` F-27 (card: residual low → 0, residual high → 1, open issue → 1, unknown → 0); F-27 (pg) gate count; F-27 guard: no `>= 6` P×I threshold in `services/`, `routes/`, `public/lib/` outside `riskExposure.js` (one allow-listed browser heat-map cell band, `ppmVisuals.js`, reason recorded) |
| F-28 generic risk writer stores any status; `Closed` / `mitigated` counted open | P3 | `governanceStore` normalise: risk status lower-cased and limited to `open \| closed` (raid.js vocabulary, 400 `BAD_STATUS` otherwise); kind lower-cased. `riskExposure.isOpen`: case-normalised, terminal list `closed, mitigated, resolved, cancelled, canceled, done, retired` not open; `inScope` case-insensitive; `rollup` uses `isOpen` | F-28 (pure) + F-28 (pg) |
| F-25 destructive-DDL detector: dollar-quoted / concat-built EXECUTE, DROP EXTENSION, ALTER TYPE DROP ATTRIBUTE, DROP … CASCADE | P3 | `db/migrate.destructiveDdl`: `$tag$` delimiters and commas become separators; EXTENSION and `ALTER TYPE … DROP ATTRIBUTE` destructive; any `DROP … CASCADE` destructive (dependent objects are not re-created) | F-25 ×2 (variants run-once; re-runnable DDL unchanged; the classification of every shipped migration pinned in `tests/fixtures/destructive-migrations.json` — none destructive, identical before/after) |
| O-1 / R6-3 run id with hyphens ignored → test DBs untagged | P3 (process) | `tools/test/drop-test-dbs.sanitiseRunId` (lower-case, runs of other characters → `_`, trimmed, ≤ 16) used by `tests/pg-helpers.testDbName` AND the sweep's `namePattern`, so `data-kpi-r6` → `sdp_tracker_test_data_kpi_r6_*` and the run sweep matches it; a run never matches a longer run id (alnum random suffix) | `drop-test-dbs-run-scope` (updated) |
| O-2 anchor table emptied on an unhardened DB → chain check compares nothing | P2 (audit) | migration `132_audit_chain_anchor_truncate.sql` (statement-level BEFORE TRUNCATE trigger running `sdp_append_only()`; manual rollback `db/postgres_rollback/132_…_drop.sql`, BEGIN/COMMIT, listed in `ppm-rollback-scripts`). `auditChain.verify`: a ledger with rows and no anchor is `anchor history missing` (not OK) when the anchor sequence moved and the anchor table is empty, or when system_log's `audit_chain_anchor` events show the ledger was anchored before. The owner can still disable the trigger: `tools/pg/harden-audit-grants.sql` remains the real protection | `audit-chain` (+1: TRUNCATE refused; emptied anchors flagged without and with RESTART IDENTITY; unanchored empty ledger not flagged) |
| R6-1 project demand panel coloured one project against group capacity (66.7 % GREEN vs group 133.3 % RED) | P2 | `GET /api/governance/ppm/project/:id/demand`: other projects' demand is read server-side (never returned); a skill × month they also demand gets `rag 'NA'`, `utilisation_pct null`, `shared_with_other_projects:true`; response `view_partial` + note; page note (EN/FR). A cell the project alone demands keeps its verdict | `portfolio-r5-ppm.smoke` R5-3 test extended (shared cell NA + flags; solo cell GREEN); `p11-r6-data-fixes` R6-1 |
| R6-4 `partial` with two meanings | P3 | response-level flag renamed `view_partial` / `view_partial_note` (reader's scope misses demand) on capacity, scenario and project demand; cell `partial` keeps "unknown_lines lines without an FTE"; both documented in the route header; portfolio page shows the view note | `portfolio-r5-ppm.smoke`, `p11-r6-data-fixes` |
| R5-8 PPM coverage command missed portfolio lots | P3 | `npm run test:coverage:ppm` covers `tests/ppm-*` + `tests/portfolio-*` over `services/ppm/**`, `services/portfolio*.js`, `routes/governancePortfolio*.js` | `p11-r6-data-fixes` R5-8 |

## Behaviour changes to note

- Vue Groupe: sites with a high share of open overdue tickets turn amber/red (cell and overall) where they read green
  since fix 19; the cell now shows "N open overdue". Bands PROPOSED.
- Stage gates count residual-first high risks and open issues (a gate may now block on a high issue, or pass on a
  mitigated risk). The residual-vs-inherent choice for gates is a **PMO decision** — implemented as the shared rule,
  recorded here as PROPOSED, not approved.
- `tests/ppm-project-lifecycle.smoke.test.js` A-14 pinned the old gate ("only an open high RISK blocks closed"); it now
  asserts the shared rule (the open high issue blocks until closed). `tests/p11-r5-data-fixes.test.js` F-25 pinned
  `DROP FUNCTION … CASCADE` as re-runnable; it is now run-once (round-6 finding).
- Generic risk writer rejects statuses other than open / closed (400).
- Capacity/scenario responses: `partial` → `view_partial` (API consumers reading the old key must change).

## Tests run (this worktree, PostgreSQL 16, AI evidence)

151 files (new tests, site-awareness*, p11-r5/r6, adoption-lotb-*, home*, portfolio-*, ppm-*, project*, governance*,
kpi-*, metric*, pg-migrate*, ppm-rollback-scripts, rollback-scripts-transactional, audit-chain*, audit-grants*,
soft-delete-readers, error-shape, readme-truth, agent-inventory, inventory-*, gate-dossiers, monolith-ratchet,
drop-test-dbs-run-scope): 868 tests, 863 pass / 5 fail on the first run — 2 gate-dossier freshness (regenerated after
commit), 1 stale KPI-doc citation (re-anchored), 2 tests pinning the old behaviour (updated above); the 3 affected
files re-run 28/28. `npx eslint .` clean; inventory --strict, metric map/lineage, unknown-sweep --check, evidence
manifest OK. PostgreSQL 17 not verified here.

## Human decisions left

G06 (fleet-cell bands, `helpdesk-fleet-sla`), PMO (gate rule residual vs inherent; capacity values), G05/G03 (PG17,
hardening script applied in production — the trigger alone does not stop an owner).
