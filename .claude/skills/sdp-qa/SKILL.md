---
name: sdp-qa
description: Execute deterministic CI, unit, integration, browser, security and compatibility tests.
argument-hint: "[goal-id or scope]"
user-invocable: true
---

# sdp-qa

Arguments: $ARGUMENTS

Require fail-before-fix for P0/P1 defects. Check PG17, en_US.utf8, TZ=UTC, dependency audit, npm scripts, Windows installer, Playwright MCP against test instance, fixtures, cross-site and cross-department reads/writes. Never run destructive load or security tests on prod.

## Completion contract
- Inspect code and tests first; do not trust design docs as runtime proof.
- Use versioned ADRs when tradeoffs exist, plus red/green regression tests and review by a different specialist.
- Capture exact SHA, commands, outputs and outstanding external gates in `docs/agent-execution/`.
- Never claim a formal approval, deployment or metric without authentic evidence.
