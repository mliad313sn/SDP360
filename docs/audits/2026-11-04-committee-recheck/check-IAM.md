# check-IAM — findings A01–A10 and goals G36–G52 against HEAD 367c309

Checkout: `/home/user/w/check` (detached 367c309, read-only). Proof levels: **V** = read in code, **T** = test run.
Tests run (PostgreSQL 16, PG_ADMIN_URL fixture): `tests/governance-roles.test.js`, `tests/governance-roles.smoke.test.js`,
`tests/handoff-lifecycle.test.js`, `tests/access-revocation.smoke.test.js`, `tests/auth-roles-refresh.test.js`,
`tests/business-roles.test.js` → **31 pass / 0 fail / 0 skipped**. Plus one `node -e` probe of the pure resolver (A10).
Grep for `capabilit|access_template|access_request|roster|qualification|clearance|duty_queue|astreinte|on_call` over
`*.js|*.sql|*.html` (excl. node_modules): **no IAM hit** (only unrelated words in reports.html / help.html / meetings.js).
Highest reports migration today: `056_portfolio_benefits.sql` → new work starts at **057**.

## 1. Findings A01–A10

| ID | Verdict | Evidence (HEAD 367c309) | Smallest fix | Size |
|---|---|---|---|---|
| A01 | PARTIAL (finding accurate) | `reports-db.js:392-393` ROLE_HIERARCHY (5) + FEATURE_ROLES_KNOWN (11); `userHasRole` :420-440 fails closed on unknown/bare id. Explicit refusals exist: `public/no-access.js` (needed role + who grants), `server.js:1081` `access_denied` log (G02). **No action/capability catalogue.** | G37 `services/capabilityRegistry.js` (code catalogue derived from today's guards, shadow mode) | M |
| A02 | OPEN | `routes/adminUsers.js:51-103` create/update take `roles, site_id, extra_site_ids, active` straight into `user_roles` (`001_auth.sql:42-47`: `user_id, role, granted_at` — no source, expiry, request, version) | G38 templates + G39/G40 request flow | M+L |
| A03 | PARTIAL | Identity journal is real: `adminUsers.js:15-42,98-100` (diff of roles/sites/active/email, `user_role_changed`, `password_reset` risk events to `system_log`). Missing: request id, approver, justification, validity, template version. | `access_request_events` (hash-chained) + `request_id` in the `identity` log details | S (after G40) |
| A04 | PARTIAL | Deputies live: `routes/governanceRoles.js:79-101` (super_admin for admin/role-holder/chair, shared site, no self), `services/governanceRoles.js:28,91-98` (120 d max). But a deputy is a **whole-person stand-in** (`handoffLifecycle.js:37-40` `deputyFor`, `routes/commitments.js:48-50` `principals`): no scope by role/register/site, no approver distinct from creator (`approved_by` column exists, `035:23`, only the actor is written). | G45: optional `scope_*` columns on `deputies`, NULL = today | M |
| A05 | FIXED (guard present; generalisation = G43) | `services/handoffLifecycle.js:78` delivered≠verifier, `:81` deputy cannot verify principal's work, `:83` only requester verifies; `services/commitmentLifecycle.js:54-62` same ADR-006 rule; four-eyes also on minutes/reports/publication (`governancePolicy.js:40,59,70`, `publishGate.js:35,96`) and policy relaxations (`governancePolicy.js:343-351`, proposer≠approver). T: handoff-lifecycle + governance-roles suites green. | Registry of these rules (G43) — no code change needed for A05 itself | — |
| A06 | OPEN | `services/governanceRoles.js:24` `REQUIRED = ['handoffs.escalation_target','commitments.escalation_target']`; `coverageGaps` :70-79 checks only these + matrix roles. No process/post/shift dimension. | G44 coverage engine; short-term: make REQUIRED a governance policy list (site-scoped), default = the 2 roles | S (list) / L (G44) |
| A07 | PARTIAL | `public/reports.html:1151` `#ap-users` admin panel, super_admin only (`adminUsers.js:46-114`). Guided pieces exist: `public/policies.html` + `public/lib/policiesRoles.js` (roles / deputies / matrix / gaps UI, FR/EN), `public/no-access.html` (explains missing role). No Profile / Access requests / Approvals / Coverage views. | G51 screens on top of G38–G40 APIs | L |
| A08 | NOT-APPLICABLE (positive finding, verified) | `db/postgres/reports/035_roles_deputies_escalation.sql` role_assignments / deputies / escalation_matrix / governance_role_events (append-only + hash-chained), `services/governanceRolesStore.js`. | Reuse as the socle — every design below extends it | — |
| A09 | OPEN | No table/service/route for capability, template, access request or approval (grep empty; 056 migrations reviewed). Reusable patterns exist: two-person proposals with expiry and `FOR UPDATE` (`028_policy_proposals.sql`, `governancePolicy.js:305-355`), append-only + hash-chain triggers (`028`, `034`), site policy bundles (`services/governanceProfiles.js` — site policies, NOT user profiles). | G37+G38+G40 | L |
| A10 | OPEN — and a concrete defect | Resolver has **no notion of account state**: `governanceRoles.js:36-41 holders()` / `:59-68 escalationTarget()` / `coverageGaps()` use role/deputy rows only; `governanceRolesStore.js:22-26` snapshot does not join `users.active`. Probe: a holder (user 7) counts as covering `handoffs.escalation_target` and is the escalation target regardless of being deactivated → **coverage reads green, escalation goes to a dead account**. Site of a deputy is checked only at naming (`routes/governanceRoles.js:96`), not when the deputy later loses the site. One level only (no chain), no on-call / group fallback beyond the matrix `*.group_escalation` rows. | (a) pass `activeUserIds`/user sites into the resolver; inactive holders → reported as `inactive_holder` gap; escalation skips them and falls to deputy / next matrix level — behind policy `governance.skip_inactive_holders` (default `false` = today; recommend `true`). (b) G44/G46 duty queue + on-call. | S (a) / L (b) |

## 2. Goals G36–G52 — what exists vs what is missing

Legend: **E** exists (V/T), **P** partial, **M** missing.

| Goal | Verdict | Exists today (reuse) | Missing | Size |
|---|---|---|---|---|
| G36 Baseline audit | PARTIAL | `docs/ops/AUTHZ-MATRIX.md` (520 routes, generated by `tests/authz-route-matrix.test.js`); `services/roleAudit.js` + `tools/pg/audit-roles.js` (over-privileged / site-less classification); `roleDemotion.js`; INVENTORY.json; G02 access-denied log | The matrix records **only the session guard** (column "Guard" = `requireReportSession` for every row; 0 role guards listed) and misses inline checks (`isAdmin(...)` inside handlers). No user → responsibility → route → action map, no SoD draft | M |
| G37 Capability catalogue | OPEN | role strings (`reports-db.js:392-393`), feature roles, `uiPolicy.js:32`, `no-access.js` labels | catalogue, risk classes, resource types, evaluator | M |
| G38 Access templates | OPEN | `governanceProfiles.js` pattern (bundle applied rule-by-rule through the guarded store) | tables, versioning, diff preview | M |
| G39 Template onboarding | OPEN | `POST /api/reports/users`, SSO pre-provisioning (`services/ssoProvisioning.js`) | wizard, "pending user sees nothing unapproved" | L |
| G40 Request / approval FSM | OPEN | two-person proposal engine (`028`, `governancePolicy.js:305-355`): proposer≠approver, expiry, `FOR UPDATE`, dup-pending 409 | access_requests, events, approver eligibility | L |
| G41 Qualifications ≠ permissions | OPEN | blobStore for evidence files; nothing else | evidence registry, prerequisite check | M |
| G42 Single evaluator, server-side | PARTIAL | **Stale sessions solved**: every request re-reads the user + roles (`reports-db.js:722-734`, `active=1`), proven by `tests/access-revocation.smoke.test.js` (T); site scope via `services/userSites.js`; central read guard + `_reportWriteDenial` family; `public/auth.js` re-sync of cached roles | one evaluator combining grants ∩ site ∩ dates ∩ qualification ∩ SoD; adversarial route matrix beyond reports | L |
| G43 SoD policy | PARTIAL | rules exist but scattered (A05 list); protected four-eyes policies with two-person relaxation | declarative registry, versioned; template-conflict check | M |
| G44 Rosters / coverage | OPEN | `site_calendar` (037, holidays/shutdown), `workCalendar.js`; A-13 (capacity/absences) was **not built** (no `absence`/`weekly_hours` anywhere) | roster table, coverage engine, timezone/DST | L |
| G45 Scoped deputies | PARTIAL | deputies table + 120-day cap + super_admin rule for admins/role holders/chairs + no-self + shared-site + SoD of deputy vs principal (A04/A05) | scope (roles/registers/site), distinct approver, live re-check of deputy activity/site, explicit "no re-delegation" test | M |
| G46 Duty queues | OPEN | handoffs addressed to a **named** `receiver_id` + reassign (`handoffLifecycle.js:92-104`) + account-less contact proxy (`handoffs.proxy_accept`); commitments owners are **free text** (`021_commitments.sql:9`); field claims (`042`) | queue receiver, eligibility, orphan report on deactivation | L |
| G47 Shift handover journey | OPEN (interdepartmental handoff ≠ shift handover) | receiver-only accept / reason-required refuse, deputy acts_for, idempotency pattern (`030_session_idempotency.sql`), field outbox (`services/fieldOutbox.js`) | shift handover object, acceptance, escalation of unaccepted | M |
| G48 Coverage / access dashboards | OPEN | ChartSpec/dashboardWidgets, gaps list in policies.html, oversight register | indicators fed by G40/G44 data | M |
| G49 Emergency access | OPEN | nothing (super_admin is the only break-glass; SSO break-glass user exists for login only) | emergency request kind, short expiry, post-event review | M |
| G50 JML / recertification | PARTIAL | revocation on next request (T); `roleAudit`/`roleDemotion` plan + `demote-coordinators` CLI with `--apply`/`--restore`; identity journal | grant expiry job, recertification campaign, orphan reassignment, site-transfer recompute | M |
| G51 IAM screens | PARTIAL | policies.html roles/deputies UI (FR/EN), no-access page, My work (`services/myWork.js`, A-10) — but My work **ignores deputised work** (no `principals` in `services/myWork.js`/`routes/myWork.js`) | My access, Templates, Requests, Approvals, Coverage, Shift handover | L |
| G52 E2E gates | OPEN | 31 relevant tests green (above) | R01–R08 rotation fixtures, grant/approval/failover/SoD suites, flag rollout | L |

## 3. Lean, additive design (reuses the 035 socle; no parallel identity engine)

**Principle.** `users` + `user_roles` + `user_sites` stay the single place the platform reads at request time
(`validateSession` already reloads them each request). New tables record **why and until when** a role/site is held, and
a request/approval trail that writes into those same tables through the existing `rdb.updateUser` path (so the identity
journal keeps logging). Capabilities are a **code catalogue that maps onto today's roles** — they add names, risk and
refusal reasons, never rights. Every behaviour change sits behind a `report_config` key in `services/reportConfig.js`
DEFAULTS (or a governance policy for site-scoped rules) whose default reproduces today.

### Switches (all default = today)
| Key | Default | Effect when on |
|---|---|---|
| `authz_capability_mode` | `off` | `shadow`: evaluator runs beside legacy guards, logs divergence (`category:'authz'`); `enforce` later, route by route |
| `access_require_approval` | `0` | Admin ▸ Users refuses adding a role marked `requires_request` without an APPROVED request (super_admin break-glass allowed, logged risk=1) |
| `access_grant_expiry_job` | `0` | nightly job ends expired grants (removes the role only if no other live grant/legacy-direct source holds it) |
| `qualification_check_enabled` | `0` | capabilities with `prereq` deny when evidence absent/expired/out-of-site |
| governance policy `governance.skip_inactive_holders` | `false` | resolver drops inactive / site-less holders & deputies (A10 fix) |
| governance policy `handoffs.queue_receivers` (site) | `false` | a handoff may be addressed to a duty queue |
| `shift_handover_enabled` | `0` | shift handover pages/routes live |
| `emergency_access_enabled` | `0` | emergency request kind accepted |

### Migrations (reports, starting 057; ADDITIVE, idempotent, append-only/hash-chain via existing `sdp_append_only`/`sdp_hash_chain`)
- **057_access_templates.sql** — `access_templates(id, key UNIQUE, title_en/fr, owner_user_id, intended_position, retired_at)`;
  `access_template_versions(id, template_id, version, status draft|published, payload JSONB {roles[], site_rule primary|listed, governance_roles[], max_days}, published_by, published_at, UNIQUE(template_id,version))` — published rows immutable (trigger).
- **058_access_requests.sql** — `access_requests(id, kind grant|extend|emergency|revoke, subject_user_id, requested_by, template_version_id NULL, roles TEXT[], site_ids INT[], valid_from, valid_to, justification, status, decided_by, decided_at, decision_reason, policy_version, created_at)`;
  `access_request_events` (append-only, hash-chained); `access_grants(id, user_id, role, site_id NULL, request_id, template_version_id, valid_from, valid_to, ended_at, ended_by, end_reason)` — provenance of a role in `user_roles`. Existing `user_roles` rows = provenance `legacy` (no backfill row needed: absence of grant = legacy).
- **059_qualification_evidence.sql** — `qualification_evidence(id, user_id, kind, reference, issuer_text, issued_on, expires_on, site_id NULL, verified_by, verified_at, revoked_at, blob_ref NULL)`; manual entry only (no HR/HSE connector).
- **060_deputy_scope.sql** — `ALTER TABLE deputies ADD COLUMN IF NOT EXISTS scope_registers TEXT[], scope_roles TEXT[], site_id INTEGER` (NULL = whole-person, today).
- **061_duty_rosters.sql** — `duty_rosters(id, site_id, duty_family, user_id, starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ, kind planned|confirmed|leave|roster_off, source manual|csv, entered_by, removed_at)`; `ALTER TABLE handoffs ADD COLUMN IF NOT EXISTS receiver_queue TEXT` (+ `receiver_id` stays NOT NULL semantics after accept — queue items keep `receiver_id NULL` only while queued; check the 026 constraint first).
- **062_shift_handovers.sql** — `shift_handovers(id, site_id, duty_family, from_user, to_user, items JSONB snapshot, status pending|accepted|refused|escalated, reason, idem_key UNIQUE, created_at, decided_at)` + events.

### Services (pure first, store second — repo pattern)
- `services/capabilityRegistry.js` (pure, G37): `{ id, en, fr, risk low|med|high|critical, resource, legacy: [roles], scope 'site'|'platform', requires_request, prereq: [kinds] }`; generated seed from the authz-matrix walk + inline checks. `effectiveCaps(user)` and `can(user, cap, {siteId, now, grants, quals})` — unknown cap → deny. Test: for every role set, `can` ≡ legacy guard result (zero escalation).
- `services/authorizationService.js` (G42): wraps `userHasRole` + `userSites.hasSite` + grant validity + qualifications + SoD registry; returns `{allow, reason_code, needed}` used by `no-access` and logs.
- `services/accessTemplateStore.js`, `services/accessRequestStore.js` + pure `services/accessRequestLifecycle.js` (copy the `handoffLifecycle.check` style): REQUESTED→REVIEWING→APPROVED|REJECTED→ACTIVE→EXPIRED|REVOKED; requester/subject ≠ approver, deputy of requester ≠ approver, approval tied to user×site×role×dates (not template-wide), stale `policy_version` → re-review; ACTIVE = one transaction writing `access_grants` + `user_roles`/`user_sites` via `rdb.updateUser`.
- `services/sodPolicy.js` (G43): declarative list of the existing rules (A05) + `conflicts: [[roleA, roleB]]` checked at template publish and at approval.
- `services/coverageEngine.js` (G44, pure): `(rosters, assignments, deputies, grants, quals, activeUsers, calendar, window, tz)` → per site × duty × slot `covered | gap | unknown` (no roster rows = `unknown`, never green).
- Resolver fix (A10): `governanceRoles.holders/escalationTarget/coverageGaps` accept optional `{ active: Set<userId>, sitesOf }`; absent = today.

### Routes (factories in `routes/`, DI like `routes/governanceRoles.js`)
`routes/access.js`: `GET /api/access/me` (my roles, grants, expiry, deputies, why-denied), `GET/POST /api/access/templates[/:id/versions|/publish|/retire]` (super_admin), `POST /api/access/requests`, `POST /api/access/requests/:id/{review,approve,reject,revoke}`, `GET /api/access/approvals` (my queue), `GET/POST /api/access/qualifications` (admin tier record, verifier ≠ subject). `routes/duty.js`: rosters CRUD + CSV import (simulate by default, `?apply=1`), `GET /api/duty/coverage`, shift handovers. All registered in the authz matrix test.

### Screens (G51)
`public/access.html` (tabs: My access · Requests · Approvals · Templates), `public/coverage.html` (site × duty × shift grid, unknown hatched), shift handover inside `public/handoffs.html` (new tab), "Request this access" button on `no-access.html` pre-filling a request; policies.html keeps roles/deputies. FR/EN via existing pattern; `_shell` entries hidden when caps absent.

## 4. Per-item sections (OPEN / PARTIAL)

**A01 / G37 — capability catalogue (M).** First failing test: `tests/capability-registry.test.js` asserts for each of the 16 role strings and each catalogued route that `can()` equals the legacy gate and that an unknown id denies. Build catalogue from G36 matrix output; shadow mode only.

**A02 / G38 / G39 — templates and onboarding (M + L).** Failing test: publishing a template whose payload holds an unknown role → 400; publishing v2 does not change any `user_roles`; applying a template creates a REQUESTED request, not roles. Onboarding wizard calls existing `POST /api/reports/users` with `roles: ['viewer']` (or none) then files the request. **Trap:** `services/ssoProvisioning.js` *replaces* roles from the Entra group map on every login — must union live `access_grants` or approved roles get wiped on next SSO login; its `FEATURE_ROLES` set (`:14`) also lacks field-tech/committee-member/dashboard-publisher/finance-viewer/site-business.

**A03 — audit of who/why/until (S).** Add `request_id`, `grant_id`, `valid_to` to the `identity` log details when the change comes from an approval; the request events table carries approver + justification.

**A04 / G45 — scoped deputies (M).** Columns in 060, NULL = today. `deputiesOf/principalsOf` filter by register/role when scope set; `handoffs`/`commitments` routes pass the register. New guard: approver ≠ creator when `approved_by` is required (policy `governance.deputy_second_person`, default false). Tests: out-of-scope deny, expiry, absent deputy (inactive) skipped under the A10 switch, no chain (deputy of a deputy is not a deputy — assert explicitly).

**A06 / G44 — coverage beyond two roles (S then L).** Step 1: governance policy `governance.required_roles` (site-scoped list, default the two current roles) read by `coverageGaps`. Step 2: rosters + coverage engine. Tests: DST/timezone (sites are GMT today; keep tz column), overlapping rotations, leave, missing qualification, single holder, cross-site fallback.

**A07 / G51 — guided screens (L).** Depends on G38–G40 APIs; keyboard + phone tests with the existing Playwright/a11y harness if present (G21).

**A09 / G40 — request/approval FSM (L).** Copy the proposal engine semantics (FOR UPDATE, expiry, proposer≠approver, dup-pending 409). Tests: unauthorised decision, duplicate decision, stale policy, rejection, lost approver (approver deactivated → request returns to REVIEWING), scope extension → re-approval.

**A10 — inactive holders (S) + duty queue (L).** Failing test (pure): holder with `active=false` → `coverageGaps` reports `inactive_holder`, `escalationTarget` targets deputy/next level, under switch on; switch off → identical to today. Store passes active ids from `users`.

**G36 (M).** Extend `tests/authz-route-matrix.test.js` to record every middleware name (not only the first guard) and add a static scan of `userHasRole(..., '<role>')` inside each route file → columns `guard · roles · site-scope helper`; write the SoD draft from A05.

**G41 (M).** Evidence registry + `prereq` in the catalogue; evaluator only adds denials. Manager view shows "missing/expired evidence, ask <issuer>", never the document to unauthorised readers.

**G42 (L).** Shadow evaluator first; adversarial matrix (substituted site_id, revoked grant, expired grant, client-supplied actorId) per migrated route. Stale-session part already FIXED (V+T above).

**G43 (M).** `sodPolicy.js` registry; `policy_version` = hash of the file; template publish + approval check conflicts; exceptions only via G49.

**G46 (L).** Handoff `receiver_queue`: any eligible on-duty holder of the queue role may accept (becomes `receiver_id`, SLA/due date untouched); orphan report: open handoffs/commitment `reviewer`/role assignments held by a deactivated user (CLI simulate, `--apply` requeues). Commitment free-text owners cannot be routed — needs an `owner_user_id` decision (out of scope here).

**G47 (M).** Shift handover object; only `to_user` (or their in-scope deputy) accepts; refusal needs reason; unaccepted after policy hours escalates through the existing matrix with a new register `shift_handovers`; idempotent accept via `idem_key`; offline via field outbox.

**G48 (M).** Indicators: grants expiring ≤ 14 d, requests ageing, time-to-accept handovers, coverage unknown/gap, orphan items. `unknown` never green (BOUNDARIES §6).

**G49 (M).** `kind='emergency'`: max validity (policy, e.g. 8 h), second approver mandatory (never the beneficiary, never AI), risk=1 log, mandatory post-event review record within N days, never satisfies a qualification `prereq` (IT access ≠ mine-site permission).

**G50 (M).** Expiry job (armed off), recertification campaign (owner reviews each live grant: keep / end), site-transfer recompute (grants with `site_id` not in new sites → end + notify), reuse `roleDemotion` planner style (simulate → `--apply`).

**G52 (L).** Fixtures for R01–R08 (scenario list lives in the committee report, not in the repo — needs copying), plus grant/approval/failover/stale-session/multi-capacity/SoD suites; register in `tests/.suite-manifest.json`; flags flip per pilot site.

## 5. Needs a human / business decision
1. **Approvers**: who may approve which role/site (approver matrix) and whether two approvals are required for `admin`/finance/`field-tech`; who approves emergency access. Default proposal: a super_admin other than the requester (mirrors policy proposals).
2. **Sensitive roles list** (`requires_request`) and **SoD conflict pairs**.
3. **Roster data**: duty families, rotation patterns (14/14, 21/7…), who enters rosters, timezone per site, what "on duty confirmed" means — no HR connector, so manual entry or CSV is the only source.
4. **Qualification kinds and issuers** (electrical, confined space, site induction…), who may record/verify evidence, retention — HSE owner; no HSE/OT connector (BOUNDARIES).
5. **Required roles per site** (beyond the two escalation targets) and minimum coverage per shift.
6. **Flip of `governance.skip_inactive_holders`** (recommended on; it fixes A10's dead-account escalation).
7. **Commitment owners as free text**: whether to add `owner_user_id` so commitments can join queues.
8. **D-14** (department-level grants, already blocked in G02) — templates can carry departments only after this decision.
9. Pilot site and acceptance for G52 — business acceptance cannot be produced by an agent.
