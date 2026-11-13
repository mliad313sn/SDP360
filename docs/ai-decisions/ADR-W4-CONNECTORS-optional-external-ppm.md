# ADR — W4-CONNECTORS: optional interoperability with external PPM tools

- **Status:** accepted (engineering, sandbox). Business enablement PROPOSED — every switch defaults to `0`.
- **Date:** 2026-11-13 · **Lot:** w4-connectors (PPM parity W4, rows J3 / J4)

## Context
The user allowed external PPM connectors on 2026-11-12 as optional extras only; the native tool must stand alone.
MSPDI import/export already existed (W2-ENGINE).

## Decisions
1. **XER maps onto the MSPDI plan model** (`services/ppm/xer.js`) instead of a second import path: one import
   implementation (`engineStore.importModel`, exposed by `routes/ppmEngine.js` as `refuseImport`/`finishImport`), the
   same empty-project / dry-run / committee rules. WBS elements become summary tasks; the activity code goes into the
   `wbs` field. Resources, costs, baselines are NOT carried by XER here (MSPDI covers them) — every drop is a warning.
2. **.mpp = a converter hook, not a parser.** No Node parser exists and we will not vendor a licensed library. The
   server executes ONLY an administrator-configured absolute path, with an argument array (no shell), a timeout, a
   minimal env and a throwaway 0700 directory; nothing runs while unconfigured (501 + how-to). The config key is
   writable by super_admin only (the whole `PUT /api/reports/config` is super_admin).
3. **Jira / Azure DevOps = read-only pull, per-project opt-in.** No write-back (keeps the connector out of the
   "change the source system" class; the outbound-write ratchet lists the only POST — the WIQL query). Idempotent upsert
   by project × system × external key in a new table (migration 112), task writes through the governance store so the
   usual validation, integrity checks and hash-chained events apply. A null upstream field never clears a native value
   (null = unknown); a natively deleted task is never resurrected.
4. **Transport injectable**, default = `services/safeUrl` (https, private / metadata addresses refused, no redirect,
   DNS re-check). Credentials only in headers, redacted from errors; stored as encrypted blank-keep secrets.
5. **Connector-health page not extended** (out of lane; it reads platform connectors from config + jobs). A
   committee-only `GET /api/governance/ppm/connectors/status` gives switches, configured yes/no and last sync per project.

## Consequences / limits
- Not tested against Primavera, a real .mpp/MPXJ, a Jira tenant or an Azure DevOps organisation — human checks.
- Per-calendar day lengths collapse to one on XER export (warning `CALENDAR_DAY_LENGTH` on import).
- The pull is manual ("Sync now"); no scheduled job was added (a cron would be a further PROPOSED switch).
