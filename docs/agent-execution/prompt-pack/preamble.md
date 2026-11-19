COMMON RULES FOR PROMPT-PACK AGENTS (SDP360, Node/Express 5 + PostgreSQL only)

FRAME: P00 of /home/user/SDP360/docs/agent-execution/prompt-pack/prompt-pack.md applies in full (QUALIFY NOT BUILD; HUMAN-ONLY fields are never filled; label AI reviews as AI; STOP AND REPORT conditions). The independent assessment that motivated the pack is in (assessment not recoverable after the container reset; use the summary in prompt-pack.md and docs/audits/2026-11-12-*/) (read sections 1, 5, 6, 7). Read your own prompt section (Pxx) in prompt-pack.md and do it.

SETUP: `cd /home/user/SDP360 && git worktree add -b qual/<LOT> /home/user/w/<LOT> <BASE> && ln -s /home/user/SDP360/node_modules /home/user/w/<LOT>/node_modules`. Work only in /home/user/w/<LOT>. Commit there. Commit OFTEN (the container can be reclaimed). Do NOT push, merge, tag, or touch /home/user/SDP360's working tree. Never touch live systems.

PARALLELISM — ten agents run at the same time on one disk (≈60 GB free at relaunch). Therefore:
- NEVER run the full suite (node tools/test/run-all.js / npm test) and never run tools/test/drop-test-dbs.js. Run only targeted test files. The orchestrator runs the full suite at merge time; where your prompt asks for a full-suite result, cite the orchestrator's latest run (given below) and say you did not re-run it.
- Keep each test invocation small; delete temp dirs you create. Check `df -h /` before any heavy step; if < 3 GB free, stop heavy work and report.
- Stay in your lane: other agents work on P01..P10 at the same time. Touch shared hot files (server.js, reports-db.js, public/project.html, tests/.suite-manifest.json, services/reportConfig.js) minimally; P06 owns refactoring of server.js / reports-db.js — others must not move code there.

TESTS: `export PG_ADMIN_URL=postgres://sdptest:sdptest-local-only@localhost:5432/postgres && NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" node --test --test-force-exit <files>`. If PG is down: `service postgresql start`. Never use production URLs, .env credentials or real secrets. New test files go into tests/.suite-manifest.json ("file": count, total = sum, JSON indent 1). Regenerate generated artefacts you affect (node tools/agent/inventory.js and --strict; tools flag-register; AUTHZ matrices via AUTHZ_MATRIX_UPDATE=1 on tests/authz-matrix-json.test.js + tests/authz-route-matrix.test.js). `npx eslint .` clean. French i18n entries for new static UI strings. Errors via httpError.fail. Behaviour changes behind a report_config switch defaulting to today (defect fixes ship on). null = unknown, never 0/green.

INVARIANTS: .claude/rules/SDP360_BOUNDARIES.md; site perimeter; money only admin tier + finance-viewer; no invented owner/approval/date/threshold/signature (leave empty, mark PROPOSED); no prod data; source systems read-only.

DELIVER: evidence in docs/agent-execution/ (name it after your prompt, e.g. P02-authz-outcomes.md), decisions in docs/ai-decisions/. Commit footer:

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WyKJzoJkxxdA63EkAxcCMC

REPORT (concise): head SHA; commands run + results; files/migrations/switches changed; what remains; which human decision is now unblocked; anything STOP-AND-REPORT.
======
1:# SDP360 — enterprise-grade prompt pack
5:## P00 — Operating frame (run first; every later prompt inherits it)
45:## P01 — One baseline, one truth
77:## P02 — Authorization outcome assurance
114:## P03 — Switch activation in lots
151:## P04 — PPM certification, not more PPM features
184:## P05 — Performance budgets and service levels
217:## P06 — Reduce the monolith, keep the stack
247:## P07 — Security closure and penetration-test readiness
278:## P08 — KPI and data certification pack
312:## P09 — Adoption and field readiness kit
346:## P10 — Evidence dossier per human gate
373:## P11 — Independent qualification run