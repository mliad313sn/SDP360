# I18N-QUALITY — French that reads as written by a francophone (AI evidence)

**Status: AI work, sandbox only — not reviewed by a francophone, not deployed.** Every French wording in this lot is a
**proposal** (decision D-2, gate 17): a coordinator from a francophone site must read it before `ui_i18n_pages` is
switched on. Nothing here changes a setting: the page dictionaries stay INERT while `ui_i18n_pages = '0'`.

Branch `feat/i18n-quality`, base `c6ea2ce0`. Inputs: AI UX committee review (`a11y-fr` seat findings F3–F6, F12–F15;
site-coordinator P1-7 / P1-8; executive F12; admin P2-2) — simulated review, not user research.

## What was wrong (committee findings this lot answers)

| Finding | Root cause | Fix |
|---|---|---|
| Status « Open » shown as the verb « Ouvrir » (F3) | one exact-text key (`'Open'`) cannot carry a verb and an adjective | **context keys**: `public/lib/i18nText.js` looks up `'Open@status'` first when the text sits in an `<option>`, an element whose class names a status / state / chip / pill / badge / rag, or `data-i18n-ctx="status"`. `common.fr.js`: `Open` → « Ouvrir » (buttons), `Open@status` → « Ouvert »; feminine / plural overrides per page (actions « Ouverte », inspections filter « Soumises / Clôturées », row pill « Soumise »). |
| « le suivi du Suivis du rapport », « Incubation métier sessions », « Enquête IT préoccupations », « Mine IT Council décisions » (F4) | the swap translated each text node of a sentence split by `<strong>` on its own, keeping English word order | **sentence keys**: an element whose children are text + inline tags (`strong em b i br`) is matched on its WHOLE text first; the French value may carry the same inline tags (allow-list, rebuilt as DOM nodes — never `innerHTML`; original inline elements reused, so classes survive). 9 hero / intro sentences rewritten whole (site-actions, meetings, meetings-council, meetings-unsigned, meetings-issues, meetings-actions, inspection-actions, project, executive); their fragment entries removed. The coverage test accepts a fragment only when its whole sentence is in the dictionary. |
| Raw server text « Missing state.header.department » / an untyped 500 on a PV without site (F5, P1-8) | JSON paths sent as user text; `saveMeeting` threw untyped errors → `internal_error` | `services/userErrors.js`: raw message → `{ error: plain English, error_code: raw, error_fr }`; `services/httpError.fail()` decorates every exposed (4xx) message; meetings / inspection save routes check site, department, meeting date up front (400, not 500) and send their denials through `fail()` (error-shape ratchet 443 → 422). The English sentences are also keys of `common.fr.js`, so a banner printing `error` is translated by the page layer. |
| Raw codes and English lookups (F6) | pages render `name_en` or the code (`on_track`, `HIGH`) | `public/lib/codeLabels.js` (`window.SDPLabels.label(kind, code[, lang])`), **generated** from the lookup seeds by `tools/i18n/build-code-labels.js` (`--check` in tests): 20 kinds, 15 from `meetings-init.json` / `inspection-init.json` / `statusTransfer.js`, 5 interface vocabularies (project status, priority, RAG, department RAG, incubation service status). The translation layer labels a bare code found in a status place through it (« on_track » pill → « Dans les temps »). Lookup display names (department, category, origin, escalation reason, council theme, phase, IT involvement) are generated into `I18N_FR_LOOKUPS` (common.fr.js) and merged by `boot.js`; ambiguous single words (« Survey » = Topographie vs enquête) only apply in a status / option place (`Survey@status`). |
| English dates and numbers, « W45 » in French (F12) | `toLocaleString('en')` / `'en-GB'` in shared helpers | `public/lib/format.js` (`window.SDPFormat`): `date`, `dateTime` (UTC, « 15 janv. 2026 à 07:20 UTC »), `number` (« 1 629 », narrow no-break space), `percent` (« 73,5 % »), `duration` (« 1 j 22 h »), `week` (« S45 » / « W45 »), `plural`. Unknown → « — », never 0. Language = the page body's (translation layer installed → its language; else `<html lang>`; else English) so an English body never gets French formats. Wired into the shared helpers: `dashboard-shared.js fmtDowntime`, `chartTheme.js` (data tables), `analyticsLogic.js fmtNum/fmtPct`, `dashboardRender.js formatValue`; English output byte-identical. `reportingWeek.label()` → « S45 (08–14 nov.) » in French. |
| « 1 ouvertes », « (1 affichés) », « 0 jours », « Boîte calculée » (F13) | no agreement rule | `home-page.js`: French 0/1 singular; « Liste calculée ». |
| Terminology drift: Council / Conseil, gravité / sévérité, « Insights », « Thème Council » (F14) | no single glossary | `docs/i18n/GLOSSAIRE-FR.md` (87 terms + agreement rules + format rules), replaces `docs/ux/GLOSSARY-FR.md` (now a pointer; the two glossary tests read the new file). Dictionaries aligned: « Analyses · … », « Gravité », « Council » (proper name of the Group body, as in the seed data — never « Conseil »), « Thème du Council », « backlog » (existing glossary choice). |

## How the format / label libraries reach the pages

`lib/i18n/boot.js` loads `lib/format.js` and `lib/codeLabels.js` (with its own `?v=` so a deploy refreshes them) **only
when the dictionaries install** — an English page is untouched — and re-walks the page once the labels arrive. No page
HTML was edited (the visual-polish lot owns the pages). Strict-CSP pages allow it (`script-src 'self' 'nonce-…'`).

## Tests

- New `tests/i18n-quality.test.js` (16): verb/status mix list, forbidden fragments and variants, markup allow-list in
  values, glossary spot-checks, the translation layer on a minimal DOM (sentence block with 5 `<strong>` kept; option /
  pill vs button; raw code labelled; ambiguous department only in an option), `t()` with context, `format.js` fr-FR and
  en-GB (incl. null / garbage → « — », measured 0 shown, language source), shared helpers French vs byte-identical
  English, `codeLabels` = seeds (`--check`), code-set coverage, `userErrors` + `fail()` decoration (never on a 5xx).
- Fails before the fix: on base `c6ea2ce0` the dictionaries held « et le suivi du » (1), « Insights · » (7),
  « sévérité » (3), « Thème Council » (2) and `common` had no `Open@status` — each a failing assertion above.
- Adjusted: `i18n-coverage` (sentence-block coverage, `@ctx` stripped for the source check), `i18n-shell-charts` /
  `i18n-inline-glossary` (glossary path), `adoption-lota-week` (« S45 »), `error-shape` (ratchet 422).
- Runs (PostgreSQL 17, throwaway DBs `*i18nq*`): 125 test files touching i18n, a11y, CSP, field, meetings,
  inspection, shared helpers and error shape — 834 tests, 0 fail after the last fix (one assertion of the new test
  was updated when the routes moved to `fail()`). E2E journeys (`npm run test:e2e -- --runs=1`): GREEN, 44 journeys.
  `npx eslint .` clean.

## Not done, and why

- **Pages that still format inline** (not through a shared helper): `assets.html` (44 calls), `executive.html` (18),
  `executive-report.html` (11), `index.html` (9), `reports.html` (7), `wan.html`, `inspection.html`, `portfolio.html`,
  `analytics.html`, `site-awareness.html`, `exec-view.html`, plus `lib/portfolioRegister.js`, `lib/wanClaimsPane.js`,
  `lib/assetHygieneVisuals.js`, `finance.js`, `analyze-lite.js`. Each needs an edit of the page file, which the parallel
  visual-polish lot owns in this run; `SDPFormat` is loaded on every translated page, so each call becomes a one-line
  change (`SDPFormat.number(n)` instead of `n.toLocaleString('en')`). `executive-report.html` builds the English deck
  (decks stay English, D-2).
- **Seed wording** (`meetings-init.json` name_fr) is data, used as is: « Usine / Plant », « Supply Chain »,
  « Vendeur / licence », « Process / Procédé », « Mine IT Council ». Rewording them is a lookup edit (Admin ▸ Meetings
  codes) for a francophone reviewer, not an AI decision on data.
- **Validation of the French itself**: impossible for an AI to self-certify — gate 17 / D-2 needs a francophone site
  coordinator. The glossary and every new sentence are marked as proposals.
