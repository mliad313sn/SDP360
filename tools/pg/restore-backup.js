'use strict';
// Step 2 (SDP-DASH-2.0) — decrypt a nightly backup (services/dbBackup.js) to plain SQL, for a
// restore or the quarterly restore drill (docs/ops/RESTORE-DRILL.md).
//
//   node tools/pg/restore-backup.js <backup.sql.gz.enc> <out.sql>
//
// Reads SDP_BACKUP_KEY (or SDP_CONFIG_KEY) from the environment or the app root .env. Writes
// the SQL file only; loading it into a database is a separate, deliberate step (psql).
const path = require('path');
if (require.main === module) require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { decryptFileToFile, backupKey } = require('../../services/dbBackup');

if (require.main === module) {
  const [src, out] = process.argv.slice(2);
  if (!src || !out) { console.error('usage: node tools/pg/restore-backup.js <backup.sql.gz.enc> <out.sql>'); process.exit(2); }
  const key = backupKey();
  if (!key) { console.error('SDP_BACKUP_KEY (or SDP_CONFIG_KEY) is not set'); process.exit(2); }
  decryptFileToFile(src, out, key)
    .then(n => console.log(`✓ ${out} written (${Math.round(n / 1024)} KB of SQL)`))
    .catch(e => { console.error(`✗ cannot decrypt: ${e.message} (wrong key or damaged file)`); process.exit(1); });
}
