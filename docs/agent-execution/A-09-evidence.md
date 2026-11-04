# A-09a evidence — French on the coordinator pages behind one switch

Branch `goal/a-09a` · 2026-11-04 · part a only (A-09b: reports, assets, wan, trackers, portfolio, rfi).
Decision record: `docs/ai-decisions/ADR-A09-ui-language-policy.md` (D-2 PROPOSED, not approved).

## What ships, and its switch
| Piece | File | Switch / default |
|---|---|---|
| UI-policy keys | `services/reportConfig.js` DEFAULTS | `ui_lang_default=''`, `ui_i18n_pages='0'`, `ui_role_landing='0'`, `ui_nav_profile='full'`, `ui_deck_builder_roles='super_admin'` |
| Policy mapping | `services/uiPolicy.js` | pure; unknown values → default |
| Delivery | `server.js` `GET /api/reports/auth/me` → `{user, ui}`; `public/auth.js` → `window.__uiPolicy` | — |
| CLI | `tools/reports/set-ui-policy.js` | dry run by default, `--apply` writes |
| Dictionaries | `public/lib/i18n/{common,site-actions,meeting,inspection,activity-tracker}.fr.js` | inert unless `ui_i18n_pages='1'` |
| Guarded install | `public/lib/i18n/boot.js` | checks `__uiPolicy.i18n_pages === '1'` |
| Shell `<html lang>` | `public/_shell.js` | only on pages with `<html data-i18n="on">` |

## Coverage (static markup + listed runtime strings)
| Page | Static strings found | Allow-listed (reason in the test) | Runtime keys |
|---|---|---|---|
| site-actions.html | 19 | 0 | 30 |
| meeting.html | 140 | 0 | 72 |
| inspection.html | 189 | 20 (already French, proper names, dictation button) | 6 |
| activity-tracker.html (React) | 0 (body rendered by React) | — | 110 (all checked present in App.jsx) |
Common dictionary: 98 entries. Allow-lists live in `tests/i18n-coverage.test.js`.

## Tests
New: `ui-policy` (7), `ui-policy-me.smoke` (3), `i18n-text` (6), `i18n-coverage` (11); `shell-navigation` +3.
Re-run green: ui-lang-shared, field-french, report-template-primitives, pptx-monthly-golden, await-precedence,
reports-cli-dotenv, server-size-budget, a11y-static, csp-*, module-tabs, rbac-ui-gates, meeting/inspection client tests.

## Dry run (throwaway database)
```
$ node tools/reports/set-ui-policy.js --key=ui_i18n_pages --value=1
ui_i18n_pages: '0' -> '1'
DRY RUN — nothing written. Re-run with --apply to write it.
$ node tools/reports/set-ui-policy.js --key=ui_lang_default --value=de
[set-ui-policy] value "de" is not allowed for ui_lang_default
```

## Not done here
- Removal of the 8 duplicate page language toggles (cockpit, handoffs, policies, obligations, infra-health,
  site-awareness, meetings-insights, meetings-import): outside the part-a scope given to this worker.
- No browser was available in the sandbox: the pages were not opened with FR selected.

## Left for a person
- Decide D-2 per surface; until then nothing changes in production.
- On the server, after deploy: `node tools/reports/set-ui-policy.js --key=ui_i18n_pages --value=1 --apply`
  (optionally `--key=ui_lang_default --value=fr`). Rollback: same command with `--value=0`.
- A francophone coordinator reads site-actions, meeting, inspection and the tracker with FR selected and logs wording fixes.
