'use strict';
// Step 10 — the PostgreSQL REPLICA watch (job db.replica_lag, every 5 minutes). The study's recovery point objective
// is 15 minutes (RPO): the replica must never be more than 15 minutes behind the primary. Setup and failover:
// docs/ops/REPLICA-POSTGRESQL.md. Nothing to check while PG_REPLICA_URL is empty (no replica yet): the job says so.
//
// Lag = how far the replica's REPLAY is behind: 0 when everything received is replayed and the primary is idle;
// otherwise the age of the last replayed transaction. A replica that left recovery (promoted) is an error.

async function measure(client) {
  const r = (await client.query(`SELECT pg_is_in_recovery() AS in_recovery,
      pg_last_wal_receive_lsn() = pg_last_wal_replay_lsn() AS caught_up,
      EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) AS age_s`)).rows[0] || {};
  const lag = r.caught_up ? 0 : (r.age_s == null ? null : Math.round(Number(r.age_s)));
  return { in_recovery: !!r.in_recovery, caught_up: !!r.caught_up, lag_seconds: lag };
}

/** Returns { skipped } | { lag_seconds, … } | { error } (the runner records an error as a failed run → alert). */
async function check({ env = process.env, connect } = {}) {
  const url = env.PG_REPLICA_URL;
  if (!url) return { skipped: 'no replica configured (PG_REPLICA_URL is empty)' };
  const maxMin = Math.max(1, Number(env.REPLICA_MAX_LAG_MIN) || 15);
  let client;
  try {
    client = connect ? await connect(url) : await (async () => { const { Client } = require('pg'); const c = new Client({ connectionString: url, statement_timeout: 10000 }); await c.connect(); return c; })();
    const m = await measure(client);
    if (!m.in_recovery) return { error: 'the replica is not in recovery: it was promoted or is a primary', ...m };
    if (m.lag_seconds == null) return { error: 'the replica has replayed nothing yet', ...m };
    if (m.lag_seconds > maxMin * 60) return { error: `replica ${Math.round(m.lag_seconds / 60)} min behind (objective ${maxMin} min)`, ...m };
    return { ...m, objective_minutes: maxMin };
  } catch (e) {
    return { error: 'replica unreachable: ' + String(e.message || e).replace(/postgres(ql)?:\/\/[^\s]+/gi, '[url]').slice(0, 160) };
  } finally { try { client && await client.end(); } catch (_) {} }
}

module.exports = { check, measure };
