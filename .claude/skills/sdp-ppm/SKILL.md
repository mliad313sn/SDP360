---
name: sdp-ppm
description: Build SDP360-native project/program/portfolio execution, finance and benefits management.
argument-hint: "[goal-id or scope]"
user-invocable: true
---

# sdp-ppm

Arguments: $ARGUMENTS

Extend existing governance/portfolio tables, use project gates, WBS/tasks/dependencies/critical path/resources, baselines, cost/benefit tracking, forecasts and verified actuals. Keep financials nullable/provenance-linked; do not add external PPM or ERP connectors. Ensure migration of legacy roadmap is dry-run first.

## Completion contract
- Inspect code and tests first; do not trust design docs as runtime proof.
- Use versioned ADRs when tradeoffs exist, plus red/green regression tests and review by a different specialist.
- Capture exact SHA, commands, outputs and outstanding external gates in `docs/agent-execution/`.
- Never claim a formal approval, deployment or metric without authentic evidence.
