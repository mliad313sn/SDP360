# SDP360 — Completion master plan (G00)

Source: *SDP360 Deep Repository Assessment & Product Completion Programme* (committee desk review,
2026-10-28, cut-off `85ede0b`). Every gap the review lists (G-01…G-40) is tracked in [`GAPS.csv`](GAPS.csv);
release sign-offs are in [`RELEASE-GATES.md`](RELEASE-GATES.md); daily proof is in
[`DAILY-EVIDENCE.md`](DAILY-EVIDENCE.md). Decisions stay in their existing registers:
[`../2027/02-DECISION-LOG.md`](../2027/02-DECISION-LOG.md) (D-01…D-14) and
[`../consolidation/03-DECISIONS-AND-ASSUMPTIONS.md`](../consolidation/03-DECISIONS-AND-ASSUMPTIONS.md) (PO-, AS-, D-15).

**Decision status: NO-GO** for production and commercial release. This plan lists work and evidence. It
certifies nothing. Statuses: IMPLEMENTED · TESTED · FIELD_VALIDATED · DEPLOYED · BUSINESS_ACCEPTED, plus
BLOCKED (missing input or environment) and HUMAN_GATE (a person decides). A missing environment is BLOCKED, never PASS.

## 1. What changed since the review's cut-off (`85ede0b`)

The review's evidence predates three facts. Each one updates the plan:

| Fact | Effect on the review's gaps |
|---|---|
| **PO-08 (`f44591a`): PostgreSQL is the only database.** SQLite is gone from code, tests and dependencies. | Every "SQLite/PostgreSQL parity" or "both backends" requirement in G05, G09, G13, G15, G26 and G00 becomes **PostgreSQL only**. Parity work is replaced by migration-safety and collation-aware testing. |
| **CI on `f44591a`: `npm ci` succeeded.** 381/381 files ran, 2 761 tests, 1 failure, 11 skipped. | G-01 (ECONNRESET) did not recur. It is still hardened with a bounded install retry, because the network is not under our control. The one failure was a real defect (below). |
| **The failure was collation-dependent.** CI's `postgres:17` image uses `en_US.utf8`. Under that collation, TEXT comparison ignores punctuation, so a malformed `asOf` sorted after every date and caused a 500. Local test clusters used the `C` collation and hid it. | Fixed in `assets-db.js` (`_isoDayOrToday`). Test databases now use `en_US.utf8` by default (`tests/pg-helpers.js`, `SDP_TEST_PG_LOCALE`), which is closer to CI and to prod (English Windows locale). This was added to G-02. |
| **`f44591a` committed a `node_modules` symlink.** `.gitignore` had `node_modules/`, which matches only a directory. | Removed from the index. `.gitignore` now ignores the path whatever its type. A hygiene test refuses tracked symlinks and dependency folders (G-02). |

## 2. How the review's goals were strengthened

1. **Characterise first.** Several gaps were already closed on the consolidation branch: CG-01…CG-10, the
   version endpoint, ESLint SAST, CI on PG 17, and commitments scenario 2. They are tracked as *validate*, not *build*.
2. **One acceptance test per P0.** A gap is closed only by a test that **fails without the fix**: a deny test,
   a 500→200 test, or a parity test. Reading the code is not enough.
3. **Collation, timezone and locale are part of the environment contract.** Tests run with `TZ=UTC` and the
   `en_US.utf8` collation. Any TEXT date comparison must validate its input first.
4. **Nothing human is simulated.** Committee, CAB, Security, Finance, pilot-site and commercial cells in
   `RELEASE-GATES.md` stay empty until a named person fills them in.
5. **Inputs are never invented.** F01–F24 and the 41 chart contracts stay BLOCKED (CG-11) until the original
   `GAP-BACKLOG.csv` and `CHART-CONTRACT-REGISTER.csv`, or approved replacements, are supplied. The same applies
   to KPI formulas and thresholds (D-01…D-03) and financial figures (G14).
6. **Meraki is kept (D-06, requester decision 2026-10-28).** The Meraki connectors are supported scope, not dormant legacy: they stay in the connector register as active, and the excluded-connector audit allows them.
7. **Excluded connectors are checked by a test, not by policy alone.** G19 adds an automated audit that fails
   if new code calls a prohibited system: Pronto, OT/HSE, ISP, Nutanix, backup platforms, Defender, or an
   external PPM tool.

## 3. Dependency-ordered execution (agent work only)

Waves follow the review's §7. "Agent" means work Claude can do on `claude/sdp360-consolidation`. "Gate" means
the item waits on a person. Gated items never block independent agent work.

| Wave | Order | Item | Agent deliverable | Waits on |
|---|---|---|---|---|
| 0 | 1 | G-01/G-02 | Install retry in CI; CI-equivalent collation locally; repo-hygiene test; collation fix; full suite green at one SHA | — |
| 0 | 2 | G00/G01 | This plan, GAPS.csv, RELEASE-GATES.md, evidence log; current inventory counts | — |
| 1 | 3 | G-03/G-04/G-05 | `AUTHZ-OBJECT-MATRIX.csv` generated from the route inventory. Deny tests per persona × site × object × channel (pages, API, exports, attachments, PPTX). Revoked-session test | Security sign-off |
| 1 | 4 | G-07 | Revoke and role-change tests: a live session loses access immediately | — |
| 1 | 5 | G-08 / CG-08 | Negative export/share tests; key-client inventory template | D-15 to restrict |
| 1 | 6 | G-06 | IAM group-first **design only** (ADR + data model). No activation | D-14 + Security |
| 2 | 7 | G-14 | Freshness gate: stale sources suppress authoritative publication | — |
| 2 | 8 | G-13 | Report SoD: author ≠ reviewer ≠ approver ≠ publisher; immutable snapshot; revoke/reissue | D-13 for channels |
| 2 | 9 | G-17/G-18 | Commitment backfill dry-run on PG; A01/A02 server validation + dedup | D-04 to enable |
| 2 | 10 | G-12 | Score stays SHADOW/DRAFT; registry metadata complete | D-01/02/03 |
| 3 | 11 | G-19…G-23 | Native WBS/tasks/dependencies/gates; roadmap deprecation plan; cadence lifecycle; handoff state machine; tracker lifecycle | G-20 decision, Finance for G14 |
| 3 | 12 | G-24/G-25/G-26 | Composer publish workflow; R01–R16 / A01–A16 catalogue rows with honest status | D-13 |
| 4 | 13 | G-29/G-30 | Connector register + excluded-connector audit test; OpManager coverage view with NOT MONITORED / STALE / UNKNOWN | D-07, infra owner (D-06 decided: Meraki kept) |
| 4 | 14 | G-31/G-32/G-33 | Navigation tree + page map; EN/FR + WCAG checks; incremental extraction from executive.html and reports.html with screenshot parity | — |
| 4 | 15 | G-16 | Offline test matrix (network loss, conflicts, purge) in a browser harness | D-05 pilot |
| 5 | 16 | G-11/G-34/G-36/G-37 | Restore drill on PG 17; install/upgrade/rollback runbook; health/SLO doc; load test with synthetic users | CAB, D-12 signing |
| 6 | 17 | G-38/G-39/G-40 | Licence inventory (SBOM); adoption instrumentation | Legal/commercial |

Items that are pure human decisions — G-10, G-15 (approved anonymised data), G-35 (pilot UAT) and the
G-09 keys — are recorded in `RELEASE-GATES.md` and appear in this table only as dependencies.

## 4. Stop conditions (from the review §6, unchanged)

Release is NO-GO while any of these holds:

- an unresolved P0 authorization exposure;
- an unexplained skipped mandatory test;
- a failed or unexecuted migration or restore;
- an unapproved official score or financial claim;
- an external write without authority;
- missing signed-release evidence;
- a failing negative cross-site or export test;
- no field or stakeholder acceptance.

Independent, non-destructive work continues while these hold.

## 5. Next work item

Done on 2026-10-28: G-01, G-02, G-03, G-04, G-05, G-07, G-08, G-13, G-14, G-30 (see `DAILY-EVIDENCE.md`).
Next, in order: G-17/G-18 (commitments backfill dry-run report on PostgreSQL, A01/A02 escalation dedup), then
G-23/G-24 (tracker and dashboard publication lifecycle — extend the G-14 freshness gate to dashboard publication and
`/api/v1` values), then G-21/G-22 (cadence lifecycle, handoff state machine). Human gates are listed in `RELEASE-GATES.md`.
