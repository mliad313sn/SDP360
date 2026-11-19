# ADR-P08 — KPI certification pack: what the agent decided, what it left to humans

Status: technical decisions (reversible engineering details). No KPI definition, threshold, owner or approval is
decided here — those are KPI-committee fields and stay empty ("to be decided").

## 1. Disputed definitions are computed, never chosen
`tools/kpi/side-by-side.js` runs BOTH definitions of each disputed figure (D-01 change success, the two resolution-SLA
questions, the fleet aggregation rule, D-02 site score, D-03 roadmap) through the production functions on one
fictitious dataset. Pinned by tests/kpi-side-by-side.test.js. The registry keeps both change-success metrics as drafts.

## 2. Parity is proven against the dictionary, not hand-picked figures
tests/figure-parity-all-kpis.test.js stubs the registry READERS only (fixture records) and drives the real routers,
resolver, report generator and the four report renderers for every published metric (53 at the time). A new
published metric is covered automatically. Mutation-checked: changing the PPTX/HTML rounding fails it.

## 3. The unknown sweep is a ratchet over server code
Scope = root *.js, services/**, routes/** (the readers and composers). A line touching a ratio / score / average is
never auto-justified by a rule (it needs a reviewed note). Fix policy (P08 prompt): a clear defect "unknown shown as
0" ships ON (signoff_pct of a month with no PV: 0 → null; the site-report adapter no longer re-coerces null to 0).
A change of a displayed figure that is not a clear defect, or that needs another area (render.py, the frozen tracker
engine twins, a fidelity-pinned port), is recorded as PROPOSED with its consequence and left as today.

## 4. Reconciliation and site-code readiness are read-only tools
`tools/kpi/reconcile-source.js` (count + sum per group, owner's export vs stored rows) and
`tools/sites/site-code-readiness.js` (difference report + verdict) read PostgreSQL through PG_URL and never write.
The export data and the switch decision (site_codes_from_registry) belong to the data owner / committee.

## 5. No new switch, no migration
Nothing in this pack adds a report_config key or a migration.
