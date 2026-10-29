---
name: sdp-decision
description: Make auditable autonomous technical decisions without fabricating external approval.
argument-hint: "[goal-id or scope]"
user-invocable: true
---

# sdp-decision

Arguments: $ARGUMENTS

For each disputed issue, inventory evidence and applicable controls; list at least two feasible options and explicit tradeoffs (security, maintainability, UX, cost, performance, reversibility). Write docs/ai-decisions/ADR-<ID>.md with selected technical default, reason, tests, rollback and scope. Approval grades: AI-TECH-DECIDED (reversible code in sandbox), AI-PROPOSED-POLICY (unapproved rules run in SHADOW), EXTERNAL-AUTHORITY-BLOCKED (security/CAB/Finance/Legal/real users/prod). Do not set go-live/signoff markers by AI.

## Completion contract
- Inspect code and tests first; do not trust design docs as runtime proof.
- Use versioned ADRs when tradeoffs exist, plus red/green regression tests and review by a different specialist.
- Capture exact SHA, commands, outputs and outstanding external gates in `docs/agent-execution/`.
- Never claim a formal approval, deployment or metric without authentic evidence.
