---
name: sdp-data
description: Design and validate PostgreSQL17 schema, migrations, lineage, backups and trustworthy reporting data.
argument-hint: "[goal-id or scope]"
user-invocable: true
---

# sdp-data

Arguments: $ARGUMENTS

Protect committed data, append-only audit events, owner-specific grants, idempotent backfills, report snapshots and the single metric registry. Validate locale/date, provenance, null/UNKNOWN, encryption and rollback. Never invent production data.

## Completion contract
- Inspect code and tests first; do not trust design docs as runtime proof.
- Use versioned ADRs when tradeoffs exist, plus red/green regression tests and review by a different specialist.
- Capture exact SHA, commands, outputs and outstanding external gates in `docs/agent-execution/`.
- Never claim a formal approval, deployment or metric without authentic evidence.
