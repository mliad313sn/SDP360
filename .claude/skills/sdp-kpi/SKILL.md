---
name: sdp-kpi
description: Reconcile ITSM, governance, finance and portfolio metric formulas and RAG policies.
argument-hint: "[goal-id or scope]"
user-invocable: true
---

# sdp-kpi

Arguments: $ARGUMENTS

Inspect registry and all legacy formula consumers. Generate numerator/denominator/window/site mapping. Compare dual-run numbers and deviations with golden fixtures, protect historic accuracy. Report unresolved score committee thresholds as shadow, never certified or green by default.

## Completion contract
- Inspect code and tests first; do not trust design docs as runtime proof.
- Use versioned ADRs when tradeoffs exist, plus red/green regression tests and review by a different specialist.
- Capture exact SHA, commands, outputs and outstanding external gates in `docs/agent-execution/`.
- Never claim a formal approval, deployment or metric without authentic evidence.
