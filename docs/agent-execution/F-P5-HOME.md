# F-P5-HOME — bundle P5: Home queue (A3), access bundles (A4), Site Actions register (B2)

Branch `goal/p5-home` (worktree `/home/user/w/p5-home`), base `fe08c1c`, merged with `sdp-waves` `6a01d77` before the
final run. Not pushed, not merged. Every new behaviour is behind a switch that defaults to today's behaviour.

## What was built, per clause

### A3 — Home: one queue

| Clause | Status | Where | Proof |
|---|---|---|---|
| Access-request approvals awaiting me | DONE (dark, `ui_home_queue`) | `services/myWork.buildQueueExtra` (`access`), reader in `routes/myWork.js` = `accessStore.approvalsFor` (same rule as `GET /api/access/approvals`); never my own / one I filed | `home-queue-p5`, `home-queue-extra-route.smoke` |
| Change-request assessments awaiting me | DONE (dark; also needs `ppm_change_requests_enabled`) | `change_requests`: proposed = to assess, assessed = to decide, never my own (CR SoD) | `home-queue-p5` |
| Weekly report not submitted (my site) | DONE | queue source `obligations` derived from the site cards Home already reads (no new request); no deadline policy → never "late" | `home-queue-p5` |
| Pending stage-gate sign-offs | DONE (dark) | `gates`: projects at `approval` / `closure`, committee only, the owner never signs his own | `home-queue-p5`, route smoke (editor → empty) |
| My / my sites' open RFIs | DONE (dark) | `rfis`: always MY scope (mine + my sites) even for the committee; delivered ones I asked for = "confirm delivery" | route smoke (other site's RFI not shown) |
| Empty current-month tracker cells | DONE | `obligations` (tracker card) | `home-queue-p5` |
| My overdue portfolio tasks / milestones | DONE (dark) | `tasks`: owner matches me (`portfolioAccess.ownerMatches`), open, past due, live project | `home-queue-p5`, route smoke |
| Absent = unknown, never 0 | DONE | missing / throwing reader → `null` + `not_measured`; nothing measured → `total: null`; queue shows "not switched on" / "could not be read" / partial | `home-queue-p5` |
| Inline complete | DONE | posts to the SAME per-item routes (`/api/meetings/actions/:id/update`, `/api/inspection/actions/:id/update`, `/api/reports/action/:uid/status`) — no new route, no new right; only non-transfer statuses (no justification needed) | `home-queue-p5` |
| Inline snooze | DONE (dark) | `PUT /api/me/work/snooze` (session + `ui_home_queue` gate, 404 off), stored per user in `user_workspace_prefs.queue_snoozed` (migration 099 + manual rollback); ≤ 30 days, presentation only | route smoke, `ppm-rollback-scripts` |
| Inline delegate | DONE (needs `handoffs_enabled`) | "Delegate" opens `handoffs.html?delegate=1&…` prefilled (every parameter re-validated); nothing is sent until the person picks departments + receiver and saves (same handoff rules) | `home-queue-p5` (href, hidden while off) |
| Block order in workspace prefs | DONE (dark, `workspace_profiles_enabled`) | `block_order` (queue / awaiting / owned / sites) in `validatePrefs` + `resolve` + `user_workspace_prefs.block_order`; `home-page.js` orders the blocks | `workspace-*` suites |
| Load-time budget | PARTIAL | the perf baseline is report-only by design (budget "UNKNOWN — to be approved") so no page budget was invented; an **API** assertion was added: `/api/me/work` with every queue source < 1 s median of 5 (throwaway DB) | `home-queue-extra-route.smoke` |

### A4 — access bundles

| Clause | Status | Where | Proof |
|---|---|---|---|
| "Site Coordinator", "Committee Member" templates | DONE as DRAFTS | `tools/access/seed-bundles.js` (dry run default, `--apply`, idempotent, never publishes) — Site Coordinator = `editor` + `tracker-editor` (primary site, 365 d); Committee Member = `committee-member` | `access-bundles` |
| Template roles ⊆ known roles | DONE | `plan()` validates through `accessRequestLifecycle.validateTemplatePayload`, refuses unknown roles | `access-bundles` |
| A granted request gives exactly those roles | DONE | test publishes (standing in for the human act), files + approves a request: added roles = bundle roles; a role outside the bundle is refused | `access-bundles` |
| Switching profile grants zero new route — every profile × role | DONE | 11 profiles × 17 roles, ~70 role-gated GET routes from `docs/ops/authz-matrix.json`, forged prefs row (every destination, block order, snooze): allowed/refused identical, roles unchanged, served profile eligible | `workspace-profiles-grants-nothing-matrix.smoke` |

### B2 — Site Actions register

| Clause | Status | Where | Proof |
|---|---|---|---|
| Export (perimeter, amounts masked) | DONE | `GET /api/reports/site-actions/export.xlsx?site=` — hub perimeter (`siteCodeReadDenied`), explicit column list `siteActionsRegister.EXPORT_COLUMNS` (no amount exists; none can ride along), system log row | `site-actions-p5.smoke` |
| Bulk status update | DONE | `POST /api/reports/site-actions/bulk-status` loops the EXISTING per-item routes over loopback with the caller's session (`services/selfDispatch.js`) — same RBAC, same `statusTransfer` justification, same audit rows; per-line result, ≤ 50 lines | `site-actions-p5.smoke` (viewer refused per line, cancel w/o note refused, other site refused) |
| Owner reassignment + justification + audit | DONE | `POST /api/reports/site-actions/reassign` — editor + action's site among mine (admin tier any, site-less nothing); report follow-up = `_reportWriteDenial` (submitted frozen); justification ≥ 10 chars; audit row in `md_action_updates` / `insp_action_updates` / `audit_log` + system log | `site-actions-p5.smoke` |
| Aging reminders + escalation to coordinator | DONE (armed OFF) | `services/actionAgingReminders.js`, job `engagement.action_aging` (daily 06:45, optional); owner (one matching account of the site) else coordinators; escalation → coordinators; dedupe `B2:<level>:<source>:<id>:<due>`; inert unless `action_aging_reminders_enabled='1'` AND `action_aging_reminder_days` set; respects `notifications_stop` | `action-aging-reminders` |

## Switches (all default = today) — PILOT-PROFILE rows added

`action_aging_reminders_enabled` `'0'`, `action_aging_reminder_days` `''`, `action_aging_escalation_days` `''` (new).
Reused: `ui_home_queue`, `workspace_profiles_enabled`, `handoffs_enabled`, `ppm_change_requests_enabled`.
`uiPolicy` gains `handoffs` (not a ui_* key; tells Home whether to offer Delegate).

## Tests

New: `home-queue-p5` (7), `home-queue-extra-route.smoke` (4), `access-bundles` (3),
`workspace-profiles-grants-nothing-matrix.smoke` (2), `site-actions-p5.smoke` (3), `action-aging-reminders` (4).
Neighbour sweep (home-queue*, home-page*, workspace*, access*, site-actions*, status-transfer*, report-action-status,
export-share-boundary, authz-route-matrix, flag-register, inventory-strict, await-precedence, server-size-budget,
cross-site sweeps, my-work*, ui-policy*, connector-register, ppm-rollback, readme-truth, weekly-report-nudges,
business-only, capability-registry, first-usable, perf-baseline): **272/272** after the merge. Full suite (`npm test -- --update-manifest`, after the
merge): **5110 tests, 5100 pass, 0 fail, 10 skipped** (prod-snapshot suites, no snapshot here); manifest updated. Generated artefacts regenerated: INVENTORY(.json/.md/-STRICT), FLAG-REGISTER, AUTHZ-MATRIX (.md/.json).
ESLint clean.

## Human decisions needed

- Switch on `ui_home_queue` (+ `mywork_awaiting_me_enabled`, `workspace_profiles_enabled`) on a canary site; owner +
  rollback trigger.
- **Publish** the two draft access templates (Admin ▸ Access, super_admin) after review — and decide the approver matrix
  (`access_require_approval`). Run `node tools/access/seed-bundles.js --apply` on the target instance first.
- Aging reminders: escalation owner, `action_aging_reminder_days` / `action_aging_escalation_days`, then arm.
- Page-level load budget (perf baseline stays report-only until a budget is approved).

## Known limits

- Bulk status goes over loopback HTTP; behind IIS it counts against the global rate limiter (300 / 15 min / IP — ≤ 50
  lines per call).
- Gate sign-offs list every project at approval/closure for the committee (no per-gate assignee in the schema).
- `home-page.js` is shared with G3-UX (field badge): only `mountQueue` options, `orderBlocks` and `placeQueue` were added.
- Migration number 099 may collide in prefix with a parallel bundle; ids are file names, so it does not clash, but check order.
