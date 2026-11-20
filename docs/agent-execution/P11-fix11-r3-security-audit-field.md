# P11 round 3 — fix lot qual/p11-fix11 (security / audit / field P2-P3)

AI-authored engineering evidence. No approval, signature or production readiness is claimed. Base `0f570be4`.
Findings from `/home/user/qual/out/r3-security.md`, `r3-audit.md`, `r3-ux-field.md`. Every fix ships ON (defect fix);
each test was run and seen FAILING before the fix, passing after.

| Finding | Sev | Cause | Fix | Regression test |
|---|---|---|---|---|
| N-R3-1 look-alike owner bypasses commitment four-eyes | P2 | `_s()` = trim+lowercase; owner change recorded without its actor | `identityKey` (NFKC, `\p{Cf}` stripped, whitespace collapsed, case folded) + `skeletonKey` (Cyrillic/Greek look-alikes) on the refusal side; grants use `identityKey` only. Owner / executor changes record `by`; the re-pointer counts as past holder. ADR `docs/ai-decisions/ADR-P11-R3-identity-normalisation.md` | `tests/commitment-lifecycle.test.js` (N-R3-1), `tests/commitment-store.test.js` (pg: look-alike set by the verifier) |
| Four-eyes: former owner's e-mail alias accepted as reviewer | P3 | reviewer probe = raw string | reviewer value resolved to its single active account (username / e-mail), checked with all its identities | `tests/commitment-store.test.js` |
| R3-A1 hardening script covers 6 of 12 audit tables | P2 | hand-typed list in script and rehearsal | script reads one list `sdp.audit_tables` = `auditChain.TABLES` (12); rehearsal derives from code, checks every hash-chained table in the migrated schema is listed and append-only, TRUNCATE / DISABLE TRIGGER refused on the 6 ledgers. All 6 verified append-only + hash-chained (migrations 039, 040, 054, 058, 094, 098) | `tests/audit-grants-rehearsal.test.js` (1 → 3 tests) |
| R3-A2 default-ON switch passes governance | P2 | register only classified default-`0` keys | `FLAG-REGISTER.json` `live` list (every key defaulting to `1`); `switch-lots` validate fails on an unclassified live key or one placed in a lot. 6 current live keys kept in two reasoned groups (`live_by_default`, `live_setting_not_a_switch`) — PROPOSED, owner decides | `tests/switch-lots.test.js` (R3-A2 ×2, incl. the throwaway attack) |
| N-R3-3 hostile params → 500 on monthly / yearly / objectives / weekly-summary | P3 | `parseInt` NaN → `Invalid time value` / 22P02 | `services/periodParams.check` after session/role middlewares on the 11 routes → typed 400 | `tests/report-period-params.smoke.test.js` (new) |
| R2-N2 pre-fix editor share link revives on promotion | P3 | view re-checked creator's CURRENT roles | migration `reports/116_share_link_creator_tier.sql` (+ rollback) adds `share_links.creator_admin`, back-filled ONCE from the tier at deploy; view needs admin at creation AND now | `tests/report-run-group-share.smoke.test.js` (R2-N2) |
| R2-N3 field 409 reveals another site's inspection status | P3 | status in message + `detail` regardless of scope | out-of-scope id → generic 409, no status, no detail | `tests/field-inspection-action-status.smoke.test.js` |
| F-8 invalid action status in inspection envelope → 500, retried forever | P3 | outbox catch ignored `VALIDATION` | `VALIDATION` → terminal 400 `rejected` | same file |
| F-9 field tech reopens a closed inspection action | P3 | field path accepted any inspection status | field path: `Closed` / `Cancelled` only (reason `inspection_action_status`, FR text exists) | same file |

Deploy notes: migration 116 is additive (back-fill freezes current tiers — an editor promoted BEFORE deploy keeps a
live pre-fix link; revoke manually if any). The harden-audit-grants script remains a DBA/CAB step; re-running it is
idempotent and now also covers the 6 ledgers. A manager who reassigns an owner can no longer verify that commitment.
