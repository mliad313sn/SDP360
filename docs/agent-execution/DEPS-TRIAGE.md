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
