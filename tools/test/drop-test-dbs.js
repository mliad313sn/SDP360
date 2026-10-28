'use strict';
// Drops the throwaway databases / schemas the PostgreSQL test boot (tests/_pg-boot.mjs)
// created. Test processes exit through --test-force-exit, which skips async cleanup, so
// the runner sweeps once after the run. Only names with the test prefixes are touched.
const { Client } = require('pg');
async function sweep(adminUrl = process.env.PG_ADMIN_URL) {
  if (!adminUrl) return 0;
  const c = new Client({ connectionString: adminUrl });
  try { await c.connect(); } catch (_) { return 0; }
  let n = 0;
  try {
    const dbs = await c.query("SELECT datname FROM pg_database WHERE datname LIKE 'sdp\\_tracker\\_test\\_%'");
    for (const { datname } of dbs.rows) {
      if (!/^sdp_tracker_test_[a-z0-9]+$/.test(datname)) continue;
      await c.query(`DROP DATABASE IF EXISTS ${datname} WITH (FORCE)`); n++;
    }
  } finally { await c.end(); }
  return n;
}
module.exports = { sweep };
if (require.main === module) sweep().then((n) => console.log('[test-db] dropped ' + n));
