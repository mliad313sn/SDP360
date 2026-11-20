# P11 seat data-kpi — ROUND 3 findings

**AI review — not an independent human review.** Seat: data-kpi (PostgreSQL migrations, KPI formulas, null vs 0,
figure parity, source reconciliation, lineage). The reviewer did not write this code. The round-1 file
(`data-kpi.md`) and the round-2 file (`r2-data-kpi.md`) are unchanged.

- Frozen SHA: `ead6efb6439296a34915b7d9a47f7011cd15fa82` (clone `/home/user/qual/data-kpi`; the `docs/agent-execution/`
  narratives were removed by the coordinator and were not read; only the gate dossiers were available).
- Test cluster: **PostgreSQL 16.15**, max_connections 400. **The PostgreSQL 17 target is not verified.**
- No product code was modified. Throwaway artefacts are in `/tmp/claude-0/p11attack-r3/` (`r3-ratchet.test.js`,
  `evmfuzz/`, `e1.out`, `e3.out`, `sweep.out`, `reh.out`, `reh/`). The throwaway DB `r3_ratchet_dk` was created and
  dropped, and the clone copy used for the mutation test was deleted. The rehearsal dropped its own databases.
- Code change in this area since b2e85cd0: `db/postgres/sync/113_truncation_anchors.sql` (new),
  `services/sync/truncationGuard.js`, `services/syncStateStore.js`, `zoho-sync.js`, `assets-sync.js`
  (sync self-heal + anchored truncation guard), `services/ppm/evm.js` (O(1) phasing). The following are **untouched**:
  `db/migrate.js`, `services/reportPayload.js`, `tools/kpi/*`, `public/lib/kpiRag.js` and `tools/exec-pptx/*`.

## 1. Round-2 findings, re-verified at ead6efb

Round 2 had no P0 and no P1. Every round-2 P2 was re-checked:

| R2 ID | Sev | Status at ead6efb | Evidence |
|---|---|---|---|
| F-02 server fallback `_tracker()` → 0/red | P2 | **NOT FIXED** | `services/reportPayload.js:643` `avg_score = … \|\| 0`; `:989` fallback still used (file untouched). |
| F-03 applied migration re-executed on byte change; 039/066 unguarded | P2 | **NOT FIXED** | `db/migrate.js:105` unchanged ("reported, re-applied"). |
| F-04 ambiguous dd/mm guessed | P2 | **NOT FIXED** | `monthOf('01/10/2026')` → `2026-10`, `monthOf('10/01/2026')` → `2026-01`. |
| F-05 ratchet / dossier baselines not reproducible from a clean tree; sweep blind to Python/browser | P2 | **NOT FIXED** | E3 still fails #38 (ENOENT `docs/agent-execution/P08-kpi-dossiers.md`) and #76; E4 exit 1, 80 UNJUSTIFIED (same set as r2 — diffed). |
| F-10 reconcile-source says RECONCILED for an empty comparison | P2 | **NOT FIXED** | Re-ran: header-only `Wrong,Columns` export against an empty `request_records` (throwaway DB) → `"verdict": "RECONCILED"`, groups 0, **exit 0**. |
| F-06 PG16 / 1 000 rows | P3 | NOT FIXED (environment) | rehearsal banner: PostgreSQL 16.15. |
| F-11, F-12, F-13, F-08 | P3 | NOT FIXED / not re-assessed | files untouched. |

Note: none of the round-2 data-kpi P2s were in the fix set. The data-relevant fixes merged (N-01 self-heal and
N-02 anchored truncation guard) came from other seats. Their N-02 claim is attacked in B2 below.

## 2. Evidence re-run at ead6efb (command · result)

Prefix: `NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" PG_TESTS_REQUIRED=1 node --test --test-force-exit`, with `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres`.

| # | Evidence | Command | Result | Status |
|---|---|---|---|---|
| E1 | Migration tests (+ CSAT null + new anchor test) | `<prefix> tests/pg-migrate*.test.js tests/pg-finance-migrations-rollback.test.js tests/exec-pptx-csat-null.test.js tests/zoho-sync-truncation-anchor.test.js` | 21/21 pass, 0 skipped | **VERIFIED (PG16)** |
| E2 | `db/migrate.js` on a fresh DB | `PG_URL=…/r3_ratchet_dk node db/migrate.js`, then rehearsal steps 1-2 | applied=103 (113 included); re-run applied=0 already=103 changed=0 | **VERIFIED (PG16)** |
| E3 | figure-parity + KPI suites (20 files) | `<prefix> tests/figure-parity-*.test.js tests/kpi-*.test.js tests/dashboard-figure-parity.test.js` | 78 tests: 76 pass, **2 fail** (#38 dossier file absent, #76 unknown-sweep baseline absent) | **PARTIAL** (F-05) |
| E4 | `node tools/kpi/unknown-sweep.js --check` | as written | exit 1, 433 hits, 80 UNJUSTIFIED (baseline missing in the clean tree) | **NOT VERIFIED** |
| E5 | `node tools/agent/metric-map.js --check` | as written | up to date, exit 0 | **VERIFIED** |
| E6 | Restore rehearsal | `node tools/pg/restore-rehearsal.js --rows 1000 --out /tmp/claude-0/p11attack-r3/reh` | exit 0; 12/12 PASS (migrate 103, idempotent, ISO window, accents, UTC, audit chain + append-only trigger, 219 tables / 1 187 rows equal, ticket md5, chain heads, broken dump refused, target unchanged) | **VERIFIED (PG16, 1 000 rows)**. No RPO/RTO claim at production volume. "server clock reachable in UTC" only checks the year (2026). |
| E7 | `node tools/agent/metric-lineage.js --check` (extra) | as written | up to date, exit 0 | **VERIFIED** |
| E8 | Round-2 repros F-04 / F-10 (extra) | see §1 | reproduced, not fixed | VERIFIED (defects still present) |

Counts: **verified 6** (E1, E2, E5, E6, E7, E8), **partial 1** (E3 76/78), **not verified 1** (E4).

## 3. New break attempts (one per capability, none repeated from round 2)

**B1 — Migrations (new migration 113). Claim:** "idempotent; no data written; fresh DB reaches current schema".
Attack: fresh throwaway DB → migrate → second migrate; also through the rehearsal.
Outcome: applied=103, then 0 / 103 / changed 0. **Claim holds.** F-03 still covers the edited-file risk.

**B2 — Sync data integrity (N-02 anchored truncation guard). Claim** (`services/sync/truncationGuard.js` header, test
`zoho-sync-truncation-anchor`): "a lossy run never lowers the anchor, so the cumulative loss since the last confirmed
count is bounded by the tolerance (20 %)".
Attack: alternating partial exports. Each export is slightly larger than the previous partial one, so it counts as
"lost nothing" (`fetched ≥ stored`), and `nextAnchor` then **resets the anchor to that partial count**. Throwaway test
`/tmp/claude-0/p11attack-r3/r3-ratchet.test.js` ran on its own DB (`r3_ratchet_dk`, migrated 103), with the real
`zoho-sync.syncRequestData` and a fed source:
`1000 → 810 → 820 → 660 → 670 → 540`, and **every run was accepted**:
`[{fed:810,stored:810,anchor:1000},{fed:820,stored:820,anchor:820},{fed:660,stored:660,anchor:820},{fed:670,stored:670,anchor:670},{fed:540,stored:540,anchor:670}]`.
Pure model, same rule: 100 → 44 (56 % lost against the confirmed 100).
Outcome: **claim broken** — the ratchet still works whenever partial sizes are not monotone, which is the normal
shape of a flaky export. Mitigation found: rows come back on the next full healthy export (N-01 self-heal; SDP stays
the source of record). So this is temporary loss of the local copy, not permanent loss. During that window, every
helpdesk figure built on `request_records` (and the survey, CAB and assets tables) is understated, with no warning.
Root cause: `fetched ≥ stored` is treated as "the source confirmed its size", but `stored` was already lowered by the
previous lossy run. → **F-14 (P2)**. The round-2 N-02 fix is **PARTIAL**.

**B3 — KPI arithmetic (EVM O(1) phasing, P11 R2-2). Claim:** "figures identical to the per-day map".
Attack: fuzz of 20 000 random windows (0-120 days, status dates before, inside and after the window, weekend-only
windows included), comparing `cumulativeTo(phaseOf())` with Σ `timePhase()` per day up to the status date
(`/tmp/claude-0/p11attack-r3/evmfuzz/fuzz.js`, run on a copy of evm.js with one extra export).
Outcome: `{ n: 20000, bad: 0 }`. **Claim holds.** Null rules in `evm.js` (`div`/`sub`/`sumOf` → null) look consistent.

**B4 — Figure parity / null vs 0 (unknown-sweep stability).** Attack: diff of the r2 and r3 UNJUSTIFIED lists.
Outcome: identical set (80). The new fix code added no unknown→0, but the sweep still cannot pass in a clean tree
(F-05). Not broken; not proven either.

**B5 — Lineage. Claim:** "METRIC-WIDGET-MAP / METRIC-LINEAGE list every consumer of a metric".
Attack 1 (mutation, on a deleted clone copy): add a JS file consuming `helpdesk.first_reply_sla_pct` → `--check`
**exit 1** (detected) ✔. A non-registry key is ignored, which is correct.
Attack 2: is the Group IT deck (`services/reportPayload.js` → `tools/exec-pptx/render.py`) a mapped surface?
The walker only reads `.js|html|json|mjs`; `render.py` consumes flat payload keys (`csat_pct`, `first_reply_h` …), not
registry keys. `reportPayload` and `render.py` appear **0 times** in METRIC-WIDGET-MAP.md and METRIC-LINEAGE.md.
Outcome: **claim partially broken** — the executive deck is a figure surface outside the lineage/parity net (the
same class that let round-1 F-01 through). → F-15 (P3).

## 4. Findings at ead6efb

| ID | Sev | Title | Where | Reproduction | Regression test to add | Rollback risk | Recommendation |
|---|---|---|---|---|---|---|---|
| **F-14** | **P2 (new)** | Anchored truncation guard can still be ratcheted down by alternating partial exports (1000 → 540 accepted) | `services/sync/truncationGuard.js` `nextAnchor` (`fetched >= stored → fetched`) | B2: `r3-ratchet.test.js` | sequence 1000/810/820/660/670 → the 660 run is refused; anchor never below `max(prev, fetched)` unless N consecutive equal exports | Low (guard only; worst case a sync is refused and retried) | Confirm only on `fetched ≥ anchor` (or on N consecutive agreeing counts), not on `fetched ≥ stored`; keep the "genuine shrink" path explicit |
| F-02 | P2 | (carried) server fallback tracker → 0/red | `services/reportPayload.js:643, 989` | round 1 A5 | `_tracker()` empty month → null | Low | null / reuse engine scorers |
| F-03 | P2 | (carried) migrator re-executes edited applied files; 039/066 unguarded backfills | `db/migrate.js:105` | round 1 A1 | checksum freeze manifest | Medium | freeze applied files |
| F-04 | P2 | (carried) dd/mm ambiguity guessed | `tools/kpi/reconcile-source.js:17-24` | §1 | ambiguous → null unless `--date-order` | None | refuse ambiguity |
| F-05 | P2 | (carried) KPI evidence baselines live in removed `docs/agent-execution/`; sweep blind to Python/browser | `tools/kpi/unknown-sweep.js:19`, `tests/kpi-dossiers.test.js` | E3/E4 | re-home under `docs/kpi/` | None | re-home + widen scope |
| F-10 | P2 | (carried) reconcile-source RECONCILED / exit 0 on an empty comparison; column check skipped without rows; READ ONLY outside a transaction | `tools/kpi/reconcile-source.js:85, 109, 113` | §1 | empty → `NOTHING COMPARED`, exit ≠ 0 | None | as round 2 |
| F-15 | P3 (new) | Group IT deck (`reportPayload` → `render.py`) is outside METRIC-WIDGET-MAP / METRIC-LINEAGE | `tools/agent/metric-map.js:34-70` (file filter) | B5 | lineage check lists the deck payload keys → registry keys | None | add a deck key → registry mapping and scan `.py` |
| F-06, F-11, F-12, F-13, F-08 | P3 | carried, unchanged | see r2 | — | — | — | — |

**P0: 0. P1: 0.** P2: 6 (5 carried, 1 new F-14). P3: 6 (5 carried, 1 new F-15).

## 5. Per P03 lot touching this area — AI panel recommendation, not a decision

| Lot | Recommendation | Why |
|---|---|---|
| L09 KPI trust (display-only explanations) | **CONDITIONAL** | Parity/KPI 76/78. The 2 failures are evidence location (F-05), not formulas. Committee switches stay dark until G-12. |
| L05 Time, money and benefits | **NO-GO for pilot** (technically CONDITIONAL) | Finance gate G14 is empty. The EVM phasing fuzz is clean, and the migrations are green on PG16 only. |
| L13 Operations resilience (restore drill) | **CONDITIONAL** | Rehearsal 12/12 PASS on PG16, 1 000 rows. Needs PG17, production volume, blobs, and RPO/RTO set by CAB + SRE (G-11). F-03 should be closed before the first production upgrade. |
| Sync integrity (truncation guard / self-heal, data side) | **CONDITIONAL** | N-01 self-heal limits the damage to a temporary understatement; F-14 should be fixed before pilot dashboards are read as truth. |
| Group IT deck (not a lot) | **CONDITIONAL** | F-02 / F-13 / F-15 open; no official figure before G-12. |
| Source reconciliation evidence for the data-owner gate | **CONDITIONAL** | F-10 + F-04 must be fixed before a reconciliation sheet counts as evidence. |
| Committee-policy switches | **Keep dark** | Need adopted D-01/02/03. |

## 6. Human gates still empty in this area (RELEASE-GATES.md / gate dossiers, nothing filled at ead6efb)

- Backup / restore RPO-RTO (G05 dossier / G-11) — CAB + SRE
- KPI definitions, thresholds, score D-01/02/03 (G06 / G-12) — KPI Committee
- Data owner — anonymised fixtures, 2026 history D-10 (G12 / G-15) — Data owners
- Finance — budgets and benefits (G14) — Finance
- CAB — PostgreSQL-only cutover PO-08 / D-11 (G03)
- QA lead — CI green on the target SHA, skipped tests reviewed (G19)
- Capacity — load / soak accepted (G20) — SRE + DBA

No gate filled and no decision taken by this seat. AI review — not an independent human review.
