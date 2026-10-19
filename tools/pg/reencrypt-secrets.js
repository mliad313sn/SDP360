'use strict';
// Step 4 — re-encrypt the secret config values: v1 boxes (sha256 key) → v2 (scrypt), plaintext →
// v2, or a KEY ROTATION (SDP_CONFIG_KEY_OLD opens, SDP_CONFIG_KEY seals). Dry-run by default.
//   node tools/pg/reencrypt-secrets.js            (plan only)
//   node tools/pg/reencrypt-secrets.js --apply    (writes, one transaction)
//   SDP_CONFIG_KEY_OLD=<previous passphrase> node tools/pg/reencrypt-secrets.js --apply
// Never prints a secret value. A box that opens with neither key is listed and left alone.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { planReencryption, keyFrom, envKey } = require('../../services/configSecrets');
const { _SECRET_BLANK_KEEP } = require('../../services/reportConfig');

async function main() {
  const apply = process.argv.includes('--apply');
  const newKey = envKey();
  if (!newKey) { console.error('SDP_CONFIG_KEY is not set (or too short) — nothing to encrypt with.'); process.exit(2); }
  const oldKey = process.env.SDP_CONFIG_KEY_OLD ? keyFrom(process.env.SDP_CONFIG_KEY_OLD) : null;
  const url = process.env.PG_URL || process.env.DATABASE_URL;
  if (!url) { console.error('PG_URL not set'); process.exit(2); }
  const { Client } = require('pg');
  const c = new Client({ connectionString: url }); await c.connect();
  try {
    const keys = [...(_SECRET_BLANK_KEEP || [])];
    const { rows } = await c.query('SELECT key, value FROM report_config WHERE key = ANY($1)', [keys]);
    const plan = planReencryption(rows, { newKey, oldKey });
    for (const u of plan.updates) console.log(`${apply ? 'write ' : 'would '} ${u.key}  (${u.from} → v2)`);
    for (const k of plan.skipped) console.log(`keep   ${k}  (already v2)`);
    for (const k of plan.unreadable) console.log(`!! UNREADABLE ${k}  — re-enter it in Admin (box opens with neither key)`);
    if (apply && plan.updates.length) {
      await c.query('BEGIN');
      for (const u of plan.updates) await c.query('UPDATE report_config SET value=$1 WHERE key=$2', [u.value, u.key]);
      await c.query('COMMIT');
    }
    console.log(`[reencrypt] ${apply ? 'applied' : 'planned'}=${plan.updates.length} kept=${plan.skipped.length} unreadable=${plan.unreadable.length}`);
    process.exitCode = plan.unreadable.length ? 3 : 0;
  } finally { await c.end(); }
}
if (require.main === module) main().catch((e) => { console.error('[reencrypt] FAILED:', e.message); process.exit(1); });
module.exports = { main };
