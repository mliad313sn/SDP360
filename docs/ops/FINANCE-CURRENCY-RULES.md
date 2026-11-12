# Finance currency rules — every money path (F-DATA-10)

Status: **engineering inventory, not a Finance rule.** Each line says what the code does today and what Finance has
still to decide. Nothing here is an approval. Amounts in two currencies are never added together anywhere.

| Money path | Where the currency comes from | Rule in code | Finance decision pending |
|---|---|---|---|
| Asset purchase cost, book value, TCO | Source values are XOF (the `$` in the source header is not a currency) | `services/money.js` converts XOF → USD once with `xof_usd_rate` (`services/reportConfig.js`); a blank or zero rate falls back to the default, never to 1. Shown as "USD" by a text label, no glyph | The rate, its date and who updates it |
| Asset cost per site (A-26, proposed) | `asset_site_currency` + `asset_currency_rates` (both empty today) | `services/currency.js`: an unknown currency is UNKNOWN — excluded and counted, never converted at the XOF rate | Adopt the per-site map or keep the single-currency reading |
| Software licence cost | Native USD in the source | `services/assetForecast.js` reads the amount directly, no conversion | Confirm that every licence contract is in USD |
| Project budget / spent | `portfolio_projects.currency` (column default `USD`, `db/postgres/reports/018_governance.sql`) | `services/governanceStore.js`: an amount written with no stated currency is flagged `currency_defaulted = 1` (`db/postgres/reports/081_benefit_class_and_currency_flag.sql`), the ledger note carries `currency_defaulted=true`, the caller gets the warning `CURRENCY_DEFAULTED`, and the portfolio / project pages and the workbook say "default, not confirmed". With `finance_currency_required = '1'` the write is refused (`CURRENCY_REQUIRED`). Rows written before migration 081 carry no flag: not known, never guessed | Require a currency on every amount (`finance_currency_required`); review the rows flagged or written before the flag |
| Portfolio roll-up per programme | The projects' currencies | `services/portfolioEvidence.js`: one total only when every costed project has one currency; otherwise per-currency lines. A project without a budget is counted, not read as 0 | None for the split; see the line above for the default |
| Budget per period, EAC (E-P04) | Each period row carries its own ISO code | `services/ppmBudgetPeriods.js`: a row without an ISO currency is refused; EAC and variance per currency only | Certification of the periods and of the EAC method |
| Annual planning pack (R16) | The projects' currencies | `services/annualPlanPack.js`: a project without a currency is left out of the per-currency budget table | The envelope per currency |
| Benefit of kind "money" | `portfolio_benefits.currency` (no default) | `services/governanceStore.js`: a money benefit without a currency is accepted with the warning `CURRENCY_MISSING` (refused with `finance_currency_required = '1'`); with `benefit_value_class_enabled = '1'` a money benefit that states a measurement basis must state its currency. Totals per class **and** currency (`services/portfolioBenefits.js`) | Method, period, perimeter and verifier of a money benefit (`benefit_money_verifier_role`) |
| WAN SLA credit (ISP chargeback) | The circuit's currency in `sla_wan_config` | `services/wanSla.js` returns the circuit's currency with the credit (null when the circuit has none); the page shows amount + code, no glyph | Contract currency per circuit |

## What changed with F-DATA-10

- Before: a project budget sent without a currency was stored as USD and read everywhere as a confirmed USD amount.
- Now (switch at its default `0`): the write is still accepted, but it is visible — flag, ledger note, warning in the
  API answer, "default, not confirmed" on the pages and in the workbook.
- With `finance_currency_required = '1'`: refused. Turning it on is a Finance decision.

## Left for a person

- Decide whether a currency is mandatory (`finance_currency_required`).
- Review the projects listed as "default, not confirmed" on the portfolio page and state their currency.
- Rows written before the flag existed are not classified: a Finance reviewer confirms them one by one.
