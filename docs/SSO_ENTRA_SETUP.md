# Microsoft Entra ID (Azure AD) SSO — Setup Guide

Single sign-on for the IT Ops Dashboard using **Microsoft Entra ID** (OpenID
Connect, authorization-code + PKCE). Decisions locked in:

- **SSO-only** — the login page shows "Sign in with Microsoft" only. (A hidden
  break-glass password path stays for **one** super_admin — see §6.)
- **Pre-provisioned only** — a Microsoft sign-in is accepted **only** if the
  person's email already exists on a dashboard user row. Unknown users are
  denied with "your account isn't set up — contact an admin."
- **Roles/sites stay in the dashboard DB.** Entra proves *who* you are; the
  `users` / `user_roles` table decides *what* you can do.

The security-critical token engine (`services/ssoEntra.js`) is built and
unit-tested (`tests/sso-entra.test.js`, 10 tests, real RS256 verification, zero
new npm dependencies). What remains is: DB columns, the two routes, and the
login-page button — plus **your** part below.

---

## 1. Register the app in Entra (you, as M365/Entra admin)

Portal → **Microsoft Entra ID** → **App registrations** → **New registration**.

| Field | Value |
|---|---|
| **Name** | `IT Ops Dashboard` |
| **Supported account types** | **Accounts in this organizational directory only** (single tenant) |
| **Redirect URI** | Platform **Web** → `https://itops-dashboard.edv-ops.com/api/auth/sso/callback` |

Click **Register**. From the **Overview** page copy:
- **Application (client) ID**
- **Directory (tenant) ID**

## 2. Client secret

App → **Certificates & secrets** → **Client secrets** → **New client secret**.
- Description: `dashboard-sso`, Expiry: 24 months (calendar a rotation reminder).
- **Copy the secret VALUE immediately** (it's shown once).

> Prefer a certificate over a secret long-term, but a secret is fine to start.

## 3. Token claims — make sure `email` is emitted

App → **Token configuration** → **Add optional claim** → token type **ID** →
add **`email`** (and optionally `upn`, `family_name`, `given_name`).
If prompted "Turn on the Microsoft Graph email permission," accept it.

App → **API permissions** → confirm **Microsoft Graph → openid, profile,
email** (delegated) are present. **Grant admin consent** for the tenant.

> Why: the dashboard matches you by the `email` claim. Without it, sign-in fails
> with `no_email`. `oid` (object id) is always present and is stored as the
> stable primary link once you've signed in once.

## 4. (Optional) Restrict who can sign in

App → **Enterprise applications** → your app → **Properties** →
**Assignment required = Yes**, then **Users and groups** → assign only the IT
team / relevant users. Combined with "pre-provisioned only," this is
defence-in-depth: Entra blocks unassigned users *before* they reach the app.

## 5. Fill in `.env` on the prod host

Add these to `C:\Apps\SDP-Dashboard\.env` (values from steps 1–2):

```ini
SSO_ENABLED=true
ENTRA_TENANT_ID=<Directory (tenant) ID>
ENTRA_CLIENT_ID=<Application (client) ID>
ENTRA_CLIENT_SECRET=<the secret VALUE from step 2>
ENTRA_REDIRECT_URI=https://itops-dashboard.edv-ops.com/api/auth/sso/callback
```

Leaving `SSO_ENABLED` unset (or `false`) keeps the current password login — the
SSO code stays completely dormant, so deploying it changes nothing until you
flip this on. After editing `.env`: `pm2 restart` (stop → wait → start).

## 6. Break-glass (emergency password) account

Because SSO is the only visible login, keep **one** `super_admin` on a password
so an Entra outage or a misconfigured redirect can't lock everyone out. The
password form is reachable at **`/login.html?breakglass=1`** (hidden from the
normal page). Keep that account's credentials in your password manager; don't
give it an `email`/Entra link so it can't be shadowed by SSO.

## 7. Pre-provision your people (dashboard admin)

Every user who will sign in via Microsoft must already exist as a dashboard
user **with their Entra email**. On `reports.html#admin` → Users, set each
user's **Email** to their corporate address (e.g. `first.last@edv-ops.com`) and
give them the right **role + site**. First successful Microsoft sign-in links
their stable Entra `oid` automatically; from then on the match is by `oid`.

---

## How it works (reference)

```
login.html ──"Sign in with Microsoft"──▶ GET /api/auth/sso/login
   ▲                                         │ beginLogin(): build authorize URL
   │                                         │ (state+nonce+PKCE stored server-side)
   │                                         ▼ 302 → Entra sign-in (+ tenant MFA)
   │  x-report-token (same session as today)  │
   │                                         ▼ 302 back with ?code=&state=
   └──────────────────────────────  GET /api/auth/sso/callback
                                       · state match  · completeLogin():
                                         exchange code → id_token → verify
                                         (RS256/JWKS, iss, aud, exp, nonce)
                                       · findUserByEntra(oid,email) — deny if none
                                       · link oid on first match
                                       · mint the normal sessions token → set cookie
```

Everything downstream — `requireReportSession`, roles, site scoping, the Active
Sessions card — is unchanged; SSO is just a new way to mint the existing token.

## Security properties

- **PKCE (S256)** + **state** (CSRF) + **nonce** (replay) on every login.
- **ID-token signature** verified against the tenant JWKS (RS256, 1h key cache,
  auto-refresh on key rotation); `iss`, `aud`, `exp`/`nbf`, `tid`, `nonce` all
  checked with a 60 s skew allowance.
- **Client secret never leaves the server**; the browser only ever sees the
  opaque session token, exactly as today.
- **Authorization is the dashboard's**, not Entra's — a valid Microsoft
  identity with no matching, active dashboard user is refused.
