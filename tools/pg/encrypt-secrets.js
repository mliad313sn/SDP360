'use strict';
// A-13 (audit 2026-09-24) — encrypt in place the config secrets written before the key.
//
// Setting SDP_CONFIG_KEY does not encrypt anything: a value becomes a box when it is next
// SAVED. Doing that from the admin console means re-typing each secret, and those fields
// are redacted on GET with BLANK MEANING KEEP — so a Save with an untouched field
// encrypts nothing while looking like it worked, and a typo in the SMTP password is
// discovered on Monday by whoever was waiting for a report.
//
// This reads each plaintext value and writes it back encrypted. Nobody needs to know the
// values, and nothing else about them changes.
//
//   node tools/pg/encrypt-secrets.js            (dry run — says what it would do)
//   node tools/pg/encrypt-secrets.js --apply    (writes)
//
// Idempotent: already-encrypted and empty values are skipped, so a second run does
// nothing. Values are never printed.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { planSecretEncryption, envKey, describeSecretState } = require('../../services/configSecrets');
const { _SECRET_BLANK_KEEP } = require('../../services/reportConfig');

async function main() {
  const apply = process.argv.includes('--apply');
  if (!process.env.PG_URL) { console.error('PG_URL absent du .env.'); process.exitCode = 1; return; }
  const key = envKey();
  if (!key) {
    console.error('SDP_CONFIG_KEY absente ou trop courte — rien à faire. (La poser AVANT de migrer.)');
    process.exitCode = 1;
    return;
  }
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.PG_URL });
  await c.connect();
  try {
    const keys = [...(_SECRET_BLANK_KEEP || [])];
    const rows = (await c.query('SELECT key, value FROM report_config WHERE key = ANY($1)', [keys])).rows;
    const plan = planSecretEncryption(rows, key);

    console.log(apply ? 'CHIFFREMENT DES SECRETS — écriture' : 'CHIFFREMENT DES SECRETS — simulation (--apply pour écrire)');
    console.log('');
    for (const k of keys.sort()) {
      const r = rows.find(x => x.key === k);
      const todo = plan.find(x => x.key === k);
      console.log('  ' + k.padEnd(22) + (todo ? (todo.upgraded ? 'à ré-chiffrer (v1 → v2)' : 'à chiffrer') : describeSecretState(r && r.value).label));
    }
    console.log('');
    if (!plan.length) { console.log('Rien à faire : aucun secret en clair ni en v1.'); return; }
    if (!apply) { console.log(`${plan.length} secret(s) seraient chiffrés. Relancer avec --apply.`); return; }

    await c.query('BEGIN');
    for (const u of plan) {
      await c.query('UPDATE report_config SET value=$1, updated_at=now(), updated_by=$2 WHERE key=$3',
        [u.value, 'encrypt-secrets', u.key]);
    }
    await c.query('COMMIT');
    console.log(`${plan.length} secret(s) chiffrés. Contrôle : node tools/pg/check-secrets.js`);
    console.log('Aucun redémarrage nécessaire — la lecture déchiffre à la volée.');
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally { await c.end(); }
}

if (require.main === module) {
  main().catch(e => { console.error('[encrypt-secrets]', e.message); process.exitCode = 1; });
}
module.exports = { main };
