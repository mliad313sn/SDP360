# Risk Register Export — Handover

**Status**: Live in production · v1 shipped 2026-05-30
**Branch**: `claude/busy-kirch-2a4176`
**Tip commit**: `3197c30` (move admin UI into reports.html#admin card)
**Owner module**: `risk-register-export.js` (single-file)

This document is the canonical handover for the Risk Register Occurrence
export feature. Read this first when onboarding to the feature, fixing
a bug, or extending it.

---

## What the feature does

Generates the monthly Risk Register Occurrence sheet (.xlsx) from SDP
(Zoho Desk) incident data. Aggregates tickets per **Site × Risk Domain**
into a 51-row spreadsheet matching the layout the operations team
already uses for their monthly risk review.

- **Trigger**: 📥 Export Risk Register button on the Helpdesk dashboard
  (Monthly view only).
- **Endpoint**: `GET /api/risk-register-export?month=YYYY-MM` —
  authenticated, returns an .xlsx Buffer.
- **Output**: `RiskRegister_Occurrence_YYYY-MM.xlsx` (~16 KB).

---

## Architecture at a glance

```
Browser (index.html monthly view)
  └─ exportRiskRegister()  ── X-Dash-Key header  ──┐
                                                    ▼
Server (server.js around line 2440)
  └─ /api/risk-register-export
     └─ risk-register-export.js
         ├─ loadOccurrencesFromDB(db, month)
         │   ├─ SELECT site, category, sub_category,
         │   │         request_type, impact
         │   │   FROM request_records
         │   │   WHERE created_time >= ? AND < ?
         │   │     AND request_type LIKE '%Incident%'
         │   │     AND COALESCE(category,'') != 'Inspection'
         │   │
         │   ├─ getSiteAliases(db)         ── reads rr_site_aliases
         │   │
         │   └─ for each row:
         │       ├─ resolveSite(raw, aliases)     → HGO / MGO / …
         │       └─ classifyIncident(rec)          → 1 of 5 domains
         │
         └─ generateRiskRegisterExcel(month, occurrences)
             └─ SheetJS CE → Buffer

Admin UI (reports.html#admin → Risk Register card, super_admin only)
  └─ Four API routes under /api/risk-register-config/*
     ├─ GET    /aliases           list current mappings
     ├─ GET    /sites             canonical short codes (dropdown)
     ├─ POST   /aliases           upsert (validates code against SITES)
     ├─ DELETE /aliases/:label    remove
     └─ GET    /unmapped?month=…  unmapped SDP labels in month's incidents
```

---

## File map

| File | Why it exists |
|---|---|
| `risk-register-export.js` | The whole feature in one module: classifier, SQLite reader, xlsx writer, admin CRUD helpers, lazy schema init |
| `server.js` (around line 2440) | Routes: 1 export + 4 admin config |
| `public/index.html` (search "Risk Register") | Export button + `exportRiskRegister()` client function |
| `public/reports.html` (search "RISK REGISTER") | Admin card markup + `loadRrAliases()` / `openRrAliasModal()` / `submitRrAlias()` / `deleteRrAlias()` / `loadRrUnmappedSites()` |
| `reports-db.js` | Added `impact TEXT` to `request_records` + idempotent ALTER migration |
| `zoho-sync.js` | Reads `r['Impact']` from Zoho row + writes to the column |

---

## Five risk domains (first-match-wins)

| # | Label (column C) | Cat → Sub-category matches |
|---|---|---|
| 1 | Unavailability of Internet | `Network & Internet Access / Network issues` + `Network / WAN` |
| 2 | Unavailability of the mobile phone | `Mobile & Communication Services / 3G/4G Internet & GSM-SIM` |
| 3 | Unavailability of electrical power | `IT Infrastructure / Power & UPS` |
| 4 | Infrastructure unavailability (FW, files, data, mail, etc.) | 11 cat/sub combos under IT Infrastructure, Enterprise Applications, Email, Network & Internet Access |
| 5 | Radio system unavailability | `Network & Internet Access / Radio / Telecom` |

Exact list is in `DOMAIN_RULES` constant — edit there to extend.

---

## Filtering rules

**Excluded**:
- `category = 'Inspection'` (audit records, not incidents)
- `request_type` doesn't contain `Incident` (only Incident + Major Incident counted)
- `impact = 'Individual'` (user-level, not operational)
- Site not on the Risk Register (`resolveSite(site) === null`)
- No domain rule matches the (category, sub_category) combo

**Included**:
- Everything else — including `impact = NULL`

**Why NULL impact is kept**: ~91% of historical SDP tickets carry NULL
because the Impact field was only recently added in Zoho. Excluding NULL
makes historical exports show zero everywhere. Diagnostics surface
`classified_with_null_impact` so the operator knows how much of the
count is impact-uncertain. As Zoho data catches up, NULL share shrinks
naturally.

---

## Site alias mapping (SDP → register codes)

The 10 canonical site codes in column B of the export:

```
IGO · SGO · MASSAWA · HGO · KGO · MGO · EXPLO · OUAGA OFF1 · EMSA · SML
```

SDP uses full mine names. The mapping table `rr_site_aliases` (in
`reports.db`) translates them:

| SDP `site` value | Register code |
|---|---|
| HOUNDE | HGO |
| MANA | MGO |
| ITY | IGO |
| KALANA | KGO |
| Sabodala | SGO |
| LAFIGUE, LAFIGUE - SML | SML |
| Massawa, MASSAWA | MASSAWA |
| Ouagadougou | OUAGA OFF1 |
| Fetekro Exploration Office, Exploration CI | EXPLO |

`EMSA` row renders with Occurrence = 0 — no SDP label maps to it yet.

**Off-register sites** (silently excluded — not mines): `LONDON`, `Dakar`,
`ABIDJAN`, `ASSAFO`, and any other corporate office / regional code.
They appear in the admin card's "Unmapped sites this month" strip so
super_admins can verify they're intentionally excluded.

**Schema**:
```sql
CREATE TABLE rr_site_aliases (
  sdp_label  TEXT PRIMARY KEY,
  code       TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT
);
```

Auto-seeded on first call with `DEFAULT_SITE_ALIASES` (the 12 entries
above) via `_initConfigSchema(db)`. Idempotent — safe to call N times.

---

## Output spreadsheet

**Layout**: 51 rows (1 header + 10 sites × 5 domains).

| Col | Header | Source |
|---|---|---|
| A | Dates | Last day of selected month (real Date, `yyyy-mm-dd` format) |
| B | Site | One of 10 canonical codes |
| C | Liste des risques Majeurs | Domain label |
| D | Source | Spec-defined static text per domain |
| E | Actions(préventives & correctives) | Spec-defined static text per domain |
| F | Effecacite actuelle(%) | 0 (spec: "Leave empty") |
| G | Effecacite Cible(%) | 0 (spec: "Leave empty") |
| H | Commentaires | empty |
| I | Occurrence | Aggregated ticket count |

**What renders correctly (SheetJS CE)**:
- Cell values + types (text, number, date)
- Column widths
- Row heights (header row taller for wrapped labels)
- Date number format (`yyyy-mm-dd`)

**What's silently dropped (Pro-only)**:
- Cell fill colors (red/blue/green header bands)
- Bold + white text
- Borders
- Frozen header pane

The spec's coloured header bands and row banding are lost. Data values
are byte-perfect. Users can apply Excel's "Format as Table" once to
restyle if they want — layout is stable month-to-month.

---

## Diagnostics

Every export returns an `X-Risk-Register-Diag` response header AND
console-logs to pm2:

```json
{
  "total_incident_rows": 251,
  "classified": 187,
  "classified_with_null_impact": 165,
  "skipped_no_site": 0,
  "skipped_unknown_site": 47,
  "skipped_unknown_site_top": ["LONDON (22)", "ABIDJAN (19)"],
  "skipped_non_operational": 11,
  "skipped_no_domain": 6
}
```

### How to read

| Field | Means | What to check if abnormal |
|---|---|---|
| `total_incident_rows` | Rows matched the WHERE clause | If 0, no incidents synced for the month. Force a re-sync. |
| `classified` | Made it into the export | If 0 with non-zero total, the site mapping is wrong OR every row got filtered out. |
| `classified_with_null_impact` | Subset of classified — Impact was NULL | If close to `classified`, the Impact field isn't populated. Expected for historical months. |
| `skipped_unknown_site` | Site not in `rr_site_aliases` | If high, SDP has new site labels. Open admin card → Unmapped sites → add mappings. |
| `skipped_unknown_site_top` | Top 5 unmapped labels by count | Use as a worklist for the admin UI. |
| `skipped_non_operational` | Explicit `Individual` impact | Expected — user-level issues, not operational. |
| `skipped_no_domain` | In-scope but no rule matched | If high, lots of incidents in categories we don't track. Might mean DOMAIN_RULES needs an extension. |

### Where to see them

- Browser DevTools Console: `[risk-register] diagnostics: { ... }`
- Browser DevTools Network → response → `X-Risk-Register-Diag` header
- pm2 logs (prod host):
  ```
  pm2 logs endeavour-dashboard --lines 50 --nostream | findstr risk-register
  ```

---

## Admin UI walkthrough

`reports.html#admin` → scroll past Users / Sites / Departments to the
**🛡 Risk Register — Site Code Mapping** card. Hidden for non-super-admin
roles.

### Typical workflow (monthly)

1. Open the card. The aliases table shows current mappings; the
   "Unmapped sites for [previous month]" strip auto-loads.
2. Each chip in the strip = a SDP label appearing in last month's
   incidents that isn't mapped, with the ticket count.
3. Click **+ Map** on a chip → opens the New Mapping modal with the
   label pre-filled. Pick a register code from the dropdown → Save.
4. Mapping takes effect **immediately** — next export uses it.
5. Re-export the Risk Register from the helpdesk dashboard to verify.

### Edit / delete

- **Edit** keeps the SDP label locked (it's the primary key) and lets
  you change the register code.
- **Delete** removes the mapping. Next export will count that label
  as `skipped_unknown_site`.

### Audit trail

- Every mutation logs `[rr-config] upsert HOUNDE → HGO by <username>`
  or `[rr-config] delete "HOUNDE" by <username>` to pm2.
- DB stores `updated_at` (timestamp) + `updated_by` (username) per row.

---

## RBAC

| Role | Export .xlsx | View mappings (API) | Edit mappings |
|---|---|---|---|
| viewer | ✓ | — | — |
| editor | ✓ | — | — |
| admin | ✓ | — | — |
| executive | ✓ | — | — |
| super_admin | ✓ | ✓ (UI + API) | ✓ |

`GET /api/risk-register-config/aliases` and `GET /sites` are open to any
authenticated user (so the export-authors can sanity-check the mapping).
Mutations (`POST`, `DELETE`) are super_admin only — gated both
server-side (`server.js` middleware) and client-side (card hidden).

---

## Troubleshooting

### Export returns 401 Unauthorized

The fetch is missing the `X-Dash-Key` header. Pattern is at
`public/index.html:394-400` (the `pgGet` helper). When adding new
fetches, use the same auth pattern:

```js
const hdrs = window.__ak
  ? { 'X-Dash-Key': window.__ak }
  : (window.__authToken ? { 'x-report-token': window.__authToken } : {});
```

### Export returns "Cannot find module 'X'"

A dependency is missing on prod. The Risk Register module only requires
`xlsx` (SheetJS CE, already installed for the meetings module) and
`better-sqlite3` (always installed). If you see this error in pm2 logs:

```cmd
pm2 logs endeavour-dashboard --lines 30 --nostream | findstr risk-register
```

Most likely cause: someone ran `npm install/uninstall ... --ignore-scripts`
and the package tree was reconciled. Recovery for better-sqlite3 is
`_recover_better_sqlite3_prod.cmd`. For xlsx, copy `node_modules/xlsx/`
from the dev box (pure JS, no native binding).

### Export shows zero in every cell

Either:

1. **Site mapping is wrong** — open admin card, check "Unmapped sites
   this month" strip. If high counts, add aliases.
2. **Impact column is empty across the board** — run on prod:
   ```cmd
   node -e "const D=require('better-sqlite3'); const d=new D('data/reports.db',{readonly:true}); console.log(d.prepare('SELECT COUNT(*) c, COUNT(impact) i FROM request_records').get())"
   ```
   If `i` is 0 or tiny, force a re-sync:
   ```cmd
   curl -X POST -H "X-Dash-Key: <key>" "https://itops-dashboard.edv-ops.com/api/sync/trigger/requests?force=true"
   ```

### "The system cannot find the file specified" from `node -e "…"`

cmd.exe parses bare `<` (inside double-quoted strings with embedded `\"`)
as a stdin redirect operator. Symptom looks like Node failed but it's
a cmd.exe parse error before Node starts. **Fix**: write the script to a
`.js` file and run `node script.js`, or rewrite SQL with
`BETWEEN ... AND ...` instead of `<`.

### Admin card doesn't appear under Admin

The card is hidden for non-super_admin roles. Check:
- Currently logged-in user's role: `console.log(window.__authUser)` in DevTools.
- If role is `super_admin` but card still hidden: hard refresh (`Ctrl+Shift+R`)
  to bypass `_htmlCache`. The card display is set in JS at
  `loadAdminPage()`.

### Adding a new mine / site to the register

1. **If the new code already exists** in `SITES` (e.g. a previously
   empty `EMSA` now has data): just add the alias via the admin UI.
2. **If a new register code is needed**: add it to the `SITES` array
   in `risk-register-export.js`, deploy + pm2 reload. Then admins can
   map SDP labels to it via the UI.

### Adding a new domain rule

Edit `DOMAIN_RULES` in `risk-register-export.js`. The structure is:

```js
{
  domain: '4.Infrastructure unavailability (FW, files, data, mail, etc.)',
  matches: [
    { cat: 'IT Infrastructure', sub: 'Servers' },
    // ...add new {cat, sub} entries here
  ],
}
```

First-match-wins, so order matters for incidents that could fit multiple
domains. Not exposed via admin UI — too risky for a simple form. Code
deploy required.

---

## Companion recovery scripts

Two .cmd scripts ship with the feature, sitting at the worktree root:

### `_recover_better_sqlite3_prod.cmd`

Emergency: rebuild better-sqlite3 native binding on prod after an npm
operation breaks it. Symptom in pm2 logs:

```
Error: Could not locate the bindings file. Tried:
 → C:\Apps\SDP-Dashboard\node_modules\better-sqlite3\build\…
```

Run from prod cmd.exe at `C:\Apps\SDP-Dashboard\`. Bypasses corporate
SSL inspection for the prebuild download via
`NODE_TLS_REJECT_UNAUTHORIZED=0` (per-process only, not persisted in
npm config).

### `_uninstall_exceljs_prod.cmd`

Optional cleanup: removes the unused `exceljs` + 80 transitive packages
from prod after the Risk Register feature switched to `xlsx` (which was
already installed). The exceljs packages were left behind from an
earlier install attempt; they're inert (nothing requires them) but
removing them shrinks the attack surface by 4 npm-audit findings.

Safe to run anytime. Uses `npm uninstall exceljs --ignore-scripts` to
protect better-sqlite3 from being rebuilt.

---

## Security stance

- **Server-side enforcement**: GET endpoints accept any authenticated
  user (read-only sanity check); POST/DELETE require super_admin role.
- **Client-side enforcement**: Admin card hidden for non-super_admin
  roles in `loadAdminPage`.
- **Defense in depth**: Even if someone hand-crafts a POST, the server
  rejects without the super_admin role.
- **Validation**: `upsertAlias()` rejects codes not in the canonical
  `SITES` set, preventing typos like `HGO1` from entering the DB.
- **Audit trail**: Every mutation logs the actor + timestamp.
- **Resilience**: If `rr_site_aliases` is unreachable / corrupted,
  `getSiteAliases` falls back to `DEFAULT_SITE_ALIASES`. Exports keep
  working with the hardcoded defaults rather than failing.
- **No new transitive dependencies**: switched from `exceljs`
  (80 packages, 4 audit findings) to `xlsx` (already installed,
  audited as part of the meetings module).

---

## Open follow-ups (not blockers)

1. **`exceljs` packages still on prod** — inert but worth cleaning up.
   Run `_uninstall_exceljs_prod.cmd` when convenient.
2. **`impact` column backfill** — when SDP catches up and historical
   tickets are tagged retroactively, the `classified_with_null_impact`
   count will drop naturally. No action required.
3. **`EMSA` row always shows 0** — no SDP label maps to it yet. When
   Endeavour starts tagging tickets under a consistent EMSA label, an
   admin adds the alias via the UI.
4. **Domain rule auditing** — `skipped_no_domain` count could surface
   categories that should be added to a domain. Worth periodic review
   with the operations team.

---

## Quick links

- Helpdesk export button: `https://itops-dashboard.edv-ops.com/` →
  Monthly view → 📥 Export Risk Register
- Admin card: `https://itops-dashboard.edv-ops.com/reports.html#admin`
  (super_admin only) → scroll to bottom
- Help page: `https://itops-dashboard.edv-ops.com/help.html#en-3-5`
  (or `#fr-3-5`)
