# Endeavour Mining — IT Dashboard
## Docker Installation Guide

---

## REQUIREMENTS

| Tool | Download | Why |
|------|----------|-----|
| Docker Desktop | https://www.docker.com/products/docker-desktop | Runs the server in a container |
| A `.env` file | See Section 2 below | Your Zoho credentials |

**That's it.** You don't need Node.js, Python, or anything else installed.

---

## QUICK START (3 steps)

### Step 1 — Get the files

You should have received a ZIP file. Extract it anywhere, e.g.:
```
C:\endeavour-dashboard\
```

### Step 2 — Create your .env file

Open the folder. You will see `.env.example`. Make a copy called `.env`:

```
# In Windows Explorer:
Right-click .env.example → Copy → Paste → Rename to .env

# Or in Command Prompt:
copy .env.example .env
```

Open `.env` in Notepad and fill in:

```env
ZOHO_CLIENT_ID=your_client_id
ZOHO_CLIENT_SECRET=your_client_secret
ZOHO_REFRESH_TOKEN=your_refresh_token
WORKSPACE_ID=106803000000002012
ORG_ID=878991289
ZOHO_SURVEY_ID=          ← leave blank for now, fill in after first run
PORT=3456
```

> 💡 **Where do I get these?** Ask your IT Manager for the .env values, or see Section 4 below.

### Step 3 — Start the dashboard

1. Make sure **Docker Desktop is running** (look for the whale icon in your taskbar)
2. Double-click **`start.bat`**
3. The first run downloads the server components (~2 minutes)
4. Your browser opens automatically at **http://localhost:3456**

---

## DAILY USE

| Action | How |
|--------|-----|
| Start dashboard | Double-click `start.bat` |
| Stop dashboard | Double-click `stop.bat` |
| Check if running | Open http://localhost:3456/health |
| View logs | `docker compose logs -f` in Command Prompt |
| Update dashboard HTML | Replace `public\dashboard_v3.html`, then restart |

---

## GETTING YOUR ZOHO CREDENTIALS

You need **4 values** from Zoho.

### ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET

1. Go to https://api-console.zoho.com
2. Find your existing OAuth app (or create one: **Server-based Application**)
3. Copy **Client ID** and **Client Secret**

### ZOHO_REFRESH_TOKEN

This is the most important one. It must be generated with **both** OAuth scopes:

```
ZohoAnalytics.fullaccess
ZohoSurvey.surveys.READ
```

**Steps:**
1. Go to https://accounts.zoho.com/oauth/v2/auth with these parameters:
   ```
   scope=ZohoAnalytics.fullaccess,ZohoSurvey.surveys.READ
   client_id=YOUR_CLIENT_ID
   response_type=code
   redirect_uri=https://www.zoho.com/books        ← any valid redirect
   access_type=offline
   ```
2. Authorize the app
3. Exchange the `code` for a refresh token:
   ```
   POST https://accounts.zoho.com/oauth/v2/token
   ?code=...&client_id=...&client_secret=...
   &redirect_uri=https://www.zoho.com/books
   &grant_type=authorization_code
   ```
4. Copy the `refresh_token` value into your `.env`

> ⚠️ If your token was generated **without** ZohoSurvey.surveys.READ, you must re-generate it. The CSAT/NPS tiles will show "—" until this is done.

### ZOHO_SURVEY_ID

1. Start the server (Step 3 above)
2. Open: http://localhost:3456/api/survey/list
3. Find your IT Helpdesk satisfaction survey in the list
4. Copy the `id` value into `.env` as `ZOHO_SURVEY_ID=`
5. Restart: `docker compose restart`

---

## FOLDER STRUCTURE

```
endeavour-dashboard/
├── 📄 Dockerfile              Server build instructions
├── 📄 docker-compose.yml      Service configuration
├── 📄 package.json            Node.js dependencies list
├── 📄 server.js               Backend proxy server
├── 📄 .env.example            Template — copy to .env and fill in
├── 📄 .env                    ← YOUR CREDENTIALS (keep private, never share)
├── 📄 start.bat               Windows: one-click start
├── 📄 stop.bat                Windows: one-click stop
├── 📄 README_DOCKER.md        This file
└── 📁 public/
    └── 📄 dashboard_v3.html   The dashboard interface
```

---

## DISTRIBUTING TO COLLEAGUES

To give a colleague their own instance:

1. Zip the entire folder **without** the `.env` file:
   ```
   endeavour-dashboard-DIST.zip   ← contains everything except .env
   ```
2. Send them the ZIP + this README
3. They create their own `.env` with **their** Zoho credentials
4. They double-click `start.bat`

Each person has their own isolated instance — no shared server needed.

---

## UPDATING THE DASHBOARD

When a new version of the dashboard is available:

**Update HTML only (no rebuild needed):**
```
1. Replace public\dashboard_v3.html with the new file
2. Hard-refresh browser: Ctrl + Shift + R
```

**Update server code:**
```
1. Replace server.js with the new file
2. docker compose down
3. docker compose build
4. docker compose up -d
```

---

## TROUBLESHOOTING

| Problem | Solution |
|---------|----------|
| "Docker is not running" | Start Docker Desktop from Start Menu, wait for whale icon |
| Dashboard shows "Connecting…" forever | Check http://localhost:3456/health — if error, check .env credentials |
| CSAT tiles show "—" | Set ZOHO_SURVEY_ID in .env (see Section 4), restart |
| Blank charts / no data | Check your ZOHO_REFRESH_TOKEN has both scopes, regenerate if needed |
| Port 3456 already in use | Change PORT=3457 in .env and access http://localhost:3457 |
| Container exits immediately | Run `docker compose logs` to see the error message |

---

## TECHNICAL DETAILS (for IT staff)

- **Base image:** node:20-alpine (~180MB)
- **Network:** Bridge (isolated, only port 3456 exposed)
- **Persistence:** Stateless — no database, no volumes for data
- **Auto-restart:** Enabled (`restart: unless-stopped`)
- **Health check:** GET /health every 30 seconds
- **Logs:** JSON file driver, max 10MB × 5 files = 50MB max log storage
- **Credentials:** Passed via environment variables — never baked into image

To deploy on a Linux server instead of Docker Desktop:
```bash
# Same commands work on Linux with Docker installed
docker compose up -d
```

---

*IT Dashboard v1.0 — Endeavour Mining*
*Built with Zoho Analytics Plus + Zoho Survey + Node.js + Chart.js*
