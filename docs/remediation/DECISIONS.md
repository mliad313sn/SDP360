# DECISIONS — product decisions log

On 2026-10-28 the user appointed a Product Owner to drive all product decisions, with full
understanding of group and site constraints. That role is exercised by Claude in this
programme. Every decision below records the constraint it rests on and can be overturned by the
user. **Out of PO scope — still human gates:** secret rotation, production deployment, final
security approval (M02A ADR sign-off, device/data-retention policy), release GO/NO-GO (M22).

| ID | Question | Decision | Rationale (group / site constraints) | Implemented |
|---|---|---|---|---|
| DEC-01 | Persona → role mapping (PERSONA-COVERAGE.md) | **Approved as proposed.** Each persona maps to an existing role; no new role is created. The group-first access model (M02A) is NOT started until an ADR is written and signed by the security owner. | Roles already exist in `FEATURE_ROLES_KNOWN`; re-modelling access is a security architecture change, not a product call. | n/a (mapping only) |
| DEC-02 | Site-business vs group-business scope (M06) | **Confirm current behaviour as policy:** `site-business` = Site Awareness of their own site(s) only; `group-business` = Site Awareness of every site + group-level metrics; neither gets record-level module data (meetings/inspection records, portfolio, governance, admin). | A mine's business owner answers for one site; the group sponsor compares sites. Records stay with the operational chain. Matches `routes/siteAwareness.js`, `services/siteResolve.js`, `routes/metrics.js`. | already in code; M06 isolation tests still to write |
| DEC-03 | Anonymous pages | `itsm-integrations-plan.html` → **signed-in staff only** (server redirect to login). `design-system/*` + `dashboard-preview/` → **may stay public** (brand reference, no data). The 4 redirect stubs stay public. | An internal project plan names vendors, integrations and risks — not for the open network. Brand pages carry no operational data. | yes — `server.js`, test in `dashkey-injection.smoke` |
| DEC-04 | Site-less `admin` = global? | **Yes.** A site-less `admin` is the central IT team (today `dgoro`, `serge.guiro@`) and reads/writes every site. Every site coordinator stays `editor` locked to their site(s). Granting `admin` to a site person is forbidden by policy (use `editor` + extra sites). | Matches the 2026-10-02 demotion of the 25 coordinators; central IT must act on any site during incidents. | policy only (current behaviour) |
| DEC-05 | Field device storage / encryption / retention (M13) | **Product position:** the offline queue keeps an item only until the server acknowledges it; no inspection data is kept on the phone after sync; sites use managed devices with screen lock. **Encryption-at-rest standard = security owner sign-off (human gate).** | Remote mine sites need offline capture; minimising what stays on the device limits loss/theft impact. | to verify against `field-app.js` in M13 |
| DEC-06 | The 19 routes the dash key alone reaches | **Keep key access for now; no route is switched until the external X-Dash-Key clients are listed** (`_pm2_restart_prod.cmd` mentions them). New key-only routes are forbidden (test T-M02-004). Rotate the prod key after deploying F-M02-001 (**human: secret rotation**). | Switching blindly could break unknown integrations feeding sites' reporting; the leak itself is already closed. | guard test in place |
| DEC-07 | Meetings + inspection reads fleet-wide? | **Restrict to the reader's own site(s)** (user decision, 2026-10-28). Admin tier (`admin`, `executive`, `super_admin`) reads every site. Lists/roll-ups are narrowed server-side, `?site=` outside scope → 403, by-id → 403. Compliance leaderboard keeps only the reader's sites; its fleet-wide counts (actions without champion, escalations missing a theme) remain aggregates. | Same rule as weekly reports since lot 4 — one consistent model across modules. | yes — see below |

## DEC-07 implementation notes

- `meetings-db.js`, `inspection-db.js`: `_siteClause()` — a site filter is a code **or a list**; an empty list matches nothing.
- `routes/meetings.js`, `routes/inspection.js`: a read-scope step in front of every read route (lists, roll-ups, `unsigned`, `progress`, `compliance`, by-id, PV PPTX).
- **Visible effect:** a viewer/editor **with no site** now sees empty meetings and inspection pages (previously the whole fleet). Accounts that need group visibility must be `executive` or `admin` (DEC-04), or use Site Awareness with `group-business` (DEC-02).
- **Known limit:** pages whose site dropdown lists every site will get a 403 when a scoped user picks another site — the server is the boundary; trimming those dropdowns is an M03 UX follow-up.
- Tests: `tests/cross-site-object-writes.smoke.test.js` (by-id 403, `?site=` 403, no foreign row in 9 lists/roll-ups, admin tier unaffected).
