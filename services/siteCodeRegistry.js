'use strict';
// DEC-4 (committee #37) — the site-code registry (site_module_codes) as the source of truth, behind a switch.
// Each module still carries its hard-coded name → code map (tracker-db / inspection-db SITE_MAP). With
// report_config site_codes_from_registry = '1', a site found in the registry for that module wins; a site
// absent from the registry falls back to the hard-coded map (nothing breaks while the registry is filled).
// Off ('0', default) = the hard-coded maps only, the behaviour until now. `diff()` lists every site where
// the two disagree or one side is missing — the evidence the committee reviews before switching it on.
// Sync API for the module lookups (they are sync): the registry is loaded at boot and refreshed every
// 5 minutes and on every change made through the admin route.
// E-D01 (audit D-03, X-DATA-02) — a third value 'shadow' = observation mode: every lookup still answers from
// the hard-coded maps (exactly like '0'), but the registry answer is computed too and a divergence (the
// registry has a code for that site and it differs from the hard map) is logged once per day per
// site × module (system_log category governance, action site_code_shadow_divergence). This is the double
// read the committee watches before switching to '1' (human gate 10).
const MODULES = ['tracker', 'inspection', 'meetings'];
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(it agent|it agents)\b/g, '').replace(/[^a-z0-9]+/g, '');
let enabled = false; let mode = '0'; let maps = new Map(); let loadedAt = null; let timer = null; let rdbRef = null;
const seen = new Set();   // `${day}|${module}|${normName}` already logged today

/** Registry code for a site name in a module, or undefined (switch off / site not in the registry). */
function lookup(module, name) {
  if (!enabled || !name) return undefined;
  const m = maps.get(module); if (!m) return undefined;
  return m.get(norm(name));
}
/** Normalise a stored switch value: '1' on, 'shadow' observe, anything else off. */
function parseMode(v) { const x = String(v == null ? '' : v).trim().toLowerCase(); return x === '1' ? '1' : x === 'shadow' ? 'shadow' : '0'; }
/**
 * The full lookup a module uses: registry first when '1' (fallback to the hard map), the hard map otherwise.
 * In 'shadow' the hard answer is returned unchanged and a divergence with the registry is logged.
 * `hardFn(name)` = the module's own map WITHOUT the registry.
 */
function resolve(module, name, hardFn) {
  if (!name) return hardFn(name);
  const reg = lookup(module, name); if (reg) return reg;
  const hard = hardFn(name);
  if (mode === 'shadow') observe(module, name, hard);
  return hard;
}
function observe(module, name, hard) {
  const m = maps.get(module); if (!m) return;
  const reg = m.get(norm(name)); if (!reg || reg === (hard || null)) return;
  const day = new Date().toISOString().slice(0, 10); const k = `${day}|${module}|${norm(name)}`;
  if (seen.has(k)) return;
  if (seen.size > 5000) seen.clear();
  seen.add(k);
  try {
    if (rdbRef && typeof rdbRef.logEvent === 'function') {
      rdbRef.logEvent({ category: 'governance', action: 'site_code_shadow_divergence', target: `${module}:${String(name).slice(0, 80)}`,
        details: { module, site: String(name).slice(0, 120), hard_coded: hard || null, registry: reg, answered: hard || null }, risk: 0 });
    }
  } catch (_) { /* observation never breaks a lookup */ }
}
async function refresh(rdb) {
  if (rdb) rdbRef = rdb;
  try {
    const cfg = await require('./reportConfig').getConfig(rdb.db);
    const next = new Map();
    for (const mod of MODULES) { const m = new Map(); for (const r of (await rdb.listSiteModuleCodes(mod)) || []) if (r.code) m.set(norm(r.name), String(r.code)); next.set(mod, m); }
    maps = next; mode = parseMode(cfg.site_codes_from_registry); enabled = mode === '1'; loadedAt = new Date().toISOString();
  } catch (_) { /* keep the last load; a failed read never switches the registry on */ }
  return status();
}
function status() { return { enabled, mode, loaded_at: loadedAt, modules: Object.fromEntries([...maps].map(([k, v]) => [k, v.size])) }; }
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
    // AMDEC 2026-11-05 (AM-01): two active sites resolving to the SAME code share one write scope
    // (e.g. Assafo and Tanda both → tracker TND). Reported, never repaired here: which site owns the
    // code is a data-owner decision.
    for (const [src, codeOf] of [['hard_coded', (s) => (hard[mod] ? hard[mod](s.name) : null)], ['registry', (s) => reg.get(Number(s.id)) || null]]) {
      const by = new Map();
      for (const s of sites) { const c = codeOf(s); if (c) { if (!by.has(c)) by.set(c, []); by.get(c).push(s); } }
      for (const [code, list] of by) if (list.length > 1) for (const s of list) {
        out.push({ module: mod, site_id: Number(s.id), site: s.name, hard_coded: src === 'hard_coded' ? code : null, registry: src === 'registry' ? code : null,
          kind: 'shared_code', source: src, shared_with: list.filter((x) => x !== s).map((x) => x.name) });
      }
    }
  }
  return out;
}
function _setForTest(on, m, rdb) { mode = on === 'shadow' ? 'shadow' : on ? '1' : '0'; enabled = mode === '1'; maps = m || new Map(); if (rdb !== undefined) rdbRef = rdb; seen.clear(); }
module.exports = { MODULES, lookup, resolve, parseMode, refresh, status, start, diff, _setForTest };
