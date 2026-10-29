# EX-01 — Historical PostgreSQL credential in the installer configuration

Status 2026-10-29: **open — human gate** (security owner + DBA + repository owner). Nothing below was
rotated, rewritten or disclosed by the development work. No value is reproduced in this file.

## 1. What is known (by reference only)

| Item | Reference |
|---|---|
| File | `tools/installer/config.psd1`, key `StandardPgSuperPassword` (PostgreSQL **superuser** of the appliance) |
| Introduced | commit `92a6a68` (2026-07-13, "scaffold config + env template"), carried into `214c0d1` (2026-10-19, SDP360 fork) |
| Removed from the current tree | commit `95984c5` (2026-10-29) — the value is now empty and the installer asks for it, or reads `PG_SUPER_PASSWORD` |
| Branches that still hold it in their history | `origin/claude/confident-pascal-03veex`, `origin/claude/sdp-dashboard-analysis-55b1oy` (default branch), `claude/sdp360-consolidation`, any clone or fork made since 2026-07-13 |
| Detection | `node tools/security/secret-scan.js --history` lists the two commits (values not shown) |
| Other credential-shaped additions in history | `5f82968` `.github/workflows/ci.yml` — the CI service container's password: a throwaway database that exists only inside a GitHub runner, not a credential of any environment |

## 2. Environments potentially exposed (to be confirmed by their owners)

The value was the "appliance standard" superuser password used by the console installer
(`tools/installer/Install-SDP.ps1`). Any PostgreSQL cluster installed or managed with it is potentially exposed:

- the production database server (the cluster is shared with the 4MyPeople installer, which uses the same standard);
- the TEST instance and any training/demo instance installed with the console installer;
- developer machines that restored a production copy with the same superuser.

Exposure path: read access to the GitHub repository (collaborators, GitHub Apps with repository access,
CI logs did not print it), and every clone/fork. The application role (`sdp_app`) has its own password,
generated per installation, and is **not** this value.

## 3. Rotation checklist (security owner + DBA)

1. List the clusters from §2 that really use the value (`ALTER ROLE postgres PASSWORD …` history is not kept by
   PostgreSQL — ask each owner; check `pg_hba.conf` for `trust` lines at the same time).
2. Rotate the `postgres` superuser on each, during a change window: `ALTER ROLE postgres PASSWORD '<new>'` from
   `psql` with the password typed at the prompt (`\password postgres`), never on a command line.
3. Update the places that hold the superuser: the 4MyPeople installer configuration (separate product — its
   owner must be told), password vault entries, DBA runbooks. The SDP application does **not** need it at run
   time (it uses `sdp_app`); `Manage-SDP.ps1` and Setup now ask for it when needed.
4. Restrict superuser logins to local connections in `pg_hba.conf` where possible.
5. Review PostgreSQL logs for superuser connections from unexpected hosts since 2026-07-13.
6. Record the rotation (date, cluster, who) in the change record; close this file's status.

## 4. Git history — options for the repository owner

| Option | Effect | Cost / risk |
|---|---|---|
| A. Keep history, rotate (minimum) | The old value stays readable in history but no longer opens anything | None beyond the rotation; the value must be treated as public forever |
| B. Rewrite history (`git filter-repo --replace-text`) on every branch, force-push, ask GitHub support to purge cached views, invalidate forks | The value disappears from the hosted repository | Every clone and open pull request must be re-created; commit SHAs cited in documents and audit trails change (the 2026-10-15 rewrite showed this cost); forks and existing clones keep it anyway |
| C. Archive the repository and continue in a new one from a clean snapshot | Clean start | Loses the hosted history and links; same limits as B for existing clones |

Recommendation for the owner's decision: **A now** (rotation closes the risk), B or C only if policy requires
the value to be unreadable — rotation is needed in every case, because existing clones keep the history.

## 5. What prevents a recurrence (implemented)

- `tools/security/secret-scan.js` — scans the tracked files for connection strings with a password, assigned
  passwords/keys/tokens (including names like `StandardPgSuperPassword`), private keys, Zoho refresh tokens,
  Teams/Workflow webhook signatures and AWS keys. It prints file, line and rule — never a value.
- Blocking in CI (`ci.yml`, every push) and in the release job (`release.yml`): a finding fails the build.
- `tests/secret-scan.test.js` — the rules catch the shapes that leaked; placeholders are not findings; the
  tracked tree is clean.
- The installer no longer stores any password (`tests/installer-no-stored-password.test.js`).
