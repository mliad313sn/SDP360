# Infra WAN — sub-site (Exploration) extension — Design (V1b-E)

> **Status:** design, awaiting spec review + user review.
> **Builds on** the shipped V1b (A collector · C report auto-fill · D WAN Health dashboard)
> and the just-added editable **Site ↔ Meraki network** admin map. This extension adds a
> **sub-site dimension** so the multi-location **Exploration** report gets real per-sub-site
> Meraki WAN data. Read-only, config-gated, best-effort; **normal sites are byte-for-byte
> unchanged** (`sub_site = ''` throughout).

---

## 1. Problem

Every reporting site is 1:1 with one Meraki MX network — **except Exploration**. The
Exploration report is a **single site** whose Infrastructure-KPI table lists **many physical
sub-sites**, each as its own line named `<service> <SUBSITE>`:

```
WAN1 FETEKRO · WAN2 FETEKRO · LAN FETEKRO · WLAN FETEKRO · Servers FETEKRO · Backup FETEKRO
WAN1 TANDA   · WAN2 TANDA   · LAN TANDA   · …
LAN MANA · WLAN MANA · Servers MANA · Backups MANA          (no WAN — cohabits the mine)
WAN1 MASSAWA · WAN2 MASSAWA · …
```

The sub-site is encoded in the **line name**, not in a separate `sites` row. Today:

- `wan_link_snapshots` is keyed by `site_id` (one `wan1` per site), so it cannot hold
  `WAN1 FETEKRO` **and** `WAN1 TANDA` under the one Exploration `site_id`.
- The auto-fill matcher (`serviceToFill`) resolves only the service *type* (`WAN1 → wan1`)
  and ignores the sub-site token, so every `WAN1 <x>` line would get the same value.

## 2. Discovery findings (drive the whole design)

| Finding | Consequence |
|---|---|
| **Exploration is the ONLY multi-sub-site site.** All other sites have one MX with (generally) 2 links. | Model it cleanly but scope it to Exploration — no over-abstraction (YAGNI). |
| **A `WANx <SUBSITE>` line ⇒ that sub-site has its OWN Meraki MX network.** | Only sub-sites *with* WAN lines need a network mapping (FETEKRO/TANDA/MASSAWA). |
| **A sub-site with NO WAN line cohabits the mine and rides the mine's WAN.** It has its own separate WiFi/LAN/servers/backup. | MANA-type sub-sites need **no** WAN mapping — there is no WAN of their own to report. |
| A sub-site's WAN network **can be shared** with a mine site (e.g. `Massawa Gold Operations` is both the Massawa mine's network **and** Exploration's `MASSAWA`). | One network → possibly several targets; the same WAN numbers land in both reports from a single fetch. |
| **LAN/WLAN/Servers come from OpManager** (`infra_metric_snapshots`), which has **no sub-site dimension**. | Sub-site LAN/WLAN/Servers lines are NOT auto-filled (no correct per-sub-site source); they stay **blank + editable**. |
| Auto-filled cells are **always editable** — V1b-C fills only empty cells, never locks, typed values win. | Preserved verbatim; the coordinator can always edit any cell whatever its source. |

## 3. Decisions locked (with user)

- **Approach A**: `sub_site` is a first-class key dimension in the WAN store (not a separate
  table, not a config-JSON hack).
- **Scope = WAN (Meraki) per sub-site.** LAN/WLAN/Servers sub-site lines auto-fill only if a
  per-sub-site OpManager source ever exists; until then they stay blank + editable.
- **Config-editable** sub-site → network map (extends the admin editor; new location = add a
  row, no deploy).
- **Sequenced**: report **auto-fill first** (fills the visible red cells), **dashboard
  sub-site view second** — same store, no rework.
- Normal sites unchanged; read-only, config-gated, best-effort; no PPTX/email/score impact.

## 4. Data model

### 4a. `wan_link_snapshots` gains a keyed `sub_site`
New column **`sub_site TEXT NOT NULL DEFAULT ''`**, added to the **composite primary key**:
`(site_id, sub_site, uplink, period_type, period_start)`.

- Normal sites → `sub_site = ''`: same rows and behaviour as today.
- Exploration own-WAN sub-sites → `sub_site = 'FETEKRO' | 'TANDA' | 'MASSAWA'`.
- In the PK so `WAN1 FETEKRO` and `WAN1 TANDA` coexist under one `site_id`.

**Three coupled edits, or the nightly sync throws** (called out because they must land together):
1. **`_WAN_SNAP_COLS`** gains `sub_site` AND the **upsert `ON CONFLICT` target** becomes
   `(site_id, sub_site, uplink, period_type, period_start)` — the current 4-tuple
   (`reports-db.js:~2477`) would no longer match any unique constraint and every upsert would
   error on both backends. Same edit.
2. **`_wanVals` coerces `sub_site` null/undefined → `''`** (not the generic `undefined→null`),
   since the column is `NOT NULL` — one careless caller otherwise hits a NOT-NULL violation.
3. **`getWanSnapshots` needs NO new filter** — `SELECT *` already surfaces the column and the
   pure functions group by `sub_site`; `_wanWhere` is untouched (returning all sub_sites for a
   site is exactly the Exploration intent).

**Migration** (the table is tiny, nightly-resyncable, and has **no secondary indexes and no
foreign keys** on either backend → a clean rebuild):
- **sqlite** cannot alter a PK in place → a **guarded one-time rebuild**: if `sub_site` is
  absent (PRAGMA check), `CREATE` the new-PK table, `INSERT…SELECT` existing rows with
  `sub_site=''`, drop old, rename. Nothing to recreate (no indexes/FKs). Also update the
  **inline sqlite CREATE** to the new PK so fresh dev/test DBs skip the rebuild.
- **pg**: the migration is a **JS-side step in `initPgReports`** (like the existing
  `ADD COLUMN IF NOT EXISTS basis`, `reports-db.js:~1212`) — editing `008_*.sql` alone is a
  no-op on the existing prod table. Steps: `ADD COLUMN IF NOT EXISTS sub_site TEXT NOT NULL
  DEFAULT ''`; then a **no-op-safe PK swap** — `DROP CONSTRAINT IF EXISTS
  wan_link_snapshots_pkey` then `ADD PRIMARY KEY (…)` wrapped in a `pg_constraint` existence
  check / `DO` guard (`ADD PRIMARY KEY` has no `IF NOT EXISTS`, so a second boot would throw
  "multiple primary keys" without the guard). The `008` CREATE also carries the new-PK shape
  for fresh installs.
- **Not a copy-script concern:** `wan_link_snapshots` is in **none** of the `copy-reports-*`
  `TABLES` lists (it's `008`-created + nightly-resynced), and `wan_subsite_networks` is a
  post-cutover admin table on already-pg prod — so no copy-script edits.

### 4b. New config table `wan_subsite_networks`
`(site_id INTEGER, sub_site TEXT, network TEXT)`, PK `(site_id, sub_site)`. Holds "for this
site, sub-site `FETEKRO` uses Meraki network *Exploration Fetekro*." A **separate table**
because `site_module_codes` PK `(site_id, module)` holds only one network per site, whereas
sub-sites are inherently many-per-site. Empty for every normal site. Created on both backends
(shared CREATE + pg `initPgReports`); NOT in any `copy-reports-*` path (prod is already pg).

## 5. Config editor (admin, super_admin)

Extends the existing "Site ↔ Meraki network" editor in the Infra card; one Save covers both:

- **Main table (unchanged):** site → its one network (`sub_site=''`).
- **New "Exploration sub-sites (own-WAN locations)" table:** rows of **Site · Sub-site token ·
  Meraki network · ✕** + an **"+ Add sub-site"** button. The **token is the suffix on the
  report line** (`WAN1 **FETEKRO**`); matching uses the §7 shared normalizer (case-folded,
  whitespace/accent-normalized) and, if tokens ever overlap as substrings, the **longest**
  matching token wins. Sub-sites without their own WAN (MANA) get no row.
- **Wiring:** the existing `GET/PUT /api/analytics/wan/mappings` is extended to also
  return/accept a `subsites` array (one editor, one save). Backend: `listWanSubsiteNetworks()`
  + `setWanSubsiteNetworks(rows)` (replace-all: add/update/delete in one shot), dual-backend,
  super_admin. Validation: site + non-blank token + non-blank network, else the row is skipped.

## 6. Sync (`tools/meraki/sync-wan.js`)

`siteByNet` (network → one `site_id`) becomes **`netToTargets`** (network → a **list** of
`{site_id, sub_site}`), merged from:
- `site_module_codes` (module=`meraki`) → `{site_id, sub_site:''}`
- `wan_subsite_networks` → `{site_id, sub_site:<token>}`

Per MX device / uplink, **derive the WAN quality once** (the loss/latency history is identical
regardless of consumer), then **upsert one row per target**, tagging each with its `sub_site`.
A shared network (Massawa) resolves to two targets and lands as `(Massawa,'')` **and**
`(Exploration,'MASSAWA')` from a single fetch — no double API calls, no divergence. Suffix
tolerance (`- appliance`) applies to both maps; unmapped networks still skip + log by name.
Config-gated + best-effort unchanged.

## 7. Auto-fill matcher (`services/opmReportFill.js` + reports.html mirror)

**`sub_site` is resolved against the CONFIGURED token set, never by "any trailing word."**
This is the load-bearing rule (it prevents a normal-site regression — see below).

- **Family** is matched as today (`wlan/wifi` before `wan`, then `wan1/wan2/servers/lan`).
- **Sub-site** = the line's normalized remainder **iff it contains a token configured in
  `wan_subsite_networks` for this report's site** (case-folded, whitespace/accent-normalized
  via a single shared helper; on overlap, the **longest** matching token wins). Otherwise
  `sub_site = ''`.
  - `WAN1 FETEKRO` with `FETEKRO` configured → `{wan1, FETEKRO}`.
  - `WAN1 Fetekro Explo` with `FETEKRO` configured → `{wan1, FETEKRO}` (contains the token).
  - `LAN Main` / `WAN1 Primary` / `Servers DC` on a **normal** site (no configured tokens) →
    `sub_site=''` → **matched by family exactly as today**. This is why the rule is
    token-gated, not "trailing word = sub-site": a site with zero sub-site config behaves
    byte-for-byte as before.
- **`buildFills` matches by family AND sub_site:**
  - **WAN + a configured sub_site** → match the wan snapshot row by `(uplink, sub_site)`; the
    fill descriptor gains a `sub_site` field.
  - **WAN + `sub_site=''`** → match `(uplink, '')`, exactly as today.
  - **LAN/WLAN/Servers + a configured sub_site** → **no fill** (no correct per-sub-site source);
    the cell stays blank + editable.
  - **LAN/WLAN/Servers + `sub_site=''`** → matched by family, exactly as today.
- **Client mirror** (`_serviceToFill`): the server hands the client the **token list for that
  site inside the `infra-auto` payload**, so the client resolves `(family, sub_site)` with the
  same token-gated rule + the same shared normalizer — no independently-maintained token logic.
  A test drives both the server `serviceToFill` and the client parse over one line-name fixture
  set to pin them identical (closing the mirror-drift gap). Fills only empty cells; typed
  overrides untouched.

Net: the Exploration report's `WANx <subsite>` cells fill from each sub-site's network; the
LAN/WLAN/Servers/Backup sub-site cells stay blank+editable; **every normal report is
byte-for-byte unchanged** because a site with no configured tokens always yields `sub_site=''`.

## 8. WAN Health dashboard (`services/wanDashboard.js` + wan-health.html) — second slice

- `latestPerSite`: still groups by site; uplink cells carry `sub_site`. Normal sites render
  unchanged; Exploration shows **sub-site sub-groups** (`FETEKRO wan1/wan2`, `TANDA …`, …).
- `trendSeries`: keyed by `(sub_site, uplink)`; series labelled with the sub-site prefix when
  non-empty. The trend selector picks the site; Exploration's chart shows one line per
  sub-site-uplink.
- Both stay pure; the only change is "group key gains `sub_site`."

## 9. Testing

- **Pure:** `wanDashboard` sub_site grouping; `opmReportFill` — **token-gated** parse (a
  configured token yields the sub_site; NO configured tokens → `sub_site=''` even on a line
  with a trailing word, proving normal sites don't regress), WAN-by-sub_site,
  infra-with-token→no-fill; multi-word suffix (`WAN1 Fetekro Explo` → `FETEKRO`).
- **Sync:** `netToTargets` fans a shared network to two targets from one fetch; unmapped logs.
- **Store:** `wan_subsite_networks` reader/writer round-trip; **upsert round-trip asserting a
  `sub_site='FETEKRO'` row coexists with a `sub_site=''` row for the same
  `(site_id, uplink, period)`** (proves the new ON CONFLICT target); the `sub_site` migration
  (existing rows → `''`).
- **Mirror:** one line-name fixture set driven through BOTH `serviceToFill` and the client
  parse → identical `(family, sub_site)` (closes the mirror-drift gap).
- **Route smoke:** `mappings` GET/PUT carries `subsites` (super_admin gate); `infra-auto`
  returns sub-site WAN fills.
- **Regression:** `await-precedence` (new dual-backend dispatchers), **pptx-golden unchanged**,
  existing meraki/wan suites green (normal-site path identical).

## 10. Rollout / non-goals

- Schema migration guarded + idempotent, runs at boot; config-gated + best-effort; **normal
  sites unaffected**. Ships in the same ZIP → `_apply_on_prod` → `_pm2_restart_prod` flow.
  Browser E2E behind login = user step.
- **Non-goals:** per-sub-site LAN/WLAN/Servers auto-fill (needs an OpManager sub-site source —
  a separate future piece); making multi-sub-site general beyond Exploration (YAGNI); any change
  to PPTX/email/score.

## 11. Files touched

| File | Change |
|---|---|
| `reports-db.js` | `sub_site` column added to `_WAN_SNAP_COLS` + upsert `ON CONFLICT` target + `_wanVals` `''`-coercion; sqlite inline CREATE new-PK + guarded rebuild; pg `initPgReports` `ADD COLUMN IF NOT EXISTS` + guarded PK swap; `wan_subsite_networks` table (shared CREATE + pg init); `listWanSubsiteNetworks`/`setWanSubsiteNetworks` (dual-backend). `getWanSnapshots`/`_wanWhere` unchanged (column flows via `SELECT *`). |
| `db/postgres/reports/008_wan_link_snapshots.sql` | new-PK CREATE (fresh installs) + `wan_subsite_networks` CREATE. (No `copy-reports-*` edits — table isn't copied.) |
| `tools/meraki/sync-wan.js` | `siteByNet` → `netToTargets` (list); derive-once/row-per-target; each row tagged `sub_site`. |
| `services/opmReportFill.js` | token-gated `(family, sub_site)` parse (shared normalizer); `buildFills` matches WAN by `(uplink, sub_site)`, infra-with-token → no fill. |
| `services/wanDashboard.js` | `latestPerSite`/`trendSeries` gain the `sub_site` group key. |
| `routes/opmanager.js` | `mappings` GET/PUT carry `subsites`; `infra-auto` payload carries the site's token list for the client mirror. |
| `public/reports.html` | sub-site editor table; `_serviceToFill` mirror uses the payload token list + shared normalizer. |
| `public/wan-health.html` | sub-site sub-groups + labelled trend. |
| `tests/*` | as §9. |
