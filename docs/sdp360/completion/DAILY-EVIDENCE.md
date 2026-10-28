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
