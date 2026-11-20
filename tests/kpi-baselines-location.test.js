'use strict';
// P11 F-05 (round 4) — the KPI baselines the tests read (unknown-sweep ratchet, committee dossiers) live under
// docs/kpi/baselines/, never under docs/agent-execution/ (a narrative/evidence folder, stripped in clean
// qualification clones). No duplicate is left behind.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

test('the KPI baselines are under docs/kpi/baselines and not under docs/agent-execution', () => {
  assert.strictEqual(path.relative(ROOT, require('../tools/kpi/unknown-sweep').check().baseline).split(path.sep).join('/'), 'docs/kpi/baselines/P08-unknown-sweep.json');
  assert.strictEqual(path.relative(ROOT, require('../tools/kpi/dossiers').OUT).split(path.sep).join('/'), 'docs/kpi/baselines/P08-kpi-dossiers.md');
  for (const f of ['P08-unknown-sweep.json', 'P08-kpi-dossiers.md']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'docs', 'kpi', 'baselines', f)), f);
    assert.ok(!fs.existsSync(path.join(ROOT, 'docs', 'agent-execution', f)), `no duplicate left in docs/agent-execution: ${f}`);
  }
});

test('no KPI / metric test or tool reads a file under docs/agent-execution', () => {
  const files = fs.readdirSync(path.join(ROOT, 'tests')).filter((f) => /^(kpi-|metric-|figure-parity|dashboard-figure-parity)/.test(f) && f !== path.basename(__filename)).map((f) => path.join('tests', f))
    .concat(fs.readdirSync(path.join(ROOT, 'tools', 'kpi')).map((f) => path.join('tools', 'kpi', f)));
  for (const rel of files) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    assert.ok(!/['"`]agent-execution['"`]|docs\/agent-execution\//.test(code), `${rel} reads docs/agent-execution`);
  }
});
