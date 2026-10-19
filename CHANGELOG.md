# Changelog

## 2.0.0-alpha.5 — 2026-10-19 — Étape 4 : sécurité, SSO et MFA (volet agent)
- Secrets: `enc:v2:` boxes keyed by scrypt (v1 still readable), `SDP_CONFIG_KEY` mandatory with `NODE_ENV=production`, `tools/pg/reencrypt-secrets.js` (upgrade + key rotation, never overwrites an unreadable box).
- Transport/HTTP: constant-time `x-dash-key` compare, `Secure` cookie behind an HTTPS proxy, session lifetime `SESSION_HOURS`, persistent login rate limiter (`rate_limit_hits`, survives restarts), OpManager TLS warning when verification is off.
- Dependencies: axios / express chain / form-data / nodemailer 10 / node-cron 4 / SheetJS 0.20.3 (vendor CDN build) — `npm audit --omit=dev` clean; CI gate `--audit-level=high` + CodeQL workflow.
- SSO: Entra `groups` claim → roles/site provisioning (`sso_group_map`, pure `services/ssoProvisioning.js`), break-glass logins recorded as risk events, SSO logins in System Logs.
- Audit: `audit.retention` job (12 months, risk 24), per-route authorisation matrix test (327 routes, `docs/ops/AUTHZ-MATRIX.md`), no inline handlers on new pages, `docs/ops/INCIDENT-RESPONSE.md`, help §21 EN/FR, dossier `docs/sdp360/design/ETAPE-04-securite.md`.

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
