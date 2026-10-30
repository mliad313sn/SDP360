---
name: sdp-reporting
description: Build trustworthy report production, export integrity, alerts and scheduled distribution.
argument-hint: "[goal-id or scope]"
user-invocable: true
---

# sdp-reporting

Arguments: $ARGUMENTS

Enforce source freshness, immutable snapshot, creator/reviewer/publisher separation, site and department audience scopes, withdrawal and audit. Mock Graph/SMTP/Teams first; live dispatch disabled until genuine configured recipients and authorization.

## Completion contract
- Inspect code and tests first; do not trust design docs as runtime proof.
- Use versioned ADRs when tradeoffs exist, plus red/green regression tests and review by a different specialist.
- Capture exact SHA, commands, outputs and outstanding external gates in `docs/agent-execution/`.
- Never claim a formal approval, deployment or metric without authentic evidence.
