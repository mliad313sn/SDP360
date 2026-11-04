# TEST instance — operator path

Version 1 · 2026-11-04 · Audience: the operator who builds and runs the TEST instance before any
production change. This page adds no procedure of its own: it lists the existing runbooks **in the
order you run them** and says what each one must prove before you move on.

Stack you are installing: Node.js 22, PostgreSQL 17 (the only database backend), Windows Server + IIS
reverse proxy. A TEST instance has its **own** database, its own `.env` and its own backup folder, so
retention or a restore never touches production.

| # | Step | Runbook | Done when |
|---|---|---|---|
| 1 | Install the TEST instance on a clean machine (Setup wizard or `/VERYSILENT`) | [INSTALLATION.md](../INSTALLATION.md) §1–§5, details in [INSTALLER-V2.md](../../INSTALLER-V2.md) | §4 checks pass: login works, `sc query SDPDashboard` = `RUNNING`, Node listens on `127.0.0.1` only, first backup taken |
| 2 | Upgrade it with the release package (verify signature, then update; rollback if refused) | [EXPLOITATION.md](../EXPLOITATION.md) §2 | last line `OK — <version> installed`; a refused or rolled-back package is a stop |
| 3 | Run the release steps that apply to TEST (backup, migrations, audit grants, chain check, committee values, switches) | [RELEASE-RUNBOOK-2026-10-29.md](../../sdp360/completion/RELEASE-RUNBOOK-2026-10-29.md) steps 2–10 | each row's "Proof it is ready" observed on TEST; steps 11–12 are production-only |
| 4 | Set the pilot switches | [PILOT-PROFILE.md](PILOT-PROFILE.md) | every switch in the profile is at the value the deciding role approved, or still at its default |
| 5 | Restore drill (drop, restore last nightly dump, boot with the same `SDP_CONFIG_KEY`) | [REPLICA-RESTORE.md](../REPLICA-RESTORE.md) §7, background in [DB_RECOVERY.md](../../DB_RECOVERY.md) | figures match the dump; RTO measured ≤ 2 h and logged |

Stop rules

- A failed step blocks the next one. A failed restore drill is a severity-2 incident
  ([INCIDENT-RESPONSE.md](../INCIDENT-RESPONSE.md)) and blocks any production change.
- Never use `--allow-unsigned` outside the three conditions in EXPLOITATION.md §2.
- Every switch in PILOT-PROFILE.md ships at today's behaviour. Changing one is the deciding role's call,
  recorded in the history; this page does not approve anything.
