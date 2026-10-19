'use strict';
// Step 3 (SDP-DASH-2.0) — the site registry, as it really is. The canonical key is the `sites` row
// + its `site_module_codes` (one code per module). Several modules still resolve sites through a
// HARD-CODED map (tracker SITE_MAP, inspection SITE_MAP, scoreboard ALIAS for asset labels, the
// risk-register alias table). This builder puts every vocabulary side by side and flags where a
// hard-coded map DISAGREES with the database — the evidence needed before those maps can be removed
// (DEC point "close the À CONFIRMER rows"). Pure: all inputs are passed in; nothing is guessed.

const MODULE_ORDER = ['meetings', 'inspection', 'tracker', 'risk_register', 'opmanager', 'meraki', 'assets'];

/**
 * @param {object} p
 * @param {Array<{id,name,zoho_group,active}>} p.sites
 * @param {Object<string,Array<{site_id,code}>>} p.moduleCodes   module → rows of site_module_codes
 * @param {(site)=>string|null} [p.trackerResolve]               hard-coded tracker resolution (tracker-db.siteToCode)
 * @param {(name)=>string|null} [p.inspectionResolve]            hard-coded inspection resolution (inspection-db.siteNameToCode)
 * @param {string[]} [p.assetLabels]                             distinct asset `site` labels seen in the inventory
 * @param {(label)=>string|null} [p.assetLabelToCode]            hard-coded scoreboard ALIAS (→ meetings code)
 * @param {Object<string,string>} [p.rrAliases]                  risk-register SDP label → register code
 */
function buildSiteRegistry(p) {
  const sites = (p.sites || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const codeOf = {};   // module → site_id → code
  for (const [m, rows] of Object.entries(p.moduleCodes || {})) {
    codeOf[m] = new Map((rows || []).map(r => [Number(r.site_id), r.code]));
  }
  const modules = MODULE_ORDER.filter(m => codeOf[m]).concat(Object.keys(codeOf).filter(m => !MODULE_ORDER.includes(m)).sort());
  const meetingsToSite = new Map();
  for (const s of sites) { const c = codeOf.meetings && codeOf.meetings.get(Number(s.id)); if (c) meetingsToSite.set(c, s); }

  const assetLabelsBySite = new Map();
  const unmappedAssetLabels = [];
  for (const label of p.assetLabels || []) {
    const code = p.assetLabelToCode ? p.assetLabelToCode(label) : null;
    const site = code ? meetingsToSite.get(code) : null;
    if (!site) { unmappedAssetLabels.push(label); continue; }
    if (!assetLabelsBySite.has(site.id)) assetLabelsBySite.set(site.id, []);
    assetLabelsBySite.get(site.id).push(label);
  }

  const rows = sites.map(s => {
    const id = Number(s.id);
    const codes = {};
    for (const m of modules) codes[m] = (codeOf[m] && codeOf[m].get(id)) || null;
    const hard = {
      tracker: p.trackerResolve ? (p.trackerResolve(s) || null) : undefined,
      inspection: p.inspectionResolve ? (p.inspectionResolve(s.name) || null) : undefined,
    };
    const issues = [];
    if (!codes.meetings) issues.push({ kind: 'no_meetings_code', text: 'No meetings code: the site cannot be site-reported (score, e-mails, hub).' });
    for (const m of ['tracker', 'inspection']) {
      if (hard[m] === undefined) continue;
      if ((hard[m] || null) !== (codes[m] || null)) {
        issues.push({ kind: m + '_map_disagrees', text: `Hard-coded ${m} map gives ${hard[m] || '—'}, the database says ${codes[m] || '—'}.` });
      }
    }
    const distinct = [...new Set(['meetings', 'inspection', 'tracker', 'risk_register'].map(m => codes[m]).filter(Boolean))];
    if (distinct.length > 1) issues.push({ kind: 'several_codes', text: `${distinct.length} codes across modules: ${distinct.join(' / ')}.`, info: true });
    const rr = Object.entries(p.rrAliases || {}).filter(([, code]) => code && code === codes.risk_register).map(([label]) => label);
    return { site_id: id, name: s.name, active: s.active == null ? 1 : Number(s.active), zoho_group: s.zoho_group || null,
      codes, hard_coded: hard, asset_labels: assetLabelsBySite.get(id) || [], rr_labels: rr, issues };
  });
  const blocking = rows.reduce((n, r) => n + r.issues.filter(i => !i.info).length, 0);
  return { modules, sites: rows, unmapped_asset_labels: unmappedAssetLabels.sort(),
    summary: { sites: rows.length, with_issues: rows.filter(r => r.issues.some(i => !i.info)).length, blocking_issues: blocking,
      several_codes: rows.filter(r => r.issues.some(i => i.kind === 'several_codes')).length,
      unmapped_asset_labels: unmappedAssetLabels.length } };
}

module.exports = { buildSiteRegistry, MODULE_ORDER };
