---
name: sdp-ux
description: Audit and improve responsive navigation, FR/EN, accessibility and performance.
argument-hint: "[goal-id or scope]"
user-invocable: true
---

# sdp-ux

Arguments: $ARGUMENTS

Use measured flow, 390px and 1280px browsers and persona task completion, clear UNKNOWN data states, shared tokens, semantic components, accessibility and URL compatibility. Limit rewrites to small validated modules. Do not claim user acceptance from synthetic tests.

## Completion contract
- Inspect code and tests first; do not trust design docs as runtime proof.
- Use versioned ADRs when tradeoffs exist, plus red/green regression tests and review by a different specialist.
- Capture exact SHA, commands, outputs and outstanding external gates in `docs/agent-execution/`.
- Never claim a formal approval, deployment or metric without authentic evidence.
