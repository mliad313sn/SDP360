# AMDEC 2026-11-05 — follow-up goals (plan-v3 row format)

Raised by the agent-run scenario campaign (not user acceptance). Ids `D-xx` continue after plan v3's `C-30`.
No migration number is assigned here (the next free numbers are allocated by the plan owner). Each goal starts with a
failing test taken from the campaign file named in "Closes".

| Wave | Id | Goal | Closes | Size | Switch | Mig |
|---|---|---|---|---|---|---|
| V6 | D-01 | Refuse a tracker save (and show a banner) when the account's tracker code is shared by two active sites; same guard for meetings/inspection codes. Never pick an owner automatically | AM-01 (ORG-e3) | S | `site_code_shared_block` (`0`) | — |
| V6 | D-02 | Site onboarding checklist on the site admin card: codes per module (from the registry diff), country/business unit, currency, Zoho group, coordinator; "fill the registry from the hard maps" dry-run before switch-on | AM-02 AM-03 (ORG-e1, ORG-e2) | M | — (read-only card + existing registry routes) | — |
| V6 | D-03 | One week vocabulary on screen: ISO-week charts say "ISO W37 (7–13 Sep)", or follow the Zoho week of the reports | AM-07 (DAT-04) | S | `ui_week_labels` (`legacy`) | — |
| V6 | D-04 | User create/update returns 400 naming any unknown role instead of dropping it; the users card shows the refused role | AM-04 (ORG-i) | S | — (defect) | — |
| V6 | D-05 | Report list: site and week filters + paging for central and multi-site accounts | AM-09 (WF-05) | S | — | — |
| V6 | D-06 | Money certification counts excluded rows (no currency, outliers): `certified:false` with a reason while any row is excluded | AM-05 rest (DAT-03) | S | — (defect) | — |
| V6 | D-07 | Per-site time zone (from country) for week/month bucketing of helpdesk figures; only needed if a non-UTC site joins | AM-08 (DAT-06) | M | `site_local_calendar` (`0`) | yes (site time zone column) |
| V6 | D-08 | Escape sweep of the remaining `innerHTML` templates on `reports.html` (cards, modals) with a static guard test like WF-06 | AM-13 rest (WF-06) | S | — (defect) | — |
| V6 | D-09 | Merge C-22 (emergency access) then run NE-01 of the campaign | AM-15 | — | `emergency_access_enabled` (`0`) | 063 |
| V6 | D-10 | Extend the campaign to the browser for the admin and scorecard-viewer journeys still "not covered" in PERSONA-JOURNEYS.md | AM-14 (prep only) | S | — | — |

## Human gates raised or confirmed by the campaign

1. **Owner of tracker code `TND`** (Assafo vs Tanda) — data owner decides; until then both sites share one scope (AM-01).
2. **Correct `Fetekro Explorarion Office` in ServiceDesk Plus** (source of record) — SDP administrator (AM-12).
3. **Switch the site-code registry on** (`PUT /api/governance/site-codes {enabled:true}`) — committee decision after D-02 (AM-02/03).
4. **Is Site Awareness business-only?** (admin tier gets 403) — product owner (AM-11).
5. **Who owns KPI thresholds** (a KPI-committee role or super_admin as today) — committee (AM-10).
6. **Currency per site and rates** (`asset_site_currency`, `asset_currency_rates`) — Finance supplies the data (AM-05).
7. **UAT with pilot users per country and organisation model**, screen-reader session, TEST install/restore drill, CAB,
   production go/no-go — people only (AM-14).
