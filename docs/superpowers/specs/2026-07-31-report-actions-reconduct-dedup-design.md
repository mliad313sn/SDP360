# Report Actions — auto-reconduction + near-duplicate guard (design)

**Date:** 2026-07-31 · **Branch:** `feat/report-actions-reconduct-dedup`

## Problem

The Site Actions hub (`site-actions.html`) surfaces the same real action several
times because report editors **re-type** an unresolved follow-up each week instead
of carrying it forward — e.g. "Helix underground surveillance software deployment"
appears in W10, W13, W14, W15, W16 with slightly divergent wording. Each manual
re-entry gets a fresh `uid` and **no `lineage`**, so the hub's lineage-dedup
(`_dedupLineage`) treats them as distinct open follow-ups.

The anti-duplicate machinery already exists (`uid` / `lineage` / `_dedupLineage`);
the gap is purely behavioural: carry-forward is a **manual** button editors forget.

## Decisions (from brainstorming)

- **Scope:** A (auto-reconduction) + B (near-dup guard). Merging the *existing*
  divergent rows (C) is a deferred follow-up.
- **A trigger:** pre-fill + review. On opening a **blank** new week, the Actions
  section is auto-populated with the previous week's unresolved actions (editable
  draft); nothing persists until the editor saves.
- **A status scope:** all non-resolved — `open` + `in_progress` + `on_hold`
  (everything not `closed`/`cancelled`) — matching the hub's "open" definition and
  the existing manual carry-forward.
- **B behaviour:** warn + offer to *link* (non-blocking). Linking sets the new
  row's `lineage` to the matched action's lineage → the hub folds them. No hard block.

## Approach (chosen: reuse lineage, client orchestration)

Both A and B ride the **existing** lineage mechanism; the hub dedup is untouched.

### A — auto-reconduction (client only, no new endpoint)
On opening a report whose `action_items` is empty AND status is `draft`/`in_progress`,
`maybeReconductActions()`:
1. `GET /api/reports/:id/action-weeks` → previous weeks with non-closed action counts.
2. Pick the **most recent previous** week with `action_count > 0`.
3. `GET /api/reports/:id/actions-from/:sourceReportId` → its non-closed actions.
4. For each non-`source` action, `addActionRow({ ...a, uid:'', lineage: a.lineage || a.uid })`
   (fresh uid, **preserved lineage** — identical to the manual `_importFromWeek`).
5. Show a banner: "↩ N action(s) reconduite(s) de W-X — révise puis Enregistre"
   with an "Annuler la reconduction" that restores the empty row.

Re-nag guard is intentionally **state-free**: keyed only on "actions empty on open".
If the editor leaves without saving, the draft is discarded and re-proposed next
open (correct — nothing was committed). If they save with rows, the report is
non-empty → never re-fires. No DB column.

### B — near-duplicate guard (pure module + 1 read)
- New pure module `public/lib/actionSimilarity.js` (Node-testable + browser):
  `normalizeTask(s)` (lowercase, strip accents, drop EN/FR stopwords, tokenize) and
  `findBestMatch(task, candidates, {threshold=0.5})` → `{ candidate, score }` or `null`
  using Jaccard token-set overlap. Validated on the real Helix / MineArc / Radio
  strings (identical re-types → 1.0; the parenthetical Helix variant → 0.625;
  unrelated actions → ~0).
- New route `GET /api/reports/:id/site-open-actions` → resolves the report's site and
  returns `getSiteOpenReportActions(report.site_id)` (existing reader; sibling of
  `/action-weeks`, no `/:id` shadowing). Fetched once on report open, cached client-side.
- On **blur** of a *new* row's task field (no uid/lineage/source), compare against the
  cache (excluding same-lineage). If `score ≥ threshold`, show a small dialog:
  "« task » ressemble à « match » (ouverte, W-X · statut). [C'est la même — lier]
  [Garder séparé]". *Lier* sets `tr.dataset.lineage = match.lineage`; *Garder séparé*
  records a per-row dismissal so the same text doesn't re-prompt.

## Blast radius / what is NOT touched

- `saveActionItems` (upsert-by-uid) — unchanged. Reconducted + linked rows persist
  through the exact existing path.
- `_dedupLineage` / hub — unchanged; fed correct lineage.
- No migration; existing reports untouched. Pre-fill only fires on newly-opened blank
  weeks going forward.
- Infra / Helpdesk / Lights / PPTX / e-mail / monthly rollup — untouched.

## Testing

- `tests/action-similarity.test.js` — pure module: normalize (accents/case/stopwords),
  Jaccard scores on the real strings, threshold behaviour, empty/degenerate input.
- `tests/site-open-actions-route.smoke.test.js` — boots the app (sqlite), asserts the
  new route returns `{actions:[…]}` with `task`+`lineage`, gate + 404.
- Regression green: `action-items-upsert`, `site-open-report-actions`,
  `importable-actions.smoke`, `report-action-status.smoke`, `site-actions-merge.smoke`,
  `await-precedence`.
- Client wiring (reconduction banner, blur dialog, link) verified in the browser on
  the user's session (E2E behind login).

## Known weak points (accepted, mitigated)

- Re-nag edge: editor deletes all reconducted rows and saves empty → re-proposed next
  open. Rare; acceptable (state-free guard chosen deliberately over a DB flag).
- Similarity false positives on legitimately-similar-but-distinct actions → soft
  warning only, editor decides, threshold tunable, scoped to the same site.
- Reconducted rows keep the previous owner/date → editor revises (banner says so).
