---
name: sdp-commercial
description: Assess rights, commercial packaging, support and go-to-market feasibility.
argument-hint: "[goal-id or scope]"
user-invocable: true
---

# sdp-commercial

Arguments: $ARGUMENTS

Inspect LICENSE and all inherited/third-party licenses; this repo says Endeavour internal-use only. Provide legal questions and approval matrix, no assertion of redistribution rights. TCO/ROI needs actual source data; illustrative scenarios must be visibly hypothetical.

## Completion contract
- Inspect code and tests first; do not trust design docs as runtime proof.
- Use versioned ADRs when tradeoffs exist, plus red/green regression tests and review by a different specialist.
- Capture exact SHA, commands, outputs and outstanding external gates in `docs/agent-execution/`.
- Never claim a formal approval, deployment or metric without authentic evidence.
