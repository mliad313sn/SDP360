# PostgreSQL superuser rotation record (EX-01) — TO BE FILLED BY A PERSON

PROPOSITION — prepared by E-S06 (audit S-01) on 2026-11-06. Nothing below has been done by an agent; no row is
filled. Rotation, the `pg_hba.conf` review, the log review and the history decision are human gates (security
owner + DBA, change record). **Never write a password, hash or connection string in this file** — the value is
referenced as "the EX-01 value" only. Procedure: `docs/security/EX-01-CREDENTIAL-INCIDENT.md` §3; history options
A/B/C: §4.

## One row per cluster

| Cluster (EX-01 §2) | Owner | Uses the EX-01 value? (yes / no / UNKNOWN) | Change ref | Date rotated | Operator | `pg_hba.conf` reviewed (trust lines removed, superuser local only) | Superuser-login log reviewed since 2026-07-13 (result) | Other holders told (4MyPeople installer config, vault, runbooks) | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Production database server (shared with 4MyPeople) | UNKNOWN | UNKNOWN | | | | | | | |
| TEST instance | UNKNOWN | UNKNOWN | | | | | | | |
| Training / demo instances (list each) | UNKNOWN | UNKNOWN | | | | | | | |
| Developer machines that restored a production copy (list each) | UNKNOWN | UNKNOWN | | | | | | | |

## History decision (repository owner)

| Decision | Chosen (A / B / C) | Decided by | Date | Reference | Rationale |
|---|---|---|---|---|---|
| Git history of the EX-01 value | | | | | |

A = keep history, rotate (minimum) · B = rewrite history · C = archive and restart. Rotation is required in every
case (existing clones keep the history). Close EX-01 only when every row above is filled and signed off in the
change record.
