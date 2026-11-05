'use strict';
// D-01 (AMDEC 2026-11-05, AM-01) — a module code shared by two ACTIVE sites (Assafo + Tanda → tracker TND)
// merges two write scopes: each site's editor overwrites the other's values. Behind report_config
// site_code_shared_block ('0' = today, saves go through): '1' refuses a scoped editor's save under a shared
// code with a 409 naming the sites. Which site owns the code is a data-owner decision — nothing here picks one.
const { fail, typed } = require('./httpError');

/** Codes of `codes` that two or more of `sites` resolve to: [{ code, sites:[names] }]. A throwing resolver = no code. */
function sharedAmong(sites, codes, codeOf) {
  const want = new Set((codes || []).filter(Boolean).map(String)); if (!want.size) return [];
  const by = new Map();
  for (const s of sites || []) { let c = null; try { c = codeOf(s); } catch (_) { c = null; } if (c && want.has(String(c))) { if (!by.has(String(c))) by.set(String(c), []); by.get(String(c)).push(s.name); } }
  return [...by].filter(([, l]) => l.length > 1).map(([code, l]) => ({ code, sites: l }));
}
function message(module, shared) {
  const s = shared[0];
  return `This ${module} code ${s.code} is used by two active sites (${s.sites.join(', ')}): a save here would overwrite the other site's data. `
    + 'Nothing was saved. A super_admin must give the code to one site (Admin ▸ Sites ▸ onboarding checklist) before saving again.';
}
async function blockOn(rdb) {
  try { return String((await require('./reportConfig').getConfig(rdb.db)).site_code_shared_block) === '1'; } catch (_) { return false; }
}
async function sharedFor(rdb, codes, codeOf) { return sharedAmong((await rdb.listSites()) || [], codes, codeOf); }
/** Sends the 409 and returns true when the switch is on and one of `codes` is shared; false otherwise. */
async function refuseIfShared(rdb, res, module, codes, codeOf) {
  if (!codes || !codes.length || !(await blockOn(rdb))) return false;
  const shared = await sharedFor(rdb, codes, codeOf); if (!shared.length) return false;
  fail(res, typed('CONFLICT', message(module, shared), 409), 409, { reason: 'site_code_shared', module, shared });
  return true;
}
module.exports = { sharedAmong, message, blockOn, sharedFor, refuseIfShared };
