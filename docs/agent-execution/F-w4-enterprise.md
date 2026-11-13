# F-w4-enterprise — PPM parity wave W4 (enterprise), evidence

Branch `goal/w4-enterprise` (from `222ab4b`, merged `sdp-waves` at `df506f0`). Scope per the coordinator: W4 rows of
`docs/audits/2026-11-12-ppm-parity/README.md` §5 **except external connectors** (deferred until the W2 MSPDI work).
ADR: `docs/ai-decisions/ADR-W4-ENTERPRISE-project-roles-collab-offline.md`. Migration **108** (+ rollback, proved).

| Clause | Built | Switch (default = today) | Tests |
|---|---|---|---|
| Finer PPM roles (pm, scheduler, resource manager, contributor, client) | `ppm_project_members.ppm_role`; pure `services/ppm/projectRoles.js`; enforced in the ONE plan-write gate (`refusePlanWrite` → `roleGate`, op per caller: write/delete/team/time/action); read grant in `portfolioAccess.canReadProject`; client = no write + no amount (incl. B7 export-policy paths); `capabilityRegistry.PROJECT_ROLES`; routes `GET/PUT /api/governance/ppm/project/:id/roles[/:mid]` (committee or the project pm; member must be linked → 409 `NO_ACCOUNT`; `ppm_events` row); Project roles panel | `ppm_project_roles_enabled` = 0 | `ppm-project-roles` (8: matrix, most-restrictive, read grant, registry ↔ decide), `ppm-w4-enterprise.smoke` role × route matrix + client tests |
| FR on all PPM pages | `public/lib/i18n/project.fr.js` (static + runtime keys of the board/comments/roles/offline UI); `project.html` moved from "French pending" to TRANSLATED_PAGES (value-less option codes allow-listed as CODE); portfolio dictionary extended for Now/Next/Later | existing `ui_i18n_pages` = 0 | `i18n-coverage` (43) |
| Comments with @mentions | append-only `ppm_comments` (UPDATE trigger); `services/ppm/comments.js` + `collabStore.js`; `GET/POST /api/governance/ppm/project/:id/comments[?task_id]`; mentions resolved only among readers (unresolved returned without reason); in-app notice, never the author, none while `notifications_stop` = 1; client 403 `CLIENT_READ_ONLY` | `ppm_comments_enabled` = 0 | `ppm-comments` (4), smoke comments test |
| Agile board on work packages | `public/lib/ppmBoard.js` (leaf tasks by status, unknown status → "other", move = existing task PUT + row version, presentation of who may move) + Board tab | `ppm_agile_board_enabled` = 0 | `ppm-board-nnl` (board part), smoke 409 STALE_VERSION for a contributor |
| Roadmap now / next / later | `public/lib/ppmRoadmapNnl.js` + portfolio panel (undated → "not scheduled", never guessed) | `ppm_roadmap_nnl_enabled` = 0 | `ppm-board-nnl` (roadmap part) |
| Offline project editing + conflicts + merge | `public/lib/ppmOfflineQueue.js` (ordered queue over draftStore, replay with row version, auto-rebase, per-field merge, refusals kept) + `ppmCollabUi.installOffline` (intercepts the page's task/milestone PUT and project GET) + banner / merge screen | `ppm_offline_edit_enabled` = 0 | `ppm-offline-queue` (5, incl. 50 offline edits zero loss = T8 logic) |

## Shared files touched (minimal)
`routes/governance.js` (accessCtx, canSeeMoney, refusePlanWrite/roleGate, project detail fields, history order, export
money), `routes/governancePpm.js` (features + register collab routes + annual pack money order), `routes/governanceWorkbench.js`
(team calls pass `kind 'team', op 'team'`; time calls `op 'time'` — no effect with roles off), `routes/governanceEvm.js`
(portfolio route reads before the money check), `services/portfolioAccess.js`, `services/capabilityRegistry.js`,
`public/project.html` (4 script tags, 2 hidden tabs + panes, roles panel, banner, `mountW4`), `public/portfolio.html`.
No change to services/ppm engine / scheduling files nor the Gantt module.

## Left / human decisions (all PROPOSED)
- Who holds which project role, and the role matrix itself (PMO). Who may comment (PROPOSED: every reader but a client).
- T8 field acceptance (50 real offline edits on a phone/laptop) and browser E2E of board / merge screen: human steps.
- External connectors (.mpp via converter, P6 XER, Jira/Azure DevOps): not built (after W2 MSPDI).
- A `ppm_role` on members is set only through the roles route (the team PUT does not touch it).
