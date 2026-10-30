---
name: sdp-audit
description: Deep inspect repository and produce a current evidence-grounded gap inventory.
argument-hint: "[goal-id or scope]"
user-invocable: true
---

# sdp-audit

Arguments: $ARGUMENTS

Map the dependency graph, HEAD and CI, live route table, feature flags, migrations, UI entry points, code/test/evidence matrix and doc contradictions. Only use evidenced status labels. Backward map CG/G/EA/ITSM/F findings. No invented chart contracts.

## Completion contract
- Inspect code and tests first; do not trust design docs as runtime proof.
- Use versioned ADRs when tradeoffs exist, plus red/green regression tests and review by a different specialist.
- Capture exact SHA, commands, outputs and outstanding external gates in `docs/agent-execution/`.
- Never claim a formal approval, deployment or metric without authentic evidence.
