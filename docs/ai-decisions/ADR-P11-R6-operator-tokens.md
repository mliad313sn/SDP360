# ADR-P11-R6 — Authenticated operator for `activate-switches` four-eyes steps (operator tokens)

**Status:** AI decision (reversible engineering detail), 2026-11-20. Not a business approval. **Context:** P11 round 6,
audit seat finding R6-A1 (P2): with the Policy Center on, `tools/ops/activate-switches.js --operator=<colleague>` filed
a four-eyes request AS that colleague (the name was a username lookup, never authenticated), and the person running the
tool then approved it in the center — one person filed and approved a four-eyes change while the record named two.
With the center off, `--second-operator` was a typed name (since fix 27 an existing super_admin account, still never
authenticated).

## Decision (the "minimal secure version")

1. **The CLI never applies a four-eyes change itself.** `--second-operator` is refused. A four-eyes step needs
   `policy_center_enabled = '1'`; otherwise the tool refuses and writes nothing.
2. **The requester is authenticated by a one-time operator token** (`services/operatorTokens.js`, migration 136): a
   logged-in super_admin issues it for HIS OWN account in `/policy-center.html` (`POST /api/policy-center/operator-tokens`,
   super_admin, 404 while the center is off, logged `operator_token_issued`). The token is shown once, stored as
   sha256 only, valid 10 minutes, consumed atomically (single use). The CLI reads it from the environment
   (`--operator-token=env` → `SDP_OPERATOR_TOKEN`, or `env:VAR`) or a file (`file:PATH`) — never from the command line.
3. The tool files one Policy Center request per four-eyes key **as the token's account** (re-checked as an active
   super_admin); `--operator`, when given, must be that account. The request reason records the token id, the OS user
   and the host; a `policy_change_requested` event is logged.
4. **Approval stays a web act** of another logged-in super_admin. The center already refuses the requester (by id and
   normalised identity) and any approver that is not independent of the requester (`services/approverProvenance.js`:
   created / promoted / credentials reset by the requester, chains, unknown provenance).
5. Rollback of a four-eyes key towards its weaker side follows the same path (a request, not a write). Lots without a
   four-eyes step are unchanged: one operator, OS user and host recorded.

## Consequences

- A four-eyes lot can only be activated once HD-S04 turns the center on (business decision, not taken here).
- A colleague who issues his own token and hands it to someone else has acted himself (he chose to file); the approval
  still needs a third independent person or the original runner. Handing a token on is forbidden by the runbook.
- Rollback: `db/postgres_rollback/136_operator_tokens_drop.sql` (the CLI then refuses every four-eyes step).

Tests: `tests/activate-switches.test.js`, `tests/activate-switches-r6-impersonation.smoke.test.js`.
