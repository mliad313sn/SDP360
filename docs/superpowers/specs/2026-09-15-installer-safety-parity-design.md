# Installer safety parity (console) — design

**Date:** 2026-09-15 · **Status:** draft for user review · **Scope:** `tools/installer/` only (Setup.bat, Install-SDP.ps1, Manage-SDP.ps1) + `docs/INSTALLER.md`.

## 1. Goal

Bring the SDP installer to the level of operator safety the 4MyPeople installer shows in its
2026-09-15 upgrade log, **without** a GUI (approach A, chosen by the user): the operator must
always see what the installer found, what it will do, what it will destroy, and must type an
exact phrase before anything destructive. Upgrades stay one-menu-choice, backed by the existing
full restore point and automatic rollback.

## 2. What already exists (not redone)

| Guarantee | Where | Kept as is |
|---|---|---|
| Full restore point before Patch/Upgrade/Reinstall (code + `.env` + `data` + blobs + `pg_dump`) | `Install-SDP.ps1` Step5 → `Manage-SDP.ps1 -Backup` | yes |
| Automatic rollback when the app does not come back (pm2 + HTTP probe) | Step7 `Invoke-Rollback` | yes |
| `.env` merged, never overwritten; `data\`, `blobs\`, `SDP-Backups\` never touched | Step6 hard-coded exclusions | yes |
| Downgrade refused unless `-Force` | Step1 | yes |
| Typed phrases `REINSTALL` / `DROPDB` | `Setup.bat :reinstall` | replaced by the shared confirm screen (§4.3) |
| Log + `summary.txt` + `installs.log` | `Complete-Run` | extended (§4.4) |

## 3. Gaps closed by this design

1. No situation detection before the menu — a wrong mode fails late, after elevation, as an error.
2. No visual warning: every destructive prompt is plain text.
3. `DROPDB` / Restore never say what they destroy (row counts, DB size, last backup age).
4. Fresh install on an existing server is a dead end (menu never passes `-Force`) — the user wants a guarded path.
5. No Patch-vs-Upgrade recommendation.
6. No environment header in the log; no before/after data-integrity check.
7. Restore (menu 6) asks only for a file name + `YES`, and takes no safety backup of the state it overwrites.

## 4. Design

### 4.1 `Detect-SDP.ps1` — one situation object, computed once per menu render

New script `tools/installer/Detect-SDP.ps1 -Config <psd1> -BundleRoot <dir> -OutFile <json>`;
writes a single JSON object to `-OutFile` (default `%TEMP%\sdp-situation.json`) and prints
**only** `KEY=VALUE` lines on stdout (cmd's `for /f` loop must never see JSON). Never throws
(every probe is try/catch → `null`), read-only (no writes besides the JSON file, no service
action). Fields:

```
install: { dir, exists, has_server_js, version, has_env, has_node_modules, has_data_dir }
runtime: { pm2_process (online|stopped|absent), port_owner (ours|foreign|free), node_version }
db:      { reachable, exists, size_mb, counts: { sites, weekly_reports, md_meetings,
           insp_inspections, users, assets }, error }
backups: { dir, last_full: { name, age_hours, size_mb } | null, last_db: {…} | null, count }
bundle:  { version, sha, lockfile_same_as_installed (true|false|null) }
disk:    { free_gb }
verdict: { state: 'empty'|'installed'|'partial', recommended: 'fresh'|'patch'|'upgrade'|null,
           downgrade: bool, notes: [ … human-readable one-liners … ] }
```

Rules for `verdict`:
- `empty` = no `server.js` and no `.env` → recommended `fresh`.
- `installed` = `server.js` + `.env` present → `patch` when `lockfile_same_as_installed` is true, `upgrade` when false or unknown. **A DB that is unreachable or absent is a warning inside `installed`, not `partial`** — Install-SDP's upgrade path already tolerates it (sqlite-only or stopped PostgreSQL), so routine patching must stay possible; the note says "database not reachable — counts unavailable, data check will be skipped".
- `partial` = exactly one of `server.js` / `.env` present → recommended `null`, notes explain (e.g. "server.js found but no .env — run E first, or Reinstall").
- `downgrade` = bundle version < installed version (numeric compare; unknown → false + note).

`lockfile_same_as_installed` compares the SHA-256 of the installed `package-lock.json` with the
one **inside `payload\app.zip`** (single entry read via `System.IO.Compression.ZipFile`; the
bundle root only carries `version.json`). Missing on either side → `null` → `upgrade` recommended.

DB counts run through `psql` as the app role from `PG_URL` in `.env` (never the superuser),
with a 10 s timeout; any failure → `db.error` and the confirm screens say "counts unavailable"
instead of guessing zero (the repo's null-not-zero rule).

Besides the JSON (for PowerShell callers), the script emits `KEY=VALUE` lines
(`STATE=`, `RECOMMENDED=`, `DOWNGRADE=`, `DB_REACHABLE=`, `INSTALLED_VER=`, `BUNDLE_VER=`) so Setup.bat reads
the verdict with its existing `for /f … 'KEY='+…` pattern and never re-implements a rule in cmd.
The JSON is written to `%TEMP%\sdp-situation.json` and reused within one Setup.bat session;
it is refreshed after every install / maintenance action returns to the menu (Detect runs
`psql`, `pm2 jlist` and a zip read — not something to repeat on every keystroke).

### 4.2 Setup.bat — situation block + gated menu

At each menu render Setup.bat calls `Detect-SDP.ps1` once and a small renderer
(`Show-Situation.ps1`, same file family) prints a coloured block above the menu:

```
 ── Situation ─────────────────────────────────────────────
  Install    : C:\Apps\SDP-Dashboard   v2.3.1   (pm2 online, port 3456 = ours)
  Database   : sdp_dashboard  1.8 GB   sites 11 · reports 412 · PV 96 · inspections 41 · users 23
  Backups    : last full 3 d ago (sdp-restore_manual_20260912-020011.zip, 640 MB) · 14 kept
  Bundle     : v2.4.0   node_modules changed → Upgrade recommended
 ──────────────────────────────────────────────────────────
```

Colours: green line when healthy, yellow for warnings (`last backup > 7 d`, `port foreign`,
`db unreachable`), red for `downgrade` or `partial`.

The menu is **re-ordered on the 4MyPeople chooser model** (its GUI of 2026-09-15): one plain
sentence of state under the situation block — "SDP Dashboard v2.3.1 is installed and this
package contains v2.4.0." / "Nothing is installed in C:\Apps\SDP-Dashboard." — then three
groups, the recommended action always listed **first** and rendered in green with
`<< recommended`; each entry carries a one-line consequence exactly like the GUI
("Refresh the application. Your data is preserved." / "No database change at all." /
"Re-deploy the current version over the top; DB kept unless asked."):

```
  RECOMMENDED
    2.  Upgrade              Code + node_modules. Database, data and .env preserved.   << recommended
  OTHER
    1.  Patch                Code only. No node_modules or database change at all.
    3.  Reinstall            Re-deploy over the top; DB kept unless you ask to drop it.
    4.  Fresh install        [red]  Overwrites the existing installation's code — confirmation required.
  DATA
    5.  Backup now           Full restore point (code + .env + data + DB dump).
    6.  Restore a previous version      [red]  Overwrites the current state — confirmation required.
    7.  List restore points
  MAINTENANCE
    8 / 9 / E / C            (unchanged)
```

Destructive entries (`6 Restore`, and `3`/`4` when they will overwrite an installation) are
printed in red; non-applicable entries in dark grey with the reason in the line. In the `empty`
state `4 Fresh install` leads the RECOMMENDED group and `D Demo` is listed right under it only
when `payload\demo\*.zip` exists (today's hidden-entry rule). **`Show-Situation.ps1` renders both
the situation block and the grouped, coloured menu from the JSON**; cmd `echo` cannot colour, so
Setup.bat keeps only the `set /p` prompt and the dispatch on the unchanged option numbers.
Choosing a non-applicable entry prints why and returns to the menu **before** any elevation or
script run:

| Situation | 1 Patch | 2 Upgrade | 3 Reinstall | 4 Fresh / D Demo |
|---|---|---|---|---|
| empty | n/a | n/a | n/a | recommended |
| installed | recommended if lockfile same | recommended if lockfile differs | allowed (confirm) | **guarded** (confirm, §4.3) |
| installed, DB unreachable | allowed + yellow note | allowed + yellow note | allowed (confirm); **DROPDB not offered** ("database unreachable — take a backup first") | guarded (confirm) |
| partial | n/a | n/a | allowed (confirm) | guarded (confirm) |
| downgrade | refused → red note "use a newer bundle" (no `-Force` from the menu) |

`D Demo` is `-Fresh -SeedData` and follows the Fresh column exactly.

Option 3 flow: the `reinstall` red screen first; on success Setup.bat asks "Also DROP + recreate
the database? [y/N]" (Enter = keep); only `y` runs the `dropdb` red screen — two consecutive red
screens, both required for a drop.

Cache refresh flag: Setup.bat sets `NEED_DETECT=1` at `:done` (after any action) and clears it
at `:menu` once Detect has run, so an invalid keystroke or a cancelled confirm does not re-run
Detect.

Setup.bat stays the entry point (self-elevation untouched). Colour comes from PowerShell
`Write-Host -ForegroundColor`, never from cmd `color` (which repaints the whole window).

### 4.3 `Confirm-Destructive.ps1` — the one red screen

`tools/installer/Confirm-Destructive.ps1 -Action <reinstall|dropdb|fresh-over-existing|restore> -Situation <json-file> [-Target <name>]`
renders a red banner (white on dark-red background), then:

1. **What will happen**, in one sentence per action, from a fixed table (no free text).
2. **What is at stake**, from the situation object: the DB counts line, DB size, `.env` present,
   last restore point and its age. `restore` adds the restore point's own date and what it contains
   (code / DB dump / data), **derived from the zip's entry list** (presence of `server.js`, `.env`,
   `data\`, `*.sql`) — restore points carry no manifest file and older zips must still work. A
   `sdp-db_*.sql` name (dump only, not restorable by `-Restore`) is rejected before the phrase.
3. **What protects you**: "a full restore point of the CURRENT state is taken first" — true for
   every action because §4.4 puts the backup step **before** any DROP and adds it to the
   fresh-over-existing plan; `restore` says "a `pre-restore` restore point is taken first" (§4.5).
4. **The phrase**: exact, case-sensitive, tied to the target so it cannot be typed by reflex:

| Action | Phrase |
|---|---|
| reinstall | `REINSTALL` |
| dropdb | `DROP <dbname>` (e.g. `DROP sdp_dashboard`) |
| fresh-over-existing | `OVERWRITE <computername>` |
| restore | `RESTORE <yyyymmdd>` — the date is the trailing `_(\d{8})-\d{6}\.zip$` group of `sdp-restore_<tag>_<yyyyMMdd-HHmmss>.zip` (tags such as `pre-v2.4.0` contain digits, so never the first 8 digits); a name without that group → `RESTORE <file name without .zip>` |

Downgrade is never offered from the menu, so it has no action value. `-Action dropdb` exits 1
with the reason on its own when the situation says `db.reachable = false` — the gate holds even
if Setup.bat reaches the "Also DROP…?" question.

Exit code 0 only on an exact match; anything else exits 1 and Setup.bat returns to the menu with
"Cancelled — nothing changed". **Closed or empty stdin → exit 1** (a destructive action is never
confirmed by default); a phrase arriving through a pipe is accepted like a typed one — that is how
the harness in §6 and the existing piped Setup.bat runs work. Setup.bat passes the resulting flags
(`-Reinstall [-ConfirmDataLoss]`, `-Fresh -ForceOverwrite`, `-Restore -Name … -Force`).

`-ForceOverwrite` is a **new** Install-SDP switch distinct from `-Force`: it lifts only the
"fresh into a non-empty dir" refusal, so the downgrade refusal keeps applying on the guarded
path (`-Force` stays the all-purpose CLI override, never used by the menu).

What "fresh-over-existing" does is `Install-SDP -Fresh -ForceOverwrite`: the hard-coded
exclusions still protect `data\`, `blobs\`, `.env` and the DB; the screen says so explicitly
("your database and data folders are NOT deleted; code and node_modules are replaced"). If the
operator wants an empty database they must additionally go through `dropdb`.

### 4.4 Install-SDP.ps1 — environment header, data-integrity check, richer summary

- **Environment header** written to the log at start (mirrors 4MyPeople): timestamp, user,
  computer, OS, PowerShell, free disk, config resolved (dir/port/db), node/npm/psql versions,
  port states. **Never any secret value** — only `(set)` / `(not set)`.
- **Backup BEFORE any destruction (step order change)**: today the `reinstall` plan runs
  Step4 (which DROPs the DB under `-ConfirmDataLoss`) before Step5 (the backup), so the
  "pre-change" restore point would hold an empty database; and the `fresh` plan has no Step5 at
  all, so `-Fresh -Force` over an existing install has neither backup nor rollback. New plans:
  `reinstall` = 1,2,3,**5**,4,4b,6,7 and `fresh-over-existing` (= `-Fresh -ForceOverwrite` with
  `server.js` present) = 1,2,3,**5**,4,4b,6,7. Step5 needs PostgreSQL running for `pg_dump`, and
  it is Step4 (now after it) that starts a stopped `postgresql*` service — so **Step5 itself
  starts the service if it is stopped** before calling `-Backup`, and, whenever the plan carries
  `-ConfirmDataLoss`, **verifies the produced zip contains the DB dump (`*.sql` entry) and `Die`s
  otherwise** ("no database dump in the restore point — refusing to DROP"). `Manage-SDP -Backup`
  treats a failed dump as a warning (sqlite-only installs), which is right for Patch but not
  before a DROP. A plain `fresh` on an empty machine keeps its current plan (nothing to back up).
  Consequence: the rollback path now also exists for fresh-over-existing.
- **Counts reader shared, not duplicated**: the DB-count query lives in one dot-sourced file
  `tools/installer/SdpSituation.ps1` (functions `Get-SdpDbCounts`, `Get-SdpSituation`);
  `Detect-SDP.ps1` is the CLI wrapper and Install-SDP dot-sources the same file for the
  before/after counts.
- **Secrets rule (locked)**: no secret ever travels on a command line the installer builds
  (Windows transcripts and process listings capture it — the 4MyPeople transcript of
  2026-09-15 leaks its PG superuser password this way). Secrets go through `$env:PGPASSWORD`,
  SQL fed on **stdin**, or the questionnaire's masked prompt. Two changes make the rule true:
  (a) the `CREATE ROLE … PASSWORD '…'` fallback in Step4 currently goes through `psql -c` on the
  command line — it moves to stdin (`psql -f -`); (b) the environment header prints `(set)` /
  `(not set)` for every secret. The one documented exception is the `--superpassword` argument of
  the EDB PostgreSQL unattended installer (Step4, fresh only): EDB accepts nothing else, the
  installer is our child process, and the value is never logged.
- **Data-integrity check**: Step5 (before backup) records `db.counts` from `Detect-SDP`'s
  reader; Step7 (after the probe passes, **success path only**) re-reads them. Any count lower
  than before → red `WARN` in the log and in the summary (`Data check: WARNING — weekly_reports
  412 → 390`), and the summary names the restore point to use. Equal or higher → `Data check: OK
  (sites 11, reports 412, …)`. Counts unavailable on either side → `Data check: skipped (db
  counts unavailable)`. Plans without Step5 (plain fresh) → `skipped (fresh install)`. Reinstall
  with `-ConfirmDataLoss` → `skipped (database dropped by request)` — never a false alarm on an
  intended drop. The check never triggers a rollback by itself (a rollback restores code only; the
  DB decision is the operator's — the message says exactly that).
- **Summary block** (console, green box, and `summary.txt`) gains: `Mode`, `Version a -> b`,
  `Restore point: <zip>`, `Database: preserved` / `DROPPED and recreated` / `restored from <zip>`,
  `.env: preserved` / `created`, `Data check`, `Log`, `Summary`. Same lines in the same order every run.

### 4.5 Manage-SDP.ps1 — restore takes a safety backup first

`-Restore` first **re-invokes Manage-SDP itself** with `-Backup -Tag pre-restore` (the
`dailyjob` pattern — one action per invocation, no second backup implementation) and takes the
zip path from the last stdout line exactly as Install-SDP Step5 does; it prints that name; **a failed pre-restore backup aborts the restore** (exit
1, nothing touched). Mirror of the §4.4 rule: when the target zip carries a dump and `PG_URL` is
set (so the DB branch will `DROP DATABASE … WITH (FORCE)` as superuser), the pre-restore zip
**must contain the `*.sql` dump**, otherwise the restore aborts **before stopping the app** ("no
database dump in the pre-restore point — refusing to overwrite the database"). Sqlite-only boxes
(no `PG_URL`) have no DB branch and are unaffected; option 6 carries the yellow "database
unreachable" note in the menu when `db.reachable` is false. Only then it stops the app, restores files and, if the zip carries a dump,
drops + restores the DB. The `YES` prompt inside Manage-SDP is kept for direct CLI use; from the
menu the red screen (§4.3) already gated it, so Setup.bat passes `-Force`. Step 8 (demo seed)
also calls `-Restore -Force` on a fresh box; the extra pre-restore backup there is harmless
(a few MB) and is kept for uniformity.

## 5. Out of scope (YAGNI)

GUI window (approach C), Apps & features registration, Start Menu shortcuts, migration
pre/post-flight of individual SQL files (our schema is created at boot), multi-instance, Linux.

## 6. Testing

- `Detect-SDP.ps1`: run against the TEST instance (`config.test.psd1`, port 3457, DB
  `sdp_dashboard_test`) in three states — empty dir, installed, `.env` removed — and assert the
  `verdict` fields with a small PowerShell harness `tools/installer/tests/detect.tests.ps1`
  (plain `if`/`throw`, no Pester dependency).
- `Confirm-Destructive.ps1`: piped stdin with the wrong phrase → exit 1; the right phrase →
  exit 0; empty/closed stdin → exit 1; a `sdp-db_*.sql` restore target → exit 1 before any
  prompt. Same harness.
- `Install-SDP.ps1` plan order: a unit-style check that the `reinstall` and
  `fresh-over-existing` plans list `'5'` before `'4'`, and that plain `fresh` has no `'5'`
  (read the plan tables through a `-PrintPlan` dry-run switch added for this purpose).
- End-to-end on the TEST instance (the same E2E the 2026-07-13 delivery used): fresh → patch →
  upgrade → reinstall (kept DB) → restore, checking `summary.txt` carries the new lines and
  `Data check: OK`.
- No Node test suite change; `tests/` untouched.

## 7. Files

| File | Change |
|---|---|
| `tools/installer/SdpSituation.ps1` | new — dot-sourced functions `Get-SdpDbCounts`, `Get-SdpSituation` (shared by Detect and Install-SDP) |
| `tools/installer/Detect-SDP.ps1` | new — CLI wrapper (JSON to `-OutFile`, `KEY=VALUE` on stdout) |
| `tools/installer/Show-Situation.ps1` | new (renderer for Setup.bat) |
| `tools/installer/Confirm-Destructive.ps1` | new |
| `tools/installer/Setup.bat` | situation block, gated menu, confirm calls, guarded Fresh path |
| `tools/installer/Install-SDP.ps1` | env header; `-ForceOverwrite` switch; plan reorder (Step5 before Step4 for reinstall, Step5 added to fresh-over-existing); `CREATE ROLE` via stdin; data check; summary lines; `-PrintPlan` dry-run |
| `tools/installer/Manage-SDP.ps1` | pre-restore safety backup (abort on failure) |
| `tools/installer/tests/*.tests.ps1` | new harness |
| `docs/INSTALLER.md` | updated operator guide |
| `CLAUDE.md` | one "Current state" paragraph + a pitfall row (secrets on command lines) |
