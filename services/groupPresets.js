/**
 * groupPresets.js — DB-backed dashboard group presets (Phase A1).
 *
 * Replaces the localStorage-only `_DEFAULT_GROUP_PRESETS` block in
 * executive-report.html. Two scopes:
 *
 *   • 'tickets' — applied to TICKETS GRP dropdown (request_records.tech_group)
 *   • 'changes' — applied to CHANGES GRP dropdown (change_records.tech_group)
 *
 * Configs are SEPARATE per scope by user request — a preset called
 * "Operations" can hold different groups under each scope, because the
 * groups that route helpdesk tickets vs the groups that authorise
 * changes are not always the same teams.
 *
 * Canonical preset names (the dropdown sections):
 *   Operations · Application · Cybersecurity · ITSM · Other
 *
 * "Other" is reserved for groups discovered in the data but not yet
 * classified by an admin — they appear there automatically (see
 * getDiscovered() / the merge in getPresetsWithDiscovered()).
 *
 * Public API:
 *   _initSchema(db)                    — idempotent table creation + seed
 *   getPresets(db, scope)              — { Operations:[…], Application:[…], …, Other:[] }
 *   setPresets(db, scope, presets, user) — atomic replace, audit-logged
 *   getDiscovered(db, scope)           — groups in data minus groups already classified
 *   getPresetsWithDiscovered(db, scope) — same as getPresets but appends discovered to Other
 *
 * RBAC enforcement is done by the route handlers (admin / super_admin only
 * for setPresets).
 */
'use strict';

const CANONICAL_PRESETS = ['Operations', 'Application', 'Cybersecurity', 'ITSM', 'Other'];

// Defaults — seeded once on first run. These mirror the current
// dashboard-shared.js OPS_GROUPS_DEFAULT + APPS_GROUPS_DEFAULT exactly
// so existing behaviour is preserved when the feature flips on.
const TICKETS_SEED = {
  Operations: [
    'Abidjan IT Agents', 'Exploration BF Support', 'Exploration CI Support',
    'Exploration IT Support', 'Hounde IT Agents', 'ITY IT Agents',
    'Kalana IT Agents', 'Lafigue IT Agents', 'Mana IT Agent',
    'Ouaga IT Agents', 'Sabodala IT Agents', 'Tanda IT Agents',
  ],
  Application: [
    'Benchmark Support Team', 'CELOXIS Support Agents', 'EDV Academy Team',
    'EDV SharePoint Support', 'EQS ONEIT Support Agents', 'ERP Support',
    'Ivalua Support Team', 'My Path Support Agents', 'Oracle Support',
  ],
  Cybersecurity: ['Infosec Team'],
  ITSM:         ['ManageEngine ServiceDesk Plus'],
  Other:        [],
};

// Changes scope seed — REVISED 2026-07-08. The original 2026-06-04 direction
// ("start EMPTY, admin classifies via the modal") left the Operations preset
// empty on prod, so the deck's change-scope fallback chain bottomed out at
// "all groups" and ERP changes (Sunshine / ION / R5) leaked into the
// Operations deck's slide 8. Seeded from the real change-group inventory
// (Change-25-2026.xlsx, 292 rows): site IT agents + CAB + InfraOPs are
// Operations; ERP/app vendor teams are Application. Group matching is
// case-insensitive downstream, so one case variant per name suffices.
// The seed only applies when the scope has ZERO rows — an admin who already
// classified groups via the modal is never overwritten.
const CHANGES_SEED = {
  Operations: [
    'Abidjan IT Agents', 'Exploration BF Support', 'Exploration CI Support',
    'Exploration IT Support', 'Hounde IT Agents', 'ITY IT Agents',
    'Kalana IT Agents', 'Lafigue IT Agents', 'Mana IT Agent',
    'Ouaga IT Agents', 'Sabodala IT Agents', 'Tanda IT Agents',
    'CAB Agents', 'EDV InfraOPs Support',
    // Per user direction 2026-07-08: security + ITSM-platform changes belong
    // in the Operations deck (unlike the tickets scope, which keeps them in
    // their own Cybersecurity / ITSM presets).
    'Infosec Team', 'ManageEngine ServiceDesk Plus',
  ],
  Application: [
    'Benchmark Support Team', 'EQS ONEIT Support Agents', 'ERP Support',
    'Ivalua Support Team', 'My Path Support Agents', 'Oracle Support',
    'SunShine Project Team',
  ],
  Cybersecurity: [],
  ITSM:          [],
  Other:         [],
};



// Resolve the active DB handle. Under REPORTS_BACKEND=postgres use reports-db's
// pool (lazy require — reports-db does NOT require this module, so no cycle);
// otherwise use the injected sqlite `db`. Callers pass `db` unchanged either way.
function _h(db) {
  const rdb = require('../reports-db');
  return { H: rdb.pgHandle(), isPg: true };
}



// ── Reads ─────────────────────────────────────────────────────────────
// Dispatch pattern (matches reports-db / meetings / inspection): the sqlite
// path returns SYNCHRONOUSLY (so existing non-awaited callers keep working on
// the default backend); only the pg branch returns a Promise. Callers awaiting
// the result work in both modes (await on a sync value is a no-op).
const _GP_SQL = `SELECT preset_name, group_name FROM dashboard_preset_groups
      WHERE scope = ? ORDER BY preset_name, display_order, group_name`;
function _foldPresets(rows) {
  const out = {};
  CANONICAL_PRESETS.forEach(p => { out[p] = []; });
  rows.forEach(r => {
    if (!out[r.preset_name]) out[r.preset_name] = [];   // tolerant of unknown preset names
    out[r.preset_name].push(r.group_name);
  });
  return out;
}
function getPresets(db, scope) {
  const { H, isPg } = _h(db);
  return _getPresetsPg(H, scope);
}
async function _getPresetsPg(H, scope) {
  try { return _foldPresets(await H.prepare(_GP_SQL).all(scope)); }
  catch (e) { console.warn(`[group-presets] getPresets(${scope}) failed:`, e.message); return _foldPresets([]); }
}

// DISTINCT groups found in actual data (last 12 months) for the scope,
// EXCLUDING groups already classified in any preset. Used by the modal
// to surface "you have new groups to classify" and by the frontend to
// auto-add them to "Other" when they appear.
//
// For 'tickets' scope: SELECT DISTINCT tech_group FROM request_records
// For 'changes' scope: SELECT DISTINCT tech_group FROM change_records
//   (change_records may use group_name; fallback handled below.)
function getDiscovered(db, scope) {
  const { H, isPg } = _h(db);
  return _getDiscoveredPg(H, scope);
}
// change_records uses `group_name` per server.js exec-pptx slide 4 fix; request_records uses `tech_group`.
function _discoveredCols(scope) {
  return scope === 'changes' ? { table: 'change_records', col: 'group_name' } : { table: 'request_records', col: 'tech_group' };
}
// Dialect: date('now','-12 months') → current_date - interval; date(created_time) → ::date.
// In 4B-only pg mode the hot table is absent → the catch returns [] (graceful, documented).
async function _getDiscoveredPg(H, scope) {
  const { table, col } = _discoveredCols(scope);
  try {
    const assigned = new Set((await H.prepare('SELECT group_name FROM dashboard_preset_groups WHERE scope = ?').all(scope)).map(r => r.group_name));
    const rows = await H.prepare(`
      SELECT DISTINCT ${col} AS g FROM ${table}
      WHERE ${col} IS NOT NULL AND TRIM(${col}) != ''
        AND created_time::date >= current_date - interval '12 months'
      ORDER BY g`).all();
    return rows.map(r => r.g).filter(g => !assigned.has(g));
  } catch (e) { console.warn(`[group-presets] getDiscovered(${scope}) failed:`, e.message); return []; }
}

// Convenience for the frontend: presets with discovered groups appended
// to "Other" so the UI doesn't need to do the merge itself.
function _mergeDiscovered(presets, discovered) {
  if (discovered.length) {
    const otherSet = new Set(presets.Other || []);
    discovered.forEach(g => {
      if (!otherSet.has(g)) {
        presets.Other = presets.Other || [];
        presets.Other.push(g);
        otherSet.add(g);
      }
    });
  }
  return presets;
}
function getPresetsWithDiscovered(db, scope) {
  const { isPg } = _h(db);
  return (async () => _mergeDiscovered(await getPresets(db, scope), await getDiscovered(db, scope)))();
}

// ── Writes ────────────────────────────────────────────────────────────
// Atomic replace per scope: delete + reinsert in a transaction. The
// `presets` arg is a `{ presetName: [group, group, ...] }` map.
// Unknown preset names are accepted (forward-compat) — they get stored
// but the canonical list determines what the dropdown renders.
const _SP_DEL = 'DELETE FROM dashboard_preset_groups WHERE scope = ?';
const _SP_INS = `INSERT INTO dashboard_preset_groups
      (scope, preset_name, group_name, display_order, updated_by) VALUES (?, ?, ?, ?, ?)`;
function _cleanPresets(presets) {
  if (!presets || typeof presets !== 'object') throw new Error('setPresets: presets must be an object');
  const clean = {};
  Object.entries(presets).forEach(([name, groups]) => {
    if (!Array.isArray(groups)) return;
    const seen = new Set(); const out = [];
    groups.forEach(g => { const v = (g || '').trim(); if (v && !seen.has(v)) { seen.add(v); out.push(v); } });
    clean[name] = out;
  });
  return clean;
}
function _setPresetsResult(scope, user, clean) {
  const total = Object.values(clean).reduce((s, g) => s + g.length, 0);
  console.log(`[group-presets] setPresets scope=${scope} user=${user} → ${total} assignments across ${Object.keys(clean).length} presets`);
  return { ok: true, scope, total_assignments: total, presets: Object.keys(clean).length };
}
function setPresets(db, scope, presets, user) {
  const { H, isPg } = _h(db);
  return _setPresetsPg(H, scope, presets, user);
}
async function _setPresetsPg(H, scope, presets, user) {
  const clean = _cleanPresets(presets);
  await H.runTransaction(async () => {
    await H.prepare(_SP_DEL).run(scope);
    for (const [preset, groups] of Object.entries(clean)) {
      let ix = 0;
      for (const g of groups) { await H.prepare(_SP_INS).run(scope, preset, g, ix, user || '_unknown'); ix++; }
    }
  });
  return _setPresetsResult(scope, user, clean);
}

module.exports = {
  CANONICAL_PRESETS,
  TICKETS_SEED,
  CHANGES_SEED,
  getPresets,
  setPresets,
  getDiscovered,
  getPresetsWithDiscovered,
};
