'use strict';
// Drops the throwaway databases / schemas the PostgreSQL test boot (tests/_pg-boot.mjs)
// created. Test processes exit through --test-force-exit, which skips async cleanup, so
// the runner sweeps once after the run. Only names with the test prefixes are touched.
//
// Two modes:
//   --run=<id>  (used by tools/test/run-all.js) drops ONLY the databases of that run — their
//               names carry the run id (tests/pg-helpers.js testDbName, SDP_TEST_RUN_ID). A
//               concurrent runner's databases, idle or not, are never touched (P11 AUD-8: the
//               "is it busy?" check below is a race and used to drop another run's idle DBs).
//   no --run    (standalone, by hand) unchanged: every idle sdp_tracker_test_* database.
//               A database that still has a live connection belongs to a run in progress (another
//               worktree or terminal) and is left alone; set SDP_TEST_SWEEP_FORCE=1 to drop it anyway.
const { Client } = require('pg');

/** Names this sweep may drop: one run's databases, or every test database when runId is empty. */
function namePattern(runId) {
  if (!runId) return /^sdp_tracker_test_[a-z0-9_]+$/;
  if (!/^[a-z0-9]{1,16}$/.test(String(runId))) throw new Error('invalid run id (expected 1-16 [a-z0-9])');
  return new RegExp('^sdp_tracker_test_' + runId + '_[a-z0-9]+$');
}

async function sweep(adminUrl = process.env.PG_ADMIN_URL, { force = process.env.SDP_TEST_SWEEP_FORCE === '1', runId = null } = {}) {
  if (!adminUrl) return 0;
  const re = namePattern(runId);
  const c = new Client({ connectionString: adminUrl });
  try { await c.connect(); } catch (_) { return 0; }
  let n = 0;
  try {
    const dbs = await c.query("SELECT datname FROM pg_database WHERE datname LIKE 'sdp\\_tracker\\_test\\_%'");
    for (const { datname } of dbs.rows) {
      if (!re.test(datname)) continue;
      if (!force && !runId) {   // a run's own databases: its test processes have all exited
        const busy = await c.query('SELECT 1 FROM pg_stat_activity WHERE datname = $1 LIMIT 1', [datname]);
        if (busy.rowCount) continue;
      }
      await c.query(`DROP DATABASE IF EXISTS ${datname} WITH (FORCE)`); n++;
    }
  } finally { await c.end(); }
  return n;
}
module.exports = { sweep, namePattern };
if (require.main === module) {
  const arg = process.argv.slice(2).find((a) => a.startsWith('--run='));
  sweep(undefined, { runId: arg ? arg.slice(6) : null }).then((n) => console.log('[test-db] dropped ' + n));
}
