# Cross-check 3 — expert audit of 5 Nov 2026 (rev. d38fa41), chantiers F · A · Q · B + §7 + §8

Checked against the code of `goal/xa` at **d38fa41** (read-only). Ids from the audit are always prefixed
**"audit"** (`audit F-01` …) because this repository already uses `A-xx` / `B-xx` / `C-xx` / `D-xx` for its own
goals. Line numbers are those of d38fa41 and drift: locate by content.

Classes: **DONE** (delivered, proof cited) · **BUILD** (agent work now, sandbox, reversible) · **BUILD-SHADOW**
(behaviour change behind a `report_config` switch whose default is today + a PILOT-PROFILE row, never claimed
approved) · **HUMAN** (a real person or authority; what an agent can prepare is listed as a BUILD item) ·
**OUT** (outside the project boundaries). Nothing in this file approves, signs or accepts anything.

---

## (a) Action-by-action verdict

### Chantier F — Mobile, field, offline

| Audit action | Claim verdict | Class | Proof / notes |
|---|---|---|---|
| audit F-01 Real-phone acceptance (≥2 device profiles, network cut/resume, user switch, signed PV) | **ACCURATE.** All field evidence is Playwright at 390 px with simulated network (`docs/agent-execution/G19.md` "Browser evidence … not a real device"; `tests/e2e/t3-field-inspection.spec.js:26` `ctx.setOffline(true)` only). | **HUMAN** (site IT + field QA) · prep = **BUILD** E-F04 | Our G24 dossier gate 6 (UAT) and RELEASE-GATES row "Pilot sites D-05 and field UAT". Agent can prepare the French device protocol, checklist, result sheet and an unsigned PV template. |
| audit F-02 Storage-full cases (quota, heavy photos, restart, cleanup, no silent loss) | **PARTLY OUTDATED.** Quota handling was built after the reference review: `public/field/storage.js` (persist request, usage warning > 70 %, `isQuotaError` incl. Firefox/legacy codes), `app.js` `tx()` rejects on abort, failed write keeps the form ("NOT saved…"), tested in `tests/field-storage-guard.test.js` + real-Chromium `tests/field-storage-browser.test.js` (B-06, commit 062e093). Photo cap ≤ 300 KB after compression (`app.js:217-228`). **Not covered**: reload/restart *after* a quota failure, heavy-photo sequence until full, real Android/iOS eviction behaviour. | **DONE** (core) + **BUILD** E-F02 (restart/heavy sequence in browser) + **HUMAN** (real device) | `docs/agent-execution/B-06.md` "Left for a person". |
| audit F-03 Tooling to resolve stuck envelopes (status/replay/idempotence, diagnostics, authorised recovery, no double apply) | **ACCURATE.** Idempotent claim exists (`services/fieldStore.js:43-49`, never re-claims `ticket`/`action`), but **no admin surface**: `outboxStats()` (`fieldStore.js:56`) has **no caller** in routes/server; the only field routes are user-scoped (`routes/field.js:75-243`). G19 lists "an admin action to resolve an entry stuck in `applying` — PO" as open. | **BUILD** (diagnostic, ON) + **BUILD-SHADOW** (resolve action, switch `field_outbox_resolve_enabled`='0') → E-F01 | See X-F-01/02/03. |
| audit F-04 Send queue on constrained networks (loss, resume, delay, 401, 409, images, multiple sessions, understandable progress) | **PARTLY.** Logic exists and is unit-tested (`tests/field-no-silent-loss.test.js`, `field-routes.smoke`, `pg-field-store`): 401 stops sync and keeps entries, 409 in-progress retries, author binding (`routes/field.js:177-178`), per-entry error isolation. But **no CI test** of latency, flapping links, captive-portal HTML answer, 401 mid-photo-upload or two users on one phone: G19 says "the browser harness is not in CI" and "a route-level test with a slow or throwing apply stub" is not done. | **BUILD** E-F02 | VSAT reality itself = HUMAN (E-F04 protocol). |
| audit F-05 Simpler field entry and proof (sequenced tasks, compressed photo, visible queue, summary, explicit refusal, measured task time) | **PARTLY.** Compressed photo, visible queue states, explicit refusal with reason, double-tap guard already exist (G19 table, `app.js:122-172,217`). **Missing**: a summary/review step before queueing and any measurement of task time (no timing anywhere in `public/field/app.js`). | **BUILD-SHADOW** E-F03 (`field_task_timing`='0', `field_review_step`='0') | Measured time feeds `pilotMetrics`; targets are set only after a baseline (PILOT-MEASUREMENT.md:60). |

### Chantier A — Architecture, performance, debt

| Audit action | Claim verdict | Class | Proof / notes |
|---|---|---|---|
| audit A-01 Extract domains from server.js (~7 910 lines, 231 routes) | **ACCURATE.** `server.js` = **7 908 lines**, budget **7 910** (`tests/server-size-budget.test.js:9`) → **2 lines of headroom**; INVENTORY.md: 231 routes in server.js of 593. 37 route modules already extracted (`routes/`). | **BUILD** E-A01 (survey routes), E-A01b (tracker routes) | Sequencing constraint for every other goal (X-A-01). |
| audit A-02 Decompose monolithic pages (reports.html ~8 936, executive.html ~11 010) | **ACCURATE** (8 935 / 11 009 lines; reports.html has 20 `<script>` blocks; executive-report.html 8 634). | **BUILD** E-A02 (one bounded extraction per goal) | Screenshot tests: only viewport/DOM journeys exist (`tests/e2e/v1-viewport-layout.spec.js`). |
| audit A-03 Versioned API contracts (schemas, structured errors, pagination, compat) | **PARTLY.** The external API is versioned (`routes/extApi.js:10-12` `/ext/v1/…`, scopes, quota). Internal APIs have no schema validation; **389** error responses bypass `services/httpError.fail` (118 `res.status(4xx).json` in server.js, 271 in routes/) — shape is mostly `{error}` but no code/correlation id (X-Q-05). | **BUILD** E-A03 (contract + error-shape tests; no behaviour change) | No new dependency (hand-written schema checker). |
| audit A-04 Performance budgets (p95 per journey, traces, plans, CI thresholds) | **ACCURATE.** No budget exists; C-05 records "budget de performance non fixé" (G24 §2.1). e2e harness already records DCL/load/bytes per page (`docs/agent-execution/B-05.md`). | **BUILD** E-A04 (measured baseline, report-only) + **HUMAN** (who approves a budget) | Thresholds are a decision: the tool prints them as UNKNOWN until approved. |
| audit A-05 PostgreSQL index & plan review (EXPLAIN ANALYZE, vacuum, capacity alert) | **ACCURATE.** Only rehearsal timings on 100 000 synthetic tickets (`docs/agent-execution/G04.md`); no `EXPLAIN` anywhere in `tools/` or `tests/`. | **BUILD** E-A05 (synthetic EXPLAIN report, no index created) + **HUMAN** DBA (real plans, `pg_stat_statements`, vacuum policy) | |
| audit A-06 Remove duplicated browser KPI maths | **ACCURATE.** EXEC-PAGES-MATRIX.md:28 "same doctrine … different code paths"; Scorecard computes in the browser (`public/lib/dashboard-shared.js`). Partial mitigation: `kpi-change-parity`/`sla-definition-parity` tests; P1 decision moves Scorecard out of the menu (`ui_exec_nav`). | **BUILD** E-A06 (parity tests per remaining Scorecard KPI) · removal of client formulas later, behind `ui_exec_nav` | |
| audit A-07 Audited, legible activation settings (who/what/why/date/rollback, before/after) | **ACCURATE.** FLAG-REGISTER.md has **194** "to be named" owners. `PUT /api/reports/config` journals **only outbound URL keys** (`routes/adminConfig.js:38-53`); a change of `kpi_policy_enforced`, `site_code_shared_block`, `notifications_stop`… leaves no system_log row; `report_config` keeps only the last `updated_by` (`services/reportConfig.js:373`). | **BUILD** E-A07 (journal every change, history read, prerequisite warnings) + **HUMAN** (naming owners) | Defect-class (audit trail) → ships ON. |

### Chantier Q — Tests, SDLC, operations

| Audit action | Claim verdict | Class | Proof / notes |
|---|---|---|---|
| audit Q-01 Lift the 11 skipped tests | **ACCURATE.** `tests/.skip-allowlist.json`: 10 × "no prod-snapshot" (`tests/review-data.test.js`, `tests/site-window-readers.test.js`), 1 × python (`tests/exec-pptx-python.test.js:33`). CI never installs Python (`.github/workflows/ci.yml` has no setup-python/pip). | **BUILD** E-Q01 (CI Python → lifts 1) + **BUILD** E-Q02 (anonymiser tool, run by the data owner) + **HUMAN** (data owner approves an anonymised snapshot) | X-Q-04: the skipped one guards the production Group IT deck renderer. |
| audit Q-02 Restore/rollback on TEST infra (journal, RPO/RTO, CAB/SRE visa) | **ACCURATE** (only CI/local rehearsals: `docs/ops/rehearsals/*`, `docs/ops/restore-drills/2026-10-21.md`). Operator path ready: `docs/ops/pilot/TEST-INSTANCE.md`, `tools/pg/restore-drill.js`, `restore-rehearsal.js`. | **HUMAN** (operator + CAB) — prep **DONE** | G24 gate 5. No agent action left beyond keeping the runbook current. |
| audit Q-03 Route and job proof (76 routes, 10 jobs without test reference) | **ACCURATE** (INVENTORY.md:15,18). Every route is probed for authz by `tools/qa/route-matrix.js` (anonymous / dash-key / viewer), so the gap is behaviour, not authz. Notable untested: `POST /api/tracker/delete-year` (X-Q-01), `/api/meetings/reset`, `/api/cache/clear`, `/api/admin/backup-now`, `/api/reports/auth/change-password`, jobs `reports.weekly`/`reports.monthly` (X-Q-03), `engagement.*`, `meraki.wan_*`, `publish.connectors`. | **BUILD** E-Q03 (+ E-A01/E-A01b cover survey + tracker routes) | |
| audit Q-04 Load, soak, resilience on staging | **ACCURATE** (G21.md:9 "needs an authorised staging host — RL-06"). No load tool in the repo. | **BUILD** E-Q04 (harness + local observation) + **HUMAN** (authorised staging run) | |
| audit Q-05 Dependency updates (Dependabot PRs: Express, CI, Playwright, lint, PPTX) | **PARTLY OUTDATED.** Already classified in SEC-01 (G24 gate 4: nodemailer, playwright, codeql safe; express 5, eslint 10, pptxgenjs 4 not safe as is); CI runs `npm audit --omit=dev --audit-level=high` (`ci.yml:51-52`); `.github/dependabot.yml` exists. Missing: per-PR changelog/E2E/rollback record. | **HUMAN** (merge) + **BUILD** E-Q05 (triage ledger + guard for the CDN-sourced `xlsx`, X-Q-02) | |
| audit Q-06 Sign installers and artefacts | **PARTLY OUTDATED.** Ed25519 signed update manifest with refusal of a modified byte is built and tested (`tests/update-package-signature.test.js`, `tools/manifest-public.pem`); Authenticode signing wired in `release.yml:139` when cert secrets exist. Open: key/cert ceremony. | **DONE** (mechanism) + **HUMAN** (key ceremony, certificate purchase) | G24 gate (RELEASE-GATES "Signing key … D-12"). |
| audit Q-07 Observability & SLO per service | **PARTLY.** Exists: `GET /api/sync/health` (per-job last ok/error, `routes/sync.js:26`), freshness hours per job (`services/sync/jobs.js:206`), `/api/health/{version,views,restore-drill}` (`routes/health.js`), `/api/ping` (no dependency check, `server.js:2166`). Missing: one dependency-health view (PG, Zoho token, SMTP configured, backup age, disk) and any SLO. | **BUILD** E-Q07 (deps health, UNKNOWN never green) + **BUILD-SHADOW/HUMAN** (SLO values proposed only) | |
| audit Q-08 Delivery-quality observatory | **ACCURATE** (nothing computes release failure / rollback / escaped bugs). Part of it needs real deployments (HUMAN data). | **BUILD** E-Q08 (generator from git + ledgers; prod-only fields UNKNOWN) | Low priority. |

### Chantier B — Product, adoption, ethics, value

| Audit action | Claim verdict | Class | Proof / notes |
|---|---|---|---|
| audit B-01 GO/NO-GO approvals | **ACCURATE.** `docs/sdp360/completion/RELEASE-GATES.md` all cells empty by design; G24 = NO-GO, 18 human gates. | **HUMAN** — prep **DONE** (dossier, gates, evidence manifest) | Agents must never fill a cell. |
| audit B-02 Pilot on 1–2 sites with measurable hypotheses | **ACCURATE** on outcome; kit **DONE**: `docs/ops/pilot/{PILOT-PROFILE,PILOT-MEASUREMENT,SUS-FORM}.md`, `T1-T8-SHEET.csv`, `WEEKLY-REPORT-STOPWATCH.csv`, read-only `tools/pilot/pilot-metrics.js`. | **HUMAN** (run it) | Stop/continue rules: PILOT-MEASUREMENT.md says targets only after baseline + sponsor. |
| audit B-03 Value table | **ACCURATE** (TCO-TEMPLATE.csv empty; G24 §7 "Bénéfices métier : non mesurés"). The audit §9 indicators are not mapped to any collector. | **BUILD** E-B03 (value table generator, UNKNOWN where no source) + **HUMAN** (Finance/BRM baseline and validation) | |
| audit B-04 Connector boundaries | **MOSTLY DONE.** `CONNECTOR-REGISTER.csv` (13 rows, status/owner/jobs) + automatic guard `tests/connector-register.test.js` (every outbound-calling file registered; excluded hosts Pronto/Nutanix/backup/Defender/PPM refused). Open: data-minimisation and compliance review. | **DONE** (register + test) + **HUMAN** (RSSI compliance review) | Any new connector request = **OUT** unless already supported. |
| audit B-05 Product and data ownership (RACI, decision SLA, stewards, committee) | **ACCURATE.** Only role names exist ("to be named" ×194 in FLAG-REGISTER; PO delegated decisions are explicitly not signatures). | **HUMAN** + **BUILD** E-B05 (RACI/steward template derived from flags, metrics, connectors) | |
| audit B-06 Redistribution rights and content | **ACCURATE.** `RIGHTS-REGISTER.md` "Nothing here grants a right … internal use only"; LICENCE-INVENTORY generated + CI guard. | **HUMAN** (Legal/procurement) — prep **DONE** | No agent work beyond keeping the inventory generated. |
| audit B-07 Product feedback mechanism | **ACCURATE.** No feedback route/table/widget (grep of routes/services: none; only "feedback" words in pages/help). | **BUILD-SHADOW** E-B07 (`ui_feedback_enabled`='0') | Needs a migration (number allocated by the plan owner) and a mount line in server.js → after E-A01. |
| audit B-08 Frame AI commentary (conditional drafting, sourced numbers, human control, masking, no run on stale data, log) | **PARTLY OUTDATED.** Done: `services/aiCommentary.js` (numbers checked against the canonical list, deterministic fallback, cloud anonymisation, plain-language gate), `services/aiSanitize.js` (PII + injection), Report Studio regeneration returns a reviewed run to draft and logs it (`routes/reportStudio.js:153`), publication blocked on stale sources (`reportStudio.js:126-128`), provider off by default. **Gaps**: generation itself is not refused on stale data (X-B-02); the deck-builder `/api/ai/analyze` path has no server-side number verification (X-B-01). | **DONE** (core) + **BUILD-SHADOW** E-B08 (`ai_commentary_stale_block`='0') | |

**Counts (36 lines: 5 F + 7 A + 8 Q + 8 B + §7 + §8).** Primary class per audit action (an action may also carry a
secondary HUMAN gate):

| Class | Audit actions (primary) |
|---|---|
| DONE | 5 — audit Q-06, B-04 (mechanism/register), B-08 core, F-02 core, Q-02 prep¹ |
| BUILD | 15 — F-04, A-01, A-02, A-03, A-04, A-05, A-06, A-07, Q-01, Q-03, Q-04, Q-05², Q-07, Q-08, B-03 |
| BUILD-SHADOW | 4 — F-03 (resolve action), F-05, B-07, B-08 (stale gate) |
| HUMAN | 6 — F-01, Q-02, B-01, B-02, B-05, B-06 |
| OUT | 0 (none of the 28 asks a forbidden connector; any future "connect Defender/Pronto/PPM" under audit B-04 would be OUT) |

¹ Q-02 counted HUMAN in the row above; listed here because nothing is left for an agent. ² Q-05 merge itself is HUMAN.
By number of distinct items including secondary gates: DONE 6 · BUILD 15 · BUILD-SHADOW 4 · HUMAN 15 (incl.
secondary human parts of F-02, A-04, A-05, A-07, Q-01, Q-04, Q-05, Q-06, B-03) · OUT 0.

### §7 Ordering and dependencies — cross-check

| Audit statement | Verdict | Evidence / comment |
|---|---|---|
| Wave 0 (exposure reduction: rotation, site identity, IAM, KPI doctrine) before the pilot | **AGREES** with G24 §8 step 1 (gate 1 rotation "préalable à tout pilote") and gates 9-11. | — |
| Wave 1 puts audit Q-01, Q-02, F-01, B-01, B-02 together | **AGREES**, with one correction: audit **B-01 cannot be in Wave 1 as a full GO** — G24 §8 makes the production GO/NO-GO the *end* of the pilot (new dossier after 4 weeks). In Wave 1 only a **TEST** go/no-go is meaningful. | G24 §8 step 4. |
| Wave 4 puts audit A-01…A-07 last | **PARTLY DISAGREE.** audit **A-01 must start before any Wave 2/3 code** that adds a route mount: server.js has **2 lines** of budget left (X-A-01). audit **A-07** (config journal) is a precondition of the §7.1 rules themselves ("history and rollback"), so it belongs in Wave 0/1. | `tests/server-size-budget.test.js:9`; `routes/adminConfig.js:38-53`. |
| §7.1 `site_code_shared_block` only after code ownership decided | **ACCURATE / ENFORCED BY DEFAULT** — key `'0'` (`services/reportConfig.js:205`); G24 gate 9. | |
| §7.1 `kpi_policy_enforced` only after committee + shadow comparison | **ACCURATE**; partial technical guard: when on without an adopted policy, screens keep today's rule (`routes/kpiPolicies.js:85`). Nothing records that a shadow comparison was read before switching (X-A-04). | |
| §7.1 outbound notifications only after sender/recipient list, simulation, stop switch | **ACCURATE / BUILT**: `alert_external_enabled`='0', global STOP `notifications_stop` (`reportConfig.js:223`, `services/reportCatalogue.js:105`), `handoff_notify_enabled`='0', dry runs per catalogue. | |
| §7.1 `enforce` authz model only after shadow gaps resolved + negative API tests | **ACCURATE**; enforce is not even wired (`reportConfig.js:263` "enforce is NOT wired yet"), `authz_capability_mode`='off'. | G24 §7 (C-17). |
| §7.1 historical roadmap not replaced before data comparison, redirects, PO/CAB | **ACCURATE**; PPM governance switches all `'0'` (`reportConfig.js:194-203`). | |
| §7.1 no "market-ready" claim on tests alone | **ACCURATE**; RIGHTS-REGISTER internal-use-only. | |
| Missing dependency | **X-§7-01**: E-F01's resolve action must not be enabled before audit F-01 device sessions show how often entries get stuck (otherwise an admin repair tool becomes the normal path). **X-§7-02**: audit B-07 feedback must not open before B-05 names who answers (otherwise feedback with no response violates the audit's own criterion "réponse au demandeur"). | — |

### §8 Acceptance conditions — mapping to our gates

| Audit gate | Our human gates (G24 §6) / RELEASE-GATES row | Gap |
|---|---|---|
| Sécurité (rotation, IAM/roles/shares review, pentest or accepted analysis) | gates 1, 2, 14; RELEASE-GATES Security ×2, Signing key | **Pentest is not a named gate in G24** (only "penetration test (human, external)" in G21.md:9) → add it explicitly. |
| Données (site uniqueness, multi-site reconciliation, currency, calendar, anomalies, KPI approved) | gates 8, 9, 10, 11, 12, 13; RELEASE-GATES KPI + Data owner | none |
| Exploitation (TEST install, restore, rollback, RPO/RTO, capacity, runbook) | gate 5; RELEASE-GATES Backup/restore | **Capacity** (audit Q-04 / A-05) has no gate row. |
| Qualité (green CI on target SHA, skips handled, critical journeys) | RELEASE-GATES has no QA-lead row; G24 §4 is agent evidence | **No QA-lead signature row** — add one; skips need a recorded "accepted residual risk" by the data owner (audit Q-01). |
| UX & accessibilité (real journeys per role, francophone readership, keyboard + screen reader) | gates 6, 7, 17 | none (keyboard is code-tested by `t8`, still needs a person). |
| Métier / projet (pilot project and business case signed, observed benefit) | gate 6 partly; RELEASE-GATES "Product — business acceptance", Finance | **No PMO/project-witness row**. |
| Conformité légale | RELEASE-GATES Legal/commercial | none |
| GO production (decision register with name, date, scope, condition, version) | gate 18; RELEASE-GATES last row | RELEASE-GATES has name/date/evidence but **no "version/SHA" and "conditions" columns** → E-B05 adds the columns (empty). |

### §8.1 Minimal user-test protocol — cross-check with what exists

| Protocol line | Existing support (automated, **not** acceptance) | Gap |
|---|---|---|
| Site IT coordinator: open report, correct data, submit, read the decision without the developer | `tests/e2e/t2-weekly-report.spec.js`; T1–T8 sheet | "read the decision" (reviewer verdict back to the coordinator) not journeyed. |
| Technician: photo offline, user switch, resume, rejection, check queue | `t3` (offline + 1 photo only) | user switch, rejection, 401, queue check → E-F02. |
| Group IT manager: worst gap, origin, assign action, measure status | `u4-executive-worst-site` (worst site), `t1` (close action) | "assign action from the worst gap" chained flow not journeyed → E-Q09. |
| Direction/Finance: service state and amounts, not measured ≠ zero ≠ not certified | `u2`, `u5`; money certification `D-06` | a Finance journey reading `certified:false` is not journeyed → E-Q09. |
| PMO/business: demand → project, capacity conflict, benefit check | none in `tests/e2e/` | → E-Q09 (capacity behind `capacity_enabled` planned). |
| RSSI/admin: refuse cross-site, remove a role, produce proof, emergency request | `deny-cross-site`, `i1`…`i7` (incl. `i5-emergency-access`) | "produce the proof" (security log export) — PERSONA-JOURNEYS lists super_admin security-log reading as not covered (G24 §7). |
| Francophone + screen reader | `t7-french-help`, `u1-multisite-french`, `chart-a11y` static | screen reader = human only (gate 7). |

---

## (b) Findings the audit missed

| Id | Finding | Evidence | Severity | Goal |
|---|---|---|---|---|
| X-F-01 | `purgeOutbox` deletes ledger rows **of every status** older than 90 days — including `applying` tickets whose SDP outcome is unknown and `failed` rows — so the only server trace of an unresolved entry disappears silently. | `services/fieldStore.js:61`; job `field.purge` `services/sync/jobs.js:149` | P2 | E-F01 |
| X-F-02 | `outboxStats()` ("sync health for the admin") has **no caller**: the admin cannot see stuck or failed field entries at all. | `services/fieldStore.js:55-60`; no use in `routes/` or `server.js` | P2 | E-F01 |
| X-F-03 | An entry stuck in `applying` for kinds `ticket`/`action` is never re-claimed (by design) → the phone gets 409 for ever and marks it `needs_review` after 15 min (`app.js:18,172`); only a manual SQL edit ends it. | `fieldStore.js:43-46`; `public/field/app.js:172` | P2 | E-F01 |
| X-F-04 | The 401 / refusal / resend browser evidence of G19 was a one-off run; CI's field journey (`t3`) only covers offline→online. | G19.md "the browser harness is not in CI"; `tests/e2e/t3-field-inspection.spec.js` | P2 | E-F02 |
| X-A-01 | `server.js` is at **7 908 / 7 910** lines. Any goal that adds even one mount line fails `tests/server-size-budget.test.js`, so extraction is a **prerequisite**, not Wave 4. | `tests/server-size-budget.test.js:9` | P1 (planning) | E-A01 first |
| X-A-02 | Config changes are journalled for URL keys only; every behaviour switch (incl. the §7.1 ones) changes without a system_log row; `report_config` keeps one `updated_by`. | `routes/adminConfig.js:38-53,100-104`; `services/reportConfig.js:373` | P1 | E-A07 |
| X-A-03 | 194 of the register's rows have owner "to be named" — the audit says "nombreux"; the number matters for B-05 sizing. | `docs/ops/FLAG-REGISTER.md` | info | E-B05 |
| X-A-04 | The §7.1 prerequisites live only in prose; neither Admin ▸ Config nor `tools/reports/set-ui-policy.js` warns when a prerequisite (e.g. TND owner for `site_code_shared_block`) is not recorded. | `tools/reports/set-ui-policy.js:22-28` | P2 | E-A07 |
| X-Q-01 | `POST /api/tracker/delete-year` on PostgreSQL (the only backend) hard-deletes a whole year by FK cascade with **no snapshot** (`backup_path: null`, `backupDatabase()` is a no-op), **no system_log row** (console only) and **no test**. | `tracker-db.js:468-491,590-595`; `server.js:7684-7700`; INVENTORY.md "Routes without a test reference" | P1 | E-A01b |
| X-Q-02 | `xlsx` comes from `cdn.sheetjs.com` (pinned with integrity in the lockfile) — outside npm's advisory database and Dependabot, so `npm audit` in CI says nothing about it. | `package.json:26`; `package-lock.json` `node_modules/xlsx` | P3 | E-Q05 |
| X-Q-03 | Jobs `reports.weekly` and `reports.monthly` (the scheduled sends that silently never ran for six weeks in Aug–Sep 2026) have **0** test references. | INVENTORY.md "Scheduled jobs"; `services/sync/jobs.js:144-145` | P1 | E-Q03 |
| X-Q-04 | The skipped Python test is the only CI check of the production Group IT deck renderer (`tools/exec-pptx/render.py`). | `tests/exec-pptx-python.test.js:8,33`; `ci.yml` has no Python | P2 | E-Q01 |
| X-Q-05 | 389 error responses bypass `httpError.fail` (no code, no correlation id) — relevant to audit A-03's "erreurs structurées". | grep `res.status(4..).json`: server.js 118, routes/ 271 | P3 | E-A03 (test + report, no rewrite) |
| X-B-01 | The deck builder's `POST /api/ai/analyze` sanitises PII but does **not** verify numbers server-side (grounding is prompt-only), unlike `aiCommentary.verifyNumbers`. Off by default (`AI_PROVIDER=off`). | `server.js:4848-4906,4994`; `services/aiCommentary.js:48` | P3 | E-B08 (step 2, after E-A01) |
| X-B-02 | AI commentary is **generated** even when sources are stale; only publication is gated. | `services/aiCommentary.js:61-86` vs `routes/reportStudio.js:126-128` | P3 | E-B08 |
| X-B-03 | No pentest gate, no QA-lead gate, no capacity gate and no SHA/conditions columns in RELEASE-GATES (see §8 table). | `docs/sdp360/completion/RELEASE-GATES.md` | P2 | E-B05 (doc rows, empty) |

---

## (c) Goals, dependencies and hot-spot files

| Id | Title | Size | Closes | Switch (default) | Main files | Depends on | Hot spots |
|---|---|---|---|---|---|---|---|
| E-A01 | Extract survey routes from server.js | M | audit A-01 (part), audit Q-03 (9 survey routes) | — | `server.js`, new `routes/survey.js`, `tests/server-size-budget.test.js` | — (**first**) | **server.js** |
| E-A01b | Extract tracker routes + make year deletion safe | M | audit A-01 (part), X-Q-01, audit Q-03 (tracker routes) | — (defect fix ON) | `server.js`, new `routes/tracker.js`, `tracker-db.js` | E-A01 | **server.js** |
| E-F01 | Field outbox: admin diagnostic, safe purge, authorised resolution | S | audit F-03, X-F-01, X-F-02, X-F-03 | `field_outbox_resolve_enabled` (`0`) | `services/fieldStore.js`, `routes/field.js`, `services/reportConfig.js`, new `tools/field/outbox-admin.js` | — | reportConfig.js (DEFAULTS, small) |
| E-F02 | Field queue on constrained networks — browser journeys in CI | M | audit F-04, audit F-02 (rest), X-F-04 | — (defects found fixed ON) | new `tests/e2e/f1-field-network.spec.js`, `tests/e2e/fixtures/browser.js`, `tests/field-routes.smoke.test.js`, `public/field/app.js` (defects only) | — | public/field/app.js |
| E-F03 | Field review step and task timing | M | audit F-05 | `field_review_step` (`0`), `field_task_timing` (`0`) | `public/field/app.js`, `public/field/i18n.js`, `routes/field.js`, `services/pilotMetrics.js`, `services/reportConfig.js` | E-F02, E-F01 | public/field/app.js, pilotMetrics.js |
| E-F04 | Real-device field acceptance kit (preparation only) | S | audit F-01 (prep), audit F-02 (human part) | — | new `docs/ops/pilot/FIELD-DEVICE-UAT.md`, `FIELD-DEVICE-SHEET.csv` | — | none |
| E-A02 | reports.html: extract one inline block into a module | M | audit A-02 (first slice) | — | `public/reports.html`, new `public/lib/reports-<block>.js` | — | **public/reports.html** |
| E-A03 | API contract and error-shape tests | S | audit A-03 (tests), X-Q-05 (report) | — | new `tests/api-contract-ext.test.js`, `tests/error-shape.test.js`, `docs/api/CONTRACTS.md` | — | none |
| E-A04 | Measured performance baseline (report-only) | S | audit A-04 (baseline) | — | new `tools/test/perf-baseline.js`, `tools/test/run-e2e.js` (summary hook), `docs/agent-execution/PERF-BASELINE.md` | — | none |
| E-A05 | EXPLAIN report on synthetic volumes | S | audit A-05 (prep) | — | new `tools/pg/explain-hot.js`, `docs/agent-execution/EXPLAIN-SYNTHETIC.md`, ADR for any index proposal | — | none |
| E-A06 | Scorecard ↔ registry parity tests | S | audit A-06 (tests) | — | new `tests/exec-scorecard-registry-parity.test.js` | — | none (reads executive.html helpers, no edit) |
| E-A07 | Journal every config change + switch prerequisites | S | audit A-07, X-A-02, X-A-04 | — (audit fix ON) | `routes/adminConfig.js`, new `services/switchPrereqs.js`, `tools/reports/set-ui-policy.js`, `tools/agent/flag-register.js` | — | FLAG-REGISTER.md (generated) |
| E-Q01 | Python in CI for the deck renderer test | S | audit Q-01 (1 of 11), X-Q-04 | — | `.github/workflows/ci.yml`, `tests/.skip-allowlist.json`, `tools/exec-pptx/requirements.txt` | — | ci.yml |
| E-Q02 | Snapshot anonymiser (to be run by the data owner) | S | audit Q-01 (10 of 11, prep) | — | new `tools/dev/anonymise-snapshot.js`, `tests/anonymise-snapshot.test.js` | — | none |
| E-Q03 | Tests for untested critical routes and jobs | M | audit Q-03, X-Q-03 | — | new `tests/*-routes.smoke.test.js`, `tests/jobs-reports-send.test.js`, `docs/agent-execution/INVENTORY.md` (regen) | E-A01b (avoid duplicating tracker tests) | INVENTORY.md (generated) |
| E-Q04 | Load / soak harness | S | audit Q-04 (prep) | — | new `tools/test/load.js`, `docs/ops/LOAD-TEST.md` | — | none |
| E-Q05 | Dependency triage ledger + CDN dependency guard | S | audit Q-05 (prep), X-Q-02 | — | new `docs/agent-execution/DEPS-TRIAGE.md`, `tests/dependency-sources.test.js` | — | none |
| E-Q07 | Dependency health endpoint + SLO proposal | S | audit Q-07 | — (read-only) | `routes/health.js`, `server.js` (edit the **existing** health mount line only), `docs/ops/SLO-PROPOSAL.md` | — | server.js (0 new lines) |
| E-Q08 | Delivery-quality report generator | S | audit Q-08 | — | new `tools/release/delivery-metrics.js`, `docs/agent-execution/DELIVERY-QUALITY.md` | — | none |
| E-Q09 | Persona journeys for the agent committee (uncovered flows) | M | §8.1 gaps | — | new `tests/e2e/c1…c5-*.spec.js`, `docs/ops/PERSONA-JOURNEYS.md` | E-F02 (field), E-B05 not needed | PERSONA-JOURNEYS.md |
| E-B03 | Value table generator (§9 indicators, UNKNOWN when unsourced) | S | audit B-03 (prep) | — | `services/pilotMetrics.js`, `tools/pilot/pilot-metrics.js`, new `docs/ops/pilot/VALUE-TABLE.md` | E-F03 (same service file) | pilotMetrics.js |
| E-B05 | Ownership/RACI template + missing gate rows | S | audit B-05 (prep), X-A-03, X-B-03 | — | new `docs/ops/pilot/RACI-TEMPLATE.md`, `docs/sdp360/completion/RELEASE-GATES.md` (new empty rows/columns only), new `tools/agent/raci-seed.js` | — | RELEASE-GATES.md |
| E-B07 | In-app product feedback (shadow) | M | audit B-07 | `ui_feedback_enabled` (`0`) | new `routes/feedback.js`, new `public/lib/feedback.js`, `public/_shell.js`, migration (number from plan owner), `services/reportConfig.js`, `server.js` (1 mount line) | **E-A01** (lines), B-05 decision before switch-on | server.js, _shell.js |
| E-B08 | AI commentary: refuse on stale data; number check on `/api/ai/analyze` | S | audit B-08 rest, X-B-01, X-B-02 | `ai_commentary_stale_block` (`0`) | `services/aiCommentary.js`, `routes/reportStudio.js`, `services/reportGenerator.js`, new `services/aiAnalyzeGuard.js`, `server.js` (step 2) | E-A01 for step 2 | server.js (step 2) |

**Ordering.** `server.js` queue (strictly serial): **E-A01 → E-A01b → (E-B07, E-B08 step 2, E-Q07 any order)**.
Each extraction lowers `BUDGET` by hand; a goal that needs a mount line takes it from the freed budget.
`public/field/app.js` queue: **E-F02 → E-F03**. `services/pilotMetrics.js`: **E-F03 → E-B03**.
`services/reportConfig.js` DEFAULTS is touched by E-F01, E-F03, E-B07, E-B08 — append-only edits, rebase if conflict,
regenerate FLAG-REGISTER.md (`node tools/agent/flag-register.js`) in each. `public/reports.html`: E-A02 only (nothing
else in this file touches it). Everything else is independent and can run in parallel.

---

## (d) /goal prompts

Common header for every prompt below (do not repeat when pasting; it is part of each):

> CONTEXT  Expert audit of 5 Nov 2026 on head d38fa41, cross-checked in
> `docs/audits/2026-11-05-expert-audit/CROSSCHECK-3-FAQB.md` (search the ids you close). Line numbers drift: locate by
> content. Audit ids are written "audit X-nn" (they collide with our own goal ids).
> GUARDRAILS  `.claude/rules/SDP360_BOUNDARIES.md`; PostgreSQL only; no new external connector; no fabricated
> approval, production data or threshold; a number with no source is UNKNOWN (null), never 0/green; `httpError.fail`
> for every new error response; await-precedence (`tests/await-precedence.test.js`); server.js stays ≤ its budget
> (`tests/server-size-budget.test.js`); no push/merge; do not run the full suite — run the named suites and neighbours.
> DONE  Each closed id: test name + file:line; evidence file `docs/agent-execution/<ID>.md` with a verdict table
> (id → FIXED/PARTIAL + proof) and the items left for a person.

### /goal — SDP360 / E-A01 Extract survey routes from server.js
MISSION  Move every `/api/survey*` route (`/api/survey/list|summary|kpis|cache/clear|debug|by-dimension|dimension-cache/clear|voice|voice-cache/clear`, `/api/survey`, `/api/survey/:response_id/answers`) and their private helpers into `routes/survey.js` (factory `module.exports = (deps) => router`, the pattern of `routes/inspection.js`), mounted with one `app.use` line. Behaviour, paths, middleware chains and responses byte-identical. Lower `BUDGET` in `tests/server-size-budget.test.js` to the new line count (never raise it).
CLOSES  audit A-01 (slice), audit Q-03 (survey routes listed in INVENTORY.md "without a test reference").
SWITCH  none (refactor).
FILES  `server.js`, new `routes/survey.js`, `tests/server-size-budget.test.js`, new `tests/survey-routes.smoke.test.js`, `docs/agent-execution/INVENTORY.md` (regenerate with `node tools/agent/inventory.js`).
METHOD  First write `tests/survey-routes.smoke.test.js` against the CURRENT server (PostgreSQL throwaway DB via `tests/_pg-boot.mjs`, `tests/_http-fetch`): 401 without session, 403 for `requireAdmin` cache clears as viewer, `/api/survey/debug` 404 outside dev, response shape with a stubbed `fetchAllViewRows`. It must pass before AND after the move. Then move. Run the route-matrix test (`authz-route-matrix`) to prove the chains did not change.
ACCEPTANCE  survey smoke green before and after; `server-size-budget` green with the lowered budget; `authz-route-matrix` unchanged; INVENTORY regenerated (`--check` green).
GUARDRAILS  common; do not change any SQL or Zoho call; keep `stripPiiColumns` on the same paths.

### /goal — SDP360 / E-A01b Extract tracker routes and make year deletion safe
MISSION  (1) Move `/api/tracker/{load,save,import-dept-meetings,export,reset,delete-year}` from server.js into `routes/tracker.js` (same chains, one mount line), lower `BUDGET`. (2) Defect fix (ON): before `deleteTrackerYear` on PostgreSQL, write a JSON export of every row the cascade will remove (`tracker_years` → pillars → activities → targets_v2 → inputs_v2 for that year) through `services/blobStore.js` (module `tracker`, owner `year-<y>-<ts>`), return its ref as `backup_path`, and write a `system_log` row (`category:'tracker'`, `action:'tracker_year_deleted'`, `risk:1`, details = counts + blob ref). If the export fails, nothing is deleted (400 with the reason).
CLOSES  audit A-01 (slice), X-Q-01, audit Q-03 (tracker routes).
SWITCH  none — (2) is a defect fix.
FILES  `server.js`, new `routes/tracker.js`, `tracker-db.js`, `tests/server-size-budget.test.js`, new `tests/tracker-delete-year.test.js` (+ pg variant via `tests/pg-helpers.js`), new `tests/tracker-routes.smoke.test.js`.
METHOD  Failing tests first: delete-year on PG returns a non-null `backup_path` whose blob holds the removed rows; a forced export failure leaves the year intact; a system_log row exists; viewer/editor get 403; GET preview unchanged; reset still 501 on PG.
ACCEPTANCE  new tests green; `pg-tracker`, `tracker-*` suites green; budget lowered; route matrix unchanged.
GUARDRAILS  common; no destructive change to existing data; no change to the per-year model (ADR-001).

### /goal — SDP360 / E-F01 Field outbox: admin diagnostic, safe purge, authorised resolution
MISSION  (1) Read (ON): `GET /api/field/admin/outbox?status=&kind=&since=` (admin tier) listing entries with status `received|applying|failed` older than N minutes plus `outboxStats()` counts — no payloads, only uuid, kind, user id, ages, `result.error`, `outcome_unknown`. (2) Purge fix (ON): `purgeOutbox` deletes only `applied` and `rejected` rows older than the window; `received/applying/failed` rows are kept and counted in the job result. (3) Resolve (switch `field_outbox_resolve_enabled`, default `'0'` → 404): `POST /api/field/admin/outbox/:uuid/resolve {action, reason}` with `action ∈ {mark_rejected, release}`; `release` (applying → failed, retryable by the phone) is **refused** for `ticket`/`action` kinds unless `confirm_checked_sdp:true` and a reason ≥ 10 chars; nothing is ever applied server-side; every resolution writes system_log (`risk:1`, actor, reason). Plus `tools/field/outbox-admin.js` (dry run by default) calling the same store functions. PILOT-PROFILE row for the switch (Who decides: PO + site IT).
CLOSES  audit F-03, X-F-01, X-F-02, X-F-03.
SWITCH  `field_outbox_resolve_enabled` (`'0'`) — add to `services/reportConfig.js` DEFAULTS (else `setConfig` drops it); regenerate FLAG-REGISTER.md.
FILES  `services/fieldStore.js`, `routes/field.js`, `services/reportConfig.js`, new `tools/field/outbox-admin.js`, `tests/field-store.test.js`, `tests/pg-field-store.test.js`, `tests/field-routes.smoke.test.js`, `docs/ops/pilot/PILOT-PROFILE.md`, `docs/ops/FLAG-REGISTER.md`.
METHOD  Failing tests first: purge keeps an old `applying` row; admin list shows it, viewer/field-tech get 403; resolve 404 while switch off; `release` of a ticket without confirmation → 400; `release` of an inspection → phone resend applies exactly once (two parallel PUTs, one applies); system_log row written.
ACCEPTANCE  all field suites + `pg-field-store` + `authz-route-matrix` green; no change to the phone protocol.
GUARDRAILS  common; never expose payloads (photos, notes) in the admin list; no automatic re-apply.

### /goal — SDP360 / E-F02 Field queue on constrained networks — browser journeys in CI
MISSION  Add a Playwright journey (run by `npm run test:e2e`, the B-05 harness) that proves no silent loss under: (a) 800 ms latency + 3 offline/online flaps during sync (CDP `Network.emulateNetworkConditions`); (b) captive portal: `/api/field/*` answered `200 text/html` by a route stub → entry kept, message shown; (c) session expiry (401) in the middle of a photo upload → sync stops, entry kept, resumes after sign-in, photo uploaded once; (d) 409 `in_progress` then success; (e) chunk failure mid-upload resumes the missing chunks only; (f) user A queues, user B signs in on the same browser → A's entries not sent under B, shown "autre utilisateur"; (g) quota failure, page reload → earlier entries and badge intact. Also the G19 open item: a route-level test with a slow and a throwing apply stub (two concurrent PUTs → one apply, other 409 then duplicate). Fix any defect found in `public/field/app.js` (defect fixes ship ON) and state progress text in French first.
CLOSES  audit F-04, audit F-02 (browser part), X-F-04.
SWITCH  none.
FILES  new `tests/e2e/f1-field-network.spec.js`, `tests/e2e/fixtures/browser.js` (network helpers), `tests/field-routes.smoke.test.js`, `public/field/app.js` / `i18n.js` only for defects, `docs/ops/PERSONA-JOURNEYS.md` (row).
METHOD  Journey first; if green on first run for a case, keep it as a regression guard and say so; if red, fix and show the red run in the evidence.
ACCEPTANCE  `node tools/test/run-e2e.js --runs=2` green incl. f1, 0 external requests; field unit suites green.
GUARDRAILS  common; simulated network ≠ real VSAT — the evidence must say so (field sign-off stays a human gate, E-F04).

### /goal — SDP360 / E-F03 Field review step and task timing (shadow)
MISSION  Behind two switches, both default `'0'` (today): (1) `field_review_step` — before queueing an inspection, show a one-screen summary (site, items addressed, findings by status, photo count and size, what will happen offline) with "Mettre en file" / "Corriger"; (2) `field_task_timing` — measure from form open to "queued" (ms, active time, pauses > 2 min excluded) and send it as `meta.task_ms` in the envelope; the server records it only in the existing `field_*_applied` system_log details (no new column); `services/pilotMetrics.js` reports median/p75 per site × kind × ISO week, `null` when no sample. Switch values reach the phone via `/api/field/bootstrap`. PILOT-PROFILE rows (Who decides: PO / adoption lead).
CLOSES  audit F-05.
SWITCH  `field_review_step` (`'0'`), `field_task_timing` (`'0'`).
FILES  `public/field/app.js`, `public/field/i18n.js`, `public/field/index.html`, `routes/field.js`, `services/pilotMetrics.js`, `services/reportConfig.js`, tests `field-review-step.test.js`, `field-task-timing.test.js`, `pilot-metrics` suite, PILOT-PROFILE.md, FLAG-REGISTER.md.
METHOD  Failing tests first: switches off → envelope and UI byte-identical to today (snapshot of the payload); on → summary shown, `task_ms` present, server logs it, pilotMetrics median correct, no sample → null.
ACCEPTANCE  field suites + `field-pwa-static` (service-worker cache bump) green; e2e t3 green with switches off.
GUARDRAILS  common; no user name in timing data (user id + role tier only, as `page_viewed`); no target time set.
DEPENDS  E-F02 (same file), E-F01 (same route file).

### /goal — SDP360 / E-F04 Real-device field acceptance kit (preparation only)
MISSION  Write, in French first (English summary), `docs/ops/pilot/FIELD-DEVICE-UAT.md`: device profiles to recruit (≥ 2: one mid-range Android with Chrome, one iPhone with Safari, both on the site's real network), network scenarios (site Wi-Fi, 4G weak, VSAT/latency, captive portal, airplane mode mid-sync), storage scenarios (near-full phone, 20 photos, app restart, logout of a shared phone), user switch, the exact checks per scenario mapped to the G19 states, how to read the result (`/api/field/admin/outbox` from E-F01 if built, else system_log), and a **blank** acceptance PV (names/dates/signatures empty, "à compléter par le responsable IT de site"). Plus `FIELD-DEVICE-SHEET.csv` (one line per device × scenario; `result` = `ok|lost|duplicate|blocked|not_run`).
CLOSES  audit F-01 (prep), audit F-02 (human part prep).
SWITCH  none.
FILES  new `docs/ops/pilot/FIELD-DEVICE-UAT.md`, new `docs/ops/pilot/FIELD-DEVICE-SHEET.csv`, link from `USABILITY-TEST-PROTOCOL.md` (T3 row).
ACCEPTANCE  `tests/persona-journeys.test.js`/doc link checks green; the doc states it records nothing and accepts nothing.
GUARDRAILS  common; no pre-filled result, name or signature.

### /goal — SDP360 / E-A02 reports.html: extract one inline block into a module
MISSION  Pick ONE self-contained inline `<script>` region of `public/reports.html` (prefer an admin-rail panel group whose functions only touch its own `#ap-*` elements — identify by content, list its globals) and move it to `public/lib/reports-<name>.js`, loaded by `<script src>` (versioned by `injectAssetVersion`). Every function the HTML still calls stays reachable on `window` with the same name; same DOM ids; no behaviour change. Record the line count before/after.
CLOSES  audit A-02 (first slice).
SWITCH  none.
FILES  `public/reports.html`, new `public/lib/reports-<name>.js`, new `tests/reports-<name>-module.test.js` (static: module loaded once, every `onclick`/handler name resolves, no duplicated top-level `const` between page and module — the classic-script redeclaration trap).
METHOD  Static test first (fails until the module exists), then move; run `reports-html-escape-sweep`, `a11y-static`, e2e `t2`, `u3` once.
ACCEPTANCE  named tests green; `reports.html` smaller; no page error in the e2e artefacts.
GUARDRAILS  common; one block only per goal; no restyling.

### /goal — SDP360 / E-A03 API contract and error-shape tests
MISSION  (1) Contract tests for `/ext/v1/{metrics,sites,metrics/:key/values}` and the OData `/ext/odata/Sites`: a hand-written schema (no new dependency) per response — required fields, types, `null` allowed where a value is unmeasured, pagination/limit fields — and the error shape for 401/403/404/429. (2) A static report test listing every `res.status(4xx|5xx).json(` that does not go through `services/httpError.fail`, with a ratchet (count may only go down; current 389) and a check that each such call has an `error` string. (3) `docs/api/CONTRACTS.md`: versioning rule (breaking change = new `/ext/v2`), error shape, deprecation process — marked proposal.
CLOSES  audit A-03 (tests + doc), X-Q-05 (measured, ratcheted).
SWITCH  none.
FILES  new `tests/api-contract-ext.test.js`, new `tests/error-shape.test.js`, new `docs/api/CONTRACTS.md`.
ACCEPTANCE  both tests green on today's code; ratchet value recorded.
GUARDRAILS  common; no response change in this goal.

### /goal — SDP360 / E-A04 Measured performance baseline (report-only)
MISSION  `tools/test/perf-baseline.js` reads the e2e artefacts (`summary.json` + per-journey JSON already holding DCL/load/bytes) of N runs and writes p50/p95 per page and per journey into `docs/agent-execution/PERF-BASELINE.md` with machine, commit, run count and the statement "throwaway database, synthetic data — observation, not a budget". `run-e2e.js` calls it when `--baseline` is passed. CI prints the table (never fails on it). The "Budget" column is `UNKNOWN — to be approved` for every row.
CLOSES  audit A-04 (baseline part).
SWITCH  none.
FILES  new `tools/test/perf-baseline.js`, `tools/test/run-e2e.js`, new `tests/perf-baseline.test.js` (pure aggregation on fixture artefacts), `docs/agent-execution/PERF-BASELINE.md`.
ACCEPTANCE  unit test green; one local run documented.
GUARDRAILS  common; never write a threshold.

### /goal — SDP360 / E-A05 EXPLAIN report on synthetic volumes
MISSION  `tools/pg/explain-hot.js`: on a disposable database seeded like `tools/pg/restore-rehearsal.js` (100 000 synthetic tickets; refuses any database whose name is not prefixed `sdp_test_`/a throwaway schema), run `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` on the hot readers (ageing by group/site, calendar monthly helpdesk, site helpdesk window, report list with filters, field outbox by status, system_log list) and write `docs/agent-execution/EXPLAIN-SYNTHETIC.md` (plan type, rows, time, seq scans on > 10k rows). Any index idea goes into an ADR as a proposal; no index is created.
CLOSES  audit A-05 (prep).
FILES  new `tools/pg/explain-hot.js`, new `tests/explain-hot.test.js` (guard refuses a non-throwaway DB; pure plan summariser), `docs/agent-execution/EXPLAIN-SYNTHETIC.md`, `docs/ai-decisions/ADR-E-A05-index-proposals.md`.
ACCEPTANCE  unit test green; report produced locally.
GUARDRAILS  common; DBA validation on real volumes is a human gate.

### /goal — SDP360 / E-A06 Scorecard ↔ registry parity tests
MISSION  For each KPI the Executive Scorecard computes in the browser (`public/lib/dashboard-shared.js` + `executive.html` helpers: resolution SLA %, first-reply SLA %, closure %, reopen %, avg resolution) build a parity test: same fixture month → browser helper (loaded in Node) vs the registry metric (`services/metricRegistry.js`) → equal, or the difference documented and asserted as a known divergence with its doctrine reference. `null` must stay `null` on both sides for an empty month.
CLOSES  audit A-06 (tests; removal of client formulas stays behind `ui_exec_nav` and a PO decision).
FILES  new `tests/exec-scorecard-registry-parity.test.js`, `docs/ux/EXEC-PAGES-MATRIX.md` (row update).
ACCEPTANCE  test green; every divergence named.
GUARDRAILS  common; no change to any formula.

### /goal — SDP360 / E-A07 Journal every config change + switch prerequisites
MISSION  (1) Audit fix (ON): `PUT /api/reports/config` writes one `system_log` row per actually changed key (`category:'config'`, `action:'config_changed'`, details `{key, from, to}`; secret keys `{key, change:'set'|'cleared'}` only, never a value), optional body field `reason` stored with each row; `tools/reports/set-ui-policy.js --apply` does the same. (2) `GET /api/reports/config/history?key=&limit=` (super_admin) reads those rows. (3) `services/switchPrereqs.js` — data: switch → prerequisites in plain words (from audit §7.1 and G24 gates: `site_code_shared_block` ← TND owner; `kpi_policy_enforced` ← adopted policy + shadow comparison read; `alert_external_enabled`/`handoff_notify_enabled` ← recipient list + dry run; `authz_capability_mode=enforce` ← not wired; `field_outbox_resolve_enabled` ← device sessions). The dry run of `set-ui-policy.js` and the config PUT answer carry a `warnings[]` list; nothing is blocked. (4) `tools/agent/flag-register.js` adds a "Prerequisites" column.
CLOSES  audit A-07, X-A-02, X-A-04.
FILES  `routes/adminConfig.js`, new `services/switchPrereqs.js`, `tools/reports/set-ui-policy.js`, `tools/agent/flag-register.js`, `docs/ops/FLAG-REGISTER.md` (regenerate), tests `config-change-journal.test.js` (+ smoke), `switch-prereqs.test.js`.
ACCEPTANCE  a changed switch → one row; unchanged keys → none; a secret never appears in details; `flag-register --check` green.
GUARDRAILS  common; prerequisites are warnings, not approvals; do not name owners.

### /goal — SDP360 / E-Q01 Python in CI for the deck renderer test
MISSION  Add `actions/setup-python` (pinned SHA, per CI SHA policy) + `pip install -r tools/exec-pptx/requirements.txt` (pinned `matplotlib`, `python-pptx` versions = the ones the dev box uses) to the test job of `ci.yml` (and `release.yml` if it runs the suite); lower the python reason's `max` in `tests/.skip-allowlist.json` to 0 (keep the reason entry for dev boxes without Python).
CLOSES  audit Q-01 (1 of 11), X-Q-04.
FILES  `.github/workflows/ci.yml`, `.github/workflows/release.yml`, new `tools/exec-pptx/requirements.txt`, `tests/.skip-allowlist.json`, `tests/ci-config.test.js` (assert the step exists).
ACCEPTANCE  `exec-pptx-python` runs locally with Python present; `ci-config` green; licence inventory regenerated if it covers Python packages.
GUARDRAILS  common; never ship Python packages in the product package unless already shipped.

### /goal — SDP360 / E-Q02 Snapshot anonymiser (to be run by the data owner)
MISSION  `tools/dev/anonymise-snapshot.js --in=<dir> --out=<dir>`: copies a `prod-snapshot/`-shaped folder replacing every person name, e-mail, free-text note/description and ticket subject with deterministic pseudonyms (HMAC with a key from the environment, never stored), keeping counts, dates, statuses, site codes and joins intact so `tests/review-data.test.js` and `site-window-readers.test.js` keep their row-count assertions. Prints a residual-PII scan (e-mail/phone regexes) and refuses to finish if any hit remains. Document that only the data owner may run it on real data and approve the output; the agent tests it on a synthetic fixture only.
CLOSES  audit Q-01 (10 of 11 — preparation; lifting the skips is the data owner's act).
FILES  new `tools/dev/anonymise-snapshot.js`, new `tests/anonymise-snapshot.test.js` (synthetic snapshot), `tests/.skip-allowlist.json` owner text, `docs/ops/ANONYMISED-SNAPSHOT.md`.
ACCEPTANCE  synthetic test green: no source name/e-mail survives; counts preserved.
GUARDRAILS  common; never read `prod-snapshot/` in this goal; never commit any snapshot.

### /goal — SDP360 / E-Q03 Tests for untested critical routes and jobs
MISSION  Smoke/unit tests (PostgreSQL throwaway DB via `tests/_pg-boot.mjs`, `_http-fetch`, roles as the route really requires) for: `POST /api/meetings/reset` (super_admin only), `POST /api/cache/clear`, `GET/POST /api/admin/backup-schedule`, `POST /api/admin/backup-now` (stubbed backup), `POST /api/reports/auth/change-password` (old password required, throttle, session kept/ended as coded), `POST /api/kpi-policies/validate`, meetings import template/preview (no write), `/ext/odata/Sites`; and job tests for `reports.weekly`/`reports.monthly` (armed off → skipped with reason; armed with injected mailer → one send per confirmed recipient, dedup lane), `engagement.alerts|digest|digest_weekly`, `publish.connectors` (`notifications_stop` halts), `meraki.wan_events*`/`wan_poller` (config missing → self-skip). Regenerate INVENTORY.md and record the new "without test reference" counts.
CLOSES  audit Q-03, X-Q-03.
FILES  new `tests/*-routes.smoke.test.js`, new `tests/jobs-reports-send.test.js`, `tests/jobs-engagement.test.js`, `tests/jobs-meraki-skip.test.js`, `docs/agent-execution/INVENTORY.md`.
ACCEPTANCE  new tests green; counts lowered (routes ≤ 76 − covered, jobs ≤ 10 − covered).
GUARDRAILS  common; no real SMTP/Zoho/Meraki call (inject transports); do not duplicate E-A01/E-A01b tests.
DEPENDS  E-A01b.

### /goal — SDP360 / E-Q04 Load / soak harness
MISSION  `tools/test/load.js` (Node `http`, no new dependency): scenarios = N concurrent sessions doing login → report list → open report → save a section; helpdesk page data; field PUT envelopes; export; with `--duration` for soak. Reports p50/p95/p99, error rate, 5xx, and server RSS (from `/api/health/version` start time + process memory if exposed) into a JSON + markdown. Refuses any target that is not `127.0.0.1`/`localhost` unless `--target-confirm=<exact host>` is given (staging is a human decision). Run once locally on a throwaway PG and record it as an observation.
CLOSES  audit Q-04 (prep).
FILES  new `tools/test/load.js`, new `tests/load-harness.test.js` (target guard + aggregation), new `docs/ops/LOAD-TEST.md`.
ACCEPTANCE  unit test green; one local report.
GUARDRAILS  common; no production target; no threshold.

### /goal — SDP360 / E-Q05 Dependency triage ledger + CDN dependency guard
MISSION  (1) `docs/agent-execution/DEPS-TRIAGE.md`: one row per open dependency update known from SEC-01 / G24 gate 4 (package, from→to, breaking notes from the upstream changelog when available offline, suites to run, E2E journeys to run, rollback = revert the lockfile commit, verdict safe/migration-goal) — proposals only. (2) `tests/dependency-sources.test.js`: every lockfile entry resolved outside `registry.npmjs.org` must carry an `integrity` and be listed with a reason and a manual-review owner (today: `xlsx` from cdn.sheetjs.com).
CLOSES  audit Q-05 (prep), X-Q-02.
FILES  new `docs/agent-execution/DEPS-TRIAGE.md`, new `tests/dependency-sources.test.js`.
ACCEPTANCE  test green today; adding a non-registry package without a reason fails it.
GUARDRAILS  common; no PR merge, no lockfile change.

### /goal — SDP360 / E-Q07 Dependency health endpoint + SLO proposal
MISSION  `GET /api/health/deps` (admin tier) in `routes/health.js`: PostgreSQL `SELECT 1` latency; Zoho token validity/expiry (passed in via deps — extend the existing health mount line's object, **no new server.js line**); SMTP configured yes/no (never probed); per sync job last ok vs `freshnessHours` (`services/sync/jobs.js`); last successful `db.backup` age; last restore drill; data-dir disk free. Each item `ok|stale|down|unknown` — **unknown never green**. `docs/ops/SLO-PROPOSAL.md`: proposed SLIs per service (availability of login, sync freshness, scheduled-report delivery rate, field apply success), each target `UNKNOWN — to be approved by SRE`.
CLOSES  audit Q-07 (agent part).
FILES  `routes/health.js`, `server.js` (edit the existing `routes/health` mount line only), new `tests/health-deps.smoke.test.js`, new `docs/ops/SLO-PROPOSAL.md`.
ACCEPTANCE  smoke green: viewer 403, unknown items reported unknown, a stale job reported stale; `server-size-budget` unchanged line count.
GUARDRAILS  common; no outbound call from the health route.

### /goal — SDP360 / E-Q08 Delivery-quality report generator
MISSION  `tools/release/delivery-metrics.js --from --to` computes from git (merge commits, reverts, "fix" commits referencing a goal id, lead time from goal-ledger dates in `docs/agent-execution/GOAL_TRACKER.csv`) and from the evidence ledgers: goals delivered, reverted commits, defect-fix lead time, skipped-test count per run (from `tools/test/guard.js` output if present), e2e journeys covered. Release failure rate, production rollbacks and escaped bugs are printed as **UNKNOWN — needs deployment records** unless a deploy log file is supplied. Output `docs/agent-execution/DELIVERY-QUALITY.md`.
CLOSES  audit Q-08 (agent part).
FILES  new `tools/release/delivery-metrics.js`, new `tests/delivery-metrics.test.js`, `docs/agent-execution/DELIVERY-QUALITY.md`.
ACCEPTANCE  unit test on a fixture repo green.
GUARDRAILS  common; never infer a production event from git.

### /goal — SDP360 / E-Q09 Persona journeys for the agent committee (uncovered flows)
MISSION  Add browser journeys for the §8.1 flows no spec covers (see CROSSCHECK-3 §8.1 table): c1 coordinator enters tracker values and signs a PV (server-time stamp persisted); c2 Group IT manager goes from the worst-gap tile to the site's overdue action and assigns/updates it; c3 Finance reads an asset amount with `certified:false` and a site with no currency (shown "non certifié"/UNKNOWN, never 0); c4 PMO creates a demand → project, sees a capacity conflict (with `capacity_enabled` set to 1 only in the throwaway DB, if built; else asserts the feature is absent and records it) and a benefit check; c5 super_admin removes a role, the user's next request is refused, and the security log export contains the event. Update PERSONA-JOURNEYS.md.
CLOSES  §8.1 automated-coverage gaps (supports the agent committee charter; not acceptance).
FILES  new `tests/e2e/c1…c5-*.spec.js`, `tests/e2e/fixtures/seed.js` (additive), `docs/ops/PERSONA-JOURNEYS.md`.
ACCEPTANCE  `run-e2e.js --runs=2` green, 0 external requests; each journey's evidence says "automated, synthetic org".
GUARDRAILS  common; switches changed only inside the throwaway DB.
DEPENDS  E-F02 (fixtures helper file).

### /goal — SDP360 / E-B03 Value table generator
MISSION  Extend `services/pilotMetrics.js` + `tools/pilot/pilot-metrics.js --value` to output the audit §9 indicators with columns: definition (proposed), formula, source table/file, population, observations n, value, owner role, validator role. Computable today from recorded data: active adoption (users with ≥ 1 business action / targeted users — targeted list = input file, else UNKNOWN), data freshness (sources within `freshnessHours` / active sources), verified closure delay and share of verified actions (if the commitment model is on; else UNKNOWN), field task time (from E-F03), report preparation time (from `WEEKLY-REPORT-STOPWATCH.csv`). Everything else (SLA certified, KPI reliability, benefits, availability, delivery rate) → `UNKNOWN` with the missing source named. `docs/ops/pilot/VALUE-TABLE.md` explains baseline-before-pilot and constant-scope comparison (audit §9.1).
CLOSES  audit B-03 (prep).
FILES  `services/pilotMetrics.js`, `tools/pilot/pilot-metrics.js`, `tests/pilot-metrics*.test.js`, new `docs/ops/pilot/VALUE-TABLE.md`.
ACCEPTANCE  tests green; empty DB → every value null/UNKNOWN, none 0.
GUARDRAILS  common; read-only session kept; no target values.
DEPENDS  E-F03.

### /goal — SDP360 / E-B05 Ownership / RACI template + missing gate rows
MISSION  `tools/agent/raci-seed.js` generates `docs/ops/pilot/RACI-TEMPLATE.md` from the code: one row per domain (helpdesk KPIs, assets/finance, meetings, inspections, field, PPM, governance, access, connectors from CONNECTOR-REGISTER, each "to be named" flag owner grouped by area — 194 today) with empty R/A/C/I and data-steward columns, a decision-SLA column (empty) and a monthly product-committee agenda skeleton. Add to `RELEASE-GATES.md` **empty** rows: Penetration test / accepted analysis (Information Security), QA lead (CI on target SHA, skips), Capacity (SRE + DBA), Business witness project (PMO); add columns "Version / SHA" and "Conditions" (empty). Update `tests/release-dossier*.test.js` if it checks the table shape.
CLOSES  audit B-05 (prep), X-A-03, X-B-03.
FILES  new `tools/agent/raci-seed.js`, new `docs/ops/pilot/RACI-TEMPLATE.md`, `docs/sdp360/completion/RELEASE-GATES.md`, its test.
ACCEPTANCE  generator `--check` green; every new gate cell empty.
GUARDRAILS  common; no name, no decision, no date filled.

### /goal — SDP360 / E-B07 In-app product feedback (shadow)
MISSION  Behind `ui_feedback_enabled` (default `'0'` → no button, routes 404): a "Feedback" item in the shell (`public/_shell.js`) opens a small dialog (problem / idea / question; page auto-filled; free text ≤ 2 000 chars, escaped; named or anonymous — anonymous stores no user id, only role tier and site); `routes/feedback.js`: `POST /api/feedback`, `GET /api/feedback` (admin tier: list, filter by status/page), `POST /api/feedback/:id/triage {status: new|triaged|planned|declined|done, response}`; the requester (if named) sees the response in My Work. Table via a new PostgreSQL migration (ask the plan owner for the number). system_log on triage. PILOT-PROFILE row (Who decides: PO; prerequisite: B-05 names who answers).
CLOSES  audit B-07.
SWITCH  `ui_feedback_enabled` (`'0'`).
FILES  new `routes/feedback.js`, new `public/lib/feedback.js`, `public/_shell.js`, migration file, `services/reportConfig.js`, `server.js` (one mount line, from the budget freed by E-A01), tests `feedback.smoke.test.js`, `feedback-shell.test.js`, PILOT-PROFILE.md, FLAG-REGISTER.md.
ACCEPTANCE  off → 404 + no button; on → submit/list/triage, anonymous row has no user id, XSS payload rendered inert; route matrix updated.
GUARDRAILS  common; no outbound notification; no AI on feedback text.
DEPENDS  E-A01.

### /goal — SDP360 / E-B08 AI commentary: refuse on stale data; number check on /api/ai/analyze (shadow)
MISSION  (1) `ai_commentary_stale_block` (default `'0'`): when `'1'`, `generateCommentary` callers (`services/reportGenerator.js`, `routes/reportStudio.js` regenerate) compute source freshness with the same gate as publication (`reportStudio.js` `gate.freshness`) and, if any source is stale/never synced, return the deterministic text with `source:'deterministic'`, `error:'sources stale — AI commentary not generated'`, logged. (2) Step 2 (only after E-A01 frees lines): `services/aiAnalyzeGuard.js` — when the deck-builder request carries a `facts` list, verify the reply's numbers with `aiCommentary.verifyNumbers` and return `verified:false` + offending numbers (the page shows them; it never silently drops the reply); wire into `/api/ai/analyze` with one line.
CLOSES  audit B-08 (rest), X-B-01, X-B-02.
SWITCH  `ai_commentary_stale_block` (`'0'`); step 2 is additive metadata (no behaviour change when `facts` absent).
FILES  `services/aiCommentary.js`, `services/reportGenerator.js`, `routes/reportStudio.js`, new `services/aiAnalyzeGuard.js`, `server.js` (step 2, one line), `services/reportConfig.js`, tests `ai-commentary-stale.test.js`, `ai-analyze-guard.test.js`, PILOT-PROFILE.md, FLAG-REGISTER.md.
ACCEPTANCE  off → identical output to today (snapshot); on + stale → deterministic + reason; guard flags an invented number.
GUARDRAILS  common; no provider is turned on; no production data to any model.
DEPENDS  E-A01 for step 2.

---

## (e) Draft charter — agent-run "user-representative committee" (simulated UAT)

> **This is NOT user acceptance.** The committee is made of AI agents playing personas on a synthetic organisation in
> a throwaway PostgreSQL database. Its output is engineering evidence (defects, confusing wording, missing states).
> It can never replace UAT with real pilot users, the screen-reader session, the francophone review, the field
> device sessions or any signature in `RELEASE-GATES.md` (G24 gates 6, 7, 17, 18). Every report it writes must carry
> this sentence in its first line.

**Purpose.** Exercise the product the way each role would, before people are asked to, so that real UAT sessions
spend their time on judgement, not on bugs. **Method.** Browser (Playwright harness of B-05, external requests
blocked) + API, French and English, 1280 px and 390 px. **Data.** Synthetic organisation seeded by
`tests/e2e/fixtures/seed.js` extended with the org models below; no production data, no real e-mail/SSO/Meraki/OpManager.
**Evidence level.** "agent-simulated" — recorded per scenario as pass / defect / confusing / not runnable, with the
journey artefact path. **Independence.** The agent playing a persona must not be the agent that built the screen.

### Seats (personas)

| Seat | Account in the synthetic org | Pages | What the seat judges |
|---|---|---|---|
| Site IT coordinator (francophone mine) | `editor` + `tracker-editor`, one site; second variant multi-site editor (`user_sites`) | reports, activity-tracker, meetings/meeting, site-actions, inspections | can finish the weekly cycle alone; site lock respected; closed months locked |
| Mobile technician | `field-tech`, shared phone | `/field/` | no silent loss, explicit refusal, user switch, readable queue state |
| Group IT manager / responsable IT | `committee-member` / admin tier, no site | cockpit, dashboards (exec-home), IT Review, site-awareness | worst gap → origin → action; null vs 0 vs not certified |
| Business head of department (métier) | `viewer` + department; PV signer | meeting PV, handoffs, my-work | signs as the named head; sees only what concerns them |
| Direction / executive | `executive`, `scorecard-viewer` | exec-home, executive, exec-view (public) | one-glance status; no ITSM jargon in French; no fabricated green |
| Finance | admin tier with asset money, Finance reviewer | assets Finance/Investment tabs, TCO template | amounts in the right currency or UNKNOWN; coverage % read correctly |
| PMO | portfolio editor / committee | portfolio, project schedule, governance cockpit | demand → project → baseline; capacity conflict; benefit realisation |
| Security / RSSI / administrator | `super_admin`, second `super_admin` for four-eyes | users, access requests/approvals, emergency access, system-logs, config | cross-site refusal, role removal effect, evidence export, emergency 24 h |

### Organisation models to seed (each a separate run)

1. **Multi-country**: Burkina Faso (Houndé, Mana, Ouagadougou office), Côte d'Ivoire (Ity, Lafigué, Abidjan),
   Senegal (Sabodala-Massawa, Dakar), UK (London, non-UTC with `site_local_calendar` both off and on).
2. **Multi-site under one coordinator** (`user_sites` with two extra sites) and **one site with two codes** (the
   Assafo/Tanda `TND` case, `site_code_shared_block` off then on).
3. **Org shapes**: central IT only (admin tier, no site); mine with sub-sites (Exploration: FETEKRO/TANDA WAN lines);
   office without meetings/inspection codes (ASSAFO/Exploration — writes refused by design).
4. **Currency**: sites in XOF with and without `asset_site_currency`; one site with no rate (→ not certified).
5. **Languages**: `ui_i18n_pages` 0 and 1, `ui_lang_default` fr.

### Use cases and flows to exercise (mapped to audit §8.1 and existing specs)

| # | Seat | Flow | Existing automated support | New/extended |
|---|---|---|---|---|
| UC-01 | Coordinator | Open last week's report → correct a helpdesk/infra value → submit → read the reviewer's verdict | `t2` | verdict read-back |
| UC-02 | Coordinator | Enter tracker month, try a closed month (locked), import meetings | — | E-Q09 c1 |
| UC-03 | Coordinator | Write a PV, stamp signatures (server time), close last action → resolve issue prompt | — | E-Q09 c1 |
| UC-04 | Coordinator (multi-site) | Switch site in tracker/inspections; refused on a site not held | `multi-site-editor.smoke` | browser variant |
| UC-05 | Technician | Offline inspection + photos → flaky network → 401 mid-upload → resume; refusal → resend/discard; user switch on shared phone | `t3` | E-F02 f1 |
| UC-06 | Technician | Phone storage near full → informative refusal, nothing lost after reload | `field-storage-browser` | E-F02 (g) |
| UC-07 | Group IT manager | Worst site → overdue action → assign/update → status visible in hub | `u4`, `t1` | E-Q09 c2 |
| UC-08 | Group IT manager | Meeting cockpit: prepare session, live view, minutes four-eyes | `t4` | — |
| UC-09 | Business head | Sign own department PV; cannot sign another; handoff accept | partly smokes | browser variant |
| UC-10 | Direction | Read exec-home in French: unmeasured ≠ 0 ≠ uncertified; IT Review panels | `u2`, `u5`, `t7` | wording review by seat |
| UC-11 | Finance | Asset finance with missing currency/outliers → `certified:false` with reason; investment coverage banner | `money-coverage` (unit) | E-Q09 c3 |
| UC-12 | PMO | Demand → project → baseline → capacity conflict → benefit check | none | E-Q09 c4 |
| UC-13 | RSSI | Editor A opens site B report (403); remove a role (next call refused); access request + approval (requester ≠ approver); emergency access 24 h reviewed by another super_admin; export security log | `deny-cross-site`, `i1`…`i7` | E-Q09 c5 (role removal + export) |
| UC-14 | RSSI | Change a behaviour switch with a reason → history shows who/what/why/when; rollback | — | after E-A07 |
| UC-15 | Admin | Field outbox stuck entry → diagnose → resolve (switch on in throwaway DB only) | — | after E-F01 |
| UC-16 | All seats (FR) | Keyboard-only: skip link, Ctrl+K, critical action reachable; error messages understandable in French | `t8`, `a11y-static` | seat judges wording (screen reader stays human) |
| UC-17 | Multi-country | London week/month bucketing with `site_local_calendar` off vs on; ISO vs Zoho week labels (`ui_week_labels`) | `site-time-zone`, `week-labels` | browser read-through |

### Rules of the committee

- Each seat writes findings as `defect` (with failing step) or `wording` (quote + proposed text) or `missing state`
  (null/stale/unknown not shown). No seat writes "accepted", "approved", "OK for production" or a satisfaction score.
- A finding becomes a goal only through the plan owner; behaviour changes go behind a switch (default today).
- Report per run: `docs/agent-execution/UAT-SIM-<date>.md`, header = the NOT-UAT sentence, seats, org model, commit SHA,
  scenarios run / not runnable (real SSO, real e-mail, real Meraki/OpManager, real phones, screen reader — always
  "not runnable by agents").
- The real UAT (`docs/ops/USABILITY-TEST-PROTOCOL.md`, T1–T8, SUS, E-F04 device kit) remains a human gate and is run
  by a facilitator not involved in building the screens.
