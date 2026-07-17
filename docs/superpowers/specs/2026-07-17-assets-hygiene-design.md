# Asset Module — Sub-project B (Hygiene CMDB) — Design

**Status:** approved to build (user granted autonomous delivery 2026-07-17).
**Depends on:** Sub-project A (Foundation), merged to `main`. Reuses its `assets` table
and `getEnrichedAssets`/`ASSETS_BACKEND` substrate untouched.
**Branch:** `feat/assets-hygiene`.
**Data facts:** see `2026-07-17-assets-foundation-design.md` §3 — NOT repeated here.
This doc only adds what B decides.

---

## 1. Problem & audience

The CMDB is a **discovery dump, not an owned register**: 2 245/2 473 assets are
`In Store`, only 2 are `In Use`; ownership (user/department) is filled on 0.08 %,
acquisition/warranty on 9 %, and 2 246 rows carry `purchase_cost = '0.00'`. That is
not a bug to hide — it is the *finding*. Sub-project B turns "how trustworthy is
the register?" into (a) a **Group-IT hygiene dashboard**, (b) six **exception
reports** with Excel export, and (c) a **scheduled email digest** of those
exceptions to a Group-IT distribution list.

Audience: **Group IT (core)**; all three roles may view. The value is the
completeness gap made visible and the *actionable* subset (Discovered /
never-scanned / ghost) made a worklist.

**No money is displayed anywhere in B.** The `$` label is a currency lie
(XOF vs USD, unresolved until C/D). B's "no-cost" report lists *which* assets
lack cost data — never an amount.

---

## 2. The six exception kinds (the contract)

Each kind is a predicate over the `assets` table. Two are genuine worklists
(small, actionable); four are completeness gaps (huge, shown as % not chased row
by row — but still exportable for a data-cleanup drive). Counts are the live
2026-07-17 profile; the code must not hard-code them.

| kind | predicate (sqlite/pg identical) | ~live | nature |
|---|---|---|---|
| `discovered` | `state = 'Discovered'` | 156 | **worklist** — seen, not enrolled |
| `never_scanned` | `last_successful_audit_time IS NULL OR last_successful_audit_time = '' OR last_audit_status IS NULL OR lower(last_audit_status) NOT LIKE '%success%'` | 677 | **worklist** — never a clean audit |
| `ghost` | **successfully** scanned before (`lower(last_audit_status) LIKE '%success%'`) **and** `CAST(NULLIF(days_since_scan,'') AS INTEGER) > 90` | ~90 | **worklist** — was healthy, now stale >90 d |
| `no_owner` | `(user_name IS NULL OR user_name = '') AND (department IS NULL OR department = '')` | ~2 471 | gap |
| `no_age` | `acquisition_date IS NULL OR acquisition_date = ''` | ~2 246 | gap |
| `no_cost` | `purchase_cost IS NULL OR purchase_cost IN ('0.00','0','')` | 2 246 | gap |

**Traps locked into the predicates (from Foundation §3):**
- `no_cost` uses `IN ('0.00','0','')`, **never `IS NULL`** — cost is present-as-`0.00`, so `IS NULL` returns 0. `purchase_cost` is stored raw TEXT (commas survive); B never parses the amount.
- `no_age` is genuinely empty at 91 %, so `IS NULL OR = ''` is correct (opposite of cost).
- `ghost` and `never_scanned` are **disjoint by construction**: `never_scanned` fires on any row whose CURRENT `last_audit_status` isn't a success (or has no successful-audit time), while `ghost` requires `last_audit_status LIKE '%success%'` AND >90 d. So a "scanned-once-but-currently-failing, stale" row is `never_scanned`, never both — the three worklist counts sum to their true union. `days_since_scan` is TEXT → `CAST(NULLIF(...,'') AS INTEGER)`; the `NULLIF` avoids the pg strict-cast 500 on `''` (sqlite is lenient, pg is not — the documented "sqlite-green/pg-500" trap). Pin the boundary with a seeded row (status-failed + 120 d) asserting it lands in `never_scanned` only.
- `no_owner` needs BOTH user and department empty (there is no `user_email` column; Foundation folded ownership into `user_name`+`department`).

All predicates accept the SAME whitelisted filters as `getEnrichedAssets`
(`site`, `state`, `product_type`, `manufacturer`, `q`) — except the kind's own
column is fixed. Filters are parameter-bound; no string interpolation.

---

## 3. Completeness score (the KPI)

Per site and fleet: the share of assets that HAVE each attribute, plus a single
rollup. Pure arithmetic over counts — no weighting cleverness (avoid the
"invented model" trap; this is a data-completeness percentage, not a judgment).

```
cost_pct   = 100 * (total - no_cost)      / total
age_pct    = 100 * (total - no_age)       / total
owner_pct  = 100 * (total - no_owner)     / total
scan_pct   = 100 * (total - never_scanned)/ total
completeness = mean(cost_pct, age_pct, owner_pct, scan_pct)   // unweighted
```

`total = 0` for a site → all pct `null` (not `0`, not `NaN`) and the site reads
"no assets", same discipline as the score module's `applicable:false`. The
dashboard shows these as bars; the digest states them in one line per site.

---

## 4. Deliverables

### 4a. Readers (`assets-db.js`, additive — no change to existing fns)
- `HYGIENE_KINDS` — the ordered predicate map (single source of truth; the routes
  and the Excel/digest all read it, so a kind is defined once).
- `getHygieneSummary(filters)` — `{ total, by_kind:{kind:count}, by_site:[{site,total,cost_pct,age_pct,owner_pct,scan_pct,completeness}], scan_freshness:{never,over90,d30_90,d7_30,under7}, by_state:{...} }`. Dual-backend.
- `getHygieneExceptions(kind, filters)` — the identity rows for one kind (asset_id, asset_name, product, product_type, manufacturer, state, site, serial_number, days_since_scan, last_audit_status, last_scan_source — **no cost amount**). Dual-backend. Unknown `kind` → throws (never a silent empty).
- Both are dual-backend dispatchers → `tests/await-precedence.test.js` auto-covers them; every caller awaits.

### 4b. Routes (`server.js`, additive; placed with the other `/api/assets/*`)
- `GET /api/assets/hygiene/summary` — `requireReportSession`.
- `GET /api/assets/hygiene/exceptions?kind=&<filters>` — `requireReportSession`; unknown kind → 400, never 500.
- `GET /api/assets/hygiene/export.xlsx?kind=all|<kind>&<filters>` — `requireReportSession`; `all` → one workbook, one sheet per kind; a single kind → one sheet. Reuses `services/tableExcel.buildWorkbook`. **No cost column.**

### 4c. Dashboard (`public/assets-hygiene.html`, new; Insights ▾)
- Header band: fleet completeness % + total assets + sync-freshness note (reuses `/api/assets/summary` freshness).
- KPI tiles: the 3 worklist kinds (Discovered / Never-scanned / Ghost) with counts + drill-in.
- Charts (Chart.js, already in CSP): completeness by site (stacked/bar), scan-freshness distribution (donut), state distribution (bar). Pure CSS/Chart — no new lib.
- Per-kind drill-down table (click a tile/kind → `/exceptions?kind=`) + an **Export Excel** button per kind and an **Export all**.
- Same session-cookie auth as `assets.html`. In `_htmlCache` + a `sendHtmlPage` route. Nav: a second Insights child "Assets — Hygiene" (reuse the `hard-drive` icon or add `shield-check`, already in `icons.js`).

### 4d. Email digest (`services/assetHygieneReport.js`, new — pure)
- `buildHygieneDigest(summary, { period, prev }) → { subject, html, attachments:[{filename, content:<xlsx Buffer>}] }`.
- HTML: fleet completeness, per-site completeness table, the three worklist counts with Δ vs `prev` (if given), scan-freshness line. Plain, table-based (survives Outlook). **No amounts.**
- The attachment is the `all`-kinds workbook (built from the same `getHygieneExceptions` rows the routes serve — one composer, one truth). Pure: it receives the summary + pre-fetched exception rows, builds strings + Buffer, does NOT touch the DB or SMTP (testable without either).

### 4e. Scheduled send (`tools/reports/send-hygiene.js`, new — mirrors `send-reports.js`)
- Resolves recipients + gate from `reportConfig` (reuse the existing k/v store):
  `hygiene_recipients` (comma-separated), `hygiene_send_enabled` (`'1'` to arm).
  **Both keys MUST be added to `reportConfig.DEFAULTS`** — `setConfig` drops any key
  not in `DEFAULTS`, so without this the admin card's writes vanish silently and the
  digest is permanently inert (fails safe, but dead). This is a flagged existing-module edit (Task 5).
- **Sync-freshness for R1** is read by the CLI from `sync_metadata` (job
  `assets_assets`, written by A's sync via `rdb.markSyncSuccess`) and attached as
  `summary.sync = { last_success, age_days }` before composing — neither
  `getHygieneSummary` nor `getAssetSummary` carries it. The composer states it as
  a "register last synced N days ago" line so a stale-but-non-empty register is
  visible in the mail.
- **Safety gate (honours "never send to an unconfirmed address"):** refuses to
  send unless `hygiene_send_enabled === '1'` AND `hygiene_recipients` is non-empty.
  The list is admin-entered; entering it in the admin card is the confirmation act.
  Default is OFF — nothing sends until an admin explicitly arms it.
- Composes via `assetHygieneReport`, sends via `mailer.buildMailer(cfg).send`,
  logs + dedups via `reportSentLog` (`report_type='hygiene'`, `site_code='GROUP'`,
  `period=YYYY-MM`; one send per calendar day unless `--force`).
- `--preview` prints the resolved recipients + subject + would-send, sends nothing.
- Guarded entrypoint (`if (require.main === module)`), pure core exported
  (`decideHygieneSend`, `main`) — the un-testable-IIFE trap.

### 4f. Schedule + admin config (existing modules — flagged edits)
- `services/reportSchedule.js`: add `'hygiene'` to `TYPES`; pick the CLI per type
  (`send-hygiene.js` for hygiene, else `send-reports.js`) via a small map. Additive;
  the coordinator path is byte-unchanged.
- `public/reports.html#admin`: a "🛡 Assets Hygiene digest" card (admin+) —
  set recipients, arm/disarm, schedule (weekly/monthly via the existing schedule
  API), and **Preview / Send now** (calls a `POST /api/assets/hygiene/send?preview=1|0`,
  `requireAdmin`, which shells the same composer). Reuses the existing card CSS/modal.
- These are the only existing-module edits beyond the additive route block; each
  is minimal and called out in the plan.

---

## 5. What B does NOT do (guard against scope creep)
- No money/currency (C/D).
- No `software`/`software_installations` (C — 121 k rows, own fetch strategy).
- No trustworthy external-monitor count / RAM<8 / full-disk refresh signals (D).
- No new sync — B reads the tables A already syncs. If A hasn't synced, the
  dashboard shows the empty-state + stale-sync banner (the freshness note), never
  a fake zero-as-success.
- No auto-discovered recipients — the digest list is explicit + armed, or it does
  not send.

## 6. Risks
- **R1 — a digest that mails "0 exceptions" because the sync silently emptied a
  table.** Mitigated upstream: A's C1 guard refuses an empty-fetch wipe; the digest
  additionally states the sync's `last_success` age, so a stale register is visible
  in the mail, not hidden.
- **R2 — pg strict cast on `days_since_scan`.** `NULLIF(...,'')` + `CAST` per the
  Foundation trap; both backends tested.
- **R3 — sending to the wrong/unconfirmed list.** Default-off arm flag + explicit
  admin-entered recipients + `reportSentLog` audit + `--preview`. Nothing sends
  unattended until armed.
- **R4 — existing-module edits (reportSchedule, reports.html, server.js).** Kept
  additive; the coordinator schedule + send path stay unchanged; full regression +
  `await-precedence` gate before merge.
