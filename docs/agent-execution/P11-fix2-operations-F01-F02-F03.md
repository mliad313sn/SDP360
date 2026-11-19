# P11 operations seat — fixes for F-01, F-02, F-03 (AI engineering, branch qual/p11-fix2)

AI-produced fix lot; not a human qualification. Source findings: P11 operations write-up (F-01, F-02, F-03).

| Finding | Cause | Fix | Proof (failing before, passing after) |
|---|---|---|---|
| F-01 survey sync deletes history on a partial export, never restores | `syncSurveyData` reconciled with no truncation guard; incremental filter only took results with `Survey Sent on` > last sync | guard (shared `services/sync/truncationGuard.js`) runs before any survey write; healthy runs also re-insert live results missing locally (`reports-db.listSurveyResultIds`); `countTable` whitelist fixed (`survey_responses` never existed → `survey_results`) | `tests/zoho-sync-survey-truncation.test.js` (3): 2 failed before the fix |
| F-03 assets full-replace accepts a partial view | C1 guard only refused an empty fetch | `syncAssetView` applies the same guard (`SYNC_TRUNCATION_TOLERANCE_PCT`, default 20 %); empty-fetch refusal now also transient | `tests/assets-sync.test.js` new F-03 test failed before; the "smaller sync drops rows" test moved to a within-tolerance shrink (10 → 9). The P11 repro `assets-partial.js` now refuses 2 473 → 2 |
| F-02 manager / installer probe blind to a dead DB | probe asked `/api/auth/config` (200 with DB down) | `tools/sdp-manager.js probeHealth`, `Install-SDP.ps1 Test-AppProbe`, `Setup.bat` diagnostics probe `/ready` (503 when DB unreachable) | `tests/sdp-manager-probe.test.js` (3), all failed before |

Zoho reconcilers covered by the guard after this lot: change, CAB, survey, requests (4 reconcile call sites) + the 6 assets
full-replace views. The step-1 note "6 reconcilers" counted differently; the factual coverage is the list above.
installer-v2 `post-install.js` already probed `/ready` first (falls back to `/api/auth/config` only on 404 — an older build).
Pwsh not available here: the `.ps1` / `.bat` changes are pinned by the static test only, not executed. Installer files remain
behind the deploy marker (DEC-2).
