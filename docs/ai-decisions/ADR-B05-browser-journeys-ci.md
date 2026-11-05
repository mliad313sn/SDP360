# ADR-B05 — browser journeys in CI: Playwright library under node:test, CI-only, fonts allow-listed

Status: technical decision (AI) · 2026-11-04 · no business setting changed (switches are flipped only inside
the throwaway database of a journey)

## Context
P1-20: every browser proof lived in a session scratchpad, never in CI. The PO review asks for Playwright
(Chromium only) as a CI-only devDependency, journeys T1 T2 T3 T4 T7 T8 + a cross-site deny journey on
PostgreSQL 17, every non-localhost request blocked and counted, and page weight / load time recorded
(measurement, no budget).

## Decisions
1. **`playwright` (the library, exact `1.56.1`) as a devDependency — not `@playwright/test`.** The journeys are
   plain `node:test` files (`tests/e2e/*.spec.js`) driving Chromium through the library, like the existing
   `tests/field-storage-browser.test.js`. One test runner for the whole repository, no second config dialect,
   and the dependency is 2 packages with no install script. Hence **no `playwright.config.js`**: the policy
   (allow-list, artefact folder, contexts) lives in `tests/e2e/fixtures/browser.js` — a config file named
   `playwright.config.js` would be picked up by `npx playwright test` and mislead.
2. **Never shipped**: the installer runs `npm ci --omit=dev` (`tools/installer-v2/build.ps1`), the SBOM and
   `npm audit --omit=dev` skip dev dependencies, the update package carries no `node_modules`. Browsers are
   downloaded in CI only (`npx playwright install --with-deps chromium`). Pinned by `tests/e2e-harness.test.js`.
3. **Chromium also in the `test` job and in `release.yml`** before `npm test`: with the library installed,
   `tests/*-browser.test.js` would otherwise skip ("chromium not available") and the skip guard fails the run.
   They also run in the new `e2e` job (`tools/test/run-e2e.js`).
4. **External requests**: every non-localhost request is aborted. `fonts.googleapis.com` / `fonts.gstatic.com`
   are the ONLY allow-listed origins — still aborted (nothing leaves the runner), reported per journey under
   `allowlisted`, never failing. Reason: the PO kept fonts out of scope this period (they fall back to system
   fonts; B-01 removed every script CDN). Any other origin is `unexpected` and fails the journey (must be 0).
   To close it: remove the font `<link>`s (login, index, exec-view, executive*, site-awareness, infra-health,
   design-system css) or vendor the fonts, then empty `ALLOWLIST`.
   **Closed by C-29 (2026-11-05, PO decision P5):** Libre Franklin is vendored under `public/vendor/fonts/`,
   every font `<link>` is gone and `ALLOWLIST` is empty — a font request is now `unexpected`.
5. **Credentials**: the e2e job's PostgreSQL uses `POSTGRES_HOST_AUTH_METHOD: trust` (no password exists); the
   app's bootstrap admin, API key and every journey user get random values per run (`fixtures/server.js`,
   `fixtures/seed.js`). Nothing secret is committed.
6. **Proof the job can fail**: the journeys run twice in a row (`--runs=2`), then `--negative-control` runs T1
   with a deliberately broken selector and succeeds only if T1 goes red.

## Defects the journeys found (fixed here, both in `public/field/app.js`)
- **No photo could be added on the served field app**: `compress()` decoded the picture through a `blob:` URL,
  but the CSP is `img-src 'self' data:` → "cannot read image". Now read as a `data:` URL (no CSP widening).
- **On a fresh phone no inspection could be queued**: `tx()` returned the IDBRequest itself when a key was
  missing (`result === undefined`), so the stored site was `[object IDBRequest]` — the site select showed the
  site with nothing selected ("Pick a site…"), low-bandwidth mode came up ON, a missing offline cache passed for
  a bootstrap. Fixed; `tests/field-storage-browser.test.js` now pins the first-use defaults (red on the old code).
- `sw.js` cache bumped `field-v4` → `field-v5`.

## Rollback
Remove the `e2e` job and the two `playwright install` steps; drop the devDependency. The field fixes are
independent and should stay.
