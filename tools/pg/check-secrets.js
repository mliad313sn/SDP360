'use strict';
// A-13 (audit 2026-09-24) — READ-ONLY: which config secrets are encrypted at rest?
//
// Setting SDP_CONFIG_KEY does NOT encrypt anything by itself: a stored value becomes a
// box only when it is next SAVED from the admin console. So "the key is accepted" and
// "a database dump no longer carries the secret" are two different facts — this checks
// the second one, which is the only one that protects anything.
//
//   node tools/pg/check-secrets.js
//
// The values themselves are never printed.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { describeSecretState, envKey } = require('../../services/configSecrets');
const { _SECRET_BLANK_KEEP } = require('../../services/reportConfig');

async function main() {
  if (!process.env.PG_URL) { console.error('PG_URL absent du .env.'); process.exitCode = 1; return; }
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.PG_URL });
  await c.connect();
  try {
    const keys = [...(_SECRET_BLANK_KEEP || [])];
    const rows = (await c.query(
      'SELECT key, value FROM report_config WHERE key = ANY($1)', [keys])).rows;
    const byKey = new Map(rows.map(r => [r.key, r.value]));

    console.log('SECRETS DE CONFIGURATION — état au repos');
    console.log(envKey() ? 'Clé SDP_CONFIG_KEY : acceptée.' : 'Clé SDP_CONFIG_KEY : ABSENTE — rien ne peut être chiffré.');
    console.log('');
    let exposed = 0;
    for (const k of keys.sort()) {
      const d = describeSecretState(byKey.get(k));
      if (d.state === 'plaintext') exposed++;
      console.log('  ' + k.padEnd(22) + d.label);
    }
    console.log('');
    console.log(exposed === 0
      ? 'Aucun secret en clair. Une sauvegarde de la base ne livre plus rien.'
      : `${exposed} secret(s) encore EN CLAIR : les ré-enregistrer une fois dans Admin suffit à les chiffrer.`);
  } finally { await c.end(); }
}

if (require.main === module) {
  main().catch(e => { console.error('[check-secrets]', e.message); process.exitCode = 1; });
}
module.exports = { main };
