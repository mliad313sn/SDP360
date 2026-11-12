'use strict';
// A-13 (audit 2026-09-24) — READ-ONLY: which config secrets are encrypted at rest?
//
// Setting SDP_CONFIG_KEY does NOT encrypt anything by itself: a stored value becomes a
// box only when it is next SAVED from the admin console. So "the key is accepted" and
// "a database dump no longer carries the secret" are two different facts — this checks
// the second one, which is the only one that protects anything.
//
//   node tools/pg/check-secrets.js            — state at rest (plaintext / encrypted / empty)
//   node tools/pg/check-secrets.js --verify   — A-03a: also OPENS every enc: value with
//        SDP_CONFIG_KEY (both the 2.0 layout and the 1.11 enc:v2 per-salt layout) and prints
//        counts readable / unreadable / plaintext. Run it before a Setup update: 0 unreadable.
//
// The values themselves are never printed.
const path = require('path');
if (require.main === module) require('dotenv').config({ quiet: true, path: path.join(__dirname, '..', '..', '.env') });

const { describeSecretState, envKey, isEncrypted, decryptValue } = require('../../services/configSecrets');
const { _SECRET_BLANK_KEEP } = require('../../services/reportConfig');

// PURE: counts only — never a value. An enc: value that does not open (or opens to '')
// is unreadable; empty values are not counted.
function summarizeVerify(rows, key) {
  const out = { readable: 0, unreadable: 0, plaintext: 0, unreadableKeys: [] };
  for (const r of rows || []) {
    const v = r && r.value != null ? String(r.value) : '';
    if (v === '') continue;
    if (!isEncrypted(v)) { out.plaintext++; continue; }
    const d = key ? decryptValue(v, key, { keyName: r.key }) : null;   // A-28b: enc:v3 needs the key name
    if (d == null || d === '') { out.unreadable++; out.unreadableKeys.push(r.key); } else out.readable++;
  }
  return out;
}

async function main(argv = process.argv.slice(2)) {
  const verify = argv.includes('--verify');
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
    if (verify) {
      const s = summarizeVerify(rows, envKey());
      console.log('');
      console.log('VÉRIFICATION (déchiffrement avec SDP_CONFIG_KEY) :');
      console.log(`  lisibles : ${s.readable}   illisibles : ${s.unreadable}   en clair : ${s.plaintext}`);
      if (s.unreadable) {
        console.log(`  Illisibles : ${s.unreadableKeys.join(', ')} — cette clé n'est pas celle qui les a chiffrés.`);
        process.exitCode = 2;
      }
    }
  } finally { await c.end(); }
}

if (require.main === module) {
  main().catch(e => { console.error('[check-secrets]', e.message); process.exitCode = 1; });
}
module.exports = { main, summarizeVerify };
