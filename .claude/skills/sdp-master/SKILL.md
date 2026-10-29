---
name: sdp-master
description: Orchestrate the entire SDP360 remediation roadmap with scoped autonomous implementation and proof gates.
argument-hint: "[goal-id or scope]"
user-invocable: true
---

# sdp-master

Arguments: $ARGUMENTS

Read `SDP360_GOALS_READY_TO_PASTE_EN.md` and `SDP360_ROADMAP_FR.md` in the root of this pack after installation. Treat /goal as Claude Code built-in and this /sdp-master skill as dispatcher, not a /goal override. Identify the requested Gxx or ALL. Apply dependency order and scope limits in `.claude/rules/SDP360_BOUNDARIES.md`. Use `sdp-decision` for reversible architectural decisions. For every goal, delegate code/domain inspection to specialist subagents, isolate implementation in a worktree, and have sdp-qa-lead + sdp-ciso run an adversarial review. Track status only from test results. If the work requires genuine human authority or inaccessible source data, put blocker in docs/agent-execution/external-gates.md (never edit an official signoff table) and continue independent tasks; never silently treat the gate as passed. Use modes AUDIT, DESIGN, BUILD, VERIFY, REVIEW, PACKAGE, STOP (workflow conventions, not a third-party MODS system).

## Completion contract
- Inspect code and tests first; do not trust design docs as runtime proof.
- Use versioned ADRs when tradeoffs exist, plus red/green regression tests and review by a different specialist.
- Capture exact SHA, commands, outputs and outstanding external gates in `docs/agent-execution/`.
- Never claim a formal approval, deployment or metric without authentic evidence.
