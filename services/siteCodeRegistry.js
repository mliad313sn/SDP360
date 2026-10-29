'use strict';
// DEC-4 (committee #37) — the site-code registry (site_module_codes) as the source of truth, behind a switch.
// Each module still carries its hard-coded name → code map (tracker-db / inspection-db SITE_MAP). With
// report_config site_codes_from_registry = '1', a site found in the registry for that module wins; a site
// absent from the registry falls back to the hard-coded map (nothing breaks while the registry is filled).
// Off ('0', default) = the hard-coded maps only, the behaviour until now. `diff()` lists every site where
// the two disagree or one side is missing — the evidence the committee reviews before switching it on.
// Sync API for the module lookups (they are sync): the registry is loaded at boot and refreshed every
// 5 minutes and on every change made through the admin route.
const MODULES = ['tracker', 'inspection', 'meetings'];
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(it agent|it agents)\b/g, '').replace(/[^a-z0-9]+/g, '');
let enabled = false; let maps = new Map(); let loadedAt = null; let timer = null;

/** Registry code for a site name in a module, or undefined (switch off / site not in the registry). */
function lookup(module, name) {
  if (!enabled || !name) return undefined;
  const m = maps.get(module); if (!m) return undefined;
  return m.get(norm(name));
}
async function refresh(rdb) {
  try {
    const cfg = await require('./reportConfig').getConfig(rdb.db);
    const next = new Map();
    for (const mod of MODULES) { const m = new Map(); for (const r of (await rdb.listSiteModuleCodes(mod)) || []) if (r.code) m.set(norm(r.name), String(r.code)); next.set(mod, m); }
    maps = next; enabled = String(cfg.site_codes_from_registry) === '1'; loadedAt = new Date().toISOString();
  } catch (_) { /* keep the last load; a failed read never switches the registry on */ }
  return status();
}
function status() { return { enabled, loaded_at: loadedAt, modules: Object.fromEntries([...maps].map(([k, v]) => [k, v.size])) }; }
function start(rdb) { refresh(rdb); if (!timer) { timer = setInterval(() => refresh(rdb), 5 * 60e3); if (timer.unref) timer.unref(); } }
/**
 * Hard-coded map vs registry, per site and module. `hard` = { tracker: fn(name), inspection: fn(name), meetings: fn(name) }
 * — the modules' own lookups WITHOUT the registry (pass the raw map functions).
 */
async function diff(rdb, hard) {
  const sites = (await rdb.listSites({ includeInactive: false })) || [];
  const out = [];
  for (const mod of MODULES) {
    const reg = new Map(); for (const r of (await rdb.listSiteModuleCodes(mod)) || []) reg.set(Number(r.site_id), String(r.code));
    for (const s of sites) {
      const h = hard[mod] ? hard[mod](s.name) : null; const r = reg.get(Number(s.id)) || null;
      if ((h || null) !== r) out.push({ module: mod, site_id: Number(s.id), site: s.name, hard_coded: h || null, registry: r, kind: !r ? 'missing_in_registry' : !h ? 'registry_only' : 'different' });
    }
  }
  return out;
}
function _setForTest(on, m) { enabled = !!on; maps = m || new Map(); }
module.exports = { MODULES, lookup, refresh, status, start, diff, _setForTest };
