# ADR-P10 — Flag decisions sidecar, value scoreboard, exec pack / Exec View quality

Status: accepted for the sandbox (reversible engineering choices). Business values — owners, canary sites, deadlines,
expiries, the on-time rule, the suppression threshold, whether the public Exec View keeps naming sites — are NOT decided
here; they are listed as PROPOSED / missing.

## Decisions
1. **Decision fields live in a hand-maintained sidecar** (`docs/ops/flag-decisions.json`), merged by the generator into
   `docs/ops/FLAG-REGISTER.json`. The generator never fills a field: a blank or "to be decided" value is `null` and is
   listed in `docs/ops/FLAG-DECISIONS-GAPS.md`. The test checks that the gaps file is *current*, not that it is empty
   (completeness is a human job). Alternative rejected: decision columns inside PILOT-PROFILE.md (already overloaded,
   free text, not machine-checkable).
2. **"Dark" is computed, not declared**: a non-secret report_config key whose default is `'0'`, plus the word-default
   `sla_headline_definition = closed_only`, every frozen lot and every nested arm whose default is false. Frozen lots
   come from `tools/deploy/frozen-lots.json` when present, else from the lots named in CLAUDE.md (the file is absent on
   this branch). New dark switches therefore appear in the gaps list automatically.
3. **Value scoreboard = one assembler over existing builders** (`weeklyReportValue`, `siteActionsRegister` vocabulary,
   `assets-db` hygiene, `inspectionRepeat`, `decisionCycle`, `planFreshness`, `page_viewed`, survey replies,
   `wanSlaClaims.valueTotals`). No new formula; every reader is best-effort and an unreadable / off source is UNKNOWN
   with its reason. Site rows are filtered to the reader's sites below super_admin (`userSites.siteIds`).
4. **Before / after = manual snapshots keyed on the config journal**, not an automatic hook in the config PUT (that
   route is shared and in `routes/adminConfig.js`; a side effect there would couple every config save to a metrics
   read). A super_admin takes a snapshot before and after a flip; `compareRollouts` pairs each `config_changed` event
   with the nearest snapshot before and the first after, within a window (default 30 days). Migration 104 stores them.
5. **Exec pack portfolio slide**: drawn by render.py only when the payload carries `portfolio`, which reportPayload adds
   only when `exec_pack_portfolio_slide = '1'`; amounts only for admin tier / finance-viewer (no committee exception,
   invariant 2 as written). Goldens untouched at default.
6. **Exec View small cells**: `exec_view_min_cell` (0 = off = Exec View v1). On, a site below N is folded into one
   unnamed line without a count; its incidents lose site, title and RCA/CA text. Fleet totals stay (they name no
   site). MI detail summary already exists (`exec_view_mi_detail = summarized_only | none`).
