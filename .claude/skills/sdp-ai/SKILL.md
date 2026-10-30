---
name: sdp-ai
description: Ground AI-generated commentary in verified KPI facts, safe prompts and review.
argument-hint: "[goal-id or scope]"
user-invocable: true
---

# sdp-ai

Arguments: $ARGUMENTS

Cloud or local AI optional and off by default. Keep calculations deterministic outside model; redact PII; prevent prompt injections from imported notes and ticket content; show citations/freshness; require human or properly authorized workflow review before official publication.

## Completion contract
- Inspect code and tests first; do not trust design docs as runtime proof.
- Use versioned ADRs when tradeoffs exist, plus red/green regression tests and review by a different specialist.
- Capture exact SHA, commands, outputs and outstanding external gates in `docs/agent-execution/`.
- Never claim a formal approval, deployment or metric without authentic evidence.
