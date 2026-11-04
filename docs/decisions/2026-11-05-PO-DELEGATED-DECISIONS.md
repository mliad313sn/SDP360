# Decisions taken by the Product Owner under delegation — 5 Nov 2026

**Mandate.** On 4 Nov 2026 the user delegated the open product decisions to the Product Owner, "with support of the
committee". The PO here is the AI product-owner role of this programme. These decisions are therefore **delegated product
decisions, not signatures by a named person**. Each one is reversible, records its committee rationale, and lists what it
changes in code.

**How a decision reaches production.** A decision sets the **pilot value** of a switch in `docs/ops/pilot/PILOT-PROFILE.md`
and steers the goals of plan v3. Code defaults stay **today's behaviour**. A value only changes on a server when an operator
applies it with `tools/reports/set-ui-policy.js` (or the Admin card) at deployment. Deployment itself stays a human act.

**Outside this mandate (only real people can do these):**
- naming people (approvers, HSE issuers);
- supplying roster and qualification data;
- the user-acceptance test (UAT) with pilot users;
- the screen-reader session;
- the TEST install/restore drill;
- CAB approval;
- secret rotation;
- production deployment and its go/no-go signature.

## 1. Product and screens

| # | Subject | PO decision | Committee rationale | Effect in code |
|---|---|---|---|---|
| P1 | Executive surfaces (F16/G14, D-6 menu part) | **Two entries in the Executive menu: "Executive Home" (dashboard `exec-home`) and "IT Review".** Executive Scorecard stays reachable from Home and Ctrl+K but leaves the menu. exec-view stays the public SharePoint page. The Deck Builder stays under Reports. **Re-examine after 30 days of `page_viewed` counts (C-09).** | IA and UX: one question → one entry. Product: no deletion before usage facts are in. | New switch `ui_exec_nav` (`full` default, pilot `consolidated`) — goal C-28 |
| P2 | Deck Builder vs Report Studio (G24) | **No merge now.** Report Studio is the single publication chain. The Deck Builder stays the authoring tool of the monthly Group deck until screen↔deck parity is proven (C-16). Then re-decide. | Architect: no rewrite. QA: parity proof first. | Nothing beyond C-16 |
| P3 | IT Review palette (F15) | **Keep its Modernist identity**, in namespaced variables (C-09). | Design-system lead and brand: separate identity is legitimate; token clash is not. | C-09 |
| P4 | "Normal" changes and top-8 (F23) | **Show "Normal" as its own slice, and add "Other (n)" wherever a chart keeps only the top N.** Totals are always intact. | BI architect: nothing silently folded or truncated. | Switch `exec_deck_other_bucket` (`0`, pilot `1`) covers both — C-16 |
| P5 | Google Fonts | **Self-host the fonts** (open-licence files vendored under `public/vendor`). If they cannot be obtained offline, fall back to the system font stack. **No third-party font request.** | CISO / offline: no external calls (consistent with B-01). | Goal C-29 |
| P6 | Helpdesk ranking threshold (C-11) | **`MIN_SLA_RANK_N = 10` closed tickets accepted.** | Statistics: below 10, a percentage is not comparable. | none |
| P7 | Site label spelling variants in rankings | **Fold variants through the existing site-alias normalisation.** | Data engineer: one site = one row. | Goal C-30 |
| P8 | Cancelled tickets in the SLA denominator | **Stays under the existing `helpdesk_sla_definition` switch and the KPI committee.** The PO only requires that the tile, ranking and trend use the **same** definition. | ITIL: one definition per figure. | Goal C-30 aligns the trend chart with the tile under the switch |
| P9 | Unknown CAB / risk labels | **Grey "unknown" accepted.** Add labels when the service desk confirms them. | — | none |
| P10 | Heatmap retired, stale extra series greys the chart (C-04) | **Accepted.** | Data-viz lead: honest beats pretty. | none |
| P11 | Lean navigation (A-21, D-6 menu) | **Lean profile for the pilot.** | UX: fewer entries per role. | pilot `ui_nav_profile=lean` |
| P12 | Deck Builder access (D-6 page) | **`super_admin` + `report-author`.** | Reporting owner. | pilot `ui_deck_builder_roles=super_admin,report-author`; page gate widened in C-28 behind the same key |
| P13 | French (D-2) | **French on for the pilot sites.** A francophone coordinator reviews the wording in week 1. | Change management. | pilot `ui_i18n_pages=1` |

## 2. Rules, roles and governance

| # | Subject | PO decision | Effect |
|---|---|---|---|
| R1 | Report correction (D-3) | **`site_editor` for month 1 of the pilot, then `second_person`.** Reassigning a submitted report is refused (`report_reassign_submitted=0`). The drift banner turns on after one week. | pilot values in PILOT-PROFILE |
| R2 | Site score (D-03) | **Keep `legacy`** until the shadow table (`site-score-shadow.js`) has been read on one closed month. Then switch to `programme` if the two models' RAG disagree on ≤ 2 sites, or bring it back to the committee if not. | rule recorded; data-dependent |
| R3 | Meridian (D-07 / D-5) | **Retire:** `meridian_enabled=0` for the pilot. Code deletion (phase 2) after 30 days without callers. | pilot value |
| R4 | Department-level access (D-14) | **No department scoping in the pilot.** Site scope only; re-examine after UAT. | none |
| R5 | Inactive role holders (C-03) | **On** (`governance.skip_inactive_holders=true`). | pilot value |
| R6 | Capability catalogue (C-17) | **`shadow` for the pilot.** The platform owner reviews the `authz` log weekly. Enforcement goes route by route only after 2 weeks without unexplained divergences. The proposed `requires_request` list is **approved: risk `high` and `critical` capabilities require a request.** | pilot value + catalogue flags |
| R7 | Who approves access | **Site-scoped roles:** an admin-tier user holding that site, never the requester, the subject or the requester's deputy. **Platform roles** (`admin`, `executive`, `super_admin`, `tracker-admin`, `audit-viewer`): a `super_admin` other than the requester. **Emergency access:** a `super_admin`, max 24 h, mandatory review within 2 working days. | encoded as default policy in C-18/C-22 (editable) |
| R8 | Conflicting role pairs | **No hard role-pair conflict at platform level.** Separation is enforced **per object**, as today: no self-approval, no self-verification, no verifying work done as a deputy. Proposed pair to watch, flagged rather than refused: `report-author` + approver of the same report. | C-19 SoD registry |
| R9 | Rosters and coverage | **Manual entry and CSV, no HR connector.** Duty families: `site-it-support`, `network-oncall`. Minimum: mines = 1 eligible person per duty family per shift, 24/7; offices = business hours. **No roster data = "unknown", never green.** | C-20 defaults (editable per site) |
| R10 | Qualifications | **Kinds:** `site-induction`, `electrical-authorisation`, `working-at-height`, `confined-space`. Recorded by an admin-tier user, verified by someone other than the subject. **SDP360 never grants a physical authorisation.** Issuer names are provided by each site's HSE owner (human data). | C-19 defaults |
| R11 | Commitment owners | **Optional link to a user account; free text kept.** | C-21 |
| R12 | Soft delete (A-19) | **On, 30-day retention.** Purge switched on after the first 30 days, once the purge list has been read. | pilot values |
| R13 | Money certification / currencies (A-16/A-26) | **Display "Non certifié" on.** Parser `locale` after a clean dry run. Currencies per site come from Finance (human data). Outliers are flagged, not excluded. | pilot values |
| R14 | PPM baselines and alerts (A-27) | **Baseline versions on.** Re-baseline: committee only, with a reason. Alerts on with thresholds 5 / 10 days. | pilot values |

## 3. What remains with people

1. **Names:** approvers per site, HSE issuers, the francophone reviewer, and the platform owner who reviews the `authz` log.
2. **Data:** site currencies and rates, roster CSVs, qualification records, ISP contracts.
3. **Acts:**
   - TEST install/restore drill, CAB, secret rotation;
   - deployment and pm2 restart;
   - applying the pilot values;
   - UAT with pilot users;
   - screen-reader session;
   - the release go/no-go signature.
