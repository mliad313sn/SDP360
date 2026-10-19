# KPI definition sheet (one per `metric_registry` row)

| Attribute | Value |
|---|---|
| **Key** | `module.measure_unit` — e.g. `helpdesk.resolution_sla_pct` (immutable once published) |
| **Name** | |
| **Module** | helpdesk · change · survey · assets · wan · infra · meetings · inspections · actions · tracker |
| **Unit** | % · count · hours · minutes · USD |
| **Direction** | higher is better / lower is better |
| **Formula (words)** | numerator = … ; denominator = … ; counted over the window by … |
| **Source columns** | table.column list (mirror or native) |
| **Window kind** | week · month · rolling13w · rolling3m · ytd |
| **Aggregation site → fleet** | re-sum counters (never average percentages) |
| **RAG policy** | name from `kpi_rag_policies` (or proposed new policy with justification) |
| **Not-applicable rule** | when denominator = 0 → "n/a (no closed tickets)"; when source never synced → "n/a (never synced)" |
| **Known divergence vs ITSM tool** | e.g. "AP counts Normal changes as Standard; we do too (D4)" |
| **Reader** | `services/metrics/readers/<module>.js` export name |
| **Owner seat** | |
| **RFI / DEC** | |
| **Fidelity test** | `tests/kpi-<key>.test.js` with fixture signed off by owner on <date> |

Example (existing, from `FORMULA_RECONCILIATION.md` D1):

| Attribute | Value |
|---|---|
| Key | `helpdesk.resolution_sla_pct` |
| Formula | closed requests whose `is_overdue` is false ÷ closed requests, both counted by `resolved_time` within the window |
| Window | week (ISO) and month |
| RAG | `sla-percent` (90 / 70) |
| NA | no closed requests in the window |
| Divergence | AP computes on created month; we compute on resolved time (documented D1) |
