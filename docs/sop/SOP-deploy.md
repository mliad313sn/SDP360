# SOP — Deployment (ZIP package, pm2, deploy marker)

Moved verbatim from `CLAUDE.md` on 2026-10-22 (SDP-DASH-2.0 step 5, lot 5.5). `CLAUDE.md` is now an index; edit THIS file.

---

### Deploy commands — ZIP package model (2026-07-08+; the Z:\ xcopy model is RETIRED)

Prod deploys are now done with a **self-contained ZIP** copied to the server —
**no `Z:` drive mapping**. The workflow:

```cmd
:: 1) DEV BOX — build the package (post-commit regenerates _deploy.cmd to do this)
_deploy.cmd
::    → runs tools\deploy\make-deploy-zip.ps1
::    → produces  sdp-deploy_<sha>_<stamp>.zip  in the repo root
::    (every file changed since .git/last-deployed, at its repo-relative path
::     under files\, + DELETIONS.txt + MANIFEST.txt + _apply_on_prod.cmd)

:: 2) copy the .zip to the PROD server, extract it anywhere, then FROM the extracted folder:
_apply_on_prod.cmd
::    → xcopy files\* into C:\Apps\SDP-Dashboard  (override with SDP_PROD_DIR)
::    → processes DELETIONS.txt

:: 3) PROD — restart (server.js + boot-cached HTML need it; render.py is copy-only)
_pm2_restart_prod.cmd          :: pm2 stop -> timeout /t 5 -> start  (NOT reload)
```

Then each user presses **Ctrl+F5** once. The packager advances
`.git/last-deployed` to HEAD after building the ZIP. Dev-only paths are excluded
(`iis/`, `docs/`, `tools/deploy/`, `tools/exec-pptx/{fixtures,refs}/`, the ZIP +
`_deploy.cmd`/`_apply_on_prod.cmd` themselves).

> Claude CAN build the ZIP itself (PowerShell tool → `make-deploy-zip.ps1`), but
> **cannot copy it to prod or run pm2** — the user does steps 2-3 on the server.
> The old `Z:\` SMB path is no longer used for deploys.

---


## Deployment Steps — ZIP package (2026-07-08+)

```cmd
:: 1. DEV BOX — build the deploy package (post-commit regenerates _deploy.cmd)
_deploy.cmd
::    → tools\deploy\make-deploy-zip.ps1 → sdp-deploy_<sha>_<stamp>.zip (repo root)

:: 2. copy the .zip to the PROD server, extract anywhere, run FROM the extracted folder:
_apply_on_prod.cmd
::    → xcopy files\* into C:\Apps\SDP-Dashboard  (+ processes DELETIONS.txt)

:: 3. PROD — restart (server.js + boot-cached HTML need it; render.py is copy-only)
_pm2_restart_prod.cmd          :: pm2 stop -> timeout /t 5 -> start (NOT reload — EADDRINUSE trap)

:: If EADDRINUSE crash-loop (orphan on :3456), recover with:
_pm2_recover_prod.cmd

:: 4. Verify (on prod, in C:\Apps\SDP-Dashboard\)
node -e "require('./server.js')" 2>&1 | head -3    :: or just check pm2 status + Ctrl+F5
```

Then each user presses **Ctrl+F5** once. `pm2 reload` is NOT used (race →
EADDRINUSE crash-loop; always stop→wait→start).

### Auto-deploy via git post-commit hook

A post-commit hook at `.git/hooks/post-commit` (in the main repo, shared by all
worktrees) regenerates `_deploy.cmd` in the worktree root on every commit. Since
2026-07-08 `_deploy.cmd` is a **thin wrapper** that runs the committed
PowerShell packager `tools/deploy/make-deploy-zip.ps1`. Running it builds a
**self-contained ZIP** — `sdp-deploy_<sha>_<stamp>.zip` — of every file changed
since the last deploy (cumulative), at its repo-relative path under `files\`,
plus `DELETIONS.txt`, `MANIFEST.txt`, and the `_apply_on_prod.cmd` installer.
**No `Z:` mapping needed.**

The packager reads the `.git/last-deployed` marker (fallback `7fb62d9`, the last
confirmed prod deploy) and diffs `<marker>..HEAD`. **It does NOT advance the marker**
(re-verified 2026-09-05 — `make-deploy-zip.ps1` only reads it): after the user confirms the
apply on prod, run `tools\deploy\mark-deployed.cmd` on the dev box, which writes HEAD into
the marker. So packaging is NOT "this is the deploy" — marking is. ⚠️ Corollary: if a ZIP was
hand-stripped of some files before applying (e.g. the frozen tracker commits, 2026-09-04) and
the user then marks HEAD, those files fall **behind the marker** and must be packaged by hand later.

After Claude commits, output looks like:
```
[deploy] _deploy.cmd will package 8 file(s) + 0 deletion(s) since <sha> into a ZIP.
[deploy] Run it (cmd.exe) -> sdp-deploy_*.zip -> copy to prod -> _apply_on_prod.cmd -> _pm2_restart_prod.cmd
```

**On prod**, `_apply_on_prod.cmd` (bundled in the ZIP) xcopies `files\*` into
`C:\Apps\SDP-Dashboard` (override via `SDP_PROD_DIR`), processes deletions, then
reminds you to run `_pm2_restart_prod.cmd`. `_deploy.cmd`, `_apply_on_prod.cmd`
and `sdp-deploy_*.zip` are all gitignored.

> Claude CAN build the ZIP itself (PowerShell tool → `make-deploy-zip.ps1`), but
> cannot copy it to prod or run pm2 — the user does steps 2-3 on the server.

**Skipped paths (dev-only, never deployed to Z:\):** The hook's
`SKIP_PREFIXES` regex (around line 68) excludes paths that exist in
git but don't belong on prod. Current list:

| Pattern | Why |
|---|---|
| `^iis/` | IIS web.config — installed location, not SMB |
| `^_deploy\.cmd$` | The script the hook just wrote |
| `^docs/` | Dev/internal docs (TRACKER_DB_SCHEMA, handoffs, ADRs) |
| `^tools/exec-pptx/fixtures/` | Test payloads (kpis-*.json) — dev only |
| `^tools/exec-pptx/refs/` | Reference decks + integration guides — dev only |
| `^tools/exec-pptx/INTEGRATION_` | The roadmap MD next to refs/, also dev only |

Add a new line to `SKIP_PREFIXES` when you spot another tracked
file that has no business on prod. The hook lives at
`.git/hooks/post-commit` and is NOT version-controlled — re-apply
the exclusions if the worktree is wiped or someone clones fresh.

Skip auto-deploy for a single commit:
```cmd
git commit --no-verify -m "..."
```

---
