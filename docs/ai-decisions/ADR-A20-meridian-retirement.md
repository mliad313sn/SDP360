# ADR-A20 — Meridian connector retirement in two phases (phase 1 = reversible kill switch)

Status: AI technical decision · 2026-11-04 · the **business choice is NOT taken**: retiring Meridian belongs to the
Platform Owner + CAB (repo decision log **D-07 "Meridian connector retirement"**, still **Open — removal needs CAB**;
playbook D-5). This ADR describes a switch and a plan; it approves nothing.

## Context
Meridian (the PMO app federation, F1, August 2026) was removed from the integrations plan by the user on 2026-09-02.
Its keys (`meridian_base_url`, `meridian_out_key`, `meridian_in_key`) are empty in prod, so the connector is dormant
but its code is still mounted: `GET /api/actions/open` (exempt from the global `/api` gate, guarded by its own
`X-API-Key`), `POST /api/meridian/sync`, the nightly job `meridian.resources` (05:00), the Site Actions
"▸ Projet" badge fold and the admin card `#ap-meridian`. Connector register row **C09** = `DORMANT`.

Deleting that code is irreversible except by `git revert` and touches a gate exemption, a scheduled job and the
admin console — a CAB-gated change. Hence two phases.

## Decision — phase 1 (this change, mergeable now, reversible, deletes nothing)
`report_config.meridian_enabled` in `services/reportConfig.js` DEFAULTS:
- `1` (**default = today**): connector mounted, inert while the keys are empty. Behaviour unchanged.
- `0` (**PROPOSED** value, `docs/ops/pilot/PILOT-PROFILE.md`): retired —
  - `GET /api/actions/open` → **404** before the key check (`routes/meridian.js`; the route is gate-exempt, so the
    404 comes from the handler itself);
  - `POST /api/meridian/sync` → **404** (server.js);
  - `tools/meridian/sync-resources.main()` → `{skipped:"disabled"}` before any DB read or network call (the
    nightly job `meridian.resources` therefore records a skipped run; it is OPTIONAL so it never turns stale);
  - `routes/siteActions.js` skips `meridianLinks.getLinksForSite` → every `project` stays `null` → no badge;
  - admin card: checkbox "Connecteur Meridian actif" (`#cfg-meridian-enabled`, saved through the generic config
    PUT, super_admin-gated like the other `meridian_*` keys); unchecked → URL/key inputs and the Sync button are
    hidden and "Connecteur retiré (meridian_enabled = 0)" is shown. All existing element ids are kept.
- Read per request: no restart either way.
- Independent hardening shipped with it: the inbound key is compared in constant time (`crypto.timingSafeEqual`
  on SHA-256 digests, so neither content nor length leaks) instead of `!==`.

Nothing is deleted: no file, no table, no `report_config` row, no DEFAULTS key. Stored secrets stay encrypted in
`report_config` until an operator clears them.

**Rollback**: set `meridian_enabled` back to `1` (Admin ▸ Intégrations ▸ Meridian, re-check + Save), or revert
the commit — the previous behaviour is restored exactly.

## Phase 2 (separate goal A-20b — do NOT execute before CAB approves D-07)
Pre-condition: switch at `0` for at least one month with no caller of `/api/actions/open` or `/api/meridian/sync`
in `system_log` / access logs, and a CAB record. Ordered checklist:
1. Delete `routes/meridian.js`, `services/meridianActions.js`, `services/meridianLinks.js`,
   `services/meridianResources.js`, `tools/meridian/sync-resources.js` (and the empty `tools/meridian/`).
2. `server.js`: remove the global-gate exemption for `GET /actions/open`, the `POST /api/meridian/sync` route and
   the `app.use(require('./routes/meridian')(...))` mount.
3. `services/sync/jobs.js`: remove the `meridian.resources` job, its FRESHNESS entry and its OPTIONAL entry.
4. `routes/siteActions.js`: remove the Meridian fold (keep `project: null` only if a consumer still reads it —
   `public/site-actions.html` badge code can then go too).
5. `public/reports.html`: remove card `#ap-meridian`, its rail label ("SSO & Meridian"), `_ADMIN_PANEL_IDS.meridian`,
   `PANEL_GROUPS.integrations` member, the super-gate entry, the loader line, the hash allowlist entry and the
   `loadMeridianConfig` / `applyMeridianEnabled` / `saveMeridianConfig` / `syncMeridianNow` functions — in ONE edit
   (a save/load line left without its element bricks the inline admin script).
6. `routes/adminConfig.js`: drop `meridian_*` from `MERIDIAN_KEYS` (keep the GET redaction of the two keys while
   the rows exist).
7. `services/reportConfig.js`: **keep** the four `meridian_*` keys in DEFAULTS, marked deprecated (non-destructive);
   keep the two keys in `_SECRET_BLANK_KEEP`. `services/configSecrets.js` comment: update only.
8. Tests: delete `meridian-actions`, `meridian-links`, `meridian-resources`, `meridian-route.smoke`, `meridian-sync`,
   `meridian-retired`; adapt `site-actions-routes.smoke` (A-20 case), `authz-route-matrix` (exemption entry),
   `report-config-meridian` (deprecated keys still accepted), `connector-register`, `config-secrets`; then
   `npm test -- --update-manifest` (the guard fails on missing files otherwise).
9. `docs/sdp360/completion/CONNECTOR-REGISTER.csv` C09 → `OFF`; `eslint.config.js` "Meridian/**" ignore,
   `docs/MERIDIAN_INTEGRATION_CONTRACT.md` and `public/itsm-integrations-plan.html` → mark historical;
   `reports-db.js` roadmap seed label only, leave it.
10. Never: drop `report_config` rows, touch Meraki (D-06: kept) or 4MyPeople.
