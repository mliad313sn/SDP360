'use strict';
// V1a — Pure OPManager device → KPI family classifier. The family ORDER is
// authoritative: the rules are evaluated top-to-bottom and the FIRST family whose
// (category-equals OR type-contains) test matches wins. Ordered excluded → wan →
// wifi → lan → servers so the one real conflict in the data (a Type=Linux device
// with Category=Wireless) resolves to WiFi, not Servers. Case-insensitive.
// Rules are a declared table (data, not branches) so V2 exceptions are a table edit.
const RULES = [
  { family: 'excluded', cat: ['unknown', 'meraki controller'], typeEq: ['unknown'] },
  { family: 'wan',      cat: ['meraki security'], typeHas: ['meraki mx', 'meraki z', 'firewall', 'wan'] },
  { family: 'wifi',     cat: ['meraki radio', 'wireless'], typeHas: ['meraki mr', 'access point', 'ap', 'wireless access point'] },
  { family: 'lan',      cat: ['meraki switch'], typeHas: ['meraki ms', 'switch'] },
  { family: 'servers',  cat: ['server', 'domaincontroller'], typeHas: ['windows', 'linux', 'esxserver'] },
];

const _n = v => String(v == null ? '' : v).trim().toLowerCase();

function classifyKpiFamily(type, category) {
  const t = _n(type), c = _n(category);
  for (const r of RULES) {
    const catHit = (r.cat || []).includes(c);
    const typeEqHit = (r.typeEq || []).includes(t);
    const typeHasHit = (r.typeHas || []).some(s => t.includes(s));
    if (catHit || typeEqHit || typeHasHit) {
      const reason = catHit ? `category=${c}` : (typeEqHit || typeHasHit) ? `type=${t}` : '';
      return { family: r.family, reason };
    }
  }
  return { family: 'excluded', reason: 'unclassified (unknown type/category)' };
}

module.exports = { classifyKpiFamily, RULES };
