'use strict';
// PostgreSQL-only test helpers (PO-08). Every test FILE runs on its own throwaway database
// (tests/_pg-boot.mjs); these helpers give a single TEST a clean slate inside it.
//   await fresh(['report_config'])  → truncates the tables, returns the reports-db handle
//   await freshStore([...])         → same, as the { prepare } shape the stores take
async function truncate(tables) {
  if (!tables || !tables.length) return;
  await require('../reports-db').pgHandle().exec(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
}
async function fresh(tables) { await truncate(tables); return require('../reports-db').db; }
async function freshStore(tables) {
  await truncate(tables);
  return { prepare: (sql) => require('../reports-db').pgHandle().prepare(sql) };
}
module.exports = { truncate, fresh, freshStore };

// The default sites are seeded in PostgreSQL at boot (PO-08): a test that needs "Hounde" gets
// the existing row (with its zoho_group aligned to what the test asked) instead of a duplicate.
async function ensureSite(rdb, fields) {
  const cur = (await rdb.listSites()).find((s) => s.name === fields.name);
  if (!cur) return rdb.createSite(fields);
  if (fields.zoho_group !== undefined) await rdb.pgHandle().prepare('UPDATE sites SET zoho_group = ? WHERE id = ?').run(fields.zoho_group, cur.id);
  return { ...cur, ...fields, id: cur.id };
}
module.exports.ensureSite = ensureSite;
