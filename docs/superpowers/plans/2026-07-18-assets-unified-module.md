# Unify the 3 Assets pages into ONE tabbed module + a shared Site filter — Plan

**Goal:** Collapse the three Insights nav entries (Assets / Assets — Hygiene / Assets — Finance & Licences) into **one "Assets" module** with internal tabs, driven by **one shared filter bar** (Site · State · Product Type · Manufacturer · search). Each asset carries a `site`, so filtering per site (and the other dimensions) applies across tabs.

**Architecture:** `public/assets.html` becomes the module shell — one `<head>` (tokens/brand/Chart.js-once/auth/shell), a tab bar, a shared filter bar, and three tab panes holding the migrated content of the current three pages. Ids namespaced per pane (`inv-`/`hyg-`/`fin-`) to avoid collisions; each pane's logic lazy-inits on first activation and re-fetches on filter change. Backend routes are UNCHANGED — this is a pure front-end consolidation.

**Branch:** `feat/assets-unified-module` (from `main`).

**Sources (all proven + browser-verified):** `public/assets.html` (Inventory, 441 ln), `public/assets-hygiene.html` (Hygiene dashboard, 623 ln), `public/assets-finance.html` (Finance + Licences + Software compliance, 956 ln). `/api/assets/lookups` → `{sites, states, product_types, manufacturers}`.

---

## Task 0: Build the unified `assets.html` (3 tabs + shared filter) + one nav entry

**Files:** Rewrite `public/assets.html`; Modify `public/_shell.js`; keep `assets-hygiene.html`/`assets-finance.html` as thin redirects. Browser-verify.

- [ ] **Step 1 — shell + tabs + shared filter.** New `public/assets.html`:
  - One `<head>`: `_tokens.css`/brand/`auth.js`/`_shell.js` + Chart.js (cdnjs 4.4.0) ONCE. `<div id="__shell" data-section="performance" data-current="assets">`.
  - `<h1>IT Assets</h1>` + a **tab bar**: `Inventory · Hygiene · Finance & Licences` (buttons, `role="tab"`, one active). Tab state in the URL hash (`#inventory`/`#hygiene`/`#finance`) so a deep-link/refresh lands on the right tab.
  - A **shared filter bar** below the tabs: Site ▾, State ▾, Product Type ▾, Manufacturer ▾, and a search box — populated once from `/api/assets/lookups`. A `filters()` helper returns `{site,state,product_type,manufacturer,q}` (empty = all). Changing any control re-runs the ACTIVE tab's `refresh(filters())`.
  - Three panes: `<section id="pane-inventory" class="tabpane">`, `#pane-hygiene`, `#pane-finance` (only the active one visible).
- [ ] **Step 2 — migrate the three panes.** Move each source page's BODY content (NOT its `<head>`/shell/its own filter bar) into the matching pane, and its `<script>` IIFE into a per-tab module object with `init(f)` (first activation) + `refresh(f)` (filter change), reading the SHARED `filters()` instead of its own dropdowns:
  - **Inventory** (from `assets.html`): the header band + enriched table + Export. It already filters on site/state/product_type/manufacturer/q → wire straight to `filters()`.
  - **Hygiene** (from `assets-hygiene.html`): completeness band + 3 worklist tiles + 3 Chart.js charts + drill + Excel. Its API is `/api/assets/hygiene/*`, which accepts the same filters → pass `filters()`.
  - **Finance & Licences** (from `assets-finance.html`): Finance section (per-site USD + book value + depreciation schedule + computed-vs-SDP), Licences section (family donut + expiry tiles + drill), Software compliance section. Pass `filters()` to finance/licences (`site` applies); **the Software compliance section is fleet-wide (no site dimension) — apply only `manufacturer`/`q`, and show a small "fleet-wide" note next to it.**
  - **Namespace ids**: prefix every `id=` that could collide (`drillTitle`, chart canvas ids, table bodies, tiles) with `inv-`/`hyg-`/`fin-`. Each pane's script references its own prefixed ids. **Chart.js**: give each canvas a unique id and keep each pane's `Chart` instances in that pane's module (destroy+recreate on refresh as the source pages already do). Reuse the shared page CSS classes (they're consistent across the 3 pages) — only rename ids, not utility classes, unless a class rule actually conflicts.
  - **Lazy-init**: on first activation of a tab, call its `init(filters())`; subsequent activations + filter changes call `refresh(filters())`. Inventory is the default tab → init on load.
- [ ] **Step 3 — nav.** `public/_shell.js`: remove the `assets-hygiene` and `assets-finance` children; keep the single `assets` entry (label "Assets", icon `hard-drive`). (Leave the `ICON_LIB` keys — harmless.)
- [ ] **Step 4 — old routes → redirect.** `public/assets-hygiene.html` + `public/assets-finance.html`: replace each with a tiny redirect to `assets.html#hygiene` / `assets.html#finance` (a `<script>location.replace('assets.html#hygiene')</script>` page) so existing bookmarks land on the right tab. (Keep the server routes; just change the file bodies.) `_htmlCache` still serves them.
- [ ] **Step 5 — VERIFY IN BROWSER (mandatory — this is the whole deliverable).** `preview_start` sdp-dashboard (3459), mint an admin PG session, seed a handful of assets (varied site/state/product_type + finance cols + acquisition_date) + a couple `software_licenses` + `software` rows into the sqlite `assets.db`, set `xof_usd_rate`, **restart (stop+start — `_htmlCache`)**. Load `/assets.html`:
  - The tab bar shows 3 tabs; Inventory is active + its table renders.
  - Click **Hygiene** → completeness band + worklist tiles + 3 charts render; **Finance & Licences** → finance table + book-value/schedule charts + licence donut/tiles + software compliance tiles all render.
  - The **shared Site filter**: pick a site → the ACTIVE tab re-fetches to that site (verify Inventory narrows, Hygiene narrows, Finance per-site narrows). Try State/Product Type/Manufacturer/search too.
  - Switching tabs preserves the current filter; the software compliance section shows its "fleet-wide" note.
  - `read_console_messages` → **ZERO errors** (a merge collision = Uncaught error). Each tab's Chart.js renders without "Canvas is already in use" (unique ids + destroy-on-refresh).
  - `assets-hygiene.html` + `assets-finance.html` redirect to the right tab.
  - Screenshot each tab (or DOM-read evidence if screenshots time out).
  - Fix any collision/broken tab/duplicate-chart error before finishing.
- [ ] **Step 6 — commit:** `feat(assets): unify Inventory/Hygiene/Finance into one tabbed module + shared site filter`.

## Task 1: Regression + CLAUDE.md + finish

- [ ] **Step 1 — regression.** Backend is untouched, so `node --test --test-force-exit tests/assets-*.test.js tests/await-precedence.test.js` stays green (the pages have no tests; the routes they call are unchanged). Confirm nothing red. A `node -e "new Function(...)"` on the 3 HTML files isn't reliable (inline JS in HTML) — the browser verify in Task 0 is the real gate.
- [ ] **Step 2 — CLAUDE.md** Current-State entry (2026-07-18) + a Known-Pitfalls row: the 3 Assets pages are unified into one tabbed `assets.html` (Inventory/Hygiene/Finance panes, ids namespaced `inv-`/`hyg-`/`fin-`, lazy-init per tab, one shared `/api/assets/lookups` filter bar driving the active tab); `assets-hygiene.html`/`assets-finance.html` are now redirect stubs → `assets.html#hygiene`/`#finance`; the nav has ONE Assets entry. Software compliance is fleet-wide (site filter N/A). Point at this plan.
- [ ] **Step 3 — commit**, then finish-a-development-branch (merge is the controller's call).

---

## Done criteria
- [ ] ONE "Assets" nav entry; `assets.html` has 3 working tabs (Inventory/Hygiene/Finance & Licences).
- [ ] One shared filter bar (Site + State + Product Type + Manufacturer + search) drives the active tab; per-site filtering works across tabs.
- [ ] No id/CSS/Chart collisions; zero console errors; **browser-verified all 3 tabs + the filter**.
- [ ] Old page URLs redirect to the right tab; backend unchanged; assets test suite green.
