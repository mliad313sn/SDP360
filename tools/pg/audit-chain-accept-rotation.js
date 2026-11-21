'use strict';
// P11 round 9 O-14 / R9-2 (fix 39, ADR docs/ai-decisions/ADR-P11-R9-signed-kid-history-anchor-events-request-origin.md).
// After a DOCUMENTED SDP_CONFIG_KEY rotation the nightly audit chain job resumes only to a key id it can trust: one
// attested by a key it holds. The usual path is to leave the previous key in .env as SDP_CONFIG_KEY_OLD for one nightly
// run. When the previous key is no longer available, an operator who holds the CURRENT key and has confirmed the
// rotation records that decision here — it writes a kid attestation signed with the current key (a plain INSERT into
// audit_chain_meta is not enough: the job ignores unsigned kid rows). This is a human decision; the tool never takes it.
//
//   node tools/pg/audit-chain-accept-rotation.js --kid=<16 hex> --i-confirm-documented-rotation [--who="name, ticket"]
//
// Needs PG_URL and SDP_CONFIG_KEY (the current key) in .env. Prints no secret.
const path = require('path');

/** Write the attestation of `kid` under the current key. Returns { attested, by }. */
async function acceptRotation(db, { kid, env = process.env, confirm = false, who = '' } = {}) {
  const AC = require(path.join(__dirname, '..', '..', 'services', 'auditChain'));
  const key = AC.anchorKey(env);
  if (!key) throw new Error('SDP_CONFIG_KEY is not set: only the holder of the current key can attest a prior key id');
  const k = String(kid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{16}$/.test(k)) throw new Error('--kid must be the 16-hex key id named by the nightly job ("unknown key id: …")');
  if (!confirm) throw new Error('refused: this records a human decision — confirm the rotation is documented (change ticket) and re-run with --i-confirm-documented-rotation');
  const schema = await AC.ledgerSchema(db);
  const by = AC.anchorKid(key);
  const note = `accepted by operator${who ? ' ' + String(who).slice(0, 200) : ''} ${new Date().toISOString()}`;
  await db.prepare(`INSERT INTO "${schema}"."${AC.META_TABLE}" (k, v) VALUES (?, ?) ON CONFLICT (k) DO NOTHING`).run(AC.kidAttestation(key, k), note);
  try {
    await db.prepare("INSERT INTO system_log (ts, category, action, actor, target, details, risk) VALUES (?, 'governance', 'audit_chain_rotation_accepted', ?, 'audit', ?, 1)")
      .run(new Date().toISOString(), String(who || 'operator').slice(0, 200), JSON.stringify({ attested: k, by }));
  } catch (_) { /* best effort: the attestation itself is the record */ }
  return { attested: k, by };
}

async function main(argv = process.argv.slice(2)) {
  require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
  const arg = (n) => { const a = argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : ''; };
  const url = process.env.PG_URL || process.env.DATABASE_URL;
  if (!url) { console.error('PG_URL is not set'); return 2; }
  const { makePgDb } = require(path.join(__dirname, '..', '..', 'services', 'pgDb'));
  const db = makePgDb(url); await db.connect();
  try {
    const out = await acceptRotation(db, { kid: arg('kid'), confirm: argv.includes('--i-confirm-documented-rotation'), who: arg('who') });
    console.log(`[audit-chain] kid ${out.attested} attested under the current key (kid ${out.by}); the next nightly run resumes the chain if nothing else is wrong.`);
    return 0;
  } catch (e) { console.error('[audit-chain] ' + e.message); return 1; } finally { await db.close(); }
}

if (require.main === module) main().then((c) => process.exit(c));
module.exports = { acceptRotation, main };
