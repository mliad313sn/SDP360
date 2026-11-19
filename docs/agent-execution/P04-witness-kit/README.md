# P04 — Business witness project kit (gate "Business witness project") — HUMAN check, NOT performed

- **Status:** NOT PERFORMED. The PMO supplies one real project; a person loads it on a TEST instance and signs the
  comparison. The agent prepared the tools only. Nothing here may be run on production (the loader refuses the
  production host name) and the PMO's data stays in the TEST perimeter.
- **Tool:** `tools/ppm/witness-load.js` (tested by `tests/ppm-p04-kits.test.js`).

## Steps

1. **PMO** exports the project from its tool of record: Microsoft Project ▸ Save As ▸ XML (MSPDI), or Primavera ▸ XER.
2. **Local first (no server):** `node tools/ppm/witness-load.js --file=<plan.xml>` — reads the file with SDP360's import
   mapping, schedules it with SDP360's engine and writes `<plan>.witness-comparison.csv`. Read the summary: how many
   leaves have the same start / finish, the largest finish difference in days.
3. **TEST instance (optional, the real import path):**
   - switches on the TEST instance only: `ppm_mspdi_enabled` (or `ppm_xer_enabled`), `ppm_schedule_engine_v2_ui`, and
     `ppm_calendars_enabled` + `ppm_resources_enabled` if the file has calendars / resources;
   - a committee member creates an EMPTY project (the import refuses a project with tasks);
   - `SDP_WITNESS_TOKEN=<session token> node tools/ppm/witness-load.js --file=<plan.xml> --base=<TEST URL>
     --project-id=<id> --i-confirm-test-instance` = dry run (counts, warnings, cycle check);
   - add `--apply` (committee token) to load it; the sheet then compares the file with the SERVER's schedule.
   The token is read from the environment only. A production host is refused.
4. **PMO** fills the two empty columns of the sheet for every row it checks: `pmo_verdict` (agree / differs /
   not checked) and `pmo_comment` (why a difference is acceptable or a defect).
5. Differences that are expected (to note, not to fix in the sheet): split tasks, interim plans, time-phased data,
   assignment calendars (see `docs/ppm/W2-ENGINE-CONTRACT.md`); progress-driven dates (the tool of record reschedules
   remaining work from its status date — SDP360's statusDate option is not applied by the import).

## Comparison sheet columns

`uid, wbs, name, summary` · tool of record: `tor_start, tor_finish, tor_duration_days, tor_pct` · SDP360: `sdp_start,
sdp_finish, sdp_duration_days, sdp_total_float, sdp_critical` · `delta_start_days, delta_finish_days` (SDP360 minus tool
of record, calendar days) · `same_dates` · **`pmo_verdict`, `pmo_comment` — always empty when written; only a person
fills them.**

## Sign-off (HUMAN — never pre-filled)

| Role | Name | Decision (accepted / refused / to re-run) | Date | Reference of the signed sheet |
|---|---|---|---|---|
| PMO project owner | | | | |
| PMO lead | | | | |
