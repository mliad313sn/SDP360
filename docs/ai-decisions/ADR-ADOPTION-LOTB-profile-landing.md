# ADR-ADOPTION-LOTB — "Each profile lands on its job" (adoption review 2026-11-20, Lot B)

Status: technical decisions (reversible engineering details), taken by an AI agent in a sandbox. Every behaviour
change ships behind a `report_config` switch defaulting to `'0'` (today's behaviour). Which page each profile lands
on, what Home shows and which switches a pilot site turns on are **PROPOSED** for the pilot owner — nothing here is
approved. Source: `docs/ux/adoption-review-2026-11-20/ADOPTION-REVIEW.md` §5 (items 5, 6, 7, 11, 13, 14, 16, 22) and
§6 (Lot B).

## ADR-ADOPTION-LOTB-01 — profile landing reuses the workspace-profile catalogue (no second mapping)
- `ui_role_landing_profiles = '1'`: an account with **no hierarchical role above viewer** (feature roles only) whose
  landing would be the Helpdesk (`index.html`) lands on the first destination (after Home) of its **default workspace
  profile** (`public/lib/workspaceProfiles.js` `defaultProfile` + `PROFILES` + `mayOpen`). There is no new mapping to
  drift: the catalogue is already pinned to the shell menu by `tests/workspace-profiles.test.js`.
- Result with the catalogue as it stands (PROPOSED): committee → `portfolio.html`, finance → `assets.html#finance`,
  audit-viewer and KPI committee → `cockpit.html` (governance profile), dashboard publisher → `dashboards.html`,
  scorecard → `dashboards.html?key=exec-home` (executive profile), field tech → `field/index.html`, viewer /
  report-author → `index.html` (unchanged — the reader profile's first destination is the Helpdesk). The review
  suggested KPI committee → kpi-builder and scorecard → it-review; following the catalogue was preferred so that one
  list decides. Changing a profile's first destination in the catalogue changes the landing too.
- Editors and above, tracker editors and business accounts are untouched (they already have a role landing). Both
  values of `ui_role_landing` are honoured (the rule only replaces an `index.html` result).
- `login.html` now loads `lib/workspaceProfiles.js`; without it (or on a page that does not load it) `Landing.landingFor`
  never guesses — it keeps the role mapping.
- Enforcement: `tests/adoption-lota-nav-authz.test.js` (Lot B test) walks every persona of
  `docs/ops/authz-outcomes.json` and fails when the landing page's gate refuses or its primary route answers U/F.

## ADR-ADOPTION-LOTB-02 — Home group card and source freshness: existing routes only, unknown = "—"
- `ui_home_group_variant = '1'` and the person has no site (`/api/me/work` → `sites: []`): a group card with
  (a) worst sites from `GET /api/site-awareness/fleet` — offered **only** to the roles that route serves (executive
  tier); for others the line is absent (no call, no link to `site-awareness.html` which they cannot open);
  (b) late projects from `GET /api/governance/portfolio` (the server's `late` / `slip_days` flags — the same rule as
  the portfolio summary's `late_projects`); (c) decisions from `GET /api/governance/overview`
  (`decisions_open` / `decisions_overdue`). A failed or unusable answer reads "— non mesuré", never 0.
- `ui_home_freshness_strip = '1'`, admin tier: one line per connector from `GET /api/connector-health` (last
  successful collection; `last_success = null` → "jamais synchronisé" in amber).
- No new route, no new reader, no write. The ordering of worst sites (red before amber, then most red cells) is
  presentation of the server's colours, not a new score.

## ADR-ADOPTION-LOTB-03 — Helpdesk opens on the person's own site through the shared site-alias fold
- `ui_helpdesk_site_default = '1'`, a site-scoped person (not the admin tier) with a site: at the first fill of the
  site dropdown, `#fSite` is preset to the ticket-data spelling of the person's site, matched through
  `public/lib/siteAliases.js` `siteFoldKey` (the fold the Helpdesk ranking already uses). Site names come from
  `GET /api/reports/sites` (any session). No match → All Sites (nothing guessed); a choice the person already made is
  never overridden. A new key was preferred over re-purposing `ui_nav_carry_site` (the review's suggestion), which
  would change the meaning of a switch some pilots may already run.
- "Collapse the advanced filters" (same review item) is not done: it changes the page layout of every user and needs
  the browser review first.

## ADR-ADOPTION-LOTB-04 — French for three menu pages, behind the existing `ui_i18n_pages`
- `notifications.html`, `report-studio.html`, `integrations.html` get page dictionaries (static markup; script-built
  rows are the next pass), inert until `ui_i18n_pages = '1'`. Option texts that ARE the value posted to the API, code
  (paths, headers, key prefixes) and data examples stay untranslated, each with its reason in
  `tests/i18n-coverage.test.js`.

## Not done here, on purpose
- Items 13 and 14 (portfolio register view, "Mes projets" default semantics) touch `portfolio.html` / the portfolio
  routes, which another lot (portfolio Lot 3) is changing in parallel — left to that lot to avoid conflicting edits.
- Item 5 (pilot turns `ui_role_landing` on) and item 7's pilot switch (`ui_i18n_pages`) are pilot-owner decisions;
  recommended values are in `docs/ops/pilot/PILOT-PROFILE.md`.
- Item 2's partial-month tracker rule is a KPI-committee decision; the options are restated in
  `docs/agent-execution/ADOPTION-LOT-B.md`.

Rollback: set the four keys back to `'0'` (or leave them unset) — today's behaviour, no data touched.
