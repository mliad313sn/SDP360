# ADR-A11 — one published site verdict, behind a switch (default = today)

Status: AI technical decision · 2026-11-04 · the **business choice is NOT taken**: it belongs to the committee
(repo decision log **D-03 "Reference site score"**, still **Open**; playbook D-1). This ADR only describes the switch.

## Context
Two authoritative scoring models are mailed today, and they disagree (3 of 5 sites change colour,
`docs/sdp360/completion/KPI-DISPUTES.md`):
- the **programme score** — `services/siteScore.js` (sbDims, 6 dims × 0/1/2, RAG 70/45, **3-month rolling window**),
  headline of the coordinator monthly e-mail;
- the **operational composite** — `services/siteScoreboard.js` (4 dimensions, RAG 75/55, **current month**),
  the scoreboard e-mail.
Both are fidelity-pinned ports; neither is retuned here.

## Decision
`report_config.site_score_published_model` (in `services/reportConfig.js` DEFAULTS):
- `legacy` (**default**) — each e-mail keeps its own model exactly as today. The coordinator e-mail is byte-identical
  (monthly goldens untouched) and send-scoreboard never calls the programme readers.
- `programme` (the **PROPOSED** pilot value, `docs/ops/pilot/PILOT-PROFILE.md`) — the scoreboard digest gains a
  "Score programme (publié)" column + pill per site (computed with the coordinator's own readers,
  `siteReportDeps.scoreInputs/prevScore` + `computeSiteScore`), quotes it in "Où se situe votre site", relabels the
  composite "Indicateur opérationnel (non publié)" and states both windows. The coordinator e-mail is unchanged.
- `operational` — the coordinator e-mail gains a labelled "Published site verdict" card with the site's composite;
  the programme hero stays, marked "not the published verdict".
- Any other value falls back to `legacy`. A non-applicable model reads "non applicable", never 0 or a colour.
`services/publishedSiteScore.js` only chooses between the two already-computed results; it scores nothing.

Also in this change (independent of the switch): `kpiRag.aggregate(values, type, {emptyAs})` (opt-in, default 0 as
before), `kpiRag.isMeasured(values)`, and an additive `measured` flag on every `trackerDefinitions.score()` item.
No tracker value or colour changes.

## Evidence for the committee
`node tools/reports/site-score-shadow.js --month=YYYY-MM` (read-only) prints, per site, both verdicts and whether
the colours agree.

## How to flip / roll back
super_admin sets `site_score_published_model` in Admin config (or `PUT /api/reports/config`), previews with
`node tools/reports/send-scoreboard.js --preview`. Rollback = set it back to `legacy`; no deploy, no data change.
