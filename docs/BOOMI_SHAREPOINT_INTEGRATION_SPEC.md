# Executive view → SharePoint via Boomi — integration spec

**Chosen delivery mode:** C — governed (Boomi Atom on-LAN → SharePoint Online list)
**Date:** 2026-06-15
**Audience:** Integration (Boomi), M365/SharePoint admin, Network/Security
**Companion docs:** `EXEC_SHAREPOINT_VIEW_HANDOFF.md` (design), exec-sharepoint-mockup.html (visual)

---

## 1. Data flow

```
[SDP Dashboard app — LAN]
   GET /api/exec-snapshot   (curated, read-only JSON; aggregates only, no PII)
        │  read over the LAN (intra-network, no internet)
        ▼
[Boomi Atom — installed on the LAN]
   scheduled process (e.g. nightly 06:00): GET the endpoint → map → upsert
        │  outbound HTTPS to Microsoft 365  (THIS is the only cloud egress)
        ▼
[SharePoint Online list:  "IT Exec Snapshot"]
        │
        ▼
[SharePoint page] rendered with native web parts / column formatting
        ▼
[All staff — cloud, any device, off-LAN]
```

Key point: **the dashboard app never touches the cloud.** It only exposes a LAN
endpoint. The Boomi Atom is the bridge and the only component with cloud egress.
No inbound path to the LAN is created.

## 2. Responsibilities

| Component | Owner | Status |
|---|---|---|
| `GET /api/exec-snapshot` endpoint (curated JSON) | IT / SDP Dashboard team | to build (see §3) |
| Boomi Atom on-LAN + scheduled process + mapping | Integration team | to set up |
| Boomi SharePoint Online connector + auth | Integration team | to configure |
| Azure AD app registration (`Sites.Selected`, one site) | M365 admin + Security | to request |
| SharePoint list schema + page + permissions | SharePoint admin / Designer | to build |
| Proxy egress `graph.microsoft.com` / `login.microsoftonline.com` **on the Atom host** | Network | to confirm |

## 3. The endpoint contract — `GET /api/exec-snapshot`

Read-only. Auth: the existing API-key gate (`X-Dash-Key`) — the Atom presents the
key, same as any internal API consumer. Returns **only aggregated, non-sensitive
values** (no ticket-level data, no names, no verbatims). Proposed shape:

```json
{
  "generated_at": "2026-06-15T06:00:00Z",
  "period": "2026-05",
  "period_label": "May 2026",
  "helpdesk": {
    "resolved": 1236,
    "closure_pct": 93,
    "sla_pct": 91,
    "sla_delta_pp": 1.3,
    "avg_resolution_hrs": 14,
    "csat_pct": 88,
    "csat_responses": 214
  },
  "incidents": { "major_count": 3, "uptime_pct": 99.7, "pending_rca": 2 },
  "trend6m": [
    { "month": "Dec", "resolved": 1080, "sla_pct": 86 },
    { "month": "May", "resolved": 1236, "sla_pct": 91 }
  ],
  "sites": [
    { "code": "HGO", "name": "Hounde", "rag": "green" },
    { "code": "SML", "name": "Lafigue", "rag": "red" }
  ],
  "tracker": {
    "fleet_pct": 72,
    "pillars": [
      { "name": "Network", "pct": 81 },
      { "name": "Business partner", "pct": 74 },
      { "name": "Risk & compliance", "pct": 63 },
      { "name": "Manage people", "pct": 69 }
    ]
  },
  "highlights": ["SLA recovered to 91%", "Hounde network upgrade done", "CSAT +4 pts"],
  "focus": ["Lafigue power/UPS (red)", "Risk pillar below target", "2 incidents pending RCA"]
}
```

The contract is **stable and versioned**; fields can be added without breaking
Boomi's mapping. Final field list depends on the content decision from the
stakeholder meeting (see handoff doc §8.1).

## 4. SharePoint list schema (proposal)

Simplest pattern that renders well with native web parts: **one row per KPI** in a
primary list, plus a small companion list for the trend.

`IT Exec Snapshot` (primary)

| Column | Type | Example |
|---|---|---|
| Title | Single line | "SLA compliance" |
| Value | Single line | "91%" |
| Delta | Single line | "+1.3 pp vs Apr" |
| RAG | Choice (green/amber/red/info) | "green" |
| Sort | Number | 2 |
| UpdatedAt | DateTime | 2026-06-15T06:00Z |

`IT Exec Trend` (companion, 6 rows) — Month / Resolved / SLApct.
`IT Exec Sites` (companion) — Site / RAG.

Boomi **upserts** (clears + rewrites, or matches on Title) each run. The SharePoint
page uses column formatting (RAG → coloured pill) + the Quick Chart web part for the
trend. Designer finalises the page; this schema is just to unblock the list creation.

## 5. Azure AD app registration (least privilege)

- Permission: **`Sites.Selected`** (Microsoft Graph, Application) — grants access to
  **one** SharePoint site only, not the whole tenant.
- After consent, grant the app **write** to the specific site via
  `Sites.Selected` site-permission assignment (PowerShell/Graph one-time).
- Client credentials (client id + secret/cert) live in **Boomi**, not in the
  dashboard app.

Security talking point: this is **narrower** than a typical integration account —
one site, app-only, no user impersonation, no inbound to the LAN.

## 6. Schedule & freshness

- Nightly (e.g. 06:00) is sufficient for an executive view. The "Synced <timestamp>"
  badge on the page is driven by `generated_at` / `UpdatedAt`.
- Can go more frequent later (hourly) by changing the Boomi schedule only.

## 7. Sequencing note (optional but recommended)

Boomi setup (Atom, connector, app reg, process, list, page) takes time. If a
**visible result is wanted sooner**, the same `/api/exec-snapshot` endpoint can drive
a nightly **image/PDF snapshot** to a SharePoint library (option B) as an interim,
with zero Boomi dependency — then retire it once the governed Boomi pipeline is live.
The endpoint and the content are identical either way, so no work is wasted.

## 8. Open items before build

1. Final content/field list (stakeholder meeting).
2. Confirm Boomi Atom is (or will be) installed on the LAN with read access to the
   dashboard host on port 3456.
3. Confirm the Atom host's outbound proxy allows the M365 endpoints.
4. Name the target SharePoint site + who administers it.
