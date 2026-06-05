# CH-273 — Rollout & Backout Checklist

**Hostname:** `itops-dashboard.edv-ops.com`
**Server:** `ABJ-SRV-012` (Windows Server, Abidjan)
**Cert:** wildcard `*.edv-ops.com` (existing — copy of master delivered by PKI as `.pfx`)
**Architecture:** IIS reverse proxy → Node.js (PM2) on same server, loopback only

This document is the implementer's quick-card. The full Change Request is `docs/CHANGE_REQUEST_HTTPS_LOGIN.md`. The detailed rationale lives there; this file is the copy-paste runbook.

---

## ⚠ Where each command runs — read this first

You operate from **two machines**, each with a different view of the production filesystem:

| Machine | Used for | Sees the production folder as |
|---|---|---|
| 💻 **Your dev laptop** (`C:\Users\Admin\Documents\SDP-Dashboard\.claude\worktrees\busy-kirch-2a4176`) | Editing files in the worktree, pushing to prod via SMB | `Z:\…` (network mount) |
| 🖥 **Production server `ABJ-SRV-012`** (RDP session) | Installing IIS, running PM2 commands, configuring the IIS site | `C:\Apps\SDP-Dashboard\…` (local disk) |

The same file appears at **two paths** depending on which machine you're on:

```
worktree (dev)     →     Z:\iis\web.config (dev's view of prod)     =     C:\Apps\SDP-Dashboard\iis\web.config (prod's view)
```

Every step below is tagged 💻 **DEV LAPTOP** or 🖥 **PROD via RDP**. Keep two windows open: a cmd.exe on your laptop, and an RDP session to `ABJ-SRV-012`.

---

## 0. Phase plan — work splits in three parts

| Phase | Where | When | User impact |
|---|---|---|---|
| **A — Pre-window prep** (steps 1–11) | 💻 + 🖥 | Anytime | None |
| **B — Cutover** (steps 12–17) | 💻 + 🖥 + user laptop | Maintenance window | ~30 s when PM2 reloads |
| **C — Comms & sign-off** (steps 18–19) | 💻 + email | After Phase B | None |

Cert delivery from PKI is the only blocker between Phase A and Phase B.

---

## 1. Pre-flight checklist (must be ✅ before starting Phase A)

```
[ ] CAB approval recorded (CH-273)
[ ] DNS verified from a domain-joined laptop (NOT the server itself):
        nslookup itops-dashboard.edv-ops.com    → returns 10.225.99.173
        ping     itops-dashboard.edv-ops.com    → returns 10.225.99.173
[ ] Wildcard .pfx delivered, password received via separate channel
    (Teams DM or vault), file copied to C:\Certs\edv-ops-wildcard.pfx on ABJ-SRV-012
[ ] Cert chain verified inside the .pfx (root + intermediate + leaf):
        certutil -dump -p <pfx-password> "C:\Certs\edv-ops-wildcard.pfx"
[ ] Admin RDP access to ABJ-SRV-012 confirmed
[ ] Backups (run from the dev laptop's cmd.exe, where Z:\ exists):
        if not exist Z:\backups mkdir Z:\backups
        xcopy "Z:\server.js"           "Z:\backups\server.js.YYYY-MM-DD.bak*"           /Y
        xcopy "Z:\ecosystem.config.js" "Z:\backups\ecosystem.config.js.YYYY-MM-DD.bak*" /Y
[ ] EN+FR user comms drafted (templates in CR §8.4)
[ ] Maintenance window announced 48h in advance via email + Teams
[ ] Rollback decision-maker named, on call during Phase B
```

---

## 2. PHASE A — Pre-window preparation (no user impact, ~25 min)

### Step 1 — 💻 DEV LAPTOP — Push `web.config` and updated `server.js` to prod

Open **cmd.exe on your laptop** (Claude's sandbox cannot see `Z:\` — you run these yourself):

```cmd
:: Create the iis folder on prod (via the network share)
if not exist Z:\iis mkdir Z:\iis

:: Push the IIS reverse-proxy config
xcopy "C:\Users\Admin\Documents\SDP-Dashboard\.claude\worktrees\busy-kirch-2a4176\iis\web.config" "Z:\iis\" /Y

:: Push the patched server.js (BIND_HOST + trust proxy + HSTS middleware)
xcopy "C:\Users\Admin\Documents\SDP-Dashboard\.claude\worktrees\busy-kirch-2a4176\server.js" "Z:\" /Y

:: Verify
dir Z:\iis\
dir Z:\server.js
```

Expected: `web.config` (~8 KB) listed under `Z:\iis\`, and the updated `server.js` at `Z:\`.

> Tip: if you have committed all changes, `_deploy.cmd` from your worktree folder does the same thing automatically (post-commit hook generates it).

### Step 2 — 🖥 PROD via RDP — Confirm the files landed

RDP into `ABJ-SRV-012`, open cmd.exe:

```cmd
dir C:\Apps\SDP-Dashboard\iis\web.config
dir C:\Apps\SDP-Dashboard\server.js
findstr "itops-dashboard" C:\Apps\SDP-Dashboard\iis\web.config
findstr "BIND_HOST"        C:\Apps\SDP-Dashboard\server.js
```

Expected: both files exist; `findstr` lines confirm `itops-dashboard.edv-ops.com` is in `web.config` and `BIND_HOST` is in `server.js`. **If either file is missing, go back to Step 1 — don't proceed.**

### Step 3 — 🖥 PROD via RDP — Confirm ports 80 / 443 are free

```cmd
netstat -ano | findstr ":80 "
netstat -ano | findstr ":443 "
```

Expected: no `LISTENING` lines. Outbound connections (high source port → :443 remote, e.g. Microsoft Azure traffic) are normal — ignore them. If anything is `LISTENING` on `0.0.0.0:80` or `0.0.0.0:443`, **STOP** and investigate.

### Step 4 — 🖥 PROD via RDP — Install the IIS role

PowerShell as administrator:

```powershell
Install-WindowsFeature -Name Web-Server -IncludeManagementTools
```

Expected: completes in 2–4 minutes, prints `Success: True, Restart Needed: No`.

Verify:

```powershell
Get-WindowsFeature Web-Server | Format-Table Name, InstallState
```

Expected: `InstallState = Installed`.

### Step 5 — 🖥 PROD via RDP — Remove the Default Web Site

```cmd
appcmd stop site /site.name:"Default Web Site"
appcmd delete site /site.name:"Default Web Site"
netstat -ano | findstr ":80 "
```

Last line should be empty (no listener on port 80 now).

### Step 6 — Stage and install URL Rewrite 2.1

The two IIS add-on installers (URL Rewrite, ARR) need to land on the prod server. The cleanest path is to download on the dev laptop and push them via `Z:\Installers\` — that way the prod server doesn't need direct internet to `iis.net`.

#### 6a — 💻 DEV LAPTOP — download + push the URL Rewrite installer

Download once from `https://www.iis.net/downloads/microsoft/url-rewrite` to `C:\Users\Admin\Downloads\` on the dev laptop, then from `cmd.exe`:

```cmd
if not exist Z:\Installers mkdir Z:\Installers
xcopy "C:\Users\Admin\Downloads\rewrite_amd64_en-US.msi" "Z:\Installers\" /Y
```

#### 6b — 🖥 PROD via RDP — install URL Rewrite

```cmd
dir C:\Apps\SDP-Dashboard\Installers\
msiexec /i "C:\Apps\SDP-Dashboard\Installers\rewrite_amd64_en-US.msi" /quiet /norestart
```

> **If `ABJ-SRV-012` has direct internet access** to `iis.net`, you can skip 6a and download the `.msi` directly on the server (Edge → iis.net → save anywhere, e.g. `C:\Users\<admin>\Downloads\`) and adjust the `msiexec` path accordingly.

### Step 7 — Stage and install Application Request Routing 3.0

#### 7a — 💻 DEV LAPTOP — download + push the ARR installer

Download once from `https://www.iis.net/downloads/microsoft/application-request-routing` (pick the x64 installer) to `C:\Users\Admin\Downloads\` on the dev laptop, then from `cmd.exe`:

```cmd
xcopy "C:\Users\Admin\Downloads\requestRouter_amd64.msi" "Z:\Installers\" /Y
```

#### 7b — 🖥 PROD via RDP — install ARR

```cmd
msiexec /i "C:\Apps\SDP-Dashboard\Installers\requestRouter_amd64.msi" /quiet /norestart
```

Verify both modules: open IIS Manager (`inetmgr`) → click server node → **Modules**. You should see `RewriteModule` and several ARR-related modules.

### Step 8 — 🖥 PROD via RDP — Enable the reverse-proxy switch in ARR (GUI)

In IIS Manager:

1. Click the **server node** (top of the left tree)
2. In the centre pane, double-click **Application Request Routing Cache**
3. Right-hand **Actions** pane → **Server Proxy Settings…**
4. Tick **✓ Enable proxy**
5. Leave every other option at default → **Apply**

### Step 9 — 🖥 PROD via RDP — Import the wildcard certificate

In IIS Manager:

1. Server node → double-click **Server Certificates**
2. Right-click the empty pane → **Import…**
3. Browse to `C:\Certs\edv-ops-wildcard.pfx`
4. Enter the password (from PKI)
5. Store: **Personal** (default)
6. ✓ **Allow this certificate to be exported** (useful for backup)
7. **OK**

Verify it appears as `*.edv-ops.com`. Check the expiration date is more than 30 days in the future; if not, alert PKI before binding.

### Step 10 — 🖥 PROD via RDP — Create the IIS site

In IIS Manager:

1. Right-click **Sites** → **Add Website**
2. Fill in:
   - **Site name:** `IT-Dashboard`
   - **Physical path:** `C:\Apps\SDP-Dashboard\iis`   *(this is where Step 1 deposited `web.config`)*
   - **Binding type:** `https`
   - **IP address:** `All Unassigned`
   - **Port:** `443`
   - **Hostname:** `itops-dashboard.edv-ops.com`
   - **✓ Require Server Name Indication**
   - **SSL certificate:** select the wildcard cert (`*.edv-ops.com`)
3. Click **OK**

Verify:

```cmd
netstat -ano | findstr ":443 "
appcmd list sites
```

Expected: new `LISTENING` line on `0.0.0.0:443`, and `IT-Dashboard` site shown as `Started`.

### Step 11 — 👤 USER LAPTOP — Phase A smoke test (still no user impact)

From a domain-joined laptop on the corporate LAN:

```
https://itops-dashboard.edv-ops.com   →  green padlock + dashboard login page  ✅
http://10.225.99.173:3456              →  still loads (Node not yet locked down)  ✅
```

This proves the IIS reverse proxy works end-to-end while the legacy URL is still up — zero impact on users. **If HTTPS doesn't load, STOP and fix before going to Phase B** (don't lock Node down).

Common Phase A failures:
- 502 from IIS → ARR proxy not enabled (Step 8) or Node not running (`pm2 status` on prod)
- 404 → `web.config` missing or wrong physical path on the IIS site
- Cert warning → wrong cert bound, or browser doesn't trust the corporate root CA
- Connection refused → site not started (`appcmd start site /site.name:"IT-Dashboard"`)

---

## 3. PHASE B — Cutover (the maintenance window, ~10 min, ~30 s downtime)

Announce on Teams: *"Starting CH-273 cutover — brief dashboard interruption expected."*

### Step 12 — 🖥 PROD via RDP — Pre-cutover sanity check

```cmd
pm2 status
curl http://localhost:3456/health
```

Expected: `endeavour-dashboard online`, `200 OK`.

### Step 13 — 🖥 PROD via RDP — Edit `ecosystem.config.js` to add `BIND_HOST`

Edit `C:\Apps\SDP-Dashboard\ecosystem.config.js` (use Notepad, VS Code, or whatever editor is on the prod server). Add **one line** to the `env` block:

```js
module.exports = {
  apps: [{
    name: 'endeavour-dashboard',
    script: 'server.js',
    env: {
      PORT: 3456,
      BIND_HOST: '127.0.0.1',          // ← add this line
      // ... existing env vars unchanged ...
    }
  }]
};
```

Save the file.

### Step 14 — 🖥 PROD via RDP — Reload PM2 with the new env (THE 30-SECOND DOWNTIME STEP)

```cmd
pm2 reload endeavour-dashboard --update-env
pm2 save
```

### Step 15 — Verify lockdown took effect

🖥 **From the prod server:**
```cmd
curl http://localhost:3456/health
```
Expected: `200 OK` (Node is alive on loopback).

👤 **From any user laptop on the corporate LAN:**
```
http://10.225.99.173:3456              →  connection refused / timeout  ✅ (CORRECT)
https://itops-dashboard.edv-ops.com    →  still loads via IIS  ✅
```

### Step 16 — 🖥 PROD via RDP — Add the Windows firewall safety net

```cmd
netsh advfirewall firewall add rule name="Block Node 3456 external" ^
  dir=in protocol=TCP localport=3456 remoteip=!127.0.0.1 action=block
```

Verify the rule exists:

```cmd
netsh advfirewall firewall show rule name="Block Node 3456 external"
```

### Step 17 — 👤 USER LAPTOP — Full verification checklist

From a domain-joined laptop on the corporate LAN:

```
[ ] https://itops-dashboard.edv-ops.com — green padlock, no cert warning
[ ] http://10.225.99.173:3456 — connection refused / timeout
[ ] http://itops-dashboard.edv-ops.com — auto-rewrites to HTTPS (HSTS effect; second visit)
[ ] DevTools → Network → response headers contain ALL of:
    [ ] Strict-Transport-Security: max-age=31536000; includeSubDomains
    [ ] X-Frame-Options: DENY
    [ ] X-Content-Type-Options: nosniff
    [ ] Referrer-Policy: strict-origin-when-cross-origin
[ ] Login works with existing credentials (test super_admin)
[ ] Helpdesk dashboard charts populate
[ ] Reports → Weekly PPTX downloads, opens cleanly in PowerPoint
[ ] Reports → Monthly per-site PPTX downloads, opens cleanly
[ ] Reports → All-Sites Monthly PPTX downloads, opens cleanly
[ ] Activity Tracker page loads, admin can save monthly inputs
[ ] One user logged in per role: super_admin, executive, admin, editor, viewer
[ ] Server log spot-check: req.protocol = "https", req.ip = real client IP (not 127.0.0.1)
[ ] PM2 status: endeavour-dashboard online with 0 restarts during cutover
```

If any test on lines 1–11 fails on a critical path → **BACKOUT (§4 below)**.

---

## 4. BACKOUT PLAN (≤ 5 minutes)

### Backout triggers — ANY ONE of these triggers a rollback decision

```
[ ] Step 11 Phase A smoke test — HTTPS doesn't load within 5 min of finishing Step 10
[ ] Step 14 — Node fails health check after PM2 reload
[ ] Step 17 — any failure on test lines 1–11 above
[ ] Post-cutover — >3 users report unable to reach dashboard within 24h
[ ] Unhandled exception or 502 spike in IIS / PM2 logs
```

### Decision authority

| Phase | Decides |
|---|---|
| Phase A (no user impact) | Implementer can decide to back out or fix-forward |
| Phase B (user impact) | Named rollback decision-maker, in consultation with IT Manager |
| Post-cutover (T+0 to T+24h) | IT Manager |

### Backout commands

#### B1 — 🖥 PROD via RDP — Restore Node to all-interfaces binding (~30 s)

Edit `C:\Apps\SDP-Dashboard\ecosystem.config.js` — **remove** the `BIND_HOST: '127.0.0.1'` line you added in Step 13 (or set it to `'0.0.0.0'`). Save.

```cmd
pm2 reload endeavour-dashboard --update-env
pm2 save
```

#### B2 — 🖥 PROD via RDP — Remove the firewall block

```cmd
netsh advfirewall firewall delete rule name="Block Node 3456 external"
```

#### B3 — 🖥 PROD via RDP — Stop the IIS site

```cmd
appcmd stop site /site.name:"IT-Dashboard"
```

After these three commands `http://10.225.99.173:3456` works exactly as before the change.

### Backout verification

👤 From a user laptop:

```
[ ] http://10.225.99.173:3456 — loads, login works
[ ] https://itops-dashboard.edv-ops.com — no longer responds (or 503)
[ ] PM2 status (on prod): endeavour-dashboard online
```

### Backout communication

Send to all users via Teams (rollback decision-maker is responsible):

> The HTTPS migration was reverted while we investigate. Please use the old URL `http://10.225.99.173:3456` for now. We will reschedule.

### Important — do NOT uninstall IIS as part of routine backout

Phase A artefacts (IIS role, URL Rewrite, ARR, the IIS site, the imported cert) are **dormant** when the IIS site is stopped — they don't affect Node. Leave them in place; they'll be ready for a clean re-attempt. Uninstalling IIS requires a server reboot and is only justified if CAB rejects re-attempting altogether.

If a complete rollback to the pre-change state is mandated:

```powershell
:: WARNING — only do this if explicitly required
appcmd delete site /site.name:"IT-Dashboard"

:: Find and remove the wildcard cert
Get-ChildItem Cert:\LocalMachine\My | Where-Object { $_.Subject -match "edv-ops.com" }
:: copy the thumbprint, then:
:: Remove-Item Cert:\LocalMachine\My\<thumbprint>

msiexec /x "C:\Apps\SDP-Dashboard\Installers\requestRouter_amd64.msi" /quiet
msiexec /x "C:\Apps\SDP-Dashboard\Installers\rewrite_amd64_en-US.msi" /quiet
Uninstall-WindowsFeature -Name Web-Server -IncludeManagementTools
:: This last one DOES require a server reboot.
```

### Maximum tolerated rollback latency

**5 minutes** from go-decision to old URL working again. The PM2 reload is the slowest single step.

---

## 5. PHASE C — Comms & sign-off

### Step 18 — 💻 DEV LAPTOP — User announcement (T+30 min after Phase B passes)

Send pre-approved EN + FR notice via email + Teams (templates in CR §8.4).

### Step 19 — Sign-off checklist

```
[ ] Email Cezar (CC: Alexis) confirming security finding closed. Attach:
    [ ] Screenshot: green padlock on https://itops-dashboard.edv-ops.com
    [ ] Screenshot: DevTools showing Strict-Transport-Security + X-Frame-Options
    [ ] Screenshot: failed connection to http://10.225.99.173:3456 from user laptop
[ ] Update CLAUDE.md with the new URL: https://itops-dashboard.edv-ops.com
[ ] Mark CH-273 Implemented in CAB tracker
[ ] Add cert renewal calendar entry for: <wildcard expiry date − 30 days>
[ ] Request PKI to add ABJ-SRV-012 to the wildcard inventory
[ ] Update internal SharePoint / wiki bookmarks with the new URL
```

---

## 6. T+7 days — Post-implementation review

```
[ ] User-reported login issues count:
[ ] Legacy-URL connection attempts in firewall logs (informs redirect retirement):
[ ] HSTS header re-verified at T+24h and T+7d:
[ ] Documentation sweeps complete (SharePoint, wiki, email signatures, scripts):
[ ] Cert renewal calendar entry confirmed in IT team's shared calendar:
[ ] Lessons learned recorded in CAB ticket:
```

---

## 7. Quick reference — cheat sheet

### 💻 Run on the dev laptop (cmd.exe)

| Need | Command |
|---|---|
| Push web.config to prod | `xcopy "C:\Users\Admin\Documents\SDP-Dashboard\.claude\worktrees\busy-kirch-2a4176\iis\web.config" "Z:\iis\" /Y` |
| Push server.js to prod | `xcopy "C:\Users\Admin\Documents\SDP-Dashboard\.claude\worktrees\busy-kirch-2a4176\server.js" "Z:\" /Y` |
| Use auto-deploy | `_deploy.cmd` (from worktree folder, after commit) |
| Inspect prod files via Z: | `dir Z:\iis\` / `dir Z:\backups\` |

### 🖥 Run on the prod server (`ABJ-SRV-012`, RDP)

| Need | Command |
|---|---|
| Check ports | `netstat -ano \| findstr ":80 "` / `:443 ` |
| Install IIS role | `Install-WindowsFeature -Name Web-Server -IncludeManagementTools` |
| Remove default site | `appcmd delete site /site.name:"Default Web Site"` |
| Stop dashboard site (rollback) | `appcmd stop site /site.name:"IT-Dashboard"` |
| Start dashboard site | `appcmd start site /site.name:"IT-Dashboard"` |
| List IIS sites | `appcmd list sites` |
| PM2 reload + save | `pm2 reload endeavour-dashboard --update-env && pm2 save` |
| PM2 status | `pm2 status` |
| Local health check | `curl http://localhost:3456/health` |
| Add firewall block | `netsh advfirewall firewall add rule name="Block Node 3456 external" dir=in protocol=TCP localport=3456 remoteip=!127.0.0.1 action=block` |
| Remove firewall block | `netsh advfirewall firewall delete rule name="Block Node 3456 external"` |
| Cert expiration | `Get-ChildItem Cert:\LocalMachine\My \| Where-Object { $_.Subject -match "edv-ops.com" } \| Select Subject, NotAfter` |

---

*Document version 2.1 — companion to CHANGE_REQUEST_HTTPS_LOGIN.md (CR v2.5). Wildcard `*.edv-ops.com` scenario, IIS on prod server `ABJ-SRV-012`, MSI installers staged at `C:\Apps\SDP-Dashboard\Installers\` (= `Z:\Installers\` from dev laptop).*
