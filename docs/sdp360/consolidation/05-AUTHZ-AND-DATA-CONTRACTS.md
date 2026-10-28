# 05 — Authorization and data contracts (consolidation)

Generated route × guard inventory: [`docs/ops/AUTHZ-MATRIX.md`](../../ops/AUTHZ-MATRIX.md) (written by
`tests/authz-route-matrix.test.js`, 444 routes on 2026-10-28). Caller probe: `node tools/qa/route-matrix.js out.json`
(none / dash key / viewer per route; `SDP_TEST_NO_RATE_LIMIT=1` is set by the tool).

## Server-enforced rules added by the consolidation

| Rule | Where | Deny test |
|---|---|---|
| Business-only accounts: `/api/site-awareness/*`, `/api/reports/auth/*`, `/api/auth/*`, `/api/ping` only; all else 403 | `services/businessGuard.js`, mounted after the `/api` gate in `server.js` | `business-only-boundary.smoke` (GET sweep of every route for site- and group-business; writes; mixed-role account unaffected) |
| Meetings reads: lists/roll-ups narrowed to the reader's sites; `?site=` outside → 403; by-id + PV PPTX → 403; compliance rows filtered; site pickers trimmed. Admin tier (`admin`, `executive`, `super_admin`) unrestricted | `routes/meetings.js` `_meetingsReadScope`, `meetings-db.js` `_siteClause` | `cross-site-object-writes.smoke` |
| Inspection reads: same rule | `routes/inspection.js` `_inspectionReadScope`, `inspection-db.js` `_siteClause` | idem |
| Object-ID substitution on id-keyed meetings/inspection writes | existing handlers (2.0) | idem (tests 1-5) |
| CSV cells starting with `= + - @ TAB CR` prefixed with `'`; numbers untouched | `public/lib/csvSafe.js` + inline rule in browser exports | `csv-safe.test` (static coverage of every writer) |
| Internal integrations plan requires a session | `server.js` `/itsm-integrations-plan.html` | `integrations-plan-gate.smoke` |

## Contracts to keep

- Site identity for scoping: **`services/userSites.js`** only (`codesFor`, `inScope`, `pickCode`); never `user.site_id ===`.
- A db reader's `site` filter is a code **or** a list (`_siteClause`); an **empty list matches nothing** (a site-less reader sees no site-scoped row).
- A site-less non-admin account reads no meetings/inspection rows (PO-05: site-less `admin` = central IT, unrestricted).

## Open (backlog #6)

Persona × site × department × object × action × channel matrix with deny tests for every module (2.0
currently has the route-level guard inventory + `route-authz`-style anonymous/viewer checks). Department
grants = D-14 (security).
