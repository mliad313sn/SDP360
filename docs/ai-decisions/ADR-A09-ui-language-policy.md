# ADR-A09 — Page language: one policy channel, French dictionaries switched OFF by default

Status: technical decisions accepted by the agent · 2026-11-04 · the business policy (D-2 / PD-2) is **PROPOSED, not approved** · no schema change

## Context
Francophone site coordinators use English pages. The shell header already translates its own menus from the shared
preference `sdp_lang` (else the browser language); page bodies did not. The decision of which surfaces go French
(pages, e-mails, PPTX) is a business decision (D-2) that nobody has taken yet.

## Decision (technical)
- **One UI-policy channel** shared by later goals (A-10 landing / nav profile, deck-builder audience):
  `report_config` keys `ui_lang_default`, `ui_i18n_pages`, `ui_role_landing`, `ui_nav_profile`, `ui_deck_builder_roles`
  (all in `reportConfig.DEFAULTS`, all defaulting to today's behaviour) → pure `services/uiPolicy.js uiPolicyFrom(cfg)`
  (unknown/blank → default) → `GET /api/reports/auth/me` returns `{user, ui}` (a config read failure omits `ui`, never 500)
  → `public/auth.js` caches it in `localStorage.sdp_ui_policy` and exposes `window.__uiPolicy` at head-load (cached
  value or the defaults). A change reaches a browser on its second page load (the first one refreshes the cache).
- **Exact-text dictionaries** with the existing `public/lib/i18nText.js` (no re-keying — deferred, PO review P1-14):
  `public/lib/i18n/common.fr.js` + one file per page, merged and installed by `public/lib/i18n/boot.js` only when
  `__uiPolicy.i18n_pages === '1'`. Off = the page is byte-for-byte what it was (no install, no observer).
- `i18nText` additions: characterData observation (React re-renders update text nodes in place; a node already holding
  a French value is skipped — that is what stops the loop), whitespace-collapsed key matching, `merge()`, the policy
  first-visit default (applied but not saved, so the default can be withdrawn), and no reverse walk at install in
  English (an English-authored page could otherwise have a French fragment rewritten to its English key).
- **`<html lang>`**: the shell sets it from its language ONLY when the page opted in (`<html data-i18n="on">`, set by
  boot.js after a successful install). An English body keeps `lang="en"` (screen-reader voice must match the text).
- Settings are changed with `tools/reports/set-ui-policy.js` (dry run by default, `--apply` to write, value validated).

## Business policy — PROPOSED (D-2), not approved
Pages: French and English both available, one switch in the shell header; a saved choice (`sdp_lang`) wins; with no
saved choice the browser language decides. E-mails and PPTX stay English. Switch: `ui_i18n_pages='1'` activates the
page dictionaries; `ui_lang_default='fr'` makes French the first-visit default. Until an owner decides, both stay at
today's values (`'0'` and `''`).

## Consequences / limits
- Exact-text swapping cannot translate strings that embed a value ("Failed to load: …", "Saved · 12:04"); they stay English.
- Database lookup labels (meeting categories, severities…) and user-typed content are never translated.
- Chart.js canvas labels are not DOM text and stay English.
- Rollback: `set-ui-policy.js --key=ui_i18n_pages --value=0 --apply` (no deploy); the code is additive.
