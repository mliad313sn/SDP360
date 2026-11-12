# Rebuild spec — capabilities of the unavailable "review.1" build, re-specified from the written evidence

Requester decision (12 Nov 2026): **do not wait for the review.1 artifact; rebuild the capability from prompts.**
Sources: the gap analysis (`ecarts`), the value/modernisation/fitness evaluation pasted by the requester on 12 Nov, and the
vision pack. Nothing here copies review.1 code (we never saw it): each capability is re-specified from what those documents
say it does, then built natively on head. Migrations 078 and 079 are therefore free for this work.

## What the documents say review.1 adds over head

| # | Capability | Stated behaviour (evidence) |
|---|---|---|
| R1 | Presentation profiles | 11 profiles, each = declared roles + initial order of destinations + cards + density + context: administrator (super_admin: home, dashboard, integrations, system-logs) · executive (executive, scorecard-viewer: home, exec-home, it-review, portfolio) · business (site-business, group-business: site-awareness; never queries the internal queue) · operations (admin, editor: home, dashboard, site-actions, assets) · coordinator (editor, report-author: home, site-actions, inspections, meetings) · field (editor, field-tech: home, field, inspections, site-actions) · pmo (admin, committee-member: home, portfolio, cockpit, tracker) · finance (admin, finance-viewer: home, finance-assets, portfolio, report-studio) · governance (admin, committee-member, audit-viewer, kpi-committee: home, cockpit, meetings, policies) · analyst (admin, scorecard-viewer, dashboard-publisher: home, dashboards, analytics, report-studio) · reader (any: home, dashboard, site-actions, dashboards). Presentation only: **never changes rights**; login lands on a space compatible with the role. |
| R2 | Workspace settings | `workspace-settings.html`: a person changes and re-reads a preference (profile choice among those their roles allow, card order/visibility, density, default site), returns to Home, no effect on rights. Personal preferences are stored server-side per user (dev had zero rows). |
| R3 | Progressive action queue "S1" on Home | One queue of the person's authorised work across sources (site actions, meetings, inspections, report follow-ups, commitments…): keeps the owner, shows each source as it loads (sources and cards load independently; a failed or slow source shows its own state), states available / unknown / stale / partial / denied distinguishable without colour, French, usable at 320 px. Known limits to make explicit: 12 sites, 150 results shown, register link as fallback when no exact deep link exists (prefer an authorised deep link). |
| R4 | Shared navigation | One active destination chosen from route + query + fragment (exactly one aria-current); compatible links carry the current site. |
| R5 | Native project workbench | Project page as a workbench: plan, tasks, dependencies, milestones, teams/resources, risks, changes, time/actuals, costs, benefits, list / board / timeline views of the portfolio, controlled roadmap publication (private → portfolio with preview + confirmation, parity, duplicates, archive, rollback). |
| R6 | Repeatable end-to-end demonstration (F02/E03) | Throwaway PostgreSQL: two sites, synthetic roles, preferences, project, dependency, milestone, risk, actuals, benefit; journey from Home to export and audit trail; inventory of data created and removed. |
| R7 | Source freshness end to end (F03) | Per promoted source: job, last VALID collection, window, coverage; states never-synced, error, stale, partial, measured zero. (Covered by plan F bundle F1-SYNC + F1-DATA.) |
| R8 | Write fence for sync | "mécanisme de clôture d'écriture pour la synchronisation" — a sync writes only inside a fenced transaction/lease so two runs never interleave. |

## Rules
- Build on what head already has (ui_role_landing, workspaces/exec space, page head, home My work, native PPM 039+, portfolio, roadmap). Extend; do not duplicate.
- Everything new ships behind a `report_config` switch defaulting to today's behaviour; profiles are presentation only and are tested to grant nothing.
- No invented approvals, field results or benefits. Demo data lives only in a throwaway database and is labelled synthetic.
