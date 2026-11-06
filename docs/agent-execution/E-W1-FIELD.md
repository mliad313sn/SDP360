# E-W1-FIELD — field bundle of plan E (E-F01 … E-F04)

Branch `goal/w1-field` · audit expert of 2026-11-05 · goals in `docs/audits/2026-11-05-expert-audit/CROSSCHECK-3-FAQB.md`.
No migration (none assigned). `server.js`, `reports-db.js`, `public/reports.html` untouched.

## Verdicts

| Goal | Audit action | Verdict | Proof |
|---|---|---|---|
| E-F01 | X-F-01 purge deleted unresolved rows | **FIXED (ON)** | `purgeOutbox` deletes only `applied`/`rejected`; returns `{deleted, kept_unresolved}` (job `field.purge` result). `tests/field-store.test.js` "E-F01 purge", `tests/pg-field-store.test.js` |
| E-F01 | X-F-02 no admin view of stuck entries | **FIXED (ON)** | `GET /api/field/admin/outbox` (admin tier, capability `field.outbox.administer`): unresolved list + counts, never a payload. `tests/field-routes.smoke.test.js` "E-F01 admin outbox" (field-tech / viewer / site editor 403, no note text in the answer) |
| E-F01 | X-F-03 / F-03 stuck ticket/action has no exit | **BUILT (shadow, `field_outbox_resolve_enabled`='0' → 404)** | `POST /api/field/admin/outbox/:uuid/resolve` `mark_rejected`/`release`; ticket/action release needs `confirm_checked_sdp` + reason ≥ 10; released inspection → two parallel PUTs apply once; system_log `field_outbox_resolved` risk 1. CLI `tools/field/outbox-admin.js` (dry run default). Same smoke + `field-store` "resolve" + "CLI" |
| E-F02 | F-04 constrained networks | **FIXED + regression guards** | `tests/e2e/f1-field-network.spec.js` (latency 800 ms + 3 flaps, captive portal, 401 mid-photo, 409 then success, chunk loss → only missing chunks, user switch, quota + reload) |
| E-F02 | X-F-04 / F-04 captive portal | **DEFECT FIXED (ON)** | First run RED: an HTML 200 answer marked the entry « refusé » (never retried: `Refusé : … HTTP 200 (not JSON — proxy or network page)`). Now `failed` (« nouvel essai prévu ») with a French message. Case (b) of f1 green after the fix |
| E-F02 | G19 open item: route test with slow / throwing apply | **DONE** | `field-routes.smoke` "E-F02 route level": slow apply → concurrent 409 in_progress then duplicate, one apply; throwing apply → `failed`, resend applies once |
| E-F02 | F-02 browser part (restart after quota) | **DONE** | f1 case (g): quota failure, reload → earlier entry and badge intact |
| E-F03 | F-05 review step | **BUILT (shadow `field_review_step`='0')** | `tests/field-review-step-browser.test.js` (off: no dialog, envelope keys unchanged; on: French summary, Corriger queues nothing) |
| E-F03 | F-05 measured task time | **BUILT (shadow `field_task_timing`='0')** | browser test (meta.task_ms present only when on); `tests/field-task-timing.test.js` (off: log row identical; on: task_ms + site + tier, actor u<id>, no name/IP; pilotMetrics median/p75, no sample → no data) |
| E-F04 | F-01 / F-02 human part | **PREPARED (human gate)** | `docs/ops/pilot/FIELD-DEVICE-UAT.md`, `FIELD-DEVICE-SHEET.csv` (blank), link in `USABILITY-TEST-PROTOCOL.md` |

Every case of f1 other than (b) was green at its first run after (b)'s fix and stays as a regression guard.
**The network in f1 is SIMULATED** (Chromium DevTools latency/offline + route stubs): it is not a VSAT / 4G
proof. The field sign-off stays a human gate (E-F04).

## Tests run (PostgreSQL, local throwaway cluster)

- E-F01 group: 114 pass / 0 fail / 0 skip (field suites, pg-field-store, authz-route-matrix, capability-registry,
  flag-register, readme-truth, await-precedence, server-size-budget, report-config*).
- After E-F03: 143 pass / 0 fail / 0 skip (field-*, pilot-metrics, pg-pilot-metrics, pg-field-store, flag-register,
  readme-truth, authz-route-matrix, capability-registry, await-precedence, server-size-budget, i18n-coverage,
  evidence-baseline, e2e-harness).
- `node tools/test/run-e2e.js --runs=2`: see the result line below.

`node tools/test/run-e2e.js --runs=2` (2026-11-06, Chromium, every non-localhost request blocked): **GREEN** — 23 journeys × 2 runs, 23/23 pass each run, 0 skipped, 0 unexpected external requests (f1 passed/0 twice, t3 passed/0 twice with both E-F03 switches off); browser unit tests 4/4 (`field-storage-browser`, `field-review-step-browser`).

## Deviations

- E-F03 browser proof is named `tests/field-review-step-browser.test.js` (the `-browser` suffix is how
  `run-e2e.js` picks Chromium unit tests); the server/pilot half is `tests/field-task-timing.test.js`.
- While `field_task_timing` = 1 the `field_*_applied` row is written with actor `u<id>` and no IP (the goal's "no
  user name in timing data"); actor_id keeps the trace. With the switch off the row is unchanged.
- `purgeOutbox` now returns an object, so the `field.purge` job result is `{outbox:{deleted, kept_unresolved}, uploads}`.
- Progress text « Envoi i/n… » added during a multi-entry sync (French first).

## Left for a person

- Do NOT set `field_outbox_resolve_enabled` = 1 before the real-device sessions show how often entries get stuck (X-§7-01). Decision: PO + site IT.
- Run the E-F04 sessions on ≥ 2 real phones on a real site network; fill the sheet; the site IT lead signs the PV.
- Decide `field_review_step` / `field_task_timing` for the pilot (PO / adoption lead); targets only after a baseline.
