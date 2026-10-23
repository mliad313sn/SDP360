# SDP Dashboard — Claude Memory File (index)

Read automatically at the start of every session. Since 2026-10-22 (SDP-DASH-2.0 step 5, lot 5.5) this file is
an **index**: the deployment reality, the current state, the file map and the transversal rules stay here; the
detail lives in the documents listed under **Where to read what** — open the one for the area you touch BEFORE
editing it. Nothing was deleted: the old sections moved verbatim (see `docs/history/CURRENT-STATE-LOG.md`).

---

## ⚡ Deployment reality — READ THIS BEFORE any "Current state" section below (audit of 2026-09-05)

> The "Current state" sections below are a **chronological log**; each one was written the day its
> feature landed and many still carry a **"NOT déployé / PAS déployé"** stamp that was true THAT day.
> **Today everything on `main` up to the deploy marker is in prod** — check with
> `git rev-parse --short $(cat .git/last-deployed)` vs `git log --oneline -1`. On 2026-09-05 the marker
> was `0c602e2` (HEAD `d88691d`, one ZIP pending). So Roadmap Manager, WAN SLA, Infra V1a/V1b-A…E,
> F1 Meridian (dormant, keys empty), F2a SSO settings, Site Awareness, System Logs, etc. are ALL deployed
> — treat their "not deployed" stamps as history, not as a to-do.
>
> **Installer files are BEHIND the marker too (2026-09-21):** the marker was moved to `7fd553d` (asset
> engagement live) with a ZIP stripped of `tools/installer/*`, `_sdp_admin.cmd`, `tools/pg/dump-db.js` —
> the installer-safety-parity work (578be34) is NOT in prod and a future cumulative ZIP will NOT carry it.
> After the TEST-instance E2E, package those files BY HAND (list: `git diff --name-only 7629551..578be34 --
> tools/installer _sdp_admin.cmd tools/pg/dump-db.js`, minus `tools/installer/tests/`).
> **Depuis 2026-09-24 le packager le RAPPELLE tout seul** à chaque build (`tools/deploy/frozen-lots.json`
> + `Check-FrozenLots.ps1`) : il nomme les lots gelés derrière le marqueur et les fichiers à empaqueter
> à la main. **Retirer l'entrée du JSON** une fois les fichiers confirmés en prod, sinon l'avertissement
> devient du bruit qu'on n'écoute plus.
>
> **RELEASED 2026-10-22 (step 5, DEC-4)** — the tracker freeze below is lifted: the three files ship by hand
> with `make-deploy-zip.ps1 -Include …`, the entry left `frozen-lots.json`. Kept for history:
> **The ONE exception (deliberately frozen, 2026-09-04):** the tracker RAG-band change (GREEN ≥ 90 %
> of the pro-rated target, commit `c97ae61`, files `public/activity-tracker/engine.js` +
> `tracker-pptx.js`) and the weight-based attainment donut (`e17b7b7`, `App.jsx`) are on `main` but
> **NOT in prod** until the monthly reporting cycle ends (recolouring decks mid-cycle would break the
> comparisons). They sit **BEHIND the marker** (the stripped ZIPs were applied and HEAD marked), so a
> future cumulative ZIP will NOT carry them — package the 3 files by hand at unfreeze.
>
> **Superseded facts you will still find below (the newer decision wins):**
> - *"% Time Up is derived as loss<100 / calibrate `meraki_missing_policy`"* → superseded 2026-09-04:
>   Meraki's % Time Up is reproduced by **loss ≥ 5 % per sample = down** (`wan_timeup_loss_pct`, MAE 0.8
>   on week/month); the event-based figure stays the SLA instrument. See the WAN pitfall rows.
> - *"admin ✓ saves own tracker inputs"* → wrong; saves need the `tracker-editor`/`tracker-admin` feature
>   role (see the tracker RBAC table).
> - *"Admin settings routes are `requireAdmin`"* → super_admin-only since `5e2f40e` (2026-08-16); IT Review
>   is executive-only since `7162ac7` (2026-08-31). The smoke tests were only realigned on 2026-09-05.
> - *"the packager advances `.git/last-deployed`"* → it only reads it; `mark-deployed.cmd` advances it.
> - *Risk Register domain 4 rules* → trimmed 2026-09-02 (see the Risk Register section's updated table).
> - *Meridian* → code + F1 section remain, but the user removed Meridian from the integrations plan
>   (2026-09-02); keys are empty in prod, the feature is dormant. Don't propose new Meridian work.
> - *"V1b-C: the report's WAN cell = the poller's event-based availability (blank before the poller ran)"*
>   → superseded 2026-09-06 (audit F9, user decision): the cell = the snapshot's **calibrated % Time Up**,
>   the SAME figure as the WAN Health dashboard; the event figure rides along as `event_pct` (tooltip).
> - *"A PV is uniquely identified by site × department × month"* → still true for **PVs only** (2026-09-06,
>   audit F1): a **Business Incubation session is a distinct record**, never merged with the month's PV.
> - *"saveMeeting deletes + reinserts the actions"* → since 2026-09-06 it **upserts by id** (audit F2).
> - *"Coordinators hold `admin`"* / *"G-12: the demotion is a human gesture, account by account"* →
>   superseded 2026-10-02: the 25 site coordinators are **`editor` locked to their site** (bulk tool
>   `tools/pg/demote-coordinators.js`, user request). Only `dgoro` and `serge.guiro@` (site-less) stay `admin`.
> - *"Only a super_admin can revert a submitted report"* → 2026-10-02: an **editor of the report's site**, and
>   the admin tier anywhere.
> - *"Inspection delete / reopen / exports, PV import / closed-PV edits / delete, Excel exports are admin or
>   executive only"* → 2026-10-02 (lot 4): open to an **editor on their own site** (see the 2026-10-02 section).
> - *4MyPeople* → a SEPARATE product (own code, server, SSO settings), out of this repo's scope. Its SSO work
>   was parked on 2026-10-02.

---

## ⚡ Current state (as of 2026-10-22 — SDP-Dashboard 2.0, étapes 1 à 5)

> Étude de commande « SDP-DASH-2.0-ETUDE v1.2 » reçue (10 étapes, comité). **Étape 1 livrée** — dossier
> `docs/design/ETAPE-01-synchronisations.md`. Toutes les tâches planifiées sont déclarées dans
> **`services/sync/jobs.js`** (plus AUCUN `cron.schedule` dans `server.js` — test statique) et passent par
> `services/sync/runner.js` (verrou, rejeu transitoire + `Retry-After`, `sync_runs`/`sync_job_state`, échecs →
> System Log catégorie `sync`, alerte après 2 échecs / péremption, désarmée : `sync_alert_*`). Santé :
> `/api/sync/health`, onglet System Logs ▸ Sync health. **Garde de troncature** dans les 6 réconciliateurs
> Zoho : > 20 % d'une table à supprimer → refusé, rien supprimé (`SYNC_TRUNCATION_TOLERANCE_PCT`). Une
> nouvelle tâche planifiée = une entrée dans `jobs.js`, jamais un `cron.schedule`. L'étude affirmait l'étape 1
> « implémentée » et l'étape 2 « socle livré » alors que rien n'existait : vérifier le dépôt, pas le document.
>
> **Étape 2 livrée** (dossier `docs/design/ETAPE-02-postgresql.md`, ADR-002) : le schéma PG ne change QUE par
> `db/migrate.js` (journal `schema_migrations`, scripts idempotents, rejoués si modifiés) — **une colonne = un
> fichier `db/postgres/<module>/NNN_*.sql`, jamais un `ALTER` dans `initPg*`** (test statique). Garde
> `REQUIRE_POSTGRES=1` (refus de démarrer si un module est en SQLite). Sauvegarde chiffrée nocturne = job
> `db.backup` (`SDP_BACKUP_DIR` + `SDP_BACKUP_KEY`). CI GitHub Actions (`.github/workflows/ci.yml`, Node 24,
> PostgreSQL 17 en service) — un test propre au poste Windows se marque `skip` avec sa raison hors win32.
>
> **Étape 3 (socle) livrée** (dossier `docs/design/ETAPE-03-kpi.md`) : dictionnaire des indicateurs
> `services/metrics/registry.js` (46 KPI) + `/api/metrics/registry` + `/api/metrics/:key?site=&month=` (lit le
> lecteur existant, jamais une 2e formule) + page `kpi-dictionary.html`. **Seuils RAG serveur = `public/lib/kpiRag.js`**
> (10 politiques reproduites à l'identique ; un nouveau seuil va LÀ, jamais en littéral — test statique sur les
> 8 modules adoptés). Registre des sites `GET /api/registry/sites` (admin) : codes par module vs tables en dur.
> **La convergence 10 → 3 échelles (DEC-1) et la suppression des alias en dur (DEC-4) attendent le comité** —
> preuve : `node tools/metrics/rag-impact.js` en prod. Ne pas brancher les pages navigateur sur `kpiRag` avant DEC-1.
>
> **Étape 4 livrée** (dossier `docs/design/ETAPE-04-securite.md`, procédure `docs/ops/INCIDENT-RESPONSE.md`) :
> **0 vulnérabilité** (audit + ESLint sécurité BLOQUANTS en CI ; SheetJS embarqué dans `vendor/` — ne pas le
> remettre en dépendance npm) ; secrets **v2 scrypt** ; `SDP_CONFIG_KEY` obligatoire si `REQUIRE_POSTGRES=1` ;
> comparaison de clés **`services/safeCompare.js`** (jamais `===` sur un secret) ; aucune clé/jeton dans une URL ;
> throttle de connexion persistant (`services/authThrottle.js`) ; **toute nouvelle page sans script inline**, ajoutée
> à `STRICT_PAGES` (`services/cspPolicy.js`) — le cliquet `tests/csp-inline.test.js` ne laisse rien remonter ;
> **toute nouvelle route d'API est couverte d'office** par `tests/route-authz.smoke.test.js` (anonyme refusé,
> `viewer` refusé si un middleware de rôle est déclaré — utiliser `requireRole([...])`, pas un contrôle inline) ;
> journal `api` (écritures + 403) 12 mois. SSO groupes→rôles et désactivation des départs livrés **désarmés**.
> Un changement de `package-lock.json` = le ZIP embarque un `node_modules` complet (swap + retour arrière côté prod).
>
> **Étape 5, lot 5.1 livré** (dossier `docs/design/ETAPE-05-installateur-modularisation.md`) : `server.js` 9 203 → **2 665** (cible < 3 000 atteinte ; lots 5.3-5.4 : `routes/{accounts,reportsConfig,reportsSend,reportsDecks,reports,survey,zohoData,ai,tracker}.js`, `services/aiProxy.js`)
> lignes (`routes/meetings.js`, `routes/assets.js`) — **une nouvelle route va dans un module `routes/*.js`**, le cliquet
> `tests/server-size.test.js` refuse toute hausse (abaisser `CEILING` après chaque extraction). Pièges d'extraction : une
> déclaration du bloc utilisée ailleurs (`statusTransfer`), une dépendance déclarée plus bas que le montage (`let rdb` →
> le module l'importe), des routes d'un autre préfixe mêlées au bloc (restent dans `server.js`). **JSX compilé à
> l'avance** : `npm run build` (`tools/build/build-frontend.js`, fichiers `.js` générés COMMITÉS, `--check` en CI) ;
> toute page nouvelle ou migrée charge le `.js`, jamais Babel (`tests/frontend-build.test.js`). Le tracker reste sur
> Babel tant que son gel dure (le compiler expédierait `App.jsx` gelé). **Gel levé le 2026-10-22 (DEC-4)** : le tracker est
> compilé à son tour (`App.js`, React **production** avec SRI), plus AUCUNE page n'a `unsafe-eval` ; un fichier inchangé
> depuis le marqueur s'expédie avec `make-deploy-zip.ps1 -Include <fichier>`. Installateur v2 (Inno Setup + paquet CI signé)
> conçu, pas construit : attend l'E2E TEST et un certificat de signature.
>
> **Étape 5, lots 5.3 à 5.5 (2026-10-22)** : `server.js` **9 203 → 2 665 lignes, cible < 3 000 atteinte** — routes dans
> `routes/{accounts,reportsConfig,reportsSend,reportsDecks,reports,survey,zohoData,ai,tracker}.js` (ADR-004). Lot 5.5 :
> ce fichier devient un **index** ; les journaux « Current state » sont dans `docs/history/CURRENT-STATE-LOG.md`, les
> procédures dans `docs/sop/`, les modules dans `docs/modules/`, les décisions dans `docs/adr/` (ADR-003 à 006).
>
> **Étape 6, lots 6.1 à 6.7 (2026-10-22)** — espace direction `direction.html`, moteur de tableaux de bord (définitions
> JSON versionnées, `services/dashboards/`, `routes/dashboards.js`), composeur `dashboard-composer.html`, chiffres groupe
> (Σ numérateurs ÷ Σ dénominateurs) et séries 13 semaines (`/api/metrics/:key/series`), 11 candidats `candidat-*` des pages
> historiques **sans redirection**. Construits sur les recommandations du dossier : **DEC-6.1 à 6.8 restent ouvertes** — un
> arbitrage = éditer + publier une définition, jamais coder un tableau en dur. Couleurs de texte des pages de l'étape 6 =
> jetons `--text-*-aa` (cliquet `tests/a11y-step6.test.js`).

---


## Where to read what

| You are about to… | Read first |
|---|---|
| deploy, package a ZIP, restart pm2, move the deploy marker | `docs/sop/SOP-deploy.md` (+ the deployment reality above) |
| touch any area of the code (the cross-cutting traps, by area) | `docs/sop/SOP-known-pitfalls.md` |
| add an HTML page or a browser asset | `docs/sop/SOP-browser-caching.md` |
| change a PPTX deck (weekly / monthly / all-sites) | `docs/sop/SOP-pptx.md` (+ golden test `tests/pptx-monthly-golden.test.js`) |
| change a KPI percentage or an SLA target | `docs/sop/SOP-kpi-sla.md` |
| work on the Activity Tracker | `docs/modules/activity-tracker.md`, `docs/adr/ADR-001-*` |
| work on Inspections | `docs/modules/inspection.md` |
| work on Meetings / PV / Council | `docs/modules/meetings.md` |
| work on the Risk Register export | `docs/modules/risk-register.md` |
| work on the SharePoint Exec View | `docs/modules/exec-view.md` |
| change the PostgreSQL schema | `docs/adr/ADR-002-schema-migrations.md`, `docs/design/ETAPE-02-postgresql.md` |
| add a route / split code out of server.js | `docs/adr/ADR-004-*`, `docs/design/ETAPE-05-installateur-modularisation.md` §2 |
| touch JSX / React pages | `docs/adr/ADR-005-*` |
| work on the direction space, the dashboard composer or the design system (step 6) | `docs/design/ETAPE-06-design-espace-direction-composeur.md` (lots 6.1-6.7 built on its recommendations; DEC-6.1 to 6.8 still pending — a decision = edit + publish a definition), `docs/design/ETAPE-06-comparaison-pages.md` (no legacy page redirects before DEC-6.5) |
| run the usability tests / measure step-6 acceptance | `docs/ops/USABILITY-TEST-PROTOCOL.md`, `tools/metrics/step6-acceptance.js` |
| work on business trackers / the tracker builder / the tracker 2026 migration (step 7) | `docs/design/ETAPE-07-trackers.md` — ONE engine `public/lib/trackerEngine.js`; prove fidelity with `tools/trackers/compare-legacy.js` |
| add a 2.0 page | `services/pages.js` (served + cached + strict CSP from that one list; never a line in `server.js`) |
| work on the meeting cockpit, the requests register, the portfolio or governance (step 8) | `docs/design/ETAPE-08-cockpit-portefeuille.md` — agendas reuse the dashboard data resolver (never a second formula); minutes are never sent automatically |
| work on report generation, alerts / notifications or external publication (step 9) | `docs/design/ETAPE-09-rapports-engagement-publication.md` — an AI draft is rejected on any number not in the facts; nothing leaves the server until a super_admin arms it; the external API (`/api/v1/`) bypasses the dash-key gate and uses its own per-consumer keys |
| handle a secret or a security control | `docs/adr/ADR-006-*`, `docs/design/ETAPE-04-securite.md`, `docs/ops/INCIDENT-RESPONSE.md` |
| add a scheduled job | `docs/design/ETAPE-01-synchronisations.md` (`services/sync/jobs.js`) |
| add a KPI or an RAG threshold | `docs/design/ETAPE-03-kpi.md` (`services/metrics/registry.js`, `public/lib/kpiRag.js`) |
| work on the installer / release packaging | `docs/INSTALLER.md`, `docs/adr/ADR-003-*` (`tools/release/`, `.github/workflows/release.yml`) |
| understand why something is the way it is (history of a feature) | `docs/history/CURRENT-STATE-LOG.md` (search by feature or date), `CHANGELOG.md`, `docs/superpowers/` |
| understand the data model | `docs/DATA_ARCHITECTURE.md`, `docs/DATA_EVOLUTION_STRATEGY.md` |

## Transversal rules (each one has cost a regression; detail in the SOP / ADR named)

- **No prod access.** Commit on `main` → ZIP → the user applies it, restarts pm2 with stop → wait → start (never `pm2 reload`), then runs `mark-deployed.cmd`. (SOP-deploy)
- **Never display, store or paste a secret.** Webhook URLs and API keys are secrets. Never recreate the Zoho Self Client or regenerate its secret. (ADR-006)
- **`(await f()).method()`, never `await f().method()`** — every dual-backend reader returns a Promise on PostgreSQL; `tests/await-precedence.test.js` enforces it.
- **New API route → `routes/*.js`**, mounted where its neighbours are; `server.js` may not grow. (ADR-004)
- **New scheduled job → `services/sync/jobs.js`**, never a `cron.schedule` (test scans `server.js` and `routes/`).
- **Schema change → a new `db/postgres/<module>/NNN_*.sql`**, never an `ALTER` in `initPg*`. (ADR-002)
- **RAG thresholds → `public/lib/kpiRag.js`**, never a literal in a module.
- **New page → no inline script** (add it to `STRICT_PAGES`), served by `sendHtmlPage` so assets get `?v=`. (SOP-browser-caching)
- **JSX → `npm run build`**, commit the generated `.js`. (ADR-005)
- **Role checks through `rdb.userHasRole(user, …)`, site checks through `services/userSites.js`** — never `user.role === …` or `user.site_id === …`. Report writes go through `_authorizeReportWrite` / `_authorizeSiteWrite`.
- **`null` = not measured, `0` = measured zero** — never `|| 0` on a verdict field, never a verdict on zero data.
- **Smoke tests force every `*_BACKEND=sqlite` and use `tests/_http-fetch`;** a suite with "known failures" is worthless — keep it at 0 red. Run PG with `PG_TESTS_REQUIRED=1` before shipping a pg fork.
- **Tests that read repository files normalise CRLF** and use `tests/_fn-source.js`; the e-mail goldens are LF-pinned (`.gitattributes`).
- **The installer files stay out of every ZIP** until the TEST-instance end-to-end run (DEC-2).
- **New entries go to `CHANGELOG.md`;** a lasting rule goes to the SOP of its area (or an ADR), and gets one line here only if it is cross-cutting.

## Project Identity

**Name**: Endeavour Mining SDP Dashboard
**Stack**: Node.js + Express + SQLite (better-sqlite3) + PM2 on Windows Server
**PPTX**: pptxgenjs
**Production path**: `C:\Apps\SDP-Dashboard\` *(on the remote server)*
**Production access**: NONE from the dev box — the old `Z:\` SMB mapping is **gone** (verified 2026-09-05: `Test-Path Z:\` = false). Deploys go through the ZIP package; verification of what runs in prod goes through the browser (user's session) or the user pasting output.
**Local/dev path**: `C:\Users\Admin\Documents\SDP-Dashboard\` (branch `main`, no worktree in use)
**Port**: 3456
**PM2 app name**: `endeavour-dashboard`

> **Nothing Claude edits reaches prod by itself.** Commit on `main` → build the ZIP (`tools\deploy\make-deploy-zip.ps1`) → the USER copies/applies it on the server, restarts pm2 (stop→wait→start), then runs `tools\deploy\mark-deployed.cmd` on the dev box. The packager **only READS** `.git/last-deployed`; it never advances it (the "packager advances the marker" sentence in older sections below is stale).

## Key Files

| File | Purpose |
|------|---------|
| `routes/*.js` | All API routes, one module per domain, dependencies injected (ADR-004): `accounts` (login, SSO, sites, users, sessions, departments), `reportsConfig`, `reportsSend`, `reportsDecks` (PPTX), `reports` (weekly reports), `survey`, `zohoData` (`/api/change`, `/api/metrics/*`, `/api/data/*`, Risk Register), `ai`, `tracker` (+ group presets, exec-pptx), `assets`, `meetings`, `inspection`, `meridian`, `opmanager`, `siteAwareness`, `roadmap`, `teamsSla`, `metrics`, `fourmypeople`. Mounted in `server.js` at the place the block used to sit — order = route priority. |
| `services/aiProxy.js` | AI provider switch (off / local / anthropic), used by `routes/ai.js` and the Exec View MI summaries. |
| `tools/build/build-frontend.js` | esbuild JSX → JS (`npm run build`, `--check` in CI). Compiled `.js` files are committed (ADR-005). |
| `server.js` | Express app: config, middlewares, Zoho token + raw request cache, HTML pages, boot (`start()`). 2,665 lines since lot 5.4 — **new routes go in `routes/*.js`** (ratchet `tests/server-size.test.js`, ADR-004). |
| `routes/inspection.js` | First module extracted from server.js (split pilot, 2026-06-21). Factory `module.exports = (deps) => router` — DI pattern: server.js passes `{ express, inspectionDb, inspectionPptx, rdb, require* middleware, getRawCache }` and does `app.use(require('./routes/inspection')(deps))`. Handlers byte-identical to the old inline ones. Tested by `tests/inspection-routes.test.js`. **Pattern to copy for future extractions** (meetings, tracker, risk-register…). |
| `services/viewLog.js` | Garde pure « une fois par acteur et par jour » derrière les événements `*_viewed` de System Logs (G-06, 2026-09-24). Sans clock ni stockage : l'appelant fournit le jour. |
| `services/assetEngagementKpis.js` + `tools/pg/asset-engagement-kpis.js` | Composeur PUR + CLI **lecture seule** des KPI d'engagement parc (G-07). Réutilise les prédicats `FOLLOWUP_*` exportés par `assets-db` (jamais re-tapés), charge `.env` AVANT tout module db, n'imprime aucun montant, et distingue « Δ non comparable » d'un Δ nul. Référence T0 = `docs/audits/2026-09-24-audit-phases-0-2-4.md` §3.2. |
| `tools/deploy/Check-FrozenLots.ps1` + `frozen-lots.json` | Avertit, au moment de construire le ZIP, quels lots **gelés derrière le marqueur** aucun paquet cumulatif ne portera jamais (G-10). Avertissement seul, jamais bloquant. **Retirer une entrée** une fois ses fichiers confirmés en prod. |
| `tests/_fn-source.js` | Extraction de la source d'une fonction dans une page HTML pour les tests statiques : insensible aux fins de ligne, et **lève** plutôt que de rendre une tranche vide (voir la ligne CRLF des pièges). |
| `docs/audits/` | Rapports d'audit (constats à preuve, bibliothèque `/goal`, matrice AMDEC, journal d'exécution). Le moteur qui les produit est `docs/prompts/2026-09-17-ops-platform-audit-engine.md`. |
| `services/blobStore.js` | Filesystem blob store (`<DATA_DIR>/blobs/<module>/<owner>/…`) — keeps inspection photos/signatures (and future blobs) OUT of SQLite. Path-traversal-guarded, SDP_DATA_DIR-aware. |
| `services/report*.js` + `siteReport*.js` | **Reporting Suite Foundation** (branch `feat/reporting-suite`) — `reportConfig.js` (delivery settings k/v), `reportDirectory.js` (per-site recipients), `reportSchedule.js` (schedules + Task Scheduler bridge), `reportSentLog.js` (dedup/audit send log), `siteScore.js` (composite RAG score + two-moves), `siteReport.js` + `siteReportDeps.js` (per-site report composer + DI deps), `reportRender.js` (PDF), `mailer.js` (SMTP send). All backed by 4 reports.db tables auto-created at boot (sqlite `_initSchema` / pg `005_reporting.sql`); pg copy via `tools/pg/copy-reports-reporting.js`. |
| `services/pgDb.js` | **Reusable async PostgreSQL adapter** (Chunk 1 of the PG migration). better-sqlite3-shaped surface: `prepare(sql).get/all/run` (async), `exec`, `runTransaction` (AsyncLocalStorage), `?`→`$N` translate, NUMERIC type-parser, `RETURNING *` for bare INSERTs. Module-agnostic — **Chunks 2-4 (meetings/inspection/reports.db) copy this same adapter + recipe.** Selected per-module by a `TRACKER_BACKEND=sqlite\|postgres` style flag; prod stays `sqlite` until cutover. See `tools/pg/README.md`. |
| `db/postgres/tracker/001_init.sql` + `tools/pg/copy-tracker.js` | Postgres tracker schema (legacy+v2, FK CASCADE, type-preserving `*_json` TEXT / `active` INT / `target` TEXT) + one-shot idempotent `tracker.db`→PG copy. Tests: `tests/pg-tracker.test.js` (+ `tests/pg-helpers.js`) — `PG_ADMIN_URL=… node --test tests/pg-tracker.test.js`; skips cleanly with no PG. |
| `reports-weekly-pptx.js` | Weekly PPTX **and** all `slideMonthly*` monthly slide functions |
| `reports-monthly-pptx.js` | Dedicated monthly PPTX generator — FORKED `slideMonthly*` (feeds v2 + all-sites decks; NOT identical to the weekly file's copies — see the slideMonthly* audit section) |
| `reports-pptx-shared.js` | Shared pure RAG/trend helpers (`statusColor`, `trendArrow`, `trendColor`, `computeTrends`, `autoStatusColor`) deduplicated out of both PPTX files. Edit here, not in copies. |
| `reports-db.js` | All SQLite queries (`getMonthlyData`, `getHelpdesk6MonthHistory`, `getCalendarMonthlyHelpdesk`, `getYearlySummary`) |
| `public/lib/dashboard-shared.js` | **Canonical helpers** consumed by every page — `parseZohoDT`, `isClosed`, `isResOverdue`, `xRows`, `OPS_GROUPS_DEFAULT`, `APPS_GROUPS_DEFAULT`, `IT_HELPDESK_GROUPS`. Single source of truth for KPI math. **Edit here, NOT in individual pages.** |
| `public/_tokens.css` | **Canonical design tokens** (palette, typography, spacing, radius, shadow) — every page imports this |
| `public/brand/brand-tokens.js` | JS mirror of `_tokens.css` for PPTX generators. Keep in lockstep with the CSS |
| `public/brand/icons.js` | Lucide-style icon library (`window.EDV_ICONS.html('name')`). Loaded by every page before `_shell.js` |
| `public/brand/icons.css` | `.icon` class system with size + tint modifiers |
| `public/brand/components.css` | `.edv-empty-state`, `.edv-hero`, `.edv-section-divider`, `.edv-goldy-badge` patterns |
| `public/_shell.js` + `_shell.css` | Header nav + dropdown rendered by every page that loads `_shell.js` |
| `tracker-db.js` | SQLite persistence for Activity Tracker (`tracker_config`, `tracker_targets`, `tracker_inputs`) |
| `tracker-pptx.js` | Server-side 2-slide PPTX generator for IT Activity Tracker |
| `tracker-init.json` | Default seed data — activities list, pillar weights, targets, active sites |
| `public/activity-tracker.html` | IT Activity Tracker UI — 10 sites, 31 activities, 4 pillars, RBAC |
| `public/tracker-icons/` | 8 PNG icon files embedded in tracker PPTX (logo, 4 pillar icons, green/amber) |
| `public/index.html` | Main helpdesk dashboard |
| `public/reports.html` | Weekly + monthly report UI |
| `public/executive.html` | Executive Scorecard — 5 tabs (KPI Snapshot · Action Plan · Tech Scorecard · Change & Incidents · Customer Voice). Includes Multi-Touch Rate, Verbatim Explorer, deterministic Analyze Lite |
| `public/executive-report.html` | Executive report (deck builder) with localStorage presets + AI Analyze & Save |
| `public/activity-tracker.html` | IT Activity Tracker — 10 sites, 31 activities, 4 pillars, RBAC auth |
| `public/inspection.html` + `inspections.html` | IT Inspections — form + dashboard, 17 categories / 173 items, photos, signatures, PPTX |
| `public/inspection-actions.html` | Corrective Actions Register — flat list of all `insp_actions` across inspections, per-action status change (editor+) via `POST /api/inspection/actions/:id/update`, closable even when the parent inspection is submitted/closed. Reached from a button on `inspections.html`. Sibling of `meetings-actions.html` |
| `public/meetings-actions.html` | Meetings Actions Register — flat list of all `md_actions` across PVs, per-action close via `POST /api/meetings/actions/:id/update` (works even on a closed PV — actions outlive the meeting). `✔ Actions` tab on every meetings module page. Audit in `md_action_updates` |
| `inspection-db.js` + `inspection-pptx.js` + `inspection-init.json` | Inspections SQLite layer + 4-slide PPTX generator + seed data |
| `public/meetings.html` + `meeting.html` + `meetings-issues.html` + `meetings-council.html` + `meetings-compliance.html` + `meetings-import.html` + `meetings-progress.html` + `meetings-insights.html` | Meetings & Council Escalations module v2 — PV editor, Issues Log, Council theme grouping, 5 Engagements compliance, bulk Excel import, "since last meeting" diff, **analytical dashboard with 6 Chart.js charts + 5-Engagements heatmap + site leaderboard** |
| `meetings-db.js` + `meetings-init.json` + `meetings-import.js` | Meetings SQLite layer + seed data (11 bilingual lookups) + xlsx bulk import parser |
| `risk-register-export.js` | Risk Register monthly Occurrence export — 5-domain classifier, SDP→register site alias mapping (SQLite-backed config in `reports.db`), xlsx (SheetJS CE) writer. Card lives at `reports.html#admin` for super_admin |
| `public/analyze-lite.js` | Deterministic Voice-of-Customer + Voice Insights analysis engine (no AI, no network, ~470 lines, bilingual EN/FR) |
| `public/help.html` | Bilingual EN/FR user manual — covers all 14 sections |
| `_recover_better_sqlite3_prod.cmd` | Emergency: rebuild better-sqlite3 native binding on prod after an npm operation breaks it. Bypasses corporate SSL inspection for the prebuild download. Run from prod cmd.exe at `C:\Apps\SDP-Dashboard\` |
| `_uninstall_exceljs_prod.cmd` | Optional cleanup: removes the unused `exceljs` + 80 transitive packages from prod after the xlsx switch. Run from prod cmd.exe |
| `public/auth.js` | Unified auth helper — roles: super_admin > executive > admin > editor > viewer + feature roles (tracker-admin, tracker-editor, report-author, audit-viewer, scorecard-viewer). `data-require` accepts a pipe-separated OR list (`"admin\|scorecard-viewer"`). scorecard-viewer (2026-06-12) = read-only access to executive.html + analytics.html without the executive/admin write powers; AI Analyze + PPTX export stay blocked server-side by report-author |
| `RENEW_ZOHO_TOKEN.html` | Runbook for renewing the Zoho OAuth refresh token (8 steps) |
| `ANALYTICS_PLUS_API_SCOPES.md` | Canonical scope reference — **use `MEAplus.fullaccess.all`** (the narrower read-only scopes trigger 7301) |
| `get-token.js` | Token exchange utility — supports `--dc=com/eu/in/au` and `--verbose` flags |

> **Critical rule — `slideMonthly*` functions have FORKED across the two tracked
> files** (`reports-weekly-pptx.js` and `reports-monthly-pptx.js`). They are **no
> longer identical copies** — each set feeds a *different* live deck (see the
> usage table below). **Do NOT blind-merge a `slideMonthly*` change into "the
> other copy"** — that would change the output of a deck it doesn't belong to.
> Edit the version that belongs to the deck you're changing, and rely on the
> golden fingerprint test to confirm you didn't disturb the others.

## Legacy local-only files (DO NOT modify — not in git, not deployed)

These files exist in `C:\Users\Admin\Documents\SDP-Dashboard\` but are listed under `LEGACY / ONE-OFF SCRIPTS` (or `RUNTIME DATA`) in `.gitignore`. They are **not** in the GitHub repo and **not** deployed to `C:\Apps\SDP-Dashboard\`. Editing them changes nothing in production. If a future session is tempted to "fix" or extend them, stop — they are scratch artifacts retained for reference, not active code.

| File / pattern | What it was |
|----------------|-------------|
| `generate-executive-pptx.js` | Older standalone CLI — composited screenshot PNGs (`--kpi`, `--tech`, etc.) into `IT_Operations_Monthly_Report_COMPACT.pptx` (template lives outside the repo, referenced only in local-only `NEW_CONVERSATION_PROMPT.md`) |
| `generate-executive-pptx-v2.js` | Newer standalone CLI — built native pptxgenjs charts from `--data data.json`. Superseded by the executive flow served from `server.js` + `public/executive-report.html` |
| `generate-monthly-report.js`, `generate-site-monthly-pptx.js` | One-off monthly / per-site PPTX builders |
| `make_monthly_report.js`, `make_group_reports.js`, `make_group_reports_endeavour.js` | Earlier `make_*` family of report scripts |
| `executive-new-report.js` | Helper for the original "new report" workflow |
| `server-minimal.js` | Zero-dependency drop-in for `server.js` (uses only Node built-ins). Kept as a fallback for restricted environments — not loaded by PM2 |
| `get-token.js` | Standalone Zoho OAuth token-exchange utility (one-off) |
| `extract_feb2026_data.js`, `extract-cache.py`, `data/extract_*.js` | Ad-hoc data extraction scripts run for specific months |
| `unpacked_tmpl/` | Unpacked PPTX template tree — scratch, regeneratable |
| `slide_qa*.jpg`, `smoke-check*.jpg`, `tmpl_thumb.jpg`, `chart_*.png` | QA / smoke-test screenshots |

The active executive flow lives in `server.js` (canonical runtime) + `public/executive-report.html`. Token rotation only needs `.env` + `server.js`. Each legacy script above has its own `getToken()` / `addChrome()` etc., but those duplications are **not a maintenance concern** because no one runs them in production — leave them alone.

If you find one of these files referenced in `package.json` scripts, in a `server.js` route handler, or in a Windows Task Scheduler entry, that's a sign it should be moved out of `.gitignore` and back into the live app — surface that finding rather than silently editing the file.

---
