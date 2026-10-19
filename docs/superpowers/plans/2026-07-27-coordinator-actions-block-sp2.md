# SP2 — Coordinator Email: Open-Actions-by-Theme Block + Hub Link — Plan

**Goal:** The monthly coordinator email gains an "Open actions" block — per-theme
counts (Meetings / Inspections / Report follow-ups) + oldest — with a link to the
site's Actions Register hub, so a coordinator knows what's open and where to close
it.

**Architecture:** A new optional `actionsSection` block in `coordinator.js`
(spread only when `d.actions` present — the assetEffort pattern → goldens stay
byte-identical); data via a new `openActions` deps binder reusing the pure
`buildSiteActions`; the sender injects `base_url` from `public_base_url`. Facts in
CLAUDE.md; extends the SP1 site-actions work.

---

### Task 1: `actionsSection` block (pure) + unit test

**Files:** `services/reportTemplates/coordinator.js` (new `actionsSection` fn + conditional spread into `content`); Test `tests/coordinator-actions-block.test.js`.

- [ ] Test: `composeCoordinator({ ...minimal, site_code:'HGO', base_url:'https://x', actions:{ meetings:{count:3,oldest:40}, inspection:{count:1,oldest:10}, report:{count:2,oldest:null}, total:6 } })` → `htmlBody` contains "Open actions", the three theme labels + counts, and a link `href="https://x/site-actions.html?site=HGO"`. With `base_url:''` → the counts render but NO `<a href` for the hub. With `actions` absent → block absent (byte-golden safe).
- [ ] Run → FAIL.
- [ ] Implement `actionsSection(actions, baseUrl, siteCode)` using `_primitives` (FONT, chip, MUTED, sectionTitle if present). Spread `...(d.actions ? [actionsSection(d.actions, d.base_url, d.site_code)] : [])` into `content` (after `recommendedSection`, before assetEffort).
- [ ] Run → PASS. Commit.

### Task 2: `openActions` deps binder + siteReport wiring

**Files:** `services/siteReportDeps.js` (new binder), `services/siteReport.js` (`_safe` call + include in return); Test `tests/site-report-actions.test.js` (or extend an existing siteReport test).

- [ ] Test: a deps stub whose `openActions` returns a shaped object → `siteReportData` includes `actions` in the output; a deps object WITHOUT `openActions` → `actions` is null (no throw).
- [ ] Run → FAIL.
- [ ] Binder `openActions(code, p)`: `resolve(code)`→site_id; `meetingsDb.listActions({site:code})`, `inspectionDb.listActions({site:code})`, `reportsDb.getSiteOpenReportActions(site_id).actions`; feed `buildSiteActions({...,asOf})`; return `{ meetings:{count,oldest}, inspection:{count,oldest}, report:{count,oldest}, total }` (null when unresolved). `siteReport.js`: `_safe(() => deps.openActions ? deps.openActions(siteCode, period) : null, null, 'openActions')` + add `actions` to the returned object.
- [ ] Run → PASS. Commit.

### Task 3: sender injects base_url + regression + docs + finish

**Files:** `services/sendCoordinator.js` (inject `data.base_url`); `CLAUDE.md`.

- [ ] `sendCoordinator.js` (before `composeCoordinator(data)`): `data.base_url = String((cfg && cfg.public_base_url) || '').replace(/\/+$/, '');`.
- [ ] Run: the two monthly goldens (`report-template-primitives`) — **still byte-identical, NOT regenerated** — + `report-template-coordinator` + the new block test + `await-precedence` → green.
- [ ] Update `CLAUDE.md`; commit; merge to `main`; build ZIP.
