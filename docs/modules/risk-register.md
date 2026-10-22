# Module — Risk Register Occurrence export

Moved verbatim from `CLAUDE.md` on 2026-10-22 (SDP-DASH-2.0 step 5, lot 5.5). `CLAUDE.md` is now an index; edit THIS file.

---

## Risk Register Module (v1 — 2026-05-30)

Monthly Occurrence export for the operations Risk Register. Aggregates SDP incident tickets per site × per risk domain into an .xlsx that matches the layout the operations team already uses. Two surfaces:

1. **Export button** on the Helpdesk dashboard (Monthly view) — anyone with dashboard access can generate the report
2. **Admin card** at `reports.html#admin` — super_admin only — edits the site name mapping (SDP free-form labels → register short codes)

### Architecture overview

```
Browser (index.html, Monthly view)
  └─ "📥 Export Risk Register" button
     └─ GET /api/risk-register-export?month=YYYY-MM   (X-Dash-Key required)
        └─ risk-register-export.js
            ├─ loadOccurrencesFromDB(db, month)        — SELECT from request_records
            │   └─ classifyIncident(rec, aliases)      — 5 domain rules, first match wins
            ├─ getSiteAliases(db)                      — reads rr_site_aliases (live)
            └─ generateRiskRegisterExcel(month, ...)   — xlsx (SheetJS CE)

Browser (reports.html#admin)
  └─ "🛡 Risk Register — Site Code Mapping" card  (super_admin only)
     ├─ GET    /api/risk-register-config/aliases       — list
     ├─ GET    /api/risk-register-config/sites         — canonical codes (for dropdown)
     ├─ POST   /api/risk-register-config/aliases       — upsert (super_admin)
     ├─ DELETE /api/risk-register-config/aliases/:lbl  — delete (super_admin)
     └─ GET    /api/risk-register-config/unmapped?month=… — diagnostic
```

### Key files

| File | Purpose |
|---|---|
| `risk-register-export.js` | The whole module. Classifier rules, SQLite reader, xlsx writer, admin CRUD helpers, `_initConfigSchema` for the `rr_site_aliases` table |
| `server.js` (around line 2440) | `/api/risk-register-export` + 4 admin routes under `/api/risk-register-config/*` |
| `public/index.html` (button + `exportRiskRegister()`) | Helpdesk monthly view — the launch button |
| `public/reports.html` (admin card + modal + functions) | Admin UI — search for `// RISK REGISTER` section header |
| `reports-db.js` | Added `impact TEXT` column to `request_records` schema + idempotent ALTER migration |
| `zoho-sync.js` | Added `impact: r['Impact'] \|\| null` to the sync row mapping |

### Five risk domains (first-match-wins classifier)

**Matching is SUB-CATEGORY-driven, mostly category-agnostic** (changed 2026-06-28).
SDP duplicates the same subcategory names (Electrical power & UPS, Radio,
Servers, …) under several parent categories, so a ticket's `category` is
unreliable. Each match object requires every field it specifies
(`classifyIncident` in `risk-register-export.js`):
- `{ sub: 'X' }` — match `sub` under ANY parent category (default; for specific
  subcategory names SDP duplicates across parents).
- `{ cat: 'Y', sub: 'X' }` — STRICT, only under category `Y`. Used for the two
  GENERIC names `System` / `Technical` (Enterprise Applications) so unrelated
  tickets like `ERP Support / System` are NOT pulled into domain 4.

| # | Domain | SDP sub-category matches (state after the 2026-09-02 tuning) |
|---|---|---|
| 1 | Unavailability of Internet | `Network issues` (any parent) · `WAN` kept as a harmless legacy name (no longer in the SDP tree — 0 tickets) |
| 2 | Unavailability of the mobile phone | `3G/4G Internet & GSM-SIM` (any parent) |
| 3 | Unavailability of electrical power | `Electrical power & UPS` (any parent) |
| 4 | Infrastructure unavailability | any-parent: `Servers`, `Data Centers`, `Network`, `Backup`, `Database`, `Cloud Services`, **`Issue Server Email`** (a NEW dedicated sub the user created under Email for server-side outages; the generic `Issue with Email` = individual mailbox issues, NOT matched) |
| 5 | Radio system unavailability | `Radio` (any parent) |

> **Removed from domain 4 on 2026-09-02 (user decision, aligned with the SDP mandatory-comment rule):**
> `Network Configuration`, `VPN (Remote Access Services)`, and the strict `Enterprise Applications /
> System` + `/ Technical` pairs — measured Jun–Aug 2026 as end-user noise (VPN 5 / NetConfig 2 tickets,
> none with Services affected; EA 0). A REAL outage on those still counts through the technician-declared
> **Services affected** field, which takes precedence over this category fallback.

**Risk comment chain (LIVE since 2026-09-02):** SDP UDF `txt_risk_comment` ("Risk comment") is made
mandatory at Resolved/Closed by two Field & Form Rules on the *Issue Reporting_* template (trigger **On
Field Change of Status** — watching the condition field instead would never re-evaluate at resolution) and
is natively mandatory on the Major Incident template. The export summarises those comments into **column H
"Commentaires"** (`#<display_id> — comment`, 160 c/comment, ~700 c/cell, "… (+N autres)") and ships a
**second sheet `Tickets_<month>`** (one row per occurrence: site · domain · **SDP display ID** (never the
18-digit internal id) · subject · date · origin · risk comment) as the operator's aide-mémoire. Tickets
closed before the rule exist without comments → August's column H is legitimately empty; September is the
first fed month.

> **Gotcha (2026-06-28):** the original rules pinned `cat:'IT Infrastructure'`
> for elec/radio AND used the wrong sub names (`Power & UPS`, `Radio / Telecom`)
> → domains 3 & 5 were **0 on every site**. Real SDP names are
> `Electrical power & UPS` and `Radio`, and the subs are duplicated across
> parents → hence category-agnostic matching (with `System`/`Technical` kept
> strict to avoid over-counting). Also the SheetJS date cell rendered the
> **previous day** (e.g. `06-29` for June) from a midnight `Date`; anchoring the
> last-day date at **noon** fixes the off-by-one. Validated on real June-2026
> data (192 incidents → D1=22 · D2=8 · D4=30 · D3=0 · D5=0).

Source/Actions text per domain is fixed (per spec §5) — see `DOMAINS` array in `risk-register-export.js`. Effecacite columns ("Leave empty (0)") are spec-required.

### "Services affected" field takes PRECEDENCE over category (2026-06-29)

SDP additional field **`txt_services_affected`** (a multi-select Check Box,
options Internet / Mobile phone / Electrical power / Infrastructure (FW, files,
data, mail, etc.) / Radio = the 5 domains 1:1) lets the technician **declare**
which risks an incident materialised. It syncs into `request_records.udf_json`
under key **`UDF:Services affected`** as a **comma-joined list of the exact
labels**. ⚠️ The Infrastructure label itself contains commas, so parse by
**keyword** (internet/mobile/electrical/infrastructure/radio), never `split(',')`.

> **Sync fix (2026-06-29):** the requests sync USED to capture `udf_json` **only
> for Major Incidents** (`zoho-sync.js` `_miBase = allRows.filter(_isMajorIncident)`),
> so a regular `Incident`'s Services-affected was silently dropped. Fixed: the
> sync now builds udf via `buildUdfRows(newRows)` → UDFs captured for **every
> changed incident** (extractUdf keeps non-empty only → bounded by the
> incremental set). **A one-time `force=true` requests sync backfills `udf_json`
> across the whole table** (an already-synced incident whose Last Updated Time is
> in the past isn't re-pulled by a normal incremental sync). Tested in
> `tests/zoho-sync-udf.test.js`.

`domainsForIncident(rec)` (in `risk-register-export.js`) resolves an incident's
domain set with this precedence (impact≠Individual + non-Inspection still apply
as the AND gate):
1. **Services affected populated → it WINS** (authoritative, **multi-domain** —
   one incident can count toward several risks, e.g. power outage → Internet +
   Electrical + Radio). The category/sub inference is **NOT** also applied → no
   double-count.
2. Field empty → fall back to the single category/sub classification.

So the *Occurrence* column can now exceed the incident count (1 occurrence **per**
risk materialised — correct for a risk register). Applied to **all months**
(the field is populated back to Jan 2026). Diagnostics expose
`classified_via_services_affected` vs `classified_via_category`. Tested in
`tests/risk-register-classify.test.js` (pure parser + in-memory loadOccurrences).

**Provenance column (col. J "Origine occurrence")**: `loadOccurrencesFromDB` also
returns `sources[site][domain] = { field, category }` (per-cell breakdown, since
a cell aggregates several incidents and can be mixed). `generateRiskRegisterExcel`
emits a trailing column J showing `Services affected` / `Catégorie` /
`Mixte: X SA / Y cat.` per row — so the reader knows which occurrences are
technician-declared vs category-inferred. Additive (columns A-I unchanged).

### Filtering rules

```
EXCLUDED if any of:
  - category = 'Inspection'      (audit records, not incidents)
  - request_type NOT LIKE '%Incident%' (only Incident + Major Incident counted)
  - impact = 'Individual'        (user-level, not operational)
  - resolveSite(site) === null   (site not on the Risk Register)
  - no domain rule matches the category/sub-category combo

INCLUDED:
  - everything else, including impact = NULL (treated as in-scope per
    2026-05-30 decision; 91% of historical rows have NULL impact)
```

### Site alias mapping

`rr_site_aliases` SQLite table (in `reports.db`). Schema:

```sql
CREATE TABLE rr_site_aliases (
  sdp_label  TEXT PRIMARY KEY,
  code       TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT
);
```

Seeded on first call with 12 defaults from `DEFAULT_SITE_ALIASES` in the module:

| SDP label | Register code |
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

Off-register SDP labels (`LONDON`, `Dakar`, `ABIDJAN`, `ASSAFO`, …) are silently dropped — they're corporate / regional offices, not operating mines, not on the Risk Register. Admins see them in the "Unmapped sites this month" strip on the admin card.

`resolveSite()` does case-insensitive fallback for label drift (`HOUNDE ` → still maps to HGO).

### `EMSA` and the canonical SITES list

The 10 canonical site codes are hardcoded in `SITES` in the module:

```
IGO · SGO · MASSAWA · HGO · KGO · MGO · EXPLO · OUAGA OFF1 · EMSA · SML
```

These render as column B of the export. **`EMSA` is included in the column list but has no SDP label mapped to it yet** — Endeavour Mining S.A. doesn't appear in incident tickets under any consistent label as of 2026-05-30. The row renders with Occurrence = 0; when SDP starts producing tickets with an EMSA-mappable site label, an admin adds the alias via the UI and the row populates.

### Output format (SheetJS CE — security-first choice)

| Column | Header | Source |
|---|---|---|
| A | Dates | Last day of selected month (real date object, `yyyy-mm-dd` formatted) |
| B | Site | One of the 10 canonical codes |
| C | Liste des risques Majeurs | Domain label |
| D | Source | Spec-defined static text per domain |
| E | Actions(préventives & correctives) | Spec-defined static text per domain |
| F | Effecacite actuelle(%) | 0 (spec: "Leave empty") |
| G | Effecacite Cible(%) | 0 (spec: "Leave empty") |
| H | Commentaires | empty (spec: "Leave empty") |
| I | Occurrence | Aggregated ticket count for site × domain |

Total rows: 1 header + 10 sites × 5 domains = 51 rows. Output ~16 KB.

**Styling lost on write (SheetJS CE limitation)**: cell fill colors (red/blue/green header bands), bold + white text, borders, frozen pane. Preserved: column widths, row heights, date number format, cell values. Acceptable trade-off — data correctness over aesthetics; users can apply Excel's "Format as Table" once if they want the visual styling back.

### Diagnostics

Every export sets `X-Risk-Register-Diag` response header + console-logs to pm2:

```
{
  total_incident_rows: 251,        // matched the WHERE clause
  classified: 187,                  // ended up in the output
  classified_with_null_impact: 165, // subset — NULL impact still counted
  skipped_no_site: 0,               // site was empty string
  skipped_unknown_site: 47,         // site not in rr_site_aliases
  skipped_unknown_site_top: [       // top 5 by frequency for spotting drift
    'LONDON (22)', 'ABIDJAN (19)', …
  ],
  skipped_non_operational: 11,      // impact == 'Individual'
  skipped_no_domain: 6              // in-scope impact, but no rule matched
}
```

Operators check the diagnostics in:
- Browser DevTools Console: `[risk-register] diagnostics: {...}`
- Browser DevTools Network tab: response header `X-Risk-Register-Diag`
- Prod logs: `pm2 logs endeavour-dashboard --lines 50 --nostream | findstr risk-register`

### Admin UI walkthrough

`reports.html#admin` → scroll past Users / Sites / Departments → "🛡 Risk Register — Site Code Mapping" card (super_admin only — hidden for other roles).

Workflow:
1. Open the card — see existing mappings (sortable by code), plus the "Unmapped sites for [month]" strip
2. Click `+ Map` next to an unmapped label → opens the New Mapping modal pre-filled
3. Choose a register code from the dropdown → Save
4. Effect is **immediate** — next export uses the new mapping (no pm2 reload required)
5. To edit: click Edit on an existing row → modal opens with label locked + code editable
6. To delete: click Delete → confirm prompt → the mapping vanishes; future tickets with that label show up as unmapped again

Audit log: every mutation writes `[rr-config] upsert HOUNDE → HGO by <username>` (or `delete`) to pm2 logs. The DB also stores `updated_at` + `updated_by` per row.

### RBAC

| Role | Export .xlsx | View mappings | Edit mappings |
|---|---|---|---|
| viewer | ✓ | — | — |
| editor | ✓ | — | — |
| admin | ✓ | — | — |
| executive | ✓ | — | — |
| super_admin | ✓ | ✓ | ✓ |

`GET /api/risk-register-config/aliases` is open to any authenticated user (for sanity-checking before generating a report); only super_admin sees the card in `reports.html#admin` and can mutate.

### Known pitfalls (Risk Register-specific)

| Pitfall | Rule |
|---|---|
| Export shows zero occurrences everywhere | (a) Site name mapping is wrong — open admin card → "Unmapped sites this month" → add aliases. (b) Impact column is empty — check `node -e "..."` on `reports.db` to see `COUNT(impact)`. Force re-sync via `/api/sync/trigger/requests?force=true` to backfill. |
| New mine added to operations | Add to canonical SITES list in `risk-register-export.js` (one line) → deploy → restart → SDP label will start appearing in admin card's "Unmapped sites" → admin adds the alias. |
| Domain rules need adjustment | Edit `DOMAIN_RULES` in `risk-register-export.js`. NOT exposed via admin UI (too risky for a simple form — changes affect classification across all months). |
| Diagnostics show high `skipped_no_domain` | Lots of in-scope incidents whose category/sub aren't on the risk register. Could be normal (we only track 5 domains) or could mean SDP added new sub-categories that should be folded in. Spot-check the underlying tickets to decide. |
| `rr_site_aliases` corrupted | `getSiteAliases` falls back to `DEFAULT_SITE_ALIASES` if the SELECT fails, so exports still work. To rebuild: `DELETE FROM rr_site_aliases; -- next request re-seeds from defaults` |

---
