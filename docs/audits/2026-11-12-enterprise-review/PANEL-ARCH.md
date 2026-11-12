# Committee F — PANEL ARCH (architecture & modernization, defensive security, provenance, integrations freshness, continuity, coverage, CSP, dependencies)

Reviewed head: branch `sdp-waves` = `413e26b` (after W2-RDB / W2-ITSM merge). Worktree `/home/user/w/w2-qj` (E-Q03, commit `99b763c`, not merged) read for overlap only.
Inputs: `ecarts.txt` (12 Nov 2026, E01/E02/E04/E05/E10 + security/architecture tables), `vision.txt` v2.0. The review.1 files (manifest `2.0.0-alpha.16+review.1`, migrations 078/079, `workspace-settings.html`, profile engine) are **not** in this repo — every claim that rests on them is labelled NEEDS-REVIEW.1-ARTIFACT.

## (a) Verdict summary

1. **E04 freshness defect is real and wider than described.** `legacyJob` turns `{skipped:true}` into an empty result with `nextWatermark = now` (`services/sync/jobs.js:41-44`); the runner records `status:'ok'` and advances the watermark (`services/sync/syncRunner.js:146-151`); `/api/sync/health` **and the publication gate** (`services/publishGate.js:130-135` → `freshness()` :77-86) read the last `ok` run. An unconfigured Meraki/OpManager source therefore reads **FRESH** on dashboards and report publication — a "null shown as green" violation. Two test files pin the defect (head `tests/sync-jobs-registry.test.js:124-125`; W2-QJ `tests/jobs-meraki-skip.test.js:25-45`). Fix is S, agent-doable, no switch (defect).
2. **E02 multisite portfolio access is implemented and correct by reading**, behind `portfolio_site_scope_reads` / `portfolio_editor_plan_writes` = `'0'` (`services/reportConfig.js:201`); list, detail, history, baselines, exceptions, deck, workbook and report.html all go through `viewFor`/`canReadProject` (`routes/governance.js:502-508,562,601,629-660,673`). The gap is **proof**: no test exercises exports/report.html/exceptions-vs-list parity with the switch ON, nor revocation on portfolio surfaces. Arming and the two exceptions (group-level project readable by all, free-text owner match — `services/portfolioAccess.js:47-49`) are people's decisions.
3. **E01 provenance: the version endpoint reports source metadata only** (`routes/health.js:41-44`: `package.json` version + `APP_VERSION` = `git rev-parse --short HEAD` or `'t'+epoch` when no `.git`, `server.js:1250-1260`). A packaged install has no `.git`, so `build` is a boot-time token that changes on each restart; the installed, signed `manifest.json` (read by `tools/sdp-manager.js:70`) is never consulted. Signing (Ed25519 manifest, Authenticode) and a CycloneDX SBOM already exist in `release.yml:91-113`; the SBOM is not shipped inside the package.
4. **E05 continuity:** the monthly restore drill is **database-only** (`tools/pg/restore-drill.js:7-17`; no blob/upload/key step). EXE qualification and RTO/RPO are environment + people work.
5. **E10 coverage figure "47 routes / 10 jobs" is not reproducible at head:** the generated inventory says **35 routes / 1 job** (`docs/agent-execution/INVENTORY.md:15,18`, mention-based); a strict path-regex recount gives **76 routes / 10 jobs**. E-Q03 (W2-QJ) is closing part of it — and must be aligned with the E04 fix.
6. **New P0 defect:** `GET /api/sample/:viewId` (`server.js:4428-4444`) — any signed-in session, calls Analytics directly (bypassing `stripPiiColumns`), allowed views include `REQUEST_TABLE` (`server.js:335`) → requester e-mail/phone rows + 500-char raw preview; the AP `/data` API ignores `maxRows`, so each call downloads the whole view. No front-end caller, absent from `docs/ops/AUTHZ-MATRIX.md`.
7. CSP: strict nonce-only policy on 2 pages + `/share/` (`services/sessionAuth.js:23-24`); 46 pages still carry inline scripts (INVENTORY.md); report-only collector exists (`routes/securityCsp.js`, env `SDP_CSP_REPORT_ONLY`). Per-journey enforcement is open.
8. Dependencies: **11** Dependabot branches at head (not 10); triage ledger already exists (`docs/agent-execution/DEPS-TRIAGE.md`, E-Q05); SCA + CodeQL already in CI (`ci.yml:51-52`, `codeql.yml`). Execution of the lots is the open part.
9. 10 goals proposed (F-ARCH-01…10): 4 × P0, 4 × P1, 2 × P2; 9 are agent-doable without review.1 and without a human decision (F-ARCH-10 is a decision-gated release policy).
10. Nothing in this domain needs the review.1 artifact to be fixed at head; review.1 is needed only to compare its write-fence and its manifest/ZIP identity.

## (b) Claim verification

| # | Claim (source) | Label | Evidence |
|---|---|---|---|
| C1 | `jobs.js` turns `{skipped:true}` into an empty result with a new date (ecarts §Fraîcheur, E04) | CONFIRMED | `services/sync/jobs.js:41-44` (`rows: []`, `nextWatermark: new Date().toISOString()`); `failOnZero` explicitly exempts skipped (:43) |
| C2 | `syncRunner.js` records success and advances the watermark | CONFIRMED | `services/sync/syncRunner.js:146-151` (`setWatermark`, `finishRun status:'ok'`) |
| C3 | `routes/sync.js` uses the last success to present freshness | CONFIRMED (wider) | `routes/sync.js:54-61` (`ok`/`stale` from `last_ok`; `idle` only when never ran); also `services/publishGate.js:130-135` → dashboards `routes/dashboards.js:139`, report studio `routes/reportStudio.js:51-55`; alerts `services/sync/alerts.js:53-55`; drift `services/sync/drift.js:49-53` consumes the fake 0-row ok runs |
| C4 | `portfolio_site_scope_reads=0` and editor writes 0 (E02) | CONFIRMED | `services/reportConfig.js:201`; `routes/governance.js:497-500` |
| C5 | Mode 1 tested with revocation, Finance role, out-of-site project, export (on review.1) | CONFIRMED in code at head / tests partial | guards: `routes/governance.js:502-508,562,601,629-660,656-660,673`; tests: `tests/portfolio-site-scope.smoke.test.js:61-114`, `tests/ppm-baselines.smoke.test.js:125-141` (exceptions/baselines), `tests/e2e/deny-cross-site.spec.js`; **missing**: deck/workbook/report.html with scope ON, revocation on portfolio (`tests/access-revocation.smoke.test.js:46-78` covers reports only) |
| C6 | Group-level project and textual owner exceptions remain to be arbitrated | NEEDS-HUMAN | `services/portfolioAccess.js:47-49` (`!sites.length → true`; `ownerMatches` free-text) |
| C7 | Revocation in session | ALREADY-FIXED (server) | roles/sites re-read per request `reports-db.js:778-790`, `server.js:4493-4502`; `tests/access-revocation.smoke.test.js` |
| C8 | Manifest `2.0.0-alpha.16+review.1` vs package.json alpha.16 | NEEDS-REVIEW.1-ARTIFACT | head `package.json` = `2.0.0-alpha.14`; `tests/version-consistency.test.js` pins package/lock/README/CHANGELOG |
| C9 | Version endpoint uses source metadata | CONFIRMED | `routes/health.js:41-44`, `server.js:636,1250-1260`; smoke pins exactly 4 keys `tests/health-version.smoke.test.js:32` |
| C10 | Dev ZIP unsigned, commit unknown | NEEDS-REVIEW.1-ARTIFACT | capability at head: `tools/deploy/make-update-package.js:14-19,64-81`; Manager refuses unsigned `tools/sdp-manager.js:19-21,93-101` |
| C11 | Signatures and SBOM required for diffusion | ALREADY-FIXED (pipeline) / NEEDS-HUMAN (keys, policy) | `release.yml:91-113` (signed manifest, CycloneDX `tools/release/sbom.js`, Manager verify), Authenticode `release.yml:146-165`; release can still publish unsigned; key ceremony is "Hors code" in PLAN-E |
| C12 | 116 regressions + 6 isolated restore tests passed; 697 files rolled back on copy | NEEDS-REVIEW.1-ARTIFACT | evidence from the test machine only |
| C13 | Full recovery must include files, DB and keys; EXE to qualify | CONFIRMED (gap) / NEEDS-HUMAN (EXE env) | drill = DB row counts only `tools/pg/restore-drill.js:7-17,149-172`; key dependency stated `docs/DB_RECOVERY.md:53-54` but never drilled |
| C14 | 47 route declarations and 10 jobs without test reference (E10) | OPEN-IN-PLAN-E (E-Q03) — count REFUTED as a precise figure | head inventory 35/1 `docs/agent-execution/INVENTORY.md:15,18`; strict recount 76/10 (method §c N5); E-Q03 in `/home/user/w/w2-qj` (`99b763c`) |
| C15 | Strict CSP on some pages, legacy screens keep inline scripts | CONFIRMED | `services/sessionAuth.js:23-31`; `server.js:157-205`; 46 pages with inline scripts (INVENTORY.md) |
| C16 | 10 Dependabot branches, several majors | CONFIRMED (count 11) | `git branch -r`: 6 npm (dotenv 18, eslint 10, express 5, nodemailer 10.3.1, playwright 1.64.1, pptxgenjs 4) + 5 actions |
| C17 | Treat with SCA, CodeQL | ALREADY-FIXED | `ci.yml:51-52` (`npm audit --audit-level=high`), `.github/workflows/codeql.yml`; triage `docs/agent-execution/DEPS-TRIAGE.md` |
| C18 | README still mentions a SQLite fallback | REFUTED (for this repo) | `grep -i sqlite README.md` → no match |
| C19 | Node 22, no direct SQLite dependency, Express + PG 17 | CONFIRMED | `package.json` engines `>=22 <23`, deps; `services/backendGuard.js` |
| C20 | Meraki key missing on dev; Zoho `invalid_client_secret` | NEEDS-HUMAN | environment state; not observable from code |
| C21 | Map each promoted KPI to its job and source | ALREADY-FIXED | `docs/ops/METRIC-LINEAGE.md` (generated, `--check`), `services/governancePolicy.js:24` `FRESHNESS_SOURCES` |
| C22 | Installed code adds a sync write fence | NEEDS-REVIEW.1-ARTIFACT | not in head |
| C23 | Large `server.js` + inline-script pages; extract contracts lot by lot | OPEN-IN-PLAN-E (W2-SRV, E-A02) | `server.js` 7011 lines |
| C24 | Use scoped keys, read-only qualification, redacted evidence | NEEDS-HUMAN | ADR-004 + secret contract exist; qualification needs live keys |

Counts: CONFIRMED 10 · REFUTED 1 · ALREADY-FIXED 4 · NEEDS-REVIEW.1-ARTIFACT 4 · NEEDS-HUMAN 3 · OPEN-IN-PLAN-E 2 (24 claims).

## (c) New findings (not in the documents)

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| N1 | P0 | `GET /api/sample/:viewId` leaks PII and is a cheap DoS: session-only gate, direct `axios` call (no `fetchView` → no `stripPiiColumns`), `REQUEST_TABLE` allowed, returns 5 raw rows + `rawPreview` 500 chars; AP `/data` ignores `maxRows` so the whole view is downloaded per call. No caller in `public/`, `tests/`, `tools/`; missing from AUTHZ-MATRIX. | `server.js:4428-4444`, `:335`, `:53-81`; CLAUDE.md pitfall "AP /data ignores maxRows" |
| N2 | P0 (coordination) | The in-flight E-Q03 tests pin the E04 defect ("a self-skip is an ok run with 0 rows", "meridian … records an ok run"). Merging W2-QJ as is cements it. | `/home/user/w/w2-qj/tests/jobs-meraki-skip.test.js:25-45,57+`, `tests/jobs-engagement.test.js:33-44`; head `tests/sync-jobs-registry.test.js:124-125` |
| N3 | P1 | Skipped runs also poison drift (0-row "ok" runs in `recentOkRuns`) and keep `checkStale` silent for an optional source that was configured then lost its key (its fake `last_ok` keeps refreshing). | `services/sync/drift.js:49-53`, `services/sync/alerts.js:48-60`, `syncStore.js:70-72` |
| N4 | P1 | In a packaged install the `build` field is `'t'+epoch` (no `.git`), so "which code is running" is unanswerable from the API; the installed `manifest.json` (version, commit, signature) is ignored; the SBOM is generated after packaging (`release.yml:102-103`) and never shipped. | `server.js:1250-1260`, `routes/health.js:41-44`, `tools/sdp-manager.js:70-72` |
| N5 | P1 | Coverage recount (method: every `router/app.<verb>('<literal>')` in `server.js` + `routes/*.js`, path turned into a regex with `:param` wildcards, searched in all `tests/**/*.{js,mjs}`): 614 declarations, 79 unmatched, 3 are template-literal paths (`${action}`) → **76**; jobs: names quoted in no test → **10** (`meridian.resources`, `meraki.wan_events`, `meraki.wan_events_5m`, `meraki.wan_poller`, `engagement.alerts`, `engagement.digest`, `engagement.digest_weekly`, `reports.weekly`, `reports.monthly`, `engagement.schedule_reminders`). Notable uncovered writes not in E-Q03's list: `PUT /api/reports/:id/helpdesk` (server.js:6023), `PUT/DELETE /api/reports/departments/:id` (:5216,:5234), `DELETE /api/risk-register-config/aliases/:sdp_label` (routes/riskRegister.js:107), `PUT/DELETE /api/roadmap/action|resource/:uid` (routes/roadmap.js:132-149), meetings lookup writes (routes/meetings.js:631-693), `POST /api/save-pptx` (:6551), `POST /api/executive-new-pptx` (:6471). | script output, kept in the panel scratchpad |
| N6 | P1 | Restore drill proves the DB only: blob store (`data/blobs`), field uploads and the two keys (`SDP_BACKUP_KEY`, `SDP_CONFIG_KEY`) are not exercised; `durationMs` is recorded but compared with no target. | `tools/pg/restore-drill.js:7-17,149-172`; `docs/DB_RECOVERY.md:18,53-54` |
| N7 | P2 | `/ready` `last_job_at` reads the legacy `sync_metadata` only; runner jobs (backup, audit, Meraki…) never move it. | `routes/health.js:24-37` |
| N8 | P2 (verify) | `GET /api/change?site_id=` and `/api/data/*` are session-only with caller-chosen `site_id` and no read-scope check; listed in AUTHZ-MATRIX with no scope column. Whether change/CAB data is fleet-readable by design is undecided. | `server.js:2927-2935`; `docs/ops/AUTHZ-MATRIX.md:102,119-127` |

## (d) Vision capability map (this domain)

| Vision capability (section) | Exists at head | Verdict | Evidence / note |
|---|---|---|---|
| Server-side authorization, object ACL, explicit deny (§1.3, §7 Security) | central read guard, `_authorizeReportWrite`, userSites, portfolio guard, revocation per request | RETAIN + IMPROVE (proof matrix, N1, N8) | `server.js:4493-4513`, `services/portfolioAccess.js` |
| Data: source, definition, freshness, lineage visible (§7 Data, WP2) | metric registry, METRIC-LINEAGE, publish gate, sync health | IMPROVE (E04 skip semantics) | C1-C3, C21 |
| Reliability: graceful stale/partial/error states (§7) | null = UNKNOWN in gate | IMPROVE (skip ≠ fresh) | `services/publishGate.js:82` |
| Operability: logs, metrics, connector health, alerting, runbooks, backup, rollback (§7) | sync_runs, alerts, system_log, backup job, restore drill, Manager rollback, runbooks in `docs/ops` | RETAIN + IMPROVE (full-service drill, /ready) | N6, N7 |
| CI/CD, provenance (Prompt 8) | CI, CodeQL, SCA, signed manifest, Authenticode, SBOM, version-consistency test | IMPROVE (runtime provenance endpoint, SBOM in package) | C9-C11, N4 |
| Architecture adaptation, strangler/façade, ADRs (WP5, Prompt 8) | routes/ factories, ADR-001…006, `server.js` 7011 lines shrinking | RETAIN (approach) / CONSOLIDATE (`server.js` → routes; Plan E W0/W2-SRV) | `docs/adr/` |
| Compatibility: bookmarks, deep links, APIs (§7) | `/api/data/*` legacy proxies kept; dead endpoints remain | CONSOLIDATE / RETIRE (`/api/sample`, other caller-less legacy routes after a usage check via page-usage telemetry) | N1, `routes/pageUsage.js` |
| Security hardening — CSP, dependencies (WP3) | report-only collector, 2 strict pages, Dependabot + triage ledger | IMPROVE (per-journey enforcement, executed lots) | C15-C17 |
| Characterization tests before change (Prompt 9/10) | 638 test files, golden PPTX, await-precedence, inventory | IMPROVE (strict coverage, criticality class) | N5 |
| Integrations SDP / OpManager / Meraki (Prompt 8) | registry jobs, D-06 Meraki kept, Meridian dormant | RETAIN (D-06/D-07); qualification = human | C20, C24 |
| Microservices | none | do NOT introduce (vision: "not by default") | — |

## (e) Goals for plan F

### /goal — SDP360 / F-ARCH-01 Skipped sync ≠ successful collection (E04)
- **Problem**: C1-C3, N2, N3. An unconfigured source reads FRESH on `/api/sync/health`, the publication gate and dashboards; watermark advanced; drift fed with fake 0-row runs.
- **Change**: `services/sync/jobs.js` `legacyJob.fetch` returns `{ skipped: true, reason }` (no rows, **no** `nextWatermark`) when `summary.skipped` is truthy (string reasons kept: `'disarmed'`, `'no_channels'`, …). `services/sync/syncRunner.js`: on `fetched.skipped` → `finishRun({status:'skipped', rows:null, error:null})` + meta reason, **no** `setWatermark`, `onEvent('sync_skipped', …)`, return `{status:'skipped', reason}`. `services/sync/syncStore.js` `health()` adds `last_skipped` + last skip reason; `lastSuccessfulRun`/`recentOkRuns` stay `status='ok'` (so gate/drift ignore skips automatically). `routes/sync.js`: `status = 'not_configured'` when `last_skipped` is newer than `last_ok` (optional jobs) / `'skipped'` for mandatory ones; `last_ok` = last real collection. `db/postgres/sync/001_init.sql` comment only (status is TEXT). A real complete collection with 0 rows stays `ok` (or `error` under `failOnZero`) — distinct from skip.
- **Switch**: none — defect fix (null must not read green).
- **Acceptance tests**: new `tests/sync-skip-semantics.test.js` (skipped job keeps prior `last_ok` and watermark; failure path; complete zero-row run = ok and distinguishable; `publishGate.freshness(['wan'])` → UNKNOWN when only skips exist); update `tests/sync-jobs-registry.test.js:124-125` (expect `'skipped'`); `tests/sync-routes.smoke.test.js` (health shows `not_configured`); `tests/sync-drift.test.js` (skips excluded); align W2-QJ `tests/jobs-meraki-skip.test.js`, `tests/jobs-engagement.test.js`.
- **Guardrails**: never invent a date; never turn UNKNOWN into FRESH; no change to Zoho legacy `sync_metadata`; alerts: optional + never-collected stays silent, mandatory skip is visible.
- **Size** S · **Priority** P0 · **Deps**: merge after or together with W2-QJ (edit its two tests in the same change) · **AGENT-DOABLE yes**.

### /goal — SDP360 / F-ARCH-02 Close `/api/sample/:viewId` (PII + DoS)
- **Problem**: N1.
- **Change**: `server.js:4428` — require `super_admin` (`_requireSuperAdminInline`), route the call through `fetchView` (PII strip) or apply `stripPiiColumns`, drop `rawPreview`, cap the response; add to AUTHZ-MATRIX generator. Option for the owner: retire the route (no caller) — default of this goal = restrict.
- **Switch**: none (security defect fix).
- **Tests**: `tests/api-sample-guard.smoke.test.js` (viewer/admin 403, super_admin 200 with stubbed Analytics returning an `Email`/`Phone` column → absent from the body; no `rawPreview`); `authz-route-matrix` regenerated.
- **Guardrails**: no new connector; no secret in logs. **Size** S · **P0** · **Deps** none · **AGENT-DOABLE yes**.

### /goal — SDP360 / F-ARCH-03 Runtime provenance: artifact vs source (E01)
- **Problem**: C9, N4.
- **Change**: `routes/health.js` — keep the 4 existing keys for every session; add for the admin tier `provenance: { source: { version, commit|null, commit_source:'git'|'none' }, artifact: { version, commit, built_at, manifest_sha256, signed, key_id, signature_verified: true|false|null } | null, sbom: { present, sha256 } | null, consistent: true|false|null }` from the installed `manifest.json` (reuse `services/updatePackage` verify + `tools/manifest-public.pem`, computed once at boot). `server.js:636` passes a `getProvenance`. Boot log line with the same identity. `tools/deploy/make-update-package.js` + `release.yml`: generate the SBOM **before** packaging and ship `sbom.cdx.json` listed in the manifest. `tools/installer/Manage-SDP.ps1` status prints the same block.
- **Switch**: none (additive, admin-only detail); `null` = UNKNOWN, never a guessed SHA.
- **Tests**: `tests/health-version-provenance.test.js` (no manifest → artifact null; signed/unsigned/tampered manifest → signed/verified flags; version mismatch → consistent false); update `tests/health-version.smoke.test.js:32` (non-admin keys unchanged); `tests/update-package.test.js` (SBOM listed in manifest); `tests/sbom.test.js`.
- **Guardrails**: no host/path/secret in the response; do not claim "signed" without verification. **Size** M · **P0** · **AGENT-DOABLE yes** (key ceremony itself is human, F-ARCH-10).

### /goal — SDP360 / F-ARCH-04 Portfolio access parity matrix + revocation proof (E02)
- **Problem**: C5, C6 — code guards exist, proof does not cover exports/report/links/revocation with the switch on.
- **Change**: tests + a generated expected/observed document only; product code changes only if a test exposes a leak (then fix in `routes/governance.js` via `viewFor`/`readableProject`).
- **Switch**: none added; tests toggle `portfolio_site_scope_reads` / `portfolio_editor_plan_writes` in the throwaway DB only.
- **Tests**: `tests/portfolio-access-parity.smoke.test.js` — personas: editor A, editor B, multi-site A+B, viewer A, finance-viewer A, owner-by-text, committee; projects: site A, site B, A+extra B, group-level; surfaces: list ids, summary counts, detail, history, baselines, exceptions, deck.pptx rows, workbook.xlsx rows, report.html, my-work benefit reviews; assert same visible set across all surfaces, 404 (not 403) for hidden ids, money stripped per role; mid-session revocation (extra site removed, finance-viewer removed) effective next request. Generator `tools/agent/portfolio-access-matrix.js --check` → `docs/ops/PORTFOLIO-ACCESS-MATRIX.md`.
- **Guardrails**: switches stay `'0'` by default; no arming. **Size** M · **P0** · **Deps** W2-PPM (benefits/baselines paths) merged · **AGENT-DOABLE yes**.

### /goal — SDP360 / F-ARCH-05 Full-service restore drill (files + keys + timing) (E05)
- **Problem**: C13, N6.
- **Change**: `services/restoreDrill.js` + `tools/pg/restore-drill.js --full`: after the DB comparison, verify a sample/hash list of the blob store and field uploads against the backup copy, check that `SDP_BACKUP_KEY` decrypts the dump and `SDP_CONFIG_KEY` decrypts one encrypted config secret (never printing values), record `durationMs` against `report_config.restore_rto_minutes` (empty = UNKNOWN target, never "met"). Report section in `docs/ops/restore-drills/<date>.md`.
- **Switch**: `restore_drill_full` default `'0'` (monthly job unchanged).
- **Tests**: `tests/restore-drill-full.test.js` (pure: missing key → failed step; empty RTO → UNKNOWN; blob mismatch → exit 1); `tests/restore-drill.test.js` unchanged.
- **Guardrails**: disposable target only; nothing on a command line. **Size** M · **P1** · **AGENT-DOABLE yes** (RTO/RPO values and EXE environment = human).

### /goal — SDP360 / F-ARCH-06 CSP per journey: report-only inventory → configurable enforcement
- **Problem**: C15.
- **Change**: `tools/security/csp-journey-report.js` groups `csp_violation` system_log rows + INVENTORY inline-script pages by journey (`docs/ops/PERSONA-JOURNEYS.md`) → `docs/security/CSP-JOURNEYS.md` (`--check`). `services/sessionAuth.isStrictCspPath` also honours `report_config.csp_strict_pages` (comma list, default `''` = today) so a page whose inline scripts are extracted (E-A02) can be enforced without a deploy.
- **Tests**: `tests/csp-strict-pages-config.test.js` (listed page gets nonce-only `script-src`, unlisted unchanged); `tests/csp-journey-report.test.js`.
- **Guardrails**: report-only first; never widen script origins. **Size** M · **P1** · **Deps** E-A02 · **AGENT-DOABLE yes**.

### /goal — SDP360 / F-ARCH-07 Execute the dependency lots (Dependabot, 11 branches)
- **Problem**: C16; triage exists (`DEPS-TRIAGE.md`) but nothing executed.
- **Change**: lot 1 (safe: nodemailer 10.3.1, playwright 1.64.1 with runner-pin check, codeql-action 4 with SHA pin) one commit per bump; lot 2 (actions upload/download/setup-node together; gh-release 3); then one goal branch per major (dotenv 18, eslint 10, express 5 — path-to-regexp/`req.query`/async errors, pptxgenjs 4 — golden re-proof). Update `DEPS-TRIAGE.md` with results.
- **Tests**: per row of DEPS-TRIAGE.md (`npm test`, `pptx-monthly-golden`, `authz-route-matrix`, `ci-config`, e2e journeys).
- **Guardrails**: no merge without human review; golden never regenerated to get green. **Size** M (lots) / L (express 5) · **P1** · **AGENT-DOABLE yes** (prepare branches; merge = human).

### /goal — SDP360 / F-ARCH-08 Strict coverage signal + criticality class
- **Problem**: C14, N5 — two heuristics disagree (35/1 vs 76/10).
- **Change**: `tools/agent/inventory.js --strict` (path regex with params, quoted job names) and a criticality column (access, finance/money, export, audit/retention, destructive write) from route metadata; seed tests for the N5 writes not covered by E-Q03.
- **Tests**: `tests/inventory-strict.test.js`; new smokes `tests/report-helpdesk-write.smoke.test.js`, `tests/departments-routes.smoke.test.js`, `tests/roadmap-writes.smoke.test.js`, `tests/risk-register-alias-delete.smoke.test.js`, `tests/meetings-lookups-writes.smoke.test.js`.
- **Size** M · **P1** · **Deps** E-Q03 merged · **AGENT-DOABLE yes**.

### /goal — SDP360 / F-ARCH-09 `/ready` reflects runner jobs
- **Problem**: N7. **Change**: `routes/health.js` `/ready` also reads the newest `ok` `finished_at` from `sync_runs` (same response shape `{ok, db, last_job_at}`). **Tests**: `tests/ready-probe.smoke.test.js`. **Size** S · **P2** · **AGENT-DOABLE yes**.

### /goal — SDP360 / F-ARCH-10 Release policy: refuse unsigned public releases (decision-gated)
- **Problem**: C11 — `release.yml` builds and publishes even when unsigned.
- **Change**: workflow input/var `REQUIRE_SIGNED` (default `false` = today); when `true`, the release job fails if the manifest or Setup.exe is unsigned. `tests/ci-config.test.js` asserts the guard.
- **Size** S · **P2** · **AGENT-DOABLE no** (default and key ceremony are a release-owner decision; code is trivial once decided).

Execution order: F-ARCH-02 → F-ARCH-01 (with W2-QJ) → F-ARCH-03 / F-ARCH-04 in parallel → F-ARCH-05, 08, 06, 07 → 09.

## (f) Decisions that belong to people

| Decision | Owner role | Unblocks |
|---|---|---|
| Arm `portfolio_site_scope_reads` / `portfolio_editor_plan_writes`; rule for group-level projects and free-text owner access | IAM owner + PMO | E02 go-live (F-ARCH-04 gives the evidence) |
| Is change/CAB and `/api/data/*` fleet-readable by every session? | Security officer + Change manager | N8 |
| Retire vs restrict `/api/sample/:viewId` | Platform owner | F-ARCH-02 option |
| Signing key ceremony (Ed25519 manifest, Authenticode certificate), `REQUIRE_SIGNED` default | Release manager + Security officer | F-ARCH-10, distribution |
| RTO/RPO targets, escrow of `SDP_BACKUP_KEY` / `SDP_CONFIG_KEY`, dedicated EXE qualification environment | Operations owner | F-ARCH-05, E05 |
| Meraki scoped key, Zoho secret rotation, read-only qualification of SDP Cloud | Integration owners | E04 live qualification |
| Timing of majors (express 5, pptxgenjs 4) vs reporting cycle | Architecture board + Reporting owner | F-ARCH-07 |
| Whether a "not configured" source is shown as such on published/public views | Product owner | F-ARCH-01 wording |
| Provide the review.1 artifact (manifest, ZIP, migrations 078/079, write-fence code) for comparison | Requester / test-machine owner | C8, C10, C12, C22 |
