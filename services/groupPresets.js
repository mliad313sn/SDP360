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

// Per user direction (2026-06-04): changes scope starts EMPTY, with the
// same 5 preset names. Admin classifies the discovered change-group
// names into the appropriate preset via the modal.
const CHANGES_SEED = {
  Operations:    [],
  Application:   [],
  Cybersecurity: [],
  ITSM:          [],
  Other:         [],
};

const SEED_BY_SCOPE = { tickets: TICKETS_SEED, changes: CHANGES_SEED };

// ── Schema + seed ─────────────────────────────────────────────────────
let _schemaReady = false;
function _initSchema(db) {
  if (_schemaReady) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS dashboard_preset_groups (
      scope         TEXT NOT NULL,
      preset_name   TEXT NOT NULL,
      group_name    TEXT NOT NULL,
      display_order INTEGER DEFAULT 0,
      updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_by    TEXT,
      PRIMARY KEY (scope, preset_name, group_name)
    );
    CREATE INDEX IF NOT EXISTS idx_dpg_scope ON dashboard_preset_groups(scope);
    CREATE INDEX IF NOT EXISTS idx_dpg_group ON dashboard_preset_groups(scope, group_name);
  `);

  // Seed each scope if empty. Idempotent — re-running on a populated
  // scope is a no-op.
  for (const scope of ['tickets', 'changes']) {
    const { c } = db.prepare(
      'SELECT COUNT(*) c FROM dashboard_preset_groups WHERE scope = ?'
    ).get(scope);
    if (c === 0) {
      const seed = SEED_BY_SCOPE[scope];
      const ins = db.prepare(`
        INSERT INTO dashboard_preset_groups
          (scope, preset_name, group_name, display_order, updated_by)
        VALUES (?, ?, ?, ?, '_system')
      `);
      const tx = db.transaction(() => {
        for (const [preset, groups] of Object.entries(seed)) {
          groups.forEach((g, ix) => ins.run(scope, preset, g, ix));
        }
      });
      tx();
      const total = Object.values(seed).reduce((s, g) => s + g.length, 0);
      console.log(`[group-presets] seeded scope='${scope}' with ${total} group assignments across ${Object.keys(seed).length} presets`);
    }
  }
  _schemaReady = true;
}

// ── Reads ─────────────────────────────────────────────────────────────
function getPresets(db, scope) {
  _initSchema(db);
  const out = {};
  CANONICAL_PRESETS.forEach(p => { out[p] = []; });

  try {
    const rows = db.prepare(`
      SELECT preset_name, group_name FROM dashboard_preset_groups
      WHERE scope = ?
      ORDER BY preset_name, display_order, group_name
    `).all(scope);
    rows.forEach(r => {
      if (!out[r.preset_name]) out[r.preset_name] = [];   // tolerant of unknown preset names
      out[r.preset_name].push(r.group_name);
    });
  } catch (e) {
    console.warn(`[group-presets] getPresets(${scope}) failed:`, e.message);
  }
  return out;
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
  _initSchema(db);
  const table = scope === 'changes' ? 'change_records' : 'request_records';
  // change_records uses `group_name` per server.js exec-pptx slide 4 fix
  // (CLAUDE.md, recent commits). request_records uses `tech_group`.
  const col = scope === 'changes' ? 'group_name' : 'tech_group';

  try {
    // Read assigned set first — fast (one scan of the 50-200 row preset table)
    const assignedRows = db.prepare(
      'SELECT group_name FROM dashboard_preset_groups WHERE scope = ?'
    ).all(scope);
    const assigned = new Set(assignedRows.map(r => r.group_name));

    // Pull distinct groups from data with a date window. The 12-month
    // window keeps the list relevant — long-retired groups stop appearing.
    const rows = db.prepare(`
      SELECT DISTINCT ${col} AS g
      FROM ${table}
      WHERE ${col} IS NOT NULL AND TRIM(${col}) != ''
        AND date(created_time) >= date('now', '-12 months')
      ORDER BY g
    `).all();
    return rows.map(r => r.g).filter(g => !assigned.has(g));
  } catch (e) {
    console.warn(`[group-presets] getDiscovered(${scope}) failed:`, e.message);
    return [];
  }
}

// Convenience for the frontend: presets with discovered groups appended
// to "Other" so the UI doesn't need to do the merge itself.
function getPresetsWithDiscovered(db, scope) {
  const presets = getPresets(db, scope);
  const discovered = getDiscovered(db, scope);
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

// ── Writes ────────────────────────────────────────────────────────────
// Atomic replace per scope: delete + reinsert in a transaction. The
// `presets` arg is a `{ presetName: [group, group, ...] }` map.
// Unknown preset names are accepted (forward-compat) — they get stored
// but the canonical list determines what the dropdown renders.
function setPresets(db, scope, presets, user) {
  _initSchema(db);
  if (!presets || typeof presets !== 'object') {
    throw new Error('setPresets: presets must be an object');
  }
  // Defensive: drop empty / non-array entries
  const clean = {};
  Object.entries(presets).forEach(([name, groups]) => {
    if (!Array.isArray(groups)) return;
    // Dedupe + drop falsy
    const seen = new Set();
    const out = [];
    groups.forEach(g => {
      const v = (g || '').trim();
      if (v && !seen.has(v)) { seen.add(v); out.push(v); }
    });
    clean[name] = out;
  });

  const delAll = db.prepare('DELETE FROM dashboard_preset_groups WHERE scope = ?');
  const ins = db.prepare(`
    INSERT INTO dashboard_preset_groups
      (scope, preset_name, group_name, display_order, updated_by)
    VALUES (?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    delAll.run(scope);
    for (const [preset, groups] of Object.entries(clean)) {
      groups.forEach((g, ix) => ins.run(scope, preset, g, ix, user || '_unknown'));
    }
  });
  tx();
  const total = Object.values(clean).reduce((s, g) => s + g.length, 0);
  console.log(`[group-presets] setPresets scope=${scope} user=${user} → ${total} assignments across ${Object.keys(clean).length} presets`);
  return { ok: true, scope, total_assignments: total, presets: Object.keys(clean).length };
}

module.exports = {
  CANONICAL_PRESETS,
  TICKETS_SEED,
  CHANGES_SEED,
  _initSchema,
  getPresets,
  setPresets,
  getDiscovered,
  getPresetsWithDiscovered,
};
