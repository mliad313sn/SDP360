# F-P7A-PORTFOLIO — goals B3 (show my projects, sensitive projects) and B6 (audience-scoped roadmap publication)

Base `16a208b` · branch `goal/p7a-portfolio` · 2026-11-13 · ADR: `docs/ai-decisions/ADR-P7a-portfolio-sensitive-and-publication.md`.
Everything is IMPLEMENTED-DARK: three new PROPOSED switches, all `'0'` = today. Nothing here is enabled, approved or
field-accepted; enabling is a human decision (PILOT-PROFILE rows added, FLAG-REGISTER regenerated).

## Built, per clause
| Goal clause | Built | Proof |
|---|---|---|
| B3 default "my projects" + explicit "all" for admin tier / committee / finance (UI only, grants nothing) | `portfolio_my_projects_default`; API hint `my_projects {ids, can_see_all}` (`PA.myProjectIds`); page selector (`public/lib/portfolioMine.js`, `?show=all`) | `portfolio-sensitive.smoke` #1, #5; `roadmap-audience.test` (PortfolioMine) |
| B3 sensitive flag + rule in `canReadProject` (switch-gated) | column `portfolio_projects.sensitive` (101); `portfolio_sensitive_projects`; `canReadProject`/`filterPortfolio`; ledger guard; `PUT /portfolio/project/:id/sensitive` (committee, 404 off, `ppm_events` row) | `portfolio-sensitive.test` (4), `portfolio-sensitive.smoke` #2-#4 |
| B3 PROVE editor cannot read out-of-perimeter / sensitive project via API | list, detail, ledger, baselines → 404 for an editor of another site (scope off AND on) | `portfolio-sensitive.smoke` #3, #4; existing `portfolio-site-scope.smoke` green |
| B3 PROVE committee view unchanged | committee lists every project incl. sensitive ones | `portfolio-sensitive.smoke` #3; `portfolio-access-parity.smoke` green |
| B6 publication with audience (site, programme, committee, exec) + share-link expiry | `roadmap_publications` (101), `services/roadmapAudience.js` (pure), `routes/governanceRoadmapAudience.js`, engagement share kind `roadmap_publication`, publications panel on `portfolio.html` | `roadmap-audience.test` (4), `roadmap-audience.smoke` (4) |
| B6 amounts masked per audience (admin tier + finance-viewer only) | frozen only for committee/exec when the publisher reads money; served only to admin tier / finance-viewer; never on the share view | `roadmap-audience.smoke` #2-#4 |
| B6 PROVE perimeter + masking + expiry | out-of-audience 404, sensitive left out of site/programme, expired/revoked 404, share link dies with the publication, generic share route refuses the kind | `roadmap-audience.smoke` #2-#4 |
| Roadmap Manager migration (`roadmap_publication_enabled`) untouched | separate switch + route | `roadmap-audience.smoke` #1; existing roadmap suites green |

Migration `101_portfolio_sensitive_roadmap_audience.sql` + manual rollback `db/postgres_rollback/101_…_drop.sql`, proved
by `tests/ppm-rollback-scripts.test.js` (added to its list).

## Runs (throwaway PostgreSQL per file, swept with `tools/test/drop-test-dbs.js`)
- New: `portfolio-sensitive` 4/4, `portfolio-sensitive.smoke` 5/5, `roadmap-audience` 4/4, `roadmap-audience.smoke` 4/4.
- Neighbours (portfolio*, roadmap*, ppm* incl. rollback scripts, governance*, authz-*, rbac-*, export-share-boundary,
  i18n-coverage, flag-register, inventory-strict, ui-policy*, simplicity-budget, await-precedence, server-size-budget,
  cross-site sweeps, engagement*, switch-prereqs, capability-registry, business-only, readme-truth, test-runner-guard,
  workspace-profiles): **575/575 pass**. Second batch (pilot*, report-config*, connector-register, security/csp,
  share-*, migrat*, schema, docs/adr/traceability, i18n*, a11y-static, ux-*): **249/249 pass**.
- Regenerated: `docs/agent-execution/INVENTORY*`, `docs/ops/FLAG-REGISTER.md`, `docs/ops/AUTHZ-MATRIX.md`,
  `docs/ops/authz-matrix.json` (`AUTHZ_MATRIX_UPDATE=1`), `tests/.suite-manifest.json` (+4 files, total 5101). ESLint clean.
- Not run: the full `npm test`; no browser E2E (pages behind a session login) — the portfolio page JS was syntax-checked.

## Left / known limits
- `routes/myWork.js` benefit reviews join `portfolio_projects` without the sensitive rule (the rows are the user's own
  benefits; P5 agent owns that file) — follow-up if a member-less owner of a benefit must also be hidden.
- `my_projects` hint does not recompute rollups (summary, money) for the narrowed set — stated on the page.
- No UI to pick a site/programme by name in the publish form (ids typed) — UX follow-up.

## Human decisions
Enable `portfolio_my_projects_default`, `portfolio_sensitive_projects`, `roadmap_audience_publication_enabled`; who may
mark a project sensitive (built: committee/admin tier); audiences in use and publication owner; whether committee members
without admin should read amounts (invariant 2 deviation on the portfolio page, unchanged).
