# Development setup — SDP360

## 1. Toolchain
Node 22 LTS, npm 10+, PostgreSQL 17 (optional locally; `tools/pg/dev-up.sh`), Python 3 (executive PPTX renderer, `tools/exec-pptx/requirements.txt`).

```bash
cp DOTENV.example .env      # DASH_PASS ≥ 12 chars
npm ci
npm test                    # full suite, sqlite
npm run test:sdp360         # the SDP360 engine/sync suites only (~1 s)
```

## 2. Claude Code plugins (AI-assisted review)
Install the **official OpenAI Codex plugin** (`openai/codex-plugin-cc`) once per developer machine, inside Claude Code:

```
/plugin marketplace add openai/codex-plugin-cc
/plugin install codex@openai-codex
/reload-plugins
/codex:setup                                     # installs/checks the Codex CLI and sign-in
```

Optionally a maintainer can register the marketplace in the project's Claude Code settings (see the Claude Code docs on `extraKnownMarketplaces` / `enabledPlugins`) so new contributors are prompted to install it automatically.

Prerequisites: Node ≥ 18.18, the global `codex` CLI (`npm install -g @openai/codex`), and a ChatGPT account or OpenAI API key (`codex login`). The plugin runs the Codex binary **on the developer's machine**; it is not available in cloud sessions without that login.

Recommended use on this repo:

| Command | When |
|---|---|
| `/codex:review --base main` | before pushing a PR — second-opinion, read-only review of the diff |
| `/codex:adversarial-review "sync runner failure paths"` | for Phase 1 sync and RBAC changes |
| `/codex:rescue --background` | long investigations (e.g. a flaky smoke test) while you keep working |
| `/codex:setup --enable-review-gate` | optional: blocks a stop until review issues are addressed (heavy on usage limits) |

Alternatives from the Anthropic directory if the official plugin is not permitted in your org: *Codex Dispatch* (MCP-based delegation) or *codex-review* (plan ping-pong).

## 3. Conventions
- Tests next to the module name (`tests/<module>.test.js`), route tests as `*.smoke.test.js` booting the app on sqlite.
- New schema = new idempotent file under `db/postgres/<area>/NNN_*.sql` (+ sqlite twin in the data layer if the module still runs on sqlite).
- Every behaviour rule goes to `docs/sdp360/05` §7 or an ADR, not only to `CLAUDE.md`.
- Commits reference an RFI/DEC id when they implement a committee decision.
