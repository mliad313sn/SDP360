# 01 — Cross-branch change matrix (1.11 remediation → SDP360 2.0)

Method: each 1.11 control's own regression test was copied and **run against 2.0 code first** (failure =
the control is missing on 2.0), then the control was ported, adapted to 2.0, and the test kept.

| 1.11 commit / item | Control | 2.0 evidence before | Disposition | 2.0 commit / test |
|---|---|---|---|---|
| `e573016` F-M02-001 dash key injected for anonymous visitors | key only with a session | 18/18 of the 1.11 test pass on 2.0 (2.0's C1 fix) | **ALREADY_PRESENT** (key-only routes: 16 on 2.0 vs 19 on 1.11) | — (2.0 C1) |
| `7667671` WP-M01-001 suite without `.env` | `tests/_default-env.js` preload | 64 fails on fresh 2.0 run | **PORT_WITH_ADAPTATION** (into 2.0's `run-all.js`) | `645f940` |
| `7667671` WP-M01-002 send-weekly 2 cancelled | test stub | 10/10 pass on 2.0 | **ALREADY_PRESENT** | — |
| `7667671` WP-M02-003 pin dash-key-only routes | guard test | 2.0 sweep: 16 key-only routes | **TEST_ONLY** — transplanted | `dashkey-only-routes.smoke` |
| `9b1b831` WP-M02-004 object-ID substitution (meetings/inspection writes) | handlers already enforce | 6/6 write tests pass on 2.0 | **ALREADY_PRESENT** + test transplanted | `efd92e9` `cross-site-object-writes.smoke` |
| `68594c6` F-M02-003 site-less field quick action | — | 2.0 has **no** field quick actions | **OBSOLETE** (feature absent) | — |
| `cb66e2d` DEC-07 meetings + inspection reads own sites | read scope + `_siteClause` | 1.11 tests 8-10 fail on 2.0 | **PORT_WITH_ADAPTATION** | `efd92e9` |
| `88f27d4` F-M06-001 business-only boundary | `services/businessGuard.js` | 104 routes 2xx for a site-business session on 2.0 | **PORT_WITH_ADAPTATION** (allowlist narrowed to 2.0's site-awareness-only view) | `efd92e9` `business-only-boundary.smoke` |
| `88f27d4` site pickers trimmed | lookups filter | test 11 fails on 2.0 | **PORT_WITH_ADAPTATION** | `efd92e9` |
| `5ae91bb` F-M14-001 CSV formula injection | `public/lib/csvSafe.js` | module absent; no writer guarded | **PORT_WITH_ADAPTATION** (2.0 writers: opmanager, reportPack, system-log CSV + 8 browser exports) | `efd92e9` `csv-safe.test` |
| DEC-03 integrations plan behind login (1.11 run 6) | session redirect | anonymous 200 on 2.0 | **PORT** | `6a556de` `integrations-plan-gate.smoke` |
| `bfae082` F-M01-004 runner drops results | blocking stdio + per-file guard | 2.0 already had G8.6 (origin of the 1.11 port) | **ALREADY_PRESENT**; strengthened by the per-file census | `645f940` |
| `a079fd5` CI through `run-all.js` | — | 2.0 CI runs `npm test` → `run-all.js` | **ALREADY_PRESENT** | — |
| 1.11 `package.json` override `image-size ^2.0.4` | dependency | 2.0: 3 high advisories | **PORT** | `9e7d5f1` |
| `SDP_TEST_NO_RATE_LIMIT` test switch | test infra | absent on 2.0 (sweeps hit 429) | **PORT** (ignored when `REQUIRE_POSTGRES=1`) | `efd92e9` |
| 1.11 `docs/remediation/*` registers | documentation | — | **LINKED, not copied** — superseded by this folder for the 2.0 line | — |
| 1.11 DEC-01…DEC-07 | decisions | 2.0 decision log D-01…D-14 | DEC-02/03/07 compatible with D-14 → adopted; DEC-01/04/05/06 re-stated in [03](03-DECISIONS-AND-ASSUMPTIONS.md) | — |

## Sibling implementations (not transplanted)

The 267 files only in 1.11 are mostly **its own implementation of 2.0 steps** (`services/{trackers,reportgen,
metrics,dashboards,publication,portfolio}/`, `routes/{reportgen,publication,portfolio,cockpit}.js`, a
modularised `server.js` of 2.7k lines vs 7.9k on 2.0). 2.0 is canonical for those capabilities (constraint 4:
reuse 2.0's `routes/`, `services/`, `metricRegistry`, …). The modularisation of `server.js` is tracked as an
independent P2 refactor (WP-P2-01), to be redone on 2.0 without API change — not copied.
