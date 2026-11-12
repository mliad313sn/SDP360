'use strict';
// A1 — the figures a Finance certification is about, recomputed on every read so a changed figure is noticed.
// For each scope the CANONICAL BASIS is the set of source rows the money figure is computed from, plus the
// configuration that turns them into money (rates, currency map, depreciation policy…). Hashing the basis — not a
// rendered summary — makes the hash independent of today's date (an expiry bucket moving does not "change" a
// certified licence cost) while ANY edited amount, row or rate breaks the certification.
//   lastEditorIds — the people who last wrote the figures, when the database knows them (separation of duties).
//   summary       — counts only, never an amount (it is stored next to the certification).
const FC = require('./financeCertification');

const MONEY_CFG = ['xof_usd_rate', 'asset_site_currency', 'asset_currency_rates', 'asset_amount_parser', 'asset_cost_outlier_factor', 'asset_cost_outlier_exclude'];
const pick = (cfg, keys) => Object.fromEntries(keys.map((k) => [k, cfg[k] == null ? null : String(cfg[k])]));
const periodEnd = (p) => { const [y, m] = p.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

async function figuresFor(target, { rdb, adb, cfg } = {}) {
  const R = rdb || require('../reports-db');
  const A = adb || require('../assets-db');
  const c = cfg || await require('./reportConfig').getConfig(R.db);
  const { scope, scope_key: key, period } = target;
  if (FC.ASSET_SCOPES.includes(scope)) {
    const site = key.startsWith('site:') ? key.slice(5) : null;
    const AH = A.pgHandle();
    const where = site == null ? '' : ' WHERE site = ?';
    const args = site == null ? [] : [site];
    const assets = (cols) => AH.prepare(`SELECT asset_id, ${cols} FROM assets${where} ORDER BY asset_id`).all(...args);
    const licences = () => AH.prepare(`SELECT license_id, site, cost, expiry_date, license_state, license_option, acquisition_date FROM software_licenses${where} ORDER BY license_id`).all(...args);
    let basis;
    if (scope === 'asset_finance') basis = { assets: await assets('site, state, purchase_cost, current_book_value, total_cost_of_ownership, operational_cost, months_since_acquisition'), cfg: pick(c, MONEY_CFG) };
    else if (scope === 'depreciation') basis = { assets: await assets('site, product_type, purchase_cost, acquisition_date'), cfg: pick(c, [...MONEY_CFG, 'asset_depreciation_config']), as_of: periodEnd(period) };
    else if (scope === 'licences') basis = { licences: await licences() };
    else basis = { assets: await assets('site, product_type, purchase_cost, acquisition_date'), licences: await licences(), cfg: pick(c, [...MONEY_CFG, 'asset_depreciation_config', 'asset_replacement_uplift_pct']) };
    const n = (basis.assets ? basis.assets.length : 0) + (basis.licences ? basis.licences.length : 0);
    return { found: true, figures: { scope, key, ...basis }, lastEditorIds: [], summary: { rows: n, assets: basis.assets ? basis.assets.length : null, licences: basis.licences ? basis.licences.length : null } };
  }
  const pid = Number(key.slice('project:'.length));
  const H = R.pgHandle();
  const p = await H.prepare('SELECT id FROM portfolio_projects WHERE id = ? AND deleted_at IS NULL').get(pid).catch(() => null);
  if (!p) return { found: false };
  if (scope === 'project_actuals') {
    const rows = await H.prepare(`SELECT currency, amount, actor_id FROM ppm_budget_periods WHERE project_id = ? AND period = ? AND kind = 'actual' ORDER BY currency`).all(pid, period);
    return { found: true, figures: { scope, key, period, actuals: rows.map((r) => ({ currency: r.currency, amount: String(Number(r.amount)) })) },
      lastEditorIds: rows.map((r) => r.actor_id), summary: { rows: rows.length, currencies: rows.map((r) => r.currency) } };
  }
  const rows = await H.prepare(`SELECT id, value_kind, currency, unit, baseline_value, target_value, realised_value, realised_by, verified_by FROM portfolio_benefits WHERE project_id = ? AND value_kind = 'money' ORDER BY id`).all(pid);
  const s = (v) => (v == null ? null : String(Number(v)));
  return { found: true, figures: { scope, key, benefits: rows.map((r) => ({ id: Number(r.id), currency: r.currency, baseline: s(r.baseline_value), target: s(r.target_value), realised: s(r.realised_value), verified_by: r.verified_by == null ? null : Number(r.verified_by) })) },
    lastEditorIds: rows.map((r) => r.realised_by), summary: { rows: rows.length } };
}

/** { target, hash, state, badge, certification } for one target — the read every surface shares. */
async function statusOf(target, { store, rdb, adb, cfg } = {}) {
  const f = await figuresFor(target, { rdb, adb, cfg });
  if (!f.found) return { target, found: false, state: 'uncertified', badge: FC.badge('uncertified', null), certification: null };
  const hash = FC.figuresHash(f.figures);
  const cert = await store.active(target.scope, target.scope_key, target.period);
  const st = FC.state(cert, hash);
  return { target, found: true, hash, state: st, badge: FC.badge(st, cert), certification: cert, summary: f.summary };
}

module.exports = { figuresFor, statusOf, periodEnd };
