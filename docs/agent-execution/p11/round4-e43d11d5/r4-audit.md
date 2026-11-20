# P11 — Audit/risk seat, ROUND 4

**AI review — not an independent human review.** Frozen SHA `e43d11d5738dc4af650bd06715c54e6927f1649e` (clone `/home/user/qual/audit`; the narratives under `docs/agent-execution/` were removed on purpose and the gate dossiers copied back in). The reviewer did not write this code. It modified no product code, touched no live system, and pushed, merged and tagged nothing. It filled no human decision. The throwaway attack files live only under `/tmp/claude-0/p11attack-r4/` (`drop.js`, `rb.js`, `all.js`, `tests/pcbypass.test.js`, `tests/aud1r4.test.js`, plus a tree copy at `copy/` used to probe the register generators). They are never committed. The round-1, round-2 and round-3 files were left untouched.

## 0. Round-3 findings: status at e43d11d5 (after fixes 10–13)

| R3 id | Sev | Claimed fixed by | Re-check at e43d11d5 | Status |
|---|---|---|---|---|
| R3-A1: audit-grant script covered 6 of 12 ledgers | P2 | fix 11 (`35065f98`) | The script now iterates `sdp.audit_tables` = the 12 tables of `services/auditChain.TABLES`. `tests/audit-grants-rehearsal.test.js:15,22-25` derives its list from the code and asserts that the script list and the schema's hash-chained set are equal. It now also tries TRUNCATE and DISABLE TRIGGER on the 6 ledgers that were missing. Green in E1. **But see new finding R4-A1 (DROP via schema ownership).** | **FIXED** (as scoped) |
| R3-A2: a new switch that defaults ON passes every check | P2 | fix 11 | Repeated on a throwaway copy. A key with default `'1'` is now listed as "live" and `switch-lots --check` refuses it when it is unclassified. A key `zz_r4_live_enabled: 'true'` plus a consumer `cfg.zz_r4_live_enabled === 'true'` gives **flag-register --check exit 0, switch-lots --check exit 0, and 28/28** across `flag-register`, `switch-lots`, `switch-lots-rollback` and `report-config`. The rule only tests `String(default) === '1'` (`tools/agent/flag-register.js:177,271`). Control: `zz_r4_guard_disabled: '0'` is caught. | **PARTIAL**: default `'1'` is now governed. Other truthy defaults (`'true'`, `'on'`, …) are not. No current key uses them → P3 |
| AUD-2: hash-chain verify blind to tail delete / TRUNCATE | P2 | none | `git diff ead6efb6 e43d11d5 -- services/auditChain.js services/sync/jobs.js` → no change. The "truncation anchor" in fix 10 is the sync reconciler again, not the audit chain. | **NOT FIXED** (code diff; R1 repro not re-run) |
| AUD-4: switch activation is single-person; prerequisites are advisory | P2 | partly, via the new `tools/ops/activate-switches.js` | The CLI refuses a lot whose prerequisite is off. But `services/switchPrereqs.js:4` still reads "Nothing is blocked", and the config PUT (`routes/adminConfig.js:84-128`) writes any key in one call by one super_admin. Proven in R4-A2: `portfolio_editor_plan_writes` and `sdp_api_write_enabled` were set to 1 together. | **NOT FIXED** on the admin path; partial on the CLI path |
| N2: reviewer set-up check misses identity aliases | P3 | fix 11 ("identity normalisation") | R3 repro re-run (`tests/aud1r4.test.js`, PG): N2 → "alias reviewer ACCEPTED; submitted; refused 403" at verify. The fix normalises spellings (NFKC, format characters, confusables). It does not resolve a username to its e-mail. R1, R2, R3, N1, N3 and N4 all still refused 403 (7/7 pass). | **NOT FIXED** (verify still holds → cosmetic) |
| NEW-3: G07 dossier: stale evidence label, no store test, no SoD residual | P3 | none | G07 §2 still labels `tests/commitments-routes.smoke.test.js` "Routes answer 404 while the switch is off". §5 residual risks list two items, with no segregation-of-duties line. | **NOT FIXED** |
| NEW-2: suite-level `describe.skip` not counted | P3 | none | `tools/test/guard.js:22,50` still `continue` on `kind === 'suite'`. The per-file manifest floor (no decrease between r3 and r4 manifests, checked) limits the impact. | **NOT FIXED** (mitigated) |
| AUD-5: SWITCH-LOTS rollback sentence overclaims | P3 | none | `docs/ops/SWITCH-LOTS.md:53,76,99,…` have the same wording | **NOT FIXED** |
| AUD-6: two-person delete ignores the requester's deputy | P3 | none | `services/softDelete.js:99` compares `actor_id` only | **NOT FIXED** |
| AUD-7: `ui_inject_dash_key` classified `secret`; `sync_alert_enabled` has no owner | P3 | partly | `FLAG-REGISTER.md:290` still kind `secret`. `sync_alert_enabled` now appears in the §6 live list, but its owner is still "to be named" (`:268`). | **PARTIAL** |
| AUD-9: tests depend on the narrative docs | P3 | by design | The same 16 failures in E1 | **NOT FIXED** (unlabelled) |

## 1. Evidence re-run at e43d11d5 (command, result)

| # | Command | Result | Status |
|---|---|---|---|
| E1 | `node tools/test/run-all.js` (PG, max_connections 400; 37 m 34 s; log `/home/user/qual/out/r4-audit-fullsuite.log`) | files **873/873** · tests **5660** · failed **16** · skipped 10 · floor 5640 met · skip 10 × "no prod-snapshot" (allow-list max 10, at ceiling, unchanged) · `[test-db] dropped 873` (own run only) · guard FAIL "16 test(s) failed" + "agent-inventory reported 1, manifest expects ≥ 4" · EXIT=1 | Reproduced, and **FAIL in this clone for environmental reasons**. The 16 failures are the same set as in R3: agent-inventory, evidence-baseline, gate-dossiers ×2, inventory-strict, kpi-dossiers, kpi-unknown-sweep, p09-adoption-kit, release-dossier ×4, traceability ×3 and uat-committee. All of them read files under the removed `docs/agent-execution/`. No failure outside that set. Green on a pristine tree is **not verified**. |
| E2 | `node tools/release/gate-dossiers.js --check` | exit 1. 14 problems: 7 cited files missing and 7 awaited globs empty, all under the removed narratives. Dossier target SHA `1bda2211`. `git diff --name-only 1bda2211 HEAD` gives only gate-dossier files and `EVIDENCE-MANIFEST.md`, so no product or test file changed after the target. | Reproduced: FAIL here (environmental). Pristine PASS **not verified**. |
| E3 | `node tools/agent/switch-lots.js --check` | exit 0 "switch lots up to date" | **Verified PASS** (but see R3-A2 residual and R4-A4) |
| E4 | `node tools/agent/flag-register.js --check` | exit 0 "flag register up to date". `docs/ops/flag-decisions.json` holds 0 entries. | **Verified PASS** ("up to date" means "current", not "governed") |
| E5 | Decision cells of the gate dossiers | 21/21 EN dossiers contain "fills nothing". No approval was invented. | **Verified** |
| E6 | Commitment four-eyes repros R1–R3, N1–N4 at this SHA | 7/7 refused 403 at verify | **Verified** |
| E7 | Manifest ratchet r3→r4 (`tests/.suite-manifest.json`) | 855→873 files, total 5517→5640, no file's expected count decreased, skip allow-list unchanged | **Verified** |

Counts: **verified 5** (E3–E7). **Not verified 3**: E1 green on a pristine tree, E2 PASS on a pristine tree, and CI green on the target SHA (not runnable here).

## 2. New attacks this round (claim · attack · outcome). None repeats an earlier round.

**R4-A1: append-only evidence after the DBA hardening.** Claim (`tools/pg/harden-audit-grants.sql:3-5`, rehearsal header): "the application role … can no longer edit, delete, or switch their triggers off". Attack (`/tmp/claude-0/p11attack-r4/drop.js`, throwaway database and role): make the app role the **database owner**, as in prod, where `sdp_app` owns `sdp_dashboard` (CLAUDE.md G-02). Create a ledger, then transfer it to `sdp_audit_owner` with SELECT and INSERT granted, exactly as the script does. Then try four statements as the app role. Outcome: TRUNCATE refused, DELETE refused, RENAME refused, **`DROP TABLE` ALLOWED**. Since PG15 the `public` schema is owned by `pg_database_owner` (seen: `nspowner = pg_database_owner`), and a schema owner may drop any table in it. The migrator then recreates an empty table (`CREATE TABLE IF NOT EXISTS`), so a hash-chain verify over an empty ledger passes. The rehearsal never exercises this, because it grants only `USAGE ON SCHEMA` to a non-owner role (`tests/audit-grants-rehearsal.test.js:50`). **BROKEN.**

**R4-A2: Policy Control Center four-eyes** (new lot, `policy_center_enabled`, migration reports/120). Claim (`routes/policyCenter.js:9-12`, `services/policyChangeStore.js:2-4`): a high-risk change becomes a request that ANOTHER super_admin decides. Attack (`tests/pcbypass.test.js`, real server, PG, switch ON), run three ways:
- (a) super A asks the center for `hygiene_send_enabled=1` → 202 pending. Then A alone calls the legacy `PUT /api/reports/config` with `hygiene_send_enabled`, `portfolio_editor_plan_writes` and **`sdp_api_write_enabled` = 1** → **200, all three applied**. The pending request is then marked stale on approval. That is the only trace.
- (b) super A asks for `teams_sla_enabled=1`. A creates a second account `helper_x` with role `super_admin` (`POST /api/reports/users` → 200; `access_require_approval` is default 0). helper_x approves → **200 "approved", value now 1**.
- (c) `needsSecondPerson` exempts any move back to the default (`services/policyCatalogue.js:210`). So switching OFF a protective control is single-person: `portfolio_site_scope_reads 1→0` → 200 applied, and so is `access_require_approval 1→0` → 200 applied.

**BROKEN by three independent routes.** Also: `policy_change_requests` is mutable, with no append-only or hash-chain trigger, so the approver record itself can be rewritten by the app role. The system_log rows remain.

**R4-A3: activation-tool rollback** (new `tools/ops/activate-switches.js`). Claim (header lines 17-19): `K:source_system_write` is "REFUSED whatever the flags". Attack (`rb.js`, injected deps, no DB): `--apply --lots=K:source_system_write` is refused. But `--rollback=<file>` with a hand-written file `{entries:[{key:'sdp_api_write_enabled',from:'1',to:'0'},{key:'smtp_host',from:'evil.example',to:'mail.corp'}]}` → "restored 2 key(s)", and **`sdp_api_write_enabled` = 1, `smtp_host` = evil.example**. The rollback path checks neither that the keys belong to a lot, nor the refused groups, nor whether a key is a switch at all. **BROKEN.** It needs operator DB credentials, which could write directly anyway, so this is a broken safety rail, not an escalation.

**R4-A4: activation-tool lot selection.** Claim (usage, line 9): `--apply --db-url=URL --lots=L01[,L02…]`. Attack (`all.js`): `--apply --db-url=x` with no `--lots` and no `--reason` → **14 lots, 108 switches written**, among them `policy_center_enabled` and `portfolio_editor_plan_writes`. The code defaults to `args.lots || 'all'` (`:338`). The header still says "the 13 lots" while the plan has 14 (L14 = `ppm_intake_register_enabled`). The journal actor is `cli:activate-switches`: no human identity is recorded and no reason is required. **BROKEN** (the rail claim). Outbound switches stay skipped, and NODE_ENV=production still needs `--i-am-the-operator`.

**R4-A5: suite integrity / manifest floor.** Claim: a file's test count cannot silently drop. Attack: diff the r3 and r4 reviewed manifests for any decrease that was laundered by "Regenerate evidence manifest" commits. Outcome: none (0 decreased, 0 removed). **Holds.**

**R4-A6: portfolio intake ids** (`ppm_intake_register_enabled`, migration 117). Claim: PRJ-YYYY-NNN is immutable and never reused. Method: code reading only, not reproduced. There is a counter that only increments (`INSERT … ON CONFLICT DO UPDATE … RETURNING`), a collision check that also sees soft-deleted rows, `BEFORE UPDATE OF project_ref` immutability, and a unique index. **Holds by reading.** Residual: the app role owns `ppm_project_ref_seq` and could lower it by hand. That is not an append-only claim.

**Adoption Lot A** ("fixes ship ON"). Governance note, not a break: it changes a number shown on a live path (the site-view SLA denominator: Houndé 60 % vs 50 %) with no switch and no flag-decisions entry. Rollback means reverting the commit. This is consistent with R3-A2: live changes need no recorded decision.

## 3. Findings (round 4)

| Id | Sev | Title | Reproduction | Regression test to add | Rollback risk |
|---|---|---|---|---|---|
| R4-A2 | **P1** (blocks pilot of the lot that turns on `policy_center_enabled`, L13; not live today, default 0) | Policy Center four-eyes bypassed: (a) legacy config PUT, (b) a self-minted second super_admin, (c) reset-to-default is exempt | `/tmp/claude-0/p11attack-r4/tests/pcbypass.test.js` with the env in the brief, plus `DASH_USER`/`DASH_PASS` | When `policy_center_enabled=1`, the legacy PUT refuses any `four_eyes` key (or routes it to a request). An approver created or granted super_admin after the request (or by the requester) is refused. Moves to default on keys tagged "narrows" or "protective" need a second person. | Low: config-only, switch default off |
| R4-A1 | **P2** | Hardened audit ledgers can still be DROPPED by the app role as database or schema owner | `/tmp/claude-0/p11attack-r4/drop.js` | The rehearsal runs with the app role as DB owner and asserts `DROP TABLE` is refused. The script also moves schema ownership, or adds an event trigger or a separate schema owned by `sdp_audit_owner`. | Low: manual DBA step, not yet applied |
| R4-A4 | **P2** | `activate-switches --apply` without `--lots` turns on all 14 lots; no human actor, no reason required | `node /tmp/claude-0/p11attack-r4/all.js` | `--apply` requires an explicit `--lots` and `--reason` and records the operator's name | None |
| AUD-2 | P2 | Hash-chain verify blind to tail delete or TRUNCATE (open since R1) | R1 A2 | Anchor comparison outside `system_log` | Low |
| AUD-4 | P2 | Switch activation single-person; prerequisites advisory on the admin path (open since R1) | R4-A2 (a) | Config PUT refuses a switch whose lot dependency is off | Low |
| R4-A3 | P3 | Activation rollback file is unvalidated and can arm refused or boundary keys and arbitrary settings | `node /tmp/claude-0/p11attack-r4/rb.js` | Rollback only writes keys present in a lot of that file's `lots`, never refused groups or non-switch settings, and checks a file hash recorded in system_log | None |
| R3-A2r | P3 | Live-switch governance only recognises default `'1'` | throwaway copy (§0) | Any non-`'0'` default of an `*_enabled`/`*_mode` key must be classified | None |
| PC-log | P3 | `policy_change_requests` (approver record) is mutable | migration 120 | Append-only decision events, or add the table to `auditChain.TABLES` | None |
| N2, NEW-2, NEW-3, AUD-5, AUD-6, AUD-7, AUD-9 | P3 | Carried over (see §0) | r2/r3 files | as in r3 | None |

**P0: 0. P1: 1** (R4-A2). Fixed since round 3: R3-A1 (as scoped). Partial: R3-A2, AUD-7.

## 4. Per-lot recommendation (AI panel recommendation, not a decision)

| Lot | Audit-area touchpoint | Recommendation |
|---|---|---|
| L01 Daily work (`commitments_enabled`, …) | commitment four-eyes | **GO PILOT conditional on G07**: four-eyes held against 7 attacks again. D-04 closure-policy owner still empty. |
| L03 Change control (`portfolio_editor_plan_writes`) | AUD-4, R4-A2(a), R4-A4 | **CONDITIONAL**: an access-policy decision is needed. The switch can be set single-handed by the legacy PUT or by a bare `--apply`. |
| L05/L06 Finance / PPM ledgers | R4-A1, AUD-2 | **CONDITIONAL**: before relying on the ledgers as evidence, apply the grant hardening after closing the DROP path. |
| L07 Publication / soft delete | AUD-6, R4-A1 | **CONDITIONAL** |
| L08 Governance cadence | — | **CONDITIONAL**: no new break |
| L12 Access security (`access_require_approval`, …) | R4-A2(b)(c) | **CONDITIONAL**: approvals can be switched off alone (reset-to-default exemption). The sock-puppet super_admin works while approval is off. |
| L13 Ops resilience, including **`policy_center_enabled`** | R4-A2, R4-A4 | **NO-GO for `policy_center_enabled` as a four-eyes control** until R4-A2 is fixed. The rest of L13 is CONDITIONAL (backup/restore gate empty, AUD-2 open). |
| L14 Portfolio intake register | R4-A6 | **CONDITIONAL → GO PILOT**: id immutability holds by reading. No audit-area break. Business owner of reference lists still to be named. |
| Adoption Lot A (shipped ON, no switch) | governance | **CONDITIONAL**: record a keep decision for the live number changes. |
| Activation tool (`tools/ops/activate-switches.js`) | R4-A3, R4-A4 | **CONDITIONAL**: require `--lots`/`--reason`/operator name, and validate rollback files before any real instance. |

## 5. Human gates (RELEASE-GATES rows) still empty in this area

All 21 dossier rows are empty (each says "This dossier fills nothing"). `docs/ops/flag-decisions.json` has 0 entries. The rows relevant here:
- Security access policy CG-01/CG-02 (G01), which now has to cover who may hold super_admin and approve policy changes
- Threat model & findings (G02), which should take in R4-A1 and R4-A2
- Backup/restore RPO-RTO (G05)
- Closure policy D-04 (G07)
- Handoffs (G08)
- Product business acceptance (G15)
- Production deployment GO/NO-GO (G17)
- Penetration test (G18)
- QA lead: CI green on the target SHA and skips reviewed (G19)

Two further steps are also still open: the DBA/CAB step that applies `tools/pg/harden-audit-grants.sql`, which should wait for R4-A1, and an owner decision on each live (default-ON) switch.

*AI review — not an independent human review.*
