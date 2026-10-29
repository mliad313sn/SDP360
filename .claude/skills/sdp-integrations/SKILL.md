---
name: sdp-integrations
description: Safely operate SDP/Zoho, OpManager, Meraki, Microsoft and other approved read-only data contracts.
argument-hint: "[goal-id or scope]"
user-invocable: true
---

# sdp-integrations

Arguments: $ARGUMENTS

Keep ServiceDesk Plus source authority, OpManager infrastructure monitoring, Meraki WAN/SLA. No new excluded-system API connections (Pronto, OT/HSE, ISP, Nutanix, backup, Defender, external PPM). Verify official rate limits and source coverage; retry with backoff, watermarks and empty-fetch protection; track UNKNOWN/STALE.

## Completion contract
- Inspect code and tests first; do not trust design docs as runtime proof.
- Use versioned ADRs when tradeoffs exist, plus red/green regression tests and review by a different specialist.
- Capture exact SHA, commands, outputs and outstanding external gates in `docs/agent-execution/`.
- Never claim a formal approval, deployment or metric without authentic evidence.
