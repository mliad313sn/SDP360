# P11 round 2 — PPM seat fixes (R2-1, R2-2)

AI work — not an independent human review; nothing here is an approval. Decision record:
`docs/ai-decisions/ADR-P11-R2-evm-deleted-and-bounds.md`.

| Finding | Cause | Fix | Test (failing before, passing after) |
|---|---|---|---|
| R2-1 (P1 for L05) deleting a task with hours drops AC | hard delete cascades `ppm_time_entries`; soft delete hid them in `evmStore.timeEntriesFor`; engine ignored entries of absent tasks | hard delete refused 409 `HAS_ACTUALS` (task subtree / project / objective / programme), purge skips such rows; soft-deleted tasks' entries served with their rate/currency; engine keeps them in AC with `actuals_on_deleted_tasks` | `tests/ppm-evm-r2.test.js` (AC 100 → 300), `tests/ppm-r2-actuals-rebaseline.smoke.test.js` (200 → 409; soft: AC 300, CPI 1.6667, EAC 600) |
| R2-2 (P2) re-baseline bypasses bounds; EVM O(days) | `rebaseline()` checked shape only; `timePhase`/`sCurve` enumerated calendar days | `rangeProblem` + task date order in `rebaseline()`; arithmetic phasing, S-curve O(leaves+months), ≤ 2 772 points, `s_curve_truncated` | pure timing (9999: 36.5 s → 11 ms; 20×2200: 3.0 s → 5 ms); HTTP 9999 rebaseline 200 → 400 `DATE_RANGE`; project + portfolio EVM with a 9999 legacy row < 1 s |

Targeted run: `tests/ppm-*.test.js tests/governance*.test.js tests/soft-delete*.test.js` → 383/383 pass. Full suite not
re-run (orchestrator runs it at merge).
