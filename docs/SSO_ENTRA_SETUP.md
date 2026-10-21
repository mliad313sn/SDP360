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
email, User.Read** (delegated) are present. **Grant admin consent** for the
tenant. (`User.Read` lets the dashboard read jobTitle + officeLocation from
Graph `/me` so it can auto-fill each user's title/office on sign-in.)

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
SSO_MODE=available            # off | available | only  (see the cutover below)
ENTRA_TENANT_ID=<Directory (tenant) ID>
ENTRA_CLIENT_ID=<Application (client) ID>
ENTRA_CLIENT_SECRET=<the secret VALUE from step 2>
ENTRA_REDIRECT_URI=https://itops-dashboard.edv-ops.com/api/auth/sso/callback
SSO_BREAKGLASS_USER=<your emergency super_admin username>
SESSION_COOKIE_SECURE=1
```

`SSO_MODE` unset (or `off`) keeps the current password login — the SSO code
stays completely dormant, so deploying it changes nothing until you set it.
After editing `.env`: `pm2 restart` (stop → wait → start); the boot log prints
`[SSO] mode=… (Entra ready)`.

### Option A — configure from the admin page (no `.env` edit, no restart)

Since **F2a** you can set all six values from the dashboard instead of touching
`.env`: **Admin → left rail → 🔐 Microsoft SSO** (`reports.html#admin/sso`,
**super_admin only**). Fields: Mode, Directory (tenant) ID, Application (client)
ID, Client secret, Redirect URI, Break-glass user. Click **Save** — changes take
effect **within a minute, no restart**.

- **Precedence:** for each field the resolver (`services/ssoSettings.js`) uses the
  **DB value if set, else `.env`, else a built-in default**. So a blank field on
  the admin page falls back to `.env` — the two can be mixed (e.g. leave the
  secret in `.env`, set only the tenant/client in the DB), and **`.env` still wins
  whenever the DB config is unreadable** (fail-safe).
- **The client secret is stored in the DB config** (`report_config`, like the SMTP
  password): it is **redacted on read** (never sent back to the browser) and
  **blank-kept on save** (leave it empty to keep the stored one). ⚠️ It therefore
  travels inside DB dumps/backups — treat those as secret, and prefer rotating the
  secret via this page over emailing it around.
- **Which to use?** `.env` is the durable baseline (survives a DB wipe, set once at
  install). The admin page is for **changing SSO without a deploy** — flipping the
  cutover mode `off → available → only`, fixing a mistyped tenant, rotating the
  secret. Do the initial setup in whichever you prefer; they interoperate.

### The cutover (recommended order)

1. **`SSO_MODE=off`** — deploy the code. Nothing changes; password login as today.
2. **Map emails** (§7) for every active user.
3. **`SSO_MODE=available`** — BOTH "Sign in with Microsoft" **and** password work.
   People start using Microsoft; a wrong email is just a password fallback, not
   a lockout. First Microsoft sign-in links their Entra `oid` and auto-fills
   name / title / office. Run this ~a week; fix any mismaps as they surface.
4. **`SSO_MODE=only`** — Microsoft required; password disabled except the
   break-glass account (`/login.html?breakglass=1`). Test your own Microsoft
   sign-in **before** this step.

## 6. Break-glass (emergency password) account

Because SSO is the only visible login, keep **one** `super_admin` on a password
so an Entra outage or a misconfigured redirect can't lock everyone out. The
password form is reachable at **`/login.html?breakglass=1`** (hidden from the
normal page). Keep that account's credentials in your password manager; don't
give it an `email`/Entra link so it can't be shadowed by SSO.

## 7. Pre-provision your people (dashboard admin)

Every user who will sign in via Microsoft must already exist as a dashboard
user **with their Entra email**. Fastest way: `reports.html#admin` → Users →
**✉ Map SSO emails** — it lists every active user with a
`first.last@edv-ops.com` address auto-suggested from their name (editable domain
at the top). **Review each against your Entra directory**, correct any, and
**Save all**. Blank = that user has no SSO (still password-only).

Names, titles and offices come **from Entra automatically** on first sign-in —
you only maintain **email + role + site**. First successful Microsoft sign-in
links the stable Entra `oid`; from then on the match is by `oid` (immune to
email changes).

### Linking rule (since 2026-10-20, remediation E2)

The match is **`oid` first, always**. The e-mail is only a *bootstrap* for an
account that has never signed in with Microsoft, and that fallback is narrow:

| Condition | E-mail fallback |
|---|---|
| The dashboard user already has an `entra_oid` | **never** — a linked account cannot be re-matched through its (mutable) e-mail, even by a token carrying a different `oid` |
| The e-mail comes from the `email` (verified) or `upn` claim | allowed |
| The e-mail comes from `preferred_username` only | **never** — it is a display alias, not an identity |
| The user is the break-glass account (`sso_breakglass_user`) | **never** |
| The user holds `super_admin` | **never** — such accounts are linked only by `oid` (sign them in once while `SSO_MODE=available`? No: they stay password accounts unless an administrator links them deliberately — see below) |

Consequences for the administrator:

- An account that must sign in with Microsoft needs its **e-mail mapped before**
  its first sign-in (§7). A `super_admin` who needs SSO is first created / kept
  as a regular `admin`, signs in once (which stamps the `oid`), and is promoted
  afterwards — the promotion never widens the e-mail fallback.
- A token whose `oid` differs from the one already stored on the matched account
  is **refused** with the neutral "not set up in the dashboard" message, and a
  `sso_link_conflict` **risk event** appears in System Logs. Investigate it: it is
  either a re-created Entra object (clear the old link by hand) or an attempt to
  take over the account.
- If Entra omits the `groups` claim because the user is in too many groups
  (`_claim_names` overage), the sign-in succeeds but **no group-based role or
  site provisioning is applied** for that login and a `sso_groups_overage` risk
  event is logged. Fix it in Entra (emit groups assigned to the application only)
  or set the roles by hand.
- Entra error descriptions are **truncated and redacted** before they reach the
  server log (no URLs, no secret-looking values).

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
