<!--
P06 PROPOSAL — NOT ACTIVE. Draft replacement for CLAUDE.md (today ≈566 KB). CLAUDE.md is the owner's project
memory: an agent must not delete or shrink it. A human approves the swap, then runs
  node tools/agent/claude-md-split.js --out=docs/claude
(lossless: `node tools/agent/claude-md-split.js --check`) and replaces CLAUDE.md with the text below this comment.
Until then the current CLAUDE.md stays authoritative.
-->
# SDP360 — rules every agent reads on every run

Short by design. History and module detail moved, unchanged, to `docs/claude/` (see "Where to read what").
When a rule here and an archive disagree, this file wins; when two archives disagree, the newer date wins.

## Non-negotiable boundaries
`.claude/rules/SDP360_BOUNDARIES.md` applies in full (data contracts, PostgreSQL only, null = unknown never 0/green,
no invented approval / signature / owner / date / threshold, no push / merge / deploy / live restore without a
separate authorised operator action, no secrets or production data in the repo or sent to a model).

## Platform facts
- **PostgreSQL is the only database** (PG17 target). The server refuses to start without `PG_URL`
  (`services/backendGuard.js`); every `*_BACKEND` variable is ignored. Every db-module export is async:
  write `(await f()).x`, never `await f().x` (`tests/await-precedence.test.js`).
- Stack stays Node + Express + PostgreSQL. No microservices, broker, new framework or TypeScript
  (ADR `docs/ai-decisions/ADR-P06-monolith-module-map.md`).
- Production: no access from the dev box. Commit → deploy ZIP → a human applies it, restarts pm2 with
  stop → wait → start (never `pm2 reload`), then runs `tools/deploy/mark-deployed.cmd`. Everything up to the
  deploy marker is in prod; the packager names the lots frozen behind it (`tools/deploy/frozen-lots.json`).

## Where code goes (each rule is enforced by a test)
- **New API route → `routes/<domain>.js`** (factory `module.exports = (deps) => router`, mounted in `server.js`
  where its neighbours are). `server.js` and `reports-db.js` only shrink (`tests/monolith-ratchet.test.js`,
  `tests/server-size-budget.test.js`); lower the ceilings in the same commit as an extraction.
- **New SQL for one table family → `services/<domain>Store.js`**, built by reports-db with its handle and
  re-exported under the same name (`tests/p06-reports-db-surface.test.js`).
- **Authorisation helpers are named guards** (`services/namedGuards.js`), catalogued in
  `services/capabilityRegistry.js` (`NAMED_GUARDS`); role checks go through `rdb.userHasRole(user, role)`,
  site checks through `services/userSites.js` — never `user.role === …` or `user.site_id === …`.
- Scheduled job → `services/sync/jobs.js` (never `cron.schedule`). Schema change → a new
  `db/postgres/<module>/NNN_*.sql` (never an `ALTER` inside `initPg*`). RAG thresholds → `public/lib/kpiRag.js`.
- New page → no inline script, served by `sendHtmlPage` so assets get `?v=`; listed in `services/pages.js`.
- Behaviour changes ship behind a `report_config` switch defaulting to today's behaviour; defect fixes ship on.
- Errors to the client through `services/httpError.fail`. French i18n entry for every new static UI string.

## Tests (PostgreSQL only)
```
export PG_ADMIN_URL=postgres://sdptest:sdptest-local-only@localhost:5432/postgres
NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" \
  node --test --test-force-exit <files>
```
New test files go into `tests/.suite-manifest.json`. Regenerate what you affect: `node tools/agent/inventory.js`
(+ `--strict`), the authz matrices (`AUTHZ_MATRIX_UPDATE=1` on `tests/authz-matrix-json.test.js` and
`tests/authz-route-matrix.test.js`), `node tools/agent/monolith-map.js`. `npx eslint .` must be clean.
A suite with "known failures" is worthless — keep it at zero red.

## Where to read what (after the split)
| You are about to… | Read |
|---|---|
| touch any area (cross-cutting traps) | `docs/claude/reference/known-pitfalls.md` |
| understand a feature's history | `docs/claude/history/<YYYY-MM>.md` (newest first), `CHANGELOG.md` |
| deploy / package / restart | `docs/claude/reference/deployment-reality-*.md`, `docs/claude/reference/deployment-steps-*.md` |
| add a page or browser asset | `docs/claude/reference/coding-principles-browser-side-asset-caching-*.md` |
| change a PPTX deck | `docs/claude/reference/pptx-canvas-*.md`, `helpdesk-slides-*.md`, golden `tests/pptx-monthly-golden.test.js` |
| change an SLA target | `docs/claude/reference/incident-sla-configuration-zoho-desk.md` |
| work on Tracker / Inspection / Meetings / Risk Register / Exec View | `docs/claude/reference/<module>-*.md` |
| find a file | `docs/claude/reference/key-files.md`, `docs/agent-execution/P06-monolith-map.md` |
| record evidence or a decision | `docs/agent-execution/`, `docs/ai-decisions/` |
