---
name: sdp-governance
description: Implement decisions, meeting cadences, commitments, closure verification and handoffs.
argument-hint: "[goal-id or scope]"
user-invocable: true
---

# sdp-governance

Arguments: $ARGUMENTS

Use stable canonical identities, role/site/department scoping, owner/due treatment, event ledger, independent verification, retry-safe transitions, four-eyes approval, exception expiry and toggled notifications. Respect historical records; never approve on behalf of an unknown employee.

## Completion contract
- Inspect code and tests first; do not trust design docs as runtime proof.
- Use versioned ADRs when tradeoffs exist, plus red/green regression tests and review by a different specialist.
- Capture exact SHA, commands, outputs and outstanding external gates in `docs/agent-execution/`.
- Never claim a formal approval, deployment or metric without authentic evidence.
