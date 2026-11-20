# P11 round 5 — fix lot fix/p11-r5-audit (audit / risk seat)

AI-authored engineering evidence — not an independent human review. No approval, signature, production readiness or
field acceptance is claimed. Base `8842dfef` (fixes 19–23 included). Findings from the round-5 audit file (AI review,
kept outside the repository; repro `r5pc.test.js`). Every new test was run and seen FAILING before the fix and passing
after (audit-chain: 4 new tests red on the old `services/auditChain.js`, rehearsal red; control switches: 3/3 red on the
old catalogue).

## R5-A1 re-check (P1) — FIXED on this tree (by fix 21)

The round-5 repro test 2, pointed at this worktree: requester `pc_super` files `scoreboard_send_enabled=1` (202
pending), resets `pc_super2`'s password (200), logs in as `pc_super2` and approves → **403** "a second, independent
super_admin must approve: the requester reset the credentials (password / e-mail / activation) of the approver
account — it is not a second person"; value stays `0`. Control (`pc_super2` approves an untouched request) → 200.
No change made here. Same run, test 1 (R4-A2c): three strict-direction requests stay 202 pending.

## Findings fixed

| Finding | Sev | Fix | Regression test |
|---|---|---|---|
| R5-A2 Lot 5 audit / control switches switchable off by one person with the Policy Center on | P2 | `docs/ops/policy-catalogue.json`: four-eyes + `strict_value:'1'` (risk high) on `ppm_field_audit_enabled` (the repro's 200 → now 202), plus the scan's clear cases where OFF lifts a control or an audit trail: `insp_action_verify_enabled`, `decision_lifecycle_enforced`, `site_code_shared_block` (all three classed "narrows" by the activation tool and not four-eyes), `decision_motive_required`, `ppm_timesheet_approval_enabled`, `never_send_unconfirmed`, `wan_sla_require_contract_evidence`. Freeze and DQ gate were already four-eyes (fix 20). Turning any of them ON stays immediate (towards strict), so no activation lot gains a four-eyes step | `tests/policy-center-control-switches.test.js` (3: control list four-eyes; OFF needs a second person, ON immediate; every `ACCESS 'narrows'` key of `activate-switches.js` is four-eyes) |
| R5-A3 shadow schema: verify read an empty shadow chain as ok | P2 | (a) `services/auditChain.js` reads every ledger schema-qualified (`SDP_LEDGER_SCHEMA`, else `current_schema()`) and reports a ledger whose unqualified name resolves to another table (`shadowed`, ok:false); `sdp_hash_chain()` reads the previous hash from `TG_TABLE_SCHEMA` (migration 131 while the app owns it; the hardening script otherwise). (b) `tools/pg/harden-audit-grants.sql` hands the DATABASE to `sdp_audit_owner` (app keeps CONNECT + TEMPORARY → no CREATE SCHEMA, no DROP DATABASE; an owner could re-grant itself CREATE), revokes CREATE on other schemas (and hands over app-owned ones), pins the app role's `search_path` in the database, and hands `audit_chain_anchors` over with SELECT + INSERT | `tests/audit-grants-rehearsal.test.js` (CREATE SCHEMA refused, DB owner moved, no CREATE privilege, fresh session lands on the ledger schema, anchor table append-only, a pg_temp copy of `ppm_events` reported `shadowed`); `tests/audit-chain.test.js` ("shadow ledger earlier on the search_path is reported") |
| AUD-2 verify never compared with the previous anchor | P2 | migration `131_audit_chain_anchor.sql` (+ manual rollback): append-only `audit_chain_anchors`; `verify` fails a ledger whose row count shrank, whose anchored row is gone, or whose anchored row carries another hash; `nightly()` (the `audit.chain_verify` job) anchors only a verified chain | `tests/audit-chain.test.js` (+4: tail delete — valid but shorter chain now broken, also after a refill; TRUNCATE; rewrite; nightly anchors / refuses and throws) |
| R5-A4 rollback "signature" was an unkeyed hash | P3 | HMAC-SHA256 seal under `SDP_CONFIG_KEY` (else `SDP_BACKUP_KEY`, ≥ 16 chars) when a key is set; without a key the file is labelled "sha256 checksum only"; an unsealed file is refused while a key is configured unless `--accept-unsealed` (logged warning "NOT signed"). Wording "signé" → "contrôlé / scellé HMAC" in PLAN-PILOTE, RUNBOOK and the tool header | `tests/activate-switches.test.js` (+2) |
| R5-A6 operator self-declared | P3 | the OS account and host that ran the tool are written in the rollback file (inside the checksummed content) and in the `switch_rollback_file` event next to the declared `--operator` | `tests/activate-switches.test.js` ("--apply writes os_user + host…") |
| R5-A5 vacuous pass on CI's shallow clone | P3 | `tests/gate-dossiers.test.js` skips with a reason (judged by the skip allow-list) instead of returning; `ci.yml` test job checks out full history (`fetch-depth: 0`) so the ancestry check runs | `tests/ci-config.test.js`, `tests/gate-dossiers.test.js` |
| R5-A8 timing-flaky access-log test | P3 | fixed `wait()` replaced by a bounded poll on the precondition + a settle window before "exactly one row" assertions | `tests/access-denied-log.smoke.test.js` (3/3) |
| R5-A6(i) L16 absent from the pilot plan | P3 | PLAN-PILOTE §1: L16 row, **CONDITIONAL, hors pilote**, with the panel conditions (soft-deleted / versioned documents but no malware scan, BI through four-eyes `ext_api_portfolio_enabled`, PROPOSED thresholds); new decision HD-P13 in the register source | `node tools/release/business-readiness-check.js --check` |

## Catalogue scan (switches whose OFF reduces an audit trail or a control)

Flagged four-eyes (above): `ppm_field_audit_enabled`, `insp_action_verify_enabled`, `decision_lifecycle_enforced`,
`site_code_shared_block`, `decision_motive_required`, `ppm_timesheet_approval_enabled`, `never_send_unconfirmed`,
`wan_sla_require_contract_evidence`. Already four-eyes: freeze, DQ gate, review workflow, soft-delete two-person, every
governance-store rule (`reports.four_eyes`, `publication.four_eyes`, `meetings.minutes_four_eyes`,
`meetings.reopen_two_people`, `meetings.cancel_requires_approval`, `reports.freshness_gate`…).
Left for an owner decision (judgement, not clear-cut): `kpi_policy_enforced`, `ppm_change_requests_enabled`,
`ppm_rebaseline_enabled`, `field_review_step`, `controls_register_enabled`, `pir_reviews_enabled`, `ux_event_telemetry`.

## Behaviour changes to note

- With the Policy Center on, switching any of the eight keys above OFF now files a request for a second super_admin.
- After `harden-audit-grants.sql`, the database belongs to `sdp_audit_owner`: a restore (`services/dbRestore.js`) and the
  restore drill's schema fallback must use the DBA connection. Set `SDP_LEDGER_SCHEMA=public` in production `.env`.
- New rollback files carry `os_user`, `host`, `hmac`, `integrity`; old files are refused while a key is set unless
  `--accept-unsealed`.
- The first nightly run after deployment writes the first anchors (nothing to compare against yet).

## Tests run (this worktree, PostgreSQL 17, `SDP_TEST_RUN_ID=fix24`)

Targeted set (policy-center-*, approver-provenance, audit-grants-rehearsal, audit-chain, activate-switches,
access-denied-log, business-readiness, readme-truth, agent-inventory, inventory-*, ci-config, pg-migrate-*, rollback
scripts, switch-lots, flag-register, catalogue-dry-run, governance-policy-coverage, await-precedence, evidence-baseline,
portfolio-lot5, decision-lifecycle-p6, inspection-verify): 212 tests, 210 pass before the dossier refresh (the 2 dossier
freshness tests need the regeneration after commit; see the final count in the commit that refreshes them).
Neighbours (config journal, governance routes, WAN contracts, flag decisions, switch prereqs, UAT org models,
P6 decisions, P7B, report config, sync jobs, engagement jobs, finance certification, WAN SLA claims, governance roles,
report submission integrity, access store): 117/117. `npx eslint .` clean. Full suite not run (disk budget).

## Human decisions left

- DBA / CAB: apply the extended `tools/pg/harden-audit-grants.sql` on TEST then production (database ownership moves).
- Operator: set `SDP_LEDGER_SCHEMA` and `SDP_CONFIG_KEY` (seal) in production `.env`.
- Owners: the seven "left for an owner decision" switches; HD-P13 (L16 out of pilot or a dedicated wave); G01 must
  still say who may reset a super_admin's password.
