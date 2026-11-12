'use strict';
// A1 — the "Finance certification" sheet appended to the asset money exports (finance, licences, investment):
// for each scope of the workbook, Certifié / Non certifié, by whom and when (never an amount). Returns [] while
// finance_certification_enabled = '0' (today's workbooks unchanged). Scope key = the Site filter, else the fleet;
// period = the current month (certification is monthly).
const FC = require('./financeCertification');
const FF = require('./financeFigures');

async function sheets(scopes, req, deps = {}) {
  try {
    const rdb = deps.rdb || require('../reports-db');
    const cfg = await require('./reportConfig').getConfig(rdb.db);
    if (String(cfg.finance_certification_enabled) !== '1') return [];
    const store = deps.store || require('./financeCertStore').makeFinanceCertStore(rdb.pgHandle());
    const site = req && req.query && req.query.site ? String(req.query.site) : null;
    const period = new Date().toISOString().slice(0, 7);
    const rows = [];
    for (const scope of [].concat(scopes)) {
      const t = { scope, scope_key: site ? 'site:' + site : 'fleet', period };
      const s = await FF.statusOf(t, { store, rdb, cfg });
      rows.push(FC.exportRow(t, s.state, s.certification));
    }
    return [{ name: 'Finance certification', rows }];
  } catch (e) {
    // the export itself never fails because of the certification lookup — the sheet then says so
    return [{ name: 'Finance certification', rows: [{ State: 'unknown', Detail: 'certification state could not be read' }] }];
  }
}

module.exports = { sheets };
