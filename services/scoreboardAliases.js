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

function assetLabelToCode(label) {
  return ALIAS[fold(label)] || null;
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

module.exports = { assetLabelToCode, foldEffortByCode, ALIAS };
