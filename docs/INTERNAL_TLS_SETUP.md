# Internal TLS Setup — Endeavour Mining IT Dashboard

**Audience:** the IT admin (or sysadmin) doing the one-time IIS + cert install on `ABJ-SRV-012`.

**Goal:** replace `http://10.225.99.173:3456` with `https://itops-dashboard.edv-ops.com` served over TLS by IIS, which proxies to the existing Node app on localhost. After this is done, the Node app is no longer reachable from the network — only IIS is.

This addresses the security finding raised by Cezar (NGANSOP NGUEPKAP) in the Nov 2025 town hall.

---

## Architecture after this setup

```
Browser → https://itops-dashboard.edv-ops.com      port 443  (TLS)
              ↓
            IIS                            (terminates TLS, reverse-proxies)
              ↓
          http://127.0.0.1:3456            (loopback only)
              ↓
            Node.js / PM2                  (the actual dashboard application)
              ↓
          SQLite + Zoho APIs
```

External machines can no longer hit `:3456` directly — Node listens on localhost only.

---

## Prerequisites

Before starting:

| What | Who | Notes |
|---|---|---|
| **DNS A-record**: `itops-dashboard.edv-ops.com` → `10.225.99.173` | Network / AD admin | Domain `edv-ops.com` is the corporate suffix used for IT-Ops services (per change request CH-273). Hostname must resolve from every domain-joined machine on the corporate network. |
| **Certificate** issued by the internal CA | PKI admin | Template = `Web Server` (or equivalent). Subject Common Name = the FQDN above. Subject Alternative Name should also include the FQDN. Validity 1–2 years. |
| **Cert delivered as `.pfx`** with a private-key password | PKI admin | We import the `.pfx` into IIS. If they send `.crt` + `.key` separately, convert with `openssl pkcs12 -export ...` first. |
| **Admin RDP access** to `ABJ-SRV-012` | IT admin | All steps below run on the dashboard server itself. |

---

## Step-by-step

### 1. Install the IIS modules (one-time)

The reverse-proxy needs two free Microsoft modules:

| Module | Download URL | Why |
|---|---|---|
| **URL Rewrite 2.1** | https://www.iis.net/downloads/microsoft/url-rewrite | Lets `web.config` rewrite request paths |
| **Application Request Routing 3.0 (ARR)** | https://www.iis.net/downloads/microsoft/application-request-routing | Adds the actual proxying capability |

Get the `.msi` files onto the prod server. Two options:

**Option A — stage from the dev laptop via the SMB share (recommended if `ABJ-SRV-012` cannot reach `iis.net` directly).** From `cmd.exe` on the dev laptop:

```cmd
if not exist Z:\Installers mkdir Z:\Installers
xcopy "C:\Users\Admin\Downloads\rewrite_amd64_en-US.msi"   "Z:\Installers\" /Y
xcopy "C:\Users\Admin\Downloads\requestRouter_amd64.msi"   "Z:\Installers\" /Y
```

The MSIs now appear on the prod server at `C:\Apps\SDP-Dashboard\Installers\`.

**Option B — download directly on the server.** Open Edge on `ABJ-SRV-012`, browse to the two URLs above, save them anywhere (e.g. `C:\Users\<admin>\Downloads\`).

Then on the prod server (RDP), install both:

```cmd
msiexec /i "C:\Apps\SDP-Dashboard\Installers\rewrite_amd64_en-US.msi"   /quiet /norestart
msiexec /i "C:\Apps\SDP-Dashboard\Installers\requestRouter_amd64.msi"   /quiet /norestart
```

(Adjust paths if you went with Option B.) Accept defaults, no reboot needed.

### 2. Enable the proxy in ARR

1. Open **IIS Manager** (`inetmgr`).
2. Click the server node in the left tree (top of the tree — the host name).
3. Double-click **Application Request Routing Cache**.
4. On the right pane click **Server Proxy Settings…**
5. Tick **✓ Enable proxy**.
6. Leave all other defaults. Click **Apply**.

This is what makes IIS willing to forward requests to a backend server (Node) at all.

### 3. Create the IIS site

1. In IIS Manager, right-click **Sites** → **Add Website**.
2. Fill in:
   - **Site name**: `IT-Dashboard`
   - **Physical path**: `C:\Apps\SDP-Dashboard\iis`  *(this is the repo's `iis/` folder — `web.config` lives here)*
   - **Binding**:
     - Type: **https**
     - IP address: **All Unassigned**
     - Port: **443**
     - Hostname: `itops-dashboard.edv-ops.com` *(the FQDN)*
     - **✓ Require Server Name Indication (SNI)**
     - SSL certificate: leave blank for now (we add it in step 4)
3. Click **OK**. The site is created but won't serve HTTPS yet — that's the next step.

### 4. Import & bind the certificate

#### a. Import the `.pfx`

1. In IIS Manager, click the **server node** (top of tree).
2. Double-click **Server Certificates**.
3. Right-click in the empty pane → **Import…**
4. Browse to the `.pfx` file from PKI.
5. Enter the password.
6. Certificate store: **Personal** (default).
7. **✓ Allow this certificate to be exported** — useful for backups.
8. Click **OK**. The cert appears in the list.

#### b. Bind the cert to the site

1. Click the **IT-Dashboard** site in the left tree.
2. On the right pane click **Bindings…**
3. Select the `https` binding (port 443) → **Edit…**
4. SSL certificate: pick the cert you just imported (named after the FQDN).
5. Click **OK** → **Close**.

The site can now serve HTTPS. Test by browsing to `https://itops-dashboard.edv-ops.com` from a domain-joined machine — you should see a placeholder IIS page (because we haven't put a `web.config` yet).

### 5. Drop in the reverse-proxy `web.config`

`web.config` lives in the worktree on the dashboard team's dev laptop. We push it to the prod server via the SMB share (`Z:\` on the dev laptop = `C:\Apps\SDP-Dashboard\` on prod), then verify it landed.

**On the dev laptop's `cmd.exe`** (Z:\ only exists here):

```cmd
if not exist Z:\iis mkdir Z:\iis
xcopy "C:\Users\Admin\Documents\SDP-Dashboard\.claude\worktrees\busy-kirch-2a4176\iis\web.config" "Z:\iis\" /Y
```

Or simply run `_deploy.cmd` from the worktree folder — the post-commit hook auto-generates a script that does the same `xcopy`.

**Then RDP into ABJ-SRV-012** and confirm the file is at the IIS site's physical path:

```cmd
dir C:\Apps\SDP-Dashboard\iis\web.config
findstr "itops-dashboard" C:\Apps\SDP-Dashboard\iis\web.config
```

> **Path mapping:** the same physical file appears at `Z:\iis\web.config` from the dev laptop and at `C:\Apps\SDP-Dashboard\iis\web.config` on the prod server itself — `Z:\` does **not** exist on the prod box.

That single file tells IIS to forward every request to `http://localhost:3456` with the right `X-Forwarded-*` headers. No restart needed — IIS picks up the change immediately.

Refresh `https://itops-dashboard.edv-ops.com` — the dashboard login page should appear, served over HTTPS, with a green padlock (assuming the corporate CA is trusted on the client machine, which is automatic for domain-joined Windows).

### 6. Lock Node down to localhost-only

Right now Node is still listening on `0.0.0.0:3456`, so anyone on the LAN could bypass IIS and hit the plain-HTTP port directly. Close that:

#### a. Update PM2's environment

Edit the PM2 ecosystem config (or wherever the dashboard is started). Add `BIND_HOST=127.0.0.1` to its env:

```cmd
pm2 stop endeavour-dashboard
set BIND_HOST=127.0.0.1
pm2 start endeavour-dashboard --update-env
pm2 save
```

If you launch via `ecosystem.config.js` instead:

```js
module.exports = {
  apps: [{
    name: 'endeavour-dashboard',
    script: 'server.js',
    env: {
      PORT: 3456,
      BIND_HOST: '127.0.0.1',  // ← add this line
      // ... existing env ...
    }
  }]
};
```

…then `pm2 reload endeavour-dashboard --update-env`.

#### b. Verify

From any machine on the LAN that is **not** the server, try:

```
http://10.225.99.173:3456
```

You should get a connection refused / timeout. That's correct — the port is closed to the network now, only IIS on the same box can reach it.

From the dashboard server itself (RDP'd in):

```
curl http://localhost:3456/health
```

Should still respond — Node is alive, just bound to loopback.

### 7. Add a firewall rule (defense in depth)

Even though Node is now on loopback only, harden the Windows firewall to block external access to port 3456 just in case `BIND_HOST` is ever forgotten:

```cmd
netsh advfirewall firewall add rule name="Block Node 3456 external" dir=in protocol=TCP localport=3456 action=block
```

> **Why no `remoteip=` exception for localhost?** Two reasons: (a) netsh has NO
> negation operator — `remoteip=!127.0.0.1` is INVALID SYNTAX and the command
> fails with "A specified IP address or address keyword is not valid" (this doc
> shipped with that bug until 2026-07-10 — if the rule was "added" back then,
> it actually failed; re-run the corrected command above and verify with
> `netsh advfirewall firewall show rule name="Block Node 3456 external"`);
> (b) it isn't needed — **Windows Firewall never filters loopback traffic**,
> so IIS on the same box keeps reaching `http://localhost:3456` even with a
> blanket block on the port. Verify after adding: `curl http://localhost:3456`
> from the server still answers; `http://<server-ip>:3456` from another
> machine times out.

### 8. Smoke test the end-to-end flow

Tick through this checklist from a normal user laptop on the corporate LAN:

- [ ] `https://itops-dashboard.edv-ops.com` loads with a green padlock — no cert warnings
- [ ] HTTP version `http://itops-dashboard.edv-ops.com` either redirects to HTTPS or refuses (browsers honour HSTS)
- [ ] Direct IP/port `http://10.225.99.173:3456` does **not** load (connection refused)
- [ ] Login works, dashboard renders, charts populate
- [ ] Open DevTools → Network → reload → response headers should include:
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
- [ ] PPTX export still works (weekly site report → ⬇ Weekly PPTX downloads correctly)
- [ ] Activity Tracker page loads + saves work for tracker-editor users

If all eight ticks pass, you're done.

---

## Annual maintenance

| Task | When | How |
|---|---|---|
| **Renew the cert** | ~30 days before expiry | PKI admin issues a new `.pfx`. Repeat step 4 (import + re-bind). Old cert can stay in the store. |
| **Verify HSTS still active** | Quarterly | DevTools → Network → check `Strict-Transport-Security` header is present |
| **Check IIS module updates** | Annually | URL Rewrite + ARR get occasional security patches — re-run the installers |
| **Audit `web.config`** | After any change | Diff against the version in git; the proxy rule and security headers should be unchanged |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| **502.3 Bad Gateway** from IIS | Node isn't running, or it's bound to a different port | `pm2 status` to confirm; check PM2 logs for crashes |
| **502.5 Bad Gateway — proxy** | ARR proxy not enabled (step 2) | Re-do step 2 |
| **Request hangs forever** | Firewall blocking loopback (rare) | Confirm `curl http://127.0.0.1:3456/health` works from the server itself |
| **Cert warning in browser** | Client machine doesn't trust the corporate CA | The CA root must be deployed via Group Policy. PKI admin to verify domain GPO. |
| **`X-Forwarded-Proto` header not arriving at Node** | `<allowedServerVariables>` missing from web.config | Confirm web.config in the repo is unmodified |
| **Login works once, then 401** on refresh | Session token cookies/headers not surviving the proxy hop | We use `X-Report-Token` headers, not cookies — should be fine. Check Node logs for `req.ip` showing `127.0.0.1` (proxy working) vs the real client IP (proxy not working) |
| **Dashboard direct-IP URL still works after step 6** | `BIND_HOST` env var didn't take effect — PM2 caches env | `pm2 delete endeavour-dashboard && pm2 start ecosystem.config.js --env production` |

---

## Rollback

If something goes wrong and the site needs to come back to HTTP for an emergency:

```cmd
pm2 stop endeavour-dashboard
set BIND_HOST=0.0.0.0
pm2 start endeavour-dashboard --update-env
```

Old URL `http://10.225.99.173:3456` works again. Tell users it's temporary and finish the IIS setup before re-locking.

Don't leave the rollback in place for more than a few hours — the security finding remains until HTTPS is back.

---

## Sign-off

Once steps 1–8 pass:

- [ ] Email Cezar (NGANSOP NGUEPKAP) confirming the finding is closed, with screenshots of the green padlock and the security headers in DevTools.
- [ ] Cc Alexis (TERNOY) on the same email — he asked for accountability; closing the loop matters.
- [ ] Update the project's `CLAUDE.md` with the new URL: `https://itops-dashboard.edv-ops.com`.
- [ ] Update any internal documentation, bookmarks, or shortcuts.

The retire-the-old-URL phase: leave a redirect in IIS (or a Windows hosts entry) for a few weeks so anyone with stale bookmarks gets pointed at the new URL automatically. Then sunset the redirect.
