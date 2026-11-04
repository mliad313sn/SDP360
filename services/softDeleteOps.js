'use strict';
// A-19 — cross-module soft-delete operations: the admin trash listing and the purge (job + CLI).
// Each module registers how to list its deleted rows and how to purge the expired ones; the rest of the
// mechanics (retention, cut-off, dry run) live here once. See services/softDelete.js for the switch model.
const softDelete = require('./softDelete');

const _idb = () => require('../inspection-db');
const _mdb = () => require('../meetings-db');
const _num = (v) => (v == null ? null : Number(v));
// The governance store over the reports database (same construction as routes/governance.createStore).
const _gov = () => require('../routes/governance').createStore(require('../reports-db'));

// module → { trash(): rows[{ kind, id, label, site, deleted_at, deleted_by, delete_reason }], purge(cutoff, {apply}) }
const MODULES = {
  inspection: {
    trash: async () => (await _idb().listDeletedInspections()).map((r) => ({
      module: 'inspection', kind: 'inspection', id: r.id, label: r.label || r.id, site: r.site_code || null, restore_url: `/api/inspection/${encodeURIComponent(r.id)}/restore`,
      deleted_at: r.deleted_at, deleted_by: r.deleted_by == null ? null : Number(r.deleted_by), delete_reason: r.delete_reason || null,
    })),
    purge: (cutoff, opts) => _idb().purgeDeletedInspections(cutoff, opts),
  },
  meetings: {
    trash: async () => (await _mdb().listDeletedMeetings()).map((r) => ({
      module: 'meetings', kind: 'pv', id: Number(r.id), label: r.reference || `PV #${r.id}`, site: r.site_code || null,
      restore_url: `/api/meetings/${Number(r.id)}/restore`,
      deleted_at: r.deleted_at, deleted_by: _num(r.deleted_by), delete_reason: r.delete_reason || null,
    })),
    purge: (cutoff, opts) => _mdb().purgeDeletedMeetings(cutoff, opts),
  },
  // Portfolio nodes (every kind of governanceStore TABLES) and meeting cadences — one module for the trash / purge.
  portfolio: {
    trash: async (gov) => {
      const st = gov || _gov();
      const nodes = (await st.listDeletedPortfolio()).map((r) => ({
        module: 'portfolio', kind: r.kind, id: r.id, label: r.label, site: null,
        restore_url: `/api/governance/portfolio/${r.kind}/${r.id}/restore`,
        deleted_at: r.deleted_at, deleted_by: _num(r.deleted_by), delete_reason: r.delete_reason || null,
      }));
      const cads = (await st.listDeletedCadences()).map((r) => ({
        module: 'portfolio', kind: 'cadence', id: r.id, label: r.name || r.key, site: r.site_id == null ? null : String(r.site_id),
        restore_url: `/api/governance/cadences/${r.id}/restore`,
        deleted_at: r.deleted_at, deleted_by: _num(r.deleted_by), delete_reason: r.delete_reason || null,
      }));
      return [...nodes, ...cads];
    },
    purge: async (cutoff, opts, gov) => {
      const st = gov || _gov();
      const a = await st.purgeDeletedPortfolio(cutoff, opts), b = await st.purgeDeletedCadences(cutoff, opts);
      return { ids: [...a.ids, ...b.ids.map((id) => `cadence:${id}`)], purged: a.purged + b.purged, skipped: a.skipped || [] };
    },
  },
};

function moduleNames() { return Object.keys(MODULES); }

/** Deleted rows of one module (or every module), newest first. */
async function trash({ module = null, govStore = null } = {}) {
  const names = module ? [module] : moduleNames();
  const out = [];
  for (const n of names) {
    if (!MODULES[n]) throw Object.assign(new Error(`unknown module: ${n}`), { code: 'INVALID' });
    out.push(...await MODULES[n].trash(govStore));
  }
  return out.sort((a, b) => String(b.deleted_at).localeCompare(String(a.deleted_at)));
}

/**
 * Rows stamped deleted longer than the retention window. apply=false (default) only lists them.
 * Returns { apply, retention_days, cutoff, modules: { <name>: { ids, purged } } }.
 */
async function purge({ apply = false, cfg = {}, now = new Date(), modules = null, govStore = null } = {}) {
  const days = softDelete.retentionDays(cfg);
  const cutoff = softDelete.cutoffIso(days, now);
  const out = { apply: !!apply, retention_days: days, cutoff, modules: {} };
  for (const n of (modules || moduleNames())) {
    if (!MODULES[n]) throw Object.assign(new Error(`unknown module: ${n}`), { code: 'INVALID' });
    out.modules[n] = await MODULES[n].purge(cutoff, { apply: !!apply }, govStore);
  }
  return out;
}

module.exports = { MODULES, moduleNames, trash, purge };
