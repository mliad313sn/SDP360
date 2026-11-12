'use strict';
// Drops the throwaway databases / schemas the PostgreSQL test boot (tests/_pg-boot.mjs)
// created. Test processes exit through --test-force-exit, which skips async cleanup, so
// the runner sweeps once after the run. Only names with the test prefixes are touched.
// A database that still has a live connection belongs to a run in progress (another
// worktree or terminal) and is left alone; set SDP_TEST_SWEEP_FORCE=1 to drop it anyway.
const { Client } = require('pg');
async function sweep(adminUrl = process.env.PG_ADMIN_URL, { force = process.env.SDP_TEST_SWEEP_FORCE === '1' } = {}) {
  if (!adminUrl) return 0;
  const c = new Client({ connectionString: adminUrl });
  try { await c.connect(); } catch (_) { return 0; }
  let n = 0;
  try {
    const dbs = await c.query("SELECT datname FROM pg_database WHERE datname LIKE 'sdp\\_tracker\\_test\\_%'");
    for (const { datname } of dbs.rows) {
      if (!/^sdp_tracker_test_[a-z0-9]+$/.test(datname)) continue;
      if (!force) {
        const busy = await c.query('SELECT 1 FROM pg_stat_activity WHERE datname = $1 LIMIT 1', [datname]);
        if (busy.rowCount) continue;
      }
      await c.query(`DROP DATABASE IF EXISTS ${datname} WITH (FORCE)`); n++;
    }
  } finally { await c.end(); }
  return n;
}
module.exports = { sweep };
if (require.main === module) sweep().then((n) => console.log('[test-db] dropped ' + n));
