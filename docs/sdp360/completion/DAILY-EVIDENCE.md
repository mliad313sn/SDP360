# Daily evidence log

Each entry gives: SHA, command, exit code, counts, skips, and what it proves. A claim without an entry here is
not evidence.

## 2026-10-28

| Item | SHA | Command / source | Result | Proves |
|---|---|---|---|---|
| G-01 | `f44591a` | GitHub Actions CI run 40702147721 | `npm ci` succeeded; job failed on 1 test | The ECONNRESET at `85ede0b` did not recur |
| G-02 | `f44591a` | same run, `npm test` | 381/381 files · 2 761 tests · 2 749 pass · 1 fail · 11 skipped (10 no prod-snapshot, 1 no python) | Census matches the manifest floor (2 761) |
| G-02 defect | working tree | `assets-effort-routes.smoke` on a PG 16 database created with `LOCALE 'en_US.utf8'` | before fix: 7 pass / 1 fail (500); after fix: 8 pass / 0 fail | The CI-only failure is collation-dependent and fixed by `_isoDayOrToday` |
| Repo hygiene | `f44591a` | `git ls-files -s` | a mode-120000 `node_modules` symlink was tracked | Accidental commit; removed and guarded |
| G-03/G-05 | working tree | `tests/cross-site-read-sweep.smoke.test.js` (PG 16, en_US.utf8) | 110 probes (70 routes; list routes probed with a site-B filter and with the default scope) · 0 site-B content returned to a site-A editor · positive controls: the super admin sees the marker in the PV, inspection, report, lists and the unzipped XLSX export | Site-scope reads hold for every current GET route of these modules; new routes are covered automatically |
| G-07 | working tree | `tests/access-revocation.smoke.test.js` | 5/5 pass | Revocation applies on the next request of an open session |
| D-06 | — | requester message 2026-10-28 ("keep meraki connectors") | recorded in 2027 decision log, consolidation 03, MASTER-PLAN, GAPS G-30, CLAUDE.md | Meraki connectors are kept; Meridian (D-07) unchanged |
| G-08 | working tree | `tests/export-share-boundary.smoke.test.js` | 5/5; RFI test fails without the fix ("another site request hidden") | Export/share boundaries hold; RFI over-exposure fixed |
| G-08 | working tree | `tests/csv-guard-coverage.test.js` | 2/2 | Every CSV producer (server and browser) neutralises formula cells; tracker parallel-run CSV now guarded too |
| G-04 | working tree | `tests/cross-site-write-sweep.smoke.test.js` | 2/2 (27 write probes: 23 URL-scoped + 4 body-scoped, 0 accepted, site-B PV / inspection / report / monthly edits / objectives unchanged; control: the super admin can change them) | Site-scope writes hold for every current write route of these modules |
| G-13 | working tree | `tests/report-release.smoke.test.js`, `tests/publish-gate.test.js`, updated `tests/report-studio-routes.smoke.test.js` | 3/3, 3/3, 4/4 | Self-review / self-publication refused; edit after review voids it; published run not re-reviewable (bug fixed: it used to fall back to "reviewed"); admin withdrawal with reason hides the run and its share link |
| G-14 | working tree | same | stale (5 h) and never-synced sources block publication; fresh (0.5 h) publishes; admin override recorded | Authoritative publication follows source freshness |
| G-30 | working tree | `tests/connector-register.test.js` | 5/5; a probe file with an unregistered axios call to an excluded host failed two tests, then was removed | Every outbound integration is registered with status and owner; excluded systems unreachable by new code; Meraki pinned ACTIVE |
