# Asset Sub-project D — Hardware refresh / health worklist — Plan

**Goal:** A hardware-health worklist (low RAM · full disk · refresh-due · no real monitor) on the unified Assets module, from data the Foundation already syncs — plus a **trustworthy external-monitor count** (camera/virtual denylist). No live-API, no new sync.

**Architecture:** Additive readers on `assets-db.js` (dual-backend), routes, and a **4th "Hardware" tab** on the unified `public/assets.html`. Mirrors the Hygiene pattern. Backend uses `assets` (has `ram_total_gb` via memory join, `system_disk_free_pct` via C: drive, `months_since_acquisition`) + `asset_monitors` (`monitor_type` for the denylist).

**Branch:** `feat/assets-hardware-health` (from `main`).

**Data facts (Foundation):** `ram_total_gb` = SUM(asset_memory.capacity_gb); `system_disk_free_pct` = C: drive free% (stored raw, may be `'94%'` — the enriched `_coerceEnriched` strips `%`); `monitor_count` = RAW COUNT(asset_monitors) which **over-counts** (includes `Intel(R) AVStream Camera`, `Integrated Webcam`, `HyperVMonitor`, `Parallels Vu`, `No Monitor`). The trustworthy external-monitor count needs the denylist over `asset_monitors.monitor_type`.

---

## Ground rules
- `ASSETS_BACKEND=sqlite|postgres`; tests sqlite. New dual-backend readers dispatch first-statement; callers await (`tests/await-precedence.test.js`). Reuse `_assetWhere` for the shared filters.
- Numeric coercion IN JS (the RAM/disk/monitor columns are TEXT; `system_disk_free_pct` may carry `'%'`) — a `toNum` helper, no SQL CAST on the raw text columns (pg-safe).
- Commit after every green step. Tests: `node --test --test-force-exit tests/<file>.test.js`.

---

## Task 0: Hardware-health readers

**Files:** Modify `assets-db.js`; Test `tests/assets-hardware-readers.test.js`.

- [ ] **Step 1 — failing test.** Seed `assets` + `asset_memory` + `asset_logical_drives` + `asset_monitors` (via `replaceTable`) for a few machines across 2 sites:
  - M1 (MANA): 4 GB RAM (memory rows summing 4), C: free 5%, months 40, product_type 'Laptop'; monitors: one 'Dell U2419H' (real) + one 'Integrated Webcam' (denylisted).
  - M2 (MANA): 16 GB, C: free 60%, months 10, 'Desktop'; monitors: 'HyperVMonitor' only (all denylisted → 0 real).
  - M3 (HGO): 8 GB, C: free 45%, months 70, 'Server'; no monitors.
  Assert `getHardwareHealthSummary({})`:
  - `by_kind.low_ram` counts machines with `ram_total_gb>0 && <8` (M1) — NOT M3 (exactly 8) unless the threshold is `<8`; state the threshold `<8`. `full_disk` counts free%<10 (M1). `refresh_due` counts months≥cycle (Laptop 36→M1; Server 60→M3). `no_real_monitor` counts machines with 0 real monitors after the denylist (M2: only HyperVMonitor→0; M3: no monitors→0; M1: has a real Dell→has 1). So no_real_monitor = M2, M3.
  - per-site rollup; `monitors: {with_real, avg_real}` sane.
  - `getHardwareHealthExceptions('low_ram',{})` returns M1; `'full_disk'` M1; `'refresh_due'` M1+M3; `'no_real_monitor'` M2+M3; `'bad'` **throws**. Rows carry asset_name/site/ram_total_gb/system_disk_free_pct/real_monitor_count/months_since_acquisition (no money). Site filter narrows.
  - **The real-monitor count**: a helper/subquery counting `asset_monitors` where `lower(monitor_type)` is NOT LIKE any of `%camera%`,`%webcam%`,`%hypervmonitor%`,`%parallels%`,`%no monitor%` (and monitor_type not null/empty). Assert M1 real=1 (Dell, webcam excluded), M2 real=0.
- [ ] **Step 2** FAIL. **Step 3 — implement**: a `HARDWARE_KINDS` map (`low_ram`/`full_disk`/`refresh_due`/`no_real_monitor`, throw on unknown). `getHardwareHealthSummary(filters)` + `getHardwareHealthExceptions(kind, filters)` dual-backend (dispatch first-statement). SELECT the assets (via `_assetWhere`) + the enriched hardware fields (reuse the `getEnrichedAssets` correlated subqueries for ram_total_gb/system_disk_free_pct + a NEW `real_monitor_count` correlated subquery with the denylist `NOT LIKE` chain + `_refreshCycleMonths` for refresh_due) — OR fetch and compute in JS with a `toNum` helper (mirror the finance reader; safest for the `'94%'` free-pct). Thresholds: low_ram `ram>0 && ram<8`; full_disk `free_pct != null && free_pct<10`; refresh_due `months >= cycle(product_type)`; no_real_monitor `real_monitor_count==0`. Export `HARDWARE_KINDS, getHardwareHealthSummary, getHardwareHealthExceptions`.
- [ ] **Step 4** PASS. **Step 5** `await-precedence` 5/5 + existing assets readers green. **Step 6 — commit:** `feat(assets): hardware-health readers (low RAM/full disk/refresh-due/real monitors)`.

## Task 1: Routes

**Files:** Modify `server.js`; Test `tests/assets-hardware-routes.smoke.test.js`.

- [ ] **Step 1 — failing smoke** (copy the hygiene-routes smoke). Assert: `/api/assets/hardware/summary` → 200 with `by_kind`; `/api/assets/hardware/exceptions?kind=low_ram` → 200 array; `?kind=bad` → **400**; `?kind=low_ram&q=' OR 1=1` → 200; `/api/assets/hardware/export.xlsx?kind=all` → 200 PK-magic; no-session → 401/403.
- [ ] **Step 2** FAIL. **Step 3 — implement** 3 routes next to `/api/assets/hygiene/*` (`requireReportSession`; unknown kind pre-validated → 400; `tableExcel.buildWorkbook`; whitelisted filters). **Step 4** PASS. **Step 5** await-precedence 5/5 + syntax + hygiene smoke green. **Step 6 — commit:** `feat(assets): /api/assets/hardware/{summary,exceptions,export.xlsx}`.

## Task 2: Hardware tab on the unified module + browser verify

**Files:** Modify `public/assets.html`. Browser-verify.

- [ ] **Step 1** — add a **4th tab "Hardware"** to the unified assets module (the tab framework, shared filter, and pane pattern already exist — mirror the Hygiene pane): a `#pane-hardware` + a `HW_PANE` module (`init(f)`/`refresh(f)` reading the shared `filters()`), ids prefixed `hw-`, its own Chart canvas ids. Tiles: **Low RAM (<8 GB)** · **Full disk (<10% free)** · **Refresh due** · **No real monitor** — each clickable → drill `/hardware/exceptions?kind=`. A per-site table + a small note explaining the monitor denylist (raw count over-counts — cameras/virtual excluded). Per-kind + Export-all Excel. Add `#hardware` to the URL-hash tab set. Update the `assets-hygiene.html`/`assets-finance.html` redirect set only if needed (no).
- [ ] **Step 2 — VERIFY IN BROWSER (mandatory).** `preview_start` sdp-dashboard, mint admin PG session, seed a few assets + memory + drives + monitors (incl. a webcam/HyperV monitor + a real Dell) into the sqlite `assets.db`, **restart (stop+start — `_htmlCache`)**, load `/assets.html`, click **Hardware**: confirm the 4 tiles show real counts, a tile-click drill loads (Low RAM shows the 4 GB machine; No real monitor shows the webcam-only machine), the shared Site filter narrows the tab, Export points at the xlsx, **zero console errors**. Screenshot/DOM-read.
- [ ] **Step 3 — commit:** `feat(assets): Hardware health tab on the unified Assets module`.

## Task 3: Regression + CLAUDE.md + finish

- [ ] **Step 1 — regression** `node --test --test-force-exit tests/assets-*.test.js tests/await-precedence.test.js` → green; nothing new red.
- [ ] **Step 2 — CLAUDE.md** Current-State entry (2026-07-18, D) + Known-Pitfalls rows: hardware-health worklist (low_ram<8 / full_disk<10% / refresh_due / no_real_monitor) on synced data; **the RAW `monitor_count` over-counts** (includes cameras/virtual `Intel AVStream Camera`/`Integrated Webcam`/`HyperVMonitor`/`Parallels Vu`/`No Monitor`) → the trustworthy count applies a `monitor_type` denylist; **C-3 (which-machines drill) is BLOCKED** — the AP installations view (002075) times out even filtered to one software_id (recon 2026-07-18: >2 min for 24 rows — AP doesn't push the criteria down), so the live drill is deferred; the viable path is a bulk CSV import. Point at this plan.
- [ ] **Step 3 — commit**, then finish-a-development-branch.

---

## Done criteria
- [ ] Hardware-health readers (4 kinds + real-monitor denylist) dual-backend, await-covered; unknown kind → 400.
- [ ] `/api/assets/hardware/*` — filters whitelisted, no 500 on hostile input.
- [ ] Hardware tab on the unified module (4 tiles + drill + Excel + per-site), shared filter applies, **browser-verified**.
- [ ] Full suite green; C-3 documented as blocked (AP view too slow) with the bulk-import path noted.
