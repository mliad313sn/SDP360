# Changelog

## 2.0.0-alpha.8 — 2026-10-19 — Étape 7 : constructeur de trackers, saisie, liaisons aux sources, migration du tracker 2026
- Tracker definitions are persisted and versioned (`services/trackerStore.js`, sqlite on tracker.db + PostgreSQL via migration `tracker/002`): draft → published version N → retired, roll-back to any version; entries per unit × item × period with the closed-month lock (`public/lib/trackerMonthLock.js`) and unit scope for `tracker-editor`; per-unit targets merged into the engine.
- One scorer for everything: `services/trackerDefinitions.score` now aggregates like the inherited tracker (group-weighted mean over scored groups; a started COUNT without target scores 0) — the parallel run against `tracker-pptx` reads **≤ 0.1 pt** on the shipped 2026 programme (`services/trackerLegacy.js`, CSV report, `/api/trackers/legacy/compare`).
- Source bindings (`services/trackerSources.js`): an item carrying `source.metric` is filled from the KPI dictionary per unit × period (`POST /api/trackers/:key/sync`); a null reading is skipped, never written as 0.
- `routes/trackers.js` (list, catalogue, templates, definition CRUD, dry-run, publish/retire/versions/rollback, entries, targets, score, sync, xlsx import, Excel/PPTX exports, legacy compare/import/cut-over); pages `trackers.html` (entry grid + scores) and `tracker-builder.html`; nav Operations ▸ Trackers; 4 templates seeded as drafts (field dispatch, hardware deployment, site maintenance, meetings compliance); config key `tracker_engine_cutover`.
- Docs: dossier `docs/sdp360/design/ETAPE-07-trackers.md` (migration plan, arbitration points), help §24 EN/FR; tests `tracker-store`, `tracker-sources`, `trackers-routes.smoke`, `pg-tracker-store`.

## 2.0.0-alpha.7 — 2026-10-19 — Étape 6 : composeur de tableaux de bord, espace direction, design system
- Dashboard definitions are persisted and versioned (`services/dashboardStore.js`, sqlite + PostgreSQL `016`): draft → published version N → retired; viewers always see the last published snapshot; shipped definitions seeded once (`services/dashboardSeeds.js`: `exec-home`, `site-weekly`, `assets-hygiene`, `field-site`).
- `routes/dashboards.js`: list / catalogue / definition / **one-call data resolver** (`/api/dashboards/:key/data` — every widget through the metric registry, site-scoped, fleet comparison, 13-week series, per-site RAG grid, open actions) / view log (once per actor per day) / publisher writes (admin or new feature role `dashboard-publisher`).
- Pages: `dashboards.html` (list + viewer, "data as of", null ≠ 0) and `dashboard-composer.html` (widget catalogue, 12-column layout preview, draft / preview / publish / retire / versions); nav: Executive ▸ Executive Home, Operations ▸ Dashboards. Field-audience dashboards must pass `fieldReadiness` to be published.
- Design system: widget components, RAG classes, densities, one-column collapse under 720 px, skip link, reduced-motion (`public/brand/components.css`); static accessibility floor in CI (`tests/a11y-static.test.js`).
- Docs: dossier `docs/sdp360/design/ETAPE-06-design-direction.md`, usability script `ETAPE-06-test-utilisabilite.md` (FR), help §23 EN/FR.

## 2.0.0-alpha.6 — 2026-10-19 — Étape 5 : installateur, Manager, paquets versionnés, modularisation
- Update package: `tools/deploy/make-update-package.js` builds `sdp-dashboard-<version>.zip` (every runtime file + `manifest.json` with SHA-256/size per file, version, commit) — full packages, no more marker-diff ZIP, no more frozen-lot register.
- Manager CLI `tools/sdp-manager.js`: `status` (version, pm2, HTTP, sync health), `backup`, `verify`, `update` (manifest check → rollback point → copy → `npm ci` → migrator → stop/start → probe; any failure rolls back by itself; downgrade refused), `rollback`, `support-bundle` (env KEYS only). Pure rules in `services/updatePackage.js`.
- Windows installer v2: `tools/installer-v2/SDP-Dashboard.iss` (Inno Setup, 7 screens: welcome/licence, detection, mode, folders/port, PostgreSQL embedded/existing, service/TLS, summary) + `post-install.js` (writes `.env` once, creates role/database with SQL on stdin, `npm ci`, `db/migrate.js`, pm2, health probe, rollback on failure). Release workflow on `v*` tags builds and publishes package + Setup.exe, signs the .exe when the certificate secret exists.
- Modularisation: meetings routes extracted to `routes/meetings.js` (server.js 9164 → 8298 lines, budget pinned by `tests/server-size-budget.test.js`); tracker app prebuilt with esbuild (`npm run build`, committed `public/activity-tracker/dist/app.js`, `build:check` in CI) — no in-browser Babel, `'unsafe-eval'` removed from the tracker CSP.
- Retired: `_sdp_admin.cmd`, `_pm2_restart_prod.cmd`, `_pm2_recover_prod.cmd`, `_restore_db.cmd`, `tools/deploy/{make-deploy-zip.ps1, apply-on-prod.cmd, mark-deployed.cmd, Check-FrozenLots.ps1, frozen-lots.json}`.
- Docs: `docs/ops/INSTALLATION.md`, `docs/ops/EXPLOITATION.md` (FR), ADR-002 cron registry, ADR-003 metric registry, ADR-004 secrets, ADR-005 packages/installer/manager, Manager WPF spec `tools/manager/README.md`, dossier `docs/sdp360/design/ETAPE-05-installateur.md`, help §22 EN/FR, `LICENSE`.

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
