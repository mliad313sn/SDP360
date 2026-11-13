# ADR-P7a — Portfolio "my projects", sensitive projects, audience-scoped roadmap publication

Status: accepted as an AI technical decision · 2026-11-13 · **not** reviewed by the access-policy owner, the PMO or
Finance · every behaviour below is behind a `report_config` switch whose default is today's behaviour; turning one on
is a human decision (`docs/ops/pilot/PILOT-PROFILE.md`). Goals B3 and B6 (`docs/audits/2026-11-12-goal-programme/GAP-MATRIX.md`).

## Context
B3: the portfolio page shows every project to everyone (site-scoped reads exist behind `portfolio_site_scope_reads`),
there is no "my projects" default and no way to keep a project confidential. B6: `roadmap_publication_enabled` is a
Roadmap Manager → portfolio migration, not a publication to an audience; there was no frozen, audience-scoped roadmap,
no per-audience masking of amounts and no expiring share.

## Decisions
1. **"My projects" default — presentation only** (`portfolio_my_projects_default`, '0'). When '1', `GET
   /api/governance/portfolio` adds `my_projects = { ids, can_see_all }`: ids = readable projects the user owns (free-text
   owner = username / full name / e-mail, the existing rule), holds a site of (primary + extra sites, `userSites`), or is a
   named team member of (`ppm_project_members.user_id`). The page opens on "My projects" and offers "All projects" only
   to the admin tier, the committee and finance-viewer (choice in `?show=all`). The API still returns everything the
   reader may read: nothing is granted, nothing is enforced here. Rollups (summary, money by programme) keep covering
   every readable project and the page says so.
2. **Sensitive projects** (column `portfolio_projects.sensitive`, migration 101; switch `portfolio_sensitive_projects`,
   '0'). When '1', `portfolioAccess.canReadProject` reads a sensitive project for: the admin tier, the committee, its
   owner, its named team members, and the holders of one of its sites — **in both states of `portfolio_site_scope_reads`**
   (the flag only narrows; it never widens). A group-level sensitive project (no site) is therefore read by the admin
   tier, the committee, its owner and its members only. Every read surface already goes through `canReadProject` /
   `filterPortfolio` / `readableProject` (list, project page, ledger, baselines, workbench, EVM, exports, report); the
   ledger route's guard now also fires when only the sensitive switch is on. Who may set the flag: the committee and the
   admin tier (`PUT /api/governance/portfolio/project/:id/sensitive`, 404 while off, hash-chained `ppm_events` row
   `sensitive_edit`). Plan writes are unchanged (an editor of the site may still edit when `portfolio_editor_plan_writes`
   allows it). Off = the column means nothing (rollback by switch; column removal = manual rollback script).
   *Proposed alternative left to the owner*: restrict site holders to the editor role only — not done, because the
   existing read rule lets any holder of the site read.
3. **Audience-scoped roadmap publication** (table `roadmap_publications`, migration 101; switch
   `roadmap_audience_publication_enabled`, '0' = every route 404). A publication is a **frozen** snapshot
   (`services/roadmapAudience.buildSnapshot`, pure) for one audience: `site` (projects whose sites include it, never a
   sensitive one), `programme` (projects under it, never a sensitive one), `committee` / `exec` (every project, sensitive
   ones flagged). Publisher: committee/admin for any audience, an editor of the site for a `site` audience. Reader: site →
   admin tier, committee, holders of the site; programme → admin tier, committee, holders of a published project's site;
   committee → committee/admin; exec → admin tier only. An expired or revoked publication reads as missing (404).
   **Amounts** (invariant 2): frozen only for committee / exec audiences, on request, when the publisher is admin tier or
   finance-viewer; served only to the admin tier and finance-viewer. This is **stricter** than the portfolio's
   `canSeeMoney` (which also admits a `committee-member`) — the publication follows the invariant, not the deviation.
   **Share link**: reuses the engagement share links (`share_links`, new kind `roadmap_publication`, created ONLY by
   `POST /api/governance/roadmap-publications/:id/share`; the generic `/api/engagement/share` refuses that kind). Only
   site / programme audiences may be shared; the TTL is capped at the publication's expiry; the public view never prints
   an amount and returns 404 once the publication is revoked/expired or the switch is off. Independent of
   `roadmap_publication_enabled` (the Roadmap Manager migration is untouched).

## Consequences
- Today's behaviour is unchanged with the three switches at '0' (tests pin it).
- A frozen snapshot does not follow later edits — by design (a publication is what was shown on that day); revoke and
  republish to refresh.
- Human decisions: enable each switch; who may mark a project sensitive (built: committee/admin); the audiences to use and
  the publication owner; whether committee members should read amounts (invariant 2 deviation on the portfolio page —
  unchanged here).
