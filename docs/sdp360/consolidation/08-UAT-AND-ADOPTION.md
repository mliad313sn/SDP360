# 08 — UAT and adoption

**Not performed.** No pilot site has been chosen (D-05), no real users, devices or mine-site networks are
available to the delivery team. Nothing here is FIELD_VALIDATED or BUSINESS_ACCEPTED.

Prepared for UAT (to be executed by named humans on a non-production instance):

| Journey | Persona | What to check | Automated proxy today |
|---|---|---|---|
| Open meetings / inspections list | Site coordinator (editor, 1 site) | only own site rows; site picker shows own site | `cross-site-object-writes.smoke` |
| Open Site Awareness | Site business owner | own site only; any other page → site view | `business-only-boundary.smoke` |
| Export CSV and open in Excel | Analyst | no formula executes from a `=`-leading cell | `csv-safe.test` |
| Integrations plan link | Anonymous | login page | `integrations-plan-gate.smoke` |

Adoption baselines (time to enter actions, time to build reports, duplicates): **NOT_MEASURED**.
