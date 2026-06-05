# ManageEngine Analytics Plus Cloud — Correct OAuth Scopes

Source: https://www.manageengine.com/analytics-plus/cloud-help/api/prerequisites.html#scope

## ⚠️ IMPORTANT — Wrong vs Correct Scope Namespace

| ❌ WRONG (Zoho Analytics) | ✅ CORRECT (Analytics Plus) |
|---|---|
| `ZohoAnalytics.data.read` | `MEAplus.data.read` |
| `ZohoAnalytics.metadata.read` | `MEAplus.metadata.read` |
| `ZohoAnalytics.fullaccess.all` | `MEAplus.fullaccess.all` |

`ZohoAnalytics.*` scopes are for **Zoho Analytics**, not ManageEngine Analytics Plus.
ManageEngine Analytics Plus Cloud requires **`MEAplus.*`** scopes.

---

## Full Scope Reference

| Scope | Description |
|---|---|
| `MEAplus.data.read` | Read data from views/tables |
| `MEAplus.data.create` | Insert rows |
| `MEAplus.data.update` | Update rows |
| `MEAplus.data.delete` | Delete rows |
| `MEAplus.data.all` | All data operations |
| `MEAplus.modeling.read` | Read workspace/table structure |
| `MEAplus.modeling.create` | Create workspaces/tables/views |
| `MEAplus.modeling.update` | Update structure |
| `MEAplus.modeling.delete` | Delete structure |
| `MEAplus.modeling.all` | All modeling operations |
| `MEAplus.metadata.read` | Read metadata |
| `MEAplus.metadata.create` | Create metadata |
| `MEAplus.metadata.update` | Update metadata |
| `MEAplus.metadata.all` | All metadata operations |
| `MEAplus.share.read` | Read sharing details |
| `MEAplus.share.all` | All sharing operations |
| `MEAplus.embed.read` | Read embed URLs |
| `MEAplus.embed.all` | All embed operations |
| `MEAplus.usermanagement.read` | Read users |
| `MEAplus.usermanagement.all` | All user management |
| `MEAplus.fullaccess.all` | **Full access to ALL APIs** |

---

## Scope for This Dashboard

### ✅ Working scope (confirmed 2026-05-27 production)

```
MEAplus.fullaccess.all
```

**Use this when generating an auth code in Zoho Self Client** (`https://api-console.zoho.com`).

### ❌ DO NOT use the narrower read-only scope

```
MEAplus.data.read,MEAplus.metadata.read
```

While this scope is documented by Zoho as sufficient for read APIs, in practice it triggers **errorCode 7301 "SECURITY_NOT_PERMITTED"** on several views (Survey Results, REQUEST_TABLE, MAJOR_INCIDENTS) even when the user has direct access to those views in the Analytics Plus UI.

The error message is misleading:
> `"You (USER NAME) do not have the permission to do this operation"`

It reads like a per-user-ACL issue but is actually a **scope-too-narrow** rejection. Tokens minted with `MEAplus.fullaccess.all` work end-to-end against the same views.

### Security trade-off

`MEAplus.fullaccess.all` is broader than the dashboard strictly needs (we only read data, never write). The practical exposure is bounded because:

1. The dashboard code only calls read endpoints — no write paths exist
2. The token cannot escape the Node process — never written to disk, never exposed to the browser
3. The OAuth refresh token is rotatable from `api-console.zoho.com` at any time

**Net trade-off**: the broader scope is acceptable for prod. A future hardening would be to identify exactly which Analytics Plus API permissions are needed and create a custom narrower scope — but Zoho's scope catalogue doesn't expose that granularity today.

---

## Data Centre / Server URI Reference

| Data Centre | API Server | Accounts | Developer Console |
|---|---|---|---|
| US | analyticsplusapi.manageengine.com | accounts.zoho.com | api-console.zoho.com |
| EU | analyticsplusapi.manageengine.eu | accounts.zoho.eu | api-console.zoho.eu |
| IN | analyticsplusapi.manageengine.in | accounts.zoho.in | api-console.zoho.in |
| AU | analyticsplusapi.manageengine.com.au | accounts.zoho.com.au | api-console.zoho.com.au |

---

## Token Renewal Steps

1. Go to `https://api-console.zoho.com` → Self Client → Generate Code
2. Paste scope: `MEAplus.data.read,MEAplus.metadata.read`
3. Set duration: 10 minutes → Create → Copy code
4. On server CMD (as Admin):
   ```
   cd C:\Apps\SDP-Dashboard
   node get-token.js <YOUR-CODE>
   pm2 restart endeavour-dashboard --update-env
   ```
5. Verify: `http://<server-ip>:3456/api/debug/raw-test` should show status 200
