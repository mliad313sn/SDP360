'use strict';
// A-19 — cross-module soft-delete operations: the admin trash listing and the purge (job + CLI).
// Each module registers how to list its deleted rows and how to purge the expired ones; the rest of the
// mechanics (retention, cut-off, dry run) live here once. See services/softDelete.js for the switch model.
const softDelete = require('./softDelete');

const _idb = () => require('../inspection-db');

// module → { trash(): rows[{ kind, id, label, site, deleted_at, deleted_by, delete_reason }], purge(cutoff, {apply}) }
const MODULES = {
  inspection: {
    trash: async () => (await _idb().listDeletedInspections()).map((r) => ({
      module: 'inspection', kind: 'inspection', id: r.id, label: r.label || r.id, site: r.site_code || null, restore_url: `/api/inspection/${encodeURIComponent(r.id)}/restore`,
      deleted_at: r.deleted_at, deleted_by: r.deleted_by == null ? null : Number(r.deleted_by), delete_reason: r.delete_reason || null,
    })),
    purge: (cutoff, opts) => _idb().purgeDeletedInspections(cutoff, opts),
  },
};

function moduleNames() { return Object.keys(MODULES); }

/** Deleted rows of one module (or every module), newest first. */
async function trash({ module = null } = {}) {
  const names = module ? [module] : moduleNames();
  const out = [];
  for (const n of names) {
    if (!MODULES[n]) throw Object.assign(new Error(`unknown module: ${n}`), { code: 'INVALID' });
    out.push(...await MODULES[n].trash());
  }
  return out.sort((a, b) => String(b.deleted_at).localeCompare(String(a.deleted_at)));
}

/**
 * Rows stamped deleted longer than the retention window. apply=false (default) only lists them.
 * Returns { apply, retention_days, cutoff, modules: { <name>: { ids, purged } } }.
 */
async function purge({ apply = false, cfg = {}, now = new Date(), modules = null } = {}) {
  const days = softDelete.retentionDays(cfg);
  const cutoff = softDelete.cutoffIso(days, now);
  const out = { apply: !!apply, retention_days: days, cutoff, modules: {} };
  for (const n of (modules || moduleNames())) {
    if (!MODULES[n]) throw Object.assign(new Error(`unknown module: ${n}`), { code: 'INVALID' });
    out.modules[n] = await MODULES[n].purge(cutoff, { apply: !!apply });
  }
  return out;
}

module.exports = { MODULES, moduleNames, trash, purge };
