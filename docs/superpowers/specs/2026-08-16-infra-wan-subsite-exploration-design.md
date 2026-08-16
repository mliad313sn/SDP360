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

**Migration** (the table is tiny and nightly-resyncable → low risk):
- **sqlite** cannot alter a PK in place → a **guarded one-time rebuild**: if `sub_site` is
  absent (PRAGMA check), `CREATE` the new-PK table, `INSERT…SELECT` existing rows with
  `sub_site=''`, drop old, rename. Idempotent.
- **pg**: `ADD COLUMN sub_site … DEFAULT ''` + `DROP CONSTRAINT`/`ADD PRIMARY KEY` to include
  `sub_site`. Idempotent (`IF NOT EXISTS` / guarded).
- The pg copy script (`copy-reports-*`) and the shared `008_wan_link_snapshots.sql` CREATE are
  updated to the new shape for fresh installs.

### 4b. New config table `wan_subsite_networks`
`(site_id INTEGER, sub_site TEXT, network TEXT)`, PK `(site_id, sub_site)`. Holds "for this
site, sub-site `FETEKRO` uses Meraki network *Exploration Fetekro*." A **separate table**
because `site_module_codes` PK `(site_id, module)` holds only one network per site, whereas
sub-sites are inherently many-per-site. Empty for every normal site. Created on both backends
(shared CREATE + pg migration file), copied by the pg copy path.

## 5. Config editor (admin, super_admin)

Extends the existing "Site ↔ Meraki network" editor in the Infra card; one Save covers both:

- **Main table (unchanged):** site → its one network (`sub_site=''`).
- **New "Exploration sub-sites (own-WAN locations)" table:** rows of **Site · Sub-site token ·
  Meraki network · ✕** + an **"+ Add sub-site"** button. The **token is exactly the suffix on
  the report line** (`WAN1 **FETEKRO**`), matched case-insensitively. Sub-sites without their
  own WAN (MANA) get no row.
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

- **Parse the line into `(family, sub_site)`:** match the family keyword as today
  (`wlan/wifi` before `wan`, then `wan1/wan2/servers/lan`); the **normalized remainder** is the
  sub-site token. `WAN1 FETEKRO → {wan1, FETEKRO}`; plain `WAN1 → {wan1, ''}`;
  `LAN MANA → {lan, MANA}`.
- **`buildFills` matches by family AND sub_site:**
  - **WAN + any sub_site** → match the wan snapshot row by `(uplink, sub_site)`; the fill
    descriptor gains a `sub_site` field.
  - **LAN/WLAN/Servers + non-empty sub_site** → **no fill** (no correct per-sub-site source);
    the cell stays blank + editable.
  - **LAN/WLAN/Servers + empty sub_site** → matched by family, exactly as today.
- **Client mirror** (`_serviceToFill`) extends identically: parse `(family, sub_site)` per
  rendered row, match the fill where `family` **and** `sub_site` agree. Fills only empty cells;
  typed overrides untouched.

Net: the Exploration report's `WANx <subsite>` cells fill from each sub-site's network; the
LAN/WLAN/Servers/Backup sub-site cells stay blank+editable; every normal report is byte-for-byte
unchanged (`sub_site=''`).

## 8. WAN Health dashboard (`services/wanDashboard.js` + wan-health.html) — second slice

- `latestPerSite`: still groups by site; uplink cells carry `sub_site`. Normal sites render
  unchanged; Exploration shows **sub-site sub-groups** (`FETEKRO wan1/wan2`, `TANDA …`, …).
- `trendSeries`: keyed by `(sub_site, uplink)`; series labelled with the sub-site prefix when
  non-empty. The trend selector picks the site; Exploration's chart shows one line per
  sub-site-uplink.
- Both stay pure; the only change is "group key gains `sub_site`."

## 9. Testing

- **Pure:** `wanDashboard` sub_site grouping; `opmReportFill` parse `(family, sub_site)` +
  WAN-by-sub_site + infra-with-token→no-fill; existing behaviour for `sub_site=''`.
- **Sync:** `netToTargets` fans a shared network to two targets from one fetch; unmapped logs.
- **Store:** `wan_subsite_networks` reader/writer round-trip; the `sub_site` migration (existing
  rows → `''`, sub-site rows coexist); upsert keyed on the new PK.
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
| `reports-db.js` | `sub_site` column + PK (sqlite rebuild + pg migration); `wan_subsite_networks` table; `_WAN_SNAP_*`/`upsertWanSnapshots`/`getWanSnapshots` carry `sub_site`; `listWanSubsiteNetworks`/`setWanSubsiteNetworks` (dual-backend). |
| `db/postgres/reports/008_wan_link_snapshots.sql` + a new migration file | new-PK shape + `wan_subsite_networks` CREATE. |
| `tools/meraki/sync-wan.js` | `siteByNet` → `netToTargets`; derive-once/row-per-target. |
| `services/opmReportFill.js` | parse `(family, sub_site)`; `buildFills` matches by `(uplink, sub_site)`; infra-with-token → no fill. |
| `services/wanDashboard.js` | `latestPerSite`/`trendSeries` gain the `sub_site` group key. |
| `routes/opmanager.js` | `mappings` GET/PUT carry `subsites`. |
| `public/reports.html` | sub-site editor table; `_serviceToFill` mirror parses `(family, sub_site)`. |
| `public/wan-health.html` | sub-site sub-groups + labelled trend. |
| `tests/*` | as §9. |
