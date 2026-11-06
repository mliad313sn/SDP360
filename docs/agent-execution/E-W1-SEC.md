# E-W1-SEC — security bundle of plan E (goals E-S01, E-S03, E-S04, E-S06)

Branch `goal/w1-sec` (from `0839f51`). Migration used: **068** (069 not needed). PostgreSQL 16 local throwaway
databases. Nothing deployed, pushed or merged; no switch moved off today's behaviour.

## Verdicts

| Goal / audit action | Verdict | Proof |
|---|---|---|
| E-S01 · audit S-04 capability enforcement | **FIXED behind switch** (`authz_enforce_caps` = `''`) — enforce wired for listed capabilities only; a listed capability can only refuse (403 + `reason_code` + system_log `authz` / `authz_enforce_denied`, actor id only); a `can()` allow still goes through the legacy guard (never widens); no session keeps the legacy 401; critical capabilities ignored (warned once) while C-18 grants are off; unknown / inline ids ignored. Report tool `tools/security/authz-divergence-report.js`. | `tests/authz-enforce.test.js` (10: empty list = legacy on every guarded route × role set; review.read refusal + one log row without name/IP; critical ignored; never-widen via a refusing legacy guard; off/shadow unchanged; catalogue = legacy for every enforceable cap; report pure + on a real system_log) · `tests/access-why.smoke.test.js` +1 (real server: viewer 403 with reason, super_admin passes, anonymous 401, one log row) |
| E-S03 · audit S-05 recertification + orphans | **FIXED behind switch (shadow)** — migration 068 (campaigns + lines), pure core `services/accessRecert.js`, store functions in `services/accessStore.js`, 7 routes in `routes/access.js` (404 while `access_recert_enabled`=`0`), Recertification tab on `/access.html`. Revoke recorded only at `access_recert_apply`=`0`; applied through `rdb.updateUser` + identity log row at `1`. Orphans: no sign-in > N days (`access_recert_orphan_days`), editor without site, inactive site, role no published template grants; a missing sign-in is listed as UNKNOWN, never idle; no published template → that check is UNKNOWN. | `tests/access-recert.test.js` (7) · `tests/access-recert.smoke.test.js` (7: off → 404; open by super_admin only; R7 approver, never the subject, platform role → super_admin; subject refused; approver sees only its lines; apply 0 records only; apply 1 changes roles + 1 identity row; orphans; closed campaign → 409) |
| E-S04 · audit S-07 Entra leavers (code part) | **FIXED behind switch (dry run)** — `services/entraDeprovision.js`, job `access.entra_deprovision` (03:55, optional internal), connector row C14 DORMANT. No Graph call unless `entra_deprovision_enabled`=`1` and SSO ready; deactivation only at `entra_deprovision_apply`=`1`; Graph 401/403 → `consent_missing`, nothing done; break-glass never sent to Graph; object ids masked in the result. | `tests/entra-deprovision.test.js` (7, injected Graph stub: off → no call; no SSO → skipped; dry run lists disabled + deleted, nothing changes; 403 → consent_missing; apply → 2 deactivated, open session refused, 2 log rows; conservative state mapping) |
| E-S06 · prep S-01 / S-03 / S-06 / S-09 / S-10 | **PREPARED (human gates)** — `docs/security/ROTATION-RECORD.md` (S-01, gate 1), `docs/security/DEPARTMENT-VISIBILITY-DRAFT.md` (S-03, PO R4 recorded, no rule invented), `docs/security/EMERGENCY-ACCESS-DRILL.md` (S-06, expected system_log rows), `docs/security/PENTEST-SCOPE.md` (S-09), `tools/security/retention-inventory.js` → `docs/ops/RETENTION-INVENTORY.md` (S-10, owner / legal duration UNKNOWN on every row) | `tests/retention-inventory.test.js` (4: committed file matches code; every `softDelete.TABLES` table present; cited sources exist; `--check` fails when stale) |

Neighbours green: access-* (9 files), capability-registry 12, authz-route-matrix, sec01-route-roles.smoke 3,
emergency-access.smoke 6, connector-register 6, sync-jobs-registry 11, i18n-coverage 41, sso-settings 7,
flag-register, readme-truth, secret-scan, server-size-budget, await-precedence. `agent-inventory` red only because
INVENTORY.* is regenerated at merge (rule). `server.js`, `reports-db.js`, `public/reports.html` untouched.
New switches: DEFAULTS + PILOT-PROFILE rows (PROPOSITION) + regenerated `docs/ops/FLAG-REGISTER.md`.

Sample output of the divergence report (synthetic rows, throwaway database):

```
## Enforce refusals (authz_enforce_caps)
| Capability | Route | Rows | Distinct accounts | Reasons | First | Last |
| review.read | GET /api/reports/review-data | 1 | 1 | missing_role ×1 | 2026-11-03 | 2026-11-03 |
Total shadow divergences: 1. Whether each one is explained is a decision of the Security owner (R6) — this report does not decide it.
```

## Deviations

- E-S01: a `can()` ALLOW does not answer the request on its own — it hands over to the legacy guard (the
  guardrail "enforce must never widen" wins over "allow → next"). Today the catalogue equals the legacy guards, so
  enforce changes the refusal body (reason_code + capability) and adds the log row, not who is refused.
  "Grants on" = `access_require_approval` or `access_grant_expiry_job` = `1`.
- E-S03: lines are account × role and account × site (roles are not per-site in the data model, so a per-site
  role revoke would be ambiguous); the assigned approver is the R7-eligible account other than the subject
  (site-tier preferred, lowest id); any R7-eligible account (e.g. a super_admin) may also answer. Deputy exclusion
  is not checked for recert lines. Last sign-in = latest `login_success` in system_log or session start.
  `/api/access/me` gains `recert_enabled`; capability route prefix `/api/access/recert` → `platform.identity.manage`.
- E-S04: token failures (wrong secret) report `token_failed`; only Graph 401/403 is `consent_missing`.

## Left for a person

- E-S01: choose the first capabilities and switch `authz_capability_mode` to `enforce` after two shadow weeks with
  no unexplained divergence (Security owner, R6).
- E-S03: run and sign the first campaign; choose N (`access_recert_orphan_days`); decide `access_recert_apply` = 1
  (Security owner + site managers). Browser check of the Recertification tab behind a real session.
- E-S04: tenant decision on Graph `User.Read.All` application consent (gate 2); dry run and measured revocation
  delay on TEST before `entra_deprovision_apply` = 1.
- E-S06: fill ROTATION-RECORD (rotation per cluster, history decision A/B/C); data owners answer the department
  questions; run the emergency drill on TEST; sign the pentest rules of engagement; DPO/legal fill owners and
  legal durations in the retention inventory.
