# E-W2-KPI — plan E wave 2, bundle W2-KPI (E-K01, E-K03, E-K04, E-B03, E-B05)

Branch `goal/w2-kpi`. No migration (none assigned, none needed). PostgreSQL only. Nothing is adopted, approved or
named: every formula, threshold, owner and gate stays a decision for people.

## Verdict
| Goal / audit action | Verdict | Proof |
|---|---|---|
| E-K01 / audit K-01 (prep) — KPI committee charter, PV template | FIXED (prep) | `docs/kpi/COMMITTEE-CHARTER.md` (PROPOSITION: mandate, roles, quorum placeholder, author ≠ adopter cited to `services/sodPolicy.js`, `services/kpiPolicyStore.js`, `db/postgres/reports/065_kpi_policies.sql`, `committee_ref` format, effect date); `docs/kpi/PV-TEMPLATE.md`; `tests/kpi-docs-links.test.js` "the three committee documents exist and say they are proposals / not approvals" |
| E-K01 / audit K-02 (prep) — formula reference sheet | FIXED (prep) | `docs/kpi/FORMULA-REFERENCE.md`: resolution SLA, first-reply SLA, change success (3 definitions), sbDims, composite × screen / API / PPTX / e-mail with `file:line (anchor)` + parity test; divergence register DV-01…DV-11, none resolved; `tests/kpi-docs-links.test.js` "every file:line citation exists and still contains its anchor", "every parity test named in the documents exists", "…lists divergences without resolving them" |
| E-K03 / audit K-05 — red KPI → open / create the linked action | FIXED (switch `dashboard_red_action_links='0'`) | `public/lib/dashboardRender.js` `redActionSourceId` / `redActionHtml`; `routes/commitments.js` `GET /api/commitments/metric-links`, `POST /api/commitments {metric_link}`, `?metric=` list filter; `services/commitmentStore.js` `openLinksFor` / `createWithLink` (advisory lock, 409 naming the open one); `public/dashboards.html`, `public/commitments.html` prefill. Tests: `tests/red-action-links.test.js` (source-id format, switch off byte-identical, grey/UNKNOWN/stale never linked), `tests/red-action-links.smoke.test.js` (switch off 404/400, create 201 linked `metric`, duplicate 409, other-site editor / viewer 403, closed action frees the figure) |
| E-K04 / audit K-07, K-08 — variation explanation + labelled data note | FIXED (switch `metric_explain_enabled='0'`) | `services/variationExplain.js` (pure) + `GET /api/metrics/:key/explain`; `tests/variation-explain.test.js` "contributions sum to the delta…", "ratio: decomposed…never explained", "null window → UNKNOWN", "another site 403", "switch 0 → 404", note labelled `data_note` / "measured change — no cause asserted" |
| E-B03 / audit B-03 (prep) — value table | FIXED (prep) | `services/pilotMetrics.js` `buildValueTable`, `tools/pilot/pilot-metrics.js --value [--targeted=FILE] [--stopwatch=FILE]`, `docs/ops/pilot/VALUE-TABLE.md`; `tests/pilot-metrics-value.test.js` "empty inputs: every row is UNKNOWN…no value is 0", "pg: --value on a database with no pilot data → every value null, read-only session" |
| E-B05 / audit B-05 (prep), X-A-03, X-B-03 — RACI template + gate rows | FIXED (prep) | `tools/agent/raci-seed.js` (`--check`) → `docs/ops/pilot/RACI-TEMPLATE.md`; `docs/sdp360/completion/RELEASE-GATES.md` + Version / SHA, Conditions columns and pentest / QA lead / capacity / business-witness rows, all empty; `tests/raci-seed.test.js` (current, every decision cell empty, no date, four gate rows) |

## Deviations
- E-K03: the switch is read server-side (the page asks `GET /api/commitments/metric-links`; any non-200 → nothing
  rendered) instead of a `ui_*` key — one switch, no client cache. `SOURCE_SYSTEMS` gains `metric`; attaching a
  `metric` link by hand is refused while the switch is 0. Red links use relation `red_kpi` (the `origin` link is
  unique platform-wide, migration 029), so a new action can follow a CLOSED one. Only kpi tiles with a site and
  ragGrid cells get links (fleet tiles have no site to scope). `services/dashboardData.js` single widgets now carry
  `site_id` (additive).
- E-K04: no reader returns a category / group split for a count, so contributions are by site only; ratios are
  decomposed for ONE site only (a fleet ratio is not a sum); numerator + denominator exist for
  `helpdesk.closure_pct` only — other % metrics show the denominator (`base.n`) and a null numerator. Non-additive
  units (hours, points) answer `not_decomposable`. The note is returned by the API only; nothing writes it into an
  editorial store (Analyze Lite labelling in the deck — audit K-08 second half — needs `public/executive-report.html`
  and is not done here).
- E-B03: data freshness uses ACTIVE sources (synced at least once) as denominator, so an empty database is UNKNOWN,
  not 0 %. "Share of verified actions" = verified_closed ÷ technically completed in the window (proposed).
- E-B05: the register counts **193** unnamed owners on this branch (the audit's 194 counted the header sentence).
  RACI-TEMPLATE derives from FLAG-REGISTER: regenerate both at merge (`node tools/agent/flag-register.js && node tools/agent/raci-seed.js`).
- Tests were written next to the code, not strictly before it.

## Tests (PostgreSQL)
New: kpi-docs-links 5, red-action-links 4, red-action-links.smoke 5, variation-explain 6, pilot-metrics-value 6,
raci-seed 4 (manifest +30). Final run with neighbours (commitments ×4, metrics-registry, dashboard-sample-size /
widget-truth / time-truth, dashboards-routes.smoke, kpi-policy-routes.smoke, pilot-metrics, pg-pilot-metrics,
await-precedence, error-shape, ui-design-ratchet, readme-truth, flag-register, authz-route-matrix,
server-size-budget, i18n-coverage): **179 tests, 179 pass, 0 fail, 0 skipped**. Generators `--check` green:
flag-register, metric-map, metric-lineage, raci-seed. eslint clean on the touched server/tool/test files.

## Left for a person
- KPI committee: members, chair, secretary, quorum, adoption of the charter and the `committee_ref` format (gate 11);
  every divergence DV-01…DV-11.
- Decide `dashboard_red_action_links` (needs `commitments_enabled=1`) and `metric_explain_enabled`; browser check of
  the red-cell links and the prefilled commitment form with real sessions.
- Value table: targeted-user list, filled stopwatch sheet, baseline run before the pilot, Finance / BRM validation;
  data owner / result owner / validator per row.
- RACI: every R / A / C / I, steward and decision SLA; the four new release-gate rows and the Version / SHA and
  Conditions cells.
