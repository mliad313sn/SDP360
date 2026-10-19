# ADR-005 — Releases are full, versioned, manifest-checked packages; Setup and Manager share one engine

**Status**: Accepted — implemented (Step 5, 2026-10-19) · **Author**: AI agent · **Approval**: product committee (to record)
**Supersedes**: the marker-diff ZIP (`make-deploy-zip.ps1`, `.git/last-deployed`), the frozen-lot register, the root `.cmd` menus.

## Context
v1 deployed by hand-copying a *differential* ZIP built from `git diff <marker>..HEAD`. The marker drifted, ZIPs were hand-stripped, and work merged on `main` sat "behind the marker" for weeks — a register of frozen lots existed only to remember what production was missing. Restart, recovery and restore were four `.cmd` menus, duplicated in the installer's `Setup.bat`.

## Decision
- A release is **`sdp-dashboard-<SemVer>.zip`**: every runtime file at its path under `files/`, plus `manifest.json` (SHA-256 and size per file, version, commit, build date), built by CI from the tag (`tools/deploy/make-update-package.js`) and attached to the GitHub release with its `.sha256`. Install state (`.env`, `data/`, `logs/`, `node_modules/`) is never inside a package.
- **One apply engine**, `tools/sdp-manager.js`: verify the whole manifest (one bad byte refuses the package), refuse a downgrade, keep the current files under `.rollback/<version>/`, copy, `npm ci --omit=dev` when the lockfile changed, run the migrator, restart `stop → start`, probe; any failure after the copy rolls back by itself. The Inno Setup wizard, the WPF Manager and a scripted install all call it.
- **Inno Setup** over WiX (declarative, script-in-the-wizard, free, the wizard needs custom pages not MSI tables); **WPF (.NET 8)** over Tauri for the Manager (Windows-only audience, tray icon, service control APIs, one toolchain for the sysadmins).
- **Signing** by CI from a certificate secret; an unsigned release is still published, labelled as such, and the Manager warns before applying it.

## Consequences
- No more "what is in prod?": `manifest.json` in the install folder is the answer, `sdp-manager status` prints it.
- Rollback is a first-class operation, not a hunt for an old ZIP.
- The v1 console installer (`tools/installer/`) is kept until the first signed release ships, then removed (dossier Step 5, arbitration 7).
