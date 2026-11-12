# Dependency triage ledger — PROPOSALS (E-Q05, audit Q-05)

> Agent proposal, 2026-11-06. Nothing here is merged, approved or scheduled: each row is a plan a person
> takes (or refuses) as its own reviewed change. **No lockfile was changed.** Sources: the open Dependabot
> PRs listed in `docs/agent-execution/SEC-01.md` ("Dependabot PRs") and G24 gate 4 (dependencies).
> "Changelog (offline)" says what could be read without network access: the newer versions are not in
> `node_modules`, so upstream notes were **not** re-read here; the notes are SEC-01's assessment.

Rollback for every row = **revert the single commit that changes `package.json` + `package-lock.json`**
(and the workflow file for actions), then `npm ci`. One bump per commit so a revert is surgical.

| # | Package (scope) | From → to | Kind | Breaking notes (SEC-01 assessment; changelog not re-read offline) | Suites to run | E2E journeys | Verdict |
|---|---|---|---|---|---|---|---|
| #5 | nodemailer (prod) | 10.1.7 → 10.3.1 | minor | none expected; SMTP transport options unchanged per SEC-01 | `mailer`, `report-config`, `send-*` CLI tests, `teams-sla-poll`, full `npm test` | none (no browser surface) | **safe** — take after CI |
| #11 | playwright (dev) | 1.56.1 → 1.64.1 | minor (dev) | browser build download changes; ubuntu-24.04 pin in ci.yml exists because 1.56 has no 26.04 build — re-check the runner image | `*-browser.test.js`, `npm run test:e2e -- --runs=2`, negative control | all 22 | **safe** for CI; verify the runner pin |
| #12 | github/codeql-action (CI) | 3.26.6 → 4.39.1 | major (action) | v3 being retired; keep the 40-hex SHA pin + version comment (`tests/ci-config.test.js`) | `ci-config` | none | **safe** — take, keep the pin |
| #4 #3 #7 | upload-artifact / download-artifact / setup-node (CI) | → 7 / 8 / 7 | major (actions) | upload + download must move **together** (artifact format); setup-node 7: runner/Node 22 check | `ci-config`; a full CI run incl. release dry run | e2e job (artefact upload) | **migration goal** — one reviewed change |
| #2 | softprops/action-gh-release (CI, release only) | → 3 | major (action) | release job inputs to review | `ci-config` (release asserts) | none | **migration goal** — release owner |
| #6 | dotenv (prod) | 16.6.1 → 18 | major | default logging / `quiet` behaviour changes; every `tools/reports/*` CLI loads `.env` first | `reports-cli-dotenv`, `backend-guard`, boot smokes, full `npm test` | T1, T2 (boot) | **migration goal** (low risk, but a major) |
| #8 | express (prod) | 4.22.3 → 5 | major | path-to-regexp v6 route syntax (RegExp `$metadata` route, `:param` patterns), `req.query` getter, async error handling | full `npm test`, `authz-route-matrix`, `html-pages-before-static`, every `*.smoke` | all 22 | **migration goal** — not safe as-is |
| #10 | eslint (dev) | 9.39.5 → 10 | major (dev) | flat-config + `eslint-plugin-security` / `globals` compatibility | `npm run lint` on the whole tree | none | **migration goal** |
| #9 | pptxgenjs (prod) | 3.12.0 → 4 | major | PPTX output must be re-proved | `pptx-monthly-golden` (must stay byte-identical or be re-approved), `pptx-*`, `tracker-pptx*`, `inspection-pptx*` | X1 exports | **migration goal** — golden fingerprint re-proof |

## Packages resolved outside registry.npmjs.org

| Package | Resolved from | Integrity | Reason | Manual review owner |
|---|---|---|---|---|
| xlsx 0.20.3 | `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` | sha512 in the lockfile | SheetJS stopped publishing to npm after 0.18.5; 0.20.x fixes CVE-2023-30533 and a ReDoS (SEC-01 row 1c). `npm audit` does not cover it. | **dependency owner (manual review)** — re-check cdn.sheetjs.com advisories at each release |

Pinned by `tests/dependency-sources.test.js`: a lockfile entry resolved outside the npm registry must carry
an `integrity` and appear in that test's allow-list with a reason and a review owner; a new one fails.

## Execution — F-ARCH-07 (bundle F1-OPS, 2026-11-12, branch `goal/f1-ops`)

Registry reachable through the agent proxy (TLS unchanged). One bump per commit; each install changed only the
listed lockfile entries. Action SHAs were checked against the **peeled upstream tags** (`git ls-remote`) and are
equal to the Dependabot branches. Nothing is merged: every row below waits for a person's review and a CI run.

| # | Bump | Result | Proof (local) | Left for a person |
|---|---|---|---|---|
| #5 | nodemailer 10.1.7 → **10.3.1** | **taken** (lock pinned to 10.3.1; `^` would have resolved 10.5.0) | mailer / report-config / send-* / teams-sla-poll / dependency-sources / version-consistency: 162 green | CI |
| #11 | playwright 1.56.1 → **1.64.1** (dev) | **taken**; `ubuntu-24.04` runner pin **kept** (a 26.04 build was not proven); `fsevents` (macOS optional dep of 1.56) leaves the lock | Chromium 1.64 downloaded; both `*-browser.test.js` + ci-config: 20 green, 0 skipped | the 22 e2e journeys in CI |
| #12 | codeql-action 3.26.6 → **4.39.1** | **taken** for `init` **and** `analyze` (the Dependabot branch moved `init` only — a v4/v3 mixed pair) | ci-config green | first CodeQL run |
| #4 #3 #7 | upload-artifact **7.0.2** + download-artifact **8.0.2** + setup-node **7.1.0** | **taken together** (16 pins, 3 workflows) | release notes read: download by `name`+`path` unchanged; setup-node 5–7 = Node 24 runtime, explicit `cache: npm` unchanged, no `registry-url`; ci-config + release tests 23 green | a full CI run incl. release dry run |
| #2 | action-gh-release 2.0.8 → **3.0.3** | **taken** (v3 = Node 24 runtime; inputs unchanged) | ci-config + release tests green | release owner: release dry run |
| #10 | eslint 9.39.5 → **10.14.0** (dev) | **taken with eslint-plugin-security 3.0.1 → 4.2.1** (3.0.1 crashed: `context.getSourceCode` removed in 10) | `npm run lint`: 0 problems; negative control: eval + unsafe regex still reported | CI |
| #9 | pptxgenjs 3.12.0 → **4.0.1** | **taken** | golden fingerprints unchanged and not regenerated; PPTX/deck/tracker/inspection/meetings suites 74 + 66 green | reporting owner: visual check in PowerPoint (the fingerprint is structural, not byte identity). Browser decks still use the committed `public/pptxgen.min.js` **3.12.0** — refreshing it is a separate change |
| #6 | dotenv 16.6.1 → 18 | **NOT taken — deferred** | parsing identical on `#`, quotes, backslash, comments; but v18 writes `◇ injected env (N) from <path>` to **stderr** at every `config()` unless `quiet: true` | add `quiet: true` at the 43 `dotenv.config` call sites (server.js is owned by F1-SEC this wave) or set `DOTENV_QUIET=true` in the service environment, then bump |
| #8 | express 4.22.3 → 5 | **NOT taken — deferred (blocker found)** | (1) the app does not load: `routes/reportStudio.js:102` `/:id.:fmt(html\|pdf\|csv\|pptx\|xlsx)` is rejected by path-to-regexp v8; (2) **security**: `req.query` is re-parsed on every access in Express 5, so the site-scoping write `req.query.site = codes` (`routes/meetings.js:120`, `routes/inspection.js:164`) is **silently dropped** — editors' list reads would lose their site scope while answering 200 (proved with a 5-line probe on 5.3.0) | migration goal: replace the two `req.query` writes with a request-local value read by the handlers (+ a test that fails on Express 5 today), rewrite the one inline-regex route, then run the full suite + e2e |

## Execution — #6 dotenv and #8 express (bundle G2-PLATFORM, 2026-11-12, branch `goal/g2-platform`)

Evidence: `docs/agent-execution/F-G2-PLATFORM.md`. Nothing is merged; both rows wait for a person's review and CI.

| # | Bump | Result | Proof (local) | Left for a person |
|---|---|---|---|---|
| #8 | express 4.22.3 → **5.3.0** | **taken**, after the code was made Express-5-safe under Express 4: (1) the read-scope guards keep the editor's sites on `req.scopedSites` instead of writing `req.query.site`; (2) the report-studio export route drops its inline `:fmt(…)` group; then, found by the suite on Express 5: (3) `app._router` no longer exists, so the authz shadow/enforce instrument wrapped **no** guard (fail-open) and every route walker saw an empty table — all read the stack through `services/routerStack.js`; (4) body-parser 2 leaves `req.body` undefined on body-less requests — `services/bodyDefault.js` restores `{}` | full suite on Express 5: 4873 tests, 0 failing after the inventories were regenerated; e2e journeys 40/40, browser units 4/4; new tests `read-scope-express5.smoke` (fails before the fix), `express5-route-syntax`, `router-stack`, `body-default` | CI + the e2e job; watch pm2 logs for 500s on POSTs without a body the first days |
| #6 | dotenv 16.6.1 → **18.0.10** | **taken**: `quiet: true` at all 42 shipped `config()` calls (server.js, `db/migrate.js`, `tools/*`) | `dotenv-quiet` (every load is quiet; the installed dotenv stays silent and loads the value), `reports-cli-dotenv`, `boot-config`, `backend-guard` green | CI |
