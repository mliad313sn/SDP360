---
name: sdp-analytics
description: Build safe composable dashboards and trackers with publishing workflows.
argument-hint: "[goal-id or scope]"
user-invocable: true
---

# sdp-analytics

Arguments: $ARGUMENTS

Validate dashboard/chart schemas and metric lookup, no user-supplied raw SQL, stable keys, RAG text states, target context, versioning and concurrent publish protection. Treat unavailable 41 charts and F01-F24 contracts as blocked external input, not established specifications.

## Completion contract
- Inspect code and tests first; do not trust design docs as runtime proof.
- Use versioned ADRs when tradeoffs exist, plus red/green regression tests and review by a different specialist.
- Capture exact SHA, commands, outputs and outstanding external gates in `docs/agent-execution/`.
- Never claim a formal approval, deployment or metric without authentic evidence.
