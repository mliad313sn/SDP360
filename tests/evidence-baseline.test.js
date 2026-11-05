'use strict';
// C-25 (G01/G02) — evidence baseline: the metric→widget map is generated and current, the evidence manifest's
// --check catches a changed / added / removed file, levels never claim more than code+test, and the
// persona→journey map only names pages and e2e journeys that exist (and names every e2e journey).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const MM = require('../tools/agent/metric-map');
const EM = require('../tools/agent/evidence-manifest');
const ROOT = path.join(__dirname, '..');

test('METRIC-WIDGET-MAP.md is up to date and lists every registered metric (node tools/agent/metric-map.js)', () => {
  const { markdown, rows } = MM.build();
  assert.equal(fs.readFileSync(MM.OUT, 'utf8').replace(/\r\n/g, '\n'), markdown);
  const { SEED } = require('../services/metricRegistry');
  assert.equal(rows.length, SEED.length);
  for (const m of SEED) assert.ok(markdown.includes('| `' + m.key + '` |'), m.key);
  // a seeded dashboard widget is attributed to its dashboard#widget
  const sla = rows.find((r) => r.key === 'helpdesk.resolution_sla_pct');
  assert.ok(sla.widgets.includes('exec-home#k-sla (kpi)'));
  assert.ok(sla.rules.includes('sla.resolution.red'));
  assert.equal(MM.main(['--check']), 0);
});

test('metric key matching is token-exact (a prefix key does not match a longer key)', () => {
  const re = MM.keyRe('helpdesk.closed');
  assert.ok(re.test("metric: 'helpdesk.closed'"));
  assert.ok(!re.test("'helpdesk.closed_pct'"));
  assert.ok(!re.test("'xhelpdesk.closed'"));
  assert.equal(MM.classify('public/index.html'), 'pages');
  assert.equal(MM.classify('tests/x.test.js'), 'tests');
  assert.equal(MM.classify('services/reportPack.js'), 'exports');
});

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'c25-evidence-'));
  fs.mkdirSync(path.join(root, 'docs', 'agent-execution'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'ops'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/agent-execution/C-99.md'), '# C-99\r\nproof\r\n');
  fs.writeFileSync(path.join(root, 'docs/agent-execution/README.md'), 'notes\n');
  fs.writeFileSync(path.join(root, 'docs/ops/FLAG-REGISTER.md'), 'flags\n');
  return root;
}

test('evidence manifest --check: sealed, then detects a changed, added and removed file', () => {
  const root = sandbox();
  const log = console.log, err = console.error; console.log = () => {}; console.error = () => {};
  try {
    assert.equal(EM.main([], { root }), 0);
    assert.equal(EM.main(['--check'], { root }), 0);
    assert.deepEqual(EM.check({ root }), []);
    // CRLF ↔ LF does not break the seal
    fs.writeFileSync(path.join(root, 'docs/agent-execution/C-99.md'), '# C-99\nproof\n');
    assert.deepEqual(EM.check({ root }), []);
    fs.writeFileSync(path.join(root, 'docs/agent-execution/C-99.md'), '# C-99\nproof — edited\n');
    assert.deepEqual(EM.check({ root }), [{ file: 'docs/agent-execution/C-99.md', problem: 'checksum changed' }]);
    assert.equal(EM.main(['--check'], { root }), 1);
    EM.main([], { root });
    fs.writeFileSync(path.join(root, 'docs/agent-execution/C-98.md'), 'new');
    fs.unlinkSync(path.join(root, 'docs/ops/FLAG-REGISTER.md'));
    const d = EM.check({ root }).map((x) => x.problem + ':' + x.file).sort();
    assert.deepEqual(d, ['missing on disk:docs/ops/FLAG-REGISTER.md', 'not in manifest:docs/agent-execution/C-98.md']);
  } finally { console.log = log; console.error = err; fs.rmSync(root, { recursive: true, force: true }); }
});

test('evidence levels: a goal file claims code+test only; browser-checked and human-accepted stay pending', () => {
  const root = sandbox();
  try {
    const md = EM.build({ root });
    assert.match(md, /\| `docs\/agent-execution\/C-99\.md` \| C-99 \| code\+test \| pending \| pending \| `[0-9a-f]{64}` \|/);
    assert.match(md, /\| `docs\/agent-execution\/README\.md` \| — \(reference\) \| — \| — \| — \|/);
    assert.deepEqual(EM.LEVELS, ['code+test', 'browser-checked', 'human-accepted']);
    // the committed manifest never records a level beyond code+test
    const real = fs.readFileSync(path.join(ROOT, EM.MANIFEST), 'utf8');
    for (const line of real.split('\n').filter((l) => /^\| `docs\/agent-execution\//.test(l))) {
      assert.ok(!/\|\s*(done|yes|accepted|checked)\s*\|/i.test(line), line);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('PERSONA-JOURNEYS.md names only existing pages and e2e journeys, and every e2e journey is mapped', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs/ops/PERSONA-JOURNEYS.md'), 'utf8');
  const pages = [...doc.matchAll(/`(public\/[^`?#]+\.html)`/g)].map((m) => m[1]);
  assert.ok(pages.length >= 10);
  for (const p of pages) assert.ok(fs.existsSync(path.join(ROOT, p)), p);
  const cited = new Set([...doc.matchAll(/`(tests\/e2e\/[^`*]+\.spec\.js)`/g)].map((m) => m[1]));
  for (const t of cited) assert.ok(fs.existsSync(path.join(ROOT, t)), t);
  for (const f of fs.readdirSync(path.join(ROOT, 'tests/e2e')).filter((f) => /\.spec\.js$/.test(f))) {
    assert.ok(cited.has('tests/e2e/' + f), f + ' not mapped to a persona');
  }
  for (const persona of ['Site IT coordinator', 'Site editor', 'Admin', 'Executive', 'super_admin', 'Field technician', 'Scorecard viewer']) {
    assert.ok(doc.includes('| ' + persona), persona);
  }
  assert.match(doc, /not covered/);
});
