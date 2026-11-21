# Release note — Helpdesk site filter: per-site numbers move (P11 round 7, F-26)

**Prepared by AI — to be validated by the named owners.** This is a release note, not a decision: nothing here is
approved, and no human cell is filled.

## What changed

Fix 28 (P11 round 6, F-21) replaced the Helpdesk dashboard's site filter. It used a raw substring test on the ticket's
`Site` value ("does the ticket's site contain the selected text?"). It now uses `siteMatches`
(`public/lib/helpdeskSiteDefault.js`): the ticket belongs to the selected site when both fold to the same site through
the shared alias table (`public/lib/siteAliases.js`), otherwise when the selected spelling appears as **whole words**
in the ticket's value. The change applies to **every user** on deployment — it is not behind the
`ui_helpdesk_site_default` switch (that switch only presets the dropdown).

## Effect on the numbers a site coordinator sees

Checked on the spellings below with the shipped code (`siteMatches` vs the former substring test):

| Selected site | Ticket `Site` value | Before | After | Why |
|---|---|---|---|---|
| `HOUNDE` | `HGO`, `Houndé`, `Hounde Mine` | not counted | **counted** | alias spellings of the same site are folded together |
| `HGO` | `Hounde Mine` | not counted | **counted** | same |
| `SABODALA - MASSAWA` | `Sabodala` | not counted | **counted** | the combined label folds into Sabodala (SGO), so it counts all Sabodala tickets |
| `MASSAWA` | `SABODALA - MASSAWA` | counted | counted | whole word |
| `LAFIGUE - SML` | `LAFIGUE` | not counted | **counted** | alias fold |
| `Ouaga` | `Ouaga2000` | counted | **no longer counted** | not a whole word, not an alias |
| `Ouaga` | `OUAGADOUGOU` | counted | counted | alias fold |
| `MANA` | `MANAGEMENT` | counted | **no longer counted** | was a substring false match |
| `ITY` | `CITY OFFICE` | counted | **no longer counted** | was a substring false match |

Consequences:

- Per-site Helpdesk counts (inbound, closed, SLA, ageing, technician tables) **change on the first load after
  deployment**, without any data change. Most changes are corrections (alias spellings now counted, substring false
  matches removed). The fleet ("All Sites") totals do not change.
- Month-on-month comparisons for one site across the deployment date are not like-for-like. Coordinators should not
  read the jump as a real change in activity.
- `SABODALA - MASSAWA` is treated as Sabodala. Whether a combined label should fold into one site is a decision for the
  owner of the site alias table (business-readiness register, HD-O15).

## Before the pilot

1. Warn the site coordinators of the pilot sites (the per-site numbers move once, at deployment).
2. Check the actual ticket `Site` spellings of the pilot sites against the alias table (the reviewer's 31-spelling
   check is in the round-7 review, not in this repository).
3. The alias-table owner decides the combined labels (HD-O15).

Code: `public/index.html` (`_siteOk`), `public/lib/helpdeskSiteDefault.js` (`siteMatches`), `public/lib/siteAliases.js`.
Tests: `tests/helpdesk-site-match-r6.test.js`, `tests/helpdesk-site-default-r5.test.js`.
