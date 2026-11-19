# P11 qualification — Security seat — ROUND 2

**AI review — not an independent human review.** Reviewer seat: security. I did not write this code and did not modify it.

- Frozen SHA: `b2e85cd08860a57526442797ac711e2fc9defc3a` (clone `/home/user/qual/security`, `git log -1` = b2e85cd; working tree untouched except the intentionally removed `docs/agent-execution/` narratives, not read).
- Round-1 file (unchanged): `/home/user/qual/out/security.md` (SHA 7eee895).
- Raw logs: `/home/user/qual/out/sec-logs/r2-probe.log`, `r2-batch.log`, `r2-outcomes.log`; throwaway probe copy `r2-probe.test.js.txt` (run from the scratchpad, never committed).
- Env: PG shared (max_connections 400), `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres`, Node from `/home/user/SDP360/node_modules`.

## 0. Round-1 findings — fixed or not (re-run of the original repro)

| R1 | Claim at trunk | Re-test at b2e85cd | Verdict |
|---|---|---|---|
| F1 (P1) editor shares group-wide run publicly; any session reads executive group runs | fixed by 57c7afe (`routes/engagement.js:91,109`, `routes/reportStudio.js:63-71,107`) + `tests/report-run-group-share.smoke.test.js` | Round-1 repro re-run: editor share → **403**; viewer GET run → **403**; viewer `.html/.pdf/.pptx/.xlsx` → **403** ×4; viewer list no longer contains the run; viewer share → 403; committee-member reads executive run → 403, council run → 200 (by design). Pre-fix link minted by an editor (inserted via store) → `/share/<tok>` **404**; admin link → 200 | **FIXED** (residual R2-N2, P3) |
| F2 (P1, policy) committee-member reads portfolio amounts | not claimed fixed | Outcome probe still reports the 6 known hits on `/api/governance/portfolio*` as `f:committee-member`; `KNOWN_OUTCOME_MONEY` unchanged (`tests/_rbac-matrix-core.js:480`) | **NOT FIXED — human decision pending** (Finance + InfoSec) |
| F3 (P2) dash key injected into session pages, not account-bound | not claimed | `services/reportConfig.js:532` still `ui_inject_dash_key:'1'`, `dashkey_scope_mode:'open'` | **NOT FIXED** (needs D-15) |
| F4 (P2) CSP strict on 2 built-in pages + share only | not claimed | `services/sessionAuth.js:23` unchanged | **NOT FIXED** (residual accepted as progressive work) |
| F5 (P2) money sentinels partial (no finance actuals / EVM / WAN credit) | not claimed | `MONEY_SENTINELS` unchanged (`tests/_rbac-matrix-core.js:476`); EVM code changed in f122864 with no new sentinel | **NOT FIXED** |
| F6 (P3) dashboard share to another site not exercised | — | Seeded published dashboard (`governance`): editor share site B → **403**, site A → 200, `site_id:'abc'` → 403 | **CLOSED (holds)** |
| F7, F8 (P3) | — | not re-tested | open |

## 1. Evidence re-run at b2e85cd (command · result)

Prefix: `NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" node --test --test-force-exit <files>`.

| # | Evidence | Result | Status |
|---|---|---|---|
| E1 | `tests/authz-outcomes.smoke.test.js` | 5/5 pass, 258 s; 2 982 non-reader bodies scanned, 28 reader hits (positive control), 6 known committee exceptions (F2), money-named keys `budget`/`spent` for committee only | VERIFIED |
| E2 | authz-matrix-json, authz-route-matrix, authz-handler-checks, rbac-external-writes, rbac-matrix.smoke, rbac-mutation.smoke, rbac-scope-frozen.smoke, rbac-ui-gates, rbac-write-scope.smoke, 7 × csp-*, session-security.smoke, secret-scan, report-run-group-share.smoke (18 files, one run) | **106/106 pass**, 0 skip, 93 s (no PG exhaustion this round) | VERIFIED |
| E3 | `node tools/security/secret-scan.js --check` | "no credential in the tracked files", exit 0 | VERIFIED |
| E4 | `node tools/security/csp-journey-report.js --check` | up to date, exit 0 | VERIFIED |
| E5 | `node tools/security/retention-inventory.js --check` | up to date, exit 0 | VERIFIED |
| E6 | `npm audit --omit=dev` | found 0 vulnerabilities (registry-dependent, 2026-11-19) | VERIFIED |
| E7 | Round-1 F1 repro + new probes (§2) | 5/5 probe tests executed | VERIFIED |
| E8 | `authz-divergence-report.js`, `dashkey-consumers.js` (no `--check` mode) | not run | NOT VERIFIED |
| E9 | access-revocation, dashkey-only-routes, export-share-boundary, SSO/Entra, route-authz suites (not assigned) | not run | NOT VERIFIED |

**7 verified, 2 not verified.** No full suite run (not assigned).

## 2. New claims I tried to break (one per capability)

| Cap. | Claim | Attack | Outcome |
|---|---|---|---|
| Site scope / notifications | Report content reaches a non-author only through `visibleRun` (site + audience) | Site-A **viewer** `POST /api/engagement/subscriptions {kind:'report_template', target_key:<site-audience template>}` and the same on an **executive** template; run `generateScheduledReports('weekly')` (the `reports.weekly` job, scheduled by default) | **BROKEN** — 200/200; viewer received 12 notifications, one per site **including other sites** + the executive pack, title `<template> — <OtherSite> ready for review`, body = run headline (`"<Site>: N red indicator(s) and M worsening trend(s) across x/y measured."`). Visible via `GET /api/engagement/notifications`. → **R2-N1** |
| Share links | A dead (pre-fix) non-admin link stays dead | Promote the creating editor to admin afterwards | Link **revives** (200) — view-time check reads the creator's CURRENT roles; admin demoted → its links die (404). → R2-N2 (P3) |
| Dashboard share | Editor cannot share for another site | seeded published dashboard, site B / NaN / `"<A>.0"` | 403 / 403 / 200 (coerces to own site — harmless) — holds |
| Metrics scope | non-admin site-scoped | editor `?site=<B>` | 403 — holds |
| External API | key header-only | `?api_key=` / none | 400 / 401 — holds |
| Dash key | not a session credential | key alone on `/api/data/requests-raw` | 401 — holds |
| Session | token never from query | `/api/reports/auth/me?token=` | 401 — holds |
| Field (code reading, fix 4) | field path never rewrites another record | `routes/field.js:160-167`: existing f_id check runs AFTER the site-scope check on `meta.f_site` but uses the *id*, so a site-A editor sending own-site meta with a site-B inspection id gets 409 with `(<status>)` | write refused (holds); **existence/status oracle** of any inspection id → R2-N3 (P3), not executed |

## 3. Findings (round 2)

### P0 — none.

### P1 — none open in code. F2 stays a **policy** blocker (human decision), carried from round 1.

### P2

**R2-N1 (P2) — Subscriptions bypass site scope and report audience: any session is notified of every site's (and the executive pack's) report status.**
- Where: `services/engagementStore.js:84-90` `subscribe()` accepts any `report_template` key for any user (no audience/site check); `services/engagementJobs.js:122` filters `if (site && s.site_id != null && …)` but the `subscriptions` table has **no `site_id` column** (`db/postgres/reports/019_reports_engagement.sql:26`) → the filter is dead code, every subscriber gets every site's notification. `reports.weekly`/`reports.monthly` (`services/sync/jobs.js:159-160`) are scheduled with no arm switch.
- Leak: other sites' names + red/worsening indicator counts of DRAFT (unreviewed) runs + executive pack headline; in-app now, and in e-mail digests when a digest channel is armed. No amounts, no ticket PII; the link itself is refused by `visibleRun`.
- Repro: `/home/user/qual/out/sec-logs/r2-probe.test.js.txt` test 3 (stubs `generateRun` to avoid needing data; the subscription/notify path is the real code).
- Regression test to add: site-A viewer subscribed to a site template receives only site-A notifications; a viewer cannot subscribe to an executive/council template (or is never notified of it).
- Fix direction (not applied): filter on the subscriber's `userSites` at notify time (and audience for group templates via the same `groupRunReadable` rule); validate at subscribe. Rollback risk low (narrows).
- Rated P2 not P1 because content is status counts, not amounts/PII; **raise to P1 if headlines/digests are later extended with figures.**

Carried: F3, F4, F5 (P2, unchanged — see §0).

### P3
- **R2-N2** share view re-checks the creator's *current* roles (`routes/engagement.js:109`): a pre-fix editor link revives if that editor is later promoted. Fix: revoke non-admin `report_run` links on site-less runs once at deploy (no data written by me).
- **R2-N3** field 409 discloses existence + status of an arbitrary inspection id across sites (ids are date+4 digits, enumerable). Return the same 409 without status, or 403 when the existing row is out of scope.
- F7, F8 from round 1 still open.

## 4. Optimistic claims challenged
- "F1 fixed" — true for share, read, list and all four exports; but a second channel (subscriptions → notifications) carries the same group/other-site report signal without the audience rule (R2-N1).
- "authz-outcomes covers every route" — still seed-dependent: it has no subscription + scheduled-generation scenario and no site-less run.

## 5. Per P03 lot — AI panel recommendation, not a decision

| Lot | Recommendation |
|---|---|
| L01 Daily work | GO PILOT |
| L02 Portfolio reading | CONDITIONAL — F2 decided by Finance/InfoSec and recorded |
| L03 Change control | GO PILOT |
| L04 Scheduling/collab | GO PILOT |
| L05 Time, money, benefits | CONDITIONAL — F2 decided + F5 sentinels (finance actuals, EVM) in the outcome probe |
| L06 Plan exchange | CONDITIONAL — not reviewed in depth by this seat |
| L07 Roadmap publication | CONDITIONAL — F1 fixed (verified); still needs one executed roadmap-share test with amounts seeded |
| L08 Governance cadence | GO PILOT |
| L09 KPI trust | GO PILOT |
| L10 Reporting rhythm | CONDITIONAL — R2-N1 fixed (or `reports.*` jobs kept off / subscriptions to report templates disabled for the pilot) and pre-fix share links revoked (R2-N2) |
| L11 Site ops evidence | CONDITIONAL — F5 sentinels for certified asset money |
| L12 Access hardening | CONDITIONAL — break-glass drill evidence + InfoSec gate |
| L13 Ops resilience / identity | CONDITIONAL — pair with F3 / D-15 |

## 6. Human gates still empty in this area (`docs/sdp360/completion/RELEASE-GATES.md`, all rows empty at b2e85cd)
- Security — access policy CG-01/CG-02, authz matrix (G-03…G-08) — Information Security
- Security — threat model and findings register (G27) — Information Security
- Signing key and CI action SHAs D-12 (G-09) — Information Security + CI owner
- Connectors D-07/D-08/D-09, dash-key clients D-15 — platform owners (F3)
- Finance — budgets and benefits (G14) — Finance (F2)
- Report authority and channels D-13 (G-13/G-25) — (R2-N1 touches channels)
- Penetration test / accepted analysis (E-B05, X-B-03) — Information Security
- QA lead — CI green on target SHA (E-B05); Production deployment GO/NO-GO — CAB

No approval, signature or production readiness is claimed or implied by this file.
