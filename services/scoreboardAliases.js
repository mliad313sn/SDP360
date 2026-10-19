'use strict';

// Map free-form AP asset-site labels (asset_effort_history.site) to the
// canonical meetings-namespace site codes the scoreboard iterates by.
// Massawa + Sabodala both belong to SGO — folded by a simple mean.
const ALIAS = {
  hounde: 'HGO',
  mana: 'MGO',
  sabodala: 'SGO',
  massawa: 'SGO',
  lafigue: 'SML',
  ity: 'SMI',
  kalana: 'KGO',
  ouagadougou: 'OUA',
  ouaga: 'OUA',
  abidjan: 'ABJ',
  dakar: 'DKR',
};

// Accent-fold + lowercase + trim so 'Houndé', 'HOUNDE', ' hounde ' all match.
const fold = s =>
  String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

// Step 3 — the site registry (site_module_codes module='assets', joined to the meetings code)
// is consulted FIRST; the in-code ALIAS map is the fallback until every site has its row and
// the committee closes the registry (dossier ETAPE-03, arbitration point 4). setRegistry()
// takes { foldedLabel → code }; loadFromRegistry(rdb) builds it from the two module namespaces.
let REGISTRY = null;
function setRegistry(map) { REGISTRY = map && Object.keys(map).length ? map : null; return REGISTRY; }
async function loadFromRegistry(rdb) {
  const assets = await rdb.listSiteModuleCodes('assets');
  const meetings = await rdb.listSiteModuleCodes('meetings');
  const codeBySite = new Map((meetings || []).map((r) => [Number(r.site_id), r.code]));
  const map = {};
  for (const r of assets || []) {
    const code = codeBySite.get(Number(r.site_id)); if (!code) continue;
    for (const label of String(r.code || '').split(',')) { const k = fold(label); if (k) map[k] = code; }
  }
  return setRegistry(map);
}

function assetLabelToCode(label) {
  const k = fold(label);
  if (REGISTRY && REGISTRY[k]) return REGISTRY[k];
  return ALIAS[k] || null;
}

function foldEffortByCode(rows) {
  const acc = new Map();
  for (const r of rows || []) {
    const code = assetLabelToCode(r.site);
    if (!code) continue;
    const cur = acc.get(code) || { sum: 0, n: 0 };
    cur.sum += Number(r.effort_score) || 0;
    cur.n++;
    acc.set(code, cur);
  }
  const out = new Map();
  for (const [code, { sum, n }] of acc) out.set(code, n > 0 ? Math.round(sum / n) : null);
  return out;
}

module.exports = { assetLabelToCode, foldEffortByCode, ALIAS, setRegistry, loadFromRegistry };
