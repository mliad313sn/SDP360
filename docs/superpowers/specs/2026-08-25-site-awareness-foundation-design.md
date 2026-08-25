# Site Awareness — Sub-project 1 (Foundation) — Design

**Date:** 2026-08-25
**Status:** Approved design (brainstorming), pending spec review + user sign-off before planning.

---

## Module vision (whole)

**Site Awareness** (nav) / **« Ma Vue Site »** (GM-facing title) is a **read-only** page that gives
a site's business leadership — **GM (General Manager)** and **FM (Finance Manager)** — a single
tabbed view of the performance and activity produced by their IT team, scoped to **their site
only**. Group business users (**CIO / CFO**) see all sites through a fleet comparison + a site
selector. It aggregates five existing operational modules — **Helpdesk, Inspections, Meetings
(Décisions), Site Actions, Activity Tracker** — at a **snapshot + key-lists** depth (no editing,
no PII, no new business calculations: it *reuses* existing per-site readers).

The module is deliberately decomposed into three sub-projects, each shipping working software:

1. **Foundation (this spec):** the two access roles, server-enforced site scoping, the
   cross-module **site-resolution layer**, the page shell with the tab bar + site selector, and
   **one tab (Helpdesk) working end-to-end** as the tracer bullet.
2. **Remaining four tabs:** Inspections, Meetings, Site Actions, Activity Tracker.
3. **Vue Groupe:** the fleet comparison table + `group-business` access.

Sub-projects 2 and 3 get their own spec → plan → implementation cycles.

---

## Goal (sub-project 1)

Ship a gated `Site Awareness` page that a `site-business` user for site X opens and sees **only
site X's Helpdesk snapshot + key lists**, with the access model and the cross-module site
resolution proven end-to-end, so the remaining tabs are pure repetition of an established pattern.

## Architecture

Standalone page (the `exec-view` / `site-report` precedent: its own gate, session via cookie,
`injectApiKey=false`, no `window.__ak`), served from `_htmlCache`, driven entirely by read-only
`/api/site-awareness/*` endpoints. No writes, no new schema beyond the two roles (which the
existing multi-role `users.roles` column already stores).

```
Browser  public/site-awareness.html   (data-require="site-business|group-business|executive")
  ├─ module-tabs bar: [ Helpdesk ] [ Inspections… greyed until SP2 ]
  ├─ site selector  (LOCKED to the user's site for site-business; free for group/exec)
  └─ GET /api/site-awareness/summary?site=CODE      → tab availability + site label
     GET /api/site-awareness/helpdesk?site=CODE     → Helpdesk snapshot + key lists

Server (routes/siteAwareness.js — factory, mounted like routes/opmanager.js)
  ├─ requireReportSession
  ├─ requireBusinessSite(req)  → resolves the AUTHORIZED canonical site_id (never trusts ?site
  │                              for site-business; validates ?site ∈ allowed for group/exec)
  ├─ services/siteResolve.js   → canonical site_id → { helpdesk_group, inspection_code,
  │                              tracker_code, meetings_code, site_name }
  └─ reuse existing per-site readers (getSiteHelpdeskWindow, MI readers) → WHITELISTED response
```

## Components (each with one clear responsibility)

### 1. Access model — two feature roles
- Add `site-business` and `group-business` to the recognised role set (client `auth.js`
  `data-require` OR-list already supports feature roles by exact match; server role checks read
  `req.reportUser.roles`).
- `site-business`: scoped to the user's `users.site_id`. **The server derives the site from the
  session, never from the request** — a `?site=` naming another site is ignored/403, not honoured.
- `group-business`: all sites (CIO/CFO). May pass any valid `?site=`; also unlocks the Vue Groupe
  (SP3). `executive` / `super_admin` inherit all-site access (hierarchy).
- The page gate is `data-require="site-business|group-business|executive"`; the **server is the
  enforcement point** (defence-in-depth, mirroring the admin-console pattern).

### 2. Site-resolution layer — `services/siteResolve.js` (the crux, pure)
The single hardest risk: every module uses a **different site code** (Ity = `SMI` in
meetings/inspection but `ITY` in tracker; Helpdesk scopes by `zoho_group`; Site Actions uses the
meetings code). A business user is anchored on the **canonical `site_id`** (reports.db `sites` /
`users.site_id`).

`resolveSite(deps, site_id)` → `{ site_id, site_name, helpdesk_group, inspection_code,
tracker_code, meetings_code }`, each field **nullable**:
- `helpdesk_group` ← `sites.zoho_group` (comma-split downstream, as the existing readers do).
- `meetings_code` ← `site_module_codes(module='meetings')`.
- `inspection_code` / `tracker_code` ← `site_module_codes` where present, else the module's own
  name→code mapping (`inspectionDb.siteNameToCode`, tracker `siteNameToCode`).
- **A missing code stays `null`** (never a guessed/borrowed code — CLAUDE.md's rule: a wrong code
  false-greens; `null` → that tab reads "non applicable"). Explicitly: Exploration / Tanda have no
  meetings code → their Meetings/Site-Actions tabs are "non applicable", by design.
- Pure + dependency-injected (readers passed in) so it is unit-testable against the real
  `site_module_codes` shape without a live DB.

`listAuthorizedSites(deps, user)` → the set of `{site_id, site_name}` a user may view:
`site-business` → exactly their `site_id`; `group-business`/exec → all active sites. Drives the
site selector options AND the server-side `?site=` validation.

### 3. Page shell + site selector — `public/site-awareness.html`
- Loads `_shell.js` + the `module-tabs` component (homogeneous nav).
- Renders the tab bar (Helpdesk active; the four future tabs greyed/"bientôt" until SP2) and a
  **site selector** populated from `/summary`'s authorized-site list. For `site-business` the
  selector shows one locked entry (their site); for group/exec it lists all sites.
- Header title "Ma Vue Site — <site_name>"; a "lecture seule" badge; empty/degraded states.

### 4. Server routes — `routes/siteAwareness.js`
- `GET /api/site-awareness/summary?site=` → `{ site_id, site_name, authorized_sites[],
  is_group_view, tabs:{helpdesk:true, inspections:false,…} }` — the page's bootstrap.
- `GET /api/site-awareness/helpdesk?site=` → **whitelisted** Helpdesk snapshot
  (`{ inbound, closed, sla_res_pct, sla_reply_pct, open_backlog, major_incidents_active }`) + key
  lists (6-week volume+SLA series via `getSiteHelpdeskWindow`; active MI list via the existing MI
  reader) — **PII-safe** (no requester/technician names; whitelist fields one at a time, the
  `exec-view` `pick()` pattern).
- Both: `requireReportSession` → `requireBusinessSite` (resolves the authorized site_id, 403 on a
  site-business user requesting a foreign site) → `siteResolve` → readers → response.
  Best-effort/dual-backend; all `rdb.*` **awaited** (await-precedence rule).

## Data flow

`site-business` user for HGO opens the page → `/summary` returns `{site_id:HGO, authorized_sites:
[HGO], tabs}` → selector locked to HGO → `/helpdesk?site=HGO` (or no site → session default) →
server ignores any other `?site`, resolves HGO's `zoho_group`, calls `getSiteHelpdeskWindow` for
the 6 ISO weeks + the active-MI reader, whitelists, returns → the tab renders snapshot tiles + a
6-week table + an active-MI list, all read-only.

## Error handling

- No session / wrong role → gate bounces (client) + 403 (server).
- `site-business` requesting a foreign `?site=` → 403 (never silently served).
- A module code is `null` for the site → that tab's endpoint returns `{applicable:false}`; the UI
  shows "non applicable pour ce site" (not a fabricated 0). Helpdesk always applies (every site
  has a `zoho_group`), but the pattern is set here for SP2.
- Any reader throw → best-effort empty payload, never a 500; the page shows a soft error.

## Testing

- `siteResolve` unit tests (real `site_module_codes` shape): resolves each module code; a site
  missing a code → that field `null`, never borrowed; `listAuthorizedSites` per role.
- Route smoke (`site-awareness-routes.smoke`): (a) `site-business` for HGO gets HGO; (b) same user
  requesting `?site=MGO` → 403 / forced to HGO; (c) `group-business` may pass `?site=MGO`; (d)
  unauthenticated → 401; (e) response carries **no** PII field (assert absence of
  requester/technician keys).
- `await-precedence` auto-covers the new dual-backend dispatchers.
- No golden touched (additive; PPTX/email unaffected).

## Non-goals (sub-project 1)

The other four tabs (SP2); the Vue Groupe fleet table (SP3); any editing; PII; a Finance/Assets
tab (a possible FM-specific future slice — GM and FM see the same view in V1); export; new
business calculations; a pg migration for anything beyond the two roles (already storable).

## Risks / open questions

- **Cross-module code coverage:** how complete is `site_module_codes` for inspection/tracker
  today? Where a module owns its own name→code map, `siteResolve` uses it; gaps surface as "non
  applicable", not wrong data. (Confirmed acceptable by the null≠0 rule.)
- **Role provisioning:** assigning `site-business` + a `site_id` to a real GM/FM user is an admin
  action (existing Users admin card) — no new UI needed in SP1, but the admin must set both.
- **Site selector for group view** is minimal in SP1 (a plain picker); the richer Vue Groupe is SP3.
