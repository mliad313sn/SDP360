---
name: sdp-field
description: Validate offline-first field PWA and prevent data loss or cross-site leakage.
argument-hint: "[goal-id or scope]"
user-invocable: true
---

# sdp-field

Arguments: $ARGUMENTS

Test first load, offline caching, uploads, idempotent retries, network loss, storage purge, conflict resolution, FR default and same RBAC as desktop. Run in sandbox; real device/mine pilot remains separate sign-off.

## Completion contract
- Inspect code and tests first; do not trust design docs as runtime proof.
- Use versioned ADRs when tradeoffs exist, plus red/green regression tests and review by a different specialist.
- Capture exact SHA, commands, outputs and outstanding external gates in `docs/agent-execution/`.
- Never claim a formal approval, deployment or metric without authentic evidence.
