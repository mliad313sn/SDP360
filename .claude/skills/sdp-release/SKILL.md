---
name: sdp-release
description: Prepare reproducible staged release, Windows installer, recovery and rollback evidence.
argument-hint: "[goal-id or scope]"
user-invocable: true
---

# sdp-release

Arguments: $ARGUMENTS

Build installer in clean Windows CI, restore tests on disposable PG17, signature verification with test keys only, signed release checklist and deployment dry-run. Never deploy to prod, rotate its keys, merge release branch or sign legal/operational approvals without explicit proper authority.

## Completion contract
- Inspect code and tests first; do not trust design docs as runtime proof.
- Use versioned ADRs when tradeoffs exist, plus red/green regression tests and review by a different specialist.
- Capture exact SHA, commands, outputs and outstanding external gates in `docs/agent-execution/`.
- Never claim a formal approval, deployment or metric without authentic evidence.
