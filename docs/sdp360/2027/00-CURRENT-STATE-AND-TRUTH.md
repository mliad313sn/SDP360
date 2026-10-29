> **Superseded as the source of truth (G00, 2026-10-29).** Kept as history. Current state: `docs/agent-execution/README.md` (goal tracker, generated inventory) and `docs/sdp360/completion/TRUTH-MATRIX.md`. Where this file and those disagree, those win.

# 00 — Current state and truth register (Goal 01)

**Inspected:** 2026-10-21 · **HEAD:** `49ff9e022051a8b79e32e5d826d22d2e1bb8f1bc` · **Branch:** `worktree-agent-a293ba42bd60bae16` (isolated worktree of the SDP360 repository) · **Machine-readable register:** [`feature-matrix.json`](feature-matrix.json), guarded by `tests/feature-matrix.test.js`.

## 1. Environment limits (read before trusting anything below)

This inspection ran in a **Linux CI-like sandbox**. It had:

- the repository, Node.js, `node_modules` (borrowed by symlink, not committed), and a **disposable PostgreSQL 16 on `localhost:5433`** used only by the test suite;
- **no** production access, **no** Windows/IIS/PM2 host, **no** live Zoho Analytics Plus, SDP Cloud API, OpManager, Meraki, Entra ID, Teams, SharePoint/Graph, Power BI or 4MyPeople endpoint, **no** `prod-snapshot/`, **no** mobile device or mine-site network.

Consequently: every status "integrated", "field-validated", "security-approved", "deployed" and "business-accepted" is **UNKNOWN** unless a repository artefact states it, and such a statement is recorded as **documented_as_deployed**, never as verified. The prod deploy marker file (`.git/last-deployed`) is a local, untracked file of the original dev box and is not present in this worktree.

## 2. Version reconciliation

| Source | Before | After this goal |
|---|---|---|
| `README.md` header (`**Version:**`) | `2.0.0-alpha.1` | `2.0.0-alpha.13` |
| `package.json` `version` | `2.0.0-alpha.12` | `2.0.0-alpha.13` |
| `package-lock.json` root + `packages[""]` | `2.0.0-alpha.12` | `2.0.0-alpha.13` |
| `CHANGELOG.md` newest heading | `## 2.0.0-alpha.13 — 2026-10-20 — Remédiation vague 0/1` | unchanged (bullet added) |

The CHANGELOG already carried an alpha.13 section (remediation wave 0/1: IA-1, M12-a, E2, E3, E4, E6, C1/C2, M4, M7, M9, E1, E11) while `package.json` had not been bumped and the README had never been updated since alpha.1. `tests/version-consistency.test.js` now fails if any of the four diverge.

Runtime visibility: `GET /ready` (`routes/health.js`) returns only `{ok, db, last_job_at}` — it exposes **no** version, so there was nothing to re-point at `package.json`. The only runtime identifier is `APP_VERSION` (git short SHA, used for `?v=` asset cache-busting, per CLAUDE.md "Browser-side asset caching"). Exposing the package version on an authenticated health route is listed in the backlog (E0.3), not done here (instruction: do not touch `server.js`).

## 3. Build / test evidence

| Item | Command | Result |
|---|---|---|
| Full suite (baseline, before changes) | `DASH_USER=admin DASH_PASS=*** TZ=UTC PG_ADMIN_URL=postgres://postgres@localhost:5433/postgres PG_TESTS_REQUIRED=1 npm test` | exit **0** · **2 702** tests · **2 691 pass · 0 fail · 11 skipped** · 56.7 s |
| Full suite (after this goal) | same | see §7 |
| New tests alone | `node --test tests/feature-matrix.test.js tests/version-consistency.test.js` | 9 pass / 0 fail |
| Dependency audit | `npm audit --omit=dev` | ran (registry reachable through the proxy): **2 high** — `follow-redirects 1.16.0` (GHSA-q3jh-wrc6-jgq8, GHSA-8r9p-f939-6h3c), `image-size 0.6.3–2.0.2` (GHSA-5p2g-fcmc-qvqq, GHSA-w3rx-r6r6-pgpr); fix available, **not applied** (dependency change = separate, reviewed change) |
| Lint / build | `npm run build:check` exists; not run in this goal | — |

**The 11 skips** (all environmental, none hidden): 1 × `render.py` PPTX render (python + matplotlib + python-pptx not installed); 6 × review-data fidelity against `prod-snapshot/` (absent); 4 × site helpdesk/changes window readers against `prod-snapshot/` (absent). `PG_TESTS_REQUIRED=1` was set, so no PostgreSQL test was skipped.


## 4. Feature inventory

Statuses: **Y** = proven here (code path exists and its named tests passed in the run above) · **P** = partial · **N** = checked, absent · **?** = unknown · **D** = documented as deployed (CLAUDE.md / CHANGELOG), not verified. Columns: Doc / Code / Auto-test / Integrated / Field / Security / Deployed / Business-accepted. Full paths and test names are in `feature-matrix.json`.

| Feature | Main paths | Doc | Code | Auto | Integ | Field | Sec | Depl | Biz |
|---|---|---|---|---|---|---|---|---|---|
| Site Actions Register | `services/siteActionsRegister.js`, `routes/siteActions.js`, `public/site-actions.html` | Y | Y | Y | ? | ? | ? | D | ? |
| Governance cockpit + portfolio tables | `services/governanceStore.js`, `routes/governance.js` | Y | Y | Y | ? | ? | ? | ? | ? |
| Report Studio + AI commentary | `routes/reportStudio.js`, `services/reportGenerator.js`, `services/reportStore.js` | Y | Y | Y | ? | ? | ? | ? | ? |
| Metric registry + RAG | `services/metricRegistry.js`, `routes/metrics.js` | Y | Y | Y | ? | ? | ? | ? | N |
| Dashboard composer | `services/dashboardData.js`, `services/dashboardStore.js`, `routes/dashboards.js` | Y | Y | Y | ? | ? | ? | ? | ? |
| Engagement / alerts / share links | `services/engagementJobs.js`, `services/alertEngine.js`, `routes/engagement.js` | Y | Y | P | ? | ? | ? | ? | ? |
| Graph / SharePoint publishing | `services/engagementJobs.js` (`publishScheduled`) | Y | Y | **N** | ? | ? | ? | ? | ? |
| Configurable trackers | `services/trackerSources.js`, `services/trackerStore.js`, `routes/trackers.js` | Y | Y | Y | ? | ? | ? | ? | ? |
| Field PWA | `services/fieldOutbox.js`, `services/fieldStore.js`, `routes/field.js`, `public/field/` | Y | Y | Y | ? | ? | ? | ? | ? |
| Sync runner | `services/sync/{jobs,syncRunner,schedule,syncStore,alerts}.js`, `routes/sync.js` | Y | Y | Y | ? | ? | ? | ? | ? |
| External API / OData | `routes/extApi.js`, `services/odata.js` | Y | Y | Y | ? | ? | ? | ? | ? |
| Auth / RBAC / SSO | `services/userSites.js`, `services/sso*.js`, `routes/adminUsers.js` | Y | Y | Y | ? | ? | ? | D | ? |
| Meetings / incubation | `meetings-db.js`, `routes/meetings.js` | Y | Y | Y | ? | ? | ? | D | ? |
| Inspections | `inspection-db.js`, `routes/inspection.js` | Y | Y | Y | ? | ? | ? | D | ? |
| Assets | `assets-db.js`, `assets-sync.js` | Y | Y | Y | ? | ? | ? | D | ? |
| OpManager availability | `services/opmanager*.js`, `routes/opmanager.js` | Y | Y | Y | ? | ? | ? | ? | ? |
| Meraki WAN / WAN SLA | `services/merakiClient.js`, `services/wanSla.js`, `tools/meraki/*` | Y | Y | Y | ? | ? | ? | D | ? |
| Meridian federation | `routes/meridian.js`, `services/meridian*.js` | Y | Y | Y | N | N | ? | D (dormant) | N |
| Backups + restore drill | `services/backup.js`, `services/restoreDrill.js`, `tools/pg/restore-drill.js` | Y | Y | Y | P (sandbox PG only) | ? | ? | ? | ? |
| Teams SLA alerts | `services/teamsSla.js`, `routes/teamsSla.js`, `tools/teams/poll-sla.js` | Y | Y | Y | ? | ? | ? | ? | ? |
| 4MyPeople lookup | `routes/fourmypeople.js` | Y | Y | Y | ? | ? | ? | ? | ? |
| Health / readiness | `routes/health.js` | Y | Y | Y | ? | ? | ? | ? | ? |

Notes worth keeping in view:

- **Deployment.** CLAUDE.md states that "everything on `main` up to the deploy marker is in prod" and names markers up to `0b649ba` (2026-10-03). The SDP360 2.0 alpha work (alpha.1 → alpha.13: governance cockpit, Report Studio, metric registry, trackers, field PWA, sync runner, ext API) post-dates those markers; **no artefact here proves any of it is deployed.**
- **Frozen lots.** CLAUDE.md documents that the installer-safety lot and the tracker RAG-band change are on `main` but intentionally **not** in prod. The `tools/deploy/frozen-lots.json` register it cites is **not present** in this repository (checked), so the frozen-lot list cannot be verified here.
- **Graph publishing** is the only listed feature with code and no automated test at all.

## 5. Connectors and scheduled jobs (from `services/sync/jobs.js`)

All jobs run through one runner (lock, retry, run log, failure event). `freshnessHours` drives "stale" on `/api/sync/health`; `optional` jobs self-skip until configured and report "idle", never "stale".

| Job | Cron (server TZ) | Fresh (h) | Optional | Source / failure mode |
|---|---|---|---|---|
| `zoho.requests` | `45 * * * *` | 3 | no | Zoho Analytics CSV; truncation guard in `zoho-sync.js`; 3 attempts |
| `zoho.change_cab` | `30 * * * *` | 3 | no | Zoho; full upsert each run |
| `zoho.survey` | `0 * * * *` | 3 | no | Zoho |
| `assets.sync` | `30 4 * * *` | 30 | no | 6 Analytics Plus views; any failed view = transient failure |
| `meridian.resources` | `0 5 * * *` | 30 | yes | Meridian (dormant) — out of 2027 scope |
| `opmanager.availability` | `10 5 * * *` | 30 | yes | OpManager REST / Analytics view |
| `meraki.wan` / `meraki.wan_events` | `20 5` / `25 5 * * *` | 30 | yes | Meraki cloud — duplicates OpManager scope |
| `meraki.wan_events_5m` / `meraki.wan_poller` | `*/5 * * * *` | 1 | yes | Meraki — 2 attempts |
| `teams.sla_poll` | `*/5 * * * *` | 1 | yes | SDP Cloud API v3 → Teams webhooks |
| `db.backup` | `0 3 * * *` | 30 | yes | pg_dump, trailer-verified, gzip/AES-GCM |
| `db.restore_drill` | `0 4 1 * *` | 792 | yes | 1 attempt; mismatch = failure |
| `audit.retention` | `30 3 * * *` | 30 | no | purge system_log |
| `engagement.alerts` | `*/15 * * * *` | 1 | yes | alert_rules over metric readers |
| `engagement.digest` / `_weekly` | `0 7 * * *` / `15 7 * * 1` | 30 / 192 | yes | notifications |
| `reports.weekly` / `reports.monthly` | `30 6 * * 1` / `45 6 1 * *` | 192 / 768 | yes | Report Studio scheduled runs |
| `publish.connectors` | `0 6 * * *` | 30 | yes | Excel e-mail, webhook, SharePoint list via Graph |
| `field.purge` | `0 3 * * *` | 30 | yes | outbox > 90 d, chunk uploads > 48 h |

## 6. Action-like records (duplicated lifecycle logic)

| Record | Store | Status vocabulary / terminal set | Where the terminal rule lives |
|---|---|---|---|
| `md_actions`, `md_issues` (meetings, incubation) | `meetings-db.js` | open … + transfer statuses; terminal = `resolved, cancelled, closed, demand, helpdesk_ticket` | `public/lib/statusTransfer.js` `DONE` + SQL lists in `meetings-db.js` |
| `insp_actions` (inspections) | `inspection-db.js` | terminal = `closed, cancelled` | `services/siteActionsRegister.js` `TERMINAL.inspection` |
| `action_items` (weekly report follow-ups) | `reports-db.js` | terminal = `closed, cancelled`; newest-in-lineage wins | `public/lib/actionGroups.js` `TERMINAL`, `services/siteActionsRegister.js` `TERMINAL.report` |
| `session_actions` (governance cockpit) | `services/governanceStore.js` | default `open`; `closed_at` set when `done`/`cancelled` | inline SQL in `governanceStore.js` |
| `decisions` | `services/governanceStore.js` | `DECISION_STATUSES`; terminal `done`/`cancelled` | inline in `governanceStore.js` |
| `portfolio_deliverables` / `portfolio_risks` | `services/governanceStore.js` | `todo` / `open` defaults | inline |
| `rfi_requests` | `services/governanceStore.js` | own status | inline |
| `tracker_entries` | `services/trackerStore.js` | value entries, not a lifecycle | — |

At least **five independent terminal-status definitions** exist; none distinguishes technical completion from independent business/control verification. This is the core input to Goal 02.

## 7. Post-change evidence

Same command as §3, after adding `tests/version-consistency.test.js` (4 tests) and `tests/feature-matrix.test.js` (5 tests):

| Run | Exit | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|---|
| after #1 | 0 | 2 660 | 2 649 | 0 | 11 |
| after #2 | 0 | **2 711** | **2 700** | 0 | 11 |

Run #2 = baseline 2 702 + the 9 new tests, as expected. Run #1 **under-reported** by 51 tests with no failure: a name-by-name diff against the baseline shows whole files' subtests missing from the TAP stream (e.g. `tests/report-template-weekly.test.js`, `tests/review-fidelity.test.js`), and those two files pass 90/90 when run alone. This is a reporting instability of `node --test --test-force-exit` in a full parallel run, not a test failure — but it means **a green total alone is not proof that every file ran**; compare the test count with the expected total. Recorded as a gap (G8.6 in the gap register).
