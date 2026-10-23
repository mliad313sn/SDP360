'use strict';
// Step 7 — business operations of the trackers shared by routes/trackers.js and the scheduled jobs
// (services/sync/jobs.js): migration of the IT Activity Tracker, its nightly mirror during the parallel run, and the
// nightly computation of the items linked to a dictionary key.

const store = require('./store');
const def = require('./definition');
const { fromLegacy } = require('./legacyImport');
const { compare } = require('./legacyCompare');
const { computeLinkedCells } = require('./sources');

async function siteIdMap(rdb) {
  const rows = (await rdb.listSiteModuleCodes('tracker')) || [];
  const m = new Map(rows.map(r => [String(r.code).toUpperCase(), r.site_id]));
  return (code) => m.get(String(code).toUpperCase()) || null;
}

async function loadLegacy() {
  const tdb = require('../../tracker-db');
  if (tdb.TRACKER_BACKEND === 'postgres' && tdb.initPgTracker) await tdb.initPgTracker();
  return tdb.loadTracker();
}

/** Mirror the legacy entries of `year` into the migrated tracker (every cell, so a cleared cell becomes 0 here too). */
async function mirrorValues(id, year, values, by) {
  const cells = [];
  for (const u of Object.keys(values)) for (const it of Object.keys(values[u])) values[u][it].forEach((v, k) => cells.push({ unit: u, item: it, month: k + 1, value: v }));
  await store.setCells(id, year, cells, by, 'legacy');
  return cells.length;
}

/**
 * Create (or refresh) the migrated tracker `it-activity-<year>`: the definition is published (as the next version when
 * it changed) with the parallel run ON, the entries are mirrored, and the engines are compared.
 */
async function importLegacy(rdb, year, by) {
  const D = await loadLegacy();
  const id = `it-activity-${year}`;
  const { definition, values } = fromLegacy(D, year, { id, siteIdOf: await siteIdMap(rdb) });
  definition.legacy_mirror = true;
  const v = def.validate(definition);
  if (!v.ok) return { ok: false, errors: v.errors };
  const row = await store.defs.get(id);
  const pub = row ? await store.defs.getPublished(id) : null;
  let version = pub ? pub.version : null;
  if (!row || !pub || JSON.stringify(pub.definition) !== JSON.stringify(v.definition)) {
    await store.defs.saveDraft(id, v.definition, by, 'migrated');
    version = await store.defs.publishDefinition(id, v.definition, by, row ? 'structure refreshed from the IT Activity Tracker' : 'imported from the IT Activity Tracker');
  }
  const cells = await mirrorValues(id, year, values, by);
  const cmp = compare(D, year, { id, month: 12 });
  return { ok: true, id, version, cells, comparison: { accepted: cmp.accepted, max_gap_points: cmp.max_gap_points, colour_mismatches: cmp.colour_mismatches, checks: cmp.checks } };
}

/** Nightly: every migrated tracker still in parallel run gets the day's legacy entries + a fresh comparison. */
async function mirrorAll(rdb) {
  const out = [];
  for (const row of await store.defs.list()) {
    if (row.kind !== 'migrated' || row.retired || !row.published || !row.published.legacy_mirror) continue;
    const r = await importLegacy(rdb, row.published.year, 'system');
    out.push({ id: row.id, accepted: r.ok && r.comparison.accepted, max_gap_points: r.ok ? r.comparison.max_gap_points : null });
    try { rdb.logEvent({ category: 'tracker', action: 'tracker_parallel_compare', target: row.id, actor: 'system', details: r.ok ? r.comparison : { errors: r.errors } }); } catch (_) {}
  }
  if (out.some(o => !o.accepted)) return { error: 'parallel run: a migrated tracker differs from the IT Activity Tracker', trackers: out };
  return { trackers: out };
}

/** Compute and store the linked items of one published tracker, months 1..uptoMonth. */
async function refreshSources(rdb, definition, uptoMonth, depsIn) {
  const live = require('../metrics/liveDeps');
  const deps = depsIn || { metrics: live.liveDeps(rdb), sites: await live.groupSites(rdb), targets: await live.targets(rdb) };
  const { cells, skipped } = await computeLinkedCells(definition, uptoMonth, deps);
  if (cells.length) await store.setCells(definition.id, definition.year, cells, 'system', 'metric');
  return { id: definition.id, cells: cells.length, skipped };
}

/** Nightly: every published tracker of the current year with linked items. */
async function refreshAllSources(rdb, now = new Date()) {
  const year = now.getUTCFullYear(), month = now.getUTCMonth() + 1, out = [];
  for (const row of await store.defs.list()) {
    const p = row.published;
    if (!p || row.retired || !p.items.some(it => it.source)) continue;
    const upto = p.year < year ? 12 : p.year > year ? 0 : month;
    if (upto) out.push(await refreshSources(rdb, p, upto));
  }
  return { trackers: out.length, cells: out.reduce((n, r) => n + r.cells, 0) };
}

module.exports = { importLegacy, mirrorAll, refreshSources, refreshAllSources, siteIdMap };
