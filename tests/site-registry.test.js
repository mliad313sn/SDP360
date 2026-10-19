'use strict';
// Step 3 (SDP-DASH-2.0) — the site registry puts every vocabulary side by side and flags where a
// hard-coded map disagrees with site_module_codes.
const { test } = require('node:test');
const assert = require('node:assert');
const { buildSiteRegistry } = require('../services/siteRegistry');

test('codes per module, disagreements flagged, labels attached, unmapped listed', () => {
  const out = buildSiteRegistry({
    sites: [{ id: 2, name: 'Ity', zoho_group: 'ITY IT Agents' }, { id: 1, name: 'Hounde' }, { id: 3, name: 'Tanda' }],
    moduleCodes: {
      meetings: [{ site_id: 1, code: 'HGO' }, { site_id: 2, code: 'SMI' }],
      inspection: [{ site_id: 1, code: 'HGO' }, { site_id: 2, code: 'SMI' }],
      tracker: [{ site_id: 1, code: 'MGO' }, { site_id: 2, code: 'ITY' }],
    },
    trackerResolve: s => ({ Hounde: 'HGO', Ity: 'ITY', Tanda: 'TND' }[s.name] || null),
    inspectionResolve: n => ({ Hounde: 'HGO', Ity: 'SMI' }[n] || null),
    assetLabels: ['HOUNDE', 'Mystery'],
    assetLabelToCode: l => (l === 'HOUNDE' ? 'HGO' : null),
    rrAliases: {},
  });
  assert.deepEqual(out.modules, ['meetings', 'inspection', 'tracker']);
  const by = Object.fromEntries(out.sites.map(s => [s.name, s]));
  assert.deepEqual(by.Hounde.codes, { meetings: 'HGO', inspection: 'HGO', tracker: 'MGO' });
  assert.ok(by.Hounde.issues.some(i => i.kind === 'tracker_map_disagrees'), 'tracker map HGO vs DB MGO');
  assert.deepEqual(by.Hounde.asset_labels, ['HOUNDE']);
  assert.ok(by.Ity.issues.every(i => i.info), 'Ity agrees everywhere — only the informational multi-code note');
  assert.ok(by.Tanda.issues.some(i => i.kind === 'no_meetings_code'));
  assert.ok(by.Tanda.issues.some(i => i.kind === 'tracker_map_disagrees'), 'map gives TND, DB has none');
  assert.deepEqual(out.unmapped_asset_labels, ['Mystery']);
  assert.equal(out.summary.sites, 3);
  assert.equal(out.summary.with_issues, 2);
});
