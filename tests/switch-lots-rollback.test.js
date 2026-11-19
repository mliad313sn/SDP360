'use strict';
// P03 step 4 (rollback rehearsal) — on this file's throwaway database: for each PROPOSED lot, every switch is set
// on, then back to its default; every table other than report_config keeps the same content (row count + digest),
// and the config reads exactly as before. It proves that turning a lot off does not touch data. It does NOT prove
// the behaviour while on — that is each lot's targeted test run with tools/test/force-switches.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const cfg = require('../services/reportConfig');

const plan = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs/ops/switch-lots.json'), 'utf8'));
const SKIP = new Set(['report_config', 'system_log', 'audit_log', 'schema_migrations', 'sync_runs', 'sync_job_state']);

async function digest(H) {
  const tables = (await H.prepare("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name").all()).map((r) => r.table_name).filter((t) => !SKIP.has(t));
  const out = {};
  for (const t of tables) {
    const r = await H.prepare(`SELECT count(*)::int AS n, md5(coalesce(string_agg(md5(x::text), '' ORDER BY md5(x::text)), '')) AS h FROM "${t}" x`).get();
    out[t] = `${r.n}:${r.h}`;
  }
  return out;
}

for (const lot of plan.lots) {
  test(`${lot.id} — switches on then off: data intact, config back to defaults`, async () => {
    const rdb = require('../reports-db');
    const H = rdb.pgHandle();
    const before = await digest(H);
    const on = Object.fromEntries(lot.switches.map((k) => [k, '1']));
    const read = await cfg.setConfig(rdb.db, on, 'p03-rehearsal');
    for (const k of lot.switches) assert.equal(read[k], '1', `${k} did not switch on (missing from DEFAULTS?)`);
    const off = Object.fromEntries(lot.switches.map((k) => [k, cfg.DEFAULTS[k]]));
    const back = await cfg.setConfig(rdb.db, off, 'p03-rehearsal');
    for (const k of lot.switches) assert.equal(back[k], cfg.DEFAULTS[k], `${k} not back to its default`);
    assert.deepEqual(await digest(H), before);
  });
}
