# 03 — Decisions and assumptions (consolidation)

**Governance.** On 2026-10-28 the user appointed a Product Owner to drive all product decisions "with full
understanding of group and sites constraints" and asked that the delivery proceed "without any action of
myself". The PO role is exercised by the delivery team (Claude). Product decisions are therefore taken and
recorded here. Decisions that the goal reserves to people (constraint 8) are **never** taken on the user's
behalf: they are recorded as `HUMAN_GATE` and the work they would unblock stays on the consolidation branch,
not deployed, not merged.

The 2027 decision log [`../2027/02-DECISION-LOG.md`](../2027/02-DECISION-LOG.md) (D-01…D-14) stays the
register for committee / CAB / security decisions. This file adds PO decisions (`PO-`) and engineering
assumptions (`AS-`).

## Product decisions (PO)

| ID | Decision | Rationale | Reversible |
|---|---|---|---|
| PO-01 | Consolidate on SDP360 2.0; 1.11 is a read-only reference; transplant controls one at a time with their tests | Goal §execution; no common ancestor | yes |
| PO-02 | Adopt 1.11 DEC-07 (meetings/inspection reads limited to own sites; admin tier unchanged) | Already a user decision on 1.11; matches D-14 "site-only scoping" | yes (revert route block) |
| PO-03 | Business-only accounts (only `site-business`/`group-business`) reach Site Awareness + session endpoints only | Goal P0-A policy; 2.0 sends them to `site-awareness.html` only | yes |
| PO-04 | Internal planning pages require a session; brand/design-system pages may stay public | No operational data on brand pages | yes |
| PO-05 | Site-less `admin` = central IT, all sites (1.11 DEC-04) | Coordinators are `editor` locked to sites since 2026-10-02 | yes |
| PO-06 | Apply security dependency fixes on the branch with full regression proof; release stays CAB (D-11) | "Resolve present high-severity advisories with regression proof" | yes |
| PO-07 | Test suite census: every file's test count is reviewed; adding/removing tests needs `--update-manifest` in the same commit | Goal P0-C | yes |
| PO-08 | **PostgreSQL is the only database** — SQLite removed from code, tests and dependencies (user instruction 2026-10-28: "all must be under PostgreSQL… remove sqlite at all"). Offline mode stays browser-side (service worker + local queue) | Prod has run 100 % PostgreSQL since 2026-07; the sqlite forks were dead code that let the suite pass while the production path was untested | partial: revert the branch commits (no data migration involved) |

## Human gates (not decided here)

| Gate | Needed for | Owner (per 2027 log) |
|---|---|---|
| Security sign-off of CG-01/CG-02 policy for release | release of `efd92e9` | Information Security |
| D-11 dependency upgrade release | release of `9e7d5f1` | CAB |
| D-12 signing key + CI SHAs | first signed release | Information Security + CI owner |
| D-01/D-02/D-03 KPI definitions, thresholds, scorecard | any official 2027 score | Committee |
| D-04 closure policy | `commitments_enabled=1` | Business/control owners + Committee |
| D-05 pilot sites | UAT/field validation | Sponsor + Group IT |
| D-06/D-07 Meraki / Meridian retirement | connector removal | CAB |
| D-15 (new) inventory of server-to-server dash-key clients | restricting CG-08 routes | Platform owner |
| Production deployment, CAB GO/NO-GO, real secrets, Finance approval, business acceptance | — | People only |

## Assumptions

| ID | Assumption | Check |
|---|---|---|
| AS-01 | PG 16 behaviour is representative of PG 17 for the schema/tests in scope | CI runs PG 17 service (`.github/workflows/ci.yml`) |
| AS-02 | No production state can be inferred from git history | deploy marker absent here |
