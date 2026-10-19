# Changelog

## 2.0.0-alpha.4 — 2026-10-19 — Étape 3 : dictionnaire des KPI, politiques RAG en données, registre des sites
- `services/metricRegistry.js`: 46 KPIs registered (key, EN/FR name, module, unit, formula, window, RAG policy, reader, owner); loaded at boot from `metric_registry` / `kpi_rag_policies` (DB rows win, seed inserted for missing rows).
- `GET /api/metrics/registry` and `GET /api/metrics/:key?site=&window=` (`routes/metrics.js`): one value through the registered reader, site-scoped, `null` ≠ 0, never 500.
- RAG bands come from the registry everywhere: `public/lib/kpiRag.js` (UMD, shared by the browser tracker engine and `tracker-pptx.js` — no more twin thresholds), `siteScore`, `siteComposite`, `siteScoreboard(Report)`. New policies `tracker-boolean`, `wan-availability`. Static test `metrics-no-scale-outside-registry` refuses a literal cut-off in a scoring module. Fidelity suites unchanged (numbers identical by construction).
- Site registry: asset labels per site in `site_module_codes` (module `assets`, sqlite + pg seed); `scoreboardAliases` reads the registry first, the in-code map is the fallback (closing it = arbitration in `docs/sdp360/design/ETAPE-03-kpi.md`).
- Help §20 (EN + FR): KPI dictionary and RAG policies.

## 2.0.0-alpha.3 — 2026-10-19 — Étape 2 : PostgreSQL seul (socle), migrateur, CI à parité
- `db/migrate.js`: one schema migrator for every `db/postgres/**/*.sql` (journal `schema_migrations`), run at boot, by the installer and in CI (`--status`, `--dry-run`).
- CI runs the PostgreSQL half of the suite against a PostgreSQL 17 service with `PG_TESTS_REQUIRED=1`; a fresh database is migrated first.
- Nightly `db.backup` job through the runner (`services/backup.js`, retention `SDP_BACKUP_KEEP`).
- `tools/pg/copy-assets.js --dry-run` + source/target counts and a warning on shortfall.
- `kpi_rag_policies` moved to `reports/015` (applied before `016_dashboard_definitions`).
- Fixed three latent test failures: pool leak on repeated `initPgReports`, unref'd PPTX timeout that could never fire, PowerShell-only tests now skip with a reason.

## 2.0.0-alpha.2 — 2026-10-19 — Étape 1 : synchronisations fiables et observables
- One cron registry (`services/sync/jobs.js` + `schedule.js`): every scheduled job runs through the shared runner (overlap lock, exponential retry with Retry-After, run log, failure mirrored to `system_log`).
- Truncation guard before every Zoho reconciliation (`zoho-sync.js assertNotTruncated`): a partial export can no longer cascade into a mass delete.
- Alerts (`services/sync/alerts.js`): e-mail / Teams after 2 consecutive failures and when a job is older than its freshness window (once per 24 h). Config keys `sync_alert_enabled`, `sync_alert_recipients`, `sync_alert_teams_url` (secret), `sync_truncation_tolerance_pct`.
- `GET /api/sync/health` merges runner runs with legacy `sync_metadata` and labels each job ok / stale / error / never / idle.
- System Logs ▸ new "Sync health" tab.
- Meraki client keeps the HTTP status on errors so 429/5xx are retried.

## 2.0.0-alpha.1 — 2026-10-19
- Fork of SDP-Dashboard v1.11; sync runner, KPI/RAG registry, tracker and dashboard engines (foundations), CI, governance documents.
