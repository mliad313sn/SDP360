# PERSONA-COVERAGE — 14 personas × repository roles (M00 Phase 0)

Persona → role mapping is **proposed from source** (`reports-db.js` `ROLE_HIERARCHY` + `FEATURE_ROLES_KNOWN`)
and must be confirmed by the policy owner (DEC-01). Checklist columns follow §10 of the roadmap:
D = discoverability · R = server read · W = server write · ¬W = direct-write denial · ¬S = wrong-site denial ·
¬O = object-ID substitution denial · X = export boundary · Rv = revoked privilege · A = audit.
Legend: ✔ synthetic evidence exists (test named) · ◐ partial · — not yet evidenced.

| Persona | Pri | Repo role(s) | D | R | W | ¬W | ¬S | ¬O | X | Rv | A | Evidence / gap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Super administrator | P0 | `super_admin` | ◐ | ✔ | ◐ | n/a | n/a | n/a | — | ◐ | ◐ | `admin-superadmin-gate.smoke`, `breakglass.smoke`; restore/incident recovery unverified (M20) |
| Executive | P1 | `executive` | ◐ | ◐ | — | — | — | — | — | — | — | KPI contracts blocked (M05) |
| Scorecard viewer | P0 | `scorecard-viewer` | ◐ | ◐ | — | ◐ | — | — | — | — | — | route-authz viewer-403 only covers declared role middleware |
| Central IT administrator | P0 | `admin` (site-less) | ◐ | ✔ | ◐ | — | n/a | — | — | — | ◐ | inherited over-privilege = DEC-04 |
| Site coordinator/editor | P0 | `editor` + `users.site_id` (+`user_sites`) | ◐ | ✔ | ✔ | ✔ | ✔ | ◐ | ◐ | — | ◐ | `audit-report-write-auth.smoke`, `multi-site-editor.smoke`, `tracker-save-site-scope.smoke`; offline queue unverified |
| Read-only analyst | P0 | `viewer` | ◐ | ✔ | n/a | ✔ | — | — | ◐ | — | — | `route-authz.smoke` (viewer 403 on role-gated routes); **F-M02-001**: anonymous visitors no longer obtain the dash key |
| Site business owner | P0 | `site-business` | ◐ | ✔ | n/a | ✔ | ◐ | — | ✔ | — | — | `business-only-boundary.smoke`: server allowlist enforced (F-M06-001); per-site isolation inside Site Awareness = existing `site-awareness-routes.smoke` |
| Group business sponsor | P0 | `group-business` | ◐ | ✔ | n/a | ✔ | n/a | — | ✔ | — | — | DEC-02 decided; `business-only-boundary.smoke` |
| Portfolio manager | P1 | `portfolio-manager` | ◐ | — | — | — | — | — | — | — | — | M08 |
| Dashboard author | P1 | `dashboard-author` | ◐ | — | — | — | — | — | — | — | — | M09 |
| Dashboard publisher | P0 | `dashboard-publisher` | ◐ | — | — | — | — | — | — | — | — | M10 |
| Tracker author | P1 | `tracker-author` (+ legacy `tracker-editor`) | ◐ | — | ◐ | — | ◐ | — | — | — | — | `tracker-month-lock`, `tracker-save-site-scope.smoke` |
| Tracker publisher | P1 | `tracker-publisher` (+ legacy `tracker-admin`) | ◐ | — | — | — | — | — | — | — | — | M12 |
| Field technician | P0 | `field-tech` | ◐ | — | — | — | — | — | — | — | — | M13 — no real offline/device evidence |

Universal adversarial cases covered this run: **unauthenticated** (all 449 `/api` routes probed, 5 reach a
handler = the declared public list) and **direct API with a leaked bearer key** (19 routes, closed for
anonymous visitors by F-M02-001). Not yet covered: expired/revoked session per route, wrong division,
malformed identifier sweep, forbidden export per persona, stale/no-data, mobile/reflow, keyboard-only,
failed dependency.
