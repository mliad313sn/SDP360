# CHANGE REQUEST — Move IT Dashboard login to a secure HTTPS address

| Field | Value |
|---|---|
| **Change ID** | CH-273 |
| **Title** | Move IT Dashboard login from `http://10.225.99.173:3456` to `https://itops-dashboard.edv-ops.com` |
| **Type** | Normal change *(not Standard, not Emergency)* |
| **Category** | Infrastructure / Security |
| **Risk level** | Medium |
| **Priority** | High *(closes an open security finding)* |
| **Status** | DRAFT — awaiting Change Advisory Board approval |
| **Submitted by** | SDP Dashboard team |
| **Implementation window** | *To be confirmed* — proposed: weekend or weekday after 18:00 (low-traffic period) |
| **Companion runbook** | `docs/INTERNAL_TLS_SETUP.md` |
| **Related commit** | `b85e30f` — committed locally, **not deployed** until this CR is approved |

---

## 1. PURPOSE

### 1.1 Problem statement

The IT Dashboard is currently reached at **`http://10.225.99.173:3456`**. Two problems:

1. **Unencrypted transport (HTTP, not HTTPS).** The dashboard correctly hashes passwords *at rest* in the database — they are stored with PBKDF2-HMAC-SHA-512 (100,000 iterations, per-user random salt; see `reports-db.js`, `hashPassword`). However, **on the wire during login**, the browser sends the raw password inside a JSON POST body to `/api/reports/auth/login` (`public/login.html`, line 97). Because the connection is plain HTTP, anything inside that body — and inside every later response — is readable to anyone with packet capture on the corporate network. Specifically exposed today:
   - **The plain-text password** during login (the server hashes it on receipt, but the wire value is plain).
   - **The session token** carried in `Authorization` / `X-Report-Token` headers on every subsequent request — capturing it once enables session replay until the token expires.
   - **All dashboard responses** — incident detail, employee names, manager comments, etc.

   Hashing the password client-side before sending it would not close this gap: the hash becomes the new credential and can be replayed. Only transport encryption (HTTPS / TLS) prevents this entire class of attack.

2. **Raw IP and port, no friendly hostname.** Bookmarks, emails, and documentation reference an IP that breaks if the server is ever moved or replaced.

### 1.2 Goal of this change

Replace that address with **`https://itops-dashboard.edv-ops.com`** — a friendly hostname served over an encrypted connection — by adding a thin Microsoft IIS reverse-proxy layer in front of the existing dashboard. After the change:

- Users open the new URL and see a green padlock in their browser.
- The old `http://10.225.99.173:3456` URL stops working.
- All browser-to-server traffic is encrypted.
- The dashboard application itself is unchanged: same code, same database, same data syncs, same reports.

### 1.3 Why now (drivers)

| Driver | Detail |
|---|---|
| Open security finding | Raised by Cezar (NGANSOP NGUEPKAP) at the November 2025 IT Security Town Hall — internal applications must use HTTPS over a real hostname. |
| Accountability | Alexis (TERNOY) requested closure tracking on the finding. |
| Compliance | Aligns with the internal "Internal Web Apps must use TLS encryption" policy. |
| Defence in depth | Closes credential-sniffing exposure on the corporate LAN. |

### 1.4 Success criteria

The change is successful when **all** of these are true:

- [ ] `https://itops-dashboard.edv-ops.com` loads with a green padlock from any domain-joined laptop.
- [ ] `http://10.225.99.173:3456` no longer responds from any machine other than the server itself.
- [ ] All five user roles (super_admin, executive, admin, editor, viewer) log in successfully.
- [ ] PowerPoint exports (weekly, monthly per-site, all-sites monthly) all work.
- [ ] The Activity Tracker save / reload cycle works.
- [ ] The 2-hourly Zoho data sync continues running.
- [ ] HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy headers are present on every response.
- [ ] Cezar's finding is closed in writing.

---

## 2. SCOPE

### 2.1 In scope

- Create internal DNS hostname `itops-dashboard.edv-ops.com` pointing to `10.225.99.173`.
- Issue and install a TLS certificate from the corporate internal Certificate Authority.
- Install two free Microsoft IIS modules: URL Rewrite 2.1 and Application Request Routing 3.0 (the routing module).
- Create an IIS site bound to the new hostname on port 443 (standard HTTPS port).
- Deploy `web.config` with reverse-proxy rule + security headers.
- Restrict the dashboard application (Node.js / PM2) to local-only via the `BIND_HOST=127.0.0.1` environment variable.
- Add a Windows firewall rule blocking external traffic to port 3456.
- Communicate the new URL to all users.

### 2.2 Out of scope

- Active Directory single sign-on (separate roadmap item, Q1/Q2).
- Refactoring of dashboard application code beyond the existing `BIND_HOST` / `trust proxy` patch already committed.
- Public internet exposure (dashboard remains intranet-only).
- Migrating off Node.js, PM2, or SQLite.
- Re-issuing certificates for any other internal application.

### 2.3 Affected URLs (change of record)

| Before | After |
|---|---|
| `http://10.225.99.173:3456` | `https://itops-dashboard.edv-ops.com` |
| `http://10.225.99.173:3456/executive-report.html` | `https://itops-dashboard.edv-ops.com/executive-report.html` |
| `http://10.225.99.173:3456/activity-tracker.html` | `https://itops-dashboard.edv-ops.com/activity-tracker.html` |
| `http://10.225.99.173:3456/reports.html` | `https://itops-dashboard.edv-ops.com/reports.html` |

---

## 3. RISK & IMPACT ASSESSMENT

| Field | Value |
|---|---|
| Risk level | **Medium** — affects every user's login URL, but rollback is fast and complete |
| User-visible downtime | About 30 seconds during the dashboard restart in implementation step 6 |
| Total implementation window | 60–90 minutes end-to-end |
| Reversibility | Fully reversible in three commands; old URL restored in under 5 minutes |
| Data loss risk | None — no database or file modifications |
| Security risk if change fails | None — falls back to current state, which is the existing accepted risk |

### 3.1 Stakeholder impact

| Group | What they notice | Mitigation |
|---|---|---|
| All dashboard users | New URL; browser shows green padlock; same login | 48 h email + Teams notice; old URL redirects for 4 weeks |
| Mobile users | Same — bookmark needs updating | Same |
| IT staff (deploys via `Z:\`) | No change in workflow | None needed |
| Zoho 2-hourly sync | None — runs in-process | Verified in test plan |
| PowerPoint exports | None — proxy is transparent | Smoke-tested in implementation step 8 |
| Activity Tracker users | None | Smoke-tested |
| External integrations | None — dashboard exposes no inbound APIs | N/A |

### 3.2 Risk mitigation summary

- Rollback procedure pre-tested in a non-production environment.
- Implementation scheduled during low-traffic window.
- Rollback decision-maker named and on call throughout the window.
- All commits already in version control; nothing is deployed until CAB approves and `_deploy.cmd` is run.

---

## 4. ROLES & RESPONSIBILITIES (RACI)

| Activity | Responsible (does the work) | Accountable (signs off) | Consulted | Informed |
|---|---|---|---|---|
| Submitting this CR | Dashboard team lead | IT Manager | Cezar, Alexis | All users |
| Creating the DNS hostname | Network / Active Directory administrator | IT Manager | — | Dashboard team |
| Issuing the TLS certificate | Internal Certificate Authority team (PKI) | IT Manager | Cezar | Dashboard team |
| Installing IIS modules + creating site + binding cert | Mohamed (system administrator) | IT Manager | Dashboard team | Cezar |
| Restricting the dashboard to local-only | Dashboard team | Mohamed | — | Mohamed |
| Verification testing | Dashboard team + Mohamed | IT Manager | Cezar | All users |
| User communication | Dashboard team | IT Manager | — | All users |
| Final closure / sign-off | IT Manager | Cezar / Alexis | Dashboard team | CAB |

---

## 5. PRE-IMPLEMENTATION CHECKLIST

Every box must be ticked before T-zero (the moment the implementation window opens).

- [ ] CAB approval recorded
- [ ] Internal DNS hostname `itops-dashboard.edv-ops.com` created and resolves to `10.225.99.173` from a domain-joined laptop *(test: `nslookup itops-dashboard.edv-ops.com`)*
- [ ] TLS certificate (`.pfx` file — bundles certificate + private key, password-protected) delivered by the internal Certificate Authority team. Main hostname on the cert = the FQDN above. Password stored in the password vault.
- [ ] Two Microsoft IIS installers downloaded to dev laptop and pushed to prod via `Z:\Installers\` (visible on prod at `C:\Apps\SDP-Dashboard\Installers\`):
  - `rewrite_amd64_en-US.msi` (URL Rewrite 2.1) — from `https://www.iis.net/downloads/microsoft/url-rewrite`
  - `requestRouter_amd64.msi` (Application Request Routing 3.0) — from `https://www.iis.net/downloads/microsoft/application-request-routing`
  ```cmd
  :: from cmd.exe on the dev laptop
  if not exist Z:\Installers mkdir Z:\Installers
  xcopy "C:\Users\Admin\Downloads\rewrite_amd64_en-US.msi"   "Z:\Installers\" /Y
  xcopy "C:\Users\Admin\Downloads\requestRouter_amd64.msi"   "Z:\Installers\" /Y
  ```
- [ ] Implementer has Remote Desktop access to the server `ABJ-SRV-012`
- [ ] Backups taken (run from the dev laptop's `cmd.exe`, where `Z:\` is the network mount of prod):
  ```cmd
  if not exist Z:\backups mkdir Z:\backups
  xcopy "Z:\server.js"           "Z:\backups\server.js.YYYY-MM-DD.bak*"           /Y
  xcopy "Z:\ecosystem.config.js" "Z:\backups\ecosystem.config.js.YYYY-MM-DD.bak*" /Y
  ```
  *(The `*` lets `xcopy` accept the `.bak` extension as-is. From the prod server's perspective, these backups land at `C:\Apps\SDP-Dashboard\backups\`.)*
- [ ] Pre-drafted English + French user announcements approved (templates in §8)
- [ ] Maintenance window announced 48 hours in advance via email + Teams
- [ ] Rollback decision-maker named and on call

---

## 6. IMPLEMENTATION PLAN

This section covers the **technical work on the server** during the maintenance window.
The **user-facing rollout** (announcements, bookmark migration, legacy redirect retirement) is in §8.
The **revert procedure** is in §9.

> **Two execution surfaces — read before starting.**
> The implementer works from **two machines**, each with a different view of the production filesystem:
>
> | Machine | Role | Sees prod's app folder as |
> |---|---|---|
> | **Dev laptop** (`C:\Users\Admin\Documents\SDP-Dashboard\.claude\worktrees\busy-kirch-2a4176`) | Editing files in the worktree, pushing to prod via SMB | `Z:\…` (network mount) |
> | **Prod server `ABJ-SRV-012`** (Remote Desktop session) | Installing IIS, running PM2 commands, configuring the IIS site | `C:\Apps\SDP-Dashboard\…` (local disk) |
>
> The same physical file appears at **two paths** depending on which machine you're on:
> ```
> worktree (dev)   →   Z:\iis\web.config (dev's view of prod)   =   C:\Apps\SDP-Dashboard\iis\web.config (prod's view)
> ```
> `Z:\` does **not** exist on the prod server — the SMB mount is only present on the dev laptop. Steps below state explicitly which machine to run each command on.

The detailed step-by-step companion runbook is `docs/ROLLOUT_BACKOUT_CHECKLIST.md`, which carries 💻 / 🖥 / 👤 tags on every step.

### Time format
`T+0` = window opens. `T+10` = ten minutes after. `T-15` = fifteen minutes before.
**Total target: 60–90 minutes. User-visible downtime target: about 30 seconds.**

### Step 0 — Pre-flight (T-15 minutes)
- Confirm every box in §5 is ticked.
- Open Remote Desktop session to `ABJ-SRV-012`.
- Open a second window on a normal user laptop for live verification.
- Open a Teams chat including the implementer and the named rollback decision-maker.

### Step 1 — Install the two Microsoft IIS modules (T+0, ~10 min)

**What we are doing.** Adding two free, signed Microsoft modules that turn IIS into a reverse proxy.

**Why both.** URL Rewrite is the rule engine — it reads `web.config` and decides what to do with each incoming request. Application Request Routing (the routing module) is the outbound forwarder — it actually sends the request to the dashboard application. Without both, IIS cannot forward to a backend service.

**Steps on the server.**
1. Run `rewrite_amd64_en-US.msi` (URL Rewrite 2.1) — accept defaults — Finish.
2. Run `requestRouter_amd64.msi` (Application Request Routing 3.0) — accept defaults — Finish.
3. No reboot required.
4. Confirm both modules appear under IIS Manager → server node → Modules.

### Step 2 — Switch the routing module on (T+10, ~2 min)

**What we are doing.** Installing the routing module adds the *capability*, but its proxy feature is **disabled by default**. This step turns it on.

**Steps.**
1. Open IIS Manager (`inetmgr`).
2. Click the server node (top of the left tree — the hostname).
3. In the centre pane, double-click **Application Request Routing Cache**.
4. In the right-hand Actions pane, click **Server Proxy Settings…**.
5. Tick **Enable proxy**.
6. Leave every other option at default → **Apply**.

### Step 3 — Create the IIS website (T+12, ~5 min)

**What we are doing.** Telling IIS "there is a website at the new hostname; serve it on port 443 with the certificate we will import next."

**Steps.**
1. In IIS Manager, right-click **Sites** → **Add Website**.
2. Fill in:
   - Site name: `IT-Dashboard`
   - Physical path: `C:\Apps\SDP-Dashboard\iis`
   - Binding type: `https`
   - IP address: `All Unassigned`
   - Port: `443`
   - Hostname: `itops-dashboard.edv-ops.com`
   - Tick: **Require Server Name Indication**
   - SSL certificate: leave blank (set in Step 4)
3. Click **OK**.

### Step 4 — Import and bind the TLS certificate (T+17, ~5 min)

**What we are doing.** Putting the certificate in the server's certificate store and pointing the IIS site at it. After this step, the new HTTPS URL technically responds.

**Steps.**
1. IIS Manager → server node → **Server Certificates** → right-click → **Import**.
2. Browse to the `.pfx` file → enter password → store: `Personal` → tick **Allow this certificate to be exported** → OK.
3. Click the **IT-Dashboard** site → **Bindings** → select the `https` binding → **Edit**.
4. Pick the imported certificate → OK → Close.

### Step 5 — Deploy the IIS configuration file (T+22, ~2 min)

**What we are doing.** Putting `web.config` into the IIS site folder on the production server. This file tells IIS "forward every incoming request to the dashboard on the local port, and add these security headers."

The file lives in the worktree on the dashboard team's dev laptop. We push it to the production server via the `Z:\` SMB mount (the dev laptop sees prod's `C:\Apps\SDP-Dashboard\` as `Z:\`), then verify it landed on prod.

**Steps.**

1. **From the dev laptop's `cmd.exe`** (where `Z:\` exists as the network mount of prod):
   ```cmd
   if not exist Z:\iis mkdir Z:\iis
   xcopy "C:\Users\Admin\Documents\SDP-Dashboard\.claude\worktrees\busy-kirch-2a4176\iis\web.config" "Z:\iis\" /Y
   ```
   *(Or just run `_deploy.cmd` from the worktree folder — the post-commit hook auto-generates it.)*

2. **From the prod server `ABJ-SRV-012` via RDP** — confirm the file landed:
   ```cmd
   dir C:\Apps\SDP-Dashboard\iis\web.config
   findstr "itops-dashboard" C:\Apps\SDP-Dashboard\iis\web.config
   ```
   Both should return positive results. IIS picks up `web.config` immediately, no restart needed.

> **Path mapping reminder:** the same physical file appears at `Z:\iis\web.config` from the dev laptop and at `C:\Apps\SDP-Dashboard\iis\web.config` from the prod server itself. `Z:\` does **not** exist on the prod server — that path is only meaningful from the dev laptop's perspective.

**Smoke check from a normal user laptop:** open `https://itops-dashboard.edv-ops.com` → dashboard login page should render with a green padlock. **If it does not, this is a rollback decision point — see §9.**

### Step 6 — Restrict the dashboard to local-only (T+24, ~3 min — about 30 s downtime)

**What we are doing.** Until now, the old `http://10.225.99.173:3456` is still reachable. Anyone could bypass the new HTTPS layer. This step closes that door — the dashboard accepts connections only from the same machine, so the only way in is through the IIS HTTPS layer.

**Steps on the prod server `ABJ-SRV-012` via RDP.**

1. Edit `C:\Apps\SDP-Dashboard\ecosystem.config.js` (PM2's startup config — runtime configuration, edited in place on prod, not from the worktree). Add `BIND_HOST: '127.0.0.1'` to the `env` block. *(`127.0.0.1` is the special address meaning "this same machine, local only".)*
2. Reload PM2 with the new environment:
   ```cmd
   pm2 reload endeavour-dashboard --update-env
   pm2 save
   ```
3. Verify from the prod server itself: `curl http://localhost:3456/health` → should return `200 OK`.
4. Verify from any **other** machine on the network (your dev laptop, a user laptop): `http://10.225.99.173:3456` → should refuse connection. **This is the desired state.**

### Step 7 — Add Windows firewall rule (T+27, ~2 min)

**What we are doing.** Belt and braces — even if the local-only restriction is ever undone, the firewall blocks external traffic to port 3456.

**Steps.**
```cmd
netsh advfirewall firewall add rule name="Block Node 3456 external" dir=in protocol=TCP localport=3456 remoteip=!127.0.0.1 action=block
```
Reads as: "incoming TCP traffic on port 3456 from any address that is not 127.0.0.1 → block."

### Step 8 — Verification testing (T+29, ~10 min)

Run the full §7 test plan. Each ✅ is a checkpoint. **If any test fails on a critical path → rollback (§9).**

### Step 9 — Send the user announcement (T+39, immediate)

The pre-approved English + French notice (templates in §8.4) goes out by email and Teams.

### Step 10 — Sign-off and closure (T+50, ~10 min)

- Email Cezar (CC: Alexis) confirming the security finding is closed. Attachments:
  - Screenshot: green padlock on the new URL
  - Screenshot: DevTools showing the security headers
  - Screenshot: failed connection to the old URL from a user laptop
- Update `CLAUDE.md` with the new URL.
- Mark CH-273 **Implemented** in the CAB tracker.

---

## 7. VERIFICATION / TEST PLAN

Run from a domain-joined laptop on the corporate network — **not** on the server itself.

| # | Test | Expected | Pass criteria |
|---|---|---|---|
| 1 | Browser load — new URL | Login page renders over HTTPS | Green padlock, no certificate warning |
| 2 | Browser load — old URL | Connection refused / timeout | Old URL no longer reachable |
| 3 | Browser load — old URL after HSTS cached | Browser auto-rewrites to HTTPS | Typing `http://itops-dashboard.edv-ops.com` becomes `https://...` |
| 4 | Security headers present | HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy | DevTools → Network → Response Headers |
| 5 | Server sees correct protocol | Server logs show `https`, not `http` | Spot-check log |
| 6 | Server sees real client IP | Server logs show real IP, not `127.0.0.1` | Spot-check log |
| 7 | Login per role | super_admin, executive, admin, editor, viewer all work | One user per role tested |
| 8 | PowerPoint — weekly | Downloads + opens in PowerPoint | File opens cleanly |
| 9 | PowerPoint — monthly per-site | Downloads + opens | File opens cleanly |
| 10 | PowerPoint — all-sites monthly | Downloads + opens | File opens cleanly |
| 11 | Activity Tracker save | Admin saves monthly inputs | Value persists after page reload |
| 12 | Zoho 2-hourly sync | Continues to run | Wait one cycle, check `last_sync_at` |

Any failure on tests 1–10 = **rollback decision point** (§9).
Failures on 11–12 = log and investigate post-window; not a rollback trigger.

---

## 8. ROLLOUT PLAN

This section covers the **user-facing rollout** — when, how, and to whom we announce the change, and how the legacy URL is retired.

### 8.1 Communication schedule

| When | Audience | Channel | Owner |
|---|---|---|---|
| T-7 days | All users | Email + Teams general announcement | Dashboard team |
| T-48 hours | All users | Reminder email | Dashboard team |
| T-24 hours | IT staff + CAB members | Targeted email | Dashboard team |
| T-1 hour | Implementers + on-call rollback owner | Teams chat | Implementer |
| T+30 min (success) | All users | Email + Teams | Dashboard team |
| T+30 min (rollback) | All users | Short Teams message | Rollback owner |
| T+24 hours | IT Manager + Cezar + Alexis | Closure email with screenshots | Dashboard team |

### 8.2 Legacy URL retirement schedule

| Phase | Duration | Behaviour of `http://10.225.99.173:3456` | Behaviour of `https://itops-dashboard.edv-ops.com` |
|---|---|---|---|
| Pre-change | — | Live (current state) | Not yet active |
| Cutover | T+0 to T+50 min | Going down | Coming up |
| Grace period | T+50 min to T+4 weeks | Refused at network level — users already migrated to new URL | Live |
| Retirement | T+4 weeks onwards | Permanently closed; firewall rule stays in place | Live |

### 8.3 Bookmark / documentation migration

The dashboard team owns sweeping these locations within the first week:

- [ ] `CLAUDE.md` (project memory file)
- [ ] Internal SharePoint / wiki pages
- [ ] Email signatures of dashboard team members
- [ ] PM2 health-check URLs in any monitoring tools
- [ ] Direct-IP references in any internal scripts

### 8.4 Pre-approved user announcements

#### English

> **Subject:** New secure URL for the IT Dashboard
>
> Starting **<DATE>**, the IT Dashboard is available at a new secure address:
>
> **`https://itops-dashboard.edv-ops.com`**
>
> The old address `http://10.225.99.173:3456` will redirect for four weeks and then be retired. Please update your bookmarks.
>
> No password change is required. Your existing login still works.
>
> Questions: reply to this email or contact the IT helpdesk.

#### French

> **Objet :** Nouvelle adresse sécurisée du Tableau de Bord IT
>
> À compter du **<DATE>**, le Tableau de Bord IT est accessible à une nouvelle adresse sécurisée :
>
> **`https://itops-dashboard.edv-ops.com`**
>
> L'ancienne adresse `http://10.225.99.173:3456` sera redirigée pendant quatre semaines, puis retirée. Merci de mettre à jour vos favoris.
>
> Aucun changement de mot de passe n'est nécessaire — vos identifiants restent les mêmes.
>
> Pour toute question, répondez à cet e-mail ou contactez le helpdesk IT.

---

## 9. ROLLBACK PLAN

### 9.1 Rollback triggers (any one triggers a rollback)

1. **Step 5 fails:** new HTTPS URL does not load within 5 minutes of placing `web.config`.
2. **Step 6 fails:** dashboard does not start cleanly with the local-only setting (PM2 errors, or local health check fails).
3. **Step 8 (test plan) fails on a critical path:** login broken; PowerPoint export broken; or any role cannot reach pages they should reach.
4. **Post-change incidents:** more than three users report being unable to reach the dashboard within 24 hours of go-live.

### 9.2 Decision authority

| When in the timeline | Decision-maker |
|---|---|
| Steps 1–5 (no users affected yet) | Implementer (Mohamed) |
| Steps 6–10 | Named rollback decision-maker (from §4), in consultation with the IT Manager |
| Post-change (T+0 to T+24 h) | IT Manager |

### 9.3 Rollback procedure (target: under 5 minutes)

```cmd
:: 1. Restore the dashboard to network-listening
pm2 stop endeavour-dashboard
:: Edit ecosystem.config.js — remove BIND_HOST, or set it to 0.0.0.0
pm2 start endeavour-dashboard --update-env
pm2 save

:: 2. Remove the Windows firewall block
netsh advfirewall firewall delete rule name="Block Node 3456 external"

:: 3. (Optional) Stop the IIS site so the HTTPS path is also disabled
appcmd stop site /site.name:"IT-Dashboard"
```

After these three commands, the old URL `http://10.225.99.173:3456` is fully working again, exactly as before the change.

### 9.4 Rollback communication

A short Teams message goes out from the rollback decision-maker:

> The HTTPS migration was reverted while we investigate. Please use the old address `http://10.225.99.173:3456` for now. We will reschedule.

### 9.5 Post-rollback actions

- Capture full logs (PM2, IIS, Windows Event Viewer) and attach to the change ticket.
- Schedule a post-mortem within 5 working days.
- Update this CR with lessons learned before re-submitting.

### 9.6 Maximum tolerated rollback latency

**5 minutes** from the go-decision to the old URL working again. The PM2 reload is the slowest single step in the sequence.

---

## 10. POST-IMPLEMENTATION REVIEW (T+7 days)

To be filled in after the change has settled.

- [ ] Number of users who reported login issues:
- [ ] Number of legacy-URL connection attempts seen in firewall logs (helps decide when to retire the redirect early or extend it):
- [ ] Certificate renewal calendar entry created for **<expiry date − 30 days>**:
- [ ] Security headers re-verified at T+24 hours and T+7 days:
- [ ] Documentation sweep completed (SharePoint, wiki, email signatures, scripts):
- [ ] Lessons learned recorded in the change ticket:

---

## 11. APPROVAL & SIGN-OFF

| Role | Name | Decision | Date | Signature |
|---|---|---|---|---|
| Submitter | (Dashboard team lead) | Submit | | |
| Implementer | Mohamed | Accept | | |
| Security owner | Cezar (NGANSOP NGUEPKAP) | Approve | | |
| Accountability | Alexis (TERNOY) | Approve | | |
| IT Manager | | Approve / Reject | | |
| CAB chair | | CAB approved on | | |

---

## 12. REFERENCED FILES

| File | Purpose |
|---|---|
| `iis/web.config` | IIS configuration deployed in step 5 — defines the routing rule and the security headers |
| `docs/INTERNAL_TLS_SETUP.md` | Implementer's long-form runbook (more detailed version of §6) |
| `server.js` | Dashboard's main code file — already patched to read the local-only setting and to send the HSTS header. Committed in git as `b85e30f`, **not deployed** until this CR is approved |
| `_deploy.cmd` | Auto-generated script that copies the three files above to the production share `Z:\` |

---

## 13. GLOSSARY

For non-specialist readers; every technical term used above is defined here.

| Term | Means |
|---|---|
| **HTTP** | The plain (un-encrypted) protocol of the web — what the current dashboard URL uses |
| **HTTPS** | The encrypted version of HTTP — what the new dashboard URL uses |
| **TLS** (Transport Layer Security) | The encryption layer that turns HTTP into HTTPS. SSL is the older name |
| **TLS certificate** | A signed file proving a server's identity. Required for HTTPS |
| **Internal Certificate Authority (PKI)** | The corporate team that issues certificates for internal hostnames |
| **`.pfx` file** | The format the certificate is delivered in — a single file bundling the certificate and its private key, password-protected |
| **DNS hostname / FQDN** | A friendly name like `itops-dashboard.edv-ops.com` that the network resolves to the server's IP |
| **DNS A-record** | The entry that maps the hostname to the IP |
| **IIS** (Internet Information Services) | Microsoft's web server, built into Windows Server. The new HTTPS entry point |
| **URL Rewrite** | Free Microsoft IIS add-on that lets `web.config` route incoming URLs |
| **Application Request Routing (the routing module, ARR)** | Free Microsoft IIS add-on that pairs with URL Rewrite and forwards requests to a backend service. Together they let IIS act as a reverse proxy |
| **Reverse proxy** | Architectural pattern: the public-facing server (IIS) hides the real application server (Node.js) behind it |
| **Node.js** | The runtime that powers the dashboard. Existing — unchanged by this work |
| **PM2** | A small program that keeps the dashboard running 24/7 and restarts it on crash. Existing — unchanged |
| **HSTS** (HTTP Strict Transport Security) | A response header telling browsers "always use HTTPS for this hostname for the next year" |
| **SNI** (Server Name Indication) | A TLS feature letting one IP host multiple HTTPS sites; required when binding the certificate to the IIS site |
| **127.0.0.1 / localhost / loopback** | The special address meaning "this same machine, local only" — only the same computer can connect |
| **Bind / Binding** | In IIS: the link between a website and a hostname + port + certificate. In Node.js: the network interface the application listens on |
| **`web.config`** | The XML file that configures an IIS website. Lives in the site folder |
| **Remote Desktop (RDP)** | Protocol used to log in graphically to the Windows Server from another machine |
| **MSI** | The standard Windows installer file format |
| **Change Advisory Board (CAB)** | The forum that reviews and approves changes like this one |
| **RACI** | Responsible / Accountable / Consulted / Informed — table format used in §4 |
| **T+0, T-15, T+10** | Times relative to T-zero, the moment the implementation window opens. T+10 = ten minutes after; T-15 = fifteen minutes before |

---

*Document version 2.5 — installer staging path corrected (`C:\Apps\SDP-Dashboard\Installers\` so the dev laptop can push via `Z:\Installers\`). Change ID `CH-273`. FQDN `itops-dashboard.edv-ops.com`. Corresponds to commit `b85e30f`. Update version + date on every revision.*
