---
name: sdp-security
description: Review SDP360 security: RBAC, IDOR, SSO, secrets, audits, outbound, approvals and tenancy.
argument-hint: "[goal-id or scope]"
user-invocable: true
---

# sdp-security

Arguments: $ARGUMENTS

Treat HTML pages, API, CSV/XLSX/PPTX, blob/photo, share links, key-only routes, field outbox and report exports as equivalent authorization surfaces. Use deny-by-default and write negative tests. Never reveal credentials in logs, prompts or reports. Distinguish security engineering evidence from a real security sign-off.

## Completion contract
- Inspect code and tests first; do not trust design docs as runtime proof.
- Use versioned ADRs when tradeoffs exist, plus red/green regression tests and review by a different specialist.
- Capture exact SHA, commands, outputs and outstanding external gates in `docs/agent-execution/`.
- Never claim a formal approval, deployment or metric without authentic evidence.
