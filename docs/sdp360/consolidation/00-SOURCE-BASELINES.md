# 00 — Source baselines (consolidation, 2026-10-28)

Goal: `SDP360_Unified_Consolidation_Goal_2026-10-28` (cross-branch consolidation, security remediation,
native portfolio, business value, release readiness). Executed by the delivery team under the Product
Owner appointed by the user on 2026-10-28 (decision log: [03](03-DECISIONS-AND-ASSUMPTIONS.md)).

## Refs (verified with `git ls-remote origin`, 2026-10-28)

| Line | Branch | SHA | Version | Role |
|---|---|---|---|---|
| SDP360 2.0 (default) | `claude/sdp-dashboard-analysis-55b1oy` | `fb78494c889a` | `2.0.0-alpha.14` | **Base of the consolidation** — left unchanged |
| SDP Dashboard 1.11 + remediation | `claude/confident-pascal-03veex` | `a079fd5e9d6d` | `1.11.0` | Read-only comparison baseline — left unchanged |
| Consolidation | `claude/sdp360-consolidation` | see [09](09-DELIVERY-STATUS.md) | `2.0.0-alpha.14` | All consolidation work |

The two lines have **no common git ancestor** (history rewritten on 2026-10-15 on one side). Tree comparison
(`git ls-tree`): 2.0 = 1110 files, 1.11 = 1137; **726 byte-identical**, 144 same path / different content,
240 only in 2.0, 267 only in 1.11. They are sibling implementations of the same 2.0 study (steps 1-10), not
versions of one another. No merge, no `--allow-unrelated-histories`, no force push: controls are transplanted
one at a time with tests ([01](01-CROSS-BRANCH-CHANGE-MATRIX.md)).

## Test baselines — each reproduced on its own SHA

Environment for every run below: Linux container, Node v22.22.0, npm 10.9.4, `npm ci` from the lockfile;
PostgreSQL **16** (Ubuntu package, disposable cluster on :5432 — target is 17, see G-ENV-01); no Windows/IIS/PM2,
no prod snapshot, no python/matplotlib, no live endpoint (Zoho, SDP Cloud, OpManager, Meraki, Entra, Graph).

| Line @ SHA | Command | Result |
|---|---|---|
| 2.0 @ `fb78494` (unchanged) | `npm test` | 377/377 files · 2706 tests · **64 fail** · 102 skipped |
| 2.0 — root cause of the 64 | log | all = `DASH_USER and DASH_PASS must be set` (reports-db refuses to seed). The 2026-10-21 handoff's **94 failures** (2724 tests, other cloud box) have the **same signature** — environment, not product defects. |
| consolidation @ `645f940` | `npm test` (with `tests/_default-env.js` preload) | 377/377 · 2744 · **0 fail** · 106 skipped (96 PG, 9 snapshot, 1 python) |
| consolidation @ `645f940` | `PG_ADMIN_URL=… PG_TESTS_REQUIRED=1 npm test` | 2744 · **0 fail** · 11 skipped (10 snapshot, 1 python) |
| consolidation @ `9e7d5f1` | same, PG | 380/380 · 2762 · **0 fail** · 11 skipped |
| 1.11 @ `a079fd5` | `npm test` (sqlite only) | 352/352 · 2638 · 0 fail · 109 skipped (PG never run on that line here) |

The 2.0 suite (2706-2762) and the 1.11 suite (2638) are **different suites**; their counts are not comparable.

Migrations (2.0): `PG_URL=…/sdp_migtest node db/migrate.js --apply` on an empty database → `applied=27`;
second run → `applied=0 already=27 changed=0` (idempotent).

## Feature flags observed (`services/reportConfig.js` DEFAULTS, 2.0)

All outbound/write features default OFF: `*_send_enabled`, `asset_new_alert_enabled`, `teams_sla_enabled`,
`sdp_api_write_enabled`, `commitments_enabled`, `publish_cron_enabled`. `sync_alert_enabled` defaults ON (internal
health alerting).
