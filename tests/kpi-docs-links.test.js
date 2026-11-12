'use strict';
// E-K01 — the KPI committee documents (docs/kpi/*) cite code by `file:line` (`anchor`) and name parity tests.
// A citation must still point at an existing line that contains its anchor; a named test file must exist.
// Line numbers drift: when this fails, fix the citation in the document, never the code.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DOCS = ['COMMITTEE-CHARTER.md', 'PV-TEMPLATE.md', 'FORMULA-REFERENCE.md', 'DECISION-KPIS-PROPOSAL.md'].map((f) => path.join(ROOT, 'docs', 'kpi', f));
const CITE = /`([\w./-]+\.(?:js|mjs|html|sql)):(\d+)`(?: \(`([^`]+)`\))?/g;
const TESTREF = /`(tests\/[\w./-]+\.test\.js)`/g;
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

function citations(text) {
  const out = []; let m; CITE.lastIndex = 0;
  while ((m = CITE.exec(text))) out.push({ file: m[1], line: Number(m[2]), anchor: m[3] || null });
  return out;
}

test('the three committee documents exist and say they are proposals / not approvals', () => {
  for (const p of DOCS) assert.ok(fs.existsSync(p), p);
  assert.match(read(DOCS[0]), /PROPOSITION, not adopted/);
  assert.match(read(DOCS[2]), /No formula, threshold or window here is\s+(?:> )?approved/);
});

test('every file:line citation exists and still contains its anchor', () => {
  let n = 0;
  for (const p of DOCS) {
    for (const c of citations(read(p))) {
      n++;
      const f = path.join(ROOT, c.file);
      assert.ok(fs.existsSync(f), `${path.basename(p)}: ${c.file} does not exist`);
      const lines = read(f).split('\n');
      assert.ok(c.line >= 1 && c.line <= lines.length, `${path.basename(p)}: ${c.file}:${c.line} is past the end (${lines.length} lines)`);
      if (c.anchor) assert.ok(lines[c.line - 1].includes(c.anchor), `${path.basename(p)}: ${c.file}:${c.line} no longer contains "${c.anchor}"`);
    }
  }
  assert.ok(n >= 40, `expected the sheet to cite the code (${n} citations found)`);
});

test('every code citation in FORMULA-REFERENCE.md carries an anchor', () => {
  const missing = citations(read(DOCS[2])).filter((c) => !c.anchor).map((c) => `${c.file}:${c.line}`);
  assert.deepEqual(missing, []);
});

test('every parity test named in the documents exists', () => {
  const named = new Set();
  for (const p of DOCS) { let m; TESTREF.lastIndex = 0; const t = read(p); while ((m = TESTREF.exec(t))) named.add(m[1]); }
  assert.ok(named.size >= 8, 'parity tests are named');
  for (const t of named) assert.ok(fs.existsSync(path.join(ROOT, t)), `${t} does not exist`);
});

test('the formula sheet covers the five families and lists divergences without resolving them', () => {
  const s = read(DOCS[2]);
  for (const h of ['Resolution SLA', 'First-reply SLA', 'Change success rate', 'Site score', 'Site composite', 'Divergence register']) assert.ok(s.includes(h), h);
  const rows = s.split('\n').filter((l) => /^\| DV-\d+ /.test(l));
  assert.ok(rows.length >= 8, 'divergences listed');
  assert.ok(!/\b(approved|adopted|certified)\b/i.test(rows.join('\n')), 'no divergence is declared decided');
  for (const layer of ['Screen', 'API', 'PPTX', 'E-mail']) assert.ok(s.includes(`| ${layer}`), layer);
});

// F-DATA-11 — the two decision-KPI candidates: a proposal pack, a draft-only seed, both keys in the parity harness.
test('decision-KPI proposal: says it decides nothing, cites both keys, leaves the committee table empty', () => {
  const s = read(DOCS[3]);
  assert.match(s, /PROPOSITION, not adopted/);
  for (const k of ['helpdesk.resolution_sla_pct', 'inspection.overdue_actions', 'DV-01', 'tests/figure-parity-five-surfaces.test.js']) assert.ok(s.includes(k), k);
  const table = s.slice(s.indexOf('## Left for the committee'));
  for (const row of table.split('\n').filter((l) => /^\| [A-Z]/.test(l) && !/^\| Question/.test(l))) assert.match(row, /^\|[^|]+\| \| \|$/, 'left empty: ' + row);
  assert.ok(!/\b(approved|certified by|signed off)\b/i.test(s));
  const harness = read(path.join(ROOT, 'tests', 'figure-parity-five-surfaces.test.js'));
  assert.match(harness, /const KEYS = \['helpdesk\.resolution_sla_pct', 'inspection\.overdue_actions'\]/, 'the parity harness resolves both candidates');
});

test('decision-kpis dashboard: valid, not in the shipped seeds, created only as a draft behind dashboard_decision_kpis_seed', async () => {
  const S = require('../services/dashboardSeeds');
  const { validateDashboard } = require('../services/dashboardWidgets');
  assert.deepEqual(validateDashboard(S.DECISION_KPIS, {}).errors, []);
  assert.ok(!S.SEED_DASHBOARDS.some((d) => d.key === 'decision-kpis'), 'never seeded/published with the shipped dashboards');
  assert.equal(require('../services/reportConfig').DEFAULTS.dashboard_decision_kpis_seed, '0');
  const { createStore } = (() => { const src = read(path.join(ROOT, 'routes', 'dashboards.js')); assert.match(src, /dashboard_decision_kpis_seed\) === '1' && !\(await st\.get\(S\.DECISION_KPIS\.key\)\)\) \{ await st\.saveDraft\(S\.DECISION_KPIS, \{ user: null \}\);/); assert.ok(!/publish\(S\.DECISION_KPIS/.test(src), 'code never publishes it'); return {}; })();
  assert.equal(createStore, undefined);
});
