# Committee review — 2026-10-28 (governance policies, handoffs, sessions, commitments, publication)

Six seats read the code of `claude/sdp360-consolidation` (read-only, nothing run) with the Endeavour Mining
context (5 mines + 4 offices, ServiceDesk Plus as system of record, monthly site meetings, Mine IT Council,
group IT committee). This register lists every finding and what was done with it.

**Status words.** FIXED = changed in code and covered by a test named in the row. DOC = written down, no
code change needed. DECISION = for the committee; nothing was decided on its behalf. OPEN = accepted, not
done yet. A FIXED row is TESTED in-process only — none is FIELD_VALIDATED.

Seats: CIO (operating model, COBIT 2019 / ITIL 4) · ARCH (enterprise / platform architect) · FIELD (site IT
coordinator, Houndé) · AUDIT (internal audit / ITGC) · SEC (group ISO, ISO 27001) · QA (test strategy, ISO/IEC 25010).

## Findings and outcome

| # | Seat(s) | Finding | Status | Where / proof |
|---|---|---|---|---|
| 1 | AUDIT P0-1, SEC P1-2, CIO P2-9 | One super_admin could switch a four-eyes rule off, use the gap, switch it back | FIXED | Relaxing a protected rule is a proposal approved by a **different** super_admin (`governance.dual_approval_relaxations`); approved relaxations expire (`governance.relaxation_max_days`, 90 d). `governance-policy.test.js`, `governance-policy-routes.smoke.test.js` |
| 2 | AUDIT P1-2, SEC P1-4, ARCH P1-5 | Policy write and history not atomic; history and event tables editable | FIXED | One transaction + per-rule advisory lock; trigger `sdp_append_only` on `governance_policy_history`, `handoff_events`, `commitment_events`, `closure_verifications` (migration 028); handoff / commitment transitions write state + event atomically |
| 3 | ARCH P1-1, QA P1-6, AUDIT P1-3 | Switching commitment escalation off for a site "cleared" its open A01/A02 rows | FIXED | Muted sites are left out of the diff on both sides (`muted` count returned); a reopen keeps `opened_at`. `commitment-escalation.test.js` |
| 4 | SEC P1-1 | Session actions changeable by id through any session (IDOR) | FIXED | `WHERE id=? AND session_id=?`, 404 otherwise, logged. `governance-routes.smoke.test.js` (IDOR test) |
| 5 | AUDIT P1-5, QA P2 | A missed session could be rescheduled to erase the miss | FIXED | `reschedule` from stage *missed* → 409 `MISSED`; reschedules logged `session_rescheduled`. `governance-routes.smoke.test.js` |
| 6 | QA P2 | Two runners closing the same session at once both succeed | FIXED | Start / close / cancel / reopen are conditional on the current status and bump `meeting_sessions.version` (migration 029); a lost race is 409 |
| 7 | QA P1-1 | Dashboards / trackers: an edit landing between the four-eyes check and the write was published unreviewed; two publishes could both write a version | FIXED | The publish claims the row only if it is still the draft that was read (`updated_at` / `submitted_at` compare-and-set); otherwise 409 `STALE`. `dashboard-store.test.js` (edit-after-read + two concurrent publishes → one version) |
| 8 | QA P1-2, ARCH P2-2 | A resumed overdue handoff was re-escalated every hour | FIXED | `handoffs.escalated_for_due` remembers the due date already escalated; the job runs in one transaction. `handoffs.smoke.test.js` |
| 9 | QA P1-3, SEC, ARCH P2-2 | Two handoffs created at once collided on `ref` (500) | FIXED | `handoff_ref_seq` sequence, refs `HO-YYYY-NNNN` |
| 10 | QA P1-4 | Two commitments could be created for the same source | FIXED | Unique partial index on the origin link (migration 029) + the store returns the existing commitment on conflict |
| 11 | AUDIT P2-10 | An admin could verify a handoff in place of the requester | FIXED | Only the requester verifies; admin acts are recorded `acting_for`. `handoff-lifecycle.test.js` |
| 12 | SEC P1-3 | Commitment reviewer matched by free text (full name, typed id) | FIXED | Verification rights follow username / e-mail only; visibility no longer uses the full name; refusals keep the broad match. `commitment-lifecycle.test.js` |
| 13 | AUDIT P1-4 | A scheduled report run (no creator) could be reviewed and published by one person | FIXED | Reviewer ≠ publisher when the creator is the system (`SOD_PUBLISH_REVIEWED`). `governance-policy-coverage.test.js` |
| 14 | AUDIT P1-7, SEC P2 | A published tracker / dashboard could be retired then deleted with its versions; unlogged | FIXED | Anything ever published is retired, never deleted (409); retire / delete logged. Store + route tests |
| 15 | AUDIT P1-8 | Risk events kept 24 months, governance events 12 | FIXED | Risk and governance-class categories kept ≥ 7 years (`purgeSystemLog`, floor 84 months, `AUDIT_RISK_RETENTION_MONTHS`) |
| 16 | AUDIT P1-9, CIO P2-9 | No exceptions register for overrides and relaxations | FIXED | `GET /api/governance/oversight` (JSON + CSV, names resolved). Committee sign-off of the register stays a human act |
| 17 | AUDIT P2-13, SEC P2 | Reason minimums not protected; grace up to 720 h | FIXED | Reason minimums protected (lowering = relaxation); `meetings.missed_grace_hours` max 168 |
| 18 | ARCH P1-2 | Per-process policy cache, invalidation reached only the writer | FIXED | Version check (`MAX(id)` of the history) on read; reloads on change everywhere |
| 19 | ARCH P2-1, SEC P2 | A policy read failure fell back to defaults (dropping stricter site values) | FIXED | Last good snapshot kept; invalid stored values logged `invalid_policy_value` |
| 20 | ARCH P1-3 | Freshness limits defined in three places | FIXED (partly) | Policy defaults now come from `jobs.js` `FRESHNESS_HOURS`. OPEN: `/api/sync/health` to read the policy override too |
| 21 | ARCH P1-4, QA P1-7, AUDIT P2-12 | Overview compliance used the global policy, detail used the site policy | FIXED | `complianceByContext`: each cadence judged with its site's policy. `governance-policy-routes.smoke.test.js` |
| 22 | QA P1-5 | Seven parameters had no behaviour test | FIXED | `governance-policy-coverage.test.js`: one probe per parameter; a parameter without a probe fails the test |
| 23 | QA P1-8 | Tests that expire on 2026-12-03 / 2027-01-05 | FIXED | Dates relative to `Date.now()` |
| 24 | SEC P2 | Receiver lookup let an editor probe accounts | FIXED | One message for unknown / inactive / other-site; site-scoped picker `GET /api/handoffs/people?site=`. `handoffs.smoke.test.js` |
| 25 | SEC P2 | `/ext` served draft KPIs; unmapped source read FRESH | FIXED | Only published metrics leave the platform; unmapped → UNKNOWN |
| 26 | SEC P2 | Group-level sessions readable by any account | FIXED | Committee, chair / secretary and named participants only (lists and detail). Decisions register stays readable (outcomes are meant to be communicated) — DECISION if the committee wants it closed too |
| 27 | SEC P2 | `idem_key` and a fixed 5-character probe in handoff responses | FIXED | `idem_key` never returned; `can_reassign` probed with a 500-character reason |
| 28 | SEC P2, QA P2 | Empty `IN ()`, negative history limit | FIXED / already guarded | Lists return `[]` before querying; history limit clamped to 1–1000 |
| 29 | FIELD P1-5 | `prompt()` dialogs fail in Teams webview / in-app browsers | FIXED (component) | `public/lib/reasonDialog.js` (accessible, character counter, no innerHTML). OPEN: wire it in handoffs, cockpit, policies, composer, tracker builder |
| 30 | FIELD P0-2, P1-6, P2-11/13 | Cockpit / policies pages English, server errors English | OPEN | Next batch: cockpit EN/FR, error codes translated client-side |
| 31 | FIELD P1-3, P1-4 | Meeting notes lost on reload; double tap records a decision twice | OPEN | Next batch: notes autosave to a local draft; `idem_key` on decisions / actions |
| 32 | FIELD P1-7 | Handoff form asks for a site id and a username | OPEN (API ready) | List response carries `sites`; picker endpoint exists; page to use them |
| 33 | FIELD P1-10 | "Passation" means a post handover in BF/CI; past-participle buttons | OPEN | Vocabulary "Demande inter-services", verb buttons |
| 34 | FIELD P0-1 | Department heads without an account cannot take part in a handoff | DECISION | Options: contact receivers, coordinator "on behalf of" with a note under a site policy, light accounts. Changes the "never on behalf" invariant — the committee decides |
| 35 | FIELD P1-9 | One-person sites accumulate minutes nobody can accept | DECISION | Site profiles (presets) vs. delegate-to-group reviewer; see #37 |
| 36 | FIELD P1-8 | Escalation notifies nobody while notifications are off | DECISION | Arm `handoff_notify_enabled` per site; name escalation targets (needs #38) |
| 37 | CIO P0-3, ARCH next, FIELD rec. 1 | No site profile / template; onboarding a mine is code work | DECISION + OPEN | DEC-4 (hardcoded site aliases); profiles "Grande mine / Petite mine / Bureau" built on the policy registry |
| 38 | CIO P0-1, P0-2, P1-4 | Roles, RACI, escalation matrix and deputies fixed in code | DECISION | ADR to write: roles and escalation matrix as data (process × site × role; severity × site × time → role), effective-dated, with deputies |
| 39 | CIO P1-7 | Four registers track overlapping obligations | DECISION | Commitments as the single ledger; handoffs a commitment kind; actions as linked sources |
| 40 | CIO P1-5, P1-6 | KPI targets not per site; no SLA / holiday calendars | DECISION | Tied to D-01..D-03 (KPI definitions) and DEC-1 (RAG convergence) |
| 41 | CIO P1-8 | Change practice observed, not governed | DOC | SDP remains the system of record for incidents, changes and SLA; SDP360 governs follow-up and evidence |
| 42 | AUDIT P1-3, ARCH P2-4 | Policies not effective-dated; history recomputed with today's rule | DECISION + OPEN | `effective_from` + "as-of" resolution; until then the oversight register shows every change with its date |
| 43 | AUDIT rec. 4, SEC rec. 4 | No hash chain, no SIEM export; app role owns its tables | DECISION | Hash chain + daily anchor; `REVOKE UPDATE/DELETE` on prod (needs the prod DBA — never done from here) |
| 44 | AUDIT P2-13 | `override_allowed` defaults to true | DECISION | Default kept (today's behaviour); a listed-company default of false is the committee's call |
| 45 | AUDIT P1-6 | Due-date moves can clear an A02 escalation without approval; exceptions never expire | OPEN | Serious commitments: a move past the baseline needs the admin tier; exception expiry |
| 46 | AUDIT P2-11 | Reopening accepted minutes overwrites the previous acceptance | OPEN | Append a reopen / acceptance history; second person for the reopen |
| 47 | SEC P2 | Commitment replay reveals SDP ticket links across sites | OPEN | Resolve the ticket's site through tech_group / zoho_group; unresolvable systems admin-only |
| 48 | SEC P2 | Tightening can stop the platform (freshness 0.25 h, reason 500) | DECISION | Large changes in either direction under the same two-person rule? |
| 49 | ARCH next | Scope beyond site (tenant → BU → country → site) | DECISION | Needs `sites.country` / BU attributes; a second company = a separate instance today |
| 50 | ARCH P2-5 | Data-driven state machines | DOC | Deliberately not done: transitions stay in code so a context cannot remove a separation-of-duties control |

## Not verified by the committee (and still not verified)

pm2 cluster mode in prod; DB grants on the live server; behaviour of `prompt()` on the actual site tablets
and Teams webview; whether `purgeSystemLog` is scheduled in prod (it is declared as job `audit.retention`).
